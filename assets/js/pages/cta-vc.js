(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  // CTA / VC — Conseiller chauffage (v1)
  // ------------------------------------------------------------------
  // Page de pilotage du chauffage (CTA, VC, et tout autre type de circuit
  // librement créé — aucun plafond métier). Croise météo/DJU19 (voir
  // assets/js/utils/{weather,dju}.js), relevés manuels de température
  // intérieure et configuration réelle des circuits pour produire des
  // recommandations explicables (assets/js/utils/heating-engine.js).
  //
  // Collections Firestore utilisées : heating_circuits, heating_readings,
  // heating_recommendations, weather_daily — AUCUNE n'a encore de règle
  // dans firestore.rules (proposition séparée, non appliquée). Tant que ces
  // règles ne sont pas ajoutées, tout appel Firestore de cette page échoue
  // en production avec permission-denied ; voir _fsError dans db.js pour le
  // log console correspondant. Ce n'est pas un bug de cette page.
  //
  // Le moteur ne décide jamais rien seul : une recommandation calculée est
  // d'abord enregistrée comme "à examiner" (synchronisation automatique,
  // dédupliquée — voir _syncActionableRecosToFirestore), puis c'est un
  // technicien, en cliquant Accepter/Refuser, qui transforme ce statut en
  // décision humaine. "accepter" une recommandation ≠ "appliquée"
  // (confirmation séparée, explicite, après vérification réelle du réglage
  // sur l'installation). Une recommandation encore "à examiner" après
  // MX.HeatingEngine.RECO_EXPIRY_DAYS expire automatiquement ; une décision
  // humaine (acceptée/refusée/appliquée) n'expire jamais (voir
  // _expireStaleRecommendations ci-dessous).
  // ══════════════════════════════════════════════════════════════════════

  var _tab = 'overview';
  var _circuits = [];
  var _readings = [];
  var _recommendations = [];
  var _weatherSeries = null;
  var _weatherStatus = 'loading'; // 'loading' | 'ok' | 'error' | 'unconfigured'
  var _unsub = {};
  var _subscribed = false;
  var _liveRecos = null; // candidats calculés en mémoire, à synchroniser vers Firestore (statut 'a_examiner')
  var _aExaminerInFlight = {}; // clé circuitId+'|'+action -> écriture Firestore en cours (anti-doublon pendant l'aller-retour réseau)
  var _aExaminerSyncError = {}; // clé -> true si la dernière tentative d'enregistrement "à examiner" a échoué (permet un bouton Réessayer)
  var _showArchived = false;
  var _editingCircuit = null; // circuit en cours d'édition (objet) ou null (création)
  var _circuitDetailId = null; // circuit affiché en fiche détaillée

  // ── Utilitaires locaux ──
  function _todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function _currentUserName() {
    var cu = MX.state.currentUser, ad = MX.state.adminUser;
    if (cu) return cu.name;
    if (ad) return (ad.email || 'admin').split('@')[0];
    return 'Inconnu';
  }
  function _fmtDateTime(ts) {
    var d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
    if (!d || isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function _ageLabel(ts) {
    var d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
    if (!d || isNaN(d.getTime())) return null;
    var ms = Date.now() - d.getTime();
    var h = ms / 3600000;
    if (h < 1) return 'il y a ' + Math.max(1, Math.round(ms / 60000)) + ' min';
    if (h < 48) return 'il y a ' + Math.round(h) + ' h';
    return 'il y a ' + Math.round(h / 24) + ' j';
  }

  var REG_LABELS = { vanne_3v: 'Vanne 3 voies', consigne: 'Consigne', mixte: 'Mixte', autre: 'Autre' };
  var STATUS_LABELS = { configure: 'Configuré', incomplet: 'Incomplet', a_verifier: 'À vérifier' };
  var RECO_STATUS_LABELS = { a_examiner: 'À examiner', acceptee: 'Acceptée', refusee: 'Refusée', appliquee: 'Appliquée', expiree: 'Expirée' };
  var PRIORITY_LABELS = { haute: 'Haute', moyenne: 'Moyenne', basse: 'Basse' };

  // ── Abonnements Firestore (une seule fois, tant que la page n'est pas quittée) ──
  function _subscribe() {
    if (_subscribed) return;
    _subscribed = true;
    if (!MX.DB) return;
    _unsub.circuits = MX.DB.listenHeatingCircuits(function (list) {
      _circuits = list; _liveRecos = null;
      if (MX.state.currentPage === 'cta-vc') render();
    });
    _unsub.readings = MX.DB.listenHeatingReadings(function (list) {
      _readings = list; _liveRecos = null;
      if (MX.state.currentPage === 'cta-vc') render();
    });
    _unsub.recos = MX.DB.listenHeatingRecommendations(function (list) {
      _recommendations = list;
      _expireStaleRecommendations(list);
      if (MX.state.currentPage === 'cta-vc') render();
    });
  }

  // ── Expiration automatique des recommandations obsolètes ──
  // Durée centralisée : MX.HeatingEngine.RECO_EXPIRY_DAYS (heating-engine.js)
  // — jamais recopiée ici. Ne touche QUE le statut 'a_examiner' ; une
  // recommandation déjà acceptée/refusée/appliquée n'expire jamais.
  // _expiryAttempted évite de ré-écrire en boucle le même document pendant
  // que Firestore propage la mise à jour (le listener se redéclenche après
  // chaque écriture) — un identifiant y reste tant que la page n'est pas
  // rechargée, l'écriture elle-même restant par ailleurs idempotente.
  var _expiryAttempted = {};
  function _expireStaleRecommendations(list) {
    if (!MX.HeatingEngine || !MX.DB || !MX.DB.expireHeatingRecommendation) return;
    var now = Date.now();
    (list || []).forEach(function (r) {
      if (_expiryAttempted[r.id]) return;
      if (!MX.HeatingEngine.isExpired(r, now)) return;
      _expiryAttempted[r.id] = true;
      MX.DB.expireHeatingRecommendation(r.id).catch(function (e) {
        console.warn('[CTA/VC] Échec expiration automatique de la recommandation ' + r.id + ' :', e);
      });
    });
  }
  function _destroy() {
    Object.keys(_unsub).forEach(function (k) { if (_unsub[k]) _unsub[k](); });
    _unsub = {};
    _subscribed = false;
  }

  function _ensureWeather() {
    var cfg = MX.state.hotelConfig;
    var lat = cfg && typeof cfg.lat === 'number' ? cfg.lat : null;
    var lon = cfg && typeof cfg.lon === 'number' ? cfg.lon : null;
    if (lat === null || lon === null) { _weatherStatus = 'unconfigured'; return; }
    if (_weatherSeries !== null || _weatherStatus === 'loading-done') return;
    if (_weatherStatus === 'loading' && _weatherSeries === null && _weatherStatus !== 'unconfigured') {
      // déjà en cours — ne relance pas un second fetch
    }
    if (_weatherSeries === null && _weatherStatus !== 'fetching') {
      _weatherStatus = 'fetching';
      if (!MX.Weather || !MX.Weather.getDaily || !MX.Dju) { _weatherStatus = 'error'; return; }
      MX.Weather.getDaily(lat, lon).then(function (raw) {
        if (!raw) { _weatherStatus = 'error'; if (MX.state.currentPage === 'cta-vc') render(); return; }
        _weatherSeries = MX.Dju.buildDailySeries(raw.daily, _todayStr());
        _weatherStatus = 'ok';
        if (MX.state.currentPage === 'cta-vc') render();
      });
    }
  }

  // ── ENTRY POINT ──
  function render() {
    _subscribe();
    _ensureWeather();
    var mc = document.getElementById('main-content');
    if (!mc) return;
    mc.innerHTML = _html();
  }

  function _setTab(tab) { _tab = tab; _circuitDetailId = null; render(); }

  function _html() {
    var h = '<div class="ctavc-wrap">';
    h += '<div class="page-head"><div><div class="page-title"><i class="fas fa-fire-flame-curved"></i> CTA / VC</div>' +
      '<div class="page-sub">Conseiller chauffage — suivi et optimisation des réglages</div></div></div>';
    h += _tabsHtml();
    h += '<div class="ctavc-body">';
    if (_tab === 'overview') h += _overviewHtml();
    else if (_tab === 'circuits') h += _circuitsHtml();
    else if (_tab === 'recommendations') h += _recommendationsHtml();
    else if (_tab === 'history') h += _historyHtml();
    else if (_tab === 'config') h += _configHtml();
    h += '</div></div>';
    return h;
  }

  function _tabsHtml() {
    var tabs = [
      { id: 'overview', l: "Vue d'ensemble", icon: 'fa-gauge-high' },
      { id: 'circuits', l: 'Circuits', icon: 'fa-diagram-project' },
      { id: 'recommendations', l: 'Recommandations', icon: 'fa-lightbulb' },
      { id: 'history', l: 'Historique & analyse', icon: 'fa-chart-line' },
      { id: 'config', l: 'Configuration', icon: 'fa-sliders' },
    ];
    var h = '<div class="ctavc-tabs">';
    tabs.forEach(function (t) {
      h += '<button class="ctavc-tab' + (_tab === t.id ? ' ctavc-tab--on' : '') + '" onclick="MX.Pages.CtaVc._setTab(\'' + t.id + '\')">' +
        '<i class="fas ' + t.icon + '"></i> ' + t.l + '</button>';
    });
    h += '</div>';
    return h;
  }

  // ── Recommandations live (calculées, synchronisées vers Firestore comme "à examiner") ──
  function _computeLiveRecos() {
    if (!MX.HeatingEngine || !_weatherSeries) return [];
    return MX.HeatingEngine.evaluateAll(_circuits, _readings, _weatherSeries, Date.now(), _todayStr());
  }
  function _ensureLiveRecos() {
    if (_liveRecos === null) {
      _liveRecos = _computeLiveRecos();
      _syncActionableRecosToFirestore();
    }
    return _liveRecos;
  }
  // Persiste chaque candidat ACTIONNABLE (jamais "maintenir" — aucune
  // décision à prendre dans ce cas) comme recommandation 'a_examiner', afin
  // que ce statut soit réellement utilisé dans le parcours normal (plus un
  // simple défaut mort côté db.js). Déduplication à deux niveaux :
  //  1. _aExaminerInFlight : empêche un second appel de relancer une
  //     écriture pour la même clé circuit+action tant que la première
  //     requête Firestore n'a pas répondu (succès OU échec).
  //  2. Vérification de l'état déjà connu (_recommendations, tenu à jour par
  //     le listener listenHeatingRecommendations) : si une recommandation
  //     'a_examiner' existe déjà pour ce couple circuit+action, on ne
  //     ré-écrit rien.
  // Une fois une recommandation DÉCIDÉE (acceptée/refusée) ou expirée, le
  // même couple circuit+action redevient librement persistable si le moteur
  // le recalcule plus tard (nouvelle occurrence du même problème) — aucun
  // verrou permanent, contrairement à un simple booléen "déjà tenté".
  function _syncActionableRecosToFirestore() {
    if (!MX.DB || !MX.DB.addHeatingRecommendation) return;
    var live = (_liveRecos || []).filter(function (r) { return r.action !== 'maintenir'; });
    live.forEach(function (r) {
      var key = r.circuitId + '|' + r.action;
      if (_aExaminerInFlight[key]) return;
      var active = _recommendations.some(function (x) {
        return x.circuitId === r.circuitId && x.action === r.action && x.status === 'a_examiner';
      });
      if (active) return;
      _aExaminerInFlight[key] = true;
      MX.DB.addHeatingRecommendation({
        circuitId: r.circuitId, action: r.action, title: r.title, justification: r.justification,
        priority: r.priority, dataUsed: r.dataUsed || {}, missingData: r.missingData || [],
      }).then(function () {
        delete _aExaminerInFlight[key];
        delete _aExaminerSyncError[key];
        if (MX.state.currentPage === 'cta-vc') render();
      }).catch(function (e) {
        delete _aExaminerInFlight[key];
        _aExaminerSyncError[key] = true;
        console.warn('[CTA/VC] Échec enregistrement "à examiner" pour ' + key + ' :', e);
        if (MX.state.currentPage === 'cta-vc') render();
      });
    });
  }
  function _retrySyncReco(circuitId, action) {
    delete _aExaminerSyncError[circuitId + '|' + action];
    _syncActionableRecosToFirestore();
    render();
  }

  function _circuitName(id) {
    var c = _circuits.find(function (x) { return x.id === id; });
    return c ? c.name : 'Circuit supprimé';
  }

  // ════════════════════════════════════ VUE D'ENSEMBLE ════════════════════════════════════
  function _overviewHtml() {
    if (_weatherStatus === 'unconfigured') {
      return '<div class="ctavc-empty"><i class="fas fa-location-dot"></i><div>Localisation de l\'établissement non configurée.</div>' +
        '<button class="primary-btn" style="width:auto" onclick="window._settingsTab=\'etablissement\';MX.showPage(\'parametres\')">Configurer la météo</button></div>';
    }
    var recos = _ensureLiveRecos();
    var active = _circuits.filter(function (c) { return !c.archived; });
    var h = '';

    // Conseil prioritaire du jour = recommandation non-"maintenir"/"donnees_insuffisantes" de priorité la plus haute
    var actionable = recos.filter(function (r) { return r.action !== 'maintenir' && r.action !== 'donnees_insuffisantes'; });
    var order = { haute: 0, moyenne: 1, basse: 2 };
    actionable.sort(function (a, b) { return (order[a.priority] || 9) - (order[b.priority] || 9); });
    var top = actionable[0] || null;
    var vigilance = !active.length ? null : (actionable.some(function (r) { return r.priority === 'haute'; }) ? 'haute' : actionable.length ? 'moderee' : 'faible');

    h += '<div class="ctavc-card ctavc-card--highlight">';
    h += '<div class="ctavc-card-head"><i class="fas fa-lightbulb"></i> Conseil prioritaire du jour' +
      (vigilance ? '<span class="ctavc-vigilance ctavc-vigilance--' + vigilance + '">Vigilance ' + (vigilance === 'haute' ? 'élevée' : vigilance === 'moderee' ? 'modérée' : 'faible') + '</span>' : '') +
      '</div>';
    if (!active.length) {
      h += '<div class="ctavc-empty-inline">Aucun circuit configuré. Rendez-vous dans l\'onglet Configuration pour en créer un.</div>';
    } else if (!_weatherSeries) {
      h += '<div class="ctavc-empty-inline">Météo en cours de chargement…</div>';
    } else if (!top) {
      h += '<div class="ctavc-empty-inline">Aucune action particulière à signaler aujourd\'hui — réglages maintenus sur l\'ensemble des circuits actifs.</div>';
    } else {
      h += '<div class="ctavc-top-reco">' +
        '<div class="ctavc-top-reco-title">' + MX.esc(top.title) + ' <span class="ctavc-pill ctavc-pill--' + top.priority + '">' + PRIORITY_LABELS[top.priority] + '</span></div>' +
        '<div class="ctavc-top-reco-circuit">Circuit : ' + MX.esc(_circuitName(top.circuitId)) + '</div>' +
        '<div class="ctavc-top-reco-just">' + MX.esc(top.justification) + '</div>' +
      '</div>';
    }
    h += '</div>';

    // Météo actuelle + tendance (réutilise le même moteur que l'Accueil)
    if (_weatherSeries) {
      var today = _todayStr();
      var upcoming = _weatherSeries.filter(function (d) { return d.date >= today; }).slice(0, 7);
      var trend = MX.Dju.trend(_weatherSeries);
      h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-cloud-sun"></i> Météo & DJU19 — 7 prochains jours' +
        (trend ? ' <span class="ctavc-trend ctavc-trend--' + trend + '">' + (trend === 'hausse' ? 'Besoin de chauffe en hausse' : trend === 'baisse' ? 'Besoin de chauffe en baisse' : 'Stable') + '</span>' : '') +
        '</div><div class="ctavc-wd-row">';
      upcoming.forEach(function (d) {
        var info = (MX.Weather && MX.Weather.codeInfo) ? MX.Weather.codeInfo(d.weatherCode) : { icon: 'fa-cloud' };
        h += '<div class="ctavc-wd-cell' + (d.date === today ? ' ctavc-wd-cell--today' : '') + '">' +
          '<div class="ctavc-wd-cell-date">' + new Date(d.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit' }) + '</div>' +
          '<i class="fas ' + info.icon + '"></i>' +
          '<div class="ctavc-wd-cell-mm">' + (d.tMin !== null ? Math.round(d.tMin) : '—') + '° / ' + (d.tMax !== null ? Math.round(d.tMax) : '—') + '°</div>' +
          '<div class="ctavc-wd-cell-dju' + (d.kind === 'forecast' ? ' ctavc-wd-cell-dju--forecast' : '') + '">DJU ' + (d.dju19 !== null ? d.dju19.toFixed(1) : '—') + '</div>' +
        '</div>';
      });
      h += '</div></div>';
    }

    // Circuits concernés / état rapide
    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-diagram-project"></i> Circuits (' + active.length + ')</div>';
    if (!active.length) {
      h += '<div class="ctavc-empty-inline">Aucun circuit créé.</div>';
    } else {
      h += '<div class="ctavc-circuit-mini-list">';
      active.forEach(function (c) {
        var r = recos.find(function (x) { return x.circuitId === c.id; });
        h += '<button class="ctavc-circuit-mini" onclick="MX.Pages.CtaVc._openCircuitDetail(\'' + c.id + '\')">' +
          '<span class="ctavc-circuit-mini-name">' + MX.esc(c.name) + '</span>' +
          '<span class="ctavc-status-badge ctavc-status-badge--' + (c.configStatus || 'a_verifier') + '">' + (STATUS_LABELS[c.configStatus] || 'À vérifier') + '</span>' +
          (r ? '<span class="ctavc-pill ctavc-pill--' + r.priority + '">' + MX.esc(r.title) + '</span>' : '') +
        '</button>';
      });
      h += '</div>';
    }
    h += '</div>';

    // Prochaines actions (top 5 des recommandations actionnables)
    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-list-check"></i> Prochaines actions</div>';
    if (!actionable.length) {
      h += '<div class="ctavc-empty-inline">Aucune action en attente.</div>';
    } else {
      h += '<div class="ctavc-actions-list">';
      actionable.slice(0, 5).forEach(function (r) {
        h += '<div class="ctavc-action-row"><span class="ctavc-pill ctavc-pill--' + r.priority + '">' + PRIORITY_LABELS[r.priority] + '</span>' +
          '<span class="ctavc-action-circuit">' + MX.esc(_circuitName(r.circuitId)) + '</span>' +
          '<span class="ctavc-action-title">' + MX.esc(r.title) + '</span></div>';
      });
      h += '</div><button class="ctavc-link-btn" onclick="MX.Pages.CtaVc._setTab(\'recommendations\')">Voir toutes les recommandations <i class="fas fa-arrow-right"></i></button>';
    }
    h += '</div>';

    h += '<button class="ctavc-link-btn" onclick="MX.Pages.CtaVc._setTab(\'history\')"><i class="fas fa-chart-line"></i> Analyse détaillée et historique</button>';
    return h;
  }

  // ════════════════════════════════════ CIRCUITS (fiches) ════════════════════════════════════
  function _circuitsHtml() {
    if (_circuitDetailId) {
      var c = _circuits.find(function (x) { return x.id === _circuitDetailId; });
      if (c) return _circuitDetailHtml(c);
      _circuitDetailId = null;
    }
    var list = _circuits.filter(function (c) { return _showArchived || !c.archived; });
    var h = '<div class="ctavc-toolbar">' +
      '<label class="ctavc-check-inline"><input type="checkbox" ' + (_showArchived ? 'checked' : '') + ' onchange="MX.Pages.CtaVc._toggleShowArchived(this.checked)"> Afficher les circuits archivés</label>' +
      '<button class="primary-btn" style="width:auto" onclick="MX.Pages.CtaVc._openCircuitForm(null)"><i class="fas fa-plus"></i> Nouveau circuit</button>' +
    '</div>';
    if (!_circuits.length) {
      h += '<div class="ctavc-empty"><i class="fas fa-diagram-project"></i><div>Aucun circuit configuré pour le moment.<br>Créez votre premier circuit (CTA, VC, ou tout autre type) — aucun exemple préconfiguré n\'est fourni : les réglages affichés doivent toujours correspondre à l\'installation réelle.</div>' +
        '<button class="primary-btn" style="width:auto" onclick="MX.Pages.CtaVc._openCircuitForm(null)"><i class="fas fa-plus"></i> Créer un circuit</button></div>';
      return h;
    }
    h += '<div class="ctavc-circuit-grid">';
    list.forEach(function (c) {
      var reading = _readings.filter(function (r) { return r.circuitId === c.id; }).sort(function (a, b) {
        var at = a.recordedAt && a.recordedAt.toMillis ? a.recordedAt.toMillis() : new Date(a.recordedAt || 0).getTime();
        var bt = b.recordedAt && b.recordedAt.toMillis ? b.recordedAt.toMillis() : new Date(b.recordedAt || 0).getTime();
        return bt - at;
      })[0];
      h += '<div class="ctavc-circuit-card' + (c.archived ? ' ctavc-circuit-card--archived' : '') + '" onclick="MX.Pages.CtaVc._openCircuitDetail(\'' + c.id + '\')">' +
        '<div class="ctavc-circuit-card-head"><span class="ctavc-circuit-type">' + MX.esc((c.type || '').toUpperCase() || '—') + '</span>' +
        '<span class="ctavc-status-badge ctavc-status-badge--' + (c.configStatus || 'a_verifier') + '">' + (STATUS_LABELS[c.configStatus] || 'À vérifier') + '</span></div>' +
        '<div class="ctavc-circuit-card-name">' + MX.esc(c.name || '(sans nom)') + (c.archived ? ' <span class="ctavc-archived-tag">archivé</span>' : '') + '</div>' +
        '<div class="ctavc-circuit-card-zone">' + (c.zone ? MX.esc(c.zone) : 'Zone non précisée') + '</div>' +
        '<div class="ctavc-circuit-card-reg">' + (c.regulationType ? REG_LABELS[c.regulationType] || c.regulationType : 'Régulation non renseignée') + '</div>' +
        '<div class="ctavc-circuit-card-reading">' + (reading ? 'Dernier relevé : ' + reading.temp + '°C (' + (_ageLabel(reading.recordedAt) || '—') + ')' : 'Aucun relevé') + '</div>' +
      '</div>';
    });
    h += '</div>';
    return h;
  }
  function _toggleShowArchived(v) { _showArchived = v; render(); }
  function _openCircuitDetail(id) { _circuitDetailId = id; render(); }

  function _confidenceLabel(reco) {
    if (!reco) return null;
    if (reco.action === 'donnees_insuffisantes') return 'Faible — données manquantes';
    if (reco.missingData && reco.missingData.length) return 'Moyen — certaines données manquent';
    return 'Correct — basé sur les données disponibles';
  }

  // Même logique de décision que _liveRecoActionsHtml, adaptée au rendu de
  // la fiche circuit (boutons avec libellé plutôt qu'icônes seules). Aucun
  // bouton pour "maintenir" : rien à examiner/décider dans ce cas (jamais
  // synchronisé vers Firestore — voir _syncActionableRecosToFirestore).
  function _circuitDetailRecoActionsHtml(reco) {
    if (reco.action === 'maintenir') return '';
    var key = reco.circuitId + '|' + reco.action;
    var persisted = _matchingAExaminer(reco);
    if (persisted) {
      return '<button class="primary-btn" style="width:auto" onclick="MX.Pages.CtaVc._decideReco(\'' + persisted.id + '\',\'acceptee\')">Accepter</button>' +
        '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._decideReco(\'' + persisted.id + '\',\'refusee\')">Refuser</button>';
    }
    if (_aExaminerInFlight[key]) {
      return '<span class="ctavc-reco-row-pending">Enregistrement en cours…</span>';
    }
    if (_aExaminerSyncError[key]) {
      return '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._retrySyncReco(\'' + reco.circuitId + '\',\'' + reco.action + '\')"><i class="fas fa-rotate"></i> Réessayer l\'enregistrement</button>';
    }
    var last = _recommendations.find(function (x) { return x.circuitId === reco.circuitId && x.action === reco.action; });
    if (last && last.status !== 'a_examiner') {
      return '<span class="ctavc-reco-row-pending">' + (RECO_STATUS_LABELS[last.status] || last.status) + ' — voir l\'onglet Recommandations</span>';
    }
    return '<span class="ctavc-reco-row-pending">Enregistrement en cours…</span>';
  }

  function _circuitDetailHtml(c) {
    var recos = _ensureLiveRecos().filter(function (r) { return r.circuitId === c.id; });
    var reco = recos[0] || null;
    var readings = _readings.filter(function (r) { return r.circuitId === c.id; }).sort(function (a, b) {
      var at = a.recordedAt && a.recordedAt.toMillis ? a.recordedAt.toMillis() : new Date(a.recordedAt || 0).getTime();
      var bt = b.recordedAt && b.recordedAt.toMillis ? b.recordedAt.toMillis() : new Date(b.recordedAt || 0).getTime();
      return bt - at;
    });
    var lastReading = readings[0] || null;

    var h = '<button class="ctavc-back-btn" onclick="MX.Pages.CtaVc._setTab(\'circuits\')"><i class="fas fa-arrow-left"></i> Retour aux circuits</button>';
    h += '<div class="ctavc-card">';
    h += '<div class="ctavc-detail-head"><div>' +
      '<div class="ctavc-detail-name">' + MX.esc(c.name) + (c.archived ? ' <span class="ctavc-archived-tag">archivé</span>' : '') + '</div>' +
      '<div class="ctavc-detail-sub">' + MX.esc((c.type || '').toUpperCase() || '—') + (c.zone ? ' · ' + MX.esc(c.zone) : '') + '</div>' +
      '</div><div class="ctavc-detail-actions">' +
      '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._openCircuitForm(\'' + c.id + '\')"><i class="fas fa-pen"></i> Modifier</button>' +
      '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._confirmArchive(\'' + c.id + '\', ' + (!c.archived) + ')"><i class="fas fa-box-archive"></i> ' + (c.archived ? 'Réactiver' : 'Archiver') + '</button>' +
      '</div></div>';

    if (c.description) h += '<div class="ctavc-detail-desc">' + MX.esc(c.description) + '</div>';

    h += '<div class="ctavc-field-grid">';
    h += _fieldRow('Type de régulation', c.regulationType ? REG_LABELS[c.regulationType] || c.regulationType : null);
    if (c.regulationType === 'autre') h += _fieldRow('Description de la régulation', c.regulationDescription);
    if (c.regulationType === 'vanne_3v' || c.regulationType === 'mixte') {
      h += _fieldRow('Consigne eau de départ', typeof c.waterSetpoint === 'number' ? c.waterSetpoint + ' °C' : null);
      h += _fieldRow('Loi d\'eau / courbe de chauffe', c.waterLawCurve);
      h += _fieldRow('Position vanne', typeof c.valvePosition === 'number' ? c.valvePosition + ' %' : null);
    }
    if (c.regulationType === 'consigne' || c.regulationType === 'mixte') {
      h += _fieldRow('Nature de la consigne', c.setpointType === 'ambiante' ? 'Température ambiante' : c.setpointType === 'eau' ? 'Température d\'eau' : (c.setpointType ? c.setpointType : null));
      h += _fieldRow('Valeur de consigne', typeof c.setpointValue === 'number' ? c.setpointValue + (c.setpointUnit || '°C') : null);
    }
    h += _fieldRow('Température intérieure associée', lastReading ? lastReading.temp + ' °C (' + _fmtDateTime(lastReading.recordedAt) + ')' : null);
    h += _fieldRow('Température cible de la zone', typeof c.targetTemp === 'number' ? c.targetTemp + ' °C' : null);
    h += _fieldRow('Limites connues', c.knownLimits);
    h += _fieldRow('Horaires de fonctionnement', c.operatingHours);
    h += _fieldRow('Dernière vérification', c.lastCheckedAt ? _fmtDateTime(c.lastCheckedAt) : null);
    h += '</div></div>';

    // Conseil Maintix pour ce circuit
    h += '<div class="ctavc-card">';
    h += '<div class="ctavc-card-head"><i class="fas fa-lightbulb"></i> Conseil Maintix pour ce circuit</div>';
    if (!reco) {
      h += '<div class="ctavc-empty-inline">Calcul en attente (météo non chargée).</div>';
    } else {
      h += '<div class="ctavc-reco-detail">' +
        '<div><strong>Action conseillée :</strong> ' + MX.esc(reco.title) + ' <span class="ctavc-pill ctavc-pill--' + reco.priority + '">' + PRIORITY_LABELS[reco.priority] + '</span></div>' +
        '<div><strong>Variation proposée :</strong> ' + (reco.action === 'donnees_insuffisantes' || reco.action === 'maintenir' ? 'Aucune — ' + (reco.action === 'maintenir' ? 'maintien du réglage actuel' : 'donnée insuffisante') : 'Qualitative uniquement (voir justification) — Maintix ne propose jamais de nouvelle valeur chiffrée') + '</div>' +
        '<div><strong>Justification :</strong> ' + MX.esc(reco.justification) + '</div>' +
        '<div><strong>Niveau de confiance :</strong> ' + _confidenceLabel(reco) + '</div>' +
        (reco.missingData && reco.missingData.length ? '<div><strong>Données manquantes :</strong> ' + reco.missingData.map(MX.esc).join(', ') + '</div>' : '') +
        '<div class="ctavc-reco-detail-actions">' + _circuitDetailRecoActionsHtml(reco) + '</div>' +
      '</div>';
    }
    h += '</div>';

    // Contrôles à effectuer
    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-clipboard-check"></i> Contrôles à effectuer</div>';
    h += '<ul class="ctavc-check-list">' +
      '<li>Relever la température ambiante de la zone et l\'enregistrer ci-dessous.</li>' +
      (c.regulationType === 'vanne_3v' || c.regulationType === 'mixte' ? '<li>Vérifier la température de départ d\'eau réelle vs consigne affichée.</li>' : '') +
      '<li>Confirmer que le réglage noté dans cette fiche correspond bien au réglage réel sur l\'installation.</li>' +
    '</ul></div>';

    // Saisie + historique des relevés pour ce circuit
    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-thermometer-half"></i> Températures intérieures relevées (saisie manuelle)' +
      '<button class="cso-ibtn" style="margin-left:auto" onclick="MX.Pages.CtaVc._openReadingForm(\'' + c.id + '\')"><i class="fas fa-plus"></i> Relevé</button></div>';
    if (!readings.length) {
      h += '<div class="ctavc-empty-inline">Aucun relevé pour ce circuit — les relevés manuels ne sont jamais des mesures automatiques ou temps réel.</div>';
    } else {
      h += '<div class="ctavc-reading-list">';
      readings.slice(0, 15).forEach(function (r) {
        h += '<div class="ctavc-reading-row"><span class="ctavc-reading-temp">' + r.temp + ' °C</span>' +
          '<span class="ctavc-reading-date">' + _fmtDateTime(r.recordedAt) + '</span>' +
          '<span class="ctavc-reading-author">' + (r.author ? MX.esc(r.author) : '—') + '</span>' +
          (r.comment ? '<span class="ctavc-reading-comment">' + MX.esc(r.comment) + '</span>' : '') +
        '</div>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }
  function _fieldRow(label, value) {
    return '<div class="ctavc-field-row"><span class="ctavc-field-label">' + MX.esc(label) + '</span>' +
      '<span class="ctavc-field-value' + (value ? '' : ' ctavc-field-value--na') + '">' + (value ? MX.esc(String(value)) : 'Donnée non disponible') + '</span></div>';
  }

  function _confirmArchive(id, archived) {
    var msg = archived ? 'Archiver ce circuit ? Il ne sera plus proposé par le moteur de recommandation, mais ses données (relevés, historique) sont conservées.' : 'Réactiver ce circuit ?';
    if (!confirm(msg)) return;
    MX.DB.archiveHeatingCircuit(id, archived).then(function () {
      MX.toast(archived ? 'Circuit archivé' : 'Circuit réactivé');
    }).catch(function (e) { MX.toast('Erreur (permissions Firestore probablement non configurées) : ' + (e.message || e), true); });
  }

  // ════════════════════════════════════ FORMULAIRE CIRCUIT ════════════════════════════════════
  function _openCircuitForm(id) {
    _editingCircuit = id ? _circuits.find(function (c) { return c.id === id; }) : null;
    MX.showModal({
      title: _editingCircuit ? 'Modifier le circuit' : 'Nouveau circuit',
      body: _circuitFormBody(_editingCircuit || {}),
      noAutoClose: true,
      actions: [
        { label: _editingCircuit ? 'Enregistrer' : 'Créer', cls: 'primary-btn', fn: function () { _submitCircuitForm(id); } },
        { label: 'Annuler', cls: 'cancel', fn: function () { MX.closeModal(); } },
      ],
    });
    setTimeout(function () { var el = document.getElementById('ctavc-f-name'); if (el) el.focus(); }, 50);
  }

  function _circuitFormBody(c) {
    var reg = c.regulationType || '';
    var h = '<div class="ctavc-form">';
    h += '<label>Nom du circuit *</label><input id="ctavc-f-name" class="fi" value="' + MX.esc(c.name || '') + '" placeholder="Ex: CTA Toiture Est" maxlength="80">';
    h += '<label>Type</label><select id="ctavc-f-type" class="fi">' +
      ['cta', 'vc', 'autre'].map(function (t) { return '<option value="' + t + '"' + (c.type === t ? ' selected' : '') + '>' + t.toUpperCase() + '</option>'; }).join('') + '</select>';
    h += '<label>Zone desservie</label><input id="ctavc-f-zone" class="fi" value="' + MX.esc(c.zone || '') + '" placeholder="Ex: Chambres étage 2">';
    h += '<label>Description (facultatif)</label><textarea id="ctavc-f-desc" class="fi" rows="2">' + MX.esc(c.description || '') + '</textarea>';

    h += '<label>Type de régulation</label><select id="ctavc-f-regtype" class="fi" onchange="MX.Pages.CtaVc._onRegTypeChange(this.value)">' +
      '<option value="">— Non renseigné —</option>' +
      Object.keys(REG_LABELS).map(function (k) { return '<option value="' + k + '"' + (reg === k ? ' selected' : '') + '>' + REG_LABELS[k] + '</option>'; }).join('') +
    '</select>';

    h += '<div id="ctavc-f-regfields">' + _regulationFieldsHtml(reg, c) + '</div>';

    h += '<label>Température cible de la zone (°C, si renseignée)</label><input id="ctavc-f-target" class="fi" type="number" step="0.5" value="' + (typeof c.targetTemp === 'number' ? c.targetTemp : '') + '">';
    h += '<label>Limites connues (facultatif)</label><input id="ctavc-f-limits" class="fi" value="' + MX.esc(c.knownLimits || '') + '" placeholder="Ex: départ eau max 55°C">';
    h += '<label>Horaires de fonctionnement (facultatif)</label><input id="ctavc-f-hours" class="fi" value="' + MX.esc(c.operatingHours || '') + '" placeholder="Ex: 6h-22h">';
    h += '<label>État de configuration</label><select id="ctavc-f-status" class="fi">' +
      Object.keys(STATUS_LABELS).map(function (k) { return '<option value="' + k + '"' + ((c.configStatus || 'a_verifier') === k ? ' selected' : '') + '>' + STATUS_LABELS[k] + '</option>'; }).join('') +
    '</select>';
    h += '</div>';
    return h;
  }

  function _regulationFieldsHtml(reg, c) {
    var h = '';
    if (reg === 'vanne_3v' || reg === 'mixte') {
      h += '<label>Consigne eau de départ (°C)</label><input id="ctavc-f-watersp" class="fi" type="number" step="0.5" value="' + (typeof c.waterSetpoint === 'number' ? c.waterSetpoint : '') + '">';
      h += '<label>Loi d\'eau / courbe de chauffe (texte libre)</label><input id="ctavc-f-waterlaw" class="fi" value="' + MX.esc(c.waterLawCurve || '') + '">';
      h += '<label>Position / ouverture de la vanne (%, si disponible)</label><input id="ctavc-f-valvepos" class="fi" type="number" min="0" max="100" value="' + (typeof c.valvePosition === 'number' ? c.valvePosition : '') + '">';
    }
    if (reg === 'consigne' || reg === 'mixte') {
      h += '<label>Nature de la consigne</label><select id="ctavc-f-setpointtype" class="fi">' +
        '<option value="">— Non précisé —</option>' +
        '<option value="ambiante"' + (c.setpointType === 'ambiante' ? ' selected' : '') + '>Température ambiante</option>' +
        '<option value="eau"' + (c.setpointType === 'eau' ? ' selected' : '') + '>Température d\'eau</option>' +
        '<option value="autre"' + (c.setpointType === 'autre' ? ' selected' : '') + '>Autre</option>' +
      '</select>';
      h += '<label>Valeur de consigne</label><input id="ctavc-f-setpointval" class="fi" type="number" step="0.5" value="' + (typeof c.setpointValue === 'number' ? c.setpointValue : '') + '">';
    }
    if (reg === 'autre') {
      h += '<label>Description de la régulation</label><textarea id="ctavc-f-regdesc" class="fi" rows="2">' + MX.esc(c.regulationDescription || '') + '</textarea>';
    }
    return h;
  }

  function _onRegTypeChange(val) {
    var el = document.getElementById('ctavc-f-regfields');
    if (el) el.innerHTML = _regulationFieldsHtml(val, _editingCircuit || {});
  }

  function _numOrNull(id) {
    var el = document.getElementById(id);
    if (!el || el.value === '') return null;
    var v = parseFloat(el.value);
    return isNaN(v) ? null : v;
  }
  function _strOrNull(id) {
    var el = document.getElementById(id);
    var v = el ? el.value.trim() : '';
    return v || null;
  }

  function _submitCircuitForm(id) {
    var name = _strOrNull('ctavc-f-name');
    if (!name) { MX.toast('Le nom du circuit est obligatoire', true); return; }
    var regType = document.getElementById('ctavc-f-regtype').value || null;
    var data = {
      name: name,
      type: document.getElementById('ctavc-f-type').value,
      zone: _strOrNull('ctavc-f-zone') || '',
      description: _strOrNull('ctavc-f-desc') || '',
      regulationType: regType,
      regulationDescription: regType === 'autre' ? (_strOrNull('ctavc-f-regdesc') || '') : null,
      waterSetpoint: (regType === 'vanne_3v' || regType === 'mixte') ? _numOrNull('ctavc-f-watersp') : null,
      waterLawCurve: (regType === 'vanne_3v' || regType === 'mixte') ? (_strOrNull('ctavc-f-waterlaw') || null) : null,
      valvePosition: (regType === 'vanne_3v' || regType === 'mixte') ? _numOrNull('ctavc-f-valvepos') : null,
      setpointType: (regType === 'consigne' || regType === 'mixte') ? (document.getElementById('ctavc-f-setpointtype').value || null) : null,
      setpointValue: (regType === 'consigne' || regType === 'mixte') ? _numOrNull('ctavc-f-setpointval') : null,
      setpointUnit: (regType === 'consigne' || regType === 'mixte') ? '°C' : null,
      targetTemp: _numOrNull('ctavc-f-target'),
      knownLimits: _strOrNull('ctavc-f-limits') || '',
      operatingHours: _strOrNull('ctavc-f-hours') || '',
      configStatus: document.getElementById('ctavc-f-status').value,
      lastCheckedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: _currentUserName(),
    };
    var action = id ? MX.DB.updateHeatingCircuit(id, data) : MX.DB.addHeatingCircuit(Object.assign({ createdBy: _currentUserName() }, data));
    action.then(function () {
      MX.closeModal();
      MX.toast(id ? 'Circuit mis à jour' : 'Circuit créé');
    }).catch(function (e) {
      MX.toast('Erreur d\'enregistrement (permissions Firestore probablement non configurées) : ' + (e.message || e), true);
    });
  }

  // ════════════════════════════════════ FORMULAIRE RELEVÉ ════════════════════════════════════
  function _openReadingForm(circuitId) {
    var c = _circuits.find(function (x) { return x.id === circuitId; });
    var now = new Date();
    var nowLocal = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') +
      'T' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    var body = '<div class="ctavc-form">' +
      '<label>Circuit / zone</label><div class="ctavc-form-static">' + MX.esc(c ? c.name + (c.zone ? ' — ' + c.zone : '') : '—') + '</div>' +
      '<label>Température relevée (°C) *</label><input id="ctavc-r-temp" class="fi" type="number" step="0.1" placeholder="Ex: 19.5">' +
      '<label>Date et heure du relevé *</label><input id="ctavc-r-datetime" class="fi" type="datetime-local" value="' + nowLocal + '">' +
      '<label>Commentaire (facultatif)</label><input id="ctavc-r-comment" class="fi" placeholder="Ex: fenêtre entrouverte">' +
    '</div>';
    MX.showModal({
      title: 'Relevé de température', sub: c ? c.name : '', body: body, noAutoClose: true,
      actions: [
        { label: 'Enregistrer', cls: 'primary-btn', fn: function () { _submitReadingForm(circuitId); } },
        { label: 'Annuler', cls: 'cancel', fn: function () { MX.closeModal(); } },
      ],
    });
    setTimeout(function () { var el = document.getElementById('ctavc-r-temp'); if (el) el.focus(); }, 50);
  }
  function _submitReadingForm(circuitId) {
    var temp = _numOrNull('ctavc-r-temp');
    if (temp === null) { MX.toast('Température obligatoire', true); return; }
    var dtEl = document.getElementById('ctavc-r-datetime');
    var recordedAt = dtEl && dtEl.value ? new Date(dtEl.value) : new Date();
    var c = _circuits.find(function (x) { return x.id === circuitId; });
    MX.DB.addHeatingReading({
      circuitId: circuitId,
      zone: c ? (c.zone || '') : '',
      temp: temp,
      recordedAt: recordedAt.toISOString(),
      author: _currentUserName(),
      comment: _strOrNull('ctavc-r-comment') || '',
    }).then(function () {
      MX.closeModal();
      MX.toast('Relevé enregistré');
    }).catch(function (e) {
      MX.toast('Erreur d\'enregistrement (permissions Firestore probablement non configurées) : ' + (e.message || e), true);
    });
  }

  // ════════════════════════════════════ RECOMMANDATIONS ════════════════════════════════════
  function _recommendationsHtml() {
    var live = _ensureLiveRecos().filter(function (r) { return r.action !== 'maintenir'; });
    var h = '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-wand-magic-sparkles"></i> Candidats calculés maintenant' +
      '<button class="cso-ibtn" style="margin-left:auto" onclick="MX.Pages.CtaVc._refreshLiveRecos()"><i class="fas fa-rotate"></i> Recalculer</button></div>';
    if (!_weatherSeries) {
      h += '<div class="ctavc-empty-inline">Météo en cours de chargement…</div>';
    } else if (!live.length) {
      h += '<div class="ctavc-empty-inline">Rien à signaler sur les circuits actifs pour le moment.</div>';
    } else {
      h += '<div class="ctavc-reco-list">';
      live.forEach(function (r) {
        h += _liveRecoRow(r);
      });
      h += '</div>';
    }
    h += '</div>';

    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-clock-rotate-left"></i> Suivi & décisions' +
      '<span class="ctavc-hint-inline"> (y compris "à examiner", en attente d\'une décision)</span></div>';
    if (!_recommendations.length) {
      h += '<div class="ctavc-empty-inline">Aucune recommandation enregistrée pour le moment.</div>';
    } else {
      h += '<div class="ctavc-reco-list">';
      _recommendations.slice(0, 50).forEach(function (r) { h += _persistedRecoRow(r); });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }
  function _refreshLiveRecos() { _liveRecos = null; render(); }

  // Retrouve le document Firestore 'a_examiner' correspondant à un candidat
  // live (même circuit + même action) — c'est CE document, pas le candidat
  // en mémoire, qui est décidé (voir _decideReco). Tant qu'il n'existe pas
  // encore (écriture en cours) ou que sa dernière tentative a échoué, aucune
  // décision n'est possible depuis la vue "live" — jamais de double
  // document pour le même candidat.
  function _matchingAExaminer(r) {
    return _recommendations.find(function (x) { return x.circuitId === r.circuitId && x.action === r.action && x.status === 'a_examiner'; });
  }
  function _liveRecoActionsHtml(r) {
    var key = r.circuitId + '|' + r.action;
    var persisted = _matchingAExaminer(r);
    if (persisted) {
      return '<div class="ctavc-reco-row-actions">' +
        '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._decideReco(\'' + persisted.id + '\',\'acceptee\')" title="Accepter"><i class="fas fa-check"></i></button>' +
        '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._decideReco(\'' + persisted.id + '\',\'refusee\')" title="Refuser"><i class="fas fa-xmark"></i></button>' +
      '</div>';
    }
    if (_aExaminerInFlight[key]) {
      return '<div class="ctavc-reco-row-pending">Enregistrement en cours…</div>';
    }
    if (_aExaminerSyncError[key]) {
      return '<div class="ctavc-reco-row-actions"><button class="cso-ibtn" onclick="MX.Pages.CtaVc._retrySyncReco(\'' + r.circuitId + '\',\'' + r.action + '\')" title="Réessayer l\'enregistrement"><i class="fas fa-rotate"></i> Réessayer</button></div>';
    }
    // Ni actif, ni en cours d'écriture, ni en erreur : soit la
    // synchronisation n'a pas encore démarré pour cette occurrence, soit une
    // décision existe déjà pour ce couple circuit+action (évite d'offrir une
    // 2e décision sur un candidat déjà tranché tant que le cache des
    // candidats live n'a pas été recalculé — voir _ensureLiveRecos).
    var last = _recommendations.find(function (x) { return x.circuitId === r.circuitId && x.action === r.action; });
    if (last && last.status !== 'a_examiner') {
      return '<div class="ctavc-reco-row-pending">' + (RECO_STATUS_LABELS[last.status] || last.status) + ' — voir "Décisions enregistrées"</div>';
    }
    return '<div class="ctavc-reco-row-pending">Enregistrement en cours…</div>';
  }
  function _liveRecoRow(r) {
    return '<div class="ctavc-reco-row">' +
      '<span class="ctavc-pill ctavc-pill--' + r.priority + '">' + PRIORITY_LABELS[r.priority] + '</span>' +
      '<div class="ctavc-reco-row-body">' +
        '<div class="ctavc-reco-row-title">' + MX.esc(_circuitName(r.circuitId)) + ' — ' + MX.esc(r.title) + '</div>' +
        '<div class="ctavc-reco-row-just">' + MX.esc(r.justification) + '</div>' +
        (r.missingData && r.missingData.length ? '<div class="ctavc-reco-row-missing">Données manquantes : ' + r.missingData.map(MX.esc).join(', ') + '</div>' : '') +
      '</div>' +
      _liveRecoActionsHtml(r) +
    '</div>';
  }
  function _persistedRecoRow(r) {
    var h = '<div class="ctavc-reco-row">' +
      '<span class="ctavc-pill ctavc-pill--' + (r.priority || 'basse') + '">' + (PRIORITY_LABELS[r.priority] || '—') + '</span>' +
      '<div class="ctavc-reco-row-body">' +
        '<div class="ctavc-reco-row-title">' + MX.esc(_circuitName(r.circuitId)) + ' — ' + MX.esc(r.title || r.action || '') +
          ' <span class="ctavc-status-tag ctavc-status-tag--' + r.status + '">' + (RECO_STATUS_LABELS[r.status] || r.status) + '</span></div>' +
        '<div class="ctavc-reco-row-just">' + MX.esc(r.justification || '') + '</div>' +
        '<div class="ctavc-reco-row-meta">Créée ' + _fmtDateTime(r.createdAt) + (r.decidedBy ? ' · décidée par ' + MX.esc(r.decidedBy) : '') + (r.appliedBy ? ' · appliquée par ' + MX.esc(r.appliedBy) : '') + '</div>' +
      '</div>';
    if (r.status === 'a_examiner') {
      h += '<div class="ctavc-reco-row-actions">' +
        '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._decideReco(\'' + r.id + '\',\'acceptee\')" title="Accepter"><i class="fas fa-check"></i></button>' +
        '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._decideReco(\'' + r.id + '\',\'refusee\')" title="Refuser"><i class="fas fa-xmark"></i></button>' +
      '</div>';
    } else if (r.status === 'acceptee') {
      h += '<div class="ctavc-reco-row-actions"><button class="cso-ibtn" onclick="MX.Pages.CtaVc._markApplied(\'' + r.id + '\')" title="Confirmer l\'application réelle"><i class="fas fa-screwdriver-wrench"></i> Appliquée</button></div>';
    }
    h += '</div>';
    return h;
  }

  // Transition d'une recommandation déjà persistée (statut 'a_examiner')
  // vers une décision humaine — n'écrit JAMAIS un nouveau document : c'est
  // le même document qui passe de 'a_examiner' à 'acceptee'/'refusee', pour
  // qu'il n'existe jamais deux entrées Firestore pour le même candidat.
  function _decideReco(id, status) {
    MX.DB.setHeatingRecommendationStatus(id, status, _currentUserName()).then(function () {
      MX.toast(status === 'acceptee' ? 'Recommandation acceptée' : 'Recommandation refusée');
    }).catch(function (e) {
      MX.toast('Erreur d\'enregistrement (permissions Firestore probablement non configurées) : ' + (e.message || e), true);
    });
  }
  function _markApplied(id) {
    if (!confirm('Confirmer que ce réglage a réellement été appliqué sur l\'installation ?')) return;
    MX.DB.setHeatingRecommendationStatus(id, 'appliquee', _currentUserName(), { appliedAt: firebase.firestore.FieldValue.serverTimestamp(), appliedBy: _currentUserName() }).then(function () {
      MX.toast('Marquée comme appliquée');
    }).catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }

  // ════════════════════════════════════ HISTORIQUE & ANALYSE ════════════════════════════════════
  function _historyHtml() {
    var h = '';
    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-cloud-sun"></i> Températures extérieures & DJU19</div>';
    if (!_weatherSeries) {
      h += '<div class="ctavc-empty-inline">Météo en cours de chargement…</div>';
    } else {
      h += '<div class="ctavc-hist-table"><table><thead><tr><th>Date</th><th>Min/Max</th><th>DJU19</th><th>Statut</th></tr></thead><tbody>';
      _weatherSeries.forEach(function (d) {
        h += '<tr><td>' + d.date + '</td><td>' + (d.tMin !== null ? Math.round(d.tMin) : '—') + '° / ' + (d.tMax !== null ? Math.round(d.tMax) : '—') + '°</td>' +
          '<td>' + (d.dju19 !== null ? d.dju19.toFixed(1) : '—') + '</td>' +
          '<td><span class="ctavc-quality-tag ctavc-quality-tag--' + (d.kind === 'missing' ? 'manquant' : d.kind === 'observed' ? 'complet' : 'provisoire') + '">' +
            (d.kind === 'observed' ? 'Observé' : d.kind === 'forecast' ? 'Prévisionnel' : 'Manquant') + '</span></td></tr>';
      });
      h += '</tbody></table></div>';
      h += '<div class="ctavc-hint">Historique limité aux jours renvoyés par Open-Meteo (jusqu\'à 7 jours passés) — aucune valeur antérieure à la mise en service de ce suivi n\'est affichée ou inventée.</div>';
    }
    h += '</div>';

    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-thermometer-half"></i> Relevés de température intérieure (tous circuits)</div>';
    if (!_readings.length) {
      h += '<div class="ctavc-empty-inline">Aucun relevé enregistré.</div>';
    } else {
      h += '<div class="ctavc-hist-table"><table><thead><tr><th>Date</th><th>Circuit</th><th>Température</th><th>Auteur</th></tr></thead><tbody>';
      _readings.slice(0, 100).forEach(function (r) {
        h += '<tr><td>' + _fmtDateTime(r.recordedAt) + '</td><td>' + MX.esc(_circuitName(r.circuitId)) + '</td><td>' + r.temp + ' °C</td><td>' + (r.author ? MX.esc(r.author) : '—') + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';

    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-clock-rotate-left"></i> Historique des recommandations</div>';
    if (!_recommendations.length) {
      h += '<div class="ctavc-empty-inline">Aucune recommandation enregistrée.</div>';
    } else {
      h += '<div class="ctavc-reco-list">';
      _recommendations.slice(0, 100).forEach(function (r) { h += _persistedRecoRow(r); });
      h += '</div>';
    }
    h += '</div>';

    h += '<div class="ctavc-hint"><i class="fas fa-circle-info"></i> Aucun gain énergétique chiffré n\'est calculé ici : Maintix ne dispose d\'aucun relevé de consommation électrique fiable associé au chauffage. Les cartes ci-dessus indiquent des tendances, jamais des économies mesurées.</div>';
    return h;
  }

  // ════════════════════════════════════ CONFIGURATION ════════════════════════════════════
  function _configHtml() {
    var h = '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-sliders"></i> Paramètres généraux</div>';
    h += _fieldRow('Base DJU', (MX.Dju ? MX.Dju.BASE_TEMP : 19) + ' °C (fixe pour cette première version)');
    h += _fieldRow('Méthode DJU', 'max(0, base − température moyenne journalière estimée) — voir assets/js/utils/dju.js');
    h += _fieldRow('Source météo', 'Open-Meteo (partagée avec l\'Accueil, même configuration de localisation)');
    h += '</div>';

    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-diagram-project"></i> Circuits — création et gestion</div>';
    h += '<button class="primary-btn" style="width:auto;margin-bottom:12px" onclick="MX.Pages.CtaVc._openCircuitForm(null)"><i class="fas fa-plus"></i> Nouveau circuit</button>';
    h += '<div class="ctavc-circuit-mini-list">';
    if (!_circuits.length) {
      h += '<div class="ctavc-empty-inline">Aucun circuit créé.</div>';
    } else {
      _circuits.forEach(function (c) {
        h += '<div class="ctavc-circuit-mini">' +
          '<span class="ctavc-circuit-mini-name">' + MX.esc(c.name) + (c.archived ? ' <span class="ctavc-archived-tag">archivé</span>' : '') + '</span>' +
          '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._openCircuitForm(\'' + c.id + '\')"><i class="fas fa-pen"></i></button>' +
          '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._confirmArchive(\'' + c.id + '\', ' + (!c.archived) + ')"><i class="fas fa-box-archive"></i></button>' +
        '</div>';
      });
    }
    h += '</div></div>';
    return h;
  }

  // ── ENTRY POINT + EXPORT ──
  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.CtaVc = {
    render: render, _destroy: _destroy, _setTab: _setTab,
    _toggleShowArchived: _toggleShowArchived, _openCircuitDetail: _openCircuitDetail,
    _openCircuitForm: _openCircuitForm, _submitCircuitForm: _submitCircuitForm, _onRegTypeChange: _onRegTypeChange,
    _confirmArchive: _confirmArchive,
    _openReadingForm: _openReadingForm, _submitReadingForm: _submitReadingForm,
    _refreshLiveRecos: _refreshLiveRecos, _decideReco: _decideReco, _retrySyncReco: _retrySyncReco, _markApplied: _markApplied,
  };
})();
