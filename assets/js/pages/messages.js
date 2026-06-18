(function () {
  let _pendingFile = null;

  function render() {
    const { state, esc, fmtTime, avatarBg, avatarFg, avatarTxt } = MX;
    const el    = document.getElementById("main-content");
    const isAdm = MX.Auth.isAdmin();
    const cu    = state.currentUser;
    const author = isAdm ? (state.adminUser.displayName || "Admin") : (cu ? cu.name : null);

    // Preserve compose state across re-renders
    const savedTitle = ((document.getElementById("msg-title") || {}).value || "");
    const savedBody  = ((document.getElementById("msg-body")  || {}).value || "");

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
            <div class="compose">`;

    if (!author) {
      // Not logged in — prompt to connect
      h += `
        <div style="text-align:center;padding:24px 16px;background:var(--bg3);border-radius:12px;border:1px solid var(--border2)">
          <div style="font-size:28px;margin-bottom:10px">💬</div>
          <div style="font-size:14px;font-weight:600;margin-bottom:6px">Connectez-vous pour écrire</div>
          <div style="font-size:12px;color:var(--text2);margin-bottom:16px">Sélectionnez votre profil pour envoyer un message</div>
          <button onclick="MX.Auth.showUserPicker()" class="primary-btn" style="margin:0 auto;width:auto;padding:10px 24px">
            <i class="fas fa-user-circle"></i> Se connecter
          </button>
        </div>`;
    } else {
      // Show who is writing (read-only)
      const bg = isAdm ? "var(--cyan)" : avatarBg(author);
      const fg = isAdm ? "#0C0C0E" : avatarFg(author);
      const initials = author.substring(0,2).toUpperCase();
      const roleLabel = isAdm ? "Administrateur" : (cu.role === "responsable" ? "Responsable" : "Technicien");

      h += `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg3);border-radius:10px;border:1px solid var(--border2);margin-bottom:4px">
          <div style="width:36px;height:36px;border-radius:10px;background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;font-family:var(--ffm);flex-shrink:0">${esc(initials)}</div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">${esc(author)}</div>
            <div style="font-size:11px;color:var(--text2)">${roleLabel}</div>
          </div>
          <span style="font-size:11px;color:var(--cyan)"><i class="fas fa-check-circle"></i></span>
        </div>
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
        </button>`;
    }

    h += `</div>
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

  async function _compressImage(file) {
    const MAX_PX  = 600;
    const QUALITY = 0.65;
    return new Promise(function(resolve) {
      var timer = setTimeout(function() { resolve(file); }, 10000);
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function() {
        URL.revokeObjectURL(url);
        var w = img.width, h = img.height;
        if (w <= MAX_PX && h <= MAX_PX && file.size < 150000) {
          clearTimeout(timer); resolve(file); return;
        }
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

  async function send() {
    const isAdm = MX.Auth.isAdmin();
    const cu    = MX.state.currentUser;
    const author = isAdm ? (MX.state.adminUser.displayName || "Admin") : (cu ? cu.name : null);

    if (!author) return MX.toast("Connectez-vous pour envoyer un message", true);

    const title = ((document.getElementById("msg-title") || {}).value || "").trim();
    const body  = ((document.getElementById("msg-body")  || {}).value || "").trim();

    if (!title) return MX.toast("Ajoutez un titre", true);
    if (!body && !_pendingFile) return MX.toast("Écrivez un message ou ajoutez une photo", true);

    const btn = document.querySelector(".compose .primary-btn");
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi…'; }

    try {
      let imageUrl = null;
      if (_pendingFile) {
        if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Compression…';
        const compressed = await _compressImage(_pendingFile);
        if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Upload 0%';
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
