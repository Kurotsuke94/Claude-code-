(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  // CONFIGURATION THERMIQUE — bâtiments / installations / zones thermiques / courbes
  // ------------------------------------------------------------------
  // Consultation + relevés de zone thermique ouverts à tout rôle authentifié (voir
  // assets/js/app.js:renderPage) ; la configuration structurelle
  // (bâtiments/installations/zones thermiques/courbes) reste réservée Responsable/
  // Admin — chaque action est individuellement protégée par
  // _canManage()/_denyManage() ci-dessous, jamais seulement masquée.
  //
  // Réutilise heating_circuits comme SEULE collection "installation" (CTA/
  // VC/réseau/autre) — voir assets/js/db.js — et heating_buildings/
  // heating_rooms/heating_curve_points (nouvelles collections, voir le
  // même fichier) pour le reste. Aucune collection redondante créée ici.
  // ══════════════════════════════════════════════════════════════════════

  var _tab = 'batiments';
  var _buildings = [], _installations = [], _rooms = [], _curvePoints = [], _readings = [];
  var _unsub = {};
  var _subscribed = false;
  var _showArchived = false;
  var _curveBuildingId = null; // bâtiment actuellement affiché dans le panneau "Courbe de référence" de la fiche bâtiment
  var _editingBuilding = null, _editingInstallation = null, _editingRoom = null;
  // REFONTE CTA/VC Phase 5 — fiche bâtiment détaillée (n'existait pas
  // avant cette phase : la liste était à plat, toujours dépliée). Même
  // principe que _circuitDetailId dans cta-vc.js : null = liste, sinon id
  // du bâtiment affiché en fiche. _pendingBuildingPhoto* = sélection en
  // cours de confirmation (jamais uploadée avant confirmation explicite —
  // voir _confirmBuildingPhoto). _buildingPhotoBusy = empêche un double
  // clic pendant la conversion HEIC/compression/upload (opérations async).
  var _buildingDetailId = null;
  var _pendingBuildingPhotoFile = null;
  var _pendingBuildingPhotoPreviewUrl = null;
  var _buildingPhotoBusy = false;
  var _heic2anyLoadPromise = null;
  // REFONTE CTA/VC Phase 6 — même principe que _buildingDetailId/photo
  // ci-dessus, appliqué aux installations (heating_circuits). _heic2any
  // LoadPromise reste PARTAGÉ (un seul chargement différé pour toute la
  // page, qu'il soit déclenché depuis une photo de bâtiment ou
  // d'installation — jamais rechargé deux fois).
  var _installationDetailId = null;
  var _pendingInstallationPhotoFile = null;
  var _pendingInstallationPhotoPreviewUrl = null;
  var _installationPhotoBusy = false;
  // REFONTE CTA/VC Phase 7 — même principe que _buildingDetailId/
  // _installationDetailId, appliqué aux zones thermiques (heating_rooms).
  // AUCUNE photo pour cette phase (décision explicite de l'utilisateur) —
  // pas de _pendingRoomPhoto*/busy correspondant.
  var _roomDetailId = null;
  // ANALYSE DJU / TEMPÉRATURE INTÉRIEURE — même source météo que
  // assets/js/pages/cta-vc.js:_ensureWeather() (MX.Weather.getDaily +
  // MX.Dju.buildDailySeries), jamais une seconde logique de calcul DJU :
  // un seul moteur de vérité pour DJU observé/prévisionnel dans toute
  // l'application.
  var _heatingConfig = {};
  var _weatherSeries = null;
  var _weatherStatus = 'loading';

  function _canManage() { return !!(window.MX.Auth && MX.Auth.canSeeAll && MX.Auth.canSeeAll()); }
  function _denyManage() { MX.toast('Action réservée aux responsables et administrateurs', true); }
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

  function _subscribe() {
    if (_subscribed) return;
    _subscribed = true;
    if (!MX.DB) return;
    _unsub.buildings = MX.DB.listenHeatingBuildings(function (list) { _buildings = list; if (MX.state.currentPage === 'heating-config') render(); });
    _unsub.installations = MX.DB.listenHeatingCircuits(function (list) { _installations = list; if (MX.state.currentPage === 'heating-config') render(); });
    _unsub.rooms = MX.DB.listenHeatingRooms(function (list) { _rooms = list; if (MX.state.currentPage === 'heating-config') render(); });
    _unsub.curvePoints = MX.DB.listenHeatingCurvePoints(function (list) { _curvePoints = list; if (MX.state.currentPage === 'heating-config') render(); });
    _unsub.readings = MX.DB.listenHeatingReadings(function (list) { _readings = list; if (MX.state.currentPage === 'heating-config') render(); });
    if (MX.DB.listenHeatingConfig) {
      _unsub.config = MX.DB.listenHeatingConfig(function (cfg) { _heatingConfig = cfg || {}; if (MX.state.currentPage === 'heating-config') render(); });
    }
  }
  function _destroy() {
    Object.keys(_unsub).forEach(function (k) { if (_unsub[k]) _unsub[k](); });
    _unsub = {};
    _subscribed = false;
  }

  // Même logique EXACTE que assets/js/pages/cta-vc.js:_todayStr/
  // _effectiveDjuBaseTemp/_ensureWeather — un seul moteur de vérité DJU
  // dans toute l'application, jamais une seconde implémentation.
  function _todayStr() {
    if (window.MX.Dju && MX.Dju.parisDateStr) return MX.Dju.parisDateStr();
    return new Date().toISOString().slice(0, 10);
  }
  function _effectiveDjuBaseTemp() {
    return (typeof _heatingConfig.djuBaseTemp === 'number' && !isNaN(_heatingConfig.djuBaseTemp)) ? _heatingConfig.djuBaseTemp : (MX.Dju ? MX.Dju.BASE_TEMP : 19);
  }
  function _ensureWeather() {
    var cfg = MX.state.hotelConfig;
    var lat = cfg && typeof cfg.lat === 'number' ? cfg.lat : null;
    var lon = cfg && typeof cfg.lon === 'number' ? cfg.lon : null;
    if (lat === null || lon === null) { _weatherStatus = 'unconfigured'; return; }
    if (_weatherSeries !== null) return;
    if (_weatherStatus !== 'fetching') {
      _weatherStatus = 'fetching';
      if (!MX.Weather || !MX.Weather.getDaily || !MX.Dju) { _weatherStatus = 'error'; return; }
      MX.Weather.getDaily(lat, lon).then(function (raw) {
        if (!raw) { _weatherStatus = 'error'; if (MX.state.currentPage === 'heating-config') render(); return; }
        _weatherSeries = MX.Dju.buildDailySeries(raw.daily, _todayStr(), _effectiveDjuBaseTemp());
        _weatherStatus = 'ok';
        if (MX.state.currentPage === 'heating-config') render();
      });
    }
  }

  // SÉCURISATION (demande utilisateur, passe de finalisation) : le
  // Technicien doit pouvoir CONSULTER cette page et saisir des relevés de
  // température de zone thermique (voir _openRoomReadingForm, jamais gardé par
  // _canManage) — exactement comme il peut déjà consulter + relever sur
  // CTA/VC. render() n'est donc plus une porte Responsable/Admin : CHAQUE
  // action de configuration structurelle (bâtiments/installations/zones thermiques/
  // courbes) reste individuellement protégée par _canManage()/_denyManage()
  // ci-dessous, et les boutons correspondants sont masqués pour un
  // Technicien (jamais seulement désactivés côté visuel — voir aussi
  // firestore.rules.draft-claims-migration pour la protection serveur,
  // seule qui compte réellement).
  function render() {
    // Onglet de départ demandé depuis la sidebar (groupe accordéon "CTA /
    // VC" > section "Configuration thermique", voir
    // app.js:showHeatingConfigTab) — même mécanisme que showCsoTab pour
    // Analyses. Consommé une seule fois, jamais relu après.
    if (window._heatingConfigStartTab) { _tab = window._heatingConfigStartTab; window._heatingConfigStartTab = null; }
    _subscribe();
    _ensureWeather();
    var mc = document.getElementById('main-content');
    if (!mc) return;
    mc.innerHTML = _html();
  }
  function _setTab(tab) { _tab = tab; _buildingDetailId = null; _installationDetailId = null; _roomDetailId = null; _cancelBuildingPhotoPick(); _cancelInstallationPhotoPick(); render(); }

  function _html() {
    var h = '<div class="ctavc-wrap">';
    h += '<div class="page-head"><div><div class="page-title"><i class="fas fa-temperature-three-quarters"></i> Configuration thermique</div>' +
      '<div class="page-sub">Bâtiments, installations, zones thermiques et courbes DJU / température intérieure — DJU MX</div></div></div>';
    h += '<div class="ctavc-tabs">';
    [
      { id: 'batiments', l: 'Bâtiments', icon: 'fa-building' },
      { id: 'installations', l: 'Installations', icon: 'fa-diagram-project' },
      { id: 'pieces', l: 'Zones thermiques', icon: 'fa-door-open' },
    ].forEach(function (t) {
      h += '<button class="ctavc-tab' + (_tab === t.id ? ' ctavc-tab--on' : '') + '" onclick="MX.Pages.HeatingConfig._setTab(\'' + t.id + '\')">' +
        '<i class="fas ' + t.icon + '"></i> ' + t.l + '</button>';
    });
    h += '</div><div class="ctavc-body">';
    if (_tab === 'batiments') h += _batimentsHtml();
    else if (_tab === 'installations') h += _installationsHtml();
    else if (_tab === 'pieces') h += _piecesHtml();
    h += '</div></div>';
    return h;
  }

  // ════════════════════════════ BÂTIMENTS ════════════════════════════
  // REFONTE CTA/VC Phase 5 — cartes visuelles (photo/nom/adresse) + fiche
  // détaillée (n'existait pas avant cette phase — la liste était à plat,
  // toujours dépliée). CRUD/archivage/_canManage() strictement conservés.
  function _batimentsHtml() {
    if (_buildingDetailId) {
      var bd = _buildings.find(function (b) { return b.id === _buildingDetailId; });
      if (bd) return _buildingDetailHtml(bd);
      _buildingDetailId = null; // bâtiment introuvable (archivé/supprimé entretemps) -> retombe sur la liste
    }
    var h = '<div class="ctavc-toolbar">' +
      '<label class="ctavc-check-inline"><input type="checkbox" ' + (_showArchived ? 'checked' : '') + ' onchange="MX.Pages.HeatingConfig._toggleArchived(this.checked)"> Afficher les bâtiments archivés</label>' +
      (_canManage() ? '<button class="primary-btn" style="width:auto" onclick="MX.Pages.HeatingConfig._openBuildingForm(null)"><i class="fas fa-plus"></i> Ajouter un bâtiment</button>' : '') + '</div>';
    var list = _buildings.filter(function (b) { return _showArchived || !b.archived; });
    if (!list.length) {
      h += '<div class="ctavc-empty"><i class="fas fa-building"></i><div>Aucun bâtiment créé' + (_canManage() ? '. Les bâtiments ne sont jamais codés en dur : créez-en un pour commencer.' : '.') + '</div></div>';
      return h;
    }
    h += '<div class="ctavc-circuit-grid">';
    list.forEach(function (b) {
      h += '<div class="ctavc-circuit-card' + (b.archived ? ' ctavc-circuit-card--archived' : '') + '" onclick="MX.Pages.HeatingConfig._openBuildingDetail(\'' + b.id + '\')">' +
        (b.photoUrl
          ? '<div class="ctavc-building-card-photo" style="background-image:url(&quot;' + MX.esc(b.photoUrl) + '&quot;)"></div>'
          : '<div class="ctavc-building-card-photo ctavc-building-card-photo--empty"><i class="fas fa-building"></i></div>') +
        '<div class="ctavc-circuit-card-head"><span class="ctavc-circuit-card-name">' + MX.esc(b.name) + (b.archived ? ' <span class="ctavc-archived-tag">archivé</span>' : '') + '</span></div>' +
        '<div class="ctavc-circuit-card-zone">' + (b.address ? MX.esc(b.address) : 'Adresse non renseignée') + '</div>' +
        '<div class="ctavc-circuit-card-reg">' + (b.mode === 'automatique' ? 'Régulation automatique' : 'Pilotage manuel assisté') + '</div>' +
      '</div>';
    });
    h += '</div>';
    return h;
  }
  function _fieldRow(label, value) {
    return '<div class="ctavc-field-row"><span class="ctavc-field-label">' + MX.esc(label) + '</span>' +
      '<span class="ctavc-field-value' + (value ? '' : ' ctavc-field-value--na') + '">' + (value ? MX.esc(String(value)) : 'Donnée non disponible') + '</span></div>';
  }
  function _toggleArchived(v) { _showArchived = v; render(); }
  function _openBuildingDetail(id) { _buildingDetailId = id; render(); }

  // ── Fiche bâtiment détaillée (nouvelle, Phase 5) ──
  function _buildingDetailHtml(b) {
    var installCount = _installations.filter(function (i) { return i.buildingId === b.id && !i.archived; }).length;
    var roomCount = _rooms.filter(function (r) { return r.buildingId === b.id && !r.archived; }).length;
    var h = '<button class="ctavc-back-btn" onclick="MX.Pages.HeatingConfig._setTab(\'batiments\')"><i class="fas fa-arrow-left"></i> Retour aux bâtiments</button>';
    h += '<div class="ctavc-card">';
    h += '<div class="ctavc-detail-head"><div>' +
      '<div class="ctavc-detail-name">' + MX.esc(b.name) + (b.archived ? ' <span class="ctavc-archived-tag">archivé</span>' : '') + '</div>' +
      '<div class="ctavc-detail-sub">' + (b.mode === 'automatique' ? 'Régulation automatique — MX surveille uniquement' : 'Pilotage manuel assisté — MX propose, le technicien valide') + '</div></div>' +
      (_canManage() ? '<div class="ctavc-detail-actions"><button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._openBuildingForm(\'' + b.id + '\')"><i class="fas fa-pen"></i> Modifier</button>' +
      '<button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._archiveBuilding(\'' + b.id + '\',' + (!b.archived) + ')"><i class="fas fa-box-archive"></i> ' + (b.archived ? 'Réactiver' : 'Archiver') + '</button></div>' : '') +
    '</div>';
    if (b.description) h += '<div class="ctavc-detail-desc">' + MX.esc(b.description) + '</div>';
    h += '<div class="ctavc-field-grid">' +
      _fieldRow('Adresse', b.address) +
      _fieldRow('Mode de fonctionnement', b.mode === 'automatique' ? 'Automatique (loi d\'eau/régulation existante)' : 'Manuel assisté') +
      _fieldRow('Installations actives', String(installCount)) +
      _fieldRow('Zones thermiques suivies', String(roomCount)) +
    '</div></div>';

    h += _buildingPhotoSectionHtml(b);
    h += _buildingCurveSectionHtml(b);
    h += _roomComparisonHtml(b);
    return h;
  }

  // REFONTE CTA/VC Phase 8 — « Courbe de référence » migrée à l'identique
  // depuis l'ancien onglet « Courbes DJU / température » (_courbesHtml),
  // désormais rattachée à la fiche du bâtiment concerné plutôt qu'à un
  // sélecteur de bâtiment séparé. RÉUTILISE EXACTEMENT les mêmes fonctions
  // (_curveChartSvg, _openCurvePointForm/_submitCurvePointForm/
  // _deleteCurvePoint, le CRUD db.js inchangé) — _curveBuildingId reste la
  // même variable déjà utilisée par ces fonctions (plutôt que de les
  // dupliquer), simplement alignée ici sur le bâtiment de la fiche
  // affichée ; aucune donnée existante touchée, aucune règle Firestore
  // changée. Visuellement IDENTIQUE à l'ancien module pour les mêmes
  // données (mêmes cartes, même graphique, même tableau).
  function _buildingCurveSectionHtml(b) {
    _curveBuildingId = b.id;
    var points = _curvePoints.filter(function (p) { return p.buildingId === b.id; }).sort(function (a, c) { return a.dju - c.dju; });
    var h = '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-chart-line"></i> Courbe de référence' +
      (_canManage() ? '<button class="cso-ibtn" style="margin-left:auto" onclick="MX.Pages.HeatingConfig._openCurvePointForm(null)"><i class="fas fa-plus"></i> Ajouter un point</button>' : '') + '</div>';
    if (points.length < 2) {
      h += '<div class="ctavc-empty-inline">Au moins 2 points sont nécessaires pour tracer une courbe (actuellement ' + points.length + '). Aucune valeur n\'est jamais inventée : saisissez les points vous-même ou importez-les depuis des données fiables.</div>';
    } else {
      h += _curveChartSvg(points);
    }
    h += '</div>';

    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-list"></i> Points programmés (' + points.length + ')</div>';
    if (!points.length) {
      h += '<div class="ctavc-empty-inline">Aucun point programmé pour ce bâtiment.</div>';
    } else {
      h += '<div class="ctavc-hist-table"><table><thead><tr><th>DJU</th><th>Température intérieure attendue</th><th>Période</th><th></th></tr></thead><tbody>';
      points.forEach(function (p) {
        h += '<tr><td>' + p.dju + '</td><td>' + p.expectedIndoorTemp + ' °C</td><td>' + (p.periodLabel ? MX.esc(p.periodLabel) : '—') + '</td>' +
          '<td>' + (_canManage() ? '<button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._openCurvePointForm(\'' + p.id + '\')"><i class="fas fa-pen"></i></button> ' +
          '<button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._deleteCurvePoint(\'' + p.id + '\')"><i class="fas fa-trash"></i></button>' : '') + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '<div class="ctavc-hint"><i class="fas fa-circle-info"></i> Cette courbe est un outil de surveillance et d\'anticipation thermique — ce n\'est jamais une loi d\'eau et elle ne commande jamais directement le chauffage.</div>';
    h += '</div>';
    return h;
  }

  // ── Photo du bâtiment : ajout/remplacement/suppression, prévisualisation
  // + confirmation explicite avant tout upload (jamais d'upload optimiste).
  // Ordre de sauvegarde conforme à l'audit Phase 5 : upload Storage d'abord
  // (jamais d'écriture Firestore avant un succès d'upload confirmé), PUIS
  // mise à jour Firestore, PUIS seulement best-effort la suppression de
  // l'ancienne image. Suppression de photo : retire d'abord la référence
  // Firestore, PUIS tente la suppression Storage. ──
  function _buildingPhotoSectionHtml(b) {
    var h = '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-image"></i> Photo du bâtiment</div>';
    if (_pendingBuildingPhotoPreviewUrl) {
      h += '<div class="etb-banner-preview" style="background-image:url(&quot;' + _pendingBuildingPhotoPreviewUrl + '&quot;)"></div>' +
        '<div class="ctavc-hint-inline">Aperçu — la photo n\'est pas encore enregistrée.</div>' +
        '<div class="etb-stt-actions">' +
          '<button id="hc-b-photo-confirm-btn" class="primary-btn" onclick="MX.Pages.HeatingConfig._confirmBuildingPhoto(\'' + b.id + '\')"' + (_buildingPhotoBusy ? ' disabled' : '') + '><i class="fas fa-check"></i> Enregistrer cette photo</button>' +
          '<button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._cancelBuildingPhotoPick()"' + (_buildingPhotoBusy ? ' disabled' : '') + '><i class="fas fa-xmark"></i> Annuler</button>' +
        '</div>';
    } else {
      h += (b.photoUrl
        ? '<div class="etb-banner-preview" style="background-image:url(&quot;' + MX.esc(b.photoUrl) + '&quot;)"></div>'
        : '<div class="etb-banner-preview etb-banner-preview--empty"><i class="fas fa-building"></i><span>Aucune photo</span></div>') +
        (_canManage() ? '<div class="etb-stt-actions">' +
          '<button class="primary-btn" onclick="MX.Pages.HeatingConfig._pickBuildingPhoto(\'' + b.id + '\')"' + (_buildingPhotoBusy ? ' disabled' : '') + '><i class="fas fa-' + (b.photoUrl ? 'rotate' : 'plus') + '"></i> ' + (b.photoUrl ? 'Remplacer' : 'Ajouter une photo') + '</button>' +
          (b.photoUrl ? '<button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._removeBuildingPhoto(\'' + b.id + '\')"' + (_buildingPhotoBusy ? ' disabled' : '') + '><i class="fas fa-trash"></i> Supprimer</button>' : '') +
        '</div>' : '');
    }
    h += '</div>';
    return h;
  }

  // "Type de mesure" — non applicable ici ; détection HEIC par extension
  // ET type MIME (de nombreux navigateurs/OS n'exposent pas le type MIME
  // correct "image/heic" pour ce format, l'extension reste le signal le
  // plus fiable en pratique).
  function _isHeicFile(file) {
    var n = (file.name || '').toLowerCase();
    return /\.(heic|heif)$/.test(n) || file.type === 'image/heic' || file.type === 'image/heif';
  }
  // Chargement DIFFÉRÉ de heic2any (1,3 Mo) : uniquement sur cette page,
  // uniquement quand un fichier .heic/.heif est RÉELLEMENT sélectionné —
  // jamais chargé globalement (index.html), pour ne jamais pénaliser les
  // utilisateurs qui n'uploadent jamais ce format. Fichier vendorisé en
  // local (assets/js/libs/), aucun appel réseau externe à l'exécution
  // (vérifié : aucune URL dans le bundle) — cohérent avec "zéro dépendance
  // externe" déjà en vigueur dans Maintix.
  function _ensureHeic2anyLoaded() {
    if (window.heic2any) return Promise.resolve();
    if (_heic2anyLoadPromise) return _heic2anyLoadPromise;
    _heic2anyLoadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '/assets/js/libs/heic2any.min.js?v=1';
      s.onload = function () { resolve(); };
      s.onerror = function () { _heic2anyLoadPromise = null; reject(new Error('Échec du chargement du convertisseur HEIC')); };
      document.head.appendChild(s);
    });
    return _heic2anyLoadPromise;
  }
  // Redimensionnement (1600px max) + compression JPEG qualité 0.80, avec
  // une boucle de réduction progressive de qualité visant ≤500 Ko quand la
  // qualité le permet (BEST-EFFORT, jamais une garantie stricte — une
  // photo très détaillée peut rester au-dessus de 500 Ko même à qualité
  // réduite ; jamais de dégradation au-delà de 0.5 pour rester
  // visuellement correct). Fonction DÉDIÉE à cette fonctionnalité (pas une
  // modification de home.js:_compressImage, qui reste intact pour
  // Planning/bannière — éviter toute 2e logique de compression partagée
  // qui risquerait de régresser ces fonctionnalités existantes).
  var BUILDING_PHOTO_MAX_PX = 1600;
  var BUILDING_PHOTO_TARGET_BYTES = 500 * 1024;
  function _compressBuildingPhoto(file) {
    return new Promise(function (resolve) {
      var timer = setTimeout(function () { resolve(file); }, 20000);
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.width, h = img.height;
        var scale = Math.min(1, BUILDING_PHOTO_MAX_PX / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        var qualities = [0.80, 0.70, 0.60, 0.50];
        var i = 0;
        var best = null;
        function tryNext() {
          if (i >= qualities.length) { clearTimeout(timer); resolve(best || file); return; }
          var q = qualities[i++];
          canvas.toBlob(function (blob) {
            if (!blob) { tryNext(); return; }
            if (!best || blob.size < best.size) best = blob;
            if (blob.size <= BUILDING_PHOTO_TARGET_BYTES) { clearTimeout(timer); resolve(blob); return; }
            tryNext();
          }, 'image/jpeg', q);
        }
        tryNext();
      };
      img.onerror = function () { clearTimeout(timer); resolve(file); };
      img.src = url;
    });
  }

  function _pickBuildingPhoto(buildingId) {
    if (!_canManage()) { _denyManage(); return; }
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
    inp.onchange = function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var isHeic = _isHeicFile(file);
      if (!isHeic && !/^image\/(jpeg|png|webp)$/.test(file.type)) {
        MX.toast('Format non supporté (JPG, PNG, WebP ou HEIC uniquement)', true);
        return;
      }
      // 15 Mo maximum AVANT compression — rejet immédiat, avant tout
      // traitement réseau ou local coûteux.
      if (file.size > 15 * 1024 * 1024) {
        MX.toast('Image trop volumineuse (15 Mo maximum avant compression)', true);
        return;
      }
      _buildingPhotoBusy = true;
      render();
      var ready = isHeic
        ? (MX.toast('Conversion HEIC…'), _ensureHeic2anyLoaded().then(function () {
            return window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
          }).then(function (result) { return Array.isArray(result) ? result[0] : result; }))
        : Promise.resolve(file);
      ready.then(function (readyFile) {
        if (_pendingBuildingPhotoPreviewUrl) URL.revokeObjectURL(_pendingBuildingPhotoPreviewUrl);
        _pendingBuildingPhotoFile = readyFile;
        _pendingBuildingPhotoPreviewUrl = URL.createObjectURL(readyFile);
        _buildingPhotoBusy = false;
        _buildingDetailId = buildingId;
        render();
      }).catch(function (err) {
        console.error('[BuildingPhoto] Échec de la conversion HEIC', err);
        MX.toast('Erreur lors de la conversion du fichier HEIC', true);
        _buildingPhotoBusy = false;
        render();
      });
    };
    inp.click();
  }
  function _cancelBuildingPhotoPick() {
    if (_pendingBuildingPhotoPreviewUrl) URL.revokeObjectURL(_pendingBuildingPhotoPreviewUrl);
    _pendingBuildingPhotoFile = null;
    _pendingBuildingPhotoPreviewUrl = null;
    render();
  }
  // Séquence de sauvegarde (audit Phase 5, reprise à l'identique de
  // uploadHeroBanner/_sttConfirmHeroBanner) :
  //   1-2. Compression déjà faite (sélection) ou faite ici ; 3-4. upload
  //   Storage de la NOUVELLE image, URL récupérée ; 5-6. écriture
  //   Firestore (updateHeatingBuilding), avec vérification explicite du
  //   succès avant toute autre action ; 7. SEULEMENT ENSUITE, best-effort,
  //   suppression de l'ANCIENNE image. Échec upload -> rien à annuler.
  //   Échec Firestore -> nettoyage de la NOUVELLE image, ancienne photo
  //   conservée (jamais de bâtiment sans photo suite à un échec réseau).
  function _confirmBuildingPhoto(buildingId) {
    if (!_canManage()) { _denyManage(); return; }
    if (!_pendingBuildingPhotoFile) return;
    var file = _pendingBuildingPhotoFile;
    _buildingPhotoBusy = true;
    render();
    var newUrl = null;
    _compressBuildingPhoto(file).then(function (compressed) {
      return MX.DB.uploadBuildingPhoto(buildingId, compressed);
    }).then(function (url) {
      newUrl = url;
      var b = _buildings.find(function (x) { return x.id === buildingId; });
      var oldUrl = b ? b.photoUrl : null;
      return MX.DB.updateHeatingBuilding(buildingId, { photoUrl: newUrl }, _currentUserName()).then(function () {
        _cancelBuildingPhotoPick();
        _buildingPhotoBusy = false;
        MX.toast('Photo du bâtiment mise à jour ✓');
        render();
        if (oldUrl) MX.DB.deleteBuildingPhotoImage(oldUrl); // best-effort, non bloquant, APRÈS succès confirmé
      }).catch(function (saveErr) {
        console.error('[BuildingPhoto] Échec sauvegarde Firestore — nettoyage de la nouvelle image, ancienne photo conservée', saveErr);
        MX.DB.deleteBuildingPhotoImage(newUrl);
        _buildingPhotoBusy = false;
        MX.toast('Erreur sauvegarde — l\'ancienne photo est conservée', true);
        render();
      });
    }).catch(function (uploadErr) {
      console.error('[BuildingPhoto] Échec upload — aucune suppression, aucune écriture Firestore', uploadErr);
      _buildingPhotoBusy = false;
      MX.toast('Erreur lors de l\'envoi de la photo', true);
      render();
    });
  }
  function _removeBuildingPhoto(buildingId) {
    if (!_canManage()) { _denyManage(); return; }
    var b = _buildings.find(function (x) { return x.id === buildingId; });
    if (!b || !b.photoUrl) return;
    if (!confirm('Supprimer la photo de ce bâtiment ? Le bâtiment lui-même n\'est pas affecté.')) return;
    var oldUrl = b.photoUrl;
    MX.DB.updateHeatingBuilding(buildingId, { photoUrl: firebase.firestore.FieldValue.delete() }, _currentUserName()).then(function () {
      MX.toast('Photo supprimée');
      render();
      MX.DB.deleteBuildingPhotoImage(oldUrl); // best-effort, APRÈS la suppression de la référence Firestore
    }).catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }

  function _openBuildingForm(id) {
    if (!_canManage()) { _denyManage(); return; }
    _editingBuilding = id ? _buildings.find(function (b) { return b.id === id; }) : null;
    var b = _editingBuilding || {};
    var body = '<div class="ctavc-form">' +
      '<label>Nom du bâtiment *</label><input id="hc-b-name" class="fi" value="' + MX.esc(b.name || '') + '" placeholder="Ex: Bâtiment principal" maxlength="80">' +
      '<label>Adresse (facultatif)</label><input id="hc-b-address" class="fi" value="' + MX.esc(b.address || '') + '" placeholder="Ex: 12 rue des Lilas, 75000 Paris" maxlength="160">' +
      '<label>Description (facultatif)</label><textarea id="hc-b-desc" class="fi" rows="2">' + MX.esc(b.description || '') + '</textarea>' +
      '<label>Mode de fonctionnement thermique *</label><select id="hc-b-mode" class="fi">' +
      '<option value="manuel_assiste"' + (b.mode !== 'automatique' ? ' selected' : '') + '>Manuel assisté — MX propose, le technicien règle et confirme</option>' +
      '<option value="automatique"' + (b.mode === 'automatique' ? ' selected' : '') + '>Automatique — loi d\'eau/régulation existante, MX surveille uniquement</option>' +
      '</select>' +
      '<div class="ctavc-hint"><i class="fas fa-circle-info"></i> En mode automatique, MX n\'enverra JAMAIS de proposition de réglage pour les installations de ce bâtiment — surveillance et détection d\'anomalies uniquement.</div>' +
    '</div>';
    MX.showModal({
      title: _editingBuilding ? 'Modifier le bâtiment' : 'Ajouter un bâtiment', body: body, noAutoClose: true,
      actions: [
        { label: _editingBuilding ? 'Enregistrer' : 'Créer', cls: 'primary-btn', fn: function () { _submitBuildingForm(id); } },
        { label: 'Annuler', cls: 'cancel', fn: function () { MX.closeModal(); } },
      ],
    });
    setTimeout(function () { var el = document.getElementById('hc-b-name'); if (el) el.focus(); }, 50);
  }
  function _submitBuildingForm(id) {
    if (!_canManage()) { _denyManage(); return; }
    var name = _strOrNull('hc-b-name');
    if (!name) { MX.toast('Le nom du bâtiment est obligatoire', true); return; }
    var data = { name: name, address: _strOrNull('hc-b-address') || '', description: _strOrNull('hc-b-desc') || '', mode: document.getElementById('hc-b-mode').value };
    var action = id ? MX.DB.updateHeatingBuilding(id, data, _currentUserName()) : MX.DB.addHeatingBuilding(data, _currentUserName());
    action.then(function () { MX.closeModal(); MX.toast(id ? 'Bâtiment mis à jour' : 'Bâtiment créé'); })
      .catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }
  function _archiveBuilding(id, archived) {
    if (!_canManage()) { _denyManage(); return; }
    var msg = archived ? 'Archiver ce bâtiment ? Ses installations et zones thermiques restent consultables dans l\'historique, mais ce bâtiment ne sera plus proposé pour un nouvel assignement.' : 'Réactiver ce bâtiment ?';
    if (!confirm(msg)) return;
    MX.DB.archiveHeatingBuilding(id, archived, _currentUserName()).then(function () { MX.toast(archived ? 'Bâtiment archivé' : 'Bâtiment réactivé'); })
      .catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }

  // ════════════════════════════ INSTALLATIONS ════════════════════════════
  // Réutilise heating_circuits (CTA/VC/réseau/autre) — même collection que
  // la page CTA/VC. Formulaire complet avec association bâtiment, jamais
  // dupliqué : les modifications faites ici sont les MÊMES documents que
  // ceux affichés dans assets/js/pages/cta-vc.js.
  // REFONTE CTA/VC Phase 6 — même vocabulaire que assets/js/pages/cta-vc.js
  // (TYPE_LABELS ajouté ICI ET là-bas pour la correction de l'incohérence
  // 'reseau_chauffage', voir plus bas) — un circuit créé/modifié depuis
  // l'une ou l'autre page reste cohérent.
  var TYPE_LABELS = { cta: 'CTA', vc: 'VC', reseau_chauffage: 'Réseau de chauffage', autre: 'Autre' };
  function _installationsHtml() {
    if (_installationDetailId) {
      var id = _installations.find(function (i) { return i.id === _installationDetailId; });
      if (id) return _installationDetailHtml(id);
      _installationDetailId = null; // installation introuvable (archivée/supprimée entretemps) -> retombe sur la liste
    }
    var h = '<div class="ctavc-toolbar">' +
      '<label class="ctavc-check-inline"><input type="checkbox" ' + (_showArchived ? 'checked' : '') + ' onchange="MX.Pages.HeatingConfig._toggleArchived(this.checked)"> Afficher les installations archivées</label>' +
      (_canManage() ? '<button class="primary-btn" style="width:auto" onclick="MX.Pages.HeatingConfig._openInstallationForm(null)"><i class="fas fa-plus"></i> Ajouter une installation</button>' : '') + '</div>';
    var list = _installations.filter(function (i) { return _showArchived || !i.archived; });
    if (!list.length) { h += '<div class="ctavc-empty"><i class="fas fa-diagram-project"></i><div>Aucune installation créée.</div></div>'; return h; }
    h += '<div class="ctavc-circuit-grid">';
    list.forEach(function (i) {
      var building = _buildings.find(function (b) { return b.id === i.buildingId; });
      h += '<div class="ctavc-circuit-card' + (i.archived ? ' ctavc-circuit-card--archived' : '') + '" onclick="MX.Pages.HeatingConfig._openInstallationDetail(\'' + i.id + '\')">' +
        (i.photoUrl
          ? '<div class="ctavc-building-card-photo" style="background-image:url(&quot;' + MX.esc(i.photoUrl) + '&quot;)"></div>'
          : '<div class="ctavc-building-card-photo ctavc-building-card-photo--empty"><i class="fas fa-diagram-project"></i></div>') +
        '<div class="ctavc-circuit-card-head"><span class="ctavc-circuit-type">' + MX.esc(TYPE_LABELS[i.type] || (i.type || '').toUpperCase() || '—') + '</span></div>' +
        '<div class="ctavc-circuit-card-name">' + MX.esc(i.name || '(sans nom)') + (i.archived ? ' <span class="ctavc-archived-tag">archivé</span>' : '') + '</div>' +
        '<div class="ctavc-circuit-card-zone">' + (building ? MX.esc(building.name) : 'Non assigné') + '</div>' +
        '<div class="ctavc-circuit-card-reg">' + (i.regulationType ? REG_LABELS[i.regulationType] || i.regulationType : 'Régulation non renseignée') + '</div>' +
      '</div>';
    });
    h += '</div>';
    h += '<div class="ctavc-hint"><i class="fas fa-circle-info"></i> Pour la saisie de relevés et le suivi des propositions MX, utilisez la page CTA/VC — cette page gère uniquement la configuration structurelle (bâtiment, limites techniques).</div>';
    return h;
  }
  function _openInstallationDetail(id) { _installationDetailId = id; render(); }
  // Même principe natif <details>/<summary> que assets/js/pages/cta-vc.js
  // (_collapsibleOpenTag/_onConfigSectionToggle, Phase 4) — état ouvert/
  // fermé propre à CETTE page, jamais partagé avec cta-vc.js (deux pages,
  // deux sessions de repli indépendantes, pas persistées entre rechargements).
  var _installSectionsOpen = { fields: true, zones: true, photo: true };
  function _collapsibleOpenTag(key, icon, label) {
    var open = _installSectionsOpen[key] !== false;
    return '<div class="ctavc-card"><details class="ctavc-collapsible"' + (open ? ' open' : '') +
      ' ontoggle="MX.Pages.HeatingConfig._onInstallSectionToggle(\'' + key + '\', this.open)">' +
      '<summary class="ctavc-collapsible-toggle"><i class="fas ' + icon + '"></i><span>' + MX.esc(label) + '</span>' +
      '<i class="fas fa-chevron-right ctavc-collapsible-chevron"></i></summary>' +
      '<div class="ctavc-collapsible-body">';
  }
  function _collapsibleCloseTag() { return '</div></details></div>'; }
  function _onInstallSectionToggle(key, open) { _installSectionsOpen[key] = !!open; }

  // ── Fiche installation détaillée (nouvelle, Phase 6) — consultation
  // seule ; Modifier/Archiver restent les SEULES actions d'écriture,
  // identiques à avant (_openInstallationForm/_archiveInstallation,
  // inchangées). ──
  function _installationDetailHtml(c) {
    var building = _buildings.find(function (b) { return b.id === c.buildingId; });
    var h = '<button class="ctavc-back-btn" onclick="MX.Pages.HeatingConfig._setTab(\'installations\')"><i class="fas fa-arrow-left"></i> Retour aux installations</button>';
    h += '<div class="ctavc-card">';
    h += '<div class="ctavc-detail-head"><div>' +
      '<div class="ctavc-detail-name">' + MX.esc(c.name || '(sans nom)') + (c.archived ? ' <span class="ctavc-archived-tag">archivé</span>' : '') + '</div>' +
      '<div class="ctavc-detail-sub">' + MX.esc(TYPE_LABELS[c.type] || (c.type || '').toUpperCase() || '—') + (c.zone ? ' · ' + MX.esc(c.zone) : '') + '</div></div>' +
      (_canManage() ? '<div class="ctavc-detail-actions"><button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._openInstallationForm(\'' + c.id + '\')"><i class="fas fa-pen"></i> Modifier</button>' +
      '<button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._archiveInstallation(\'' + c.id + '\',' + (!c.archived) + ')"><i class="fas fa-box-archive"></i> ' + (c.archived ? 'Réactiver' : 'Archiver') + '</button></div>' : '') +
    '</div>';
    if (c.description) h += '<div class="ctavc-detail-desc">' + MX.esc(c.description) + '</div>';
    h += '</div>';

    h += _collapsibleOpenTag('fields', 'fa-circle-info', 'Caractéristiques techniques');
    h += '<div class="ctavc-field-grid">';
    h += _fieldRow('Bâtiment', building ? building.name : null);
    h += _fieldRow('Emplacement / zone desservie', c.zone);
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
    }
    if (c.regulationType === 'consigne' || c.regulationType === 'mixte') {
      h += _fieldRow('Nature de la consigne', c.setpointType === 'ambiante' ? 'Température ambiante' : c.setpointType === 'eau' ? 'Température d\'eau' : (c.setpointType ? c.setpointType : null));
      h += _fieldRow('Valeur de consigne', typeof c.setpointValue === 'number' ? c.setpointValue + (c.setpointUnit || '°C') : null);
    }
    h += _fieldRow('Température cible de la zone', typeof c.targetTemp === 'number' ? c.targetTemp + ' °C' : null);
    h += _fieldRow('Température minimale autorisée', typeof c.tempMin === 'number' ? c.tempMin + ' °C' : null);
    h += _fieldRow('Température maximale autorisée', typeof c.tempMax === 'number' ? c.tempMax + ' °C' : null);
    h += '</div>';
    h += _collapsibleCloseTag();

    h += _collapsibleOpenTag('zones', 'fa-door-open', 'Zones thermiques associées (' + _roomsForInstallation(c.id).length + ')');
    h += _installationZonesHtml(c.id);
    h += _collapsibleCloseTag();

    h += _collapsibleOpenTag('photo', 'fa-image', 'Photo de l\'installation');
    h += _installationPhotoSectionHtml(c);
    h += _collapsibleCloseTag();
    return h;
  }
  // Lecture pure de heating_rooms.installationId (champ déjà existant,
  // pour cette fonction) — une zone thermique n'apparaît
  // ici que si CE lien précis la rattache à CETTE installation ; les zones
  // sans installation (installationId absent/null) ne sont jamais
  // affectées ni listées ici, elles restent "non rattachées" ailleurs
  // (onglet Zones thermiques). Un seul passage filter() -> aucun doublon possible
  // (chaque zone n'a qu'un seul installationId).
  function _roomsForInstallation(installationId) {
    return _rooms.filter(function (r) { return r.installationId === installationId; });
  }
  function _installationZonesHtml(installationId) {
    var list = _roomsForInstallation(installationId).filter(function (r) { return _showArchived || !r.archived; });
    if (!list.length) return '<div class="ctavc-empty-inline">Aucune zone thermique associée à cette installation pour le moment (voir l\'onglet Zones thermiques pour en associer une).</div>';
    var h = '<div class="ctavc-hist-table"><table><thead><tr><th>Zone</th><th>Bâtiment</th><th>Étage/Zone</th><th>Cible</th><th>Suivie</th></tr></thead><tbody>';
    list.forEach(function (r) {
      var b = _buildings.find(function (x) { return x.id === r.buildingId; });
      h += '<tr' + (r.archived ? ' style="opacity:.55"' : '') + '>' +
        '<td>' + MX.esc(r.name) + (r.archived ? ' <span class="ctavc-archived-tag">archivée</span>' : '') + '</td>' +
        '<td>' + (b ? MX.esc(b.name) : '—') + '</td>' +
        '<td>' + (r.floorOrZone ? MX.esc(r.floorOrZone) : '—') + '</td>' +
        '<td>' + (typeof r.targetTemp === 'number' ? r.targetTemp + '°C' : '—') + '</td>' +
        '<td>' + (r.trackedActive ? 'Oui' : 'Non') + '</td>' +
      '</tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  // ── Photo d'installation — EXACTEMENT le même flux que la photo de
  // bâtiment (Phase 5) : aperçu + confirmation explicite, ordre de
  // sauvegarde Storage -> Firestore -> nettoyage best-effort de l'ancienne
  // image, HEIC via le même chargement différé partagé
  // (_ensureHeic2anyLoaded), même compression dédiée (_compressBuildingPhoto
  // RÉUTILISÉE telle quelle — mêmes contraintes de taille/dimensions, pas
  // de 2e fonction de compression dupliquée). Seul ce qui touche au DOCUMENT
  // (heating_circuits au lieu de heating_buildings) et au chemin Storage
  // (heating_circuits/{id}/{fileName}, déjà couvert par storage.rules.
  // draft-phase5) change. ──
  function _installationPhotoSectionHtml(c) {
    var h = '';
    if (_pendingInstallationPhotoPreviewUrl) {
      h += '<div class="etb-banner-preview" style="background-image:url(&quot;' + _pendingInstallationPhotoPreviewUrl + '&quot;)"></div>' +
        '<div class="ctavc-hint-inline">Aperçu — la photo n\'est pas encore enregistrée.</div>' +
        '<div class="etb-stt-actions">' +
          '<button id="hc-i-photo-confirm-btn" class="primary-btn" onclick="MX.Pages.HeatingConfig._confirmInstallationPhoto(\'' + c.id + '\')"' + (_installationPhotoBusy ? ' disabled' : '') + '><i class="fas fa-check"></i> Enregistrer cette photo</button>' +
          '<button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._cancelInstallationPhotoPick()"' + (_installationPhotoBusy ? ' disabled' : '') + '><i class="fas fa-xmark"></i> Annuler</button>' +
        '</div>';
    } else {
      h += (c.photoUrl
        ? '<div class="etb-banner-preview" style="background-image:url(&quot;' + MX.esc(c.photoUrl) + '&quot;)"></div>'
        : '<div class="etb-banner-preview etb-banner-preview--empty"><i class="fas fa-diagram-project"></i><span>Aucune photo</span></div>') +
        (_canManage() ? '<div class="etb-stt-actions">' +
          '<button class="primary-btn" onclick="MX.Pages.HeatingConfig._pickInstallationPhoto(\'' + c.id + '\')"' + (_installationPhotoBusy ? ' disabled' : '') + '><i class="fas fa-' + (c.photoUrl ? 'rotate' : 'plus') + '"></i> ' + (c.photoUrl ? 'Remplacer' : 'Ajouter une photo') + '</button>' +
          (c.photoUrl ? '<button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._removeInstallationPhoto(\'' + c.id + '\')"><i class="fas fa-trash"></i> Supprimer</button>' : '') +
        '</div>' : '');
    }
    return h;
  }
  function _pickInstallationPhoto(installationId) {
    if (!_canManage()) { _denyManage(); return; }
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
    inp.onchange = function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var isHeic = _isHeicFile(file);
      if (!isHeic && !/^image\/(jpeg|png|webp)$/.test(file.type)) {
        MX.toast('Format non supporté (JPG, PNG, WebP ou HEIC uniquement)', true);
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        MX.toast('Image trop volumineuse (15 Mo maximum avant compression)', true);
        return;
      }
      _installationPhotoBusy = true;
      render();
      var ready = isHeic
        ? (MX.toast('Conversion HEIC…'), _ensureHeic2anyLoaded().then(function () {
            return window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
          }).then(function (result) { return Array.isArray(result) ? result[0] : result; }))
        : Promise.resolve(file);
      ready.then(function (readyFile) {
        if (_pendingInstallationPhotoPreviewUrl) URL.revokeObjectURL(_pendingInstallationPhotoPreviewUrl);
        _pendingInstallationPhotoFile = readyFile;
        _pendingInstallationPhotoPreviewUrl = URL.createObjectURL(readyFile);
        _installationPhotoBusy = false;
        _installationDetailId = installationId;
        render();
      }).catch(function (err) {
        console.error('[InstallationPhoto] Échec de la conversion HEIC', err);
        MX.toast('Erreur lors de la conversion du fichier HEIC', true);
        _installationPhotoBusy = false;
        render();
      });
    };
    inp.click();
  }
  function _cancelInstallationPhotoPick() {
    if (_pendingInstallationPhotoPreviewUrl) URL.revokeObjectURL(_pendingInstallationPhotoPreviewUrl);
    _pendingInstallationPhotoFile = null;
    _pendingInstallationPhotoPreviewUrl = null;
    render();
  }
  function _confirmInstallationPhoto(installationId) {
    if (!_canManage()) { _denyManage(); return; }
    if (!_pendingInstallationPhotoFile) return;
    var file = _pendingInstallationPhotoFile;
    _installationPhotoBusy = true;
    render();
    var newUrl = null;
    _compressBuildingPhoto(file).then(function (compressed) {
      return MX.DB.uploadInstallationPhoto(installationId, compressed);
    }).then(function (url) {
      newUrl = url;
      var c = _installations.find(function (x) { return x.id === installationId; });
      var oldUrl = c ? c.photoUrl : null;
      return MX.DB.updateHeatingCircuit(installationId, { photoUrl: newUrl }, _currentUserName()).then(function () {
        _cancelInstallationPhotoPick();
        _installationPhotoBusy = false;
        MX.toast('Photo de l\'installation mise à jour ✓');
        render();
        if (oldUrl) MX.DB.deleteInstallationPhotoImage(oldUrl); // best-effort, non bloquant, APRÈS succès confirmé
      }).catch(function (saveErr) {
        console.error('[InstallationPhoto] Échec sauvegarde Firestore — nettoyage de la nouvelle image, ancienne photo conservée', saveErr);
        MX.DB.deleteInstallationPhotoImage(newUrl);
        _installationPhotoBusy = false;
        MX.toast('Erreur sauvegarde — l\'ancienne photo est conservée', true);
        render();
      });
    }).catch(function (uploadErr) {
      console.error('[InstallationPhoto] Échec upload — aucune suppression, aucune écriture Firestore', uploadErr);
      _installationPhotoBusy = false;
      MX.toast('Erreur lors de l\'envoi de la photo', true);
      render();
    });
  }
  function _removeInstallationPhoto(installationId) {
    if (!_canManage()) { _denyManage(); return; }
    var c = _installations.find(function (x) { return x.id === installationId; });
    if (!c || !c.photoUrl) return;
    if (!confirm('Supprimer la photo de cette installation ? L\'installation elle-même n\'est pas affectée.')) return;
    var oldUrl = c.photoUrl;
    MX.DB.updateHeatingCircuit(installationId, { photoUrl: firebase.firestore.FieldValue.delete() }, _currentUserName()).then(function () {
      MX.toast('Photo supprimée');
      render();
      MX.DB.deleteInstallationPhotoImage(oldUrl); // best-effort, APRÈS la suppression de la référence Firestore
    }).catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }
  var REG_LABELS = { vanne_3v: 'Vanne 3 voies', consigne: 'Consigne', mixte: 'Mixte', autre: 'Autre' };
  function _openInstallationForm(id) {
    if (!_canManage()) { _denyManage(); return; }
    _editingInstallation = id ? _installations.find(function (i) { return i.id === id; }) : null;
    var c = _editingInstallation || {};
    var body = '<div class="ctavc-form">' +
      '<label>Nom *</label><input id="hc-i-name" class="fi" value="' + MX.esc(c.name || '') + '" maxlength="80">' +
      '<label>Type</label><select id="hc-i-type" class="fi" onchange="MX.Pages.HeatingConfig._onInstallationTypeChange(this.value)">' +
      ['cta', 'vc', 'reseau_chauffage', 'autre'].map(function (t) { return '<option value="' + t + '"' + (c.type === t ? ' selected' : '') + '>' + (t === 'reseau_chauffage' ? 'Réseau de chauffage' : t.toUpperCase()) + '</option>'; }).join('') + '</select>' +
      '<label>Bâtiment associé</label><select id="hc-i-building" class="fi" onchange="MX.Pages.HeatingConfig._onInstallationBuildingChange(this.value)">' +
      '<option value=""' + (!c.buildingId ? ' selected' : '') + '>— Non assigné —</option>' +
      _buildings.filter(function (b) { return !b.archived; }).map(function (b) { return '<option value="' + b.id + '"' + (c.buildingId === b.id ? ' selected' : '') + '>' + MX.esc(b.name) + '</option>'; }).join('') + '</select>' +
      '<div id="hc-i-buildingmode">' + _installationBuildingModeHtml(c.buildingId || '') + '</div>' +
      '<label>Emplacement / zone desservie (facultatif)</label><input id="hc-i-zone" class="fi" value="' + MX.esc(c.zone || '') + '" placeholder="Ex: Chambres étage 2">' +
      '<label>Description (facultatif)</label><textarea id="hc-i-desc" class="fi" rows="2">' + MX.esc(c.description || '') + '</textarea>' +
      '<label>Type de régulation</label><select id="hc-i-regtype" class="fi" onchange="MX.Pages.HeatingConfig._onRegTypeChange(this.value)">' +
      '<option value="">— Non renseigné —</option>' +
      Object.keys(REG_LABELS).map(function (k) { return '<option value="' + k + '"' + ((c.regulationType || '') === k ? ' selected' : '') + '>' + REG_LABELS[k] + '</option>'; }).join('') + '</select>' +
      '<div id="hc-i-regfields">' + _regulationFieldsHtml(c.regulationType || '', c) + '</div>' +
      '<label>Température cible de la zone (°C, facultatif)</label><input id="hc-i-target" class="fi" type="number" step="0.5" value="' + (typeof c.targetTemp === 'number' ? c.targetTemp : '') + '">' +
      '<label>Température minimale autorisée (°C, facultatif — resserre, en plus des limites spécifiques CTA/VC ci-dessous, TOUTE proposition chiffrée pour cette installation, jamais un élargissement)</label><input id="hc-i-tempmin" class="fi" type="number" step="0.5" value="' + (typeof c.tempMin === 'number' ? c.tempMin : '') + '">' +
      '<label>Température maximale autorisée (°C, facultatif — même principe)</label><input id="hc-i-tempmax" class="fi" type="number" step="0.5" value="' + (typeof c.tempMax === 'number' ? c.tempMax : '') + '">' +
      '<div id="hc-i-capfields">' + _installationCapFieldsHtml(c.type || '', c) + '</div>' +
    '</div>';
    MX.showModal({
      title: _editingInstallation ? 'Modifier l\'installation' : 'Ajouter une installation', body: body, noAutoClose: true,
      actions: [
        { label: _editingInstallation ? 'Enregistrer' : 'Créer', cls: 'primary-btn', fn: function () { _submitInstallationForm(id); } },
        { label: 'Annuler', cls: 'cancel', fn: function () { MX.closeModal(); } },
        _editingInstallation ? { label: _editingInstallation.archived ? 'Réactiver' : 'Archiver', cls: 'cso-ibtn', fn: function () { MX.closeModal(); _archiveInstallation(id, !_editingInstallation.archived); } } : null,
      ].filter(function (a) { return a; }),
    });
  }
  // Affichage LECTURE SEULE du mode du bâtiment associé — jamais un champ
  // éditable ici : le mode (automatique/manuel assisté) est une propriété
  // du BÂTIMENT (voir _openBuildingForm), pas de chacune de ses
  // installations ; un override par installation casserait la garantie
  // "un bâtiment automatique ne reçoit jamais de proposition de réglage
  // manuel" (Correction 1). On se contente de le rappeler clairement ici.
  function _installationBuildingModeHtml(buildingId) {
    var b = _buildings.find(function (x) { return x.id === buildingId; });
    if (!b) return '<div class="ctavc-hint-inline">Sélectionnez un bâtiment pour voir son mode de fonctionnement.</div>';
    return '<div class="ctavc-hint-inline"><i class="fas fa-circle-info"></i> Mode du bâtiment : <strong>' +
      (b.mode === 'automatique' ? 'Automatique — MX surveille uniquement, aucune proposition de réglage pour cette installation' : 'Manuel assisté — MX peut proposer un réglage') +
      '</strong> (réglable uniquement depuis l\'onglet Bâtiments).</div>';
  }
  function _onInstallationBuildingChange(buildingId) {
    var el = document.getElementById('hc-i-buildingmode');
    if (el) el.innerHTML = _installationBuildingModeHtml(buildingId);
  }
  // Champs de régulation — MÊME sémantique que assets/js/pages/cta-vc.js:
  // _regulationFieldsHtml (mêmes noms de champs Firestore : waterSetpoint/
  // waterLawCurve/setpointType/setpointValue/regulationDescription) pour
  // que les deux formulaires restent interchangeables sur heating_circuits.
  // RÉELLEMENT utilisés par le moteur : voir heating-engine.js
  // _regulationKnown()/_currentSettingLabel(), qui pilotent le "Conseil
  // prioritaire du jour" (moteur v1) — sans ces champs, une installation
  // créée ici restait auparavant invisible à ce moteur (signalé dans le
  // bilan précédent, corrigé ici).
  function _regulationFieldsHtml(reg, c) {
    var h = '';
    if (reg === 'vanne_3v' || reg === 'mixte') {
      h += '<label>Consigne eau de départ (°C)</label><input id="hc-i-watersp" class="fi" type="number" step="0.5" value="' + (typeof c.waterSetpoint === 'number' ? c.waterSetpoint : '') + '">';
      h += '<label>Loi d\'eau / courbe de chauffe (texte libre)</label><input id="hc-i-waterlaw" class="fi" value="' + MX.esc(c.waterLawCurve || '') + '">';
    }
    if (reg === 'consigne' || reg === 'mixte') {
      h += '<label>Nature de la consigne actuelle</label><select id="hc-i-setpointtype" class="fi">' +
        '<option value="">— Non précisé —</option>' +
        '<option value="ambiante"' + (c.setpointType === 'ambiante' ? ' selected' : '') + '>Température ambiante</option>' +
        '<option value="eau"' + (c.setpointType === 'eau' ? ' selected' : '') + '>Température d\'eau</option>' +
        '<option value="autre"' + (c.setpointType === 'autre' ? ' selected' : '') + '>Autre</option>' +
      '</select>';
      h += '<label>Valeur de consigne actuelle</label><input id="hc-i-setpointval" class="fi" type="number" step="0.5" value="' + (typeof c.setpointValue === 'number' ? c.setpointValue : '') + '">';
    }
    if (reg === 'autre') {
      h += '<label>Description de la régulation</label><textarea id="hc-i-regdesc" class="fi" rows="2">' + MX.esc(c.regulationDescription || '') + '</textarea>';
    }
    return h;
  }
  function _onRegTypeChange(val) {
    var el = document.getElementById('hc-i-regfields');
    if (el) el.innerHTML = _regulationFieldsHtml(val, _editingInstallation || {});
  }
  function _installationCapFieldsHtml(type, c) {
    if (type === 'vc') {
      return '<label>Plafond température eau (°C, jamais au-delà de 50°C)</label><input id="hc-i-vcmax" class="fi" type="number" step="0.5" max="50" min="1" value="' + (typeof c.vcMaxTemp === 'number' ? c.vcMaxTemp : 50) + '">';
    }
    if (type === 'cta') {
      return '<label>Plage de soufflage (air, °C)</label><div style="display:flex;gap:8px">' +
        '<input id="hc-i-ctamin" class="fi" type="number" step="0.5" placeholder="Min" value="' + (typeof c.ctaRangeMin === 'number' ? c.ctaRangeMin : 18) + '">' +
        '<input id="hc-i-ctamax" class="fi" type="number" step="0.5" placeholder="Max" value="' + (typeof c.ctaRangeMax === 'number' ? c.ctaRangeMax : 22) + '"></div>' +
        '<label>Limites eau de batterie (°C, facultatif — si vide, les limites générales de l\'onglet Configuration/CTA-VC s\'appliquent ; si aucune des deux n\'est définie, aucune proposition chiffrée n\'est calculée pour cette grandeur)</label><div style="display:flex;gap:8px">' +
        '<input id="hc-i-watermin" class="fi" type="number" step="0.5" placeholder="Min" value="' + (typeof c.waterTempMin === 'number' ? c.waterTempMin : '') + '">' +
        '<input id="hc-i-watermax" class="fi" type="number" step="0.5" placeholder="Max" value="' + (typeof c.waterTempMax === 'number' ? c.waterTempMax : '') + '"></div>';
    }
    return '<div class="ctavc-hint-inline">Ce type d\'installation n\'est pas encore couvert par le moteur de propositions chiffrées DJU MX (réservé CTA/VC) — seules les températures minimale/maximale autorisées ci-dessus sont enregistrées, à titre informatif.</div>';
  }
  function _onInstallationTypeChange(val) {
    var el = document.getElementById('hc-i-capfields');
    if (el) el.innerHTML = _installationCapFieldsHtml(val, _editingInstallation || {});
  }
  function _submitInstallationForm(id) {
    if (!_canManage()) { _denyManage(); return; }
    var name = _strOrNull('hc-i-name');
    if (!name) { MX.toast('Le nom est obligatoire', true); return; }
    var type = document.getElementById('hc-i-type').value;
    var regType = document.getElementById('hc-i-regtype').value || null;
    var tempMin = _numOrNull('hc-i-tempmin'), tempMax = _numOrNull('hc-i-tempmax');
    if (tempMin !== null && tempMax !== null && tempMin >= tempMax) { MX.toast('Température minimale/maximale autorisée invalide (min >= max)', true); return; }
    var data = {
      name: name, type: type,
      buildingId: document.getElementById('hc-i-building').value || null,
      zone: _strOrNull('hc-i-zone') || '',
      description: _strOrNull('hc-i-desc') || '',
      regulationType: regType,
      waterSetpoint: (regType === 'vanne_3v' || regType === 'mixte') ? _numOrNull('hc-i-watersp') : null,
      waterLawCurve: (regType === 'vanne_3v' || regType === 'mixte') ? (_strOrNull('hc-i-waterlaw') || null) : null,
      setpointType: (regType === 'consigne' || regType === 'mixte') ? (document.getElementById('hc-i-setpointtype').value || null) : null,
      setpointValue: (regType === 'consigne' || regType === 'mixte') ? _numOrNull('hc-i-setpointval') : null,
      setpointUnit: (regType === 'consigne' || regType === 'mixte') ? '°C' : null,
      regulationDescription: regType === 'autre' ? (_strOrNull('hc-i-regdesc') || null) : null,
      targetTemp: _numOrNull('hc-i-target'),
      tempMin: tempMin, tempMax: tempMax,
      vcMaxTemp: type === 'vc' ? Math.min(50, parseFloat(document.getElementById('hc-i-vcmax').value) || 50) : null,
      ctaRangeMin: type === 'cta' ? _numOrNull('hc-i-ctamin') : null,
      ctaRangeMax: type === 'cta' ? _numOrNull('hc-i-ctamax') : null,
      waterTempMin: type === 'cta' ? _numOrNull('hc-i-watermin') : null,
      waterTempMax: type === 'cta' ? _numOrNull('hc-i-watermax') : null,
    };
    var action = id ? MX.DB.updateHeatingCircuit(id, data, _currentUserName()) : MX.DB.addHeatingCircuit(Object.assign({ createdBy: _currentUserName() }, data), _currentUserName());
    action.then(function () { MX.closeModal(); MX.toast(id ? 'Installation mise à jour' : 'Installation créée'); })
      .catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }
  function _archiveInstallation(id, archived) {
    if (!_canManage()) { _denyManage(); return; }
    MX.DB.archiveHeatingCircuit(id, archived, _currentUserName()).then(function () { MX.toast(archived ? 'Installation archivée' : 'Installation réactivée'); })
      .catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }

  // ════════════════════════════ PIÈCES ════════════════════════════
  // _latestRoomReading / _roomReadingCountToday : purement pour l'affichage
  // (colonne "Dernier relevé" + indication qu'un relevé a déjà été saisi
  // aujourd'hui) — ne remplacent jamais la vraie moyenne calculée par
  // MX.HeatingEngine.computeBuildingAverageTemp (seule source de vérité
  // pour les exclusions zone non suivie/relevé périmé/manquant).
  function _latestRoomReading(roomId) {
    var matches = _readings.filter(function (r) { return r.roomId === roomId && typeof r.temp === 'number'; });
    if (!matches.length) return null;
    return matches.reduce(function (latest, r) {
      var rt = r.recordedAt && r.recordedAt.toDate ? r.recordedAt.toDate().getTime() : new Date(r.recordedAt || 0).getTime();
      var lt = latest.recordedAt && latest.recordedAt.toDate ? latest.recordedAt.toDate().getTime() : new Date(latest.recordedAt || 0).getTime();
      return rt > lt ? r : latest;
    });
  }
  function _piecesHtml() {
    if (_roomDetailId) {
      var rd = _rooms.find(function (r) { return r.id === _roomDetailId; });
      if (rd) return _roomDetailHtml(rd);
      _roomDetailId = null; // zone introuvable (archivée/supprimée entretemps) -> retombe sur la liste
    }
    var h = '<div class="ctavc-toolbar">' +
      '<label class="ctavc-check-inline"><input type="checkbox" ' + (_showArchived ? 'checked' : '') + ' onchange="MX.Pages.HeatingConfig._toggleArchived(this.checked)"> Afficher les zones archivées</label>' +
      '<button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._openRoomReadingForm(null)"><i class="fas fa-temperature-half"></i> Nouveau relevé de température</button>' +
      (_canManage() ? '<button class="primary-btn" style="width:auto" onclick="MX.Pages.HeatingConfig._openRoomForm(null)"><i class="fas fa-plus"></i> Ajouter une zone thermique</button>' : '') + '</div>';
    if (!_buildings.length) { h += '<div class="ctavc-empty-inline">Créez d\'abord un bâtiment pour pouvoir y ajouter des zones thermiques.</div>'; return h; }
    var list = _rooms.filter(function (r) { return _showArchived || !r.archived; });
    if (!list.length) { h += '<div class="ctavc-empty"><i class="fas fa-door-open"></i><div>Aucune zone thermique créée.</div></div>'; return h; }
    h += _roomGroupsHtml(list);
    h += '<div class="ctavc-hint"><i class="fas fa-circle-info"></i> Seules les zones cochées "Suivie" (et non archivées) ET dont le dernier relevé n\'est pas périmé participent à la température moyenne du bâtiment — voir la fiche du bâtiment (Courbe de référence) et la page CTA/VC. Un relevé manquant n\'est jamais compté comme 0°C, il est exclu.</div>';
    return h;
  }
  // REFONTE CTA/VC Phase 7 — regroupement Bâtiment → Installation principale
  // → Zones thermiques (demande utilisateur, point 4). Lecture pure de
  // heating_rooms.installationId (champ existant, inchangé) : AUCUNE zone
  // n'est jamais comptée dans deux groupes (chaque zone n'a qu'un seul
  // installationId), et AUCUNE n'est jamais masquée (une zone sans
  // installation principale valide — null, ou pointant vers une
  // installation archivée/introuvable — retombe systématiquement dans le
  // groupe "Non rattachée à une installation" DE SON PROPRE BÂTIMENT,
  // jamais perdue, jamais dans le groupe d'un autre bâtiment).
  function _roomGroupsHtml(list) {
    var h = '';
    _buildings.forEach(function (building) {
      var buildingRooms = list.filter(function (r) { return r.buildingId === building.id; });
      if (!buildingRooms.length) return;
      var buildingInstallations = _installations.filter(function (i) { return i.buildingId === building.id && !i.archived; });
      var matchedIds = [];
      buildingInstallations.forEach(function (inst) {
        var rooms = buildingRooms.filter(function (r) { return r.installationId === inst.id; });
        if (!rooms.length) return;
        matchedIds.push(inst.id);
        h += _roomGroupTableHtml(building, inst.name, rooms);
      });
      var unassigned = buildingRooms.filter(function (r) { return !r.installationId || matchedIds.indexOf(r.installationId) === -1; });
      if (unassigned.length) h += _roomGroupTableHtml(building, null, unassigned);
    });
    return h;
  }
  function _roomGroupTableHtml(building, installationName, rooms) {
    var h = '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-door-open"></i> ' +
      MX.esc(building.name) + ' — ' + (installationName ? MX.esc(installationName) : 'Non rattachée à une installation') + '</div>';
    h += '<div class="ctavc-hist-table"><table><thead><tr><th>Zone thermique</th><th>Étage/Zone</th><th>Cible</th><th>Dernier relevé</th><th>Suivi</th><th></th></tr></thead><tbody>';
    rooms.forEach(function (r) {
      var lastReading = _latestRoomReading(r.id);
      h += '<tr' + (r.archived ? ' style="opacity:.55"' : '') + '>' +
        '<td><button style="background:none;border:none;padding:0;font-weight:700;color:var(--cyan);cursor:pointer;font-family:var(--ffs)" onclick="MX.Pages.HeatingConfig._openRoomDetail(\'' + r.id + '\')">' + MX.esc(r.name) + (r.archived ? ' <span class="ctavc-archived-tag">archivée</span>' : '') + '</button></td>' +
        '<td>' + (r.floorOrZone ? MX.esc(r.floorOrZone) : '—') + '</td>' +
        '<td>' + (typeof r.targetTemp === 'number' ? r.targetTemp + '°C' : '—') + '</td>' +
        '<td>' + (lastReading ? lastReading.temp + '°C — ' + _fmtDateTime(lastReading.recordedAt) + (lastReading.author ? ' (' + MX.esc(lastReading.author) + ')' : '') : '<span class="ctavc-field-value--na">Aucun relevé</span>') + '</td>' +
        '<td><label class="ctavc-check-inline"><input type="checkbox" ' + (r.trackedActive ? 'checked' : '') + ' ' + (_canManage() ? '' : 'disabled') + ' onchange="MX.Pages.HeatingConfig._toggleRoomTracked(\'' + r.id + '\', this.checked)"> Suivie</label></td>' +
        '<td><button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._openRoomReadingForm(\'' + r.id + '\')"><i class="fas fa-temperature-half"></i> Relevé</button> ' +
        (_canManage() ? '<button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._openRoomForm(\'' + r.id + '\')"><i class="fas fa-pen"></i></button> ' +
        '<button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._archiveRoom(\'' + r.id + '\',' + (!r.archived) + ')"><i class="fas fa-box-archive"></i></button>' : '') + '</td></tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }
  function _openRoomDetail(id) { _roomDetailId = id; render(); }
  // ── Fiche zone thermique détaillée (nouvelle, Phase 7) — consultation
  // seule ; Modifier/Archiver restent les SEULES actions d'écriture
  // disponibles ici (_openRoomForm/_archiveRoom, inchangées). Historique
  // individuel : RÉUTILISE MX.HeatingEngine.buildRoomTemperatureSeries et
  // _roomSeriesChartSvg à l'identique de l'outil de comparaison multi-
  // zones de l'onglet Courbes (demande utilisateur : "ne pas créer un
  // deuxième moteur de calcul") — ici avec une série unique (cette zone
  // seule), les deux outils coexistent sans duplication de logique. ──
  function _roomDetailHtml(r) {
    var building = _buildings.find(function (b) { return b.id === r.buildingId; });
    var installation = r.installationId ? _installations.find(function (i) { return i.id === r.installationId; }) : null;
    var secondaryIds = r.circuitIds || []; // absence = tableau vide (compatibilité anciennes zones, point 2)
    var secondaryNames = secondaryIds.map(function (cid) {
      var c = _installations.find(function (i) { return i.id === cid; });
      return c ? c.name : null;
    }).filter(function (n) { return n; });

    var h = '<button class="ctavc-back-btn" onclick="MX.Pages.HeatingConfig._setTab(\'pieces\')"><i class="fas fa-arrow-left"></i> Retour aux zones thermiques</button>';
    h += '<div class="ctavc-card">';
    h += '<div class="ctavc-detail-head"><div>' +
      '<div class="ctavc-detail-name">' + MX.esc(r.name || '(sans nom)') + (r.archived ? ' <span class="ctavc-archived-tag">archivée</span>' : '') + '</div>' +
      '<div class="ctavc-detail-sub">' + (building ? MX.esc(building.name) : 'Bâtiment non assigné') + (r.floorOrZone ? ' · ' + MX.esc(r.floorOrZone) : '') + '</div></div>' +
      (_canManage() ? '<div class="ctavc-detail-actions"><button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._openRoomForm(\'' + r.id + '\')"><i class="fas fa-pen"></i> Modifier</button>' +
      '<button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._archiveRoom(\'' + r.id + '\',' + (!r.archived) + ')"><i class="fas fa-box-archive"></i> ' + (r.archived ? 'Réactiver' : 'Archiver') + '</button></div>' : '') +
    '</div></div>';

    h += _collapsibleOpenTag('zoneGeneral', 'fa-circle-info', 'Informations générales');
    h += '<div class="ctavc-field-grid">';
    h += _fieldRow('Bâtiment', building ? building.name : null);
    h += _fieldRow('Installation principale', installation ? installation.name : null);
    h += _fieldRow('Circuits secondaires', secondaryNames.length ? secondaryNames.join(', ') : null);
    h += _fieldRow('Étage / zone', r.floorOrZone);
    h += _fieldRow('Température cible', typeof r.targetTemp === 'number' ? r.targetTemp + ' °C' : null);
    h += _fieldRow('Zone suivie (moyenne du bâtiment)', r.trackedActive ? 'Oui' : 'Non');
    h += '</div>';
    h += _collapsibleCloseTag();

    h += _collapsibleOpenTag('zoneHistory', 'fa-thermometer-half', 'Historique individuel des températures');
    h += '<div class="ctavc-toolbar">' +
      '<button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._openRoomReadingForm(\'' + r.id + '\')"><i class="fas fa-temperature-half"></i> Nouveau relevé</button>' +
      '<select class="fi" style="width:auto" onchange="MX.Pages.HeatingConfig._setRoomDetailDays(this.value)">' +
      [7, 14, 30].map(function (d) { return '<option value="' + d + '"' + (d === _roomDetailDays ? ' selected' : '') + '>' + d + ' derniers jours</option>'; }).join('') + '</select>' +
    '</div>';
    var hist = MX.HeatingEngine.buildRoomTemperatureSeries(r.id, _readings, _roomDetailDays, Date.now(), r.targetTemp);
    h += _roomSeriesChartSvg([{ room: r, color: _COMPARE_COLORS[0], data: hist }]);
    h += '<div class="ctavc-field-grid">' +
      _fieldRow('Dernier relevé', hist.lastPoint ? hist.lastPoint.temp + ' °C (' + hist.lastPoint.date + ')' : null) +
      _fieldRow('Écart à la cible', hist.deviation !== null ? (hist.deviation > 0 ? '+' : '') + hist.deviation + ' °C' : null) +
      _fieldRow('Jours sans relevé (' + _roomDetailDays + ' derniers jours)', hist.missingDays.length + ' / ' + _roomDetailDays) +
    '</div>';
    h += '<div class="ctavc-hint"><i class="fas fa-circle-info"></i> Seuls les relevés réellement saisis sont affichés — un jour sans relevé apparaît comme un trou dans la courbe, jamais comme une valeur devinée.</div>';
    h += _collapsibleCloseTag();
    return h;
  }
  var _roomDetailDays = 14;
  function _setRoomDetailDays(days) { _roomDetailDays = parseInt(days, 10) || 14; render(); }

  // Relevé de température de zone thermique — formulaire RÉEL (pas une maquette),
  // ouvert à TOUT rôle authentifié (jamais gardé par _canManage() : voir
  // assets/js/pages/cta-vc.js:_openReadingForm, même principe pour les
  // relevés de circuit — "consultation + relevés autorisés" pour un
  // Technicien, voir assets/js/app.js pour l'accès en lecture à cette
  // page). Plusieurs relevés par jour pour la même zone sont TOUJOURS
  // acceptés (append-only, aucune fusion, aucune limite).
  function _openRoomReadingForm(presetRoomId) {
    if (!_buildings.length || !_rooms.length) { MX.toast('Créez d\'abord un bâtiment et une zone thermique', true); return; }
    var presetRoom = presetRoomId ? _rooms.find(function (r) { return r.id === presetRoomId; }) : null;
    var presetBuildingId = presetRoom ? presetRoom.buildingId : (_buildings[0] && _buildings[0].id);
    var now = new Date();
    var nowLocal = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') +
      'T' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    var body = '<div class="ctavc-form">' +
      '<label>Bâtiment *</label><select id="hc-rr-building" class="fi" onchange="MX.Pages.HeatingConfig._onRoomReadingBuildingChange(this.value)">' +
      _buildings.filter(function (b) { return !b.archived; }).map(function (b) { return '<option value="' + b.id + '"' + (b.id === presetBuildingId ? ' selected' : '') + '>' + MX.esc(b.name) + '</option>'; }).join('') + '</select>' +
      '<label>Zone thermique *</label><select id="hc-rr-room" class="fi">' + _roomOptionsHtml(presetBuildingId, presetRoomId) + '</select>' +
      '<label>Température ambiante (°C) *</label><input id="hc-rr-temp" class="fi" type="number" step="0.1" placeholder="Ex: 19.5">' +
      '<label>Date et heure du relevé *</label><input id="hc-rr-datetime" class="fi" type="datetime-local" value="' + nowLocal + '">' +
      '<label>Auteur</label><div class="ctavc-form-static">' + MX.esc(_currentUserName()) + '</div>' +
      '<label>Commentaire (facultatif)</label><input id="hc-rr-comment" class="fi" placeholder="Ex: fenêtre entrouverte">' +
    '</div>';
    MX.showModal({
      title: 'Nouveau relevé de température de zone thermique', body: body, noAutoClose: true,
      actions: [
        { label: 'Enregistrer', cls: 'primary-btn', fn: function () { _submitRoomReadingForm(); } },
        { label: 'Annuler', cls: 'cancel', fn: function () { MX.closeModal(); } },
      ],
    });
    setTimeout(function () { var el = document.getElementById('hc-rr-temp'); if (el) el.focus(); }, 50);
  }
  function _roomOptionsHtml(buildingId, selectedRoomId) {
    var rooms = _rooms.filter(function (r) { return r.buildingId === buildingId && !r.archived; });
    if (!rooms.length) return '<option value="" disabled selected>Aucune zone thermique active pour ce bâtiment</option>';
    return rooms.map(function (r) { return '<option value="' + r.id + '"' + (r.id === selectedRoomId ? ' selected' : '') + '>' + MX.esc(r.name) + (r.floorOrZone ? ' (' + MX.esc(r.floorOrZone) + ')' : '') + '</option>'; }).join('');
  }
  function _onRoomReadingBuildingChange(buildingId) {
    var el = document.getElementById('hc-rr-room');
    if (el) el.innerHTML = _roomOptionsHtml(buildingId, null);
  }
  function _submitRoomReadingForm() {
    var roomEl = document.getElementById('hc-rr-room');
    var roomId = roomEl ? roomEl.value : null;
    if (!roomId) { MX.toast('Sélectionnez une zone thermique', true); return; }
    var temp = _numOrNull('hc-rr-temp');
    if (temp === null) { MX.toast('Température obligatoire', true); return; }
    var dtEl = document.getElementById('hc-rr-datetime');
    var recordedAt = dtEl && dtEl.value ? new Date(dtEl.value) : new Date();
    var comment = _strOrNull('hc-rr-comment') || '';
    MX.DB.addRoomReading(roomId, temp, _currentUserName(), comment, recordedAt).then(function () {
      MX.closeModal();
      MX.toast('Relevé enregistré');
    }).catch(function (e) {
      MX.toast('Erreur d\'enregistrement (permissions Firestore probablement non configurées) : ' + (e.message || e), true);
    });
  }
  function _openRoomForm(id) {
    if (!_canManage()) { _denyManage(); return; }
    _editingRoom = id ? _rooms.find(function (r) { return r.id === id; }) : null;
    var r = _editingRoom || {};
    var body = '<div class="ctavc-form">' +
      '<label>Nom de la zone thermique *</label><input id="hc-r-name" class="fi" value="' + MX.esc(r.name || '') + '" placeholder="Ex: Chambre 101" maxlength="80">' +
      '<label>Bâtiment *</label><select id="hc-r-building" class="fi">' +
      _buildings.filter(function (b) { return !b.archived; }).map(function (b) { return '<option value="' + b.id + '"' + (r.buildingId === b.id ? ' selected' : '') + '>' + MX.esc(b.name) + '</option>'; }).join('') + '</select>' +
      '<label>Étage / zone (facultatif)</label><input id="hc-r-floor" class="fi" value="' + MX.esc(r.floorOrZone || '') + '" placeholder="Ex: Étage 1">' +
      '<label>Installation principale (facultatif)</label><select id="hc-r-installation" class="fi" onchange="MX.Pages.HeatingConfig._onRoomInstallationChange(this.value)"><option value="">— Aucune —</option>' +
      _installations.filter(function (i) { return !i.archived; }).map(function (i) { return '<option value="' + i.id + '"' + (r.installationId === i.id ? ' selected' : '') + '>' + MX.esc(i.name) + '</option>'; }).join('') + '</select>' +
      '<label>Circuits secondaires (facultatif — exclut automatiquement l\'installation principale ci-dessus)</label>' +
      '<div id="hc-r-circuitids">' + _roomCircuitIdsOptionsHtml(r.installationId || '', r.circuitIds || []) + '</div>' +
      '<label>Température cible (°C, facultatif)</label><input id="hc-r-target" class="fi" type="number" step="0.5" value="' + (typeof r.targetTemp === 'number' ? r.targetTemp : '') + '">' +
      '<label class="ctavc-check-inline"><input type="checkbox" id="hc-r-tracked" ' + (r.trackedActive !== false ? 'checked' : '') + '> Zone thermique suivie (participe à la moyenne du bâtiment)</label>' +
    '</div>';
    MX.showModal({
      title: _editingRoom ? 'Modifier la zone thermique' : 'Ajouter une zone thermique', body: body, noAutoClose: true,
      actions: [
        { label: _editingRoom ? 'Enregistrer' : 'Créer', cls: 'primary-btn', fn: function () { _submitRoomForm(id); } },
        { label: 'Annuler', cls: 'cancel', fn: function () { MX.closeModal(); } },
      ],
    });
    setTimeout(function () { var el = document.getElementById('hc-r-name'); if (el) el.focus(); }, 50);
  }
  // REFONTE CTA/VC Phase 7 — circuitIds[] (champ ADDITIF, défaut []) :
  // circuits secondaires d'une zone, DISTINCTS de l'installation principale
  // (installationId, inchangée). L'installation déjà choisie comme
  // principale est TOUJOURS exclue de cette liste (jamais proposée comme
  // case à cocher) — garantit structurellement qu'aucun doublon ne peut
  // être créé depuis ce formulaire à l'affichage ; le retrait explicite
  // ci-dessous (_onRoomInstallationChange) couvre le cas où l'utilisateur
  // CHANGE l'installation principale alors qu'elle était déjà cochée en
  // secondaire — jamais une modification silencieuse (avertissement
  // affiché, demande utilisateur point 3).
  function _roomCircuitIdsOptionsHtml(excludeId, checkedIds) {
    var options = _installations.filter(function (i) { return !i.archived && i.id !== excludeId; });
    if (!options.length) return '<div class="ctavc-hint-inline">Aucune autre installation disponible.</div>';
    return '<div style="display:flex;flex-direction:column;gap:4px">' + options.map(function (i) {
      var checked = checkedIds.indexOf(i.id) !== -1;
      return '<label class="ctavc-check-inline"><input type="checkbox" class="hc-r-circuitid-cb" value="' + i.id + '" ' + (checked ? 'checked' : '') + '> ' + MX.esc(i.name) + '</label>';
    }).join('') + '</div>';
  }
  function _collectCheckedCircuitIdsFromDom() {
    return Array.prototype.slice.call(document.querySelectorAll('#hc-r-circuitids .hc-r-circuitid-cb:checked')).map(function (el) { return el.value; });
  }
  function _onRoomInstallationChange(installationId) {
    var checked = _collectCheckedCircuitIdsFromDom();
    var hadDuplicate = !!(installationId && checked.indexOf(installationId) !== -1);
    if (hadDuplicate) checked = checked.filter(function (cid) { return cid !== installationId; });
    var el = document.getElementById('hc-r-circuitids');
    if (el) el.innerHTML = _roomCircuitIdsOptionsHtml(installationId || '', checked);
    if (hadDuplicate) {
      var inst = _installations.find(function (i) { return i.id === installationId; });
      MX.toast('« ' + (inst ? inst.name : 'Cette installation') + ' » a été retiré(e) des circuits secondaires : elle devient l\'installation principale de cette zone.', true);
    }
  }
  function _submitRoomForm(id) {
    if (!_canManage()) { _denyManage(); return; }
    var name = _strOrNull('hc-r-name');
    if (!name) { MX.toast('Le nom de la zone thermique est obligatoire', true); return; }
    var buildingId = document.getElementById('hc-r-building').value;
    if (!buildingId) { MX.toast('Un bâtiment est obligatoire', true); return; }
    var installationId = document.getElementById('hc-r-installation').value || null;
    var circuitIds = _collectCheckedCircuitIdsFromDom();
    // Garde défensive (deuxième niveau, en plus de l'exclusion déjà
    // appliquée à l'affichage et au changement d'installation ci-dessus) —
    // ne devrait normalement jamais se déclencher depuis ce formulaire,
    // mais couvre une zone existante dont les données seraient déjà
    // incohérentes (créée avant cette phase, ou modifiée hors UI) : jamais
    // un enregistrement silencieux du doublon, toujours un avertissement.
    if (installationId && circuitIds.indexOf(installationId) !== -1) {
      circuitIds = circuitIds.filter(function (cid) { return cid !== installationId; });
      var inst = _installations.find(function (i) { return i.id === installationId; });
      MX.toast('« ' + (inst ? inst.name : 'Cette installation') + ' » a été retiré(e) des circuits secondaires avant l\'enregistrement (déjà installation principale).', true);
    }
    var data = {
      name: name, buildingId: buildingId,
      floorOrZone: _strOrNull('hc-r-floor') || '',
      installationId: installationId,
      circuitIds: circuitIds,
      targetTemp: _numOrNull('hc-r-target'),
      trackedActive: document.getElementById('hc-r-tracked').checked,
    };
    var action = id ? MX.DB.updateHeatingRoom(id, data, _currentUserName()) : MX.DB.addHeatingRoom(data, _currentUserName());
    action.then(function () { MX.closeModal(); MX.toast(id ? 'Zone thermique mise à jour' : 'Zone thermique créée'); })
      .catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }
  function _toggleRoomTracked(id, checked) {
    if (!_canManage()) { _denyManage(); render(); return; }
    MX.DB.updateHeatingRoom(id, { trackedActive: checked }, _currentUserName()).catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }
  function _archiveRoom(id, archived) {
    if (!_canManage()) { _denyManage(); return; }
    var msg = archived ? 'Archiver cette zone thermique ? Ses relevés déjà enregistrés restent conservés dans l\'historique.' : 'Réactiver cette zone thermique ?';
    if (!confirm(msg)) return;
    MX.DB.archiveHeatingRoom(id, archived, _currentUserName()).then(function () { MX.toast(archived ? 'Zone thermique archivée' : 'Zone thermique réactivée'); })
      .catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }

  // ── COMPARAISON INDIVIDUELLE DES PIÈCES (demande utilisateur, passe de
  // finalisation) — sélection libre d'une ou plusieurs zones du bâtiment
  // affiché (ANY zone, pas seulement celles "suivies" pour la moyenne :
  // ceci est un outil de diagnostic, pas le calcul de moyenne lui-même),
  // évolution réelle jour par jour (MX.HeatingEngine.buildRoomTemperatureSeries
  // — jamais une valeur inventée pour combler un relevé manquant), comparée
  // à la température CIBLE de chaque zone. Sélection en mémoire seulement
  // (pas persistée) : un simple outil d'exploration, pas une configuration.
  var _compareRoomIds = [];
  var _compareDays = 14;
  function _toggleCompareRoom(roomId, checked) {
    if (checked) { if (_compareRoomIds.indexOf(roomId) === -1) _compareRoomIds.push(roomId); }
    else { _compareRoomIds = _compareRoomIds.filter(function (id) { return id !== roomId; }); }
    render();
  }
  function _setCompareDays(days) { _compareDays = parseInt(days, 10) || 14; render(); }
  var _COMPARE_COLORS = ['var(--cyan)', 'var(--orange)', 'var(--green)', 'var(--purple, #a78bfa)', 'var(--red)'];
  function _roomComparisonHtml(building) {
    var buildingRooms = _rooms.filter(function (r) { return r.buildingId === building.id && !r.archived; });
    var h = '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-door-open"></i> Comparaison individuelle des zones thermiques</div>';
    if (!buildingRooms.length) {
      h += '<div class="ctavc-empty-inline">Aucune zone thermique créée pour ce bâtiment — voir l\'onglet Zones thermiques.</div></div>';
      return h;
    }
    h += '<div class="ctavc-toolbar">';
    h += buildingRooms.map(function (r) {
      var checked = _compareRoomIds.indexOf(r.id) !== -1;
      return '<label class="ctavc-check-inline"><input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="MX.Pages.HeatingConfig._toggleCompareRoom(\'' + r.id + '\', this.checked)"> ' + MX.esc(r.name) + '</label>';
    }).join('');
    h += '<select class="fi" style="width:auto" onchange="MX.Pages.HeatingConfig._setCompareDays(this.value)">' +
      [7, 14, 30].map(function (d) { return '<option value="' + d + '"' + (d === _compareDays ? ' selected' : '') + '>' + d + ' derniers jours</option>'; }).join('') + '</select>';
    h += '</div>';

    var selectedRooms = buildingRooms.filter(function (r) { return _compareRoomIds.indexOf(r.id) !== -1; });
    if (!selectedRooms.length) {
      h += '<div class="ctavc-empty-inline">Sélectionnez une ou plusieurs zones thermiques ci-dessus pour afficher leur évolution réelle de température.</div></div>';
      return h;
    }
    var series = selectedRooms.map(function (r, i) {
      return {
        room: r,
        color: _COMPARE_COLORS[i % _COMPARE_COLORS.length],
        data: MX.HeatingEngine.buildRoomTemperatureSeries(r.id, _readings, _compareDays, Date.now(), r.targetTemp),
      };
    });
    h += _roomSeriesChartSvg(series);
    h += '<div class="ctavc-hist-table"><table><thead><tr><th>Zone thermique</th><th>Dernier relevé</th><th>Température cible</th><th>Écart</th><th>Jours sans relevé (' + _compareDays + ' derniers jours)</th></tr></thead><tbody>';
    series.forEach(function (s) {
      h += '<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + s.color + ';margin-right:6px"></span>' + MX.esc(s.room.name) + '</td>' +
        '<td>' + (s.data.lastPoint ? s.data.lastPoint.temp + ' °C (' + s.data.lastPoint.date + ')' : '<span class="ctavc-field-value--na">Aucun relevé</span>') + '</td>' +
        '<td>' + (typeof s.room.targetTemp === 'number' ? s.room.targetTemp + ' °C' : '—') + '</td>' +
        '<td>' + (s.data.deviation !== null ? (s.data.deviation > 0 ? '+' : '') + s.data.deviation + ' °C' : '—') + '</td>' +
        '<td>' + s.data.missingDays.length + ' / ' + _compareDays + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="ctavc-hint"><i class="fas fa-circle-info"></i> Seuls les relevés réellement saisis sont affichés — un jour sans relevé apparaît comme un trou dans la courbe, jamais comme une valeur devinée.</div>';
    h += '</div>';
    return h;
  }
  // Graphique SVG multi-séries (X = jour, Y = température) — une zone par
  // ligne de couleur, un relevé manquant interrompt VISIBLEMENT le tracé
  // (jamais relié d'un point à l'autre à travers un trou, qui donnerait
  // l'illusion d'une mesure continue inventée).
  function _roomSeriesChartSvg(series) {
    var W = 600, H = 200, PADt = 10, PADb = 24, PADl = 36, PADr = 10;
    var cW = W - PADl - PADr, cH = H - PADt - PADb;
    var allTemps = [];
    series.forEach(function (s) { s.data.points.forEach(function (p) { if (p.temp !== null) allTemps.push(p.temp); }); s.room.targetTemp !== undefined && typeof s.room.targetTemp === 'number' && allTemps.push(s.room.targetTemp); });
    if (!allTemps.length) return '<div class="ctavc-empty-inline">Aucun relevé réel disponible pour la période sélectionnée — rien à tracer.</div>';
    var minT = Math.min.apply(null, allTemps) - 1, maxT = Math.max.apply(null, allTemps) + 1;
    var n = series[0].data.points.length;
    var px = function (i) { return PADl + (n <= 1 ? 0 : (i / (n - 1)) * cW); };
    var py = function (t) { return PADt + cH - ((t - minT) / (maxT - minT || 1)) * cH; };
    var svg = '<div class="ra-svg-wrap"><svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" style="display:block;overflow:visible" preserveAspectRatio="xMidYMid meet">';
    series.forEach(function (s) {
      var segments = [], current = [];
      s.data.points.forEach(function (p, i) {
        if (p.temp === null) { if (current.length) { segments.push(current); current = []; } return; }
        current.push({ x: px(i), y: py(p.temp) });
      });
      if (current.length) segments.push(current);
      segments.forEach(function (seg) {
        var d = seg.map(function (pt, i) { return (i === 0 ? 'M ' : 'L ') + pt.x.toFixed(1) + ',' + pt.y.toFixed(1); }).join(' ');
        svg += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
        seg.forEach(function (pt) { svg += '<circle cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="3" fill="' + s.color + '"/>'; });
      });
      if (typeof s.room.targetTemp === 'number') {
        var ty = py(s.room.targetTemp).toFixed(1);
        svg += '<line x1="' + PADl + '" y1="' + ty + '" x2="' + (PADl + cW) + '" y2="' + ty + '" stroke="' + s.color + '" stroke-width="1" stroke-dasharray="4,3" opacity="0.5"/>';
      }
    });
    var firstDate = series[0].data.points[0] ? series[0].data.points[0].date : '';
    var lastDate = series[0].data.points[n - 1] ? series[0].data.points[n - 1].date : '';
    svg += '<text x="' + PADl + '" y="' + (H - 6) + '" text-anchor="start" fill="var(--text3)" font-size="8" font-family="sans-serif">' + firstDate + '</text>';
    svg += '<text x="' + (PADl + cW) + '" y="' + (H - 6) + '" text-anchor="end" fill="var(--text3)" font-size="8" font-family="sans-serif">' + lastDate + '</text>';
    svg += '</svg></div>';
    return svg;
  }

  // Petit graphique SVG dédié (DJU en X, température attendue en Y) —
  // même technique "SVG inline sans dépendance" que le reste de l'app
  // (voir assets/js/pages/consommations.js), volontairement plus simple
  // car un seul usage ici.
  function _curveChartSvg(points) {
    var W = 600, H = 180, PADt = 10, PADb = 24, PADl = 36, PADr = 10;
    var cW = W - PADl - PADr, cH = H - PADt - PADb;
    var djus = points.map(function (p) { return p.dju; });
    var temps = points.map(function (p) { return p.expectedIndoorTemp; });
    var minDju = Math.min.apply(null, djus), maxDju = Math.max.apply(null, djus);
    var minT = Math.min.apply(null, temps) - 1, maxT = Math.max.apply(null, temps) + 1;
    if (minDju === maxDju) { minDju -= 1; maxDju += 1; }
    var px = function (dju) { return PADl + ((dju - minDju) / (maxDju - minDju)) * cW; };
    var py = function (t) { return PADt + cH - ((t - minT) / (maxT - minT)) * cH; };
    var d = points.map(function (p, i) { return (i === 0 ? 'M ' : 'L ') + px(p.dju).toFixed(1) + ',' + py(p.expectedIndoorTemp).toFixed(1); }).join(' ');
    var dots = points.map(function (p) { return '<circle cx="' + px(p.dju).toFixed(1) + '" cy="' + py(p.expectedIndoorTemp).toFixed(1) + '" r="3.5" fill="var(--cyan)"/>'; }).join('');
    var xlbls = points.map(function (p) { return '<text x="' + px(p.dju).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" fill="var(--text3)" font-size="8" font-family="sans-serif">DJU ' + p.dju + '</text>'; }).join('');
    return '<div class="ra-svg-wrap"><svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" style="display:block;overflow:visible" preserveAspectRatio="xMidYMid meet">' +
      '<path d="' + d + '" fill="none" stroke="var(--cyan)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' + dots + xlbls + '</svg></div>';
  }

  function _r1(v) { return Math.round(v * 10) / 10; }

  function _openCurvePointForm(id) {
    if (!_canManage()) { _denyManage(); return; }
    var p = id ? _curvePoints.find(function (x) { return x.id === id; }) : null;
    var body = '<div class="ctavc-form">' +
      '<label>DJU *</label><input id="hc-c-dju" class="fi" type="number" step="0.5" value="' + (p ? p.dju : '') + '">' +
      '<label>Température intérieure attendue (°C) *</label><input id="hc-c-temp" class="fi" type="number" step="0.5" value="' + (p ? p.expectedIndoorTemp : '') + '">' +
      '<label>Période d\'observation (facultatif)</label><input id="hc-c-period" class="fi" value="' + MX.esc(p && p.periodLabel || '') + '" placeholder="Ex: Hiver 2025-2026">' +
    '</div>';
    MX.showModal({
      title: p ? 'Modifier le point de courbe' : 'Ajouter un point de courbe', body: body, noAutoClose: true,
      actions: [
        { label: p ? 'Enregistrer' : 'Ajouter', cls: 'primary-btn', fn: function () { _submitCurvePointForm(id); } },
        { label: 'Annuler', cls: 'cancel', fn: function () { MX.closeModal(); } },
      ],
    });
  }
  function _submitCurvePointForm(id) {
    if (!_canManage()) { _denyManage(); return; }
    var dju = _numOrNull('hc-c-dju'), temp = _numOrNull('hc-c-temp');
    if (dju === null || temp === null) { MX.toast('DJU et température attendue sont obligatoires', true); return; }
    var data = { buildingId: _curveBuildingId, dju: dju, expectedIndoorTemp: temp, periodLabel: _strOrNull('hc-c-period') || null };
    var action = id ? MX.DB.updateHeatingCurvePoint(id, data, _currentUserName()) : MX.DB.addHeatingCurvePoint(data, _currentUserName());
    action.then(function () { MX.closeModal(); MX.toast(id ? 'Point mis à jour' : 'Point ajouté'); })
      .catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }
  function _deleteCurvePoint(id) {
    if (!_canManage()) { _denyManage(); return; }
    if (!confirm('Supprimer ce point de courbe ? Cette action est définitive (un point de référence mal saisi peut être corrigé ainsi, contrairement aux relevés et recommandations qui restent toujours conservés).')) return;
    MX.DB.deleteHeatingCurvePoint(id, _currentUserName()).then(function () { MX.toast('Point supprimé'); })
      .catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.HeatingConfig = {
    render: render, _destroy: _destroy, _setTab: _setTab, _toggleArchived: _toggleArchived,
    _openBuildingForm: _openBuildingForm, _archiveBuilding: _archiveBuilding,
    _openBuildingDetail: _openBuildingDetail, _pickBuildingPhoto: _pickBuildingPhoto,
    _cancelBuildingPhotoPick: _cancelBuildingPhotoPick, _confirmBuildingPhoto: _confirmBuildingPhoto,
    _removeBuildingPhoto: _removeBuildingPhoto,
    _openInstallationForm: _openInstallationForm, _onInstallationTypeChange: _onInstallationTypeChange, _archiveInstallation: _archiveInstallation,
    _onInstallationBuildingChange: _onInstallationBuildingChange, _onRegTypeChange: _onRegTypeChange,
    _openInstallationDetail: _openInstallationDetail, _onInstallSectionToggle: _onInstallSectionToggle,
    _pickInstallationPhoto: _pickInstallationPhoto, _cancelInstallationPhotoPick: _cancelInstallationPhotoPick,
    _confirmInstallationPhoto: _confirmInstallationPhoto, _removeInstallationPhoto: _removeInstallationPhoto,
    _openRoomForm: _openRoomForm, _toggleRoomTracked: _toggleRoomTracked, _archiveRoom: _archiveRoom,
    _openRoomDetail: _openRoomDetail, _setRoomDetailDays: _setRoomDetailDays,
    _onRoomInstallationChange: _onRoomInstallationChange,
    _openRoomReadingForm: _openRoomReadingForm, _onRoomReadingBuildingChange: _onRoomReadingBuildingChange, _submitRoomReadingForm: _submitRoomReadingForm,
    _openCurvePointForm: _openCurvePointForm, _deleteCurvePoint: _deleteCurvePoint,
    _toggleCompareRoom: _toggleCompareRoom, _setCompareDays: _setCompareDays,
  };
})();
