(function () {
  let _imgFile = null;

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
              <div>
                <input type="file" id="msg-img-inp" accept="image/*" style="display:none" onchange="MX.Pages.Messages.previewImg(this)">
                <button class="dash-btn" onclick="document.getElementById('msg-img-inp').click()">
                  <i class="fas fa-image"></i> Joindre une image (optionnel)
                </button>
              </div>
              <div id="msg-img-preview" style="display:none;position:relative;border-radius:var(--rs);overflow:hidden;border:1px solid var(--border2)">
                <img id="msg-img-thumb" style="width:100%;max-height:200px;object-fit:cover;display:block">
                <button onclick="MX.Pages.Messages.clearImg()" style="position:absolute;top:6px;right:6px;width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.7);border:none;color:#fff;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center"><i class="fas fa-times"></i></button>
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
            <div>
              <div class="msg-author">${esc(m.author)}</div>
              <div class="msg-time">${fmtTime(m.ts)}</div>
            </div>
          </div>
          <div class="msg-ttl">${esc(m.title)}</div>
          <div class="msg-bdy">${esc(m.body)}</div>
          ${m.imageUrl ? `<img src="${esc(m.imageUrl)}" class="msg-img" loading="lazy" onclick="MX.Pages.Messages.openImg('${esc(m.imageUrl)}')">` : ''}
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

  function previewImg(input) {
    const file = input.files[0];
    if (!file) return;
    _imgFile = file;
    const reader = new FileReader();
    reader.onload = e => {
      const thumb = document.getElementById("msg-img-thumb");
      const prev  = document.getElementById("msg-img-preview");
      if (thumb) thumb.src = e.target.result;
      if (prev)  prev.style.display = "block";
    };
    reader.readAsDataURL(file);
  }

  function clearImg() {
    _imgFile = null;
    const inp  = document.getElementById("msg-img-inp");
    const thumb = document.getElementById("msg-img-thumb");
    const prev  = document.getElementById("msg-img-preview");
    if (inp)   inp.value = "";
    if (thumb) thumb.src = "";
    if (prev)  prev.style.display = "none";
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
      let imageUrl = "";
      if (_imgFile) {
        const ref  = storage.ref(`messages/${Date.now()}_${_imgFile.name}`);
        const snap = await ref.put(_imgFile);
        imageUrl   = await snap.ref.getDownloadURL();
        _imgFile   = null;
      }
      await MX.DB.sendMessage({ author, title, body, imageUrl });
      MX.toast("Message envoyé ✓");
      // Render will be triggered by Firestore listener
    } catch (e) {
      MX.toast("Erreur lors de l'envoi", true);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer'; }
    }
  }

  function openImg(url) {
    const modal = document.getElementById("img-modal");
    const img   = document.getElementById("img-modal-img");
    if (!modal || !img) return;
    img.src = url;
    modal.classList.add("show");
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Messages = { render, previewImg, clearImg, send, openImg };
})();
