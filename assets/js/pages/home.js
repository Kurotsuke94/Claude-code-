(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  // ACCUEIL — COCKPIT OPÉRATIONNEL
  // ------------------------------------------------------------------
  // Toutes les données affichées ici sont lues depuis MX.state (déjà
  // alimenté par les listeners Firestore existants) ou calculées par les
  // moteurs métier déjà en place (MX.Pages.PMP, MX.Pages.Int,
  // MX.Pages.Conso, MX.Pages.Orders, MX.Pages.MesMissions). Aucun calcul
  // métier n'est réinventé ici — cette page ne fait qu'agréger/afficher.
  // Quand une donnée n'est pas calculable de façon fiable, on affiche
  // "—" plutôt que d'inventer une valeur.
  // ══════════════════════════════════════════════════════════════════════

  var _planUploading = false;

  async function _compressImage(file) {
    const MAX_PX = 1400, QUALITY = 0.80;
    return new Promise(function(resolve) {
      var timer = setTimeout(function() { resolve(file); }, 12000);
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function() {
        URL.revokeObjectURL(url);
        var w = img.width, h = img.height;
        if (w <= MAX_PX && h <= MAX_PX && file.size < 400000) { clearTimeout(timer); resolve(file); return; }
        var scale = Math.min(1, MAX_PX / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob(function(blob) { clearTimeout(timer); resolve(blob || file); }, "image/jpeg", QUALITY);
      };
      img.onerror = function() { clearTimeout(timer); resolve(file); };
      img.src = url;
    });
  }

  async function uploadPlan(input) {
    if (_planUploading) return;
    const file = input.files[0];
    if (!file) return;
    _planUploading = true;
    MX.toast("Compression…");
    try {
      const compressed = await _compressImage(file);
      MX.toast("Upload en cours…");
      const imageUrl = await MX.DB.uploadPlanningImage(compressed);
      await MX.DB.savePlanning(imageUrl);
      MX.toast("Planning mis à jour ✓");
    } catch(e) {
      console.error(e);
      MX.toast("Erreur lors de l'upload", true);
    } finally {
      _planUploading = false;
      input.value = "";
    }
  }

  function clearPlan() {
    MX.showModal("Supprimer le planning ?", "L'image sera supprimée pour tous.", [
      { label: "Supprimer", cls: "danger", fn: async function() {
        try { await MX.DB.clearPlanning(); MX.toast("Planning supprimé"); }
        catch(e) { MX.toast("Erreur suppression", true); }
      }},
      { label: "Annuler", cls: "cancel" }
    ]);
  }

  function openPlan() {
    const url = MX.state.planningUrl;
    if (url) window.open(url, "_blank");
  }

  // ── Date locale (jour calendaire réel, pas UTC — même méthode que le
  //    moteur Compteurs/Performance pour rester cohérent autour de minuit) ──
  function _ymdLocal(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Déclenche (une seule fois, sans dupliquer les listeners) le chargement
  // des modules chargés paresseusement (PMP, Interventions, Conso), et
  // redemande un rendu de l'Accueil dès que chacun a répondu.
  var _kickedOff = false;
  function _ensureDataLoaded() {
    if (_kickedOff) return;
    _kickedOff = true;
    function _reRenderIfStillHome() {
      if (MX.state.currentPage === 'home') render();
    }
    if (MX.Pages.PMP && MX.Pages.PMP.ensureLoaded) MX.Pages.PMP.ensureLoaded(_reRenderIfStillHome);
    if (MX.Pages.Int && MX.Pages.Int.ensureLoaded) MX.Pages.Int.ensureLoaded(_reRenderIfStillHome);
    if (MX.Pages.Conso && MX.Pages.Conso.ensureLoaded) MX.Pages.Conso.ensureLoaded(_reRenderIfStillHome);
  }

  // ── Météo (Open-Meteo, via assets/js/utils/weather.js) ──
  // status: 'unconfigured' | 'loading' | 'ok' | 'error'. Ne bloque jamais le
  // rendu de l'Accueil : on affiche l'état courant puis on redemande un
  // rendu quand la promesse se résout (si toujours sur l'Accueil).
  var _weather = { status: 'unconfigured', data: null, forKey: null };
  function _ensureWeatherLoaded(cfg) {
    var lat = cfg && typeof cfg.lat === 'number' ? cfg.lat : null;
    var lon = cfg && typeof cfg.lon === 'number' ? cfg.lon : null;
    if (lat === null || lon === null) { _weather = { status: 'unconfigured', data: null, forKey: null }; return; }
    var key = lat + ',' + lon;
    if (_weather.forKey === key && _weather.status !== 'unconfigured') return; // déjà chargé/en cours pour ces coordonnées
    _weather = { status: 'loading', data: null, forKey: key };
    if (!MX.Weather || !MX.Weather.getCurrent) { _weather = { status: 'error', data: null, forKey: key }; return; }
    MX.Weather.getCurrent(lat, lon).then(function (data) {
      if (_weather.forKey !== key) return; // config changée entre-temps
      _weather = { status: data ? 'ok' : 'error', data: data, forKey: key };
      if (MX.state.currentPage === 'home') render();
    });
  }

  // isAdmin (strict, PAS canSeeAll) : la configuration météo (config/hotel_config)
  // est réservée Admin côté Firestore — le bouton et le message détaillé ne
  // doivent apparaître qu'à un Admin, pour rester cohérents avec ce qui est
  // réellement modifiable (voir _renderEtablissement dans settings.js).
  function _weatherWidgetHtml(cfg, isAdmin) {
    var cityLabel = (cfg && cfg.cityLabel) ? cfg.cityLabel : '';
    if (_weather.status === 'unconfigured') {
      if (!isAdmin) {
        return '<div class="acc-weather acc-weather--empty">' +
          '<i class="fas fa-cloud-sun"></i>' +
          '<div class="acc-weather-txt">' +
            '<div class="acc-weather-line">Météo non configurée</div>' +
          '</div>' +
        '</div>';
      }
      return '<div class="acc-weather acc-weather--empty">' +
        '<i class="fas fa-cloud-sun"></i>' +
        '<div class="acc-weather-txt">' +
          '<div class="acc-weather-line">Météo</div>' +
          '<div class="acc-weather-sub">Localisation non configurée</div>' +
        '</div>' +
        '<button class="acc-weather-cfg" onclick="window._settingsTab=\'etablissement\';MX.showPage(\'parametres\')">Configurer la météo <i class="fas fa-arrow-right"></i></button>' +
      '</div>';
    }
    if (_weather.status === 'loading') {
      return '<div class="acc-weather acc-weather--loading">' +
        '<i class="fas fa-spinner fa-spin"></i>' +
        '<div class="acc-weather-txt"><div class="acc-weather-line">Météo</div><div class="acc-weather-sub">Chargement…</div></div>' +
      '</div>';
    }
    if (_weather.status === 'error') {
      return '<div class="acc-weather acc-weather--error">' +
        '<i class="fas fa-cloud-sun"></i>' +
        '<div class="acc-weather-txt"><div class="acc-weather-line">Météo</div><div class="acc-weather-sub">Données météo temporairement indisponibles</div></div>' +
      '</div>';
    }
    var d = _weather.data;
    return '<div class="acc-weather acc-weather--ok">' +
      '<i class="fas ' + d.icon + '"></i>' +
      '<div class="acc-weather-txt">' +
        '<div class="acc-weather-line"><span class="acc-weather-temp">' + d.temp + '°</span> ' + MX.esc(d.label) + '</div>' +
        '<div class="acc-weather-sub">' + (cityLabel ? MX.esc(cityLabel) + ' · ' : '') +
          (d.tempMin !== null && d.tempMax !== null ? d.tempMin + '° / ' + d.tempMax + '°' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function _priorityRow(level, icon, title, subtitle, badge, onclick) {
    var cls = level === 'urgent' ? 'acc-pr--urgent' : level === 'important' ? 'acc-pr--important' : 'acc-pr--plan';
    return '<button class="acc-pr-row ' + cls + '" onclick="' + onclick + '">' +
      '<span class="acc-pr-dot"></span>' +
      '<div class="acc-pr-body">' +
        '<div class="acc-pr-title">' + MX.esc(title) + '</div>' +
        (subtitle ? '<div class="acc-pr-sub">' + MX.esc(subtitle) + '</div>' : '') +
      '</div>' +
      '<span class="acc-pr-badge">' + MX.esc(badge) + '</span>' +
      '<i class="fas fa-chevron-right acc-pr-arrow"></i>' +
    '</button>';
  }

  function _annDate(a) {
    var raw = a && a.createdAt;
    if (!raw) return 0;
    var d = typeof raw.toDate === 'function' ? raw.toDate() : new Date(raw);
    return d.getTime() || 0;
  }

  function render() {
    var state = MX.state;
    var el    = document.getElementById("main-content");
    var esc   = MX.esc;

    _ensureDataLoaded();
    _ensureWeatherLoaded(state.hotelConfig);

    // ── Rôle ──
    var isAdmin = MX.Auth && MX.Auth.isAdmin && MX.Auth.isAdmin();
    var canAll  = MX.Auth && MX.Auth.canSeeAll && MX.Auth.canSeeAll();
    var isResp  = canAll && !isAdmin;
    var isTech  = !canAll;
    var currentUser = state.currentUser;
    var adminUser   = state.adminUser;
    // Même règle de visibilité par module que la sidebar (app.js) : un
    // technicien sans rôle personnalisé voit tout ; avec un rôle
    // personnalisé (roleId), on applique les permissions réelles.
    var _see = canAll
      ? function () { return true; }
      : (currentUser && currentUser.roleId)
        ? function (mod) { return MX.Auth.can(mod, 'view'); }
        : function () { return true; };

    var displayName = currentUser
      ? (currentUser.name || 'Utilisateur')
      : (adminUser ? (adminUser.email || '').split('@')[0] || 'Admin' : 'Utilisateur');
    var firstName = displayName.split(/[\s@]/)[0];

    // ── Date / heure ──
    var now      = new Date();
    var todayISO = _ymdLocal(now);
    var DAY_NAMES = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    var dayFr    = DAY_NAMES[now.getDay()];
    var dateFr   = String(now.getDate()).padStart(2,'0') + ' ' +
      ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'][now.getMonth()] +
      ' ' + now.getFullYear();
    var hr       = now.getHours();
    var greeting = hr < 12 ? 'Bonjour' : hr < 18 ? 'Bon après-midi' : 'Bonsoir';
    var momentJour = hr < 12 ? 'Matin' : hr < 18 ? 'Journée' : 'Soir';
    var weekLabel = state.weekLabel || (MX.mkWeekLabel ? MX.mkWeekLabel() : '');

    // ════════════════════════════════════════════════════════════════════
    // DONNÉES RÉELLES — Missions (collection `missions`, moteur mes-missions.js)
    // ════════════════════════════════════════════════════════════════════
    var MM = MX.Pages && MX.Pages.MesMissions;
    var missions = (state.missions || []).filter(function (m) { return m && m.id && (m.text || m.title); });
    var missionStatus = function (m) { return MM && MM.getMissionStatus ? MM.getMissionStatus(m) : null; };

    // Vue technicien : restreindre aux missions assignées à l'utilisateur
    // courant — appliqué AVANT tout calcul dérivé (totaux, objectifs) pour
    // que rien ne fuite de données d'autres techniciens.
    var myName = currentUser ? currentUser.name : null;
    function _mineOnly(list) {
      if (canAll || !myName) return list;
      return list.filter(function (m) {
        var a = m.assignedTo || m.takenBy;
        if (Array.isArray(a)) return a.indexOf(myName) >= 0;
        return a === myName;
      });
    }

    var missionsUrgent = _mineOnly(missions.filter(function (m) { return !m.done && (m.priority === 'haute' || m.priority === 'critique'); }));
    var missionsLate   = _mineOnly(missions.filter(function (m) { return !m.done && missionStatus(m) === 'late'; }));
    var missionsDoneToday = _mineOnly(missions.filter(function (m) {
      if (!m.done) return false;
      var raw = m.doneAt || m.completedAt || m.ts;
      if (!raw) return false;
      var d2 = typeof raw.toDate === 'function' ? raw.toDate() : new Date(raw);
      return _ymdLocal(d2) === todayISO;
    }));
    var missionsTodayOpen = _mineOnly(missions.filter(function (m) { return !m.done && missionStatus(m) === 'today'; }));
    var missionsTodayTotal = missionsTodayOpen.length + missionsDoneToday.length;
    var missionsTodayDone  = missionsDoneToday.length;

    // ════════════════════════════════════════════════════════════════════
    // DONNÉES RÉELLES — Interventions (moteur interventions.js, _getSummary())
    // ════════════════════════════════════════════════════════════════════
    var Int = MX.Pages && MX.Pages.Int;
    var intReady  = Int && Int.isReady && Int.isReady();
    var intSum    = (_see('interventions') && Int && Int._getSummary) ? Int._getSummary(isTech ? myName : null) : null;
    var intItems  = intSum ? intSum.items : [];
    var intUrgent = intItems.filter(function (iv) { return iv.priority === 'urgente' && iv.effStatus !== 'terminee' && iv.effStatus !== 'annulee'; });
    var intLate   = intItems.filter(function (iv) { return iv.effStatus === 'en_retard'; });
    // Une intervention sans startDate est "immédiate" (mode non planifié) :
    // elle est ouverte dès sa création et doit apparaître dans Ma journée
    // du jour même, comme une intervention explicitement datée à aujourd'hui.
    var intToday  = intItems.filter(function (iv) { return iv.startDate === todayISO || !iv.startDate; });
    var intTodayDone = intToday.filter(function (iv) { return iv.effStatus === 'terminee'; }).length;
    var intVisible = _see('interventions');
    var intOpenCount    = intVisible ? intItems.filter(function (iv) { return iv.effStatus !== 'terminee' && iv.effStatus !== 'annulee'; }).length : null;
    var intWaitingCount = intVisible ? intItems.filter(function (iv) { return iv.effStatus === 'planifiee' || iv.effStatus === 'affectee'; }).length : null;

    // ════════════════════════════════════════════════════════════════════
    // DONNÉES RÉELLES — PMP / Checklists (moteur pmp.js, getStats()/getLateItems())
    // ════════════════════════════════════════════════════════════════════
    var Pmp = MX.Pages && MX.Pages.PMP;
    var pmpVisible = canAll; // PMP réservé responsable/admin, comme dans la sidebar
    var pmpReady   = Pmp && Pmp.isReady && Pmp.isReady();
    var pmpStats   = (pmpVisible && Pmp && Pmp.getStats) ? Pmp.getStats() : null;
    var pmpLate    = (pmpVisible && pmpReady && Pmp && Pmp.getLateItems) ? Pmp.getLateItems() : [];

    // ════════════════════════════════════════════════════════════════════
    // DONNÉES RÉELLES — Stock (moteur orders.js, getCriticalProducts())
    // ════════════════════════════════════════════════════════════════════
    var Orders = MX.Pages && MX.Pages.Orders;
    var stockVisible = _see('stock');
    var criticalProducts = (stockVisible && Orders && Orders.getCriticalProducts) ? Orders.getCriticalProducts() : [];

    // ════════════════════════════════════════════════════════════════════
    // DONNÉES RÉELLES — Alertes (moteur alerts-engine.js, MX.state.triggeredAlerts)
    // ════════════════════════════════════════════════════════════════════
    var activeAlerts = (state.triggeredAlerts || []).filter(function (a) { return !a.acknowledged && a.status !== 'resolved'; });

    // ════════════════════════════════════════════════════════════════════
    // DONNÉES RÉELLES — Performance DU MOIS (moteur "Ratio réel mensuel" de
    // consommations.js : MX.Pages.Conso._monthlyRealRatio/_monthlyConsoStatus/
    // _monthlyClientsTotal — mêmes fonctions, même calcul, même période que
    // le widget "Score énergétique" du module Compteurs/Performance :
    // 1er du mois → aujourd'hui, sur les compteurs généraux explicitement
    // configurés, JAMAIS de repli silencieux sur tous les compteurs du type
    // (voir _generalMeterIds). Type retenu : eau_froide — c'est aussi le
    // type de référence du widget "Score énergétique" de Ratios, ce qui
    // garantit un résultat strictement identique entre Accueil et Ratios
    // pour la même période. Aucun nouveau listener Firestore : Conso a déjà
    // chargé readings/clients ; _ensureReadingsFrom/_ensureClientsFrom
    // (déjà exposées, déjà utilisées par Ratios pour ce même calcul) ne
    // déclenchent qu'un éventuel complément ponctuel (.get(), pas un
    // listener) si l'historique déjà en mémoire ne couvre pas encore le
    // début du mois.
    // ════════════════════════════════════════════════════════════════════
    var Conso = MX.Pages && MX.Pages.Conso;
    var csoReady = Conso && Conso.isReady && Conso.isReady();
    var monthKey   = todayISO.slice(0, 7); // 'YYYY-MM'
    var monthStart = monthKey + '-01';
    function _isoMinusDays(iso, n) {
      var d2 = new Date(iso + 'T00:00:00');
      d2.setDate(d2.getDate() - n);
      return _ymdLocal(d2);
    }
    var monthlyPerf = null;
    if (Conso && csoReady) {
      if (Conso._ensureReadingsFrom) Conso._ensureReadingsFrom(_isoMinusDays(monthStart, 60));
      if (Conso._ensureClientsFrom)  Conso._ensureClientsFrom(_isoMinusDays(monthStart, 31));
      monthlyPerf = Conso._monthlyRealRatio ? Conso._monthlyRealRatio('eau_froide', monthKey) : null;
    }
    var monthWaterAvailable = !!(monthlyPerf && monthlyPerf.consoStatus === 'ok');
    var monthWaterConsoTxt  = monthWaterAvailable ? (monthlyPerf.conso.toFixed(2).replace('.', ',') + ' m³') : 'Donnée indisponible';
    var monthClientsTxt     = (monthlyPerf && monthlyPerf.clients !== null && monthlyPerf.clients > 0)
      ? monthlyPerf.clients.toLocaleString('fr-FR') : '—';
    var monthRatioTxt;
    if (!monthWaterAvailable) monthRatioTxt = 'Donnée indisponible';
    else if (!monthlyPerf.clients) monthRatioTxt = '—'; // pas de client ce mois — jamais de division par zéro
    else monthRatioTxt = Math.round(monthlyPerf.ratio) + ' L/client';
    var perfGrade = (monthWaterAvailable && monthlyPerf.ratio !== null && Conso._getGrade) ? Conso._getGrade('eau_froide', monthlyPerf.ratio) : null;
    var monthLabel = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'][now.getMonth()];
    monthLabel = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1) + ' ' + now.getFullYear();

    // ════════════════════════════════════════════════════════════════════
    // DONNÉES RÉELLES — Annonces (collection `announcements`, déjà chargée
    // globalement dans state.announcements — voir messages.js). Aucun
    // nouveau listener : on réutilise tel quel. Tri : épinglées d'abord,
    // puis les plus récentes.
    // ════════════════════════════════════════════════════════════════════
    var Msgs = MX.Pages && MX.Pages.Messages;
    var ANN_T = (Msgs && Msgs.ANN_TYPES) || {};
    var announcements = (state.announcements || []).slice().sort(function (a, b) {
      var pa = a.pinned ? 1 : 0, pb = b.pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return _annDate(b) - _annDate(a);
    });
    var announcementsShown = announcements.slice(0, 4);

    // ════════════════════════════════════════════════════════════════════
    // DONNÉES RÉELLES — Retards consolidés (missions + interventions + PMP)
    // ════════════════════════════════════════════════════════════════════
    var retardsTotal = missionsLate.length + intLate.length + (pmpVisible && pmpStats ? pmpStats.enRetard : 0);

    // ════════════════════════════════════════════════════════════════════
    // DONNÉES RÉELLES — Dernières activités (collection `logs`, admin.js le fait déjà)
    // ════════════════════════════════════════════════════════════════════
    var LOG_LABEL = { check: 'a validé une tâche', uncheck: 'a annulé une tâche', assign: 'a assigné une tâche', claim: 'a pris un créneau', unclaim: 'a rendu un créneau' };
    var LOG_ICON  = { check: 'fa-check-circle', uncheck: 'fa-rotate-left', assign: 'fa-user-check', claim: 'fa-hand', unclaim: 'fa-hand' };
    var LOG_COLOR = { check: 'var(--green)', uncheck: 'var(--red)', assign: 'var(--cyan)', claim: 'var(--jour)', unclaim: 'var(--text3)' };
    var recentLogs = (state.logs || []).slice(0, 5);

    // ════════════════════════════════════════════════════════════════════
    // KPI HEADER
    // ════════════════════════════════════════════════════════════════════
    var urgencesCount = activeAlerts.length + missionsUrgent.length + intUrgent.length;
    var missionsAujourdhuiCount = missionsTodayOpen.length;
    var pmpRetardCount = pmpVisible ? (pmpStats ? pmpStats.enRetard : null) : null;
    var stockCritiqueCount = stockVisible ? criticalProducts.length : null;

    // ════════════════════════════════════════════════════════════════════
    // PRIORITÉS DU JOUR — fusion de toutes les sources réelles
    // ════════════════════════════════════════════════════════════════════
    var priorities = [];
    intUrgent.forEach(function (iv) {
      priorities.push({ score: 3, level: 'urgent', title: iv.location || iv.title || 'Intervention', sub: (iv.title && iv.location) ? iv.title : 'Intervention urgente', badge: 'URGENT', oc: "MX.showIntTab('gestion')" });
    });
    missionsUrgent.forEach(function (m) {
      priorities.push({ score: 3, level: 'urgent', title: m.zone || m.text || m.title || 'Mission', sub: m.text || m.title || '', badge: 'URGENT', oc: "MX.showPage('mes-missions')" });
    });
    intLate.forEach(function (iv) {
      if (iv.priority === 'urgente') return; // déjà listée ci-dessus
      priorities.push({ score: 2, level: 'important', title: iv.location || iv.title || 'Intervention', sub: iv.title || 'En retard', badge: 'EN RETARD', oc: "MX.showIntTab('gestion')" });
    });
    missionsLate.forEach(function (m) {
      if (m.priority === 'haute' || m.priority === 'critique') return;
      priorities.push({ score: 2, level: 'important', title: m.zone || m.text || m.title || 'Mission', sub: m.text || m.title || '', badge: 'EN RETARD', oc: "MX.showPage('mes-missions')" });
    });
    pmpLate.forEach(function (i) {
      priorities.push({ score: 2, level: 'important', title: i.name, sub: 'En retard de ' + i.daysLate + ' jour' + (i.daysLate > 1 ? 's' : ''), badge: 'EN RETARD', oc: "MX.showPmpTab('retards')" });
    });
    activeAlerts.forEach(function (a) {
      var lvl = (a.level === 'critical' || a.level === 'urgent') ? 'urgent' : 'important';
      priorities.push({ score: lvl === 'urgent' ? 3 : 2, level: lvl, title: a.ruleName || 'Alerte', sub: a.message || '', badge: lvl === 'urgent' ? 'URGENT' : 'ALERTE', oc: "MX.showAdminTab('alerts')" });
    });
    priorities.sort(function (a, b) { return b.score - a.score; });
    var prioritiesShown = priorities.slice(0, 6);

    // ════════════════════════════════════════════════════════════════════
    // MA JOURNÉE — interventions (heure réelle) + missions (créneau, sans heure inventée) + PMP du jour
    // ════════════════════════════════════════════════════════════════════
    var dayItems = [];
    intToday.forEach(function (iv) {
      dayItems.push({
        time: iv.startTime || null,
        label: (iv.startTime ? iv.startTime : '') + (iv.endTime ? '–' + iv.endTime : ''),
        title: (iv.location ? iv.location + ' — ' : '') + (iv.title || 'Intervention'),
        status: iv.effStatus,
      });
    });
    missionsTodayOpen.concat(missionsDoneToday).forEach(function (m) {
      dayItems.push({
        time: null,
        label: '',
        title: (m.zone ? m.zone + ' — ' : '') + (m.text || m.title || 'Mission'),
        status: m.done ? 'terminee' : (m.takenBy || (m.assignedTo && m.started) ? 'en_cours' : 'planifiee'),
      });
    });
    if (pmpVisible) {
      (Pmp && Pmp.getLateItems ? [] : []); // (les PMP du jour précis ne sont pas exposés indépendamment des retards — on n'invente pas cette liste)
    }
    dayItems.sort(function (a, b) {
      if (a.time && b.time) return a.time.localeCompare(b.time);
      if (a.time) return -1;
      if (b.time) return 1;
      return 0;
    });
    var STATUS_LABEL = { terminee: 'Terminé', en_cours: 'En cours', planifiee: 'À faire', affectee: 'À faire', en_retard: 'En retard', annulee: 'Annulé' };
    var STATUS_ICON  = { terminee: 'fa-check', en_cours: 'fa-spinner', planifiee: 'fa-circle', affectee: 'fa-circle', en_retard: 'fa-triangle-exclamation', annulee: 'fa-xmark' };

    // ════════════════════════════════════════════════════════════════════
    // BUILD HTML
    // ════════════════════════════════════════════════════════════════════
    var h = '<div class="page-body acc-page">';

    // ── HERO ── bannière personnalisable (Admin, voir settings.js) ou
    // dégradé Maintix par défaut si aucune image configurée (§4/§21).
    var heroImg = (state.hotelConfig && state.hotelConfig.heroImageUrl) || null;
    var heroStyle = heroImg
      ? ' style="background-image:linear-gradient(105deg, rgba(8,8,14,.90) 0%, rgba(8,8,14,.60) 45%, rgba(8,8,14,.30) 100%), url(&quot;' + esc(heroImg) + '&quot;)"'
      : '';
    h += '<div class="acc-header' + (heroImg ? ' acc-header--photo' : '') + '"' + heroStyle + '>' +
      '<div class="acc-header-top">' +
        '<div class="acc-header-greet">' +
          MX.userAvatarHtml(displayName, { size: 46, radius: 14 }) +
          '<div class="acc-header-id">' +
            '<div class="acc-greeting">' + greeting + ', ' + esc(firstName) + ' 👋</div>' +
            '<div class="acc-header-date">' + dayFr + ' ' + dateFr + (weekLabel ? ' · ' + esc(weekLabel) : '') + ' · ' + momentJour + '</div>' +
          '</div>' +
        '</div>' +
        _weatherWidgetHtml(state.hotelConfig, isAdmin) +
      '</div>' +
      '<div class="acc-kpi-row">' +
        '<button class="acc-kpi acc-kpi--red" onclick="MX.showAdminTab(\'alerts\')"><i class="fas fa-triangle-exclamation"></i><span class="acc-kpi-v">' + urgencesCount + '</span><span class="acc-kpi-l">Urgences</span></button>' +
        (_see('checklist') ? '<button class="acc-kpi acc-kpi--orange" onclick="MX.showPage(\'mes-missions\')"><i class="fas fa-clipboard-list"></i><span class="acc-kpi-v">' + missionsAujourdhuiCount + '</span><span class="acc-kpi-l">Missions<br>Aujourd\'hui</span></button>' : '') +
        (pmpVisible ? '<button class="acc-kpi acc-kpi--purple" onclick="MX.showPmpTab(\'retards\')"><i class="fas fa-screwdriver-wrench"></i><span class="acc-kpi-v">' + (pmpRetardCount === null ? '—' : pmpRetardCount) + '</span><span class="acc-kpi-l">PMP en retard<br>À planifier</span></button>' : '') +
        (stockVisible ? '<button class="acc-kpi acc-kpi--blue" onclick="MX.showOrdersTab(\'toorder\')"><i class="fas fa-box"></i><span class="acc-kpi-v">' + (stockCritiqueCount === null ? '—' : stockCritiqueCount) + '</span><span class="acc-kpi-l">Stock critique<br>À réapprovisionner</span></button>' : '') +
      '</div>' +
    '</div>';

    // ── GRID PRINCIPALE (paires main/side alignées ligne par ligne, cf.
    //    ordre imposé en mobile ci-dessous via CSS `order`) ──
    h += '<div class="acc-grid">';

    // Colonne principale (gauche, plus large)
    h += '<div class="acc-col acc-col-main">';

    // 🚨 Priorités du jour
    h += '<div class="acc-card acc-card-priorities"><div class="acc-card-head"><span><i class="fas fa-triangle-exclamation" style="color:var(--red)"></i> Priorités du jour</span>' +
      (priorities.length ? '<button class="acc-card-link" onclick="MX.showAdminTab(\'alerts\')">Voir toutes les priorités (' + priorities.length + ')</button>' : '') +
    '</div>';
    if (!prioritiesShown.length) {
      h += '<div class="acc-empty"><i class="fas fa-circle-check" style="color:var(--green)"></i><span>Rien d\'urgent pour le moment</span></div>';
    } else {
      prioritiesShown.forEach(function (p) { h += _priorityRow(p.level, null, p.title, p.sub, p.badge, p.oc); });
    }
    h += '</div>';

    // 📊 Performance du mois
    h += '<div class="acc-card acc-card-energie"><div class="acc-card-head">' +
      '<span><i class="fas fa-gauge-high" style="color:#4F7CFF"></i> <span class="acc-perfm-title"><span>Performance du mois</span><span class="acc-perfm-sub">' + esc(monthLabel) + '</span></span></span>' +
      '<button class="acc-card-link" onclick="MX.showCsoTab(\'dashboard\')">Voir les stats</button>' +
    '</div>';
    if (!csoReady) {
      h += '<div class="acc-empty"><i class="fas fa-spinner fa-spin"></i><span>Chargement des données de consommation…</span></div>';
    } else {
      var ratioAvailable = monthRatioTxt.indexOf('L/client') !== -1;
      h += '<div class="acc-perfm-grid">' +
        '<div class="acc-perfm-kpi"><i class="fas fa-users acc-perfm-ic"></i><span class="acc-perfm-v">' + monthClientsTxt + '</span><span class="acc-perfm-l">Clients du mois</span></div>' +
        '<div class="acc-perfm-kpi"><i class="fas fa-droplet acc-perfm-ic"></i><span class="acc-perfm-v' + (monthWaterAvailable ? '' : ' acc-perfm-v--na') + '">' + monthWaterConsoTxt + '</span><span class="acc-perfm-l">Eau consommée</span></div>' +
        '<div class="acc-perfm-kpi"><i class="fas fa-droplet acc-perfm-ic"></i><span class="acc-perfm-v' + (ratioAvailable ? '' : ' acc-perfm-v--na') + '"' + (ratioAvailable && perfGrade ? ' style="color:' + perfGrade.color + '"' : '') + '>' + monthRatioTxt + '</span><span class="acc-perfm-l">Eau / client</span></div>' +
        '<div class="acc-perfm-kpi"><i class="fas fa-bolt acc-perfm-ic"></i><span class="acc-perfm-v acc-perfm-v--na">Donnée indisponible</span><span class="acc-perfm-l">Coût énergie</span></div>' +
      '</div>';
    }
    h += '</div>';

    // 🔧 État maintenance (interventions ouvertes/urgentes/en attente + retards consolidés)
    if (intVisible || pmpVisible || _see('checklist')) {
      h += '<div class="acc-card acc-card-maintenance"><div class="acc-card-head"><span><i class="fas fa-wrench" style="color:#6D4CFF"></i> État maintenance</span>' +
        (intVisible ? '<button class="acc-card-link" onclick="MX.showIntTab(\'gestion\')">Voir les interventions</button>' : '') +
      '</div>';
      h += '<div class="acc-maint-grid">' +
        '<div class="acc-maint-kpi"><span class="acc-maint-v">' + (intOpenCount === null ? '—' : intOpenCount) + '</span><span class="acc-maint-l">Ouvertes</span></div>' +
        '<div class="acc-maint-kpi acc-maint-kpi--red"><span class="acc-maint-v">' + (intVisible ? intUrgent.length : '—') + '</span><span class="acc-maint-l">Urgentes</span></div>' +
        '<div class="acc-maint-kpi"><span class="acc-maint-v">' + (intWaitingCount === null ? '—' : intWaitingCount) + '</span><span class="acc-maint-l">En attente</span></div>' +
        '<div class="acc-maint-kpi ' + (retardsTotal > 0 ? 'acc-maint-kpi--orange' : '') + '"><span class="acc-maint-v">' + retardsTotal + '</span><span class="acc-maint-l">Retards</span></div>' +
      '</div></div>';
    }

    // 📋 Ma journée
    h += '<div class="acc-card acc-card-day"><div class="acc-card-head"><span><i class="fas fa-list-check" style="color:var(--cyan)"></i> Ma journée</span>' +
      '<button class="acc-card-link" onclick="MX.showPage(\'planning\')">Voir le planning</button>' +
    '</div>';
    if (!dayItems.length) {
      h += '<div class="acc-empty"><i class="fas fa-mug-hot"></i><span>Rien de planifié aujourd\'hui</span></div>';
    } else {
      h += '<div class="acc-day-list">';
      dayItems.forEach(function (it) {
        var stC = it.status === 'terminee' ? 'acc-day-ic--done' : it.status === 'en_retard' ? 'acc-day-ic--late' : it.status === 'en_cours' ? 'acc-day-ic--prog' : 'acc-day-ic--todo';
        h += '<div class="acc-day-row">' +
          '<span class="acc-day-time">' + (it.label || '—') + '</span>' +
          '<span class="acc-day-ic ' + stC + '"><i class="fas ' + (STATUS_ICON[it.status] || 'fa-circle') + '"></i></span>' +
          '<span class="acc-day-title">' + esc(it.title) + '</span>' +
          '<span class="acc-day-status">' + (STATUS_LABEL[it.status] || '') + '</span>' +
        '</div>';
      });
      h += '</div>';
    }
    h += '</div>';

    h += '</div>'; // end acc-col-main

    // Colonne latérale (droite)
    h += '<div class="acc-col acc-col-side">';

    // 📢 Annonces (réutilise state.announcements — aucun nouveau listener)
    h += '<div class="acc-card acc-card-announcements"><div class="acc-card-head"><span><i class="fas fa-bullhorn" style="color:#F59E0B"></i> Annonces</span>' +
      '<button class="acc-card-link" onclick="MX.showPage(\'msgs\')">Voir toutes les annonces</button>' +
    '</div>';
    if (!announcementsShown.length) {
      h += '<div class="acc-empty"><i class="fas fa-comment-slash"></i><span>Aucune annonce pour le moment</span></div>';
    } else {
      h += '<div class="acc-ann-list">';
      announcementsShown.forEach(function (a) {
        var meta = ANN_T[a.type] || { icon: 'fa-circle-info', label: 'Information', c: 'var(--text3)', cd: 'var(--bg4)' };
        var txt = a.title || a.content || '';
        h += '<div class="acc-ann-row" onclick="MX.showPage(\'msgs\')">' +
          '<span class="acc-ann-ic" style="color:' + meta.c + ';background:' + meta.cd + '"><i class="fas ' + meta.icon + '"></i></span>' +
          '<div class="acc-ann-body">' +
            '<div class="acc-ann-title">' + (a.pinned ? '<i class="fas fa-thumbtack acc-ann-pin"></i> ' : '') + esc(txt) + '</div>' +
            '<div class="acc-ann-sub">' + esc(a.authorName || 'Anonyme') + ' · ' + MX.fmtTime(a.createdAt) + '</div>' +
          '</div>' +
        '</div>';
      });
      h += '</div>';
    }
    h += '</div>';

    // 📦 Stock critique
    if (stockVisible) {
      h += '<div class="acc-card acc-card-stock"><div class="acc-card-head"><span><i class="fas fa-box" style="color:#4F7CFF"></i> Stock critique</span>' +
        '<button class="acc-card-link" onclick="MX.showOrdersTab(\'toorder\')">Voir tout le stock</button>' +
      '</div>';
      if (!criticalProducts.length) {
        h += '<div class="acc-empty"><i class="fas fa-circle-check" style="color:var(--green)"></i><span>Stock optimal</span></div>';
      } else {
        h += '<div class="acc-stock-list">';
        criticalProducts.slice(0, 6).forEach(function (p) {
          h += '<div class="acc-stock-row" onclick="MX.showOrdersTab(\'toorder\')">' +
            '<span class="acc-stock-name">' + esc(p.name || '—') + '</span>' +
            '<span class="acc-stock-qty">' + (parseInt(p.qty || 0, 10)) + ' restante' + (parseInt(p.qty || 0, 10) > 1 ? 's' : '') + '</span>' +
          '</div>';
        });
        h += '</div>';
      }
      h += '</div>';
    }

    // ⚡ Actions rapides
    h += '<div class="acc-card acc-card-actions"><div class="acc-card-head"><span><i class="fas fa-bolt" style="color:var(--orange)"></i> Actions rapides</span></div>';
    h += '<div class="acc-actions-grid">';
    if (_see('checklist')) h += '<button class="acc-action" onclick="MX.showPage(\'mes-missions\')"><i class="fas fa-plus"></i><span>Nouvelle mission</span></button>';
    if (_see('interventions')) h += '<button class="acc-action" onclick="MX.showPage(\'interventions\')"><i class="fas fa-wrench"></i><span>Nouvelle intervention</span></button>';
    if (stockVisible) h += '<button class="acc-action" onclick="MX.showOrdersTab(\'scan\')"><i class="fas fa-qrcode"></i><span>Scanner QR code</span></button>';
    if (stockVisible) h += '<button class="acc-action" onclick="MX.showPage(\'orders\')"><i class="fas fa-box"></i><span>Gérer le stock</span></button>';
    h += '</div></div>';

    // 🕐 Dernières activités
    h += '<div class="acc-card acc-card-activity"><div class="acc-card-head"><span><i class="fas fa-clock" style="color:var(--cyan)"></i> Dernières activités</span>' +
      (isAdmin ? '<button class="acc-card-link" onclick="MX.showAdminTab(\'logs\')">Voir tout</button>' : '') +
    '</div>';
    if (!recentLogs.length) {
      h += '<div class="acc-empty"><i class="fas fa-comment-slash"></i><span>Aucune activité récente</span></div>';
    } else {
      h += '<div class="acc-feed-list">';
      recentLogs.forEach(function (log) {
        h += '<div class="acc-feed-row">' +
          MX.userAvatarHtml(log.workerName || '?', 28) +
          '<div class="acc-feed-body">' +
            '<div class="acc-feed-line"><strong>' + esc(log.workerName || 'Inconnu') + '</strong> <span style="color:' + (LOG_COLOR[log.action] || 'var(--text2)') + '">' + esc(LOG_LABEL[log.action] || log.action || '') + '</span></div>' +
            '<div class="acc-feed-what">' + esc(log.taskText || '') + '</div>' +
          '</div>' +
          '<span class="acc-feed-time">' + MX.fmtTime(log.ts) + '</span>' +
        '</div>';
      });
      h += '</div>';
    }
    h += '</div>';

    h += '</div>'; // end acc-col-side
    h += '</div>'; // end acc-grid
    h += '</div>'; // end acc-page

    el.innerHTML = h;
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Home = { render, uploadPlan, clearPlan, openPlan, _compressImage };
})();
