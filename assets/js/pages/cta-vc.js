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
  // heating_recommendations, weather_daily — règles présentes dans
  // firestore.rules (voir ce fichier pour l'état réel et son historique :
  // permissives à dessein pour la V1, à revoir avant une ouverture plus
  // large). Si ces règles venaient à être resserrées en production SANS que
  // cette page soit rechargée, un onSnapshot déjà actif qui recevrait une
  // erreur (ex. permission-denied) ne redémarre JAMAIS seul — voir
  // _subscribe() ci-dessous, qui gère ce cas (une reconnexion automatique,
  // puis un message explicite si elle échoue aussi) plutôt que de laisser
  // la page figée silencieusement. Voir aussi _fsError dans db.js pour le
  // log console technique correspondant.
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

  // ── REFONTE CTA/VC — état additionnel (v2, quantitatif) ──
  // _heatingConfig : config/heating_config (référence DJU configurable,
  // bornes CTA/VC par défaut) — {} tant que non chargé/non créé, jamais
  // null (évite une vérification supplémentaire à chaque lecture).
  var _heatingConfig = {};
  var _liveProposals = null; // candidats quantitatifs calculés en mémoire (mode 'observation'|'proposition'|'exclu'), jamais persistés tant que non explicitement créés par un humain (voir _createProposal)
  // REFONTE CTA/VC Phase 3 — filtres additifs : circuitId (sélection précise
  // d'une installation, en complément de buildingId/type déjà existants),
  // roomId (zone thermique — heating_rooms, heating_readings contenant les
  // deux, distinguées par roomId XOR circuitId, voir db.js:addRoomReading).
  // Un relevé de zone n'a ni "type" (cta/vc/autre, propriété du CIRCUIT) ni
  // circuitId propre — ces filtres s'excluent donc naturellement pour les
  // relevés de zone (_matchesReadingFilters).
  //
  // CORRECTION (vérification demandée par l'utilisateur) : measureType
  // avait d'abord été implémenté comme un doublon installation/zone — déjà
  // couvert par circuitId/roomId ci-dessus. Le vrai "type de mesure" présent
  // dans les données est la STRUCTURE du relevé lui-même, réellement
  // existante pour les circuits CTA/VC (voir _submitReadingForm) :
  // 'simple' (r.temp, une seule valeur) vs 'deux_points' (r.points.point1
  // ET point2, réseau CTA/VC). Une zone n'a jamais que la forme simple
  // (addRoomReading n'écrit jamais points) — fait réel, pas une exclusion
  // inventée. Indépendant de circuitId/roomId (filtres combinables).
  var _historyFilters = { buildingId: '', circuitId: '', roomId: '', type: '', measureType: '', period: '30' }; // '' = tous
  // Comparaison deux périodes (acceptation Phase 3) : désactivée par défaut
  // — n'affecte jamais le tableau/graphique existants (period ci-dessus),
  // seulement un bloc additionnel de 2 panneaux de statistiques
  // (computeReadingStats), sur le même jeu filtré (bâtiment/circuit/zone/
  // type de mesure), jamais une 2e requête Firestore.
  var _historyCompareEnabled = false;
  var _historyCompareDaysA = 7;
  var _historyCompareDaysB = 30;
  // REFONTE CTA/VC Phase 4 — état des sections repliables (onglet
  // Configuration + fiche circuit détaillée). Non persistant entre
  // sessions (réinitialisé à l'ouverture de la page), conformément au
  // critère d'acceptation du plan ("pas nécessairement persistant") —
  // seulement conservé PENDANT la session via ce module-state, réappliqué
  // à chaque rendu. Toutes les sections touchées par un test existant
  // (page.fill/page.click Playwright natif, sensible à la visibilité)
  // restent ouvertes par défaut ; seule "advanced" (limites eau de
  // batterie CTA, jamais testée directement) est fermée par défaut, pour
  // un vrai gain de compacité sans aucun risque de régression.
  var _ctaVcSectionsOpen = { general: true, advanced: false, circuitsMgmt: true, detailFields: true, detailAdvice: true, detailControls: true, detailReadings: true };
  // CONFIGURATION THERMIQUE — bâtiments créés/configurés depuis l'interface
  // (jamais 'batiment_1'/'batiment_2' codés en dur, voir
  // assets/js/pages/heating-config.js pour la gestion complète).
  var _buildings = [];
  var _rooms = [];
  var _curvePoints = [];
  function _buildingsById() { var m = {}; _buildings.forEach(function (b) { m[b.id] = b; }); return m; }
  function _buildingLabel(id) {
    if (!id) return null;
    var b = _buildingsById()[id];
    if (!b) return 'Bâtiment supprimé';
    return b.name + (b.mode === 'automatique' ? ' (régulation automatique)' : ' (pilotage manuel)');
  }
  var PROP_STATUS_LABELS = {
    proposition_generee: 'Proposition générée', validee: 'Validée', reglage_effectue: 'Réglage effectué',
    consigne_confirmee: 'Consigne confirmée', controle_effectue: 'Contrôle effectué',
    refusee: 'Refusée', reportee: 'Reportée', expiree: 'Expirée',
  };

  // ── Utilitaires locaux ──
  // Europe/Paris explicite (MX.Dju.parisDateStr), PAS le fuseau local de
  // l'appareil — cette valeur sert de référence "aujourd'hui" à
  // MX.Dju.buildDailySeries ci-dessous (observé/prévisionnel) ET à
  // MX.HeatingEngine.evaluateAll (tendance météo, recommandations) : un
  // appareil réglé sur un autre fuseau que celui de l'établissement pouvait
  // auparavant produire une série DJU et des recommandations incohérentes
  // avec celles de l'Accueil (assets/js/pages/home.js, même bug, même
  // correction) — voir assets/js/utils/dju.js pour le détail.
  function _todayStr() {
    if (window.MX.Dju && MX.Dju.parisDateStr) return MX.Dju.parisDateStr();
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function _currentUserName() {
    var cu = MX.state.currentUser, ad = MX.state.adminUser;
    if (cu) return cu.name;
    if (ad) return (ad.email || 'admin').split('@')[0];
    return 'Inconnu';
  }
  // Droits de "pilotage" (gestion des circuits, de la configuration et des
  // décisions sur les recommandations) : réservés aux responsables et
  // administrateurs — MX.Auth.canSeeAll() est le même contrôle déjà utilisé
  // partout ailleurs dans l'app pour cette distinction. Un technicien peut
  // consulter le module et enregistrer des relevés (voir _openReadingForm/
  // _submitReadingForm, jamais gardés par _canManage), mais aucune action de
  // pilotage. Vérifié à CHAQUE action sensible (pas seulement à l'affichage
  // du bouton) : un appel direct via la console ne contourne rien côté
  // client — voir aussi firestore.rules pour les limites réelles de cette
  // protection (purement côté client tant que le rôle PIN n'est pas
  // vérifiable côté serveur).
  function _canManage() { return !!(window.MX.Auth && MX.Auth.canSeeAll && MX.Auth.canSeeAll()); }
  function _denyManage() { MX.toast('Action réservée aux responsables et administrateurs', true); }
  function _r1(v) { return Math.round(v * 10) / 10; }
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
  // CORRECTIF (REFONTE CTA/VC) : un relevé peut désormais être soit
  // l'ancienne forme à 1 point (r.temp), soit la nouvelle forme à 2 points
  // (r.points.point1/point2, sans jamais de champ r.temp) — tout affichage
  // qui lisait directement r.temp affichait littéralement "undefined" pour
  // un relevé 2 points. Centralisé ici pour n'avoir qu'un seul endroit à
  // maintenir si une 3e forme apparaissait un jour.
  function _readingTempLabel(r) {
    if (!r) return null;
    if (typeof r.temp === 'number') return r.temp + '°C';
    if (r.points && r.points.point1 && r.points.point2) {
      var avg = (r.points.point1.waterTemp + r.points.point2.waterTemp) / 2;
      return (Math.round(avg * 10) / 10) + '°C eau (moy. P1/P2)';
    }
    return '—';
  }

  // REFONTE CTA/VC Phase 6 — CORRECTION CRITIQUE : cette page partage la
  // MÊME collection heating_circuits qu'assets/js/pages/heating-config.js,
  // qui propose déjà le type 'reseau_chauffage' dans son formulaire. Avant
  // cette correction, le <select> de type ci-dessous (et le filtre
  // Historique/Vue d'ensemble) ne listaient que cta/vc/autre : ouvrir puis
  // enregistrer depuis CETTE page une installation 'reseau_chauffage'
  // créée depuis Configuration thermique convertissait SILENCIEUSEMENT son
  // type en 'cta' (aucune <option> sélectionnée -> le navigateur retombe
  // sur la première option du <select>). TYPE_LABELS centralise désormais
  // le même vocabulaire que heating-config.js:TYPE_LABELS, pour que les
  // deux formulaires restent interchangeables sur un même document.
  // 'reseau_chauffage' reste volontairement HORS du moteur de propositions
  // chiffrées (voir les gardes type==='cta'||type==='vc' plus bas,
  // inchangées) — ce n'est qu'une correction d'affichage/saisie, jamais un
  // changement de calcul.
  var TYPE_LABELS = { cta: 'CTA', vc: 'VC', reseau_chauffage: 'Réseau de chauffage', autre: 'Autre' };
  var REG_LABELS = { vanne_3v: 'Vanne 3 voies', consigne: 'Consigne', mixte: 'Mixte', autre: 'Autre' };
  var STATUS_LABELS = { configure: 'Configuré', incomplet: 'Incomplet', a_verifier: 'À vérifier' };
  var RECO_STATUS_LABELS = { a_examiner: 'À examiner', acceptee: 'Acceptée', refusee: 'Refusée', appliquee: 'Appliquée', expiree: 'Expirée' };
  var PRIORITY_LABELS = { haute: 'Haute', moyenne: 'Moyenne', basse: 'Basse' };

  // ── Reconnexion automatique après une erreur d'écoute Firestore ──
  // Un onSnapshot qui reçoit une erreur (ex. permission-denied) est détaché
  // DÉFINITIVEMENT par le SDK Firestore — il ne redémarre jamais seul, même
  // après correction des règles côté serveur. Sans ceci, un circuit/relevé/
  // recommandation créé avec succès APRÈS une telle erreur (ex. règles
  // corrigées entre-temps) n'apparaîtrait jamais dans cette page tant
  // qu'elle ne serait pas quittée puis rouverte (seul autre moment où
  // _subscribe() réattache réellement, via _destroy()). _resubscribeAttempted
  // borne à UNE seule tentative automatique (anti-boucle si l'erreur n'est
  // pas transitoire) ; remis à zéro dès qu'un listener reçoit à nouveau un
  // snapshot valide, pour autoriser une nouvelle tentative lors d'un futur
  // incident distinct.
  var _resubscribeAttempted = false;
  function _handleListenerError(label) {
    return function () {
      _destroy(); // coupe les 3 abonnements (même morts) et réinitialise _subscribed
      if (_resubscribeAttempted) {
        MX.toast('Connexion au module CTA/VC interrompue (' + label + ') — rechargez la page pour la rétablir.', true);
        return;
      }
      _resubscribeAttempted = true;
      MX.toast('Connexion au module CTA/VC interrompue, reconnexion…', true);
      setTimeout(function () {
        _subscribe();
        if (MX.state.currentPage === 'cta-vc') render();
      }, 1500);
    };
  }

  // ── Abonnements Firestore (une seule fois, tant que la page n'est pas quittée) ──
  function _subscribe() {
    if (_subscribed) return;
    _subscribed = true;
    if (!MX.DB) return;
    _unsub.circuits = MX.DB.listenHeatingCircuits(function (list) {
      // CORRECTIF : _liveProposals (candidats v2) doit être invalidé ici au
      // même titre que _liveRecos (v1) — sans cela, un nouveau circuit ou un
      // changement de circuit (ex. buildingId, vcMaxTemp) n'est JAMAIS pris
      // en compte par le moteur quantitatif une fois son premier calcul
      // effectué (même bug que _liveRecos aurait eu sans cette ligne).
      _circuits = list; _liveRecos = null; _liveProposals = null; _resubscribeAttempted = false;
      if (MX.state.currentPage === 'cta-vc') render();
    }, _handleListenerError('circuits'));
    _unsub.readings = MX.DB.listenHeatingReadings(function (list) {
      // Même correctif : un nouveau relevé (notamment le relevé à 2 points
      // qui déclenche une proposition v2) doit invalider _liveProposals,
      // sinon "Nouveau relevé" n'aurait jamais d'effet sur une proposition
      // déjà calculée (y compris le tout premier calcul, effectué AVANT que
      // la météo soit chargée — voir _computeLiveProposals, qui renvoie []
      // tant que _weatherSeries est absent : sans cette invalidation, ce []
      // restait mis en cache indéfiniment même une fois la météo chargée).
      _readings = list; _liveRecos = null; _liveProposals = null; _resubscribeAttempted = false;
      if (MX.state.currentPage === 'cta-vc') render();
    }, _handleListenerError('relevés'));
    _unsub.recos = MX.DB.listenHeatingRecommendations(function (list) {
      _recommendations = list; _resubscribeAttempted = false;
      _expireStaleRecommendations(list);
      if (MX.state.currentPage === 'cta-vc') render();
    }, _handleListenerError('recommandations'));
    if (MX.DB.listenHeatingConfig) {
      _unsub.heatingConfig = MX.DB.listenHeatingConfig(function (cfg) {
        var prevBase = _effectiveDjuBaseTemp();
        _heatingConfig = cfg || {}; _liveProposals = null;
        // Référence DJU changée : la série météo déjà chargée a été calculée
        // à l'ANCIENNE référence (voir _ensureWeather) — on la rejette pour
        // forcer un nouveau calcul (pas de nouvel appel réseau Open-Meteo :
        // la mise en cache ne porte que sur la série dérivée, jamais sur la
        // donnée brute, qui est re-demandée — acceptable, un changement de
        // référence DJU est une action rare, pas un rafraîchissement fréquent).
        if (_effectiveDjuBaseTemp() !== prevBase) _weatherSeries = null;
        if (MX.state.currentPage === 'cta-vc') render();
      }, _handleListenerError('configuration chauffage'));
    }
    // CONFIGURATION THERMIQUE — bâtiments/zones thermiques/courbes. Invalide
    // _liveRecos/_liveProposals au même titre que circuits/relevés : le
    // mode d'un bâtiment (automatique/manuel) ou son existence même change
    // directement l'éligibilité d'un circuit aux propositions MX.
    if (MX.DB.listenHeatingBuildings) {
      _unsub.buildings = MX.DB.listenHeatingBuildings(function (list) {
        _buildings = list; _liveRecos = null; _liveProposals = null;
        if (MX.state.currentPage === 'cta-vc') render();
      }, _handleListenerError('bâtiments'));
    }
    if (MX.DB.listenHeatingRooms) {
      _unsub.rooms = MX.DB.listenHeatingRooms(function (list) {
        _rooms = list;
        if (MX.state.currentPage === 'cta-vc') render();
      }, _handleListenerError('zones thermiques'));
    }
    if (MX.DB.listenHeatingCurvePoints) {
      _unsub.curvePoints = MX.DB.listenHeatingCurvePoints(function (list) {
        _curvePoints = list;
        if (MX.state.currentPage === 'cta-vc') render();
      }, _handleListenerError('courbes thermiques'));
    }
  }
  // djuBaseTemp effectif : config/heating_config.djuBaseTemp si réglé, sinon
  // MX.Dju.BASE_TEMP (19) — jamais une autre valeur inventée ici.
  function _effectiveDjuBaseTemp() {
    return (typeof _heatingConfig.djuBaseTemp === 'number' && !isNaN(_heatingConfig.djuBaseTemp)) ? _heatingConfig.djuBaseTemp : (MX.Dju ? MX.Dju.BASE_TEMP : 19);
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
        _weatherSeries = MX.Dju.buildDailySeries(raw.daily, _todayStr(), _effectiveDjuBaseTemp());
        _weatherStatus = 'ok';
        // CORRECTIF : si un premier rendu a eu lieu AVANT que la météo soit
        // chargée (circuits/relevés déjà reçus, render() déjà appelé une
        // fois), _liveRecos/_liveProposals ont pu être mis en cache comme
        // [] (voir _computeLiveRecos/_computeLiveProposals, qui renvoient []
        // tant que _weatherSeries est absent) — sans invalidation ICI aussi,
        // ce [] resterait mis en cache indéfiniment malgré une météo
        // désormais disponible, même avec l'invalidation déjà présente dans
        // les listeners circuits/relevés (qui ne se redéclenchent pas tant
        // que les données elles-mêmes ne changent pas).
        _liveRecos = null; _liveProposals = null;
        if (MX.state.currentPage === 'cta-vc') render();
      });
    }
  }

  // ── ENTRY POINT ──
  function render() {
    // Onglet de départ demandé depuis la sidebar (groupe accordéon "CTA /
    // VC", voir app.js:showCtaVcTab) — même mécanisme que showCsoTab pour
    // Analyses. Consommé une seule fois, jamais relu après.
    if (window._ctavcStartTab) { _tab = window._ctavcStartTab; window._ctavcStartTab = null; }
    _subscribe();
    _ensureWeather();
    var mc = document.getElementById('main-content');
    if (!mc) return;
    mc.innerHTML = _html();
  }

  function _setTab(tab) { _tab = tab; _circuitDetailId = null; render(); }

  function _html() {
    // Défense en profondeur : si l'onglet "config" était actif (ex. session
    // rouverte après un changement de rôle) mais que le rôle courant n'a
    // plus les droits de pilotage, on retombe sur "overview" plutôt que de
    // rendre _configHtml() — qui se protège de toute façon elle-même, mais
    // autant ne pas y arriver du tout.
    if (_tab === 'config' && !_canManage()) _tab = 'overview';
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
    ];
    // Onglet "Configuration" = gestion des circuits + réglages, réservé au
    // pilotage. Rien d'autre n'y est utile à un technicien (la liste des
    // circuits est déjà consultable en lecture seule depuis l'onglet
    // "Circuits") — mieux vaut ne pas l'afficher plutôt qu'un onglet vide
    // de boutons désactivés.
    if (_canManage()) tabs.push({ id: 'config', l: 'Configuration', icon: 'fa-sliders' });
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
    return MX.HeatingEngine.evaluateAll(_circuits, _readings, _weatherSeries, Date.now(), _todayStr(), _buildingsById());
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
    // CORRECTION 1 : un candidat manualAction:false (bâtiment automatique —
    // voir MX.HeatingEngine.evaluateCircuit) n'est JAMAIS synchronisé comme
    // 'a_examiner' — il n'y a aucune décision de réglage à prendre, donc
    // aucun document "à examiner" à créer pour lui.
    var live = (_liveRecos || []).filter(function (r) { return r.action !== 'maintenir' && r.manualAction !== false; });
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

  // ── REFONTE CTA/VC — candidats quantitatifs (v2) ──
  // Même idiome que _computeLiveRecos/_ensureLiveRecos/
  // _syncActionableRecosToFirestore ci-dessus (v1), pour le moteur
  // quantitatif : un candidat en mode 'proposition' calculé en mémoire est
  // persisté UNE SEULE FOIS par circuit comme 'proposition_generee' (tant
  // qu'aucune proposition v2 n'est déjà active pour ce circuit), puis c'est
  // ce document (jamais le candidat en mémoire) qui avance dans le cycle de
  // validation. Les modes 'observation'/'exclu' ne sont JAMAIS persistés
  // (rien à décider).
  var _propInFlight = {};
  function _computeLiveProposals() {
    if (!MX.HeatingEngine || !MX.HeatingEngine.proposeAllQuantitative || !_weatherSeries) return [];
    return MX.HeatingEngine.proposeAllQuantitative(_circuits, _readings, _weatherSeries, _heatingConfig, Date.now(), _todayStr(), _buildingsById());
  }
  function _ensureLiveProposals() {
    if (_liveProposals === null) {
      _liveProposals = _computeLiveProposals();
      _syncProposalsToFirestore();
    }
    return _liveProposals;
  }
  function _syncProposalsToFirestore() {
    if (!MX.DB || !MX.DB.addHeatingProposal) return;
    (_liveProposals || []).filter(function (p) { return p.mode === 'proposition'; }).forEach(function (p) {
      if (_propInFlight[p.circuitId]) return;
      var activeOrInProgress = _recommendations.some(function (x) {
        return x.circuitId === p.circuitId && x.engineVersion === 'v2' &&
          ['proposition_generee', 'validee', 'reglage_effectue', 'consigne_confirmee'].indexOf(x.status) !== -1;
      });
      if (activeOrInProgress) return;
      _propInFlight[p.circuitId] = true;
      MX.DB.addHeatingProposal({
        circuitId: p.circuitId, confidence: p.confidence,
        current: p.current, proposed: p.proposed, dataUsed: p.dataUsed || {},
        justification: p.justification,
      }).then(function () {
        delete _propInFlight[p.circuitId];
        if (MX.state.currentPage === 'cta-vc') render();
      }).catch(function (e) {
        delete _propInFlight[p.circuitId];
        console.warn('[CTA/VC] Échec enregistrement proposition v2 pour ' + p.circuitId + ' :', e);
      });
    });
  }
  function _matchingProposal(circuitId, statuses) {
    return _recommendations.find(function (x) {
      return x.circuitId === circuitId && x.engineVersion === 'v2' && statuses.indexOf(x.status) !== -1;
    });
  }

  function _pointCardHtml(label, point) {
    if (!point) return '';
    return '<div class="ctavc-point-card"><div class="ctavc-point-label">' + MX.esc(label) + '</div>' +
      '<div class="ctavc-point-row">Eau <strong>' + point.waterTemp + '°C</strong></div>' +
      '<div class="ctavc-point-row">Soufflage <strong>' + point.blowTemp + '°C</strong></div>' +
      '<div class="ctavc-point-row">Ambiante <strong>' + point.ambientTemp + '°C</strong></div></div>';
  }

  // Boutons d'action pour UNE proposition v2 donnée, selon son statut réel
  // persisté (jamais selon le seul candidat en mémoire) — reflète le cycle
  // à 5 états : décision (Valider/Programmer/Refuser, Responsable/Admin) ou
  // action physique (technicien, tout rôle vérifié).
  function _proposalActionsHtml(c, prop) {
    var h = '<div class="ctavc-reco-row-actions">';
    var pGen = _matchingProposal(c.id, ['proposition_generee']);
    var pVal = _matchingProposal(c.id, ['validee']);
    var pReg = _matchingProposal(c.id, ['reglage_effectue']);
    var pConf = _matchingProposal(c.id, ['consigne_confirmee']);
    if (pGen) {
      if (_canManage()) {
        h += '<button class="primary-btn" style="width:auto" onclick="MX.Pages.CtaVc._validateProposal(\'' + pGen.id + '\')">Valider</button>' +
          '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._openReportForm(\'' + pGen.id + '\')">Programmer</button>' +
          '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._refuseProposal(\'' + pGen.id + '\')">Refuser</button>';
      } else {
        h += '<span class="ctavc-reco-row-pending">Proposition en attente de décision (Responsable/Admin)</span>';
      }
    } else if (pVal) {
      h += '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._openApplyForm(\'' + pVal.id + '\')"><i class="fas fa-screwdriver-wrench"></i> Réglage effectué</button>';
    } else if (pReg) {
      h += '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._openConfirmSetpointForm(\'' + pReg.id + '\')"><i class="fas fa-check-double"></i> Confirmer la consigne réelle</button>';
    } else if (pConf) {
      h += '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._openControlReadingForm(\'' + pConf.id + '\', \'' + c.id + '\')"><i class="fas fa-clipboard-check"></i> Relevé de contrôle</button>';
    }
    h += '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._openReadingForm(\'' + c.id + '\')"><i class="fas fa-plus"></i> Nouveau relevé</button>';
    h += '</div>';
    return h;
  }

  // CORRECTION PRIORITAIRE (demande utilisateur) : la valeur affichée ici
  // est TOUJOURS déjà plafonnée par MX.HeatingEngine (jamais la valeur brute
  // hors limite) — mais le plafonnement doit être visible à l'endroit même
  // où le chiffre est montré, pas seulement dans la justification en petit
  // texte en bas de carte. `proposedObj.capped`/`.overshoot` (voir
  // heating-engine.js:clampForCircuit/_clampCtaWater) pilotent un badge
  // explicite + un message "puissance thermique possiblement insuffisante"
  // quand le besoin calculé dépasse la borne haute (overshoot).
  function _compareRowHtml(label, currentVal, proposedObj, confidence) {
    var cappedBadge = proposedObj.capped
      ? '<div class="ctavc-cap-warning"><i class="fas fa-triangle-exclamation"></i> Limite atteinte — ' + MX.esc(proposedObj.capLabel || '') + '</div>' +
        (proposedObj.overshoot ? '<div class="ctavc-cap-warning ctavc-cap-warning--power"><i class="fas fa-bolt"></i> Puissance thermique disponible possiblement insuffisante pour atteindre le besoin calculé</div>' : '')
      : '';
    return '<div class="ctavc-compare">' +
      '<div class="ctavc-compare-col"><div class="ctavc-compare-label">' + MX.esc(label) + ' — situation actuelle</div><div class="ctavc-compare-value">' + currentVal + '°C</div></div>' +
      '<div class="ctavc-compare-arrow"><i class="fas fa-arrow-right"></i></div>' +
      '<div class="ctavc-compare-col ctavc-compare-col--proposed' + (proposedObj.capped ? ' ctavc-compare-col--capped' : '') + '"><div class="ctavc-compare-label">' + MX.esc(label) + ' — proposition DJU MX' + (proposedObj.capped ? ' (plafonnée)' : '') + '</div><div class="ctavc-compare-value">' + proposedObj.value + '°C</div>' +
      cappedBadge +
      '<div class="ctavc-confidence ctavc-confidence--' + confidence + '">Confiance ' + confidence + '</div></div></div>';
  }

  function _networkCompareHtml(c, prop) {
    var h = '<div class="ctavc-network"><div class="ctavc-network-head"><span class="ctavc-circuit-type">' +
      MX.esc((c.type || '').toUpperCase()) + '</span> <span class="ctavc-network-name">' + MX.esc(c.name) + '</span></div>';
    if (!prop || prop.mode === 'exclu') {
      h += '<div class="ctavc-empty-inline">' + (prop ? MX.esc(prop.reason) : 'Calcul en attente (météo non chargée).') + '</div></div>';
      return h;
    }
    if (prop.mode === 'observation') {
      h += '<div class="ctavc-empty-inline"><i class="fas fa-eye"></i> Mode observation — ' + MX.esc(prop.justification) + '</div>' +
        _proposalActionsHtml(c, prop) + '</div>';
      return h;
    }
    // CORRECTION 2 : eau de batterie et air de soufflage sont DEUX
    // comparaisons DISTINCTES, jamais fusionnées ni l'une plafonnée par
    // l'autre — voir MX.HeatingEngine.proposeQuantitative. Un VC n'a qu'une
    // grandeur chiffrée (eau, proposed.blow toujours null) ; un CTA peut
    // avoir les deux lignes (le soufflage est toujours calculable, l'eau de
    // batterie seulement si l'installation est configurée avec ses limites).
    if (prop.proposed.blow) h += _compareRowHtml('Soufflage (air)', prop.current.blowTemp, prop.proposed.blow, prop.confidence);
    if (prop.proposed.water) h += _compareRowHtml('Eau de batterie', prop.current.waterTemp, prop.proposed.water, prop.confidence);
    else if (c.type === 'cta') h += '<div class="ctavc-empty-inline">Eau de batterie : limites techniques non configurées pour cette installation (voir Configuration thermique) — aucune proposition chiffrée pour cette grandeur.</div>';
    h += '<div class="ctavc-points">' + _pointCardHtml('Point 1', prop.current.point1) + _pointCardHtml('Point 2', prop.current.point2) + '</div>';
    h += '<div class="ctavc-just-inline">' + MX.esc(prop.justification) + '</div>';
    h += _proposalActionsHtml(c, prop);
    h += '</div>';
    return h;
  }

  // Moyenne des zones thermiques SÉLECTIONNÉES ET actives du bâtiment (voir
  // MX.HeatingEngine.computeBuildingAverageTemp) — jamais une zone non
  // sélectionnée, jamais une mesure absente/périmée traitée comme 0°C.
  function _buildingAverageHtml(building) {
    if (!MX.HeatingEngine || !MX.HeatingEngine.computeBuildingAverageTemp) return '';
    // La sélection est portée par CHAQUE zone (trackedActive, voir
    // heating_rooms) — pas par une liste séparée sur le bâtiment : "un état
    // de suivi actif ou inactif" par zone EST le mécanisme de sélection
    // multiple demandé, sans champ redondant.
    var selectedRoomIds = _rooms.filter(function (r) { return r.buildingId === building.id && r.trackedActive && !r.archived; }).map(function (r) { return r.id; });
    if (!selectedRoomIds.length) return '<div class="ctavc-empty-inline">Aucune zone thermique suivie pour ce bâtiment (Configuration thermique).</div>';
    var res = MX.HeatingEngine.computeBuildingAverageTemp(selectedRoomIds, _rooms, _readings, Date.now(), building.readingFreshnessHours);
    var h = '<div class="ctavc-field-row"><span class="ctavc-field-label">Température intérieure moyenne (' + res.sampleCount + ' zone(s))</span>' +
      '<span class="ctavc-field-value' + (res.value === null ? ' ctavc-field-value--na' : '') + '">' + (res.value !== null ? res.value + ' °C' : 'Donnée non disponible') + '</span></div>';
    if (res.excludedStale.length || res.excludedMissing.length) {
      h += '<div class="ctavc-hint-inline">' + (res.excludedStale.length ? res.excludedStale.length + ' zone(s) exclue(s) (relevé périmé)' : '') +
        (res.excludedStale.length && res.excludedMissing.length ? ' · ' : '') +
        (res.excludedMissing.length ? res.excludedMissing.length + ' zone(s) exclue(s) (aucun relevé)' : '') + '</div>';
    }
    return h;
  }

  // REFONTE CTA/VC Phase 8 — ANALYSE DJU / TEMPÉRATURE INTÉRIEURE PAR
  // BÂTIMENT, migrée à l'identique depuis assets/js/pages/heating-config.js:
  // _curveAnalysisHtml (ancien onglet "Courbes DJU / température").
  // RÉUTILISE EXACTEMENT les mêmes fonctions du moteur thermique
  // (MX.HeatingEngine.computeBuildingAverageTemp/interpolateCurve/
  // buildBuildingDailyAverageSeries/analyzeCurveDeviation), les mêmes
  // seuils de fiabilité (DJU_ANALYSIS_MIN_PARTIAL/_MIN_SUFFICIENT) et la
  // même structure de message — AUCUN calcul parallèle, AUCUNE alerte
  // forte tant que les données sont insuffisantes (règle inchangée).
  // Les points de courbe (_curvePoints, déjà abonnés ligne ~288-290 pour
  // computeOverviewIndicators) sont filtrés ici par bâtiment — pas un
  // second abonnement Firestore, juste une lecture du tableau déjà en
  // mémoire. La météo (_weatherSeries) est elle aussi déjà chargée pour
  // toute la page (_ensureWeather, inchangé).
  function _buildingCurveAnalysisHtml(building) {
    var h = '<div class="ctavc-card-head" style="font-size:12px;margin-top:10px"><i class="fas fa-magnifying-glass-chart"></i> Analyse DJU / température intérieure</div>';
    if (_weatherStatus === 'unconfigured') { h += '<div class="ctavc-empty-inline">Localisation de l\'établissement non configurée (voir Paramètres) — DJU indisponible.</div>'; return h; }
    if (!_weatherSeries) { h += '<div class="ctavc-empty-inline">Météo en cours de chargement…</div>'; return h; }
    var selectedRoomIds = _rooms.filter(function (r) { return r.buildingId === building.id && r.trackedActive && !r.archived; }).map(function (r) { return r.id; });
    if (!selectedRoomIds.length) { h += '<div class="ctavc-empty-inline">Aucune zone thermique suivie pour ce bâtiment — voir l\'onglet Zones thermiques (Configuration thermique).</div>'; return h; }
    var points = _curvePoints.filter(function (p) { return p.buildingId === building.id; }).sort(function (a, b) { return a.dju - b.dju; });

    var today = _todayStr();
    var past = _weatherSeries.filter(function (d) { return d.kind === 'observed' && typeof d.dju === 'number'; });
    var next = _weatherSeries.filter(function (d) { return d.kind === 'forecast' && typeof d.dju === 'number'; });
    var todayDay = _weatherSeries.find(function (d) { return d.date === today; });
    var djuObserved = todayDay && typeof todayDay.dju === 'number' ? todayDay.dju : (past.length ? past[past.length - 1].dju : null);
    var djuForecastNext = next.length ? next[0].dju : null;

    var avgNow = MX.HeatingEngine.computeBuildingAverageTemp(selectedRoomIds, _rooms, _readings, Date.now(), building.readingFreshnessHours);
    var hasCurve = points.length >= 2;
    var expectedToday = (hasCurve && djuObserved !== null) ? MX.HeatingEngine.interpolateCurve(points, djuObserved) : null;
    var expectedNext = (hasCurve && djuForecastNext !== null) ? MX.HeatingEngine.interpolateCurve(points, djuForecastNext) : null;
    var gapToday = (avgNow.value !== null && expectedToday !== null) ? _r1(avgNow.value - expectedToday) : null;

    h += '<div class="ctavc-field-grid">' +
      _fieldRow('DJU observé (aujourd\'hui)', djuObserved !== null ? djuObserved.toFixed(1) : null) +
      _fieldRow('DJU prévisionnel (demain)', djuForecastNext !== null ? djuForecastNext.toFixed(1) : null) +
      _fieldRow('Température intérieure moyenne (' + avgNow.sampleCount + ' zone(s))', avgNow.value !== null ? avgNow.value + ' °C' : null) +
      _fieldRow('Température intérieure cible (courbe programmée au DJU du jour)', expectedToday !== null ? expectedToday + ' °C' : (hasCurve ? null : 'Courbe non programmée (2 points minimum)')) +
      _fieldRow('Écart réel à la cible', gapToday !== null ? (gapToday > 0 ? '+' : '') + gapToday + ' °C' : null) +
    '</div>';

    if (!hasCurve) { h += '<div class="ctavc-hint-inline">Programmez au moins 2 points de courbe depuis la fiche de ce bâtiment (Configuration thermique → Bâtiments) pour activer la comparaison à une température cible.</div>'; return h; }

    // Évolution sur plusieurs jours — échantillons RÉELS uniquement (jour
    // avec relevé de zone ET donnée météo disponible, jamais l'un inventé
    // pour l'autre). Identique à l'ancien module.
    var dailySeries = MX.HeatingEngine.buildBuildingDailyAverageSeries(selectedRoomIds, _rooms, _readings, 14, Date.now());
    var samples = [];
    dailySeries.points.forEach(function (p) {
      if (p.temp === null) return;
      var wd = _weatherSeries.find(function (d) { return d.date === p.date; });
      if (!wd || typeof wd.dju !== 'number') return;
      samples.push({ dju: wd.dju, actualTemp: p.temp, date: p.date });
    });
    var analysis = MX.HeatingEngine.analyzeCurveDeviation(points, samples, 1);

    if (!samples.length) {
      h += '<div class="ctavc-empty-inline">Aucun jour des 14 derniers jours ne dispose à la fois d\'un relevé de zone ET d\'une donnée météo — l\'évolution sur plusieurs jours n\'est pas encore exploitable.</div>';
      return h;
    }

    // FIABILITÉ STATISTIQUE — seuils EXPLICITES et DOCUMENTÉS (MX.
    // HeatingEngine.DJU_ANALYSIS_MIN_PARTIAL/_MIN_SUFFICIENT), inchangés.
    // Un échantillon "insuffisant" (< MIN_PARTIAL jours exploitables) ne
    // produit JAMAIS de seuil de dégradation ni d'alerte — même avec un
    // écart apparent sur 1-2 points.
    var sufficiencyLabel = { suffisant: 'Données suffisantes', partiel: 'Données partielles — confiance limitée', insuffisant: 'Données insuffisantes' }[analysis.dataSufficiency];
    var sufficiencyClass = { suffisant: 'ctavc-confidence--haute', partiel: 'ctavc-confidence--moyenne', insuffisant: 'ctavc-confidence--faible' }[analysis.dataSufficiency];
    h += '<div class="ctavc-hint-inline"><span class="ctavc-confidence ' + sufficiencyClass + '">' + sufficiencyLabel + '</span> — ' + analysis.sampleCount + ' jour(s) exploitable(s) sur 14 ' +
      '(seuils : &lt;' + MX.HeatingEngine.DJU_ANALYSIS_MIN_PARTIAL + ' = insuffisant, ' + MX.HeatingEngine.DJU_ANALYSIS_MIN_PARTIAL + '-' + (MX.HeatingEngine.DJU_ANALYSIS_MIN_SUFFICIENT - 1) + ' = partiel, ≥' + MX.HeatingEngine.DJU_ANALYSIS_MIN_SUFFICIENT + ' = suffisant).</div>';

    if (analysis.dataSufficiency === 'insuffisant') {
      h += '<div class="ctavc-empty-inline">Échantillon trop réduit (' + analysis.sampleCount + ' jour(s)) pour détecter un quelconque seuil de dégradation de façon fiable — aucune conclusion n\'est présentée tant que moins de ' + MX.HeatingEngine.DJU_ANALYSIS_MIN_PARTIAL + ' jours ne sont disponibles. Continuez à saisir des relevés pour affiner l\'analyse.</div>';
    } else if (analysis.degradationFromDju !== null) {
      var alerte = djuForecastNext !== null && djuForecastNext >= analysis.degradationFromDju;
      h += '<div class="ctavc-cap-warning' + (alerte && analysis.dataSufficiency === 'suffisant' ? ' ctavc-cap-warning--power' : '') + '"><i class="fas fa-triangle-exclamation"></i> ' +
        (analysis.dataSufficiency === 'partiel' ? '[Confiance limitée — données partielles] ' : '') +
        'Ce bâtiment commence à perdre en température à partir de DJU ' + analysis.degradationFromDju.toFixed(1) + ' (écart observé sur les relevés disponibles).' +
        (alerte ? ' Le DJU prévisionnel de demain (' + djuForecastNext.toFixed(1) + ') atteint ou dépasse ce seuil — anticipez une vérification/un réglage avant que la baisse ne devienne problématique.' : '') +
      '</div>';
    } else {
      h += '<div class="ctavc-hint-inline">Aucun seuil de dégradation détecté sur les échantillons disponibles (écarts dans la marge normale).</div>';
    }

    h += '<div class="ctavc-hist-table"><table><thead><tr><th>Date</th><th>DJU</th><th>Temp. réelle</th><th>Temp. attendue</th><th>Écart</th></tr></thead><tbody>';
    analysis.rows.slice().reverse().forEach(function (r) {
      h += '<tr' + (r.deviation <= -1 ? ' style="color:var(--orange)"' : '') + '><td>' + (r.date || '—') + '</td><td>' + r.dju.toFixed(1) + '</td><td>' + r.actualTemp + ' °C</td><td>' + r.expectedTemp + ' °C</td><td>' + (r.deviation > 0 ? '+' : '') + r.deviation + ' °C</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="ctavc-hint"><i class="fas fa-circle-info"></i> Analyse statistique simple à titre indicatif (pas un apprentissage automatique) — ' + samples.length + ' jour(s) exploitable(s) sur les 14 derniers.</div>';
    return h;
  }

  function _buildingCardsHtml() {
    var proposals = _ensureLiveProposals();
    function propFor(id) { return proposals.find(function (p) { return p.circuitId === id; }); }
    var active = _buildings.filter(function (b) { return !b.archived; });
    var h = '';
    if (!active.length) {
      h += '<div class="ctavc-card ctavc-building-card"><div class="ctavc-card-head"><i class="fas fa-building-circle-exclamation"></i> Aucun bâtiment configuré</div>' +
        '<div class="ctavc-empty-inline">Créez vos bâtiments depuis <a href="javascript:void(0)" onclick="MX.showPage(\'heating-config\')">Configuration thermique</a> pour activer le pilotage CTA/VC.</div></div>';
    }
    active.forEach(function (b) {
      var circuits = _circuits.filter(function (c) { return !c.archived && c.buildingId === b.id && (c.type === 'cta' || c.type === 'vc'); });
      h += '<div class="ctavc-card ctavc-building-card"><div class="ctavc-card-head"><i class="fas fa-building"></i> ' + MX.esc(b.name) +
        '<span class="ctavc-hint-inline"> (' + (b.mode === 'automatique' ? 'régulation automatique — surveillance uniquement' : 'pilotage manuel') + ')</span></div>';
      h += _buildingAverageHtml(b);
      if (!circuits.length) {
        h += '<div class="ctavc-empty-inline">Aucun circuit CTA/VC assigné à ce bâtiment.</div>';
      } else {
        circuits.forEach(function (c) { h += _networkCompareHtml(c, propFor(c.id)); });
      }
      h += _buildingCurveAnalysisHtml(b);
      h += '</div>';
    });
    var unassigned = _circuits.filter(function (c) { return !c.archived && !c.buildingId && (c.type === 'cta' || c.type === 'vc'); });
    if (unassigned.length) {
      h += '<div class="ctavc-card ctavc-building-card"><div class="ctavc-card-head"><i class="fas fa-building-circle-exclamation"></i> Bâtiment non assigné' +
        '<span class="ctavc-hint-inline"> (à renseigner depuis la fiche du circuit)</span></div>';
      unassigned.forEach(function (c) { h += _networkCompareHtml(c, propFor(c.id)); });
      h += '</div>';
    }
    return h;
  }

  function _validateProposal(id) {
    if (!_canManage()) { _denyManage(); return; }
    MX.DB.validateHeatingProposal(id, _currentUserName()).then(function () {
      MX.toast('Proposition validée');
    }).catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }
  function _refuseProposal(id) {
    if (!_canManage()) { _denyManage(); return; }
    if (!confirm('Refuser cette proposition ?')) return;
    MX.DB.refuseHeatingProposal(id, _currentUserName(), '').then(function () {
      MX.toast('Proposition refusée');
    }).catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }
  function _openReportForm(id) {
    if (!_canManage()) { _denyManage(); return; }
    var body = '<div class="ctavc-form"><label>Reporter à (date, facultatif)</label>' +
      '<input id="ctavc-rep-date" class="fi" type="date"></div>';
    MX.showModal({
      title: 'Programmer / reporter la proposition', body: body, noAutoClose: true,
      actions: [
        { label: 'Confirmer', cls: 'primary-btn', fn: function () {
          var d = document.getElementById('ctavc-rep-date');
          MX.DB.reportHeatingProposal(id, _currentUserName(), (d && d.value) || null).then(function () {
            MX.closeModal(); MX.toast('Proposition reportée');
          }).catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
        } },
        { label: 'Annuler', cls: 'cancel', fn: function () { MX.closeModal(); } },
      ],
    });
  }
  function _openApplyForm(id) {
    var body = '<div class="ctavc-form"><label>Valeur réellement réglée sur l\'installation (°C)</label>' +
      '<input id="ctavc-apply-val" class="fi" type="number" step="0.5"></div>';
    MX.showModal({
      title: 'Confirmer le réglage effectué', body: body, noAutoClose: true,
      actions: [
        { label: 'Confirmer', cls: 'primary-btn', fn: function () {
          var v = _numOrNull('ctavc-apply-val');
          MX.DB.markHeatingSettingApplied(id, _currentUserName(), v).then(function () {
            MX.closeModal(); MX.toast('Réglage marqué comme effectué');
          }).catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
        } },
        { label: 'Annuler', cls: 'cancel', fn: function () { MX.closeModal(); } },
      ],
    });
  }
  function _openConfirmSetpointForm(id) {
    var body = '<div class="ctavc-form"><label>Consigne réelle confirmée (°C)</label>' +
      '<input id="ctavc-confirm-val" class="fi" type="number" step="0.5"></div>';
    MX.showModal({
      title: 'Confirmer la consigne réelle', body: body, noAutoClose: true,
      actions: [
        { label: 'Confirmer', cls: 'primary-btn', fn: function () {
          var v = _numOrNull('ctavc-confirm-val');
          MX.DB.confirmHeatingSetpoint(id, _currentUserName(), v).then(function () {
            MX.closeModal(); MX.toast('Consigne réelle confirmée');
          }).catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
        } },
        { label: 'Annuler', cls: 'cancel', fn: function () { MX.closeModal(); } },
      ],
    });
  }
  // Contrôle après réglage = un NOUVEAU relevé (jamais une valeur recopiée
  // à la main) — voir _openReadingForm(circuitId, controlFor) : le relevé
  // créé est ensuite lié à la proposition via linkHeatingControlReading,
  // seule preuve de contrôle jamais acceptée.
  function _openControlReadingForm(id, circuitId) {
    _openReadingForm(circuitId, id);
  }

  function _circuitName(id) {
    var c = _circuits.find(function (x) { return x.id === id; });
    return c ? c.name : 'Circuit supprimé';
  }

  // ════════════════════════════════════ VUE D'ENSEMBLE (REFONTE Phase 1) ════════════════════════════════════
  // État propre à la Vue d'ensemble (sélection du graphique principal) —
  // jamais mélangé avec _historyFilters (Historique & analyse, filtres
  // distincts). null = sélection automatique (circuits suivis, voir
  // _overviewAutoCircuitIds ci-dessous), tant que l'utilisateur n'a pas
  // explicitement choisi.
  var _overviewPeriodDays = 30;
  var _overviewSelectedCircuitIds = null;
  var OVERVIEW_CHART_COLORS = ['var(--cyan)', '#A78BFA', 'var(--orange)', 'var(--red)', '#34D399'];

  function _setOverviewPeriod(days) { _overviewPeriodDays = parseInt(days, 10) || 30; render(); }
  function _toggleOverviewCircuit(id) {
    var base = _overviewSelectedCircuitIds || _overviewAutoCircuitIds();
    var idx = base.indexOf(id);
    var next = base.slice();
    if (idx === -1) next.push(id); else next.splice(idx, 1);
    _overviewSelectedCircuitIds = next;
    render();
  }
  // Sélection automatique par défaut : circuits non archivés AYANT AU MOINS
  // UN relevé, limités aux 4 premiers (lisibilité du graphique) — jamais un
  // circuit sans aucune donnée exploitable sélectionné par défaut.
  function _overviewAutoCircuitIds() {
    return _circuits.filter(function (c) { return !c.archived && _readings.some(function (r) { return r.circuitId === c.id; }); })
      .slice(0, 4).map(function (c) { return c.id; });
  }

  // Indicateurs + courbe DJU regroupés par bâtiment — calcul CENTRALISÉ
  // (MX.HeatingEngine.computeOverviewIndicators, Phase 1) réutilisé à
  // l'identique par l'Historique & analyse (Phase 3) : jamais deux calculs
  // différents pour le même chiffre. Aucune nouvelle requête Firestore —
  // uniquement les listes déjà chargées par _subscribe().
  function _overviewIndicators() {
    var curvePointsByBuilding = {};
    _curvePoints.forEach(function (p) { (curvePointsByBuilding[p.buildingId] = curvePointsByBuilding[p.buildingId] || []).push(p); });
    return MX.HeatingEngine.computeOverviewIndicators({
      circuits: _circuits, readings: _readings, recommendations: _recommendations,
      buildings: _buildings, rooms: _rooms, curvePointsByBuilding: curvePointsByBuilding,
      weatherSeries: _weatherSeries, now: Date.now(),
    });
  }

  // A. Bandeau d'indicateurs — chaque valeur trace directement un comptage
  // réel (voir heating-engine.js:computeOverviewIndicators), jamais un
  // chiffre approché ou un exemple.
  function _overviewKpiHtml(ind) {
    function tile(icon, color, val, lbl) {
      return '<div class="ctavc-kpi-tile ctavc-kpi-tile--' + color + '"><i class="fas ' + icon + '"></i>' +
        '<span class="ctavc-kpi-tile-val">' + val + '</span><span class="ctavc-kpi-tile-lbl">' + MX.esc(lbl) + '</span></div>';
    }
    var h = '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-gauge-high"></i> Indicateurs</div>';
    h += '<div class="ctavc-kpi-band">';
    h += tile('fa-list-check', 'cyan', ind.circuitsConfigured, 'Circuits configurés');
    h += tile('fa-signal', 'cyan', ind.circuitsTracked, 'Circuits suivis (relevé < ' + MX.HeatingEngine.CIRCUIT_TRACKED_WINDOW_DAYS + 'j)');
    h += tile('fa-triangle-exclamation', 'orange', ind.circuitsToCheck, 'Circuits à vérifier');
    h += tile('fa-clock', 'cyan', ind.readingsRecent, 'Relevés récents (' + MX.HeatingEngine.READING_RECENT_DAYS + 'j)');
    h += tile('fa-hourglass-half', 'orange', ind.readingsStaleOrMissing.count, 'Relevés anciens/manquants');
    h += tile('fa-lightbulb', 'violet', ind.recommendationsActive.total, 'Recommandations actives');
    h += tile('fa-bell', 'red', ind.anomalies.count, 'Anomalies / vigilance');
    h += '</div>';
    h += '<div class="ctavc-hint-inline">Recommandations actives : ' + ind.recommendationsActive.v1 + ' (cycle historique) + ' + ind.recommendationsActive.v2 + ' (cycle quantitatif DJU MX) — jamais fusionnées en un seul chiffre opaque.</div>';
    h += '</div>';
    return h;
  }

  // B. Graphique principal — intérieure (par circuit sélectionné),
  // extérieure OBSERVÉE et PRÉVISIONNELLE (séries distinctes, jamais
  // fusionnées), consigne (ligne de référence constante, affichée
  // uniquement quand un seul circuit est sélectionné pour éviter toute
  // ambiguïté entre plusieurs consignes différentes).
  function _overviewTempChartHtml() {
    if (!_weatherSeries) return '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-chart-line"></i> Évolution des températures</div><div class="ctavc-empty-inline">Météo en cours de chargement…</div></div>';
    var selected = _overviewSelectedCircuitIds || _overviewAutoCircuitIds();
    var cutoffMs = Date.now() - _overviewPeriodDays * 24 * 60 * 60 * 1000;

    var series = [];
    selected.forEach(function (id, idx) {
      var c = _circuits.find(function (x) { return x.id === id; });
      if (!c) return;
      var pts = _readings.filter(function (r) { return r.circuitId === id; })
        .map(function (r) { return { ms: _tsToMs(r.recordedAt), val: _readingTempValue(r) }; })
        .filter(function (p) { return p.ms !== null && p.ms >= cutoffMs && typeof p.val === 'number'; })
        .sort(function (a, b) { return a.ms - b.ms; });
      if (!pts.length) return;
      series.push({
        label: 'Intérieure — ' + c.name, color: OVERVIEW_CHART_COLORS[idx % OVERVIEW_CHART_COLORS.length],
        vals: pts.map(function (p) { return p.val; }), ts: pts.map(function (p) { return p.ms; }),
        labels: pts.map(function (p) { var d = new Date(p.ms); return d.getDate() + '/' + (d.getMonth() + 1); }),
      });
    });

    var wDays = _weatherSeries.filter(function (d) { var ms = new Date(d.date + 'T00:00:00').getTime(); return ms >= cutoffMs; });
    var observed = wDays.filter(function (d) { return d.kind === 'observed'; });
    var forecast = wDays.filter(function (d) { return d.kind === 'forecast'; });
    [['Extérieure (observée)', observed, 'var(--text3)'], ['Extérieure (prévision)', forecast, '#9CA3AF']].forEach(function (pair) {
      var label = pair[0], days = pair[1], color = pair[2];
      if (!days.length) return;
      series.push({
        label: label, color: color,
        vals: days.map(function (d) { return d.tMean; }),
        ts: days.map(function (d) { return new Date(d.date + 'T00:00:00').getTime(); }),
        labels: days.map(function (d) { return d.date.slice(5); }),
      });
    });

    if (selected.length === 1) {
      var only = _circuits.find(function (x) { return x.id === selected[0]; });
      var setpoint = only ? _circuitSetpointValue(only) : null;
      if (typeof setpoint === 'number' && series.length && series[0].ts) {
        var refTs = series[0].ts, refLabels = series[0].labels;
        series.push({ label: 'Consigne (' + setpoint + '°C)', color: '#FBBF24', ts: refTs, labels: refLabels, vals: refTs.map(function () { return setpoint; }) });
      }
    }

    var h = '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-chart-line"></i> Évolution des températures</div>';
    h += '<div class="ctavc-toolbar">';
    [7, 30, 90].forEach(function (d) {
      h += '<button class="cso-ibtn' + (d === _overviewPeriodDays ? ' ctavc-tab--on' : '') + '" onclick="MX.Pages.CtaVc._setOverviewPeriod(' + d + ')">' + d + ' jours</button>';
    });
    h += '</div>';
    if (_circuits.filter(function (c) { return !c.archived; }).length > 1) {
      h += '<div class="ctavc-toolbar">';
      _circuits.filter(function (c) { return !c.archived; }).forEach(function (c) {
        var on = selected.indexOf(c.id) !== -1;
        h += '<button class="cso-ibtn' + (on ? ' ctavc-tab--on' : '') + '" onclick="MX.Pages.CtaVc._toggleOverviewCircuit(\'' + c.id + '\')">' + MX.esc(c.name) + '</button>';
      });
      h += '</div>';
    }
    h += MX.Charts.lineChart(series, { id: 'ctavc-overview-temp-chart', height: 200, insufficientReason: 'Aucun relevé exploitable pour ' + (selected.length ? 'le(s) circuit(s) sélectionné(s)' : 'la période choisie') + ' — sélectionnez un autre circuit ou une période plus large.' });
    h += '<div class="ctavc-hint-inline">Les tendances intérieures et extérieures sont affichées côte à côte à titre indicatif, sans lien de cause automatique.</div>';
    h += '</div>';
    return h;
  }

  // C. Tableau de suivi des circuits — compact, remplace l'ancienne liste
  // "Circuits (N)". Écart jamais affiché si la consigne OU le dernier
  // relevé manque (cellule "—", jamais 0).
  function _circuitTrackingTableHtml() {
    var active = _circuits.filter(function (c) { return !c.archived; });
    var h = '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-diagram-project"></i> Suivi des circuits (' + active.length + ')</div>';
    if (!active.length) {
      h += '<div class="ctavc-empty-inline">Aucun circuit créé.</div></div>';
      return h;
    }
    h += '<div class="ctavc-compact-table"><table><thead><tr>' +
      '<th>Circuit</th><th>Type</th><th>Bâtiment</th><th>Dernier relevé</th><th>Consigne</th><th>Écart</th><th>Précédent</th><th>Évolution</th><th>Statut</th>' +
      '</tr></thead><tbody>';
    active.forEach(function (c) {
      var hist = _readings.filter(function (r) { return r.circuitId === c.id; })
        .map(function (r) { return { ms: _tsToMs(r.recordedAt), val: _readingTempValue(r) }; })
        .filter(function (p) { return p.ms !== null; }).sort(function (a, b) { return b.ms - a.ms; });
      var last = hist[0] || null, prev = hist[1] || null;
      var setpoint = _circuitSetpointValue(c);
      var gap = (last && typeof last.val === 'number' && typeof setpoint === 'number') ? _r1(last.val - setpoint) : null;
      var trendIcon = '<span class="ctavc-trend-arrow--flat">—</span>';
      if (last && prev && typeof last.val === 'number' && typeof prev.val === 'number') {
        if (last.val > prev.val) trendIcon = '<i class="fas fa-arrow-trend-up ctavc-trend-arrow--up"></i>';
        else if (last.val < prev.val) trendIcon = '<i class="fas fa-arrow-trend-down ctavc-trend-arrow--down"></i>';
        else trendIcon = '<i class="fas fa-equals ctavc-trend-arrow--flat"></i>';
      }
      h += '<tr class="ctavc-compact-row--clickable" onclick="MX.Pages.CtaVc._openCircuitDetail(\'' + c.id + '\')">' +
        '<td>' + MX.esc(c.name) + '</td>' +
        '<td>' + MX.esc((c.type || '').toUpperCase()) + '</td>' +
        '<td>' + (c.buildingId ? MX.esc(_buildingLabel(c.buildingId)) : '—') + '</td>' +
        // Correction (vérification demandée par l'utilisateur) : "Aucun
        // relevé" n'était affiché à tort QUE si la valeur du dernier relevé
        // n'était pas exploitable — même quand un relevé (sans température
        // exploitable) existait réellement à cette date. Désormais, la date
        // du dernier relevé enregistré est toujours affichée dès qu'un
        // relevé existe ; seule la valeur se réduit à "Sans température
        // exploitable" si besoin — jamais fusionnée avec "aucun relevé".
        '<td>' + (last
          ? (typeof last.val === 'number' ? last.val + '°C<br>' : '<span class="ctavc-gap-na">Sans température exploitable</span><br>') +
            '<span class="ctavc-hint-inline">' + _fmtDateTime(new Date(last.ms)) + '</span>'
          : '<span class="ctavc-gap-na">Aucun relevé</span>') + '</td>' +
        '<td>' + (typeof setpoint === 'number' ? setpoint + '°C' : '<span class="ctavc-gap-na">Non renseigné</span>') + '</td>' +
        '<td>' + (gap !== null ? '<span class="' + (gap > 0 ? 'ctavc-gap-pos' : gap < 0 ? 'ctavc-gap-neg' : '') + '">' + (gap > 0 ? '+' : '') + gap + '°C</span>' : '<span class="ctavc-gap-na">—</span>') + '</td>' +
        '<td>' + (prev && typeof prev.val === 'number' ? prev.val + '°C' : '<span class="ctavc-gap-na">—</span>') + '</td>' +
        '<td>' + trendIcon + '</td>' +
        '<td><span class="ctavc-status-badge ctavc-status-badge--' + (c.configStatus || 'a_verifier') + '">' + (STATUS_LABELS[c.configStatus] || 'À vérifier') + '</span></td>' +
        '</tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  // D. Bloc Météo & DJU — extension du bandeau existant (observé/
  // prévisionnel déjà distingués par ctavc-wd-cell-dju--forecast) avec les
  // écarts de courbe DJU détectés (relocalisés depuis l'ancien onglet
  // "Courbes DJU / température" de Configuration thermique — la donnée et
  // le moteur ne sont jamais dupliqués, seule cette vue en affiche un
  // résumé compact).
  function _overviewWeatherDjuHtml(ind) {
    if (!_weatherSeries) return '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-cloud-sun"></i> Météo & DJU</div><div class="ctavc-empty-inline">Météo en cours de chargement…</div></div>';
    var today = _todayStr();
    var upcoming = _weatherSeries.filter(function (d) { return d.date >= today; }).slice(0, 7);
    var trend = MX.Dju.trend(_weatherSeries);
    var base = _effectiveDjuBaseTemp();
    var h = '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-cloud-sun"></i> Météo & DJU (référence ' + base + '°C) — 7 prochains jours' +
      (trend ? ' <span class="ctavc-trend ctavc-trend--' + trend + '">' + (trend === 'hausse' ? 'Besoin de chauffe en hausse' : trend === 'baisse' ? 'Besoin de chauffe en baisse' : 'Stable') + '</span>' : '') +
      '</div><div class="ctavc-wd-row">';
    upcoming.forEach(function (d) {
      var info = (MX.Weather && MX.Weather.codeInfo) ? MX.Weather.codeInfo(d.weatherCode) : { icon: 'fa-cloud' };
      h += '<div class="ctavc-wd-cell' + (d.date === today ? ' ctavc-wd-cell--today' : '') + '">' +
        '<div class="ctavc-wd-cell-date">' + new Date(d.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit' }) + '</div>' +
        '<i class="fas ' + info.icon + '"></i>' +
        '<div class="ctavc-wd-cell-mm">' + (d.tMin !== null ? Math.round(d.tMin) : '—') + '° / ' + (d.tMax !== null ? Math.round(d.tMax) : '—') + '°</div>' +
        '<div class="ctavc-wd-cell-dju' + (d.kind === 'forecast' ? ' ctavc-wd-cell-dju--forecast' : '') + '">DJU ' + (d.dju19 !== null ? d.dju19.toFixed(1) : '—') + '</div>' +
        '<div class="ctavc-hint-inline">' + (d.kind === 'observed' ? 'Observé' : d.kind === 'forecast' ? 'Prévisionnel' : 'Manquant') + '</div>' +
      '</div>';
    });
    h += '</div>';
    if (ind.anomalies.curveDegradations.length) {
      h += '<div class="ctavc-hint-inline" style="margin-top:8px">';
      ind.anomalies.curveDegradations.forEach(function (d) {
        h += '<div><i class="fas fa-triangle-exclamation" style="color:var(--orange)"></i> ' + MX.esc(_buildingLabel(d.buildingId) || 'Bâtiment') +
          ' : écart détecté à partir de ' + d.degradationFromDju + ' DJU (fiabilité : ' + d.dataSufficiency + ')</div>';
      });
      h += '</div>';
    }
    h += '<div class="ctavc-hint-inline" style="margin-top:6px">Les tendances intérieures et extérieures sont rapprochées à titre indicatif — jamais présentées comme une relation de cause à effet automatique.</div>';
    h += '</div>';
    return h;
  }

  // E. Recommandations prioritaires — tableau compact (remplace l'ancienne
  // liste "Prochaines actions"). v1 (statut a_examiner, déjà trié par
  // priorité, exclut les items "maintenir"/"donnees_insuffisantes" et relègue
  // les bâtiments automatiques — logique héritée inchangée) + v2 (statut
  // proposition_generee uniquement : les étapes suivantes du cycle sont déjà
  // "en cours de traitement", pas "à traiter" — jamais mélangées sans
  // distinction). Les recommandations déjà traitées n'apparaissent jamais ici.
  function _overviewRecoTableHtml() {
    var recos = _ensureLiveRecos();
    var actionable = recos.filter(function (r) { return r.action !== 'maintenir' && r.action !== 'donnees_insuffisantes'; });
    var order = { haute: 0, moyenne: 1, basse: 2 };
    actionable.sort(function (a, b) {
      var manualDiff = (a.manualAction === false ? 1 : 0) - (b.manualAction === false ? 1 : 0);
      if (manualDiff !== 0) return manualDiff;
      return (order[a.priority] || 9) - (order[b.priority] || 9);
    });
    var v2Pending = _recommendations.filter(function (r) { return r.engineVersion === 'v2' && r.status === 'proposition_generee'; });

    var rows = actionable.map(function (r) {
      return { kind: 'v1', priorityHtml: '<span class="ctavc-pill ctavc-pill--' + r.priority + '">' + PRIORITY_LABELS[r.priority] + '</span>',
        circuit: _circuitName(r.circuitId), constat: r.justification, action: r.title, statut: 'À examiner' };
    }).concat(v2Pending.map(function (r) {
      return { kind: 'v2', priorityHtml: '<span class="ctavc-pill" style="background:rgba(167,139,250,.15);color:#A78BFA">Proposition DJU MX</span>',
        circuit: _circuitName(r.circuitId), constat: r.justification || '—', action: PROP_STATUS_LABELS[r.status], statut: PROP_STATUS_LABELS[r.status] };
    }));

    var h = '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-list-check"></i> Recommandations prioritaires (' + rows.length + ')</div>';
    if (!rows.length) {
      h += '<div class="ctavc-empty-inline">Aucune recommandation active — réglages maintenus sur l\'ensemble des circuits actifs.</div>';
    } else {
      h += '<div class="ctavc-compact-table"><table><thead><tr><th>Priorité</th><th>Circuit</th><th>Constat</th><th>Action proposée</th><th>Statut</th></tr></thead><tbody>';
      rows.slice(0, 5).forEach(function (r) {
        h += '<tr><td>' + r.priorityHtml + '</td><td>' + MX.esc(r.circuit) + '</td><td>' + MX.esc(r.constat) + '</td><td>' + MX.esc(r.action) + '</td><td>' + MX.esc(r.statut) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '<button class="ctavc-link-btn" onclick="MX.Pages.CtaVc._setTab(\'recommendations\')">Voir toutes les recommandations <i class="fas fa-arrow-right"></i></button>';
    h += '</div>';
    return h;
  }

  // Valeur numérique exploitable d'un relevé (1 point ou moyenne 2 points) —
  // même logique que _readingTempLabel, mais renvoie un nombre (ou null),
  // jamais une chaîne, pour les calculs (graphique, tableau, écarts).
  function _readingTempValue(r) {
    if (typeof r.temp === 'number') return r.temp;
    if (r.points && r.points.point1 && r.points.point2) return _r1((r.points.point1.waterTemp + r.points.point2.waterTemp) / 2);
    return null;
  }
  // Consigne "représentative" d'un circuit — setpointValue (régulation par
  // consigne/mixte) en priorité, sinon waterSetpoint (vanne 3 voies) si
  // présent, sinon null (jamais une valeur par défaut inventée).
  function _circuitSetpointValue(c) {
    if (typeof c.setpointValue === 'number') return c.setpointValue;
    if (typeof c.waterSetpoint === 'number') return c.waterSetpoint;
    return null;
  }

  function _overviewHtml() {
    if (_weatherStatus === 'unconfigured') {
      return '<div class="ctavc-empty"><i class="fas fa-location-dot"></i><div>Localisation de l\'établissement non configurée.</div>' +
        '<button class="primary-btn" style="width:auto" onclick="window._settingsTab=\'etablissement\';MX.showPage(\'parametres\')">Configurer la météo</button></div>';
    }
    var ind = _overviewIndicators();
    var h = '';
    h += _overviewKpiHtml(ind);
    h += _overviewTempChartHtml();
    h += _circuitTrackingTableHtml();
    h += _overviewWeatherDjuHtml(ind);
    h += _overviewRecoTableHtml();
    // Pilotage quantitatif par bâtiment (inchangé — Bâtiment automatique :
    // surveillance uniquement ; Bâtiment manuel : comparaison situation
    // actuelle / proposition DJU MX).
    h += _buildingCardsHtml();
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
    var canManage = _canManage();
    var h = '<div class="ctavc-toolbar">' +
      '<label class="ctavc-check-inline"><input type="checkbox" ' + (_showArchived ? 'checked' : '') + ' onchange="MX.Pages.CtaVc._toggleShowArchived(this.checked)"> Afficher les circuits archivés</label>' +
      (canManage ? '<button class="primary-btn" style="width:auto" onclick="MX.Pages.CtaVc._openCircuitForm(null)"><i class="fas fa-plus"></i> Nouveau circuit</button>' : '') +
    '</div>';
    if (!_circuits.length) {
      h += '<div class="ctavc-empty"><i class="fas fa-diagram-project"></i><div>Aucun circuit configuré pour le moment.' +
        (canManage ? '<br>Créez votre premier circuit (CTA, VC, ou tout autre type) — aucun exemple préconfiguré n\'est fourni : les réglages affichés doivent toujours correspondre à l\'installation réelle.' : '') + '</div>' +
        (canManage ? '<button class="primary-btn" style="width:auto" onclick="MX.Pages.CtaVc._openCircuitForm(null)"><i class="fas fa-plus"></i> Créer un circuit</button>' : '') + '</div>';
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
        '<div class="ctavc-circuit-card-zone">' + (c.zone ? MX.esc(c.zone) : 'Zone non précisée') + (c.buildingId ? ' · ' + MX.esc(_buildingLabel(c.buildingId)) : '') + '</div>' +
        '<div class="ctavc-circuit-card-reg">' + (c.regulationType ? REG_LABELS[c.regulationType] || c.regulationType : 'Régulation non renseignée') + '</div>' +
        '<div class="ctavc-circuit-card-reading">' + (reading ? 'Dernier relevé : ' + _readingTempLabel(reading) + ' (' + (_ageLabel(reading.recordedAt) || '—') + ')' : 'Aucun relevé') + '</div>' +
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
    // CORRECTION 1 : bâtiment automatique — aucune décision de réglage
    // possible, surveillance uniquement (voir evaluateCircuit/manualAction).
    if (reco.manualAction === false) return '<span class="ctavc-reco-row-pending"><i class="fas fa-eye"></i> Surveillance (bâtiment automatique) — information uniquement</span>';
    var key = reco.circuitId + '|' + reco.action;
    var persisted = _matchingAExaminer(reco);
    if (persisted) {
      if (!_canManage()) return '<span class="ctavc-reco-row-pending">À examiner — décision réservée aux responsables/administrateurs</span>';
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
      (_canManage() ?
        '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._openCircuitForm(\'' + c.id + '\')"><i class="fas fa-pen"></i> Modifier</button>' +
        '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._confirmArchive(\'' + c.id + '\', ' + (!c.archived) + ')"><i class="fas fa-box-archive"></i> ' + (c.archived ? 'Réactiver' : 'Archiver') + '</button>'
        : '') +
      '</div></div>';

    if (c.description) h += '<div class="ctavc-detail-desc">' + MX.esc(c.description) + '</div>';
    h += '</div>';

    // REFONTE CTA/VC Phase 4 — fiche circuit détaillée réorganisée en
    // sections repliables (toutes ouvertes par défaut : aucun changement
    // de visibilité par rapport à l'existant, seulement l'affordance de
    // les replier). Champs/contenus strictement identiques à avant.
    h += _collapsibleOpenTag('detailFields', 'fa-circle-info', 'Caractéristiques de l\'installation');
    h += '<div class="ctavc-field-grid">';
    h += _fieldRow('Bâtiment', c.buildingId ? _buildingLabel(c.buildingId) : null);
    if (c.type === 'vc') h += _fieldRow('Plafond eau VC', typeof c.vcMaxTemp === 'number' ? c.vcMaxTemp + ' °C' : '50 °C (plafond par défaut)');
    if (c.type === 'cta') {
      h += _fieldRow('Plage de soufflage (air)', (typeof c.ctaRangeMin === 'number' && typeof c.ctaRangeMax === 'number') ? c.ctaRangeMin + '–' + c.ctaRangeMax + ' °C' : '18–22 °C (plage par défaut)');
      h += _fieldRow('Limites eau de batterie', (typeof c.waterTempMin === 'number' && typeof c.waterTempMax === 'number') ? c.waterTempMin + '–' + c.waterTempMax + ' °C' : null);
    }
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
    h += _fieldRow('Température intérieure associée', lastReading ? _readingTempLabel(lastReading) + ' (' + _fmtDateTime(lastReading.recordedAt) + ')' : null);
    h += _fieldRow('Température cible de la zone', typeof c.targetTemp === 'number' ? c.targetTemp + ' °C' : null);
    h += _fieldRow('Limites connues', c.knownLimits);
    h += _fieldRow('Horaires de fonctionnement', c.operatingHours);
    h += _fieldRow('Dernière vérification', c.lastCheckedAt ? _fmtDateTime(c.lastCheckedAt) : null);
    h += '</div>';
    h += _collapsibleCloseTag();

    // Conseil Maintix pour ce circuit
    h += _collapsibleOpenTag('detailAdvice', 'fa-lightbulb', 'Conseil Maintix pour ce circuit');
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
    h += _collapsibleCloseTag();

    // Contrôles à effectuer
    h += _collapsibleOpenTag('detailControls', 'fa-clipboard-check', 'Contrôles à effectuer');
    h += '<ul class="ctavc-check-list">' +
      '<li>Relever la température ambiante de la zone et l\'enregistrer ci-dessous.</li>' +
      (c.regulationType === 'vanne_3v' || c.regulationType === 'mixte' ? '<li>Vérifier la température de départ d\'eau réelle vs consigne affichée.</li>' : '') +
      '<li>Confirmer que le réglage noté dans cette fiche correspond bien au réglage réel sur l\'installation.</li>' +
    '</ul>';
    h += _collapsibleCloseTag();

    // Saisie + historique des relevés pour ce circuit — RÉUTILISE le bloc
    // de statistiques de la Phase 3 (_readingStatsBlockHtml,
    // computeReadingStats) plutôt que de recalculer une moyenne/dernière
    // température ad hoc ici : aucune duplication de logique (critère
    // d'acceptation explicite de la Phase 4).
    h += _collapsibleOpenTag('detailReadings', 'fa-thermometer-half', 'Températures intérieures relevées (saisie manuelle)');
    h += '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._openReadingForm(\'' + c.id + '\')"><i class="fas fa-plus"></i> Relevé</button>';
    if (readings.length) h += _readingStatsBlockHtml(readings, null);
    if (!readings.length) {
      h += '<div class="ctavc-empty-inline">Aucun relevé pour ce circuit — les relevés manuels ne sont jamais des mesures automatiques ou temps réel.</div>';
    } else {
      h += '<div class="ctavc-reading-list">';
      readings.slice(0, 15).forEach(function (r) {
        h += '<div class="ctavc-reading-row"><span class="ctavc-reading-temp">' + _readingTempLabel(r) + '</span>' +
          '<span class="ctavc-reading-date">' + _fmtDateTime(r.recordedAt) + '</span>' +
          '<span class="ctavc-reading-author">' + (r.author ? MX.esc(r.author) : '—') + '</span>' +
          (r.comment ? '<span class="ctavc-reading-comment">' + MX.esc(r.comment) + '</span>' : '') +
        '</div>';
      });
      h += '</div>';
    }
    h += _collapsibleCloseTag();
    return h;
  }
  function _fieldRow(label, value) {
    return '<div class="ctavc-field-row"><span class="ctavc-field-label">' + MX.esc(label) + '</span>' +
      '<span class="ctavc-field-value' + (value ? '' : ' ctavc-field-value--na') + '">' + (value ? MX.esc(String(value)) : 'Donnée non disponible') + '</span></div>';
  }

  // REFONTE CTA/VC Phase 4 — sections repliables (config CTA/VC, fiche
  // circuit détaillée). Pattern <details>/<summary> natif, même principe
  // déjà utilisé ailleurs dans Maintix (org-resp.js:.or-form-advanced),
  // seulement réétiqueté .ctavc-* pour la cohérence visuelle du module.
  // L'état ouvert/fermé est capturé par _onConfigSectionToggle (événement
  // natif "toggle", déclenché par le clic utilisateur sur <summary>) et
  // simplement RELU ici à chaque rendu — jamais recalculé ni perdu entre
  // deux rendus de la même session.
  function _collapsibleOpenTag(key, icon, label) {
    var open = _ctaVcSectionsOpen[key] !== false;
    return '<div class="ctavc-card"><details class="ctavc-collapsible"' + (open ? ' open' : '') +
      ' ontoggle="MX.Pages.CtaVc._onConfigSectionToggle(\'' + key + '\', this.open)">' +
      '<summary class="ctavc-collapsible-toggle"><i class="fas ' + icon + '"></i><span>' + MX.esc(label) + '</span>' +
      '<i class="fas fa-chevron-right ctavc-collapsible-chevron"></i></summary>' +
      '<div class="ctavc-collapsible-body">';
  }
  function _collapsibleCloseTag() { return '</div></details></div>'; }
  function _onConfigSectionToggle(key, open) { _ctaVcSectionsOpen[key] = !!open; }

  function _confirmArchive(id, archived) {
    if (!_canManage()) { _denyManage(); return; }
    var msg = archived ? 'Archiver ce circuit ? Il ne sera plus proposé par le moteur de recommandation, mais ses données (relevés, historique) sont conservées.' : 'Réactiver ce circuit ?';
    if (!confirm(msg)) return;
    MX.DB.archiveHeatingCircuit(id, archived, _currentUserName()).then(function () {
      MX.toast(archived ? 'Circuit archivé' : 'Circuit réactivé');
    }).catch(function (e) { MX.toast('Erreur (permissions Firestore probablement non configurées) : ' + (e.message || e), true); });
  }

  // ════════════════════════════════════ FORMULAIRE CIRCUIT ════════════════════════════════════
  function _openCircuitForm(id) {
    if (!_canManage()) { _denyManage(); return; }
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
    h += '<label>Type</label><select id="ctavc-f-type" class="fi" onchange="MX.Pages.CtaVc._onCircuitTypeChange(this.value)">' +
      ['cta', 'vc', 'reseau_chauffage', 'autre'].map(function (t) { return '<option value="' + t + '"' + (c.type === t ? ' selected' : '') + '>' + TYPE_LABELS[t] + '</option>'; }).join('') + '</select>';
    h += '<label>Zone desservie</label><input id="ctavc-f-zone" class="fi" value="' + MX.esc(c.zone || '') + '" placeholder="Ex: Chambres étage 2">';
    h += '<label>Bâtiment</label><select id="ctavc-f-building" class="fi">' +
      '<option value=""' + (!c.buildingId ? ' selected' : '') + '>— Non assigné —</option>' +
      _buildings.filter(function (b) { return !b.archived; }).map(function (b) {
        return '<option value="' + b.id + '"' + (c.buildingId === b.id ? ' selected' : '') + '>' + MX.esc(b.name) + (b.mode === 'automatique' ? ' (auto)' : ' (manuel)') + '</option>';
      }).join('') +
      (_buildings.length ? '' : '<option value="" disabled>Aucun bâtiment créé — voir Configuration thermique</option>') +
    '</select>';
    h += '<div id="ctavc-f-capfields">' + _capFieldsHtml(c.type || '', c) + '</div>';
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

  // REFONTE CTA/VC — bornes de sécurité par circuit (uniquement pertinentes
  // pour CTA/VC) : VC plafonné à 50°C (jamais réglable au-delà, même dans
  // ce formulaire — max="50" sur l'input ET revalidé par
  // MX.HeatingEngine.clampForCircuit et par firestore.rules.draft-claims-
  // migration, défense en profondeur à 3 niveaux). CTA : plage 18-22°C par
  // défaut, resserrable.
  function _capFieldsHtml(type, c) {
    if (type === 'vc') {
      return '<label>Température eau maximale (°C, plafond de sécurité — jamais au-delà de 50°C)</label>' +
        '<input id="ctavc-f-vcmax" class="fi" type="number" step="0.5" max="50" min="1" value="' + (typeof c.vcMaxTemp === 'number' ? c.vcMaxTemp : 50) + '">';
    }
    if (type === 'cta') {
      // CORRECTION 2 : deux plages INDÉPENDANTES — soufflage (air, 18-22°C
      // par défaut) et eau de batterie (aucune valeur par défaut inventée :
      // le moteur reste en attente tant que ces limites ne sont pas saisies
      // ici, voir MX.HeatingEngine.proposeQuantitative).
      return '<label>Plage de température de SOUFFLAGE (air, °C)</label><div style="display:flex;gap:8px">' +
        '<input id="ctavc-f-ctamin" class="fi" type="number" step="0.5" placeholder="Min" value="' + (typeof c.ctaRangeMin === 'number' ? c.ctaRangeMin : 18) + '">' +
        '<input id="ctavc-f-ctamax" class="fi" type="number" step="0.5" placeholder="Max" value="' + (typeof c.ctaRangeMax === 'number' ? c.ctaRangeMax : 22) + '"></div>' +
        '<label>Limites de température d\'EAU DE BATTERIE (°C, facultatif — sans valeur ici, MX reste en mode observation pour cette grandeur)</label><div style="display:flex;gap:8px">' +
        '<input id="ctavc-f-watermin" class="fi" type="number" step="0.5" placeholder="Min" value="' + (typeof c.waterTempMin === 'number' ? c.waterTempMin : '') + '">' +
        '<input id="ctavc-f-watermax" class="fi" type="number" step="0.5" placeholder="Max" value="' + (typeof c.waterTempMax === 'number' ? c.waterTempMax : '') + '"></div>';
    }
    return '';
  }
  function _onCircuitTypeChange(val) {
    var el = document.getElementById('ctavc-f-capfields');
    if (el) el.innerHTML = _capFieldsHtml(val, _editingCircuit || {});
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
    if (!_canManage()) { _denyManage(); return; }
    var name = _strOrNull('ctavc-f-name');
    if (!name) { MX.toast('Le nom du circuit est obligatoire', true); return; }
    var regType = document.getElementById('ctavc-f-regtype').value || null;
    var circType = document.getElementById('ctavc-f-type').value;
    var buildingEl = document.getElementById('ctavc-f-building');
    var vcMaxEl = document.getElementById('ctavc-f-vcmax');
    var ctaMinEl = document.getElementById('ctavc-f-ctamin');
    var ctaMaxEl = document.getElementById('ctavc-f-ctamax');
    var waterMinEl = document.getElementById('ctavc-f-watermin');
    var waterMaxEl = document.getElementById('ctavc-f-watermax');
    var data = {
      name: name,
      type: circType,
      zone: _strOrNull('ctavc-f-zone') || '',
      // REFONTE CTA/VC : null (jamais une chaîne vide) quand non assigné/
      // non pertinent pour ce type — distingue clairement "pas encore
      // renseigné" d'une valeur réelle, et satisfait la validation des
      // règles Firestore (buildingId == null autorisé, '' ne l'est pas).
      buildingId: buildingEl && buildingEl.value ? buildingEl.value : null,
      vcMaxTemp: (circType === 'vc' && vcMaxEl) ? Math.min(50, (parseFloat(vcMaxEl.value) || 50)) : null,
      // ctaRangeMin/Max = plage de SOUFFLAGE (air) uniquement — jamais
      // appliquée à l'eau de batterie (CORRECTION 2).
      ctaRangeMin: (circType === 'cta' && ctaMinEl && ctaMinEl.value !== '') ? parseFloat(ctaMinEl.value) : null,
      ctaRangeMax: (circType === 'cta' && ctaMaxEl && ctaMaxEl.value !== '') ? parseFloat(ctaMaxEl.value) : null,
      // waterTempMin/Max = limites propres à l'EAU DE BATTERIE — facultatif,
      // jamais une valeur par défaut inventée si non renseigné.
      waterTempMin: (circType === 'cta' && waterMinEl && waterMinEl.value !== '') ? parseFloat(waterMinEl.value) : null,
      waterTempMax: (circType === 'cta' && waterMaxEl && waterMaxEl.value !== '') ? parseFloat(waterMaxEl.value) : null,
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
    var action = id ? MX.DB.updateHeatingCircuit(id, data, _currentUserName()) : MX.DB.addHeatingCircuit(Object.assign({ createdBy: _currentUserName() }, data), _currentUserName());
    action.then(function () {
      MX.closeModal();
      MX.toast(id ? 'Circuit mis à jour' : 'Circuit créé');
    }).catch(function (e) {
      MX.toast('Erreur d\'enregistrement (permissions Firestore probablement non configurées) : ' + (e.message || e), true);
    });
  }

  // ════════════════════════════════════ FORMULAIRE RELEVÉ ════════════════════════════════════
  // controlFor (2e paramètre, optionnel) : id d'une proposition v2 en
  // statut 'consigne_confirmee' pour laquelle CE relevé constituera la
  // preuve de contrôle (voir _openControlReadingForm/linkHeatingControlReading
  // ci-dessus) — jamais utilisé pour un relevé "normal".
  function _openReadingForm(circuitId, controlFor) {
    var c = _circuits.find(function (x) { return x.id === circuitId; });
    var now = new Date();
    var nowLocal = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') +
      'T' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    // REFONTE CTA/VC : relevé à 2 points (Point 1/Point 2 — eau/soufflage/
    // ambiante), proposé en OPTION pour un circuit CTA ou VC (jamais
    // automatique — un relevé "simple" (ancien champ `temp`) reste
    // TOUJOURS possible, même pour un circuit CTA/VC, pour ne jamais casser
    // le parcours existant). controlFor force le mode 2 points (un relevé
    // de contrôle après réglage CTA/VC est toujours à 2 points), sans
    // afficher la case à cocher dans ce cas précis.
    var canTwoPoint = !!controlFor || (c && (c.type === 'cta' || c.type === 'vc'));
    var defaultTwoPoint = !!controlFor;
    var body = '<div class="ctavc-form">' +
      '<label>Circuit / zone</label><div class="ctavc-form-static">' + MX.esc(c ? c.name + (c.zone ? ' — ' + c.zone : '') : '—') + '</div>';
    if (canTwoPoint && !controlFor) {
      body += '<label class="ctavc-check-inline"><input type="checkbox" id="ctavc-r-2pt-toggle" ' + (defaultTwoPoint ? 'checked' : '') +
        ' onchange="MX.Pages.CtaVc._onReadingModeToggle(this.checked)"> Relevé à 2 points (réseau CTA/VC)</label>';
    }
    body += '<div id="ctavc-r-fields">' + _readingFieldsHtml(defaultTwoPoint) + '</div>';
    body += '<label>Date et heure du relevé *</label><input id="ctavc-r-datetime" class="fi" type="datetime-local" value="' + nowLocal + '">' +
      '<label>Commentaire (facultatif)</label><input id="ctavc-r-comment" class="fi" placeholder="Ex: fenêtre entrouverte">' +
    '</div>';
    MX.showModal({
      title: controlFor ? 'Relevé de contrôle après réglage' : 'Relevé de température', sub: c ? c.name : '', body: body, noAutoClose: true,
      actions: [
        { label: 'Enregistrer', cls: 'primary-btn', fn: function () { _submitReadingForm(circuitId, _readingIsTwoPoint(), controlFor); } },
        { label: 'Annuler', cls: 'cancel', fn: function () { MX.closeModal(); } },
      ],
    });
    setTimeout(function () { var el = document.getElementById(defaultTwoPoint ? 'ctavc-r-p1-water' : 'ctavc-r-temp'); if (el) el.focus(); }, 50);
  }
  function _readingFieldsHtml(twoPoint) {
    if (twoPoint) return _pointFieldsHtml('1') + _pointFieldsHtml('2');
    return '<label>Température relevée (°C) *</label><input id="ctavc-r-temp" class="fi" type="number" step="0.1" placeholder="Ex: 19.5">';
  }
  function _readingIsTwoPoint() {
    var t = document.getElementById('ctavc-r-2pt-toggle');
    return !!(t ? t.checked : document.getElementById('ctavc-r-p1-water'));
  }
  function _onReadingModeToggle(checked) {
    var el = document.getElementById('ctavc-r-fields');
    if (el) el.innerHTML = _readingFieldsHtml(checked);
  }
  function _pointFieldsHtml(n) {
    return '<div class="ctavc-point-fieldset"><div class="ctavc-point-fieldset-label">Point ' + n + '</div>' +
      '<label>Température eau (°C) *</label><input id="ctavc-r-p' + n + '-water" class="fi" type="number" step="0.1">' +
      '<label>Température de soufflage (°C) *</label><input id="ctavc-r-p' + n + '-blow" class="fi" type="number" step="0.1">' +
      '<label>Température ambiante (°C) *</label><input id="ctavc-r-p' + n + '-ambient" class="fi" type="number" step="0.1"></div>';
  }
  function _submitReadingForm(circuitId, twoPoint, controlFor) {
    var dtEl = document.getElementById('ctavc-r-datetime');
    var recordedAt = dtEl && dtEl.value ? new Date(dtEl.value) : new Date();
    var c = _circuits.find(function (x) { return x.id === circuitId; });
    var data = {
      circuitId: circuitId,
      zone: c ? (c.zone || '') : '',
      recordedAt: recordedAt.toISOString(),
      author: _currentUserName(),
      comment: _strOrNull('ctavc-r-comment') || '',
    };
    if (twoPoint) {
      var p1 = { waterTemp: _numOrNull('ctavc-r-p1-water'), blowTemp: _numOrNull('ctavc-r-p1-blow'), ambientTemp: _numOrNull('ctavc-r-p1-ambient') };
      var p2 = { waterTemp: _numOrNull('ctavc-r-p2-water'), blowTemp: _numOrNull('ctavc-r-p2-blow'), ambientTemp: _numOrNull('ctavc-r-p2-ambient') };
      if (p1.waterTemp === null || p1.blowTemp === null || p1.ambientTemp === null || p2.waterTemp === null || p2.blowTemp === null || p2.ambientTemp === null) {
        MX.toast('Les 3 températures de chaque point (eau, soufflage, ambiante) sont obligatoires', true); return;
      }
      data.points = { point1: p1, point2: p2 };
    } else {
      var temp = _numOrNull('ctavc-r-temp');
      if (temp === null) { MX.toast('Température obligatoire', true); return; }
      data.temp = temp;
    }
    MX.DB.addHeatingReading(data).then(function (readingId) {
      MX.closeModal();
      MX.toast('Relevé enregistré');
      if (controlFor && MX.DB.linkHeatingControlReading) {
        return MX.DB.linkHeatingControlReading(controlFor, _currentUserName(), readingId).then(function () {
          MX.toast('Relevé de contrôle lié à la proposition');
        });
      }
    }).catch(function (e) {
      MX.toast('Erreur d\'enregistrement (permissions Firestore probablement non configurées) : ' + (e.message || e), true);
    });
  }

  // ════════════════════════════════════ RECOMMANDATIONS ════════════════════════════════════
  // ════════════════════════════════════ RECOMMANDATIONS (REFONTE Phase 2 — centre de décisions) ════════════════════════════════════
  // Réorganisation PURE de la présentation : les deux cycles de statuts
  // (v1 RECO_STATUS_LABELS, v2 PROP_STATUS_LABELS) restent STRICTEMENT
  // inchangés — aucun nouveau statut, aucune transition modifiée. Les
  // fonctions de décision (_decideReco, _markApplied, _validateProposal,
  // _refuseProposal, _openReportForm, _openApplyForm,
  // _openConfirmSetpointForm, _openControlReadingForm) et les permissions
  // _canManage() ne sont ni réécrites ni recopiées : seul leur point
  // d'appel change (panneau de détail au lieu d'un bouton inline dans une
  // carte). _persistedRecoRow/_persistedProposalRow/_matchingAExaminer/
  // _liveRecoActionsHtml/_liveRecoRow restent intacts : l'onglet
  // Historique & analyse (_historyHtml) en dépend toujours tel quel.
  var _recoFilters = { buildingId: '', circuitId: '', priority: '', status: '', period: '' };
  function _setRecoFilter(key, val) { _recoFilters[key] = val; render(); }

  function _recoCircuitBuildingId(circuitId) {
    var c = _circuits.find(function (x) { return x.id === circuitId; });
    return c ? c.buildingId : null;
  }
  function _recoMatchesFilters(r) {
    var f = _recoFilters;
    if (f.buildingId) {
      var bId = _recoCircuitBuildingId(r.circuitId);
      if (f.buildingId === 'none' ? !!bId : bId !== f.buildingId) return false;
    }
    if (f.circuitId && r.circuitId !== f.circuitId) return false;
    // v2 n'a pas de champ "priority" (voir exception documentée, Phase 1) —
    // un filtre priorité actif exclut donc tout item v2, jamais une fausse
    // correspondance par défaut ("undefined" ne matche jamais "haute").
    if (f.priority && r.priority !== f.priority) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.period && !_withinPeriod(r.createdAt, f.period)) return false;
    return true;
  }

  // Catégorisation PURE par le statut Firestore déjà existant — jamais un
  // nouveau statut inventé. v1 : a_examiner="à traiter" ; acceptee="en
  // attente" (décision prise par un responsable, en attente de la
  // confirmation technicien via _markApplied — PAS un statut terminal) ;
  // refusee/appliquee/expiree="historique" (terminaux). v2 :
  // proposition_generee ET reportee="à traiter" (reportee n'est
  // explicitement PAS terminal, voir db.js:reportHeatingProposal —
  // "redevient visible comme une proposition active") ;
  // validee/reglage_effectue/consigne_confirmee="en attente" (cycle en
  // cours, prochaine étape = action technicien) ;
  // refusee/controle_effectue/expiree="historique" (terminaux).
  var RECO_CATEGORY_A_TRAITER = { a_examiner: 1, proposition_generee: 1, reportee: 1 };
  var RECO_CATEGORY_EN_ATTENTE = { acceptee: 1, validee: 1, reglage_effectue: 1, consigne_confirmee: 1 };
  function _recoCategory(r) {
    if (RECO_CATEGORY_A_TRAITER[r.status]) return 'a_traiter';
    if (RECO_CATEGORY_EN_ATTENTE[r.status]) return 'en_attente';
    return 'historique';
  }

  function _recoFiltersHtml() {
    var f = _recoFilters;
    var h = '<div class="ctavc-toolbar ctavc-hist-filters">';
    h += '<select class="fi" style="width:auto" onchange="MX.Pages.CtaVc._setRecoFilter(\'buildingId\', this.value)">' +
      '<option value=""' + (!f.buildingId ? ' selected' : '') + '>Tous bâtiments</option>' +
      _buildings.map(function (b) { return '<option value="' + b.id + '"' + (f.buildingId === b.id ? ' selected' : '') + '>' + MX.esc(b.name) + '</option>'; }).join('') +
      '<option value="none"' + (f.buildingId === 'none' ? ' selected' : '') + '>Non assigné</option></select>';
    h += '<select class="fi" style="width:auto" onchange="MX.Pages.CtaVc._setRecoFilter(\'circuitId\', this.value)">' +
      '<option value=""' + (!f.circuitId ? ' selected' : '') + '>Tous circuits</option>' +
      _circuits.map(function (c) { return '<option value="' + c.id + '"' + (f.circuitId === c.id ? ' selected' : '') + '>' + MX.esc(c.name) + '</option>'; }).join('') +
      '</select>';
    h += '<select class="fi" style="width:auto" onchange="MX.Pages.CtaVc._setRecoFilter(\'priority\', this.value)">' +
      '<option value=""' + (!f.priority ? ' selected' : '') + '>Toute priorité</option>' +
      '<option value="haute"' + (f.priority === 'haute' ? ' selected' : '') + '>Haute</option>' +
      '<option value="moyenne"' + (f.priority === 'moyenne' ? ' selected' : '') + '>Moyenne</option>' +
      '<option value="basse"' + (f.priority === 'basse' ? ' selected' : '') + '>Basse</option></select>';
    h += '<select class="fi" style="width:auto" onchange="MX.Pages.CtaVc._setRecoFilter(\'status\', this.value)">' +
      '<option value=""' + (!f.status ? ' selected' : '') + '>Tout statut</option>' +
      '<optgroup label="Cycle historique (v1)">' +
      Object.keys(RECO_STATUS_LABELS).map(function (s) { return '<option value="' + s + '"' + (f.status === s ? ' selected' : '') + '>' + RECO_STATUS_LABELS[s] + '</option>'; }).join('') +
      '</optgroup><optgroup label="Cycle quantitatif (v2)">' +
      Object.keys(PROP_STATUS_LABELS).map(function (s) { return '<option value="' + s + '"' + (f.status === s ? ' selected' : '') + '>' + PROP_STATUS_LABELS[s] + '</option>'; }).join('') +
      '</optgroup></select>';
    h += '<select class="fi" style="width:auto" onchange="MX.Pages.CtaVc._setRecoFilter(\'period\', this.value)">' +
      '<option value=""' + (!f.period ? ' selected' : '') + '>Toute période</option>' +
      '<option value="7"' + (f.period === '7' ? ' selected' : '') + '>7 jours</option>' +
      '<option value="30"' + (f.period === '30' ? ' selected' : '') + '>30 jours</option>' +
      '<option value="90"' + (f.period === '90' ? ' selected' : '') + '>90 jours</option></select>';
    h += '</div>';
    return h;
  }

  function _recoConstat(r) {
    if (r.engineVersion === 'v2') {
      var p = r.proposed || {};
      var parts = [];
      if (p.blow) parts.push('soufflage ' + p.blow.value + '°C');
      if (p.water) parts.push('eau ' + p.water.value + '°C');
      return parts.length ? parts.join(' · ') : (r.justification || '—');
    }
    return r.title || r.action || '—';
  }
  function _recoPriorityHtml(r) {
    if (r.engineVersion === 'v2') return '<span class="ctavc-pill" style="background:rgba(167,139,250,.15);color:#A78BFA">Confiance ' + MX.esc(r.confidence || '—') + '</span>';
    return '<span class="ctavc-pill ctavc-pill--' + (r.priority || 'basse') + '">' + (PRIORITY_LABELS[r.priority] || '—') + '</span>';
  }
  function _recoStatusLabel(r) {
    return r.engineVersion === 'v2' ? (PROP_STATUS_LABELS[r.status] || r.status) : (RECO_STATUS_LABELS[r.status] || r.status);
  }
  // Tableau compact — remplace le "sprawl" de cartes toujours développées.
  // Clic sur une ligne -> panneau de détail (_openRecoDetail), jamais tous
  // les détails affichés directement dans la liste.
  function _recoTableHtml(items, emptyLabel) {
    if (!items.length) return '<div class="ctavc-empty-inline">' + MX.esc(emptyLabel) + '</div>';
    var h = '<div class="ctavc-compact-table"><table><thead><tr><th>Circuit</th><th>Bâtiment</th><th>Constat</th><th>Priorité</th><th>Statut</th></tr></thead><tbody>';
    items.forEach(function (r) {
      var bId = _recoCircuitBuildingId(r.circuitId);
      h += '<tr class="ctavc-compact-row--clickable" onclick="MX.Pages.CtaVc._openRecoDetail(\'' + r.id + '\')">' +
        '<td>' + MX.esc(_circuitName(r.circuitId)) + '</td>' +
        '<td>' + (bId ? MX.esc(_buildingLabel(bId)) : '—') + '</td>' +
        '<td>' + MX.esc(_recoConstat(r)) + '</td>' +
        '<td>' + _recoPriorityHtml(r) + '</td>' +
        '<td><span class="ctavc-status-tag ctavc-status-tag--' + r.status + '">' + MX.esc(_recoStatusLabel(r)) + '</span></td>' +
      '</tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  // Panneau de détail — dataUsed/justification/missingData/utilisateurs
  // ayant traité, puis les actions correspondant EXACTEMENT au statut réel
  // de CE document (jamais une action proposée qui ne correspondrait pas à
  // son état réel). Les handlers appelés sont ceux déjà existants, aucune
  // réécriture de la logique de décision elle-même.
  function _openRecoDetail(id) {
    var r = _recommendations.find(function (x) { return x.id === id; });
    if (!r) return;
    var isV2 = r.engineVersion === 'v2';
    var bId = _recoCircuitBuildingId(r.circuitId);
    var body = '<div class="ctavc-form">';
    body += '<div class="ctavc-field-grid">';
    body += _fieldRow('Circuit', _circuitName(r.circuitId));
    body += _fieldRow('Bâtiment', bId ? _buildingLabel(bId) : null);
    body += _fieldRow('Statut', _recoStatusLabel(r));
    body += _fieldRow('Créée le', _fmtDateTime(r.createdAt));
    body += _fieldRow(isV2 ? 'Confiance' : 'Priorité', isV2 ? r.confidence : PRIORITY_LABELS[r.priority]);
    body += '</div>';
    body += '<div class="ctavc-detail-desc" style="margin-top:8px"><strong>Constat / Justification</strong><br>' + MX.esc(r.justification || '—') + '</div>';
    if (r.missingData && r.missingData.length) {
      body += '<div class="ctavc-hint-inline" style="margin-top:8px"><strong>Données manquantes :</strong> ' + r.missingData.map(MX.esc).join(', ') + '</div>';
    }
    if (r.dataUsed && Object.keys(r.dataUsed).length) {
      body += '<div class="ctavc-field-grid" style="margin-top:8px">';
      Object.keys(r.dataUsed).forEach(function (k) {
        var v = r.dataUsed[k];
        var vLabel = (v === null || v === undefined || v === '') ? null : (typeof v === 'object' ? JSON.stringify(v) : String(v));
        body += _fieldRow(k, vLabel);
      });
      body += '</div>';
    }
    var processors = [];
    if (r.decidedBy) processors.push('Décidée par ' + r.decidedBy);
    if (r.appliedBy) processors.push('Appliquée par ' + r.appliedBy + (typeof r.appliedValue === 'number' ? ' (' + r.appliedValue + '°C)' : ''));
    if (r.validatedBy) processors.push('Validée par ' + r.validatedBy);
    if (r.confirmedBy) processors.push('Consigne confirmée par ' + r.confirmedBy + (typeof r.confirmedValue === 'number' ? ' (' + r.confirmedValue + '°C)' : ''));
    if (r.controlledBy) processors.push('Contrôlée par ' + r.controlledBy);
    if (processors.length) body += '<div class="ctavc-hint-inline" style="margin-top:8px">' + processors.map(MX.esc).join(' · ') + '</div>';
    body += '</div>';

    MX.showModal({
      title: (isV2 ? 'Proposition DJU MX' : 'Recommandation') + ' — ' + _circuitName(r.circuitId),
      body: body, noAutoClose: true, actions: _recoDetailActions(r),
    });
  }

  // Boutons d'action du panneau de détail — appellent STRICTEMENT les
  // mêmes fonctions de décision que le reste du module (_decideReco,
  // _markApplied, _validateProposal, _refuseProposal, _openReportForm,
  // _openApplyForm, _openConfirmSetpointForm, _openControlReadingForm),
  // avec EXACTEMENT les mêmes conditions _canManage() qu'avant cette
  // refonte — jamais une permission élargie ou retirée ici.
  function _recoDetailActions(r) {
    var close = { label: 'Fermer', cls: 'cancel', fn: function () { MX.closeModal(); } };
    if (r.engineVersion === 'v2') {
      if (r.status === 'proposition_generee') {
        if (!_canManage()) return [close];
        return [
          { label: 'Valider', cls: 'primary-btn', fn: function () { MX.closeModal(); MX.Pages.CtaVc._validateProposal(r.id); } },
          { label: 'Programmer', cls: 'cso-ibtn', fn: function () { MX.closeModal(); MX.Pages.CtaVc._openReportForm(r.id); } },
          { label: 'Refuser', cls: 'cso-ibtn', fn: function () { MX.closeModal(); MX.Pages.CtaVc._refuseProposal(r.id); } },
          close,
        ];
      }
      if (r.status === 'validee') return [{ label: 'Réglage effectué', cls: 'primary-btn', fn: function () { MX.closeModal(); MX.Pages.CtaVc._openApplyForm(r.id); } }, close];
      if (r.status === 'reglage_effectue') return [{ label: 'Confirmer la consigne réelle', cls: 'primary-btn', fn: function () { MX.closeModal(); MX.Pages.CtaVc._openConfirmSetpointForm(r.id); } }, close];
      if (r.status === 'consigne_confirmee') return [{ label: 'Relevé de contrôle', cls: 'primary-btn', fn: function () { MX.closeModal(); MX.Pages.CtaVc._openControlReadingForm(r.id, r.circuitId); } }, close];
      return [close];
    }
    if (r.status === 'a_examiner') {
      if (!_canManage()) return [close];
      return [
        { label: 'Accepter', cls: 'primary-btn', fn: function () { MX.closeModal(); MX.Pages.CtaVc._decideReco(r.id, 'acceptee'); } },
        { label: 'Refuser', cls: 'cso-ibtn', fn: function () { MX.closeModal(); MX.Pages.CtaVc._decideReco(r.id, 'refusee'); } },
        close,
      ];
    }
    if (r.status === 'acceptee' && _canManage()) {
      return [{ label: 'Confirmer l\'application réelle', cls: 'primary-btn', fn: function () { MX.closeModal(); MX.Pages.CtaVc._markApplied(r.id); } }, close];
    }
    return [close];
  }

  function _recommendationsHtml() {
    var h = '';

    // Bloc "Candidats calculés maintenant" — comportement et markup
    // STRICTEMENT identiques à l'ancienne version (même filtre, mêmes
    // messages "météo en cours"/"rien à signaler", mêmes classes
    // .ctavc-reco-row/.ctavc-reco-row-actions) : ce bloc n'est PAS une vue
    // sur les documents persistés, donc pas concerné par les filtres
    // bâtiment/circuit/priorité/statut/période ci-dessous (qui portent sur
    // _recommendations, jamais sur les candidats live recalculés).
    var live = _ensureLiveRecos().filter(function (r) { return r.action !== 'maintenir'; });
    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-wand-magic-sparkles"></i> Candidats calculés maintenant' +
      '<button class="cso-ibtn" style="margin-left:auto" onclick="MX.Pages.CtaVc._refreshLiveRecos()"><i class="fas fa-rotate"></i> Recalculer</button></div>';
    if (!_weatherSeries) {
      h += '<div class="ctavc-empty-inline">Météo en cours de chargement…</div>';
    } else if (!live.length) {
      h += '<div class="ctavc-empty-inline">Rien à signaler sur les circuits actifs pour le moment.</div>';
    } else {
      h += '<div class="ctavc-reco-list">';
      live.forEach(function (r) { h += _liveRecoRow(r); });
      h += '</div>';
    }
    h += '</div>';

    h += _recoFiltersHtml();
    var filtered = _recommendations.filter(_recoMatchesFilters);
    var byCategory = { a_traiter: [], en_attente: [], historique: [] };
    filtered.forEach(function (r) { byCategory[_recoCategory(r)].push(r); });

    var sections = [
      ['a_traiter', 'fa-triangle-exclamation', 'À traiter', 'Aucune recommandation à traiter pour ces filtres.'],
      ['en_attente', 'fa-hourglass-half', 'En attente', 'Aucune recommandation en attente pour ces filtres.'],
      ['historique', 'fa-clock-rotate-left', 'Historique des décisions', 'Aucune décision enregistrée pour ces filtres.'],
    ];
    sections.forEach(function (sec) {
      var key = sec[0], icon = sec[1], label = sec[2], empty = sec[3];
      var items = byCategory[key];
      h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas ' + icon + '"></i> ' + label + ' (' + items.length + ')</div>';
      h += _recoTableHtml(items, empty);
      h += '</div>';
    });
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
    if (r.manualAction === false) return '<div class="ctavc-reco-row-pending"><i class="fas fa-eye"></i> Surveillance (bâtiment automatique)</div>';
    var key = r.circuitId + '|' + r.action;
    var persisted = _matchingAExaminer(r);
    if (persisted) {
      if (!_canManage()) return '<div class="ctavc-reco-row-pending">À examiner — décision réservée aux responsables/administrateurs</div>';
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
    // REFONTE CTA/VC : une recommandation v2 (engineVersion:'v2') utilise
    // ses propres libellés de statut (PROP_STATUS_LABELS, cycle à 5 états +
    // refusée/reportée/expirée) et sa propre justification/structure
    // (current/proposed) — jamais mélangée avec le rendu v1 ci-dessous,
    // qui reste strictement inchangé pour les documents v1 existants.
    if (r.engineVersion === 'v2') return _persistedProposalRow(r);
    var h = '<div class="ctavc-reco-row">' +
      '<span class="ctavc-pill ctavc-pill--' + (r.priority || 'basse') + '">' + (PRIORITY_LABELS[r.priority] || '—') + '</span>' +
      '<div class="ctavc-reco-row-body">' +
        '<div class="ctavc-reco-row-title">' + MX.esc(_circuitName(r.circuitId)) + ' — ' + MX.esc(r.title || r.action || '') +
          ' <span class="ctavc-status-tag ctavc-status-tag--' + r.status + '">' + (RECO_STATUS_LABELS[r.status] || r.status) + '</span></div>' +
        '<div class="ctavc-reco-row-just">' + MX.esc(r.justification || '') + '</div>' +
        '<div class="ctavc-reco-row-meta">Créée ' + _fmtDateTime(r.createdAt) + (r.decidedBy ? ' · décidée par ' + MX.esc(r.decidedBy) : '') + (r.appliedBy ? ' · appliquée par ' + MX.esc(r.appliedBy) : '') + '</div>' +
      '</div>';
    if (r.status === 'a_examiner' && _canManage()) {
      h += '<div class="ctavc-reco-row-actions">' +
        '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._decideReco(\'' + r.id + '\',\'acceptee\')" title="Accepter"><i class="fas fa-check"></i></button>' +
        '<button class="cso-ibtn" onclick="MX.Pages.CtaVc._decideReco(\'' + r.id + '\',\'refusee\')" title="Refuser"><i class="fas fa-xmark"></i></button>' +
      '</div>';
    } else if (r.status === 'acceptee' && _canManage()) {
      h += '<div class="ctavc-reco-row-actions"><button class="cso-ibtn" onclick="MX.Pages.CtaVc._markApplied(\'' + r.id + '\')" title="Confirmer l\'application réelle"><i class="fas fa-screwdriver-wrench"></i> Appliquée</button></div>';
    }
    h += '</div>';
    return h;
  }
  function _persistedProposalRow(r) {
    var c = r.current || {}, p = r.proposed || {};
    // CORRECTION 2 : affiche séparément soufflage et eau de batterie quand
    // les deux sont présents (CTA) — jamais une valeur fusionnée.
    var parts = [];
    if (p.blow) parts.push('soufflage ' + (typeof c.blowTemp === 'number' ? c.blowTemp + '°C → ' : '') + p.blow.value + '°C' + (p.blow.capped ? ' (plafonnée)' : ''));
    if (p.water) parts.push('eau ' + (typeof c.waterTemp === 'number' ? c.waterTemp + '°C → ' : '') + p.water.value + '°C' + (p.water.capped ? ' (plafonnée)' : ''));
    // CORRECTION PRIORITAIRE : badge visible ici aussi (historique/recommandations
    // persistées), pas seulement sur la vue d'ensemble — voir _compareRowHtml.
    var capWarnings = [];
    if (p.blow && p.blow.capped) capWarnings.push('<div class="ctavc-cap-warning' + (p.blow.overshoot ? ' ctavc-cap-warning--power' : '') + '"><i class="fas fa-triangle-exclamation"></i> Soufflage limité — ' + MX.esc(p.blow.capLabel || '') + (p.blow.overshoot ? ' · puissance possiblement insuffisante' : '') + '</div>');
    if (p.water && p.water.capped) capWarnings.push('<div class="ctavc-cap-warning' + (p.water.overshoot ? ' ctavc-cap-warning--power' : '') + '"><i class="fas fa-triangle-exclamation"></i> Eau de batterie limitée — ' + MX.esc(p.water.capLabel || '') + (p.water.overshoot ? ' · puissance possiblement insuffisante' : '') + '</div>');
    var h = '<div class="ctavc-reco-row">' +
      '<span class="ctavc-pill ctavc-pill--' + (r.confidence === 'faible' ? 'basse' : r.confidence === 'haute' ? 'haute' : 'moyenne') + '">Confiance ' + (r.confidence || '—') + '</span>' +
      '<div class="ctavc-reco-row-body">' +
        '<div class="ctavc-reco-row-title">' + MX.esc(_circuitName(r.circuitId)) +
          ' — ' + MX.esc(parts.join(' · ')) +
          ' <span class="ctavc-status-tag ctavc-status-tag--' + r.status + '">' + (PROP_STATUS_LABELS[r.status] || r.status) + '</span></div>' +
        '<div class="ctavc-reco-row-just">' + MX.esc(r.justification || '') + '</div>' +
        capWarnings.join('') +
        '<div class="ctavc-reco-row-meta">Créée ' + _fmtDateTime(r.createdAt) +
          (r.validatedBy ? ' · validée par ' + MX.esc(r.validatedBy) : '') +
          (r.appliedBy ? ' · réglage par ' + MX.esc(r.appliedBy) + (typeof r.appliedValue === 'number' ? ' (' + r.appliedValue + '°C)' : '') : '') +
          (r.confirmedBy ? ' · consigne confirmée par ' + MX.esc(r.confirmedBy) + (typeof r.confirmedValue === 'number' ? ' (' + r.confirmedValue + '°C)' : '') : '') +
          (r.controlledBy ? ' · contrôlée par ' + MX.esc(r.controlledBy) : '') +
        '</div>' +
      '</div></div>';
    return h;
  }

  // Transition d'une recommandation déjà persistée (statut 'a_examiner')
  // vers une décision humaine — n'écrit JAMAIS un nouveau document : c'est
  // le même document qui passe de 'a_examiner' à 'acceptee'/'refusee', pour
  // qu'il n'existe jamais deux entrées Firestore pour le même candidat.
  function _decideReco(id, status) {
    if (!_canManage()) { _denyManage(); return; }
    MX.DB.setHeatingRecommendationStatus(id, status, _currentUserName()).then(function () {
      MX.toast(status === 'acceptee' ? 'Recommandation acceptée' : 'Recommandation refusée');
    }).catch(function (e) {
      MX.toast('Erreur d\'enregistrement (permissions Firestore probablement non configurées) : ' + (e.message || e), true);
    });
  }
  function _markApplied(id) {
    if (!_canManage()) { _denyManage(); return; }
    if (!confirm('Confirmer que ce réglage a réellement été appliqué sur l\'installation ?')) return;
    MX.DB.setHeatingRecommendationStatus(id, 'appliquee', _currentUserName(), { appliedAt: firebase.firestore.FieldValue.serverTimestamp(), appliedBy: _currentUserName() }).then(function () {
      MX.toast('Marquée comme appliquée');
    }).catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }

  // ════════════════════════════════════ HISTORIQUE & ANALYSE ════════════════════════════════════
  // REFONTE CTA/VC — filtres d'historique (bâtiment/type/période). Purement
  // côté client, sur les listes déjà chargées (_recommendations/_readings)
  // — aucune nouvelle requête Firestore, aucune donnée supplémentaire
  // demandée au-delà des limites déjà en place (listenHeatingReadings
  // limit(500), listenHeatingRecommendations limit(300)).
  function _setHistoryFilter(key, val) { _historyFilters[key] = val; render(); }
  function _withinPeriod(ts, days) {
    if (!days) return true; // '' = toutes périodes
    var ms = _tsToMs(ts); if (ms === null) return true;
    return (Date.now() - ms) <= (parseInt(days, 10) * 24 * 60 * 60 * 1000);
  }
  function _tsToMs(ts) {
    if (!ts) return null;
    if (ts.toMillis) return ts.toMillis();
    if (ts.toDate) return ts.toDate().getTime();
    var d = new Date(ts); return isNaN(d.getTime()) ? null : d.getTime();
  }
  // Filtre utilisé par l'historique des RECOMMANDATIONS (inchangé depuis
  // avant la Phase 3) — une recommandation est toujours liée à un circuit,
  // jamais à une zone, donc aucune notion de "type de mesure"/"zone" ici.
  function _matchesFilters(circuitId, ts) {
    var f = _historyFilters;
    if (f.buildingId || f.type) {
      var c = _circuits.find(function (x) { return x.id === circuitId; });
      if (!c) return false;
      if (f.buildingId === 'none' ? !!c.buildingId : (f.buildingId && c.buildingId !== f.buildingId)) return false;
      if (f.type && c.type !== f.type) return false;
    }
    if (f.circuitId && circuitId !== f.circuitId) return false;
    return _withinPeriod(ts, f.period);
  }
  function _roomName(id) {
    var r = _rooms.find(function (x) { return x.id === id; });
    return r ? r.name : 'Zone supprimée';
  }
  // REFONTE CTA/VC Phase 3 — filtre du tableau de relevés UNIFIÉ (installations
  // + zones, même collection heating_readings, distinguées par circuitId XOR
  // roomId — voir db.js:addRoomReading). Un relevé de zone ne porte ni
  // "type" (cta/vc/autre, propriété du CIRCUIT) ni circuitId : les filtres
  // type/circuitId l'excluent donc naturellement, jamais une correspondance
  // par défaut trompeuse. `period` (days, optionnel) permet de réutiliser
  // cette même fonction pour le mode "comparaison deux périodes" (Période
  // A/B), sans dupliquer la logique de filtrage entité/zone/type.
  // "Type de mesure" réel : structure du relevé (simple vs 2 points), pas
  // l'entité qui l'a produit — voir correction ci-dessus. Combinable
  // indépendamment avec circuitId/roomId (ex. "zones + relevés à 2 points"
  // renvoie toujours 0 résultat aujourd'hui puisqu'addRoomReading n'écrit
  // jamais points, mais ce n'est pas un bug : c'est un fait réel des
  // données, jamais masqué ni forcé).
  function _isTwoPointReading(r) { return !!(r.points && r.points.point1 && r.points.point2); }
  function _matchesReadingFilters(r, overridePeriodDays) {
    var f = _historyFilters;
    var isZone = !!r.roomId;
    if (f.measureType === 'simple' && _isTwoPointReading(r)) return false;
    if (f.measureType === 'deux_points' && !_isTwoPointReading(r)) return false;
    if (isZone) {
      if (f.circuitId) return false; // un relevé de zone n'a pas de circuit propre
      if (f.type) return false; // "type" (cta/vc/autre) ne concerne que les circuits
      if (f.roomId && r.roomId !== f.roomId) return false;
      if (f.buildingId) {
        var room = _rooms.find(function (x) { return x.id === r.roomId; });
        var rbId = room ? room.buildingId : null;
        if (f.buildingId === 'none' ? !!rbId : rbId !== f.buildingId) return false;
      }
    } else {
      if (f.roomId) return false; // un relevé d'installation n'a pas de zone propre
      if (f.circuitId && r.circuitId !== f.circuitId) return false;
      if (f.buildingId || f.type) {
        var c = _circuits.find(function (x) { return x.id === r.circuitId; });
        if (!c) return false;
        if (f.buildingId === 'none' ? !!c.buildingId : (f.buildingId && c.buildingId !== f.buildingId)) return false;
        if (f.type && c.type !== f.type) return false;
      }
    }
    return _withinPeriod(r.recordedAt, overridePeriodDays !== undefined ? overridePeriodDays : f.period);
  }
  function _readingEntityLabel(r) {
    return r.roomId ? ('Zone — ' + _roomName(r.roomId)) : ('Installation — ' + _circuitName(r.circuitId));
  }
  function _setHistoryCompare(checked) { _historyCompareEnabled = !!checked; render(); }
  function _setHistoryCompareDays(which, val) {
    var days = parseInt(val, 10) || 1;
    if (which === 'A') _historyCompareDaysA = days; else _historyCompareDaysB = days;
    render();
  }
  function _historyFiltersHtml() {
    var f = _historyFilters;
    var h = '<div class="ctavc-toolbar ctavc-hist-filters">';
    h += '<select class="fi" style="width:auto" onchange="MX.Pages.CtaVc._setHistoryFilter(\'buildingId\', this.value)">' +
      '<option value=""' + (!f.buildingId ? ' selected' : '') + '>Tous bâtiments</option>' +
      _buildings.map(function (b) { return '<option value="' + b.id + '"' + (f.buildingId === b.id ? ' selected' : '') + '>' + MX.esc(b.name) + '</option>'; }).join('') +
      '<option value="none"' + (f.buildingId === 'none' ? ' selected' : '') + '>Non assigné</option></select>';
    h += '<select class="fi" style="width:auto" onchange="MX.Pages.CtaVc._setHistoryFilter(\'circuitId\', this.value)">' +
      '<option value=""' + (!f.circuitId ? ' selected' : '') + '>Toute installation / circuit</option>' +
      _circuits.map(function (c) { return '<option value="' + c.id + '"' + (f.circuitId === c.id ? ' selected' : '') + '>' + MX.esc(c.name) + '</option>'; }).join('') +
      '</select>';
    h += '<select class="fi" style="width:auto" onchange="MX.Pages.CtaVc._setHistoryFilter(\'roomId\', this.value)">' +
      '<option value=""' + (!f.roomId ? ' selected' : '') + '>Toute zone</option>' +
      _rooms.map(function (r) { return '<option value="' + r.id + '"' + (f.roomId === r.id ? ' selected' : '') + '>' + MX.esc(r.name) + '</option>'; }).join('') +
      '</select>';
    h += '<select class="fi" style="width:auto" onchange="MX.Pages.CtaVc._setHistoryFilter(\'measureType\', this.value)">' +
      '<option value=""' + (!f.measureType ? ' selected' : '') + '>Tout type de mesure</option>' +
      '<option value="simple"' + (f.measureType === 'simple' ? ' selected' : '') + '>Relevé simple</option>' +
      '<option value="deux_points"' + (f.measureType === 'deux_points' ? ' selected' : '') + '>Relevé à 2 points (réseau CTA/VC)</option></select>';
    h += '<select class="fi" style="width:auto" onchange="MX.Pages.CtaVc._setHistoryFilter(\'type\', this.value)">' +
      '<option value=""' + (!f.type ? ' selected' : '') + '>Tous types</option>' +
      '<option value="cta"' + (f.type === 'cta' ? ' selected' : '') + '>CTA</option>' +
      '<option value="vc"' + (f.type === 'vc' ? ' selected' : '') + '>VC</option>' +
      '<option value="reseau_chauffage"' + (f.type === 'reseau_chauffage' ? ' selected' : '') + '>Réseau de chauffage</option>' +
      '<option value="autre"' + (f.type === 'autre' ? ' selected' : '') + '>Autre</option></select>';
    h += '<select class="fi" style="width:auto" onchange="MX.Pages.CtaVc._setHistoryFilter(\'period\', this.value)">' +
      '<option value=""' + (!f.period ? ' selected' : '') + '>Toute période</option>' +
      '<option value="7"' + (f.period === '7' ? ' selected' : '') + '>7 jours</option>' +
      '<option value="30"' + (f.period === '30' ? ' selected' : '') + '>30 jours</option>' +
      '<option value="90"' + (f.period === '90' ? ' selected' : '') + '>90 jours</option></select>';
    h += '</div>';
    h += '<div class="ctavc-toolbar ctavc-hist-compare-toggle">' +
      '<label class="ctavc-check-inline"><input type="checkbox" ' + (_historyCompareEnabled ? 'checked' : '') + ' onchange="MX.Pages.CtaVc._setHistoryCompare(this.checked)"> Comparer deux périodes</label>';
    if (_historyCompareEnabled) {
      h += ' Période A : <input type="number" min="1" class="fi" style="width:70px" value="' + _historyCompareDaysA + '" onchange="MX.Pages.CtaVc._setHistoryCompareDays(\'A\', this.value)"> jours' +
        ' — Période B : <input type="number" min="1" class="fi" style="width:70px" value="' + _historyCompareDaysB + '" onchange="MX.Pages.CtaVc._setHistoryCompareDays(\'B\', this.value)"> jours';
    }
    h += '</div>';
    return h;
  }

  // REFONTE CTA/VC Phase 3 — statistiques (computeReadingStats, pure,
  // heating-engine.js) sur un jeu de relevés déjà filtré côté client,
  // jamais calculées silencieusement sous le seuil minimal (2 relevés).
  function _readingStatsBlockHtml(readings, title) {
    var stats = MX.HeatingEngine.computeReadingStats(readings);
    // Réutilise le pattern KPI déjà introduit en Phase 1 (.ctavc-kpi-band/
    // .ctavc-kpi-tile) plutôt que d'inventer un nouveau système de grille —
    // aucune nouvelle palette, seulement les variables de thème existantes.
    var h = '<div class="ctavc-stats-block">';
    if (title) h += '<div class="ctavc-hint-inline" style="font-weight:700;margin-bottom:6px">' + MX.esc(title) + '</div>';
    // "Dernier relevé enregistré" (lastRecordedMs) — TOUJOURS affiché,
    // indépendamment du seuil minimal des statistiques de température :
    // une seule saisie, même sans température exploitable, répond déjà à
    // "quand a-t-on relevé pour la dernière fois ?". Jamais fusionné avec
    // "Dernière température exploitable" ci-dessous (voir heating-engine.js
    // :computeReadingStats). Donnée manquante -> texte explicite, jamais 0
    // ni une date inventée.
    h += '<div class="ctavc-hint-inline" style="margin-bottom:6px">Dernier relevé enregistré : ' +
      (stats.lastRecordedMs !== null ? MX.esc(_fmtDateTime(stats.lastRecordedMs)) : 'Aucun relevé enregistré') + '</div>';
    // "Dernière température exploitable" (stats.last) — TOUJOURS affichée
    // dès qu'au moins UN relevé exploitable existe, jamais gatée par le
    // seuil minimal de moyenne/min/max (une seule valeur valide suffit à
    // la connaître — voir heating-engine.js:computeReadingStats). Reste
    // strictement distincte de "Dernier relevé enregistré" ci-dessus.
    h += '<div class="ctavc-hint-inline" style="margin-bottom:6px">Dernière température exploitable : ' +
      (stats.last !== null ? stats.last + '°C' : 'Aucune température exploitable') + '</div>';
    if (stats.insufficientData) {
      h += '<div class="ctavc-empty-inline">Historique insuffisant pour la moyenne/min/max : ' + stats.count + ' relevé(s) exploitable(s), ' + stats.minCount + ' requis au minimum.</div>';
    } else {
      h += '<div class="ctavc-kpi-band">' +
        '<div class="ctavc-kpi-tile ctavc-kpi-tile--cyan"><div class="ctavc-kpi-tile-val">' + stats.mean + '°C</div><div class="ctavc-kpi-tile-lbl">Moyenne</div></div>' +
        '<div class="ctavc-kpi-tile"><div class="ctavc-kpi-tile-val">' + stats.min + '°C</div><div class="ctavc-kpi-tile-lbl">Min</div></div>' +
        '<div class="ctavc-kpi-tile"><div class="ctavc-kpi-tile-val">' + stats.max + '°C</div><div class="ctavc-kpi-tile-lbl">Max</div></div>' +
        '<div class="ctavc-kpi-tile"><div class="ctavc-kpi-tile-val">' + stats.count + '</div><div class="ctavc-kpi-tile-lbl">Nombre de relevés</div></div>' +
      '</div>';
    }
    return h + '</div>';
  }
  // Comparaison deux périodes — DEUX panneaux de statistiques indépendants
  // (jamais un seul chiffre fusionné, jamais une évolution calculée quand
  // l'une des deux fenêtres est insuffisante), clairement labellisés
  // "Période A"/"Période B" (jamais superposés sans légende distincte).
  // Réutilise le même jeu filtré bâtiment/circuit/zone/type de mesure que
  // le tableau — seule la fenêtre temporelle change entre A et B.
  function _historyCompareHtml(entityFilteredReadings) {
    var readingsA = entityFilteredReadings.filter(function (r) { return _withinPeriod(r.recordedAt, _historyCompareDaysA); });
    var readingsB = entityFilteredReadings.filter(function (r) { return _withinPeriod(r.recordedAt, _historyCompareDaysB); });
    var statsA = MX.HeatingEngine.computeReadingStats(readingsA);
    var statsB = MX.HeatingEngine.computeReadingStats(readingsB);
    var h = '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-scale-balanced"></i> Comparaison deux périodes</div>';
    h += '<div class="ctavc-compare-grid">' +
      _readingStatsBlockHtml(readingsA, 'Période A (derniers ' + _historyCompareDaysA + ' jours)') +
      _readingStatsBlockHtml(readingsB, 'Période B (derniers ' + _historyCompareDaysB + ' jours)') +
    '</div>';
    if (!statsA.insufficientData && !statsB.insufficientData) {
      var delta = _r1(statsB.mean - statsA.mean);
      h += '<div class="ctavc-hint-inline" style="margin-top:8px">Évolution de la moyenne (B − A) : ' + (delta > 0 ? '+' : '') + delta + '°C</div>';
    }
    h += '</div>';
    return h;
  }

  // ── REFONTE CTA/VC — graphiques : rendu délégué à MX.Charts.lineChart
  // (assets/js/utils/charts.js), module SVG partagé avec le reste de
  // l'application (tooltips, légende cliquable, échelle jamais basée sur
  // zéro, coupure du tracé sur donnée manquante ou écart temporel > 7
  // jours — voir le module pour le détail). Purement dérivé des données
  // déjà chargées, jamais une donnée supplémentaire demandée au serveur
  // pour le seul graphique. ──
  function _djuChartHtml() {
    if (!_weatherSeries || !_weatherSeries.length) return '<div class="ctavc-empty-inline">Météo en cours de chargement…</div>';
    var labels = _weatherSeries.map(function (d) { return d.date.slice(5); });
    var ts = _weatherSeries.map(function (d) { var t = new Date(d.date + 'T00:00:00'); return isNaN(t.getTime()) ? null : t.getTime(); });
    var base = _effectiveDjuBaseTemp();
    var series = [
      { label: 'DJU19 (historique, fixe)', color: 'var(--cyan)', vals: _weatherSeries.map(function (d) { return d.dju19; }), labels: labels, ts: ts },
    ];
    if (base !== (MX.Dju ? MX.Dju.BASE_TEMP : 19)) {
      series.push({ label: 'DJU référence configurée (' + base + '°C)', color: 'var(--orange)', vals: _weatherSeries.map(function (d) { return d.dju; }), labels: labels, ts: ts });
    }
    return MX.Charts.lineChart(series, { id: 'ctavc-hist-dju-chart', unit: 'DJU' });
  }

  function _tempsChartHtml(filteredReadings) {
    var withTemp = filteredReadings.filter(function (r) { return typeof r.temp === 'number' || (r.points && r.points.point1); }).slice(0, 60).reverse();
    var labels = withTemp.map(function (r) { var d = r.recordedAt && r.recordedAt.toDate ? r.recordedAt.toDate() : new Date(r.recordedAt || 0); return isNaN(d.getTime()) ? '—' : (d.getDate() + '/' + (d.getMonth() + 1)); });
    var ts = withTemp.map(function (r) { return _tsToMs(r.recordedAt); });
    var series = [
      { label: 'Température eau / ambiante relevée', color: 'var(--cyan)', labels: labels, ts: ts, vals: withTemp.map(function (r) {
        if (typeof r.temp === 'number') return r.temp;
        if (r.points && r.points.point1) return (r.points.point1.waterTemp + r.points.point2.waterTemp) / 2;
        return null;
      }) },
    ];
    return MX.Charts.lineChart(series, {
      id: 'ctavc-hist-temps-chart',
      minPoints: 2,
      insufficientReason: 'Pas assez de relevés pour tracer une évolution (' + withTemp.length + ' disponible(s), 2 requis au minimum).',
    });
  }

  function _historyHtml() {
    var h = _historyFiltersHtml();
    var baseTemp = _effectiveDjuBaseTemp();
    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-cloud-sun"></i> Températures extérieures & DJU' +
      (baseTemp !== (MX.Dju ? MX.Dju.BASE_TEMP : 19) ? ' <span class="ctavc-hint-inline">(référence configurée : ' + baseTemp + '°C — DJU19 historique conservé ci-contre)</span>' : '') + '</div>';
    if (!_weatherSeries) {
      h += '<div class="ctavc-empty-inline">Météo en cours de chargement…</div>';
    } else {
      h += '<div class="ctavc-hist-table"><table><thead><tr><th>Date</th><th>Min/Max</th><th>DJU19</th><th>DJU (réf. ' + baseTemp + '°C)</th><th>Statut</th></tr></thead><tbody>';
      _weatherSeries.forEach(function (d) {
        h += '<tr><td>' + d.date + '</td><td>' + (d.tMin !== null ? Math.round(d.tMin) : '—') + '° / ' + (d.tMax !== null ? Math.round(d.tMax) : '—') + '°</td>' +
          '<td>' + (d.dju19 !== null ? d.dju19.toFixed(1) : '—') + '</td>' +
          '<td>' + (typeof d.dju === 'number' ? d.dju.toFixed(1) : '—') + '</td>' +
          '<td><span class="ctavc-quality-tag ctavc-quality-tag--' + (d.kind === 'missing' ? 'manquant' : d.kind === 'observed' ? 'complet' : 'provisoire') + '">' +
            (d.kind === 'observed' ? 'Observé' : d.kind === 'forecast' ? 'Prévisionnel' : 'Manquant') + '</span></td></tr>';
      });
      h += '</tbody></table></div>';
      h += '<div class="ctavc-hint">Historique limité aux jours renvoyés par Open-Meteo (jusqu\'à 7 jours passés) — aucune valeur antérieure à la mise en service de ce suivi n\'est affichée ou inventée. La colonne DJU19 reste figée à 19°C (historique), jamais recalculée.</div>';
    }
    h += '</div>';

    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-chart-line"></i> Graphique — évolution DJU</div>' + _djuChartHtml() + '</div>';

    // REFONTE CTA/VC Phase 3 — tableau de relevés UNIFIÉ : installations
    // (circuitId) ET zones thermiques (roomId), même collection
    // heating_readings (voir _matchesReadingFilters ci-dessus). Avant cette
    // phase, un relevé de zone sans bâtiment/type de circuit actif pouvait
    // silencieusement apparaître ici sous "Circuit supprimé" — désormais il
    // est identifié explicitement ("Zone — <nom>"), jamais masqué ni
    // mal‑étiqueté.
    var filteredReadings = _readings.filter(function (r) { return _matchesReadingFilters(r); });
    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-chart-line"></i> Graphique — évolution des températures relevées (filtres actifs)</div>' + _tempsChartHtml(filteredReadings) + '</div>';

    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-chart-simple"></i> Statistiques (filtres actifs)</div>' + _readingStatsBlockHtml(filteredReadings, 'Période sélectionnée') + '</div>';

    if (_historyCompareEnabled) {
      h += _historyCompareHtml(filteredReadings);
    }

    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-thermometer-half"></i> Relevés (' + filteredReadings.length + ')</div>';
    if (!filteredReadings.length) {
      h += '<div class="ctavc-empty-inline">Aucun relevé enregistré pour ces filtres.</div>';
    } else {
      h += '<div class="ctavc-hist-table"><table><thead><tr><th>Date</th><th>Installation / Zone</th><th>Mesure</th><th>Auteur</th></tr></thead><tbody>';
      filteredReadings.slice(0, 100).forEach(function (r) {
        var mesure = r.points
          ? ('P1 ' + r.points.point1.waterTemp + '°C/' + r.points.point1.blowTemp + '°C/' + r.points.point1.ambientTemp + '°C · P2 ' + r.points.point2.waterTemp + '°C/' + r.points.point2.blowTemp + '°C/' + r.points.point2.ambientTemp + '°C')
          : (r.temp + ' °C');
        h += '<tr><td>' + _fmtDateTime(r.recordedAt) + '</td><td>' + MX.esc(_readingEntityLabel(r)) + '</td><td>' + mesure + '</td><td>' + (r.author ? MX.esc(r.author) : '—') + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';

    var filteredRecos = _recommendations.filter(function (r) { return _matchesFilters(r.circuitId, r.createdAt); });
    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-clock-rotate-left"></i> Historique des recommandations (' + filteredRecos.length + ')</div>';
    if (!filteredRecos.length) {
      h += '<div class="ctavc-empty-inline">Aucune recommandation enregistrée pour ces filtres.</div>';
    } else {
      h += '<div class="ctavc-reco-list">';
      filteredRecos.slice(0, 100).forEach(function (r) { h += _persistedRecoRow(r); });
      h += '</div>';
    }
    h += '</div>';

    h += '<div class="ctavc-hint"><i class="fas fa-circle-info"></i> Aucun gain énergétique chiffré n\'est calculé ici : Maintix ne dispose d\'aucun relevé de consommation électrique fiable associé au chauffage. Les cartes ci-dessus indiquent des tendances, jamais des économies mesurées.</div>';
    return h;
  }

  // ════════════════════════════════════ CONFIGURATION ════════════════════════════════════
  // REFONTE CTA/VC Phase 4 — "Configuration CTA/VC compacte". Réorganisée
  // en 3 sections repliables (DJU/plages par défaut, limites eau de
  // batterie CTA — avancé/facultatif, circuits), pour une présentation
  // plus claire et compacte — AUCUN champ, AUCUNE logique de sauvegarde
  // retirée ou déplacée : tous les <input> gardent exactement les mêmes
  // id, lus à l'identique par _saveHeatingConfigForm() (getElementById
  // fonctionne qu'une section <details> soit ouverte ou fermée — seul
  // l'affichage change, jamais la présence DOM du champ).
  function _configHtml() {
    if (!_canManage()) return '<div class="ctavc-card"><p>Accès réservé aux responsables et administrateurs.</p></div>';
    var cfg = _heatingConfig || {};
    var heDefaults = (window.MX && MX.HeatingEngine) ? MX.HeatingEngine : { CTA_DEFAULT_MIN: 18, CTA_DEFAULT_MAX: 22, VC_HARD_CAP: 50 };
    var h = '';

    h += _collapsibleOpenTag('general', 'fa-sliders', 'Référence DJU & plages par défaut');
    h += '<div class="ctavc-form">';
    h += '<label>Référence DJU ("DJU MX", °C — recalcul non destructif, l\'historique brut n\'est jamais réécrit)</label>' +
      '<input id="ctavc-cfg-djubase" class="fi" type="number" step="0.5" value="' + (typeof cfg.djuBaseTemp === 'number' ? cfg.djuBaseTemp : (MX.Dju ? MX.Dju.BASE_TEMP : 19)) + '">';
    h += '<label>Plage CTA par défaut (°C)</label><div style="display:flex;gap:8px">' +
      '<input id="ctavc-cfg-ctamin" class="fi" type="number" step="0.5" placeholder="Min" value="' + (typeof cfg.ctaRangeMin === 'number' ? cfg.ctaRangeMin : heDefaults.CTA_DEFAULT_MIN) + '">' +
      '<input id="ctavc-cfg-ctamax" class="fi" type="number" step="0.5" placeholder="Max" value="' + (typeof cfg.ctaRangeMax === 'number' ? cfg.ctaRangeMax : heDefaults.CTA_DEFAULT_MAX) + '"></div>';
    h += '<label>Plafond VC par défaut (°C — jamais au-delà de 50°C, même ici)</label>' +
      '<input id="ctavc-cfg-vcmax" class="fi" type="number" step="0.5" max="50" value="' + (typeof cfg.vcMaxTemp === 'number' ? cfg.vcMaxTemp : heDefaults.VC_HARD_CAP) + '">';
    h += '</div>';
    h += _fieldRow('Méthode DJU', 'max(0, référence − température moyenne journalière estimée) — voir assets/js/utils/dju.js');
    h += _fieldRow('Source météo', 'Open-Meteo (partagée avec l\'Accueil, même configuration de localisation)');
    h += _collapsibleCloseTag();

    // CORRECTION PRIORITAIRE (inchangée) : limites générales d'eau de
    // batterie CTA — utilisées par le moteur UNIQUEMENT si l'installation
    // elle-même n'a pas ses propres limites (voir
    // MX.HeatingEngine._clampCtaWater), jamais prioritaires sur une limite
    // d'installation déjà renseignée. Indépendantes de la plage de
    // soufflage ci-dessus (eau ≠ air). Repliée par défaut (facultatif,
    // "avancé") — seule section fermée par défaut, jamais testée
    // directement par un test existant (vérifié avant implémentation).
    h += _collapsibleOpenTag('advanced', 'fa-droplet', 'Limites eau de batterie CTA (avancé, facultatif)');
    h += '<div class="ctavc-form">';
    h += '<label>Limites générales — eau de batterie CTA (°C, facultatif — utilisées seulement si l\'installation n\'a pas ses propres limites)</label><div style="display:flex;gap:8px">' +
      '<input id="ctavc-cfg-ctawatermin" class="fi" type="number" step="0.5" placeholder="Min" value="' + (typeof cfg.ctaWaterTempMin === 'number' ? cfg.ctaWaterTempMin : '') + '">' +
      '<input id="ctavc-cfg-ctawatermax" class="fi" type="number" step="0.5" placeholder="Max" value="' + (typeof cfg.ctaWaterTempMax === 'number' ? cfg.ctaWaterTempMax : '') + '"></div>';
    h += '</div>';
    h += _collapsibleCloseTag();

    // Bouton de sauvegarde UNIQUE, partagé par les deux sections ci-dessus
    // (hors des <details> : toujours visible, enregistre tous les champs
    // des deux sections quel que soit leur état ouvert/fermé).
    h += '<button class="primary-btn" style="width:auto;margin:4px 0 12px" onclick="MX.Pages.CtaVc._saveHeatingConfigForm()"><i class="fas fa-floppy-disk"></i> Enregistrer la configuration</button>';

    h += _collapsibleOpenTag('circuitsMgmt', 'fa-diagram-project', 'Circuits — création et gestion (' + _circuits.length + ')');
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
    h += '</div>';
    h += _collapsibleCloseTag();
    return h;
  }

  function _saveHeatingConfigForm() {
    if (!_canManage()) { _denyManage(); return; }
    var base = _numOrNull('ctavc-cfg-djubase');
    var ctaMin = _numOrNull('ctavc-cfg-ctamin');
    var ctaMax = _numOrNull('ctavc-cfg-ctamax');
    var vcMax = _numOrNull('ctavc-cfg-vcmax');
    var ctaWaterMin = _numOrNull('ctavc-cfg-ctawatermin');
    var ctaWaterMax = _numOrNull('ctavc-cfg-ctawatermax');
    if (base !== null && base <= 0) { MX.toast('Référence DJU invalide', true); return; }
    if (ctaMin !== null && ctaMax !== null && ctaMin >= ctaMax) { MX.toast('Plage CTA invalide (min >= max)', true); return; }
    if (ctaWaterMin !== null && ctaWaterMax !== null && ctaWaterMin >= ctaWaterMax) { MX.toast('Limites générales eau de batterie invalides (min >= max)', true); return; }
    // Plafond VC JAMAIS au-delà de 50°C ici non plus — revalidé en plus de
    // l'attribut max="50" de l'input (qui ne protège pas d'une manipulation
    // directe du DOM/de la console).
    if (vcMax !== null && vcMax > 50) { MX.toast('Le plafond VC ne peut pas dépasser 50°C', true); return; }
    MX.DB.saveHeatingConfig({
      djuBaseTemp: base, ctaRangeMin: ctaMin, ctaRangeMax: ctaMax, vcMaxTemp: vcMax,
      ctaWaterTempMin: ctaWaterMin, ctaWaterTempMax: ctaWaterMax,
    }).then(function () {
      MX.toast('Configuration enregistrée');
    }).catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }

  // ── ENTRY POINT + EXPORT ──
  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.CtaVc = {
    render: render, _destroy: _destroy, _setTab: _setTab,
    _toggleShowArchived: _toggleShowArchived, _openCircuitDetail: _openCircuitDetail,
    _openCircuitForm: _openCircuitForm, _submitCircuitForm: _submitCircuitForm, _onRegTypeChange: _onRegTypeChange,
    _onCircuitTypeChange: _onCircuitTypeChange,
    _confirmArchive: _confirmArchive,
    _openReadingForm: _openReadingForm, _submitReadingForm: _submitReadingForm, _onReadingModeToggle: _onReadingModeToggle,
    _refreshLiveRecos: _refreshLiveRecos, _decideReco: _decideReco, _retrySyncReco: _retrySyncReco, _markApplied: _markApplied,
    // REFONTE CTA/VC — cycle de validation v2 (quantitatif)
    _validateProposal: _validateProposal, _refuseProposal: _refuseProposal, _openReportForm: _openReportForm,
    _openApplyForm: _openApplyForm, _openConfirmSetpointForm: _openConfirmSetpointForm, _openControlReadingForm: _openControlReadingForm,
    _setHistoryFilter: _setHistoryFilter, _saveHeatingConfigForm: _saveHeatingConfigForm,
    // REFONTE CTA/VC Phase 1 — Vue d'ensemble
    _setOverviewPeriod: _setOverviewPeriod, _toggleOverviewCircuit: _toggleOverviewCircuit,
    // REFONTE CTA/VC Phase 2 — Recommandations (centre de décisions)
    _setRecoFilter: _setRecoFilter, _openRecoDetail: _openRecoDetail,
    // REFONTE CTA/VC Phase 3 — Historique & analyse
    _setHistoryCompare: _setHistoryCompare, _setHistoryCompareDays: _setHistoryCompareDays,
    // REFONTE CTA/VC Phase 4 — Configuration compacte (sections repliables)
    _onConfigSectionToggle: _onConfigSectionToggle,
  };
})();
