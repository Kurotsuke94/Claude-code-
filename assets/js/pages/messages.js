(function () {
  function render() {
    const { state, esc, fmtTime, avatarBg, avatarFg, avatarTxt } = MX;
    const el    = document.getElementById("main-content");
    const names = allNames();

    let h = `
      <div class="ph">
        <div class="ph-eye">COMMUNICATIONS</div>
        <div class="ph-title">Messages</div>
        <div class="ph-sub">Tableau d'affichage équipe</div>
      </div>
      <div class="page-body">
        <div class="page-cols">
          <div>
            <div class="section-label">Nouveau message</div>
            <div class="compose">
              <select class="asel" id="msg-author">
                <option value="">— Votre nom —</option>
                ${names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
              </select>
              <input class="fi" id="msg-title" placeholder="Titre du message…" maxlength="80">
              <textarea class="fi" id="msg-body" placeholder="Votre message…" rows="4"></textarea>
              <button class="primary-btn" onclick="MX.Pages.Messages.send()">
                <i class="fas fa-paper-plane"></i> Envoyer
              </button>
            </div>
          </div>
          <div>
            <div class="section-label">${(state.messages || []).length} message${(state.messages || []).length !== 1 ? 's' : ''}</div>`;

    if (!(state.messages || []).length) {
      h += `<div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:13px">Aucun message pour l'instant</div>`;
    } else {
      (state.messages || []).forEach(m => {
        const bg = avatarBg(m.author), fg = avatarFg(m.author);
        h += `<div class="msg-card">
          <div class="msg-hd">
            <div class="msg-av" style="background:${bg};color:${fg}">${esc(avatarTxt(m.author))}</div>
            <div>
              <div class="msg-author">${esc(m.author)}</div>
              <div class="msg-time">${fmtTime(m.ts)}</div>
            </div>
          </div>
          <div class="msg-ttl">${esc(m.title)}</div>
          <div class="msg-bdy">${esc(m.body)}</div>
          </div>`;
      });
    }

    h += `</div></div></div>`;
    el.innerHTML = h;
  }

  function allNames() {
    const set = new Set();
    ["matin","journee","soir"].forEach(sl => {
      (MX.state.teams[sl] || []).forEach(n => { if (n.trim()) set.add(n.trim()); });
    });
    return Array.from(set).sort();
  }

  async function send() {
    const author = (document.getElementById("msg-author") || {}).value || "";
    const title  = ((document.getElementById("msg-title") || {}).value || "").trim();
    const body   = ((document.getElementById("msg-body")  || {}).value || "").trim();

    if (!author) return MX.toast("Sélectionnez votre nom", true);
    if (!title)  return MX.toast("Ajoutez un titre", true);
    if (!body)   return MX.toast("Écrivez votre message", true);

    const btn = document.querySelector(".compose .primary-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Envoi…"; }

    try {
      await MX.DB.sendMessage({ author, title, body });
      MX.toast("Message envoyé ✓");
    } catch (e) {
      MX.toast("Erreur lors de l'envoi", true);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer'; }
    }
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Messages = { render, send };
})();
