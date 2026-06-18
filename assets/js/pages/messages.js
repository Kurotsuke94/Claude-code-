(function () {
  let _pendingFile = null;

  function render() {
    const { state, esc, fmtTime, avatarBg, avatarFg, avatarTxt } = MX;
    const el    = document.getElementById("main-content");
    const names = allNames();
    const isAdm = MX.Auth.isAdmin();

    // Preserve compose state across re-renders
    const savedAuthor = (document.getElementById("msg-author") || {}).value || "";
    const savedTitle  = ((document.getElementById("msg-title") || {}).value || "");
    const savedBody   = ((document.getElementById("msg-body")  || {}).value || "");

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
                ${names.map(n => {
                  const sel = savedAuthor ? (savedAuthor === n) : (state.currentUser && state.currentUser.name === n);
                  return `<option value="${esc(n)}" ${sel ? 'selected' : ''}>${esc(n)}</option>`;
                }).join('')}
              </select>
              <input class="fi" id="msg-title" placeholder="Titre du message…" maxlength="80" value="${esc(savedTitle)}">
              <textarea class="fi" id="msg-body" placeholder="Votre message…" rows="4">${esc(savedBody)}</textarea>
              <div style="display:flex;gap:8px;align-items:center">
                <button type="button" onclick="document.getElementById('msg-photo-input').click()" style="display:flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid var(--border2);border-radius:8px;background:var(--bg4);color:var(--text1);cursor:pointer;font-size:13px;font-family:var(--ffs);flex-shrink:0">
                  <i class="fas fa-camera"></i> Photo
                </button>
                <span id="msg-photo-name" style="font-size:12px;color:var(--cyan);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1"></span>
                <button id="msg-photo-clear" onclick="MX.Pages.Messages.clearPhoto()" style="display:none;background:none;border:none;color:var(--text3);cursor:pointer;font-size:13px;padding:4px"><i class="fas fa-times"></i></button>
              </div>
              <input type="file" id="msg-photo-input" accept="image/*" style="display:none" onchange="MX.Pages.Messages.previewPhoto(this)">
              <div id="msg-photo-preview" style="display:none;position:relative;border-radius:10px;overflow:hidden;border:1px solid var(--border2)">
                <img id="msg-photo-img" style="width:100%;max-height:220px;object-fit:cover;display:block">
              </div>
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
            <div style="flex:1">
              <div class="msg-author">${esc(m.author)}</div>
              <div class="msg-time">${fmtTime(m.ts)}</div>
            </div>
            ${isAdm ? `<button onclick="MX.Pages.Messages.deleteMsg('${m.id}')" style="background:none;border:none;color:var(--text3);cursor:pointer;padding:4px 8px;font-size:13px;border-radius:6px" title="Supprimer"><i class="fas fa-trash"></i></button>` : ''}
          </div>
          ${m.imageUrl ? `<img class="msg-img" src="${esc(m.imageUrl)}" onclick="MX.Pages.Messages.openImg('${esc(m.imageUrl)}')" loading="lazy" alt="photo">` : ''}
          <div class="msg-ttl">${esc(m.title)}</div>
          ${m.body ? `<div class="msg-bdy">${esc(m.body)}</div>` : ''}
        </div>`;
      });
    }

    h += `</div></div></div>`;
    el.innerHTML = h;

    // Restore pending photo preview after re-render
    if (_pendingFile) _restorePreview();
  }

  function _restorePreview() {
    const preview = document.getElementById("msg-photo-preview");
    const img     = document.getElementById("msg-photo-img");
    const name    = document.getElementById("msg-photo-name");
    const clear   = document.getElementById("msg-photo-clear");
    if (!preview || !img) return;
    img.src = URL.createObjectURL(_pendingFile);
    preview.style.display = "block";
    if (name)  { name.textContent = _pendingFile.name; }
    if (clear) { clear.style.display = "inline-block"; }
  }

  function allNames() {
    const set = new Set();
    // From team slot assignments
    ["matin","journee","soir"].forEach(sl => {
      (MX.state.teams[sl] || []).forEach(n => { if (n && n.trim()) set.add(n.trim()); });
    });
    // From user profiles (admin-created users)
    (MX.state.users || []).forEach(u => { if (u.name && u.name.trim()) set.add(u.name.trim()); });
    return Array.from(set).sort();
  }

  function previewPhoto(input) {
    const file = input.files[0];
    if (!file) return;
    _pendingFile = file;
    _restorePreview();
  }

  function clearPhoto() {
    _pendingFile = null;
    const input   = document.getElementById("msg-photo-input");
    const preview = document.getElementById("msg-photo-preview");
    const name    = document.getElementById("msg-photo-name");
    const clear   = document.getElementById("msg-photo-clear");
    if (input)   input.value = "";
    if (preview) preview.style.display = "none";
    if (name)    name.textContent = "";
    if (clear)   clear.style.display = "none";
  }

  async function _compressImage(file, maxPx) {
    maxPx = maxPx || 1000;
    return new Promise(function(resolve) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function() {
        URL.revokeObjectURL(url);
        var w = img.width, h = img.height;
        if (w <= maxPx && h <= maxPx && file.size < 400000) { resolve(file); return; }
        var scale = Math.min(1, maxPx / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob(function(blob) { resolve(blob || file); }, "image/jpeg", 0.72);
      };
      img.onerror = function() { resolve(file); };
      img.src = url;
    });
  }

  async function send() {
    const author = (document.getElementById("msg-author") || {}).value || "";
    const title  = ((document.getElementById("msg-title") || {}).value || "").trim();
    const body   = ((document.getElementById("msg-body")  || {}).value || "").trim();

    if (!author) return MX.toast("Sélectionnez votre nom", true);
    if (!title)  return MX.toast("Ajoutez un titre", true);
    if (!body && !_pendingFile) return MX.toast("Écrivez un message ou ajoutez une photo", true);

    const btn = document.querySelector(".compose .primary-btn");
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi…'; }

    try {
      let imageUrl = null;
      if (_pendingFile) {
        const compressed = await _compressImage(_pendingFile);
        imageUrl = await MX.DB.uploadMessageImage(compressed);
      }
      await MX.DB.sendMessage({ author, title, body, imageUrl });
      MX.toast("Message envoyé ✓");
      clearPhoto();
      const t = document.getElementById("msg-title"); if (t) t.value = "";
      const b = document.getElementById("msg-body");  if (b) b.value = "";
    } catch (e) {
      console.error(e);
      MX.toast("Erreur lors de l'envoi", true);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer'; }
    }
  }

  function deleteMsg(id) {
    MX.showModal("Supprimer ce message ?", "Cette action est irréversible.", [
      { label: "Supprimer", cls: "danger", fn: async function() {
        try {
          await MX.DB.deleteMessage(id);
          MX.toast("Message supprimé");
        } catch(e) { MX.toast("Erreur suppression", true); }
      }},
      { label: "Annuler", cls: "cancel" }
    ]);
  }

  function openImg(url) {
    window.open(url, "_blank");
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Messages = { render, send, previewPhoto, clearPhoto, deleteMsg, openImg };
})();
