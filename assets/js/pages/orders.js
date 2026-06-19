(function () {
  let _filter  = 'all';
  let _search  = '';
  let _sel     = new Set();
  let _pdfInc  = { rupture: true, seuil: true, arrivant: true, manual: false };
  let _pdfSupp = '';
  let _pdfNote = '';

  function _qty(p)  { return parseInt(p.qty   || 0, 10); }
  function _min(p)  { return parseInt(p.minQty || 0, 10); }
  function _need(p) { return Math.max(0, _min(p) - _qty(p)); }
  function _status(p) {
    var q = _qty(p), m = _min(p);
    if (q <= 0)              return 'rupture';
    if (q < m)               return 'seuil';
    if (m > 0 && q < m * 2) return 'arrivant';
    return 'ok';
  }
  var SC = {
    rupture:  { label: 'Rupture',          col: 'var(--red)',    dim: 'var(--red-dim)',    brd: 'var(--red-border)' },
    seuil:    { label: 'Sous le seuil',    col: 'var(--orange)', dim: 'var(--orange-dim)', brd: 'var(--orange-border)' },
    arrivant: { label: 'Arrivant rupture', col: '#EAB308',       dim: '#EAB30820',         brd: '#EAB30880' },
    ok:       { label: 'OK',               col: 'var(--green)',  dim: 'var(--green-dim)',  brd: 'var(--green-border)' }
  };

  function _filtered() {
    var prods = (MX.state.products || []);
    var s = _search.trim().toLowerCase();
    return prods.filter(function (p) {
      if (s) {
        var hay = [p.name, p.ref, p.location, p.category].map(function (x) { return (x || '').toLowerCase(); }).join(' ');
        if (hay.indexOf(s) === -1) return false;
      }
      if (_filter === 'all')      return true;
      if (_filter === 'rupture')  return _status(p) === 'rupture';
      if (_filter === 'seuil')    return _status(p) === 'seuil';
      if (_filter === 'arrivant') return _status(p) === 'arrivant';
      if (_filter === 'ordered')  return p.orderStatus === 'ordered' || p.orderStatus === 'delivering';
      if (_filter === 'received') return p.orderStatus === 'received';
      return true;
    });
  }

  function _pdfItems() {
    var prods = (MX.state.products || []);
    var out = [];
    prods.forEach(function (p) {
      var st = _status(p);
      if (_pdfInc.rupture  && st === 'rupture')  { out.push(p); return; }
      if (_pdfInc.seuil    && st === 'seuil')     { out.push(p); return; }
      if (_pdfInc.arrivant && st === 'arrivant')  { out.push(p); return; }
      if (_pdfInc.manual   && _sel.has(p.id))     { out.push(p); return; }
    });
    var seen = new Set();
    return out.filter(function (p) { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  }

  function _countByStatus(st) {
    return (MX.state.products || []).filter(function (p) { return _status(p) === st; }).length;
  }

  function _countOrdered() {
    return (MX.state.products || []).filter(function (p) { return p.orderStatus === 'ordered' || p.orderStatus === 'delivering'; }).length;
  }

  function _countReceived() {
    return (MX.state.products || []).filter(function (p) { return p.orderStatus === 'received'; }).length;
  }

  function _getSuppliers() {
    var seen = new Set();
    var out = [];
    (MX.state.products || []).forEach(function (p) {
      if (p.supplier && !seen.has(p.supplier)) { seen.add(p.supplier); out.push(p.supplier); }
    });
    (MX.state.orders || []).forEach(function (o) {
      if (o.supplier && !seen.has(o.supplier)) { seen.add(o.supplier); out.push(o.supplier); }
    });
    return out;
  }

  function _renderPanel(items) {
    var esc = MX.esc;
    var nR = (MX.state.products || []).filter(function (p) { return _status(p) === 'rupture'; }).length;
    var nS = (MX.state.products || []).filter(function (p) { return _status(p) === 'seuil'; }).length;
    var nA = (MX.state.products || []).filter(function (p) { return _status(p) === 'arrivant'; }).length;
    var nM = _sel.size;
    var suppliers = _getSuppliers();
    var dlId = 'ord-supp-dl-' + Date.now();

    var h = '<div class="ord-panel" style="margin-bottom:14px">';
    h += '<div class="ord-panel-ttl">&#128196; Générer commande fournisseur</div>';
    h += '<div class="ord-panel-body">';
    h += '<div class="ord-panel-lbl">Inclure dans le PDF</div>';

    h += '<div class="ord-panel-chk">';
    h += '<input type="checkbox" id="pdf-inc-rupture"' + (_pdfInc.rupture ? ' checked' : '') + ' onchange="MX.Pages.Orders._setPdfInc(\'rupture\',this.checked)">';
    h += '<label for="pdf-inc-rupture">Rupture</label>';
    h += '<span class="ord-panel-cnt" style="background:var(--red-dim);color:var(--red)">' + nR + '</span>';
    h += '</div>';

    h += '<div class="ord-panel-chk">';
    h += '<input type="checkbox" id="pdf-inc-seuil"' + (_pdfInc.seuil ? ' checked' : '') + ' onchange="MX.Pages.Orders._setPdfInc(\'seuil\',this.checked)">';
    h += '<label for="pdf-inc-seuil">Sous le seuil</label>';
    h += '<span class="ord-panel-cnt" style="background:var(--orange-dim);color:var(--orange)">' + nS + '</span>';
    h += '</div>';

    h += '<div class="ord-panel-chk">';
    h += '<input type="checkbox" id="pdf-inc-arrivant"' + (_pdfInc.arrivant ? ' checked' : '') + ' onchange="MX.Pages.Orders._setPdfInc(\'arrivant\',this.checked)">';
    h += '<label for="pdf-inc-arrivant">Arrivant rupture</label>';
    h += '<span class="ord-panel-cnt" style="background:#EAB30820;color:#EAB308">' + nA + '</span>';
    h += '</div>';

    h += '<div class="ord-panel-chk">';
    h += '<input type="checkbox" id="pdf-inc-manual"' + (_pdfInc.manual ? ' checked' : '') + ' onchange="MX.Pages.Orders._setPdfInc(\'manual\',this.checked)">';
    h += '<label for="pdf-inc-manual">Sélection manuelle</label>';
    h += '<span class="ord-panel-cnt">' + nM + '</span>';
    h += '</div>';

    h += '<div class="ord-panel-lbl" style="margin-top:12px">Fournisseur</div>';
    h += '<input list="' + dlId + '" class="fi ord-fi" placeholder="Nom du fournisseur" value="' + esc(_pdfSupp) + '" oninput="MX.Pages.Orders._setPdfSupp(this.value)">';
    h += '<datalist id="' + dlId + '">';
    suppliers.forEach(function (s) { h += '<option value="' + esc(s) + '">'; });
    h += '</datalist>';

    h += '<div class="ord-panel-lbl" style="margin-top:10px">Commentaire</div>';
    h += '<textarea class="fi ord-fi" rows="3" placeholder="Remarques…" oninput="MX.Pages.Orders._setPdfNote(this.value)" style="resize:vertical">' + esc(_pdfNote) + '</textarea>';

    var disabled = items.length === 0 ? ' disabled' : '';
    h += '<button class="ord-pdf-btn"' + disabled + ' onclick="MX.Pages.Orders._generatePDF()">';
    h += '&#128196; Générer le PDF <span class="ord-pdf-cnt">' + items.length + '</span>';
    h += '</button>';
    h += '</div></div>';
    return h;
  }

  function _histStatusStyle(st) {
    if (st === 'pending')   return 'background:#EAB30820;color:#EAB308;border:1px solid #EAB30880';
    if (st === 'ordered')   return 'background:rgba(59,130,246,0.15);color:#3B82F6;border:1px solid rgba(59,130,246,0.4)';
    if (st === 'delivering') return 'background:var(--orange-dim);color:var(--orange);border:1px solid var(--orange-border)';
    if (st === 'received')  return 'background:var(--green-dim);color:var(--green);border:1px solid var(--green-border)';
    return 'background:var(--bg4);color:var(--text2);border:1px solid var(--border)';
  }

  function _histStatusLabel(st) {
    if (st === 'pending')   return 'En attente';
    if (st === 'ordered')   return 'Commandée';
    if (st === 'delivering') return 'En livraison';
    if (st === 'received')  return 'Reçue';
    return st || '—';
  }

  function _fmtDate(ts) {
    if (!ts) return '—';
    var d;
    if (ts && ts.toDate) d = ts.toDate();
    else if (ts && ts.seconds) d = new Date(ts.seconds * 1000);
    else d = new Date(ts);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  function _renderHistory(orders) {
    var esc = MX.esc;
    var h = '<div class="ord-panel">';
    h += '<div class="ord-panel-ttl">&#128203; Historique des commandes</div>';
    if (!orders || orders.length === 0) {
      h += '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Aucune commande</div>';
      h += '</div>';
      return h;
    }
    var shown = orders.slice(0, 5);
    h += '<div class="ord-hist-list">';
    shown.forEach(function (o) {
      h += '<div class="ord-hist-row">';
      h += '<span class="ord-hist-num">' + esc(o.number || '—') + '</span>';
      h += '<span class="ord-hist-dt">' + _fmtDate(o.createdAt) + '</span>';
      h += '<span class="ord-hist-user">' + esc(o.user || '—') + '</span>';
      h += '<span class="ord-hist-badge" style="' + _histStatusStyle(o.status) + '">' + _histStatusLabel(o.status) + '</span>';
      h += '<button class="ord-hist-upd" title="Changer le statut" onclick="MX.Pages.Orders._cycleOrderStatus(\'' + esc(o.id) + '\',\'' + esc(o.status) + '\')">&#8635;</button>';
      h += '</div>';
    });
    h += '</div>';
    if (orders.length > 5) {
      h += '<div style="padding:0 12px 12px">';
      h += '<button class="ord-hist-more" onclick="MX.Pages.Orders._showAllHistory()">Voir tout l\'historique (' + orders.length + ')</button>';
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function render() {
    var esc = MX.esc;
    var canEdit = MX.Auth && MX.Auth.isAdmin ? MX.Auth.isAdmin() : true;
    var el = document.getElementById('main-content');
    if (!el) return;

    var prods   = MX.state.products || [];
    var orders  = MX.state.orders   || [];
    var vis     = _filtered();
    var pdfList = _pdfItems();

    var nRupture  = _countByStatus('rupture');
    var nSeuil    = _countByStatus('seuil');
    var nArrivant = _countByStatus('arrivant');
    var nOrdered  = _countOrdered();
    var nReceived = _countReceived();

    var h = '<div class="ord-page">';
    h += '<div class="ord-main">';

    // Header
    h += '<div class="ord-hdr">';
    h += '<div>';
    h += '<div class="pg-eye">STOCK &amp; LOGISTIQUE</div>';
    h += '<div class="pg-title">Gestion des stocks et commandes</div>';
    h += '<div class="pg-sub">Suivi des stocks, seuils et bons de commande</div>';
    h += '</div>';
    h += '<div class="ord-hdr-btns">';
    h += '<button class="ord-btn-ghost" onclick="MX.Pages.Orders._export()">&#8659; Exporter CSV</button>';
    if (canEdit) {
      h += '<button class="primary-btn" onclick="MX.Pages.Orders._openProdModal(null)">+ Nouveau produit</button>';
    }
    h += '</div>';
    h += '</div>';

    // Alert banner
    if (nRupture > 0) {
      var ruptureProds = prods.filter(function (p) { return _status(p) === 'rupture'; });
      var names = ruptureProds.slice(0, 4).map(function (p) { return esc(p.name); });
      if (ruptureProds.length > 4) names.push('...');
      h += '<div class="ord-alert">';
      h += '<div class="ord-alert-ico">&#9888;</div>';
      h += '<div class="ord-alert-body">';
      h += '<div class="ord-alert-ttl">' + nRupture + ' produit' + (nRupture > 1 ? 's' : '') + ' en rupture à commander</div>';
      h += '<div class="ord-alert-sub">' + names.join(', ') + '</div>';
      h += '</div>';
      h += '<button class="ord-alert-btn" onclick="MX.Pages.Orders._setFilter(\'rupture\')">Voir la liste</button>';
      h += '</div>';
    }

    // KPI cards
    h += '<div class="ord-kpis">';
    h += '<div class="ord-kpi"><div class="ord-kpi-ico" style="background:rgba(0,245,212,0.12);color:var(--cyan)">&#128230;</div><div><div class="ord-kpi-val" style="color:var(--cyan)">' + prods.length + '</div><div class="ord-kpi-lbl">Articles en stock</div><div class="ord-kpi-sub">produits total</div></div></div>';
    h += '<div class="ord-kpi"><div class="ord-kpi-ico" style="background:var(--orange-dim);color:var(--orange)">&#9888;</div><div><div class="ord-kpi-val" style="color:var(--orange)">' + nSeuil + '</div><div class="ord-kpi-lbl">Sous le seuil</div><div class="ord-kpi-sub">stock insuffisant</div></div></div>';
    h += '<div class="ord-kpi ord-kpi-click" onclick="MX.Pages.Orders._setFilter(\'rupture\')"><div class="ord-kpi-ico" style="background:var(--red-dim);color:var(--red)">&#128683;</div><div><div class="ord-kpi-val" style="color:var(--red)">' + nRupture + '</div><div class="ord-kpi-lbl">En rupture</div><div class="ord-kpi-sub">stock à zéro</div></div></div>';
    h += '<div class="ord-kpi ord-kpi-click" onclick="MX.Pages.Orders._setFilter(\'arrivant\')"><div class="ord-kpi-ico" style="background:#EAB30820;color:#EAB308">&#9203;</div><div><div class="ord-kpi-val" style="color:#EAB308">' + nArrivant + '</div><div class="ord-kpi-lbl">Arrivant en rupture</div><div class="ord-kpi-sub">presque à court</div></div></div>';
    h += '<div class="ord-kpi"><div class="ord-kpi-ico" style="background:rgba(168,85,247,0.12);color:#A855F7">&#128196;</div><div><div class="ord-kpi-val" style="color:#A855F7">' + pdfList.length + '</div><div class="ord-kpi-lbl">PDF commandes</div><div class="ord-kpi-sub">produits sélectionnés</div></div></div>';
    h += '</div>';

    // Toolbar
    h += '<div class="ord-toolbar">';
    h += '<div class="ord-filters">';

    function fb(key, label, cnt) {
      var on = _filter === key ? ' ord-fb-on' : '';
      var cntHtml = cnt > 0 ? '<span class="ord-fb-cnt ord-fb-cnt-v">' + cnt + '</span>' : '';
      return '<button class="ord-fb' + on + '" onclick="MX.Pages.Orders._setFilter(\'' + key + '\')">' + label + cntHtml + '</button>';
    }
    h += fb('all',      'Tous',                prods.length);
    h += fb('rupture',  'En rupture',          nRupture);
    h += fb('seuil',    'Sous le seuil',       nSeuil);
    h += fb('arrivant', 'Arrivant en rupture', nArrivant);
    h += fb('ordered',  'En commande',         nOrdered);
    h += fb('received', 'Réceptionnés',      nReceived);
    h += '</div>';

    h += '<div class="ord-search-wrap">';
    h += '<span class="ord-search-ico">&#128269;</span>';
    h += '<input class="ord-search" type="text" placeholder="Rechercher…" value="' + esc(_search) + '" oninput="MX.Pages.Orders._onSearch(this.value)">';
    h += '</div>';
    h += '</div>';

    // Table
    h += '<div class="ord-table-wrap">';
    h += '<table class="ord-table">';
    h += '<thead><tr>';
    h += '<th class="ord-th ord-th-check"><input type="checkbox" class="ord-chk" onchange="MX.Pages.Orders._selAllVis(this.checked)"></th>';
    h += '<th class="ord-th">Produit</th>';
    h += '<th class="ord-th">Référence</th>';
    h += '<th class="ord-th">Catégorie</th>';
    h += '<th class="ord-th">Emplacement</th>';
    h += '<th class="ord-th ord-th-num">Stock</th>';
    h += '<th class="ord-th ord-th-num">Seuil</th>';
    h += '<th class="ord-th ord-th-num">À commander</th>';
    h += '<th class="ord-th">Statut</th>';
    if (canEdit) h += '<th class="ord-th" style="text-align:right">Actions</th>';
    h += '</tr></thead>';
    h += '<tbody>';

    if (vis.length === 0) {
      var cols = canEdit ? 10 : 9;
      h += '<tr><td colspan="' + cols + '"><div class="ord-empty"><span style="font-size:28px">&#128230;</span><span>Aucun produit trouvé</span></div></td></tr>';
    } else {
      vis.forEach(function (p) {
        var st  = _status(p);
        var sc  = SC[st];
        var qty = _qty(p);
        var min = _min(p);
        var need = _need(p);
        var sel = _sel.has(p.id);
        var qtyColor = st === 'rupture' ? 'color:var(--red);font-weight:700' : st === 'seuil' ? 'color:var(--orange);font-weight:700' : 'color:var(--text1)';

        h += '<tr class="ord-tr' + (sel ? ' ord-tr-sel' : '') + '">';
        h += '<td class="ord-td ord-td-check"><input type="checkbox" class="ord-chk"' + (sel ? ' checked' : '') + ' onchange="MX.Pages.Orders._toggleSel(\'' + esc(p.id) + '\',this.checked)"></td>';
        h += '<td class="ord-td"><div class="ord-prod-name">' + esc(p.name || '—') + '</div></td>';
        h += '<td class="ord-td ord-td-ref">' + (p.ref ? esc(p.ref) : '<span class="ord-na">—</span>') + '</td>';
        h += '<td class="ord-td">' + (p.category ? '<span style="font-size:12px;color:var(--text2)">' + esc(p.category) + '</span>' : '<span class="ord-na">—</span>') + '</td>';
        h += '<td class="ord-td">' + (p.location ? '<span class="ord-loc">' + esc(p.location) + '</span>' : '<span class="ord-na">—</span>') + '</td>';
        h += '<td class="ord-td ord-td-num" style="' + qtyColor + '">' + qty + '</td>';
        h += '<td class="ord-td ord-td-num" style="color:var(--text2)">' + min + '</td>';
        h += '<td class="ord-td ord-td-num">' + (need > 0 ? '<span style="color:var(--red);font-weight:700">' + need + '</span>' : '<span class="ord-na">—</span>') + '</td>';
        h += '<td class="ord-td"><span class="ord-badge" style="color:' + sc.col + ';background:' + sc.dim + ';border-color:' + sc.brd + '">' + sc.label + '</span></td>';
        if (canEdit) {
          h += '<td class="ord-td ord-td-act">';
          h += '<button class="ord-act-btn" title="Modifier" onclick="MX.Pages.Orders._openProdModal(\'' + esc(p.id) + '\')">&#9998;</button>';
          h += '<button class="ord-act-btn" title="Actions" onclick="MX.Pages.Orders._prodMenu(event,\'' + esc(p.id) + '\')">&#8942;</button>';
          h += '</td>';
        }
        h += '</tr>';
      });
    }

    h += '</tbody></table></div>';
    h += '</div>'; // ord-main

    // Side panel
    h += '<div class="ord-side">';
    h += _renderPanel(pdfList);
    h += _renderHistory(orders);
    h += '</div>';

    h += '</div>'; // ord-page

    el.innerHTML = h;
  }

  function _setFilter(f) {
    _filter = f;
    render();
  }

  function _onSearch(v) {
    _search = v;
    render();
  }

  function _selAllVis(on) {
    var vis = _filtered();
    vis.forEach(function (p) {
      if (on) _sel.add(p.id);
      else _sel.delete(p.id);
    });
    render();
  }

  function _toggleSel(id, on) {
    if (on) _sel.add(id);
    else _sel.delete(id);
    render();
  }

  function _setPdfInc(k, v) {
    _pdfInc[k] = !!v;
    render();
  }

  function _setPdfSupp(v) {
    _pdfSupp = v;
  }

  function _setPdfNote(v) {
    _pdfNote = v;
  }

  function _generatePDF() {
    var items = _pdfItems();
    if (!items.length) return;
    var orders = MX.state.orders || [];
    var cmdNum = 'CMD-' + String(orders.length + 1).padStart(3, '0');
    var user = (MX.state.user && (MX.state.user.displayName || MX.state.user.email)) || 'Utilisateur';
    var now = new Date();
    var dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    var timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    var supplier = _pdfSupp || '—';
    var comment  = _pdfNote || '';

    var rows = '';
    var total = 0;
    items.forEach(function (p) {
      var need = _need(p);
      total += need;
      rows += '<tr>';
      rows += '<td>' + (p.ref || '—') + '</td>';
      rows += '<td><strong>' + (p.name || '—') + '</strong></td>';
      rows += '<td>' + (p.location || '—') + '</td>';
      rows += '<td style="text-align:center">' + _qty(p) + '</td>';
      rows += '<td style="text-align:center">' + _min(p) + '</td>';
      rows += '<td style="text-align:center;color:#DC2626;font-weight:700">' + need + '</td>';
      rows += '</tr>';
    });

    var html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>' + cmdNum + '</title><style>';
    html += 'body{font-family:Arial,sans-serif;font-size:13px;color:#111;margin:0;padding:32px;background:#fff}';
    html += '.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}';
    html += '.logo{font-size:24px;font-weight:900;color:#00B8A0;letter-spacing:-0.5px}';
    html += '.logo span{color:#111}';
    html += '.cmd-title{text-align:right}';
    html += '.cmd-title h1{font-size:20px;font-weight:900;margin:0 0 4px;text-transform:uppercase;letter-spacing:2px}';
    html += '.cmd-title p{margin:2px 0;font-size:12px;color:#666}';
    html += '.meta{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px;padding:16px;background:#f8f8f8;border-radius:8px;border:1px solid #e5e7eb}';
    html += '.meta-item label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#999;display:block;margin-bottom:3px}';
    html += '.meta-item span{font-size:13px;font-weight:600;color:#111}';
    html += 'table{width:100%;border-collapse:collapse;margin-bottom:20px}';
    html += 'th{background:#111;color:#fff;padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.06em}';
    html += 'td{padding:9px 12px;border-bottom:1px solid #f0f0f0;font-size:12px}';
    html += 'tr:nth-child(even) td{background:#fafafa}';
    html += '.total-row td{background:#f0fdf4!important;font-weight:700;color:#15803d;border-top:2px solid #22c55e}';
    html += '.comment-box{margin-top:20px;padding:14px;border:1px solid #e5e7eb;border-radius:8px;background:#fffbeb}';
    html += '.comment-box strong{display:block;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#92400e;margin-bottom:6px}';
    html += '.footer{margin-top:40px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#999;display:flex;justify-content:space-between}';
    html += '@media print{body{padding:16px}.footer{position:fixed;bottom:16px;left:16px;right:16px}}';
    html += '</style></head><body>';
    html += '<div class="header">';
    html += '<div class="logo">MAIN<span>TIX</span></div>';
    html += '<div class="cmd-title"><h1>Bon de commande</h1><p>' + cmdNum + '</p><p>' + dateStr + '</p></div>';
    html += '</div>';
    html += '<div class="meta">';
    html += '<div class="meta-item"><label>Numéro</label><span>' + cmdNum + '</span></div>';
    html += '<div class="meta-item"><label>Date</label><span>' + dateStr + '</span></div>';
    html += '<div class="meta-item"><label>Créé par</label><span>' + user + '</span></div>';
    html += '<div class="meta-item"><label>Fournisseur</label><span>' + supplier + '</span></div>';
    html += '</div>';
    html += '<table>';
    html += '<thead><tr><th>Référence</th><th>Désignation</th><th>Emplacement</th><th style="text-align:center">Stock actuel</th><th style="text-align:center">Seuil</th><th style="text-align:center">Qté à commander</th></tr></thead>';
    html += '<tbody>' + rows + '</tbody>';
    html += '<tfoot><tr class="total-row"><td colspan="5"><strong>Total à commander</strong></td><td style="text-align:center"><strong>' + total + '</strong></td></tr></tfoot>';
    html += '</table>';
    if (comment) {
      html += '<div class="comment-box"><strong>Commentaire</strong>' + comment + '</div>';
    }
    html += '<div class="footer"><span>Généré par Maintix</span><span>' + dateStr + ' à ' + timeStr + '</span></div>';
    html += '</body></html>';

    var win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(function () { win.print(); }, 400);
    }

    var orderData = {
      number: cmdNum,
      user: user,
      supplier: _pdfSupp || '',
      comment: _pdfNote || '',
      status: 'pending',
      createdAt: new Date(),
      items: items.map(function (p) {
        return { id: p.id, name: p.name, ref: p.ref || '', location: p.location || '', qty: _qty(p), minQty: _min(p), need: _need(p) };
      })
    };
    if (MX.DB && MX.DB.addOrder) {
      MX.DB.addOrder(orderData).catch(function (e) { console.error('addOrder error', e); });
    }
    if (MX.toast) MX.toast(cmdNum + ' généré ✓');
  }

  var _CATEGORIES = ['Éclairage', 'Électrique', 'Mécanique', 'Filtration', 'Lubrifiants', 'Plomberie', 'Consommables', 'Autre'];

  function _openProdModal(id) {
    var esc = MX.esc;
    var prods = MX.state.products || [];
    var p = id ? prods.find(function (x) { return x.id === id; }) : null;
    var catDlId = 'prod-cat-dl';
    var suppDlId = 'prod-supp-dl';
    var suppliers = _getSuppliers();

    var title = p ? 'Modifier le produit' : 'Nouveau produit';
    var sub   = p ? ('Réf. ' + (p.ref || '—')) : 'Ajouter un produit au stock';

    var fields = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';

    fields += '<div style="grid-column:1/-1"><label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Désignation</label>';
    fields += '<input id="prod-name" class="fi" type="text" placeholder="Nom du produit" value="' + esc(p ? p.name || '' : '') + '"></div>';

    fields += '<div><label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Référence</label>';
    fields += '<input id="prod-ref" class="fi" type="text" placeholder="Référence" value="' + esc(p ? p.ref || '' : '') + '"></div>';

    fields += '<div><label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Catégorie</label>';
    fields += '<input id="prod-cat" class="fi" type="text" placeholder="Catégorie" list="' + catDlId + '" value="' + esc(p ? p.category || '' : '') + '">';
    fields += '<datalist id="' + catDlId + '">' + _CATEGORIES.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></div>';

    fields += '<div><label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Emplacement</label>';
    fields += '<input id="prod-loc" class="fi" type="text" placeholder="Ex: Armoire A3, Hall B" value="' + esc(p ? p.location || '' : '') + '"></div>';

    fields += '<div><label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Stock actuel</label>';
    fields += '<input id="prod-qty" class="fi" type="number" min="0" placeholder="0" value="' + (p ? _qty(p) : '') + '"></div>';

    fields += '<div><label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Seuil minimum</label>';
    fields += '<input id="prod-minqty" class="fi" type="number" min="0" placeholder="0" value="' + (p ? _min(p) : '') + '"></div>';

    fields += '<div style="grid-column:1/-1"><label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Fournisseur</label>';
    fields += '<input id="prod-supplier" class="fi" type="text" placeholder="Fournisseur" list="' + suppDlId + '" value="' + esc(p ? p.supplier || '' : '') + '">';
    fields += '<datalist id="' + suppDlId + '">' + suppliers.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist></div>';

    fields += '</div>';

    var actions = '';
    if (p) {
      actions += '<button class="modal-btn danger" onclick="MX.Pages.Orders._delProd(\'' + esc(id) + '\')">Supprimer</button>';
    }
    actions += '<button class="modal-btn cancel" onclick="MX.closeModal()">Annuler</button>';
    actions += '<button class="modal-btn confirm" onclick="MX.Pages.Orders._saveProd(' + (id ? '\'' + esc(id) + '\'' : 'null') + ')">' + (p ? 'Enregistrer' : 'Ajouter') + '</button>';

    MX.showModal({ title: title, sub: sub, body: fields, actions: actions });
  }

  function _saveProd(id) {
    var name    = (document.getElementById('prod-name')     || {}).value || '';
    var ref     = (document.getElementById('prod-ref')      || {}).value || '';
    var cat     = (document.getElementById('prod-cat')      || {}).value || '';
    var loc     = (document.getElementById('prod-loc')      || {}).value || '';
    var qty     = parseInt((document.getElementById('prod-qty')    || {}).value || '0', 10);
    var minQty  = parseInt((document.getElementById('prod-minqty') || {}).value || '0', 10);
    var supplier = (document.getElementById('prod-supplier') || {}).value || '';

    if (!name.trim()) {
      if (MX.toast) MX.toast('Le nom est obligatoire', 'error');
      return;
    }
    var data = { name: name.trim(), ref: ref.trim(), category: cat.trim(), location: loc.trim(), qty: qty, minQty: minQty, supplier: supplier.trim() };
    if (id) {
      MX.DB.updateProduct(id, data).then(function () {
        MX.closeModal();
        if (MX.toast) MX.toast('Produit mis à jour ✓');
        render();
      }).catch(function (e) {
        if (MX.toast) MX.toast('Erreur: ' + e.message, 'error');
      });
    } else {
      MX.DB.addProduct(data).then(function () {
        MX.closeModal();
        if (MX.toast) MX.toast('Produit ajouté ✓');
        render();
      }).catch(function (e) {
        if (MX.toast) MX.toast('Erreur: ' + e.message, 'error');
      });
    }
  }

  function _delProd(id) {
    var prods = MX.state.products || [];
    var p = prods.find(function (x) { return x.id === id; });
    var name = p ? p.name : id;
    if (!confirm('Supprimer "' + name + '" ? Cette action est irréversible.')) return;
    MX.DB.deleteProduct(id).then(function () {
      MX.closeModal();
      _sel.delete(id);
      if (MX.toast) MX.toast('Produit supprimé');
      render();
    }).catch(function (e) {
      if (MX.toast) MX.toast('Erreur: ' + e.message, 'error');
    });
  }

  function _prodMenu(e, id) {
    e.stopPropagation();
    var esc = MX.esc;
    var prods = MX.state.products || [];
    var p = prods.find(function (x) { return x.id === id; });
    if (!p) return;
    var name = p.name || id;

    var body = '<div style="display:flex;flex-direction:column;gap:8px">';
    body += '<button class="modal-btn confirm" onclick="MX.closeModal();MX.Pages.Orders._openProdModal(\'' + esc(id) + '\')">&#9998; Modifier</button>';
    body += '<button class="modal-btn cancel" onclick="MX.closeModal();MX.Pages.Orders._setOrderStatus(\'' + esc(id) + '\',\'ordered\')">&#128230; Marquer commandée</button>';
    body += '<button class="modal-btn cancel" onclick="MX.closeModal();MX.Pages.Orders._setOrderStatus(\'' + esc(id) + '\',\'delivering\')">&#128666; En livraison</button>';
    body += '<button class="modal-btn cancel" onclick="MX.closeModal();MX.Pages.Orders._setOrderStatus(\'' + esc(id) + '\',\'received\')">&#9989; Réceptionné</button>';
    body += '<button class="modal-btn cancel" onclick="MX.closeModal();MX.Pages.Orders._setOrderStatus(\'' + esc(id) + '\',\'\')">&#8635; Réinitialiser</button>';
    body += '</div>';

    MX.showModal({ title: 'Actions — ' + esc(name), sub: '', body: body, actions: '' });
  }

  function _setOrderStatus(id, status) {
    if (MX.DB && MX.DB.updateProduct) {
      MX.DB.updateProduct(id, { orderStatus: status }).then(function () {
        if (MX.toast) MX.toast('Statut mis à jour ✓');
        render();
      }).catch(function (e) {
        if (MX.toast) MX.toast('Erreur: ' + e.message, 'error');
      });
    }
  }

  function _cycleOrderStatus(id, current) {
    var cycle = ['pending', 'ordered', 'delivering', 'received'];
    var idx   = cycle.indexOf(current);
    var next  = cycle[(idx + 1) % cycle.length];
    if (MX.DB && MX.DB.updateOrderStatus) {
      MX.DB.updateOrderStatus(id, next).then(function () {
        if (MX.toast) MX.toast('Statut: ' + _histStatusLabel(next));
        render();
      }).catch(function (e) {
        if (MX.toast) MX.toast('Erreur: ' + e.message, 'error');
      });
    }
  }

  function _showAllHistory() {
    var esc = MX.esc;
    var orders = MX.state.orders || [];
    if (!orders.length) {
      MX.showModal({ title: 'Historique', sub: '', body: '<p style="color:var(--text3);font-size:13px">Aucune commande enregistrée.</p>', actions: '<button class="modal-btn cancel" onclick="MX.closeModal()">Fermer</button>' });
      return;
    }
    var body = '<div style="display:flex;flex-direction:column;gap:6px;max-height:400px;overflow-y:auto">';
    orders.forEach(function (o) {
      body += '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:8px">';
      body += '<span style="font-size:12px;font-weight:700;font-family:var(--ffm);color:var(--text1);flex-shrink:0">' + esc(o.number || '—') + '</span>';
      body += '<span style="font-size:10px;color:var(--text3);flex-shrink:0">' + _fmtDate(o.createdAt) + '</span>';
      body += '<span style="font-size:11px;color:var(--text2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(o.user || '—') + '</span>';
      body += '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;white-space:nowrap;' + _histStatusStyle(o.status) + '">' + _histStatusLabel(o.status) + '</span>';
      body += '<button class="ord-hist-upd" onclick="MX.Pages.Orders._cycleOrderStatus(\'' + esc(o.id) + '\',\'' + esc(o.status) + '\')">&#8635;</button>';
      body += '</div>';
    });
    body += '</div>';
    MX.showModal({ title: 'Historique des commandes', sub: orders.length + ' commande' + (orders.length > 1 ? 's' : ''), body: body, actions: '<button class="modal-btn cancel" onclick="MX.closeModal()">Fermer</button>' });
  }

  function _export() {
    var prods = MX.state.products || [];
    var rows  = [['ID', 'Nom', 'Référence', 'Catégorie', 'Emplacement', 'Stock', 'Seuil', 'À commander', 'Statut', 'Fournisseur', 'Statut commande']];
    prods.forEach(function (p) {
      rows.push([
        p.id || '',
        p.name || '',
        p.ref || '',
        p.category || '',
        p.location || '',
        _qty(p),
        _min(p),
        _need(p),
        SC[_status(p)].label,
        p.supplier || '',
        p.orderStatus || ''
      ]);
    });
    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href   = url;
    a.download = 'stock-commandes-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    if (MX.toast) MX.toast('Export CSV téléchargé ✓');
  }

  function updateQty(id, val) {
    var qty = parseInt(val, 10);
    if (isNaN(qty)) return;
    if (MX.DB && MX.DB.updateProduct) {
      MX.DB.updateProduct(id, { qty: qty }).catch(function (e) { console.error(e); });
    }
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Orders = {
    render: render,
    updateQty: updateQty,
    _setFilter: _setFilter,
    _onSearch: _onSearch,
    _setPdfSupp: _setPdfSupp,
    _setPdfNote: _setPdfNote,
    _setPdfInc: _setPdfInc,
    _toggleSel: _toggleSel,
    _selAllVis: _selAllVis,
    _openProdModal: _openProdModal,
    _saveProd: _saveProd,
    _delProd: _delProd,
    _prodMenu: _prodMenu,
    _generatePDF: _generatePDF,
    _cycleOrderStatus: _cycleOrderStatus,
    _showAllHistory: _showAllHistory,
    _export: _export
  };
})();
