(function () {
  function render() {
    const { state, esc } = MX;
    const el    = document.getElementById("main-content");
    const prods = state.products || [];
    const lows  = prods.filter(p => parseInt(p.qty || 0) < parseInt(p.minQty || 0));
    const names = allNames();

    let h = `
      <div class="ph">
        <div class="ph-eye">STOCK & LOGISTIQUE</div>
        <div class="ph-title">Commandes</div>
        <div class="ph-sub">Gestion des stocks et consommables</div>
      </div>
      <div class="page-body">`;

    // Banner
    if (lows.length) {
      h += `<div class="alert-banner danger">
        <div class="dot red"></div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--red)">${lows.length} produit${lows.length > 1 ? 's' : ''} à commander</div>
          <div style="font-size:11px;color:var(--text2)">${lows.map(p => esc(p.name)).join(", ")}</div>
        </div>
      </div>`;
    } else {
      h += `<div class="alert-banner success">
        <div class="dot green"></div>
        <div style="font-size:13px;font-weight:600;color:var(--green)">Tous les stocks sont OK</div>
      </div>`;
    }

    // Product list
    if (!prods.length) {
      h += `<div style="text-align:center;padding:40px;color:var(--text3);font-size:13px">Aucun produit configuré dans l'admin</div>`;
    }

    prods.forEach(p => {
      const low = parseInt(p.qty || 0) < parseInt(p.minQty || 0);
      h += `<div class="prod-card ${low ? 'low' : 'ok'}">
        <div class="prod-hd">
          <div class="dot ${low ? 'red' : 'green'}"></div>
          <span class="prod-id">${esc(p.id)}</span>
          <span style="font-size:14px;font-weight:600;flex:1">${esc(p.name)}</span>
          <span style="font-size:10px;font-weight:700;color:${low ? 'var(--red)' : 'var(--green)'};">${low ? 'CMD' : 'OK'}</span>
        </div>
        <div class="prod-body">
          <div class="prod-cell">
            <div class="pclbl">Stock</div>
            <input type="number" class="qty-edit" value="${parseInt(p.qty || 0)}"
              style="color:${low ? 'var(--red)' : 'var(--green)'}"
              min="0"
              onchange="MX.Pages.Orders.updateQty('${esc(p.id)}', this.value)">
            <div class="pcctrl">unités</div>
          </div>
          <div class="prod-cell">
            <div class="pclbl">Min requis</div>
            <div class="pcval ${low ? 'r' : 'g'}">${parseInt(p.minQty || 0)}</div>
            <div class="pcctrl">seuil</div>
          </div>
          <div class="prod-cell">
            <div class="pclbl">À commander</div>
            <div class="pcval ${low ? 'r' : 'g'}">${low ? Math.max(0, parseInt(p.minQty || 0) - parseInt(p.qty || 0)) : '—'}</div>
            <div class="pcctrl">unités</div>
          </div>
        </div>
        <div class="prod-who">
          <span style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;font-family:var(--ffm);min-width:80px">Responsable</span>
          <select class="asel" style="flex:1;font-size:13px;padding:7px 10px"
            onchange="MX.Pages.Orders.updateCtrl('${esc(p.id)}', this.value)">
            <option value="">— Choisir —</option>
            ${names.map(n => `<option value="${esc(n)}" ${n === p.controller ? 'selected' : ''}>${esc(n)}</option>`).join('')}
          </select>
          ${p.ref ? `<span style="font-size:10px;font-family:var(--ffm);color:var(--text3)">${esc(p.ref)}</span>` : ''}
        </div>
      </div>`;
    });

    h += `</div>`;
    el.innerHTML = h;
  }

  function allNames() {
    const set = new Set();
    ["matin","journee","soir"].forEach(sl => {
      (MX.state.teams[sl] || []).forEach(n => { if (n.trim()) set.add(n.trim()); });
    });
    return Array.from(set).sort();
  }

  async function updateQty(id, val) {
    const qty = Math.max(0, parseInt(val) || 0);
    const prod = (MX.state.products || []).find(p => p.id === id);
    if (!prod) return;
    prod.qty = qty;
    try {
      await MX.DB.updateProduct(id, { qty });
    } catch (e) {
      MX.toast("Erreur de sauvegarde", true);
    }
  }

  async function updateCtrl(id, val) {
    const prod = (MX.state.products || []).find(p => p.id === id);
    if (!prod) return;
    prod.controller = val;
    try {
      await MX.DB.updateProduct(id, { controller: val });
    } catch (e) {
      MX.toast("Erreur de sauvegarde", true);
    }
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Orders = { render, updateQty, updateCtrl };
})();
