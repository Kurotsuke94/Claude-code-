(function () {
  'use strict';

  // ── VISIBILITÉ DES MODULES (Super Admin) ────────────────────────────────
  // Écran réservé au Super Admin (MX.Auth.isSuperAdmin()) permettant de
  // configurer quels éléments de menu sont visibles pour les profils
  // technicien et responsable. Gère UNIQUEMENT la visibilité des menus —
  // aucune permission fonctionnelle (MX.Auth.can()) n'est modifiée, aucune
  // route/donnée n'est supprimée.
  //
  // Le registre ITEMS ci-dessous utilise les VRAIS ids internes de
  // navigation (ceux passés à MX.showPage()/MX.showAdminTab() dans
  // assets/js/app.js buildNav()) — voir ce fichier pour leur usage réel.
  // "maint" est partagé par deux entrées de menu qui pointent vers la même
  // page ('pmp') : le groupe "Maintenance PMP" et le lien du même nom sous
  // Centre de Pilotage > MAINTENANCE.
  const ITEMS = [
    { id: 'mes-missions',         label: 'Missions',                 desc: 'Gestion des missions',             family: 'MODULES' },
    { id: 'consommations',        label: 'Compteurs',                desc: 'Relevés de compteurs',              family: 'MODULES' },
    { id: 'interventions',        label: 'Interventions',            desc: 'Gestion des interventions',         family: 'MODULES' },
    { id: 'planning',             label: 'Planning',                 desc: 'Planning des équipes',              family: 'MODULES' },
    { id: 'documents',            label: 'Ressources',               desc: 'Gestion des ressources',            family: 'GESTION' },
    { id: 'msgs',                 label: 'Journal',                  desc: "Journal d'activité",                family: 'GESTION' },
    { id: 'stock',                label: 'Stock',                    desc: 'Gestion du stock',                  family: 'GESTION' },
    { id: 'anly',                 label: 'Analyses',                 desc: 'Analyses et statistiques',          family: 'GESTION' },
    { id: 'maint',                label: 'Maintenance PMP',          desc: 'Maintenance préventive',            family: 'GESTION' },
    { id: 'mxdoc',                label: 'MX Doc',                   desc: 'Documentation technique',           family: 'GESTION' },
    { id: 'org-resp',             label: 'Organisation Responsable', desc: "Organisation de l'équipe",          family: 'PILOTAGE' },
    { id: 'gestion-semaine-tech', label: 'Gestion semaine tech',     desc: 'Gestion des semaines techniciens',  family: 'PILOTAGE' },
    { id: 'alerts',               label: 'Alertes',                  desc: 'Alertes et notifications',          family: 'SUPERVISION' },
    { id: 'alertes-config',       label: 'Config Alertes',           desc: 'Configuration des alertes',         family: 'SUPERVISION' },
    { id: 'logs',                 label: 'Activité',                 desc: "Suivi d'activité",                  family: 'SUPERVISION' },
    { id: 'history',              label: 'Historique',               desc: 'Historique des actions',            family: 'SUPERVISION' },
    { id: 'bible-admin',          label: 'Validation Bible',         desc: 'Validation des données',            family: 'CONNAISSANCES' },
    { id: 'badges-admin',         label: 'Badges',                   desc: 'Gestion des badges',                family: 'CONNAISSANCES' },
    { id: 'corbeille',            label: 'Corbeille & Archives',     desc: 'Éléments supprimés',                family: 'DONNÉES' },
  ];
  const FAMILIES = ['MODULES', 'GESTION', 'PILOTAGE', 'SUPERVISION', 'CONNAISSANCES', 'DONNÉES'];

  // ── API CŒUR — consommée par assets/js/app.js (buildNav()), indépendante
  // du rendu de cet écran. Ne jamais faire dépendre ces fonctions du DOM de
  // la page d'édition : elles doivent fonctionner même si l'écran Super
  // Admin n'a jamais été ouvert. ──
  function _roleFamily() {
    // Un admin Firebase (donc aussi le Super Admin lui-même) voit toujours
    // tout — la configuration ne s'applique qu'aux profils technicien et
    // responsable (comptes PIN). Voir décision validée par l'utilisateur.
    if (MX.Auth.isAdmin()) return null;
    const cu = MX.state.currentUser;
    if (!cu) return null;
    return (cu.role === 'responsable' || cu.rank === 'responsable') ? 'responsable' : 'tech';
  }
  function shouldShow(itemId) {
    const fam = _roleFamily();
    if (!fam) return true; // admin/Super Admin, ou pas encore de session → jamais masqué
    const cfg = MX.state.navVisibility;
    if (!cfg || !cfg[itemId]) return true; // pas de config (ou item absent) → visible par défaut (migration sans changement)
    return cfg[itemId][fam] !== false; // seul "false" explicite masque
  }

  // ── ÉTAT LOCAL DE L'ÉCRAN (brouillon d'édition, non enregistré) ──
  let _draft       = null;
  let _resizeBound = false;

  function _canAccess() { return !!(window.MX && MX.Auth && MX.Auth.isSuperAdmin && MX.Auth.isSuperAdmin()); }

  function _ensureDraft() {
    if (_draft) return;
    const src = MX.state.navVisibility || {};
    _draft = {};
    ITEMS.forEach(it => {
      const s = src[it.id];
      _draft[it.id] = { tech: !s || s.tech !== false, responsable: !s || s.responsable !== false };
    });
  }

  function _actorName() {
    return MX.state.adminUser ? (MX.state.adminUser.email || 'admin') : 'admin';
  }

  // ── ACTIONS ──
  function _toggle(itemId, fam) {
    if (!_canAccess()) return;
    _ensureDraft();
    if (!_draft[itemId]) return;
    _draft[itemId][fam] = !_draft[itemId][fam];
    render();
  }
  function _bulkSet(fam, value) {
    if (!_canAccess()) return;
    _ensureDraft();
    ITEMS.forEach(it => { _draft[it.id][fam] = value; });
    render();
  }
  async function _save() {
    if (!_canAccess()) return; // filet de sécurité — le bouton n'est déjà rendu que pour le Super Admin
    _ensureDraft();
    try {
      await MX.DB.saveNavVisibility(_draft, _actorName());
      MX.toast('✓ Configuration enregistrée');
    } catch (e) {
      MX.toast('Erreur lors de l\'enregistrement — la configuration n\'a pas été modifiée', true);
    }
  }

  // ── RENDU ──
  function _toggleBtn(itemId, fam, value) {
    const bg = value ? 'var(--green)' : 'var(--bg4)';
    const justify = value ? 'flex-end' : 'flex-start';
    return '<button type="button" aria-pressed="' + (value ? 'true' : 'false') + '" title="' + (value ? 'Visible' : 'Masqué') + '"' +
      ' onclick="MX.Pages.NavVisibility._toggle(\'' + itemId + '\',\'' + fam + '\')"' +
      ' style="display:inline-flex;align-items:center;gap:8px;background:none;border:none;cursor:pointer;padding:6px 4px;min-height:36px">' +
      '<span style="width:40px;height:22px;border-radius:11px;background:' + bg + ';display:flex;align-items:center;padding:2px;justify-content:' + justify + ';transition:background .15s;flex-shrink:0">' +
        '<span style="width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3)"></span>' +
      '</span>' +
      '<span style="font-size:12px;font-weight:700;color:' + (value ? 'var(--green)' : 'var(--text3)') + ';min-width:52px;text-align:left">' + (value ? 'Visible' : 'Masqué') + '</span>' +
    '</button>';
  }

  function _tableHtml() {
    const esc = MX.esc;
    let h = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:640px">';
    h += '<thead><tr style="border-bottom:2px solid var(--border2)">' +
      '<th style="text-align:left;padding:10px 8px">Module / Menu</th>' +
      '<th style="text-align:left;padding:10px 8px">Description</th>' +
      '<th style="text-align:left;padding:10px 8px">Technicien</th>' +
      '<th style="text-align:left;padding:10px 8px">Responsable</th>' +
      '</tr></thead><tbody>';
    FAMILIES.forEach(fam => {
      const items = ITEMS.filter(it => it.family === fam);
      if (!items.length) return;
      h += '<tr><td colspan="4" style="padding:16px 8px 6px;font-size:11px;font-weight:700;letter-spacing:.04em;color:var(--text3)">' + esc(fam) + '</td></tr>';
      items.forEach(it => {
        const v = _draft[it.id];
        h += '<tr style="border-bottom:1px solid var(--border2)">' +
          '<td style="padding:8px;font-weight:600">' + esc(it.label) + '</td>' +
          '<td style="padding:8px;color:var(--text3)">' + esc(it.desc) + '</td>' +
          '<td style="padding:8px">' + _toggleBtn(it.id, 'tech', v.tech) + '</td>' +
          '<td style="padding:8px">' + _toggleBtn(it.id, 'responsable', v.responsable) + '</td>' +
          '</tr>';
      });
    });
    h += '</tbody></table></div>';
    return h;
  }

  function _cardsHtml() {
    const esc = MX.esc;
    let h = '<div style="display:flex;flex-direction:column;gap:10px">';
    FAMILIES.forEach(fam => {
      const items = ITEMS.filter(it => it.family === fam);
      if (!items.length) return;
      h += '<div style="font-size:11px;font-weight:700;letter-spacing:.04em;color:var(--text3);margin-top:10px">' + esc(fam) + '</div>';
      items.forEach(it => {
        const v = _draft[it.id];
        h += '<div style="background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:12px">' +
          '<div style="font-weight:700;margin-bottom:2px">' + esc(it.label) + '</div>' +
          '<div style="font-size:11px;color:var(--text3);margin-bottom:6px">' + esc(it.desc) + '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px solid var(--border2)"><span style="font-size:12px;color:var(--text2)">Technicien</span>' + _toggleBtn(it.id, 'tech', v.tech) + '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px solid var(--border2)"><span style="font-size:12px;color:var(--text2)">Responsable</span>' + _toggleBtn(it.id, 'responsable', v.responsable) + '</div>' +
          '</div>';
      });
    });
    h += '</div>';
    return h;
  }

  // Aperçu = reflète le BROUILLON en cours d'édition (pas encore enregistré)
  // — permet de valider une configuration avant de l'enregistrer. Une
  // famille sans aucun élément visible n'affiche pas son titre (point 8).
  function _previewCard(fam, label, icon) {
    const esc = MX.esc;
    let h = '<div style="background:var(--bg3);border:1px solid var(--border2);border-radius:12px;padding:14px">' +
      '<div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;margin-bottom:10px"><i class="fas ' + icon + '" style="color:var(--cyan)"></i>' + esc(label) + '</div>' +
      '<div style="font-size:12px;display:flex;flex-direction:column;gap:2px;max-height:280px;overflow-y:auto">' +
      '<div style="padding:4px 0;color:var(--text2)"><i class="fas fa-house" style="width:16px;color:var(--text3)"></i> Accueil</div>';
    FAMILIES.forEach(famName => {
      const items = ITEMS.filter(it => it.family === famName && _draft[it.id] && _draft[it.id][fam] !== false);
      if (!items.length) return;
      h += '<div style="font-size:10px;font-weight:700;letter-spacing:.03em;color:var(--text3);margin:8px 0 2px">' + esc(famName) + '</div>';
      items.forEach(it => { h += '<div style="padding:3px 0 3px 4px;color:var(--text2)">' + esc(it.label) + '</div>'; });
    });
    h += '</div></div>';
    return h;
  }

  function _html() {
    const esc = MX.esc;
    const mobile = window.innerWidth < 700;

    let h = '<div class="ph">';
    h += '<div class="ph-eye">Super Admin · configuration de la navigation</div>';
    h += '<div class="ph-row"><div><div class="ph-title"><i class="fas fa-eye" style="margin-right:8px;color:var(--cyan)"></i>Visibilité des modules</div>';
    h += '<div class="ph-sub">Configurez les éléments du menu visibles selon le profil utilisateur.</div></div></div>';
    h += '</div>';

    h += '<div class="page-body">';

    h += '<div style="display:flex;align-items:flex-start;gap:10px;background:var(--cyan-dim);border:1px solid var(--cyan-border);border-radius:10px;padding:12px 14px;margin-bottom:12px;font-size:12px;color:var(--text2)">' +
      '<i class="fas fa-circle-info" style="color:var(--cyan);margin-top:2px;flex-shrink:0"></i>' +
      '<div>Cette configuration gère <strong>uniquement la visibilité des menus</strong>. Les permissions et droits d\'accès existants ne sont pas modifiés.</div>' +
      '</div>';

    h += '<div style="display:flex;align-items:flex-start;gap:10px;background:rgba(249,115,22,.08);border:1px solid var(--orange-border);border-radius:10px;padding:12px 14px;margin-bottom:18px;font-size:12px;color:var(--text2)">' +
      '<i class="fas fa-triangle-exclamation" style="color:var(--orange);margin-top:2px;flex-shrink:0"></i>' +
      '<div>Les modules masqués n\'apparaissent plus dans la navigation (desktop et mobile) pour les profils sélectionnés, mais restent disponibles et leurs données sont conservées.</div>' +
      '</div>';

    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px">' +
      '<button class="cl-quick-btn" style="width:auto" onclick="MX.Pages.NavVisibility._bulkSet(\'tech\',true)"><i class="fas fa-eye"></i> Afficher tout pour les techniciens</button>' +
      '<button class="cl-quick-btn" style="width:auto;color:var(--red)" onclick="MX.Pages.NavVisibility._bulkSet(\'tech\',false)"><i class="fas fa-eye-slash"></i> Masquer tout pour les techniciens</button>' +
      '<button class="cl-quick-btn" style="width:auto" onclick="MX.Pages.NavVisibility._bulkSet(\'responsable\',true)"><i class="fas fa-eye"></i> Afficher tout pour les responsables</button>' +
      '<button class="cl-quick-btn" style="width:auto;color:var(--red)" onclick="MX.Pages.NavVisibility._bulkSet(\'responsable\',false)"><i class="fas fa-eye-slash"></i> Masquer tout pour les responsables</button>' +
      '</div>';

    h += mobile ? _cardsHtml() : _tableHtml();

    h += '<div style="margin-top:26px">';
    h += '<div style="font-size:13px;font-weight:700;margin-bottom:10px"><i class="fas fa-satellite-dish" style="margin-right:6px;color:var(--cyan)"></i>Aperçu en temps réel <span style="font-weight:400;color:var(--text3);font-size:11px">— reflète vos modifications non enregistrées</span></div>';
    h += '<div style="display:grid;grid-template-columns:' + (mobile ? '1fr' : '1fr 1fr') + ';gap:14px">';
    h += _previewCard('tech', 'Vue Technicien', 'fa-user-gear');
    h += _previewCard('responsable', 'Vue Responsable', 'fa-user-tie');
    h += '</div>';
    h += '</div>';

    h += '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:26px;padding-top:16px;border-top:1px solid var(--border2)">' +
      '<button class="primary-btn" style="width:auto" onclick="MX.Pages.NavVisibility._save()"><i class="fas fa-floppy-disk"></i> Enregistrer la configuration</button>' +
      '</div>';

    h += '</div>';
    return h;
  }

  // ── ENTRY POINT ──
  function render() {
    if (!_canAccess()) { MX.showPage('home'); return; }
    _ensureDraft();
    const mc = document.getElementById('main-content');
    if (!mc) return;

    if (!_resizeBound) {
      _resizeBound = true;
      let t = null;
      window.addEventListener('resize', function () {
        clearTimeout(t);
        t = setTimeout(function () { if (MX.state.currentPage === 'nav-visibility') render(); }, 200);
      });
    }

    mc.innerHTML = _html();
  }

  window.MX = window.MX || {};

  // API cœur — utilisée par app.js (buildNav) indépendamment de cet écran.
  window.MX.NavVisibility = { shouldShow, ITEMS, FAMILIES };

  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.NavVisibility = { render, _toggle, _bulkSet, _save };
})();
