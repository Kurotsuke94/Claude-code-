(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  // CONFIGURATION THERMIQUE — bâtiments / installations / pièces / courbes
  // ------------------------------------------------------------------
  // Consultation + relevés de pièce ouverts à tout rôle authentifié (voir
  // assets/js/app.js:renderPage) ; la configuration structurelle
  // (bâtiments/installations/pièces/courbes) reste réservée Responsable/
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
  var _curveBuildingId = null; // bâtiment actuellement affiché dans l'onglet Courbes
  var _editingBuilding = null, _editingInstallation = null, _editingRoom = null;
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
  // température de pièce (voir _openRoomReadingForm, jamais gardé par
  // _canManage) — exactement comme il peut déjà consulter + relever sur
  // CTA/VC. render() n'est donc plus une porte Responsable/Admin : CHAQUE
  // action de configuration structurelle (bâtiments/installations/pièces/
  // courbes) reste individuellement protégée par _canManage()/_denyManage()
  // ci-dessous, et les boutons correspondants sont masqués pour un
  // Technicien (jamais seulement désactivés côté visuel — voir aussi
  // firestore.rules.draft-claims-migration pour la protection serveur,
  // seule qui compte réellement).
  function render() {
    _subscribe();
    _ensureWeather();
    var mc = document.getElementById('main-content');
    if (!mc) return;
    mc.innerHTML = _html();
  }
  function _setTab(tab) { _tab = tab; render(); }

  function _html() {
    var h = '<div class="ctavc-wrap">';
    h += '<div class="page-head"><div><div class="page-title"><i class="fas fa-temperature-three-quarters"></i> Configuration thermique</div>' +
      '<div class="page-sub">Bâtiments, installations, pièces et courbes DJU / température intérieure — DJU MX</div></div></div>';
    h += '<div class="ctavc-tabs">';
    [
      { id: 'batiments', l: 'Bâtiments', icon: 'fa-building' },
      { id: 'installations', l: 'Installations', icon: 'fa-diagram-project' },
      { id: 'pieces', l: 'Pièces', icon: 'fa-door-open' },
      { id: 'courbes', l: 'Courbes DJU / température', icon: 'fa-chart-line' },
    ].forEach(function (t) {
      h += '<button class="ctavc-tab' + (_tab === t.id ? ' ctavc-tab--on' : '') + '" onclick="MX.Pages.HeatingConfig._setTab(\'' + t.id + '\')">' +
        '<i class="fas ' + t.icon + '"></i> ' + t.l + '</button>';
    });
    h += '</div><div class="ctavc-body">';
    if (_tab === 'batiments') h += _batimentsHtml();
    else if (_tab === 'installations') h += _installationsHtml();
    else if (_tab === 'pieces') h += _piecesHtml();
    else if (_tab === 'courbes') h += _courbesHtml();
    h += '</div></div>';
    return h;
  }

  // ════════════════════════════ BÂTIMENTS ════════════════════════════
  function _batimentsHtml() {
    var h = '<div class="ctavc-toolbar">' +
      '<label class="ctavc-check-inline"><input type="checkbox" ' + (_showArchived ? 'checked' : '') + ' onchange="MX.Pages.HeatingConfig._toggleArchived(this.checked)"> Afficher les bâtiments archivés</label>' +
      (_canManage() ? '<button class="primary-btn" style="width:auto" onclick="MX.Pages.HeatingConfig._openBuildingForm(null)"><i class="fas fa-plus"></i> Ajouter un bâtiment</button>' : '') + '</div>';
    var list = _buildings.filter(function (b) { return _showArchived || !b.archived; });
    if (!list.length) {
      h += '<div class="ctavc-empty"><i class="fas fa-building"></i><div>Aucun bâtiment créé' + (_canManage() ? '. Les bâtiments ne sont jamais codés en dur : créez-en un pour commencer.' : '.') + '</div></div>';
      return h;
    }
    list.forEach(function (b) {
      var installCount = _installations.filter(function (i) { return i.buildingId === b.id && !i.archived; }).length;
      var roomCount = _rooms.filter(function (r) { return r.buildingId === b.id && !r.archived; }).length;
      h += '<div class="ctavc-card' + (b.archived ? ' ctavc-circuit-card--archived' : '') + '">';
      h += '<div class="ctavc-detail-head"><div><div class="ctavc-detail-name">' + MX.esc(b.name) + (b.archived ? ' <span class="ctavc-archived-tag">archivé</span>' : '') + '</div>' +
        '<div class="ctavc-detail-sub">' + (b.mode === 'automatique' ? 'Régulation automatique — MX surveille uniquement' : 'Pilotage manuel assisté — MX propose, le technicien valide') + '</div></div>' +
        (_canManage() ? '<div class="ctavc-detail-actions"><button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._openBuildingForm(\'' + b.id + '\')"><i class="fas fa-pen"></i> Modifier</button>' +
        '<button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._archiveBuilding(\'' + b.id + '\',' + (!b.archived) + ')"><i class="fas fa-box-archive"></i> ' + (b.archived ? 'Réactiver' : 'Archiver') + '</button></div>' : '') + '</div>';
      if (b.description) h += '<div class="ctavc-detail-desc">' + MX.esc(b.description) + '</div>';
      h += '<div class="ctavc-field-grid">' +
        _fieldRow('Mode de fonctionnement', b.mode === 'automatique' ? 'Automatique (loi d\'eau/régulation existante)' : 'Manuel assisté') +
        _fieldRow('Installations actives', String(installCount)) +
        _fieldRow('Pièces suivies', String(roomCount)) +
      '</div></div>';
    });
    return h;
  }
  function _fieldRow(label, value) {
    return '<div class="ctavc-field-row"><span class="ctavc-field-label">' + MX.esc(label) + '</span>' +
      '<span class="ctavc-field-value' + (value ? '' : ' ctavc-field-value--na') + '">' + (value ? MX.esc(String(value)) : 'Donnée non disponible') + '</span></div>';
  }
  function _toggleArchived(v) { _showArchived = v; render(); }

  function _openBuildingForm(id) {
    if (!_canManage()) { _denyManage(); return; }
    _editingBuilding = id ? _buildings.find(function (b) { return b.id === id; }) : null;
    var b = _editingBuilding || {};
    var body = '<div class="ctavc-form">' +
      '<label>Nom du bâtiment *</label><input id="hc-b-name" class="fi" value="' + MX.esc(b.name || '') + '" placeholder="Ex: Bâtiment principal" maxlength="80">' +
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
    var data = { name: name, description: _strOrNull('hc-b-desc') || '', mode: document.getElementById('hc-b-mode').value };
    var action = id ? MX.DB.updateHeatingBuilding(id, data, _currentUserName()) : MX.DB.addHeatingBuilding(data, _currentUserName());
    action.then(function () { MX.closeModal(); MX.toast(id ? 'Bâtiment mis à jour' : 'Bâtiment créé'); })
      .catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }
  function _archiveBuilding(id, archived) {
    if (!_canManage()) { _denyManage(); return; }
    var msg = archived ? 'Archiver ce bâtiment ? Ses installations et pièces restent consultables dans l\'historique, mais ce bâtiment ne sera plus proposé pour un nouvel assignement.' : 'Réactiver ce bâtiment ?';
    if (!confirm(msg)) return;
    MX.DB.archiveHeatingBuilding(id, archived, _currentUserName()).then(function () { MX.toast(archived ? 'Bâtiment archivé' : 'Bâtiment réactivé'); })
      .catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }

  // ════════════════════════════ INSTALLATIONS ════════════════════════════
  // Réutilise heating_circuits (CTA/VC/réseau/autre) — même collection que
  // la page CTA/VC. Formulaire complet avec association bâtiment, jamais
  // dupliqué : les modifications faites ici sont les MÊMES documents que
  // ceux affichés dans assets/js/pages/cta-vc.js.
  function _installationsHtml() {
    var h = '<div class="ctavc-toolbar">' +
      '<label class="ctavc-check-inline"><input type="checkbox" ' + (_showArchived ? 'checked' : '') + ' onchange="MX.Pages.HeatingConfig._toggleArchived(this.checked)"> Afficher les installations archivées</label>' +
      (_canManage() ? '<button class="primary-btn" style="width:auto" onclick="MX.Pages.HeatingConfig._openInstallationForm(null)"><i class="fas fa-plus"></i> Ajouter une installation</button>' : '') + '</div>';
    var list = _installations.filter(function (i) { return _showArchived || !i.archived; });
    if (!list.length) { h += '<div class="ctavc-empty"><i class="fas fa-diagram-project"></i><div>Aucune installation créée.</div></div>'; return h; }
    h += '<div class="ctavc-circuit-grid">';
    list.forEach(function (i) {
      var building = _buildings.find(function (b) { return b.id === i.buildingId; });
      h += '<div class="ctavc-circuit-card' + (i.archived ? ' ctavc-circuit-card--archived' : '') + '"' + (_canManage() ? ' onclick="MX.Pages.HeatingConfig._openInstallationForm(\'' + i.id + '\')"' : '') + '>' +
        '<div class="ctavc-circuit-card-head"><span class="ctavc-circuit-type">' + MX.esc((i.type || '').toUpperCase() || '—') + '</span></div>' +
        '<div class="ctavc-circuit-card-name">' + MX.esc(i.name || '(sans nom)') + (i.archived ? ' <span class="ctavc-archived-tag">archivé</span>' : '') + '</div>' +
        '<div class="ctavc-circuit-card-zone">' + (building ? MX.esc(building.name) : 'Non assigné') + '</div>' +
      '</div>';
    });
    h += '</div>';
    h += '<div class="ctavc-hint"><i class="fas fa-circle-info"></i> Pour la saisie de relevés et le suivi des propositions MX, utilisez la page CTA/VC — cette page gère uniquement la configuration structurelle (bâtiment, limites techniques).</div>';
    return h;
  }
  // Même vocabulaire que assets/js/pages/cta-vc.js:REG_LABELS (même
  // collection heating_circuits, mêmes champs — un circuit créé/modifié
  // depuis l'une ou l'autre page reste cohérent).
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
  // pour les exclusions pièce non suivie/relevé périmé/manquant).
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
    var h = '<div class="ctavc-toolbar">' +
      '<label class="ctavc-check-inline"><input type="checkbox" ' + (_showArchived ? 'checked' : '') + ' onchange="MX.Pages.HeatingConfig._toggleArchived(this.checked)"> Afficher les pièces archivées</label>' +
      '<button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._openRoomReadingForm(null)"><i class="fas fa-temperature-half"></i> Nouveau relevé de température</button>' +
      (_canManage() ? '<button class="primary-btn" style="width:auto" onclick="MX.Pages.HeatingConfig._openRoomForm(null)"><i class="fas fa-plus"></i> Ajouter une pièce</button>' : '') + '</div>';
    if (!_buildings.length) { h += '<div class="ctavc-empty-inline">Créez d\'abord un bâtiment pour pouvoir y ajouter des pièces.</div>'; return h; }
    var list = _rooms.filter(function (r) { return _showArchived || !r.archived; });
    if (!list.length) { h += '<div class="ctavc-empty"><i class="fas fa-door-open"></i><div>Aucune pièce créée.</div></div>'; return h; }
    h += '<div class="ctavc-hist-table"><table><thead><tr><th>Pièce</th><th>Bâtiment</th><th>Étage/Zone</th><th>Cible</th><th>Dernier relevé</th><th>Suivi</th><th></th></tr></thead><tbody>';
    list.forEach(function (r) {
      var building = _buildings.find(function (b) { return b.id === r.buildingId; });
      var lastReading = _latestRoomReading(r.id);
      h += '<tr' + (r.archived ? ' style="opacity:.55"' : '') + '>' +
        '<td>' + MX.esc(r.name) + '</td><td>' + (building ? MX.esc(building.name) : '—') + '</td><td>' + (r.floorOrZone ? MX.esc(r.floorOrZone) : '—') + '</td>' +
        '<td>' + (typeof r.targetTemp === 'number' ? r.targetTemp + '°C' : '—') + '</td>' +
        '<td>' + (lastReading ? lastReading.temp + '°C — ' + _fmtDateTime(lastReading.recordedAt) + (lastReading.author ? ' (' + MX.esc(lastReading.author) + ')' : '') : '<span class="ctavc-field-value--na">Aucun relevé</span>') + '</td>' +
        '<td><label class="ctavc-check-inline"><input type="checkbox" ' + (r.trackedActive ? 'checked' : '') + ' ' + (_canManage() ? '' : 'disabled') + ' onchange="MX.Pages.HeatingConfig._toggleRoomTracked(\'' + r.id + '\', this.checked)"> Suivie</label></td>' +
        '<td><button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._openRoomReadingForm(\'' + r.id + '\')"><i class="fas fa-temperature-half"></i> Relevé</button> ' +
        (_canManage() ? '<button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._openRoomForm(\'' + r.id + '\')"><i class="fas fa-pen"></i></button> ' +
        '<button class="cso-ibtn" onclick="MX.Pages.HeatingConfig._archiveRoom(\'' + r.id + '\',' + (!r.archived) + ')"><i class="fas fa-box-archive"></i></button>' : '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="ctavc-hint"><i class="fas fa-circle-info"></i> Seules les pièces cochées "Suivie" (et non archivées) ET dont le dernier relevé n\'est pas périmé participent à la température moyenne du bâtiment — voir l\'onglet Courbes et la page CTA/VC. Un relevé manquant n\'est jamais compté comme 0°C, il est exclu.</div>';
    return h;
  }

  // Relevé de température de pièce — formulaire RÉEL (pas une maquette),
  // ouvert à TOUT rôle authentifié (jamais gardé par _canManage() : voir
  // assets/js/pages/cta-vc.js:_openReadingForm, même principe pour les
  // relevés de circuit — "consultation + relevés autorisés" pour un
  // Technicien, voir assets/js/app.js pour l'accès en lecture à cette
  // page). Plusieurs relevés par jour pour la même pièce sont TOUJOURS
  // acceptés (append-only, aucune fusion, aucune limite).
  function _openRoomReadingForm(presetRoomId) {
    if (!_buildings.length || !_rooms.length) { MX.toast('Créez d\'abord un bâtiment et une pièce', true); return; }
    var presetRoom = presetRoomId ? _rooms.find(function (r) { return r.id === presetRoomId; }) : null;
    var presetBuildingId = presetRoom ? presetRoom.buildingId : (_buildings[0] && _buildings[0].id);
    var now = new Date();
    var nowLocal = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') +
      'T' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    var body = '<div class="ctavc-form">' +
      '<label>Bâtiment *</label><select id="hc-rr-building" class="fi" onchange="MX.Pages.HeatingConfig._onRoomReadingBuildingChange(this.value)">' +
      _buildings.filter(function (b) { return !b.archived; }).map(function (b) { return '<option value="' + b.id + '"' + (b.id === presetBuildingId ? ' selected' : '') + '>' + MX.esc(b.name) + '</option>'; }).join('') + '</select>' +
      '<label>Pièce *</label><select id="hc-rr-room" class="fi">' + _roomOptionsHtml(presetBuildingId, presetRoomId) + '</select>' +
      '<label>Température ambiante (°C) *</label><input id="hc-rr-temp" class="fi" type="number" step="0.1" placeholder="Ex: 19.5">' +
      '<label>Date et heure du relevé *</label><input id="hc-rr-datetime" class="fi" type="datetime-local" value="' + nowLocal + '">' +
      '<label>Auteur</label><div class="ctavc-form-static">' + MX.esc(_currentUserName()) + '</div>' +
      '<label>Commentaire (facultatif)</label><input id="hc-rr-comment" class="fi" placeholder="Ex: fenêtre entrouverte">' +
    '</div>';
    MX.showModal({
      title: 'Nouveau relevé de température de pièce', body: body, noAutoClose: true,
      actions: [
        { label: 'Enregistrer', cls: 'primary-btn', fn: function () { _submitRoomReadingForm(); } },
        { label: 'Annuler', cls: 'cancel', fn: function () { MX.closeModal(); } },
      ],
    });
    setTimeout(function () { var el = document.getElementById('hc-rr-temp'); if (el) el.focus(); }, 50);
  }
  function _roomOptionsHtml(buildingId, selectedRoomId) {
    var rooms = _rooms.filter(function (r) { return r.buildingId === buildingId && !r.archived; });
    if (!rooms.length) return '<option value="" disabled selected>Aucune pièce active pour ce bâtiment</option>';
    return rooms.map(function (r) { return '<option value="' + r.id + '"' + (r.id === selectedRoomId ? ' selected' : '') + '>' + MX.esc(r.name) + (r.floorOrZone ? ' (' + MX.esc(r.floorOrZone) + ')' : '') + '</option>'; }).join('');
  }
  function _onRoomReadingBuildingChange(buildingId) {
    var el = document.getElementById('hc-rr-room');
    if (el) el.innerHTML = _roomOptionsHtml(buildingId, null);
  }
  function _submitRoomReadingForm() {
    var roomEl = document.getElementById('hc-rr-room');
    var roomId = roomEl ? roomEl.value : null;
    if (!roomId) { MX.toast('Sélectionnez une pièce', true); return; }
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
      '<label>Nom de la pièce *</label><input id="hc-r-name" class="fi" value="' + MX.esc(r.name || '') + '" placeholder="Ex: Chambre 101" maxlength="80">' +
      '<label>Bâtiment *</label><select id="hc-r-building" class="fi">' +
      _buildings.filter(function (b) { return !b.archived; }).map(function (b) { return '<option value="' + b.id + '"' + (r.buildingId === b.id ? ' selected' : '') + '>' + MX.esc(b.name) + '</option>'; }).join('') + '</select>' +
      '<label>Étage / zone (facultatif)</label><input id="hc-r-floor" class="fi" value="' + MX.esc(r.floorOrZone || '') + '" placeholder="Ex: Étage 1">' +
      '<label>Installation associée (facultatif)</label><select id="hc-r-installation" class="fi"><option value="">— Aucune —</option>' +
      _installations.filter(function (i) { return !i.archived; }).map(function (i) { return '<option value="' + i.id + '"' + (r.installationId === i.id ? ' selected' : '') + '>' + MX.esc(i.name) + '</option>'; }).join('') + '</select>' +
      '<label>Température cible (°C, facultatif)</label><input id="hc-r-target" class="fi" type="number" step="0.5" value="' + (typeof r.targetTemp === 'number' ? r.targetTemp : '') + '">' +
      '<label class="ctavc-check-inline"><input type="checkbox" id="hc-r-tracked" ' + (r.trackedActive !== false ? 'checked' : '') + '> Pièce suivie (participe à la moyenne du bâtiment)</label>' +
    '</div>';
    MX.showModal({
      title: _editingRoom ? 'Modifier la pièce' : 'Ajouter une pièce', body: body, noAutoClose: true,
      actions: [
        { label: _editingRoom ? 'Enregistrer' : 'Créer', cls: 'primary-btn', fn: function () { _submitRoomForm(id); } },
        { label: 'Annuler', cls: 'cancel', fn: function () { MX.closeModal(); } },
      ],
    });
    setTimeout(function () { var el = document.getElementById('hc-r-name'); if (el) el.focus(); }, 50);
  }
  function _submitRoomForm(id) {
    if (!_canManage()) { _denyManage(); return; }
    var name = _strOrNull('hc-r-name');
    if (!name) { MX.toast('Le nom de la pièce est obligatoire', true); return; }
    var buildingId = document.getElementById('hc-r-building').value;
    if (!buildingId) { MX.toast('Un bâtiment est obligatoire', true); return; }
    var data = {
      name: name, buildingId: buildingId,
      floorOrZone: _strOrNull('hc-r-floor') || '',
      installationId: document.getElementById('hc-r-installation').value || null,
      targetTemp: _numOrNull('hc-r-target'),
      trackedActive: document.getElementById('hc-r-tracked').checked,
    };
    var action = id ? MX.DB.updateHeatingRoom(id, data, _currentUserName()) : MX.DB.addHeatingRoom(data, _currentUserName());
    action.then(function () { MX.closeModal(); MX.toast(id ? 'Pièce mise à jour' : 'Pièce créée'); })
      .catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }
  function _toggleRoomTracked(id, checked) {
    if (!_canManage()) { _denyManage(); render(); return; }
    MX.DB.updateHeatingRoom(id, { trackedActive: checked }, _currentUserName()).catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }
  function _archiveRoom(id, archived) {
    if (!_canManage()) { _denyManage(); return; }
    var msg = archived ? 'Archiver cette pièce ? Ses relevés déjà enregistrés restent conservés dans l\'historique.' : 'Réactiver cette pièce ?';
    if (!confirm(msg)) return;
    MX.DB.archiveHeatingRoom(id, archived, _currentUserName()).then(function () { MX.toast(archived ? 'Pièce archivée' : 'Pièce réactivée'); })
      .catch(function (e) { MX.toast('Erreur : ' + (e.message || e), true); });
  }

  // ════════════════════════════ COURBES DJU / TEMPÉRATURE ════════════════════════════
  function _courbesHtml() {
    if (!_buildings.length) return '<div class="ctavc-empty-inline">Créez d\'abord un bâtiment pour programmer sa courbe thermique.</div>';
    if (!_curveBuildingId || !_buildings.some(function (b) { return b.id === _curveBuildingId; })) _curveBuildingId = _buildings[0].id;
    var building = _buildings.find(function (b) { return b.id === _curveBuildingId; });
    var h = '<div class="ctavc-toolbar"><select class="fi" style="width:auto" onchange="MX.Pages.HeatingConfig._setCurveBuilding(this.value)">' +
      _buildings.map(function (b) { return '<option value="' + b.id + '"' + (b.id === _curveBuildingId ? ' selected' : '') + '>' + MX.esc(b.name) + '</option>'; }).join('') + '</select>' +
      (_canManage() ? '<button class="primary-btn" style="width:auto" onclick="MX.Pages.HeatingConfig._openCurvePointForm(null)"><i class="fas fa-plus"></i> Ajouter un point de courbe</button>' : '') + '</div>';

    var points = _curvePoints.filter(function (p) { return p.buildingId === _curveBuildingId; }).sort(function (a, b) { return a.dju - b.dju; });
    h += '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-chart-line"></i> Courbe de référence programmée — ' + MX.esc(building.name) + '</div>';
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
    h += '</div>';

    h += _curveAnalysisHtml(building, points);
    h += _roomComparisonHtml(building);
    h += '<div class="ctavc-hint"><i class="fas fa-circle-info"></i> Cette courbe est un outil de surveillance et d\'anticipation thermique — ce n\'est jamais une loi d\'eau et elle ne commande jamais directement le chauffage.</div>';
    return h;
  }
  function _setCurveBuilding(id) { _curveBuildingId = id; render(); }

  // ── COMPARAISON INDIVIDUELLE DES PIÈCES (demande utilisateur, passe de
  // finalisation) — sélection libre d'une ou plusieurs pièces du bâtiment
  // affiché (ANY pièce, pas seulement celles "suivies" pour la moyenne :
  // ceci est un outil de diagnostic, pas le calcul de moyenne lui-même),
  // évolution réelle jour par jour (MX.HeatingEngine.buildRoomTemperatureSeries
  // — jamais une valeur inventée pour combler un relevé manquant), comparée
  // à la température CIBLE de chaque pièce. Sélection en mémoire seulement
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
    var h = '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-door-open"></i> Comparaison individuelle des pièces</div>';
    if (!buildingRooms.length) {
      h += '<div class="ctavc-empty-inline">Aucune pièce créée pour ce bâtiment — voir l\'onglet Pièces.</div></div>';
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
      h += '<div class="ctavc-empty-inline">Sélectionnez une ou plusieurs pièces ci-dessus pour afficher leur évolution réelle de température.</div></div>';
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
    h += '<div class="ctavc-hist-table"><table><thead><tr><th>Pièce</th><th>Dernier relevé</th><th>Température cible</th><th>Écart</th><th>Jours sans relevé (' + _compareDays + ' derniers jours)</th></tr></thead><tbody>';
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
  // Graphique SVG multi-séries (X = jour, Y = température) — une pièce par
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

  // ANALYSE DJU / TEMPÉRATURE INTÉRIEURE — raccordement complet (demande
  // utilisateur, passe de finalisation) : compare DJU observé, DJU
  // prévisionnel, température intérieure moyenne RÉELLE, température
  // intérieure CIBLE (= la courbe programmée interpolée au DJU du jour —
  // MX.HeatingEngine.interpolateCurve, jamais extrapolée), écart réel, et
  // évolution sur plusieurs jours (MX.HeatingEngine.analyzeCurveDeviation,
  // apparié à la VRAIE météo du jour — jamais un DJU inventé pour un jour
  // sans donnée). Objectif explicite de l'utilisateur : détecter une baisse
  // de température intérieure avant qu'elle ne devienne problématique —
  // voir la comparaison DJU prévisionnel / seuil de dégradation ci-dessous.
  function _curveAnalysisHtml(building, points) {
    var h = '<div class="ctavc-card"><div class="ctavc-card-head"><i class="fas fa-magnifying-glass-chart"></i> Analyse DJU / température intérieure</div>';
    if (_weatherStatus === 'unconfigured') { h += '<div class="ctavc-empty-inline">Localisation de l\'établissement non configurée (voir Paramètres) — DJU indisponible.</div></div>'; return h; }
    if (!_weatherSeries) { h += '<div class="ctavc-empty-inline">Météo en cours de chargement…</div></div>'; return h; }
    var selectedRoomIds = _rooms.filter(function (r) { return r.buildingId === building.id && r.trackedActive && !r.archived; }).map(function (r) { return r.id; });
    if (!selectedRoomIds.length) { h += '<div class="ctavc-empty-inline">Aucune pièce suivie pour ce bâtiment — voir l\'onglet Pièces.</div></div>'; return h; }

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
      _fieldRow('Température intérieure moyenne (' + avgNow.sampleCount + ' pièce(s))', avgNow.value !== null ? avgNow.value + ' °C' : null) +
      _fieldRow('Température intérieure cible (courbe programmée au DJU du jour)', expectedToday !== null ? expectedToday + ' °C' : (hasCurve ? null : 'Courbe non programmée (2 points minimum)')) +
      _fieldRow('Écart réel à la cible', gapToday !== null ? (gapToday > 0 ? '+' : '') + gapToday + ' °C' : null) +
    '</div>';

    if (!hasCurve) { h += '<div class="ctavc-hint-inline">Programmez au moins 2 points de courbe ci-dessus pour activer la comparaison à une température cible.</div></div>'; return h; }

    // Évolution sur plusieurs jours — échantillons RÉELS uniquement (jour
    // avec relevé de pièce ET donnée météo disponible, jamais l'un inventé
    // pour l'autre).
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
      h += '<div class="ctavc-empty-inline">Aucun jour des 14 derniers jours ne dispose à la fois d\'un relevé de pièce ET d\'une donnée météo — l\'évolution sur plusieurs jours n\'est pas encore exploitable.</div></div>';
      return h;
    }

    // FIABILITÉ STATISTIQUE (demande utilisateur, passe de fiabilisation) —
    // seuils EXPLICITES et DOCUMENTÉS (voir MX.HeatingEngine.
    // DJU_ANALYSIS_MIN_PARTIAL/DJU_ANALYSIS_MIN_SUFFICIENT) : la fiabilité
    // des données est TOUJOURS affichée avant toute conclusion, et un
    // échantillon "insuffisant" (moins de 3 jours exploitables) ne produit
    // JAMAIS de seuil de dégradation ni d'alerte — même s'il existe un
    // écart apparent sur les 1-2 points disponibles. "Deux jours de
    // mesures ne doivent jamais produire une recommandation à confiance
    // élevée" (consigne explicite).
    var sufficiencyLabel = { suffisant: 'Données suffisantes', partiel: 'Données partielles — confiance limitée', insuffisant: 'Données insuffisantes' }[analysis.dataSufficiency];
    var sufficiencyClass = { suffisant: 'ctavc-confidence--haute', partiel: 'ctavc-confidence--moyenne', insuffisant: 'ctavc-confidence--faible' }[analysis.dataSufficiency];
    h += '<div class="ctavc-hint-inline"><span class="ctavc-confidence ' + sufficiencyClass + '">' + sufficiencyLabel + '</span> — ' + analysis.sampleCount + ' jour(s) exploitable(s) sur 14 ' +
      '(seuils : &lt;' + MX.HeatingEngine.DJU_ANALYSIS_MIN_PARTIAL + ' = insuffisant, ' + MX.HeatingEngine.DJU_ANALYSIS_MIN_PARTIAL + '-' + (MX.HeatingEngine.DJU_ANALYSIS_MIN_SUFFICIENT - 1) + ' = partiel, ≥' + MX.HeatingEngine.DJU_ANALYSIS_MIN_SUFFICIENT + ' = suffisant).</div>';

    if (analysis.dataSufficiency === 'insuffisant') {
      h += '<div class="ctavc-empty-inline">Échantillon trop réduit (' + analysis.sampleCount + ' jour(s)) pour détecter un quelconque seuil de dégradation de façon fiable — aucune conclusion n\'est présentée tant que moins de ' + MX.HeatingEngine.DJU_ANALYSIS_MIN_PARTIAL + ' jours ne sont disponibles. Continuez à saisir des relevés pour affiner l\'analyse.</div>';
    } else if (analysis.degradationFromDju !== null) {
      // Objectif explicite : détecter une baisse AVANT qu'elle devienne
      // problématique -> compare le seuil de dégradation détecté au DJU
      // prévisionnel de demain. Jamais présenté comme une alerte forte
      // tant que les données restent "partielles".
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
    h += '</div>';
    return h;
  }

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
    _openInstallationForm: _openInstallationForm, _onInstallationTypeChange: _onInstallationTypeChange, _archiveInstallation: _archiveInstallation,
    _onInstallationBuildingChange: _onInstallationBuildingChange, _onRegTypeChange: _onRegTypeChange,
    _openRoomForm: _openRoomForm, _toggleRoomTracked: _toggleRoomTracked, _archiveRoom: _archiveRoom,
    _openRoomReadingForm: _openRoomReadingForm, _onRoomReadingBuildingChange: _onRoomReadingBuildingChange, _submitRoomReadingForm: _submitRoomReadingForm,
    _setCurveBuilding: _setCurveBuilding, _openCurvePointForm: _openCurvePointForm, _deleteCurvePoint: _deleteCurvePoint,
    _toggleCompareRoom: _toggleCompareRoom, _setCompareDays: _setCompareDays,
  };
})();
