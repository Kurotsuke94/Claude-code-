(function () {
  const { DAYS, DEFT, mkWeekLabel, uuid } = window.MX;

  // ── FIRESTORE ERROR HANDLER ──
  function _fsError(coll) {
    return function (err) {
      const code = err.code || '';
      const link = (err.message || '').match(/https:\/\/\S+/)?.[0] || '';
      if (code === 'failed-precondition') {
        console.warn(
          '────────────────────────\n⚠ Firestore\n\n' +
          'Collection : ' + coll + '\n\nIndex manquant.\n' +
          (link ? 'Lien Firebase :\n' + link + '\n' : '') +
          '────────────────────────'
        );
      } else if (code === 'permission-denied') {
        console.warn('[Firestore] ' + coll + ' — permission refusée :', err.message);
      } else if (code === 'unavailable') {
        console.warn('[Firestore] ' + coll + ' — service indisponible.');
      } else {
        console.error('[Firestore] ' + coll + ' — erreur listener :', err);
      }
    };
  }

  // ── FIRESTORE REFS ──
  const R = {
    week:        () => db.collection("config").doc("week"),
    teams:       () => db.collection("config").doc("teams"),
    alerts:      () => db.collection("config").doc("alerts"),
    assignments: () => db.collection("config").doc("assignments"),
    checks:      () => db.collection("config").doc("checks"),
    tasks:  (key) => db.collection("tasks").doc(key),
    products:    () => db.collection("products"),
    messages:    () => db.collection("messages"),
    users:       () => db.collection("users"),
    logs:        () => db.collection("logs"),
    transfers:   () => db.collection("transfers"),
    missions:    () => db.collection("missions"),
    resp_tasks:  () => db.collection("resp_tasks"),
    fcmTokens:   () => db.collection("fcmTokens")
  };

  // ── LISTENERS (unsubscribe handles) ──
  const _unsub = {};

  function unsubAll() {
    Object.values(_unsub).forEach(fn => fn && fn());
  }

  // ── INITIAL SETUP (first run) ──
  async function initDefaults() {
    const weekDoc = await R.week().get();
    if (!weekDoc.exists) {
      const batch = db.batch();
      batch.set(R.week(), { label: mkWeekLabel(), num: 1 });
      batch.set(R.teams(), { matin: ["Jordan"], journee: ["Bryan"], soir: ["Dorian"] });
      batch.set(R.alerts(), {
        matin:   { email: "", deadline: "10:00", active: false, svc: "", tpl: "", key: "" },
        journee: { email: "", deadline: "16:00", active: false, svc: "", tpl: "", key: "" },
        soir:    { email: "", deadline: "22:00", active: false, svc: "", tpl: "", key: "" }
      });
      batch.set(R.assignments(), {});
      batch.set(R.checks(), {});
      await batch.commit();

      const taskBatch = db.batch();
      DAYS.forEach(day => {
        const slots = day.we ? ["soir"] : ["matin", "journee", "soir"];
        slots.forEach(sl => {
          const items = DEFT[sl].map((text, i) => ({ id: uuid(), text, order: i }));
          taskBatch.set(R.tasks(`${day.id}_${sl}`), { items });
        });
      });

      const prods = [
        { name: "Ampoule E27",   ref: "REF-AMP-E27",  qty: 8,  minQty: 10, controller: "" },
        { name: "Gants latex M", ref: "REF-GANT-M",   qty: 25, minQty: 10, controller: "" },
        { name: "Papier A4",     ref: "REF-PAP-A4",   qty: 3,  minQty: 5,  controller: "" },
        { name: "Désinfectant",  ref: "REF-DES-1L",   qty: 7,  minQty: 4,  controller: "" }
      ];
      prods.forEach(p => { taskBatch.set(R.products().doc(), p); });

      taskBatch.set(R.messages().doc(), {
        author: "Admin",
        title:  "Bienvenue sur Maintix",
        body:   "Plateforme de gestion et maintenance. Consultez les onglets pour vos checklists.",
        ts: firebase.firestore.FieldValue.serverTimestamp()
      });

      await taskBatch.commit();
    }
  }

  // ── REAL-TIME LISTENERS ──
  function listenWeek(cb) {
    _unsub.week = R.week().onSnapshot(snap => { if (snap.exists) cb(snap.data()); });
  }
  function listenTeams(cb) {
    _unsub.teams = R.teams().onSnapshot(snap => { if (snap.exists) cb(snap.data()); });
  }
  function listenAlerts(cb) {
    _unsub.alerts = R.alerts().onSnapshot(snap => { if (snap.exists) cb(snap.data()); });
  }
  function listenAssignments(cb) {
    _unsub.assignments = R.assignments().onSnapshot(snap => { if (snap.exists) cb(snap.data()); });
  }
  function listenChecks(cb) {
    _unsub.checks = R.checks().onSnapshot(snap => { cb(snap.exists ? snap.data() : {}); });
  }
  function listenTasks(dayId, slot, cb) {
    const key = `${dayId}_${slot}`;
    if (_unsub["tasks_" + key]) _unsub["tasks_" + key]();
    _unsub["tasks_" + key] = R.tasks(key).onSnapshot(snap => {
      cb(snap.exists ? (snap.data().items || []) : []);
    });
  }
  function listenAllTasks(cb) {
    DAYS.forEach(day => {
      const slots = day.we ? ["soir"] : ["matin", "journee", "soir"];
      slots.forEach(sl => { listenTasks(day.id, sl, items => cb(day.id, sl, items)); });
    });
  }
  function listenProducts(cb) {
    _unsub.products = R.products().onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  function listenMessages(cb) {
    _unsub.messages = R.messages().orderBy("ts", "desc").limit(50).onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  function listenUsers(cb) {
    _unsub.users = R.users().onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  function listenLogs(cb) {
    _unsub.logs = R.logs().orderBy("ts", "desc").limit(200).onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  function listenTransfers(cb) {
    _unsub.transfers = R.transfers().orderBy("ts", "desc").limit(200).onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  function listenMissions(cb) {
    _unsub.missions = R.missions().orderBy("ts", "desc").limit(100).onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }

  // ── WRITES ──
  async function setCheck(taskKey, done) { await R.checks().update({ [taskKey]: done }); }
  async function setAssignment(dayId, slot, name) {
    await R.assignments().update({ [`${dayId}_${slot}`]: name });
  }
  async function setTasks(dayId, slot, items) { await R.tasks(`${dayId}_${slot}`).set({ items }); }
  async function saveAlerts(data)     { await R.alerts().set(data); }
  async function resetChecks()        { await R.checks().set({}); }
  async function newWeek(label, num)  { await R.week().set({ label, num }); await resetChecks(); }

  async function addProduct(p)        { await R.products().add(p); }
  async function updateProduct(id, p) { await R.products().doc(id).update(p); }
  async function deleteProduct(id)    { await R.products().doc(id).delete(); }

  async function uploadMessageImage(file) {
    if (!storage) throw new Error("Firebase Storage non disponible");
    const mime = file.type || "image/jpeg";
    const extMap = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
    const ext  = extMap[mime] || (file.name || "file").split('.').pop().replace(/[^a-z0-9]/g, '') || "jpg";
    const path = `messages/${uuid()}.${ext}`;
    const ref  = storage.ref(path);
    return await new Promise((resolve, reject) => {
      var done = false;
      var timer = setTimeout(function() {
        if (!done) { done = true; reject(new Error("Upload timeout — connexion trop lente")); }
      }, 30000);

      const task = ref.put(file, { contentType: mime });
      task.on('state_changed',
        snap => {
          const pct = Math.round(snap.bytesTransferred / snap.totalBytes * 100) || 0;
          const btn = document.querySelector(".ann-compose .primary-btn, .compose .primary-btn");
          if (btn) btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${pct}%`;
        },
        err => { if (!done) { done = true; clearTimeout(timer); reject(err); } },
        async () => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve(await task.snapshot.ref.getDownloadURL());
          }
        }
      );
    });
  }

  async function sendMessage(data) {
    const doc = { author: data.author, title: data.title, body: data.body || "", ts: firebase.firestore.FieldValue.serverTimestamp() };
    if (data.imageUrl) doc.imageUrl = data.imageUrl;
    await R.messages().add(doc);
  }
  async function deleteMessage(id) {
    const snap = await R.messages().doc(id).get();
    if (snap.exists && snap.data().imageUrl && storage) {
      try { await storage.refFromURL(snap.data().imageUrl).delete(); } catch(e) {}
    }
    await R.messages().doc(id).delete();
  }

  async function addUser(data)                      { await R.users().add(data); }
  async function updateUser(id, data)               { await R.users().doc(id).update(data); }
  async function updateUserPlanningOrder(id, order) { await R.users().doc(id).update({ planningOrder: order }); }
  async function deleteUser(id)                     { await R.users().doc(id).delete(); }

  async function addLog(data) {
    await R.logs().add({ ...data, ts: firebase.firestore.FieldValue.serverTimestamp() });
  }
  async function createTransfer(data) {
    await R.transfers().add({ ...data, status: "pending", ts: firebase.firestore.FieldValue.serverTimestamp() });
  }
  async function updateTransfer(id, status) {
    await R.transfers().doc(id).update({ status });
  }
  async function cancelTransfer(id) {
    await R.transfers().doc(id).delete();
  }

  async function addMission(data) {
    await R.missions().add({ ...data, done: false, ts: firebase.firestore.FieldValue.serverTimestamp() });
  }
  async function updateMission(id, data) {
    await R.missions().doc(id).update(data);
  }
  async function deleteMission(id) {
    await R.missions().doc(id).delete();
  }

  async function setNote(key, text) {
    const ref = db.collection("config").doc("notes");
    if (text) {
      await ref.set({ [key]: text }, { merge: true });
    } else {
      const snap = await ref.get();
      if (snap.exists) {
        const u = {};
        u[key] = firebase.firestore.FieldValue.delete();
        await ref.update(u);
      }
    }
  }
  async function archiveWeek(data) {
    await db.collection("weekHistory").add({ ...data, archivedAt: firebase.firestore.FieldValue.serverTimestamp() });
  }

  function listenNotes(cb) {
    _unsub.notes = db.collection("config").doc("notes").onSnapshot(snap => {
      cb(snap.exists ? snap.data() : {});
    });
  }
  function listenHistory(cb) {
    _unsub.history = db.collection("weekHistory").orderBy("archivedAt", "desc").limit(20).onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }

  function listenPlanning(cb) {
    _unsub.planning = db.collection("config").doc("planning").onSnapshot(snap => {
      cb(snap.exists ? (snap.data().imageUrl || null) : null);
    });
  }
  async function uploadPlanningImage(file) {
    if (!storage) throw new Error("Firebase Storage non disponible");
    const { uuid } = window.MX;
    const ref = storage.ref(`planning/${uuid()}.jpg`);
    return await new Promise((resolve, reject) => {
      var done = false;
      var timer = setTimeout(function() {
        if (!done) { done = true; reject(new Error("Upload timeout")); }
      }, 60000);
      const task = ref.put(file, { contentType: "image/jpeg" });
      task.on('state_changed', null,
        err => { if (!done) { done = true; clearTimeout(timer); reject(err); } },
        async () => { if (!done) { done = true; clearTimeout(timer); resolve(await task.snapshot.ref.getDownloadURL()); } }
      );
    });
  }
  async function savePlanning(imageUrl) {
    const snap = await db.collection("config").doc("planning").get();
    if (snap.exists && snap.data().imageUrl && storage) {
      try { await storage.refFromURL(snap.data().imageUrl).delete(); } catch(e) {}
    }
    await db.collection("config").doc("planning").set({ imageUrl });
  }
  async function clearPlanning() {
    const snap = await db.collection("config").doc("planning").get();
    if (snap.exists && snap.data().imageUrl && storage) {
      try { await storage.refFromURL(snap.data().imageUrl).delete(); } catch(e) {}
    }
    await db.collection("config").doc("planning").set({ imageUrl: null });
  }

  async function saveFcmToken(token, userName, platform) {
    await db.collection("fcmTokens").doc(token).set({ token, userName: userName || "", platform: platform || 'unknown', ts: firebase.firestore.FieldValue.serverTimestamp() });
  }
  async function deleteFcmToken(token) {
    await db.collection("fcmTokens").doc(token).delete();
  }

  async function clearLogs() {
    const snap  = await R.logs().limit(500).get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // ── RESP PLANNING ──
  function listenRespTasks(cb) {
    _unsub.resp_tasks = R.resp_tasks().orderBy("order").onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  async function addRespTask(data) {
    await R.resp_tasks().add({ ...data, ts: firebase.firestore.FieldValue.serverTimestamp() });
  }
  async function updateRespTask(id, data) {
    await R.resp_tasks().doc(id).update(data);
  }
  async function deleteRespTask(id) {
    await R.resp_tasks().doc(id).delete();
  }

  // ── ANNOUNCEMENTS ──
  const R_ANN = () => db.collection('announcements');
  const FV    = firebase.firestore.FieldValue;

  function listenAnnouncements(cb) {
    _unsub.announcements = R_ANN()
      .orderBy('createdAt', 'desc')
      .limit(100)
      .onSnapshot(snap => {
        cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });
  }
  async function sendAnnouncement({ type, content, title, tags, authorName, authorRole, imageUrl, imageMime, useNewReactions }) {
    const data = {
      type, content: content || '', authorName, authorRole,
      createdAt: FV.serverTimestamp(),
      pinned: false,
      reactions: useNewReactions
        ? { ok: [], warning: [], wrench: [], attach: [], seen: [] }
        : { '👍': [], '✅': [], '⚠️': [] },
      readBy: [authorName],
      replyCount: 0
    };
    if (title)    data.title = title;
    if (tags && tags.length) data.tags = tags;
    if (imageUrl) { data.imageUrl = imageUrl; if (imageMime) data.imageMime = imageMime; }
    await R_ANN().add(data);
  }
  async function deleteAnnouncement(id) {
    const batch = db.batch();
    const replies = await R_ANN().doc(id).collection('replies').get();
    replies.docs.forEach(d => batch.delete(d.ref));
    const snap = await R_ANN().doc(id).get();
    batch.delete(R_ANN().doc(id));
    await batch.commit();
    if (snap.exists && snap.data().imageUrl && storage) {
      try { await storage.refFromURL(snap.data().imageUrl).delete(); } catch(e) {}
    }
  }
  async function togglePin(id, currentlyPinned) {
    await R_ANN().doc(id).update({ pinned: !currentlyPinned });
  }
  async function toggleReaction(annId, emoji, userName, isActive) {
    const field = 'reactions.' + emoji;
    await R_ANN().doc(annId).update({
      [field]: isActive ? FV.arrayRemove(userName) : FV.arrayUnion(userName)
    });
  }
  async function markReadAnnouncement(annId, userName) {
    await R_ANN().doc(annId).update({ readBy: FV.arrayUnion(userName) });
  }
  function listenReplies(annId, cb) {
    return R_ANN().doc(annId).collection('replies')
      .orderBy('createdAt', 'asc')
      .onSnapshot(snap => {
        cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });
  }
  async function sendReply({ annId, content, authorName, authorRole }) {
    await R_ANN().doc(annId).collection('replies').add({
      content, authorName, authorRole,
      createdAt: FV.serverTimestamp()
    });
    await R_ANN().doc(annId).update({ replyCount: FV.increment(1) });
  }
  async function deleteReply(annId, replyId) {
    await R_ANN().doc(annId).collection('replies').doc(replyId).delete();
    await R_ANN().doc(annId).update({ replyCount: FV.increment(-1) });
  }

  // ── PRESENCE ──
  function _presenceKey(name) { return (name || "anon").replace(/\s+/g, "_"); }
  function _countActive(snap) {
    const cutoff = Date.now() - 5 * 60 * 1000;
    return snap.docs.filter(d => {
      const ts = d.data().updatedAt;
      if (!ts) return false;
      const ms = ts.toMillis ? ts.toMillis() : ts.seconds * 1000;
      return ms > cutoff;
    }).length;
  }
  async function updatePresence(name) {
    await db.collection("presence").doc(_presenceKey(name)).set(
      { name: name || "Anonyme", updatedAt: FV.serverTimestamp() },
      { merge: true }
    );
  }
  function listenPresence(cb) {
    let _snap = null;
    const _iv = setInterval(() => { if (_snap) cb(_countActive(_snap)); }, 60000);
    const _fn = db.collection("presence").onSnapshot(snap => {
      _snap = snap;
      cb(_countActive(snap));
    });
    _unsub.presence = () => { _fn(); clearInterval(_iv); };
  }

  // ── ORDERS ──
  function listenOrders(cb) {
    _unsub.orders = db.collection("orders").orderBy("createdAt", "desc").limit(50).onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  async function addOrder(data) {
    return await db.collection("orders").add({ ...data, createdAt: FV.serverTimestamp() });
  }
  async function updateOrderStatus(id, status) {
    await db.collection("orders").doc(id).update({ status });
  }
  async function deleteOrder(id) {
    await db.collection("orders").doc(id).delete();
  }

  // ── STOCK CHECKS (états des lieux hebdomadaires) ──
  // Un seul document par état des lieux (zone + semaine), créé UNIQUEMENT
  // quand l'utilisateur démarre réellement (jamais à l'ouverture de la page).
  // `draftCounts` (map productId -> quantité saisie) est un champ technique
  // ajouté en plus des champs demandés, pour permettre la reprise d'un état
  // des lieux "in_progress" si l'utilisateur quitte avant validation — il
  // est effacé à la validation finale (commitStockCheck).
  function listenStockChecks(cb) {
    _unsub.stock_checks = db.collection("stock_checks").orderBy("createdAt", "desc").limit(100).onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  async function createStockCheck(data) {
    const ref = await db.collection("stock_checks").add({
      ...data,
      status: "in_progress",
      createdAt: FV.serverTimestamp(),
      updatedAt: FV.serverTimestamp()
    });
    return ref.id;
  }
  async function saveStockCheckDraft(id, draftCounts) {
    await db.collection("stock_checks").doc(id).update({ draftCounts, updatedAt: FV.serverTimestamp() });
  }
  async function cancelStockCheck(id) {
    await db.collection("stock_checks").doc(id).update({ status: "cancelled", updatedAt: FV.serverTimestamp() });
  }
  // Validation finale : écrit les lignes dans la sous-collection items, met à
  // jour products.qty (dernière quantité constatée = stock actuel), et clôt
  // le document stock_checks. N'écrit JAMAIS de commande fournisseur — la
  // commande reste une action séparée (voir MX.Pages.Orders._generatePDF).
  // Le batch Firestore est limité à 500 opérations : on découpe par
  // paquets de 200 lignes (2 écritures/ligne) par sécurité.
  async function commitStockCheck(id, items, summary) {
    const checkRef = db.collection("stock_checks").doc(id);
    const CHUNK = 200;
    for (let i = 0; i < items.length; i += CHUNK) {
      const batch = db.batch();
      items.slice(i, i + CHUNK).forEach(function (it) {
        batch.set(checkRef.collection("items").doc(), it);
        if (it.productId) {
          batch.update(db.collection("products").doc(it.productId), {
            qty: it.countedQty,
            lastCheckAt: FV.serverTimestamp(),
            lastCheckId: id
          });
        }
      });
      await batch.commit();
    }
    await checkRef.update({
      status: "done",
      checkedProducts: summary.checkedProducts,
      productsToOrder: summary.productsToOrder,
      draftCounts: FV.delete(),
      updatedAt: FV.serverTimestamp()
    });
  }
  function getStockCheckItems(id) {
    return db.collection("stock_checks").doc(id).collection("items").get()
      .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }

  // ── REWARDS ──
  const R_RULES  = () => db.collection('rewards_rules');
  const R_GRADES = () => db.collection('rewards_grades');
  const R_ITEMS  = () => db.collection('rewards_items');
  const R_RHIST  = () => db.collection('rewards_history');
  const R_RUSERS = () => db.collection('rewards_users');

  function listenRewardsRules(cb) {
    _unsub.rewards_rules = R_RULES().orderBy('points').onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  function listenRewardsGrades(cb) {
    _unsub.rewards_grades = R_GRADES().orderBy('minPoints').onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  function listenRewardsItems(cb) {
    _unsub.rewards_items = R_ITEMS().orderBy('cost').onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  function listenRewardsHistory(cb) {
    _unsub.rewards_history = R_RHIST().orderBy('ts', 'desc').limit(200).onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  function listenRewardsUsers(cb) {
    _unsub.rewards_users = R_RUSERS().onSnapshot(snap => {
      const map = {};
      snap.docs.forEach(d => { map[d.id] = d.data(); });
      cb(map);
    });
  }

  async function addRewardsRule(data)        { await R_RULES().add(data); }
  async function updateRewardsRule(id, data) { await R_RULES().doc(id).update(data); }
  async function deleteRewardsRule(id)       { await R_RULES().doc(id).delete(); }

  async function addRewardsGrade(data)        { await R_GRADES().add(data); }
  async function updateRewardsGrade(id, data) { await R_GRADES().doc(id).update(data); }
  async function deleteRewardsGrade(id)       { await R_GRADES().doc(id).delete(); }

  async function addRewardsItem(data)        { await R_ITEMS().add(data); }
  async function updateRewardsItem(id, data) { await R_ITEMS().doc(id).update(data); }
  async function deleteRewardsItem(id)       { await R_ITEMS().doc(id).delete(); }

  async function awardPoints(userId, userName, event, points, description) {
    const batch = db.batch();
    batch.set(R_RHIST().doc(), { userId, userName, event, points, description, ts: FV.serverTimestamp() });
    batch.set(R_RUSERS().doc(userId), { points: FV.increment(points), lastActivity: FV.serverTimestamp() }, { merge: true });
    await batch.commit();
  }

  async function spendPoints(userId, userName, event, points, description) {
    const snap = await R_RUSERS().doc(userId).get();
    const current = snap.exists ? (snap.data().points || 0) : 0;
    if (current < points) throw new Error('not_enough');
    const batch = db.batch();
    batch.set(R_RHIST().doc(), { userId, userName, event, points: -points, description, ts: FV.serverTimestamp() });
    batch.set(R_RUSERS().doc(userId), { points: FV.increment(-points), lastActivity: FV.serverTimestamp() }, { merge: true });
    await batch.commit();
  }

  const _DEFAULT_GRADES = [
    { name: 'Recrue',         minPoints: 0,    icon: '🔩', color: '#6B7280' },
    { name: 'Opérateur',      minPoints: 50,   icon: '🔧', color: '#3B82F6' },
    { name: 'Bronze',         minPoints: 100,  icon: '🥉', color: '#92400E' },
    { name: 'Argent',         minPoints: 250,  icon: '🥈', color: '#9CA3AF' },
    { name: 'Or',             minPoints: 500,  icon: '🥇', color: '#D97706' },
    { name: 'Platine',        minPoints: 1000, icon: '💎', color: '#8B5CF6' },
    { name: 'Expert',         minPoints: 2000, icon: '🛡️', color: '#EC4899' },
    { name: 'Maître Maintix', minPoints: 5000, icon: '🏆', color: '#EF4444' }
  ];
  const _DEFAULT_RULES = [
    { label: 'Prendre la permanence',         event: 'permanence',       points: 1,  icon: 'fa-shield',           active: true },
    { label: 'Tâche terminée',                event: 'task_done',        points: 1,  icon: 'fa-check',            active: true },
    { label: 'Intervention terminée',         event: 'mission_done',     points: 3,  icon: 'fa-flag-checkered',   active: true },
    { label: 'Intervention urgente',          event: 'mission_urgent',   points: 5,  icon: 'fa-bolt',             active: true },
    { label: 'Zéro tâche en retard semaine',  event: 'no_late',          points: 10, icon: 'fa-calendar-check',   active: true },
    { label: 'Stock mis à jour',              event: 'stock_update',     points: 2,  icon: 'fa-box',              active: true },
    { label: 'Proposition d\'amélioration',   event: 'suggestion',       points: 5,  icon: 'fa-lightbulb',        active: true },
    { label: 'Mission bloquée résolue',       event: 'mission_resolved', points: 3,  icon: 'fa-check-double',     active: true }
  ];

  async function initRewardsDefaults() {
    const snap = await R_GRADES().limit(1).get();
    if (!snap.empty) return;
    const batch = db.batch();
    _DEFAULT_GRADES.forEach(g => batch.set(R_GRADES().doc(), g));
    _DEFAULT_RULES.forEach(r => batch.set(R_RULES().doc(), r));
    await batch.commit();
  }

  async function resetRewardsDefaults() {
    const [gradesSnap, rulesSnap] = await Promise.all([R_GRADES().get(), R_RULES().get()]);
    const batch = db.batch();
    gradesSnap.docs.forEach(d => batch.delete(d.ref));
    rulesSnap.docs.forEach(d => batch.delete(d.ref));
    _DEFAULT_GRADES.forEach(g => batch.set(R_GRADES().doc(), g));
    _DEFAULT_RULES.forEach(r => batch.set(R_RULES().doc(), r));
    await batch.commit();
  }

  // ── GAMES ──
  const R_GSCORES = () => db.collection('games_scores');
  const R_GACHIEV = () => db.collection('games_achievements');
  const R_GQUEST  = () => db.collection('games_questions');

  function listenGameScores(cb) {
    _unsub.game_scores = R_GSCORES().orderBy('ts', 'desc').limit(500).onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  function listenGameAchievements(cb) {
    _unsub.game_achievements = R_GACHIEV().onSnapshot(snap => {
      const map = {};
      snap.docs.forEach(d => {
        const data = d.data();
        if (!map[data.userId]) map[data.userId] = {};
        map[data.userId][data.achievementId] = { ...data, id: d.id };
      });
      cb(map);
    });
  }
  function listenGameQuestions(cb) {
    _unsub.game_questions = R_GQUEST().orderBy('category').onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }

  async function saveGameScore(data) {
    await R_GSCORES().add({ ...data, ts: FV.serverTimestamp() });
  }
  async function saveGameAchievement(data) {
    await R_GACHIEV().add({ ...data, ts: FV.serverTimestamp() });
  }
  async function addGameQuestion(data)        { await R_GQUEST().add(data); }
  async function updateGameQuestion(id, data) { await R_GQUEST().doc(id).update(data); }
  async function deleteGameQuestion(id)       { await R_GQUEST().doc(id).delete(); }

  async function resetGameScores() {
    const snap  = await R_GSCORES().limit(500).get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // ── BIBLE MAINTIX ──
  const R_BIBLE_ART = () => db.collection('bible_articles');
  const R_BIBLE_CMT = () => db.collection('bible_comments');

  function listenBibleArticles(cb) {
    return R_BIBLE_ART().orderBy('updatedAt', 'desc').limit(500).onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  async function addBibleArticle(data) {
    const ref = await R_BIBLE_ART().add(data);
    return ref.id;
  }
  async function updateBibleArticle(id, data) {
    await R_BIBLE_ART().doc(id).update(data);
  }
  async function deleteBibleArticle(id) {
    const batch = db.batch();
    const cmts = await R_BIBLE_CMT().where('articleId', '==', id).get();
    cmts.docs.forEach(d => batch.delete(d.ref));
    batch.delete(R_BIBLE_ART().doc(id));
    await batch.commit();
  }
  async function incrementBibleViews(id) {
    await R_BIBLE_ART().doc(id).update({ viewCount: FV.increment(1) });
  }
  async function toggleBibleLike(id, userName, currentlyLiked) {
    await R_BIBLE_ART().doc(id).update({
      likes: currentlyLiked ? FV.arrayRemove(userName) : FV.arrayUnion(userName)
    });
  }
  function listenBibleComments(articleId, cb) {
    return R_BIBLE_CMT().where('articleId', '==', articleId).orderBy('createdAt', 'asc').onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, _fsError('bible_comments'));
  }
  async function addBibleComment(data) {
    await R_BIBLE_CMT().add({ ...data, createdAt: FV.serverTimestamp() });
  }
  async function deleteBibleComment(id) {
    await R_BIBLE_CMT().doc(id).delete();
  }

  // ── BIBLE CATEGORIES ──
  const R_BIBLE_CAT = () => db.collection('bibleCategories');

  function listenBibleCategories(cb) {
    return R_BIBLE_CAT().orderBy('order').onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  async function addBibleCategory(data) {
    const { id: specId, ...rest } = data;
    const payload = { ...rest, createdAt: FV.serverTimestamp() };
    if (specId) {
      const ref = R_BIBLE_CAT().doc(specId);
      const snap = await ref.get();
      if (!snap.exists) await ref.set(payload);
      return specId;
    }
    const newRef = await R_BIBLE_CAT().add(payload);
    return newRef.id;
  }
  async function updateBibleCategory(id, data) {
    await R_BIBLE_CAT().doc(id).update(data);
  }
  async function deleteBibleCategory(id) {
    await R_BIBLE_CAT().doc(id).delete();
  }
  async function countBibleCategoryArticles(catId) {
    const snap = await R_BIBLE_ART().where('category', '==', catId).get();
    return snap.size;
  }
  async function moveBibleCategoryArticles(fromId, toId) {
    const snap = await R_BIBLE_ART().where('category', '==', fromId).get();
    if (!snap.size) return 0;
    const batch = db.batch();
    snap.docs.forEach(d => batch.update(d.ref, { category: toId }));
    await batch.commit();
    return snap.size;
  }

  // ── PLANNING MODULE ──
  const R_PLAN_ENT = () => db.collection('planning_entries');
  const R_PLAN_SHF = () => db.collection('planning_shifts');

  const _DEF_SHIFTS = [
    { code:'1',   name:'Matin',     color:'#FDE047', textColor:'#1a1a1a', start:'08:00', end:'16:33', bold:false, order:0 },
    { code:'2',   name:'Journée',   color:'#9CA3AF', textColor:'#1a1a1a', start:'09:00', end:'17:33', bold:false, order:1 },
    { code:'3',   name:'Ap-Midi',   color:'#3B82F6', textColor:'#ffffff', start:'10:00', end:'18:33', bold:false, order:2 },
    { code:'4',   name:'Soir',      color:'#EF4444', textColor:'#ffffff', start:'13:00', end:'21:33', bold:false, order:3 },
    { code:'RH',  name:'Repos',     color:'#22C55E', textColor:'#1a1a1a', start:'',      end:'',      bold:true,  order:4 },
    { code:'CP',  name:'Congé',     color:'#F97316', textColor:'#1a1a1a', start:'',      end:'',      bold:true,  order:5 },
    { code:'JFL', name:'J.Férié',   color:'#F97316', textColor:'#1a1a1a', start:'',      end:'',      bold:true,  order:6 },
    { code:'EXT', name:'Extérieur', color:'#FFFFFF', textColor:'#1a1a1a', start:'',      end:'',      bold:true,  order:7 },
  ];

  function listenPlanningShifts(cb) {
    _unsub.planning_shifts = R_PLAN_SHF().orderBy('order').onSnapshot(snap => {
      cb(snap.empty ? _DEF_SHIFTS : snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }

  async function loadPlanningMonth(year, month) {
    const ym = `${year}-${String(month + 1).padStart(2,'0')}`;
    const snap = await R_PLAN_ENT().where('ym', '==', ym).get();
    const map = {};
    snap.docs.forEach(d => {
      const data = d.data();
      map[`${data.userId}_${data.date}`] = data;
    });
    return map;
  }

  function listenPlanningEntries(yms, cb) {
    // yms: array of "YYYY-MM" strings to listen to (1 or 2 for cross-month week view)
    const unsubs = yms.map(ym =>
      R_PLAN_ENT().where('ym', '==', ym).onSnapshot(snap => {
        const map = {};
        snap.docs.forEach(d => {
          const data = d.data();
          map[`${data.userId}_${data.date}`] = data;
        });
        cb(ym, map);
      })
    );
    return () => unsubs.forEach(u => u());
  }

  async function setPlanningEntry(userId, dateStr, shiftCode) {
    const user = (window.MX.state.users || []).find(u => u.id === userId);
    const ym = dateStr.slice(0, 7);
    const actor = window.MX.state.adminUser
      ? (window.MX.state.adminUser.email || 'admin')
      : (window.MX.state.currentUser ? window.MX.state.currentUser.name : 'system');
    await R_PLAN_ENT().doc(`${userId}_${dateStr}`).set({
      userId,
      userName: user ? user.name : userId,
      date: dateStr,
      ym,
      shiftCode,
      updatedBy: actor,
      updatedAt: FV.serverTimestamp()
    });
    if (window.MX.state.planningEntries) {
      window.MX.state.planningEntries[`${userId}_${dateStr}`] = { userId, userName: user ? user.name : userId, date: dateStr, ym, shiftCode };
    }
  }

  async function deletePlanningEntry(userId, dateStr) {
    await R_PLAN_ENT().doc(`${userId}_${dateStr}`).delete();
    if (window.MX.state.planningEntries) {
      delete window.MX.state.planningEntries[`${userId}_${dateStr}`];
    }
  }

  async function savePlanningShifts(shiftsArray) {
    const snap = await R_PLAN_SHF().get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    shiftsArray.forEach(s => batch.set(R_PLAN_SHF().doc(), s));
    await batch.commit();
  }

  // ── GESTION SEMAINE TECH — MODÈLES DE CRÉNEAUX ──────────────────────────
  // Un "modèle de créneau" EST son horaire (nom, heures, couleur, icône) ET
  // sa liste de tâches — contrairement à planning_shifts ci-dessus (codes
  // courts régénérés en bloc à chaque sauvegarde, voir savePlanningShifts),
  // chaque modèle a un ID Firestore STABLE et individuel (jamais dérivé du
  // nom ni des horaires) : renommer/recolorer un modèle plus tard ne casse
  // jamais une semaine déjà préparée qui le référence (voir week_slots plus
  // bas, qui copie — ne référence jamais en direct — le contenu du modèle).
  const R_SHIFT_TPL = () => db.collection('shift_templates');

  function listenShiftTemplates(cb) {
    _unsub.shift_templates = R_SHIFT_TPL().orderBy('order').onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, _fsError('shift_templates'));
  }
  async function addShiftTemplate(data) {
    const snap = await R_SHIFT_TPL().orderBy('order', 'desc').limit(1).get();
    const nextOrder = snap.empty ? 0 : ((snap.docs[0].data().order || 0) + 1);
    const ref = await R_SHIFT_TPL().add(Object.assign({ order: nextOrder }, data, { createdAt: FV.serverTimestamp() }));
    return ref.id;
  }
  async function updateShiftTemplate(id, data) {
    await R_SHIFT_TPL().doc(id).update(Object.assign({}, data, { updatedAt: FV.serverTimestamp() }));
  }
  async function deleteShiftTemplate(id) {
    await R_SHIFT_TPL().doc(id).delete();
  }
  async function duplicateShiftTemplate(id) {
    const snap = await R_SHIFT_TPL().doc(id).get();
    if (!snap.exists) throw new Error('Modèle introuvable');
    const src = snap.data();
    return addShiftTemplate(Object.assign({}, src, {
      name: (src.name || 'Modèle') + ' (copie)',
      tasks: (src.tasks || []).map(t => Object.assign({}, t)),
    }));
  }

  // ── GESTION SEMAINE TECH — AFFECTATIONS RÉELLEMENT DATÉES ───────────────
  // Un seul document par semaine réelle (weekKey format "AAAA_Wnn", voir
  // MX.checkWeekOf/MX.weekKeyOf — même algorithme que checklist.js pour que
  // les clés s'alignent partout), contenant pour chaque jour la liste
  // ORDONNÉE des instances de créneau de CETTE semaine précise. Une instance
  // est une COPIE figée du modèle au moment du chargement (nom, horaire,
  // couleur, icône, tâches) — modifier le modèle source plus tard ne doit
  // JAMAIS rejaillir sur une semaine déjà préparée. L'avancement (tâche
  // faite/non faite) est stocké directement sur chaque tâche de l'instance
  // (chaque instance a EXACTEMENT un technicien assigné, donc pas besoin
  // d'un système de "propriétaire de coche" séparé comme pour l'ancien
  // config/checks — la case cochée appartient sans ambiguïté à l'instance).
  const R_WEEK_SLOTS = () => db.collection('week_slots');

  // Retourne directement la fonction de désabonnement (comme listenRoles,
  // listenMaintenance, etc.) plutôt que de passer par le registre partagé
  // _unsub : plusieurs appelants indépendants (le listener global de
  // app.js pour la semaine en cours, et la navigation propre à l'écran
  // Gestion semaine tech, potentiellement sur une AUTRE semaine) doivent
  // pouvoir coexister sans se couper l'un l'autre.
  function listenWeekSlots(weekKey, cb) {
    return R_WEEK_SLOTS().doc(weekKey).onSnapshot(snap => {
      cb(snap.exists ? snap.data() : null);
    }, _fsError('week_slots'));
  }
  async function getWeekSlots(weekKey) {
    const snap = await R_WEEK_SLOTS().doc(weekKey).get();
    return snap.exists ? snap.data() : null;
  }
  async function ensureWeekSlots(weekKey, weekLabel, actor) {
    const snap = await R_WEEK_SLOTS().doc(weekKey).get();
    if (snap.exists) return snap.data();
    const doc = { weekKey, weekLabel: weekLabel || weekKey, days: {}, createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(), updatedBy: actor || '' };
    await R_WEEK_SLOTS().doc(weekKey).set(doc);
    return doc;
  }
  async function loadTemplateIntoWeekDay(weekKey, weekLabel, dayId, templateId, userId, userName, actor) {
    const tplSnap = await R_SHIFT_TPL().doc(templateId).get();
    if (!tplSnap.exists) throw new Error('Modèle introuvable');
    const tpl = tplSnap.data();
    const wkSnap = await R_WEEK_SLOTS().doc(weekKey).get();
    const days   = (wkSnap.exists && wkSnap.data().days) || {};
    const list   = days[dayId] || [];
    const instance = {
      id: uuid(),
      templateId,
      name:  tpl.name  || 'Créneau',
      icon:  tpl.icon  || '',
      color: tpl.color || '#6B7280',
      start: tpl.start || '',
      end:   tpl.end   || '',
      userId:   userId   || null,
      userName: userName || '',
      order: list.length,
      tasks: (tpl.tasks || []).map(t => ({ id: uuid(), text: t.text, order: t.order || 0, done: false })),
    };
    await R_WEEK_SLOTS().doc(weekKey).set({
      weekKey, weekLabel: weekLabel || weekKey,
      days: { [dayId]: list.concat([instance]) },
      updatedAt: FV.serverTimestamp(), updatedBy: actor || ''
    }, { merge: true });
    return instance.id;
  }
  async function setWeekSlotAssignee(weekKey, dayId, instanceId, userId, userName, actor) {
    const snap = await R_WEEK_SLOTS().doc(weekKey).get();
    const days = (snap.exists && snap.data().days) || {};
    const list = (days[dayId] || []).map(inst =>
      inst.id === instanceId ? Object.assign({}, inst, { userId: userId || null, userName: userName || '' }) : inst
    );
    await R_WEEK_SLOTS().doc(weekKey).set({
      days: { [dayId]: list }, updatedAt: FV.serverTimestamp(), updatedBy: actor || ''
    }, { merge: true });
  }
  async function setWeekSlotTaskDone(weekKey, dayId, instanceId, taskId, done, actor) {
    const snap = await R_WEEK_SLOTS().doc(weekKey).get();
    const days = (snap.exists && snap.data().days) || {};
    const list = (days[dayId] || []).map(inst => {
      if (inst.id !== instanceId) return inst;
      return Object.assign({}, inst, {
        tasks: (inst.tasks || []).map(t => t.id === taskId ? Object.assign({}, t, { done: !!done }) : t)
      });
    });
    await R_WEEK_SLOTS().doc(weekKey).set({
      days: { [dayId]: list }, updatedAt: FV.serverTimestamp(), updatedBy: actor || ''
    }, { merge: true });
  }
  async function deleteWeekSlotInstance(weekKey, dayId, instanceId, actor) {
    const snap = await R_WEEK_SLOTS().doc(weekKey).get();
    const days = (snap.exists && snap.data().days) || {};
    const list = (days[dayId] || []).filter(inst => inst.id !== instanceId);
    await R_WEEK_SLOTS().doc(weekKey).set({
      days: { [dayId]: list }, updatedAt: FV.serverTimestamp(), updatedBy: actor || ''
    }, { merge: true });
  }
  // Copie INTÉGRALE (structure + techniciens) d'une semaine vers une autre —
  // nouvelles instances (nouveaux id), jamais de référence partagée avec la
  // semaine source : modifier la copie ne touche jamais l'originale, et vice
  // versa. Les tâches repartent toutes à "non faites" (done:false).
  // Les déplacements manuels (movedFrom, voir moveWeekSlotTask ci-dessous)
  // sont une personnalisation TEMPORAIRE de la semaine source — une copie
  // vers une autre semaine doit repartir de la configuration normale du
  // modèle, jamais reproduire le déplacement. Pour chaque tâche marquée
  // movedFrom, la copie la replace donc dans SA COPIE de l'instance
  // d'origine (jamais dans l'instance d'origine de la semaine SOURCE, qui
  // n'est ni lue ni modifiée), sans le marqueur movedFrom. Si l'instance
  // d'origine a elle-même été retirée de la semaine source entre-temps
  // (deleteWeekSlotInstance), aucune reconstruction n'est tentée : la
  // tâche reste, dans la copie, là où elle se trouvait au moment de la
  // copie — seule façon de ne jamais perdre une tâche. `warnings` liste
  // ces cas pour que l'appelant (ou un test) puisse les signaler.
  async function copyWeekSlots(fromWeekKey, toWeekKey, toWeekLabel, actor) {
    const snap = await R_WEEK_SLOTS().doc(fromWeekKey).get();
    if (!snap.exists) throw new Error('Semaine source introuvable');
    const src = snap.data();
    const newDays = {};
    const warnings = [];
    Object.keys(src.days || {}).forEach(dayId => {
      const srcList = src.days[dayId] || [];
      const idMap = {};
      srcList.forEach(inst => { idMap[inst.id] = uuid(); });

      const perInstanceTasks = {};
      srcList.forEach(inst => { perInstanceTasks[idMap[inst.id]] = []; });

      srcList.forEach(inst => {
        (inst.tasks || []).forEach(t => {
          const copiedTask = Object.assign({}, t, { done: false });
          delete copiedTask.movedFrom;
          if (t.movedFrom) {
            const originNewId = idMap[t.movedFrom];
            if (originNewId) {
              perInstanceTasks[originNewId].push(copiedTask);
            } else {
              // Instance d'origine introuvable dans la source — pas de
              // perte : la tâche reste dans son instance actuelle, sans
              // le marqueur temporaire (elle redevient une tâche normale
              // de cette instance dans la copie).
              perInstanceTasks[idMap[inst.id]].push(copiedTask);
              warnings.push({ dayId, taskId: t.id, taskText: t.text, missingOriginInstanceId: t.movedFrom, keptInInstanceId: idMap[inst.id] });
            }
          } else {
            perInstanceTasks[idMap[inst.id]].push(copiedTask);
          }
        });
      });

      newDays[dayId] = srcList.map(inst => Object.assign({}, inst, {
        id: idMap[inst.id],
        tasks: perInstanceTasks[idMap[inst.id]].map((t, i) => Object.assign({}, t, { order: i })),
      }));
    });
    await R_WEEK_SLOTS().doc(toWeekKey).set({
      weekKey: toWeekKey, weekLabel: toWeekLabel || toWeekKey, days: newDays,
      createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(), updatedBy: actor || ''
    });
    return { warnings };
  }

  // ── RÉPARTITION TEMPORAIRE DES MISSIONS (Gestion semaine tech) ───────────
  // Déplace une tâche d'une instance de créneau vers une autre, TOUJOURS au
  // sein du même jour (aucune validation de "même jour" ici : c'est à
  // l'appelant de ne jamais passer un dayId différent — voir gestion-semaine
  // -tech.js, qui ne construit jamais d'appel inter-jours). N'écrit QUE
  // week_slots/{weekKey} — jamais shift_templates : la tâche déplacée est
  // une copie déjà figée dans l'instance, le modèle source n'est jamais lu
  // ni modifié par cette fonction.
  //
  // movedFrom mémorise l'instance D'ORIGINE (celle où la tâche a été copiée
  // depuis le modèle la toute première fois) : un second déplacement ne
  // l'écrase PAS, pour que "Restaurer l'emplacement d'origine" retrouve
  // toujours le bon créneau même après plusieurs déplacements successifs.
  // Écriture ATOMIQUE unique (un seul .set) : retrait de la source et ajout
  // en destination sont dans le même document, donc dans la même requête —
  // jamais d'état intermédiaire "tâche nulle part"/"tâche aux deux endroits"
  // visible côté Firestore.
  async function moveWeekSlotTask(weekKey, dayId, fromInstanceId, toInstanceId, taskId, actor) {
    const snap = await R_WEEK_SLOTS().doc(weekKey).get();
    const days = (snap.exists && snap.data().days) || {};
    const list = days[dayId] || [];
    const fromInst = list.find(i => i.id === fromInstanceId);
    const toInst   = list.find(i => i.id === toInstanceId);
    if (!fromInst || !toInst) throw new Error('Créneau introuvable');
    const task = (fromInst.tasks || []).find(t => t.id === taskId);
    if (!task) throw new Error('Tâche introuvable');
    const movedTask = Object.assign({}, task, {
      order: (toInst.tasks || []).length,
      movedFrom: task.movedFrom || fromInstanceId,
    });
    const newList = list.map(inst => {
      if (inst.id === fromInstanceId) return Object.assign({}, inst, { tasks: (inst.tasks || []).filter(t => t.id !== taskId) });
      if (inst.id === toInstanceId)   return Object.assign({}, inst, { tasks: (inst.tasks || []).concat([movedTask]) });
      return inst;
    });
    await R_WEEK_SLOTS().doc(weekKey).set({
      days: { [dayId]: newList }, updatedAt: FV.serverTimestamp(), updatedBy: actor || ''
    }, { merge: true });
  }

  // Remet une tâche déplacée dans son instance d'origine (movedFrom) et
  // efface le marqueur — une fois restaurée, la tâche redevient une tâche
  // normale de son créneau d'origine, indiscernable d'une tâche jamais
  // déplacée. Ne fait rien (throw) si la tâche n'a jamais été déplacée ou
  // si son instance d'origine n'existe plus (ex. créneau retiré entre
  // temps) — jamais de perte de tâche silencieuse dans ce cas.
  async function restoreWeekSlotTask(weekKey, dayId, taskId, actor) {
    const snap = await R_WEEK_SLOTS().doc(weekKey).get();
    const days = (snap.exists && snap.data().days) || {};
    const list = days[dayId] || [];
    let fromInst = null, task = null;
    list.forEach(inst => { const t = (inst.tasks || []).find(x => x.id === taskId); if (t) { fromInst = inst; task = t; } });
    if (!fromInst || !task || !task.movedFrom) throw new Error('Rien à restaurer pour cette tâche');
    const toInst = list.find(i => i.id === task.movedFrom);
    if (!toInst) throw new Error('Créneau d\'origine introuvable (a peut-être été retiré)');
    const restoredTask = Object.assign({}, task, { order: (toInst.tasks || []).length });
    delete restoredTask.movedFrom;
    const newList = list.map(inst => {
      if (inst.id === fromInst.id)  return Object.assign({}, inst, { tasks: (inst.tasks || []).filter(t => t.id !== taskId) });
      if (inst.id === task.movedFrom) return Object.assign({}, inst, { tasks: (inst.tasks || []).concat([restoredTask]) });
      return inst;
    });
    await R_WEEK_SLOTS().doc(weekKey).set({
      days: { [dayId]: newList }, updatedAt: FV.serverTimestamp(), updatedBy: actor || ''
    }, { merge: true });
  }

  // Annule TOUS les déplacements manuels d'une journée en restaurant chaque
  // tâche marquée movedFrom vers son instance d'origine — jamais une
  // reconstruction depuis shift_templates (qui écraserait les coches, les
  // affectations et toute tâche ajoutée manuellement). Une tâche dont
  // l'instance d'origine n'existe plus reste où elle est (pas de perte).
  async function resetWeekSlotDayMoves(weekKey, dayId, actor) {
    const snap = await R_WEEK_SLOTS().doc(weekKey).get();
    const days = (snap.exists && snap.data().days) || {};
    const list = days[dayId] || [];
    const byId = {};
    list.forEach(inst => { byId[inst.id] = (inst.tasks || []).slice(); });
    list.forEach(inst => {
      (inst.tasks || []).forEach(t => {
        if (t.movedFrom && byId[t.movedFrom]) {
          byId[inst.id] = byId[inst.id].filter(x => x.id !== t.id);
          const restored = Object.assign({}, t, { order: byId[t.movedFrom].length });
          delete restored.movedFrom;
          byId[t.movedFrom] = byId[t.movedFrom].concat([restored]);
        }
      });
    });
    const newList = list.map(inst => Object.assign({}, inst, { tasks: byId[inst.id] }));
    await R_WEEK_SLOTS().doc(weekKey).set({
      days: { [dayId]: newList }, updatedAt: FV.serverTimestamp(), updatedBy: actor || ''
    }, { merge: true });
  }

  const R_ABS = () => db.collection('absences');

  function listenAbsences(cb) {
    _unsub.absences = R_ABS().orderBy('from', 'asc').onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  async function addAbsence(data) {
    await R_ABS().add({ ...data, validated: false, createdAt: FV.serverTimestamp() });
  }
  async function validateAbsence(id) {
    await R_ABS().doc(id).update({ validated: true });
  }
  async function deleteAbsence(id) {
    await R_ABS().doc(id).delete();
  }

  // ── ADMIN JOURNAL ──
  const R_AJRN = () => db.collection('admin_journal');

  function listenAdminJournal(cb) {
    return R_AJRN().orderBy('ts', 'desc').limit(200).onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  async function addAdminJournal(data) {
    const actor = window.MX.state.adminUser
      ? (window.MX.state.adminUser.email || 'admin').split('@')[0]
      : (window.MX.state.currentUser ? window.MX.state.currentUser.name : 'Système');
    await R_AJRN().add({ ...data, user: actor, ts: FV.serverTimestamp() });
  }
  async function clearAdminJournal() {
    const snap = await R_AJRN().limit(500).get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // ── DAILY CLAIMS (auto-attribution per date) ──
  function listenDailyClaims(dateStr, cb) {
    if (_unsub.daily_claims) _unsub.daily_claims();
    _unsub.daily_claims = db.collection('daily_claims').doc(dateStr).onSnapshot(snap => {
      cb(snap.exists ? snap.data() : {});
    });
  }
  async function setDailyClaim(dateStr, slot, name, lockedBy) {
    await db.collection('daily_claims').doc(dateStr).set(
      { [slot]: { name: name || "", lockedBy: lockedBy || "" } },
      { merge: true }
    );
  }
  async function clearDailyClaim(dateStr, slot) {
    await db.collection('daily_claims').doc(dateStr).set(
      { [slot]: { name: "", lockedBy: "" } },
      { merge: true }
    );
  }

  // ── HISTORY PURGE (30-day limit) ──
  async function purgeOldHistory() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const ts   = firebase.firestore.Timestamp.fromDate(cutoff);
    const snap = await db.collection('weekHistory').where('archivedAt', '<', ts).get();
    if (snap.empty) return 0;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    return snap.size;
  }

  // ── BIBLE PERMISSIONS ──
  async function getBiblePermissions() {
    const snap = await db.collection('config').doc('bible_permissions').get();
    return snap.exists ? snap.data() : {};
  }
  async function setBiblePermissions(data) {
    await db.collection('config').doc('bible_permissions').set(data);
  }

  // ── GAMES CONFIG ──
  async function getGamesConfig() {
    const snap = await db.collection('config').doc('games_config').get();
    return snap.exists ? snap.data() : null;
  }
  async function setGamesConfig(data) {
    await db.collection('config').doc('games_config').set(data, { merge: true });
  }

  // ── ADMIN SESSION VERSION (révocation forcée des sessions admin) ──
  // Lecture : tout admin (auth.js, au login + vérif périodique).
  // Écriture : réservée au super-admin côté règles (firestore.rules) —
  // ce n'est PAS ce module qui fait respecter la restriction.
  async function getAdminSessionVersion() {
    const snap = await db.collection('config').doc('adminSession').get();
    // 0 par défaut (pas 1) : cohérent avec FieldValue.increment(1) appliqué
    // à un champ absent (part de 0), pour que le tout premier
    // forceAdminLogout() sur un document inexistant (0 → 1) soit bien
    // détecté par les admins dont la version locale de référence est
    // encore ce même défaut.
    return snap.exists && typeof snap.data().version === 'number' ? snap.data().version : 0;
  }
  async function forceAdminLogout() {
    const ref = db.collection('config').doc('adminSession');
    await ref.set({ version: FV.increment(1) }, { merge: true });
    // Relit la valeur réelle après incrémentation : l'appelant (auth.js) en
    // a besoin pour que le super-admin adopte immédiatement la nouvelle
    // version et ne se déconnecte pas lui-même à sa propre action.
    const snap = await ref.get();
    return snap.exists && typeof snap.data().version === 'number' ? snap.data().version : 0;
  }

  // ── HOTEL CONFIG ──
  async function getHotelConfig() {
    const snap = await db.collection('config').doc('hotel_config').get();
    return snap.exists ? snap.data() : {};
  }
  async function saveHotelConfig(data) {
    await db.collection('config').doc('hotel_config').set(data, { merge: true });
  }
  // Bannière Hero de l'Accueil — même idiome que uploadPlanningImage (Storage
  // déjà utilisé pour le planning/les annonces, aucune nouvelle architecture).
  async function uploadHeroBanner(file) {
    if (!storage) throw new Error("Firebase Storage non disponible");
    const { uuid } = window.MX;
    const ref = storage.ref(`hero_banner/${uuid()}.jpg`);
    return await new Promise((resolve, reject) => {
      var done = false;
      var timer = setTimeout(function() {
        if (!done) { done = true; reject(new Error("Upload timeout")); }
      }, 60000);
      const task = ref.put(file, { contentType: "image/jpeg" });
      task.on('state_changed', null,
        err => { if (!done) { done = true; clearTimeout(timer); reject(err); } },
        async () => { if (!done) { done = true; clearTimeout(timer); resolve(await task.snapshot.ref.getDownloadURL()); } }
      );
    });
  }
  // Suppression best-effort d'une ancienne image de bannière — n'échoue
  // jamais bruyamment (blob orphelin non bloquant), seulement journalisé.
  async function deleteHeroBannerImage(url) {
    if (!storage || !url) return;
    try { await storage.refFromURL(url).delete(); }
    catch (e) { console.warn('[HeroBanner] Échec suppression ancienne image Storage (non bloquant) :', e); }
  }

  // ── VERSIONS ──
  async function getVersions() {
    const snap = await db.collection('config').doc('versions').get();
    return snap.exists ? snap.data() : null;
  }
  async function saveVersions(data) {
    await db.collection('config').doc('versions').set(data);
  }

  // ── MAINTENANCE ──
  function listenMaintenance(cb) {
    return db.collection('config').doc('maintenance')
      .onSnapshot(snap => cb(snap.exists ? snap.data() : null));
  }
  async function saveMaintenance(data) {
    await db.collection('config').doc('maintenance').set(data, { merge: true });
  }
  async function logDeploy(data) {
    await db.collection('config').doc('maintenance')
      .collection('deploy_log').add(Object.assign({ ts: FV.serverTimestamp() }, data));
  }
  function listenDeployLog(cb) {
    return db.collection('config').doc('maintenance')
      .collection('deploy_log')
      .orderBy('ts', 'desc').limit(30)
      .onSnapshot(snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }

  // ── VISIBILITÉ DES MODULES (Super Admin) ──
  // Doc config/navigation_visibility : { <itemId>: { tech: bool, responsable: bool } }.
  // Écriture réservée au Super Admin côté firestore.rules — voir
  // assets/js/pages/nav-visibility.js pour la page d'édition et
  // assets/js/app.js (buildNav) pour la consommation.
  function listenNavVisibility(cb) {
    return db.collection('config').doc('navigation_visibility')
      .onSnapshot(snap => cb(snap.exists ? snap.data() : null), () => cb(null));
  }
  async function saveNavVisibility(data, actor) {
    await db.collection('config').doc('navigation_visibility').set(
      Object.assign({}, data, { updatedAt: FV.serverTimestamp(), updatedBy: actor || '' }),
      { merge: true }
    );
  }

  // ── NOTIFICATIONS ──
  const R_NOTIFS = () => db.collection('notifications');

  function listenNotifications(cb) {
    if (_unsub.notifications) _unsub.notifications();
    _unsub.notifications = R_NOTIFS()
      .orderBy('createdAt', 'desc')
      .limit(150)
      .onSnapshot(snap => {
        cb(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(n => !n.archived));
      });
  }

  async function createNotification(data) {
    const { key, ...rest } = data;
    if (key) {
      const ref = R_NOTIFS().doc(key);
      const snap = await ref.get();
      if (snap.exists) return;
      await ref.set({ ...rest, read: false, archived: false, createdAt: FV.serverTimestamp() });
    } else {
      await R_NOTIFS().add({ ...rest, read: false, archived: false, createdAt: FV.serverTimestamp() });
    }
  }

  async function markNotificationRead(id) {
    await R_NOTIFS().doc(id).update({ read: true });
  }

  async function markAllNotificationsRead(userId) {
    const snap = await R_NOTIFS().where('read', '==', false).get();
    const toMark = snap.docs.filter(d => {
      const uid = d.data().userId;
      return uid === userId || uid === 'all';
    });
    if (!toMark.length) return;
    const batch = db.batch();
    toMark.forEach(d => batch.update(d.ref, { read: true }));
    await batch.commit();
  }

  async function deleteNotification(id) {
    await R_NOTIFS().doc(id).delete();
  }

  async function archiveNotification(id) {
    await R_NOTIFS().doc(id).update({ archived: true });
  }

  // ── BIBLE ARTICLES (one-time read for admin stats) ──
  async function getRecentBibleArticles() {
    const snap = await R_BIBLE_ART().orderBy('updatedAt', 'desc').limit(500).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // ── PLAYER MANAGEMENT ──
  async function adjustPlayerXP(userId, amount) {
    await R_RUSERS().doc(userId).set({ xp: FV.increment(amount), lastActivity: FV.serverTimestamp() }, { merge: true });
  }
  async function resetPlayerProfile(userId) {
    const [achSnap, hstSnap] = await Promise.all([
      R_GACHIEV().where('userId', '==', userId).get(),
      R_RHIST().where('userId', '==', userId).limit(500).get()
    ]);
    const batch = db.batch();
    achSnap.docs.forEach(d => batch.delete(d.ref));
    hstSnap.docs.forEach(d => batch.delete(d.ref));
    batch.set(R_RUSERS().doc(userId), { points: 0, xp: 0, lastActivity: FV.serverTimestamp() });
    await batch.commit();
  }

  // ── BADGES PROFESSIONNELS ──
  const R_BADGES     = () => db.collection('badges');
  const R_USR_BADGES = () => db.collection('user_badges');

  function listenBadges(cb) {
    _unsub.badges = R_BADGES().orderBy('priority').onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }

  function listenUserBadges(cb) {
    _unsub.user_badges = R_USR_BADGES().onSnapshot(snap => {
      const map = {};
      snap.docs.forEach(d => {
        const data = d.data();
        if (!map[data.userName]) map[data.userName] = [];
        map[data.userName].push({ id: d.id, ...data });
      });
      cb(map);
    });
  }

  async function addBadge(data)        { const ref = await R_BADGES().add(data); return ref.id; }
  async function updateBadge(id, data) { await R_BADGES().doc(id).update(data); }
  async function deleteBadge(id) {
    const batch = db.batch();
    const assigned = await R_USR_BADGES().where('badgeId', '==', id).get();
    assigned.docs.forEach(d => batch.delete(d.ref));
    batch.delete(R_BADGES().doc(id));
    await batch.commit();
  }

  async function assignBadge(badgeId, userName, badgeName, assignedBy) {
    const existing = await R_USR_BADGES().where('badgeId', '==', badgeId).where('userName', '==', userName).get();
    if (!existing.empty) return;
    await R_USR_BADGES().add({ badgeId, userName, badgeName, assignedBy, assignedAt: FV.serverTimestamp() });
  }

  async function removeUserBadge(userBadgeId) {
    await R_USR_BADGES().doc(userBadgeId).delete();
  }

  async function getUserBadges(userName) {
    const snap = await R_USR_BADGES().where('userName', '==', userName).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  const _DEFAULT_BADGES = [
    { name: 'Responsable',              icon: '👑', color: '#F59E0B', border: '#F59E0B', desc: 'Responsable d\'équipe',          mode: 'role',   active: true, priority: 1  },
    { name: 'Administrateur',           icon: '🛡',  color: '#3B82F6', border: '#3B82F6', desc: 'Administrateur système',         mode: 'role',   active: true, priority: 2  },
    { name: 'Contributeur Bible',       icon: '📖', color: '#10B981', border: '#10B981', desc: '50 documents contribués',        mode: 'auto',   active: true, priority: 3  },
    { name: 'Expert Documentation',     icon: '📚', color: '#6366F1', border: '#6366F1', desc: '200 documents contribués',       mode: 'auto',   active: true, priority: 4  },
    { name: 'Expert Chaufferie',        icon: '🔥', color: '#EF4444', border: '#EF4444', desc: 'Spécialiste chaufferie',         mode: 'manual', active: true, priority: 5  },
    { name: 'Expert Électricité',       icon: '⚡', color: '#F59E0B', border: '#F59E0B', desc: 'Spécialiste électricité',        mode: 'manual', active: true, priority: 6  },
    { name: 'Expert Plomberie',         icon: '🚿', color: '#0EA5E9', border: '#0EA5E9', desc: 'Spécialiste plomberie',          mode: 'manual', active: true, priority: 7  },
    { name: 'Expert Climatisation',     icon: '❄',  color: '#06B6D4', border: '#06B6D4', desc: 'Spécialiste climatisation',      mode: 'manual', active: true, priority: 8  },
    { name: 'Gestionnaire Stock',       icon: '📦', color: '#8B5CF6', border: '#8B5CF6', desc: 'Gestion des stocks',             mode: 'manual', active: true, priority: 9  },
    { name: 'Référent Hôtel',           icon: '🏨', color: '#D946EF', border: '#D946EF', desc: 'Référent établissement',         mode: 'manual', active: true, priority: 10 },
    { name: 'Technicien Polyvalent',    icon: '🔧', color: '#84CC16', border: '#84CC16', desc: '1000+ interventions terminées',  mode: 'auto',   active: true, priority: 11 },
    { name: 'Astreinte',                icon: '🚨', color: '#EF4444', border: '#EF4444', desc: 'Permanence d\'astreinte active', mode: 'manual', active: true, priority: 12 },
    { name: 'Formateur',                icon: '🎓', color: '#0EA5E9', border: '#0EA5E9', desc: 'Formateur d\'équipe',             mode: 'manual', active: true, priority: 13 },
    { name: 'Ancien de l\'établissement', icon: '🏅', color: '#F59E0B', border: '#F59E0B', desc: 'Ancienneté et expérience',    mode: 'manual', active: true, priority: 14 }
  ];

  async function initDefaultBadges() {
    const snap = await R_BADGES().limit(1).get();
    if (!snap.empty) return;
    const batch = db.batch();
    _DEFAULT_BADGES.forEach(b => batch.set(R_BADGES().doc(), b));
    await batch.commit();
  }

  // ── GESTION SEMAINE TECH — modèles par défaut ────────────────────────────
  // Les horaires historiques (Matin/Journée/Soir) sont conservés comme
  // données INITIALES du nouveau système de modèles, réutilisant les mêmes
  // libellés/émojis que MX.SLOTS et les mêmes tâches par défaut que MX.DEFT
  // (helpers.js) — aucun contenu inventé, uniquement porté dans la nouvelle
  // structure.
  //
  // Vérification INDIVIDUELLE par modèle standard (champ stable
  // isDefaultSeed, jamais par name) : un responsable qui renomme "Matin"
  // en autre chose, ou change son icône/couleur/horaire, ne doit jamais
  // provoquer la recréation d'un doublon — seul isDefaultSeed identifie
  // un modèle standard, name/icon/color/start/end restent librement
  // modifiables sans perdre ce statut. Ne crée QUE les modèles standards
  // manquants ; n'écrase jamais un modèle déjà présent.
  //
  // Résilience : une erreur Firestore ici (ex. règles pas encore
  // déployées) est journalisée via _fsError comme les autres listeners,
  // mais ne doit JAMAIS interrompre la suite de l'init() de app.js —
  // setupListeners() (tâches, utilisateurs, missions...) doit continuer
  // à s'exécuter même si ce seed échoue.
  async function initShiftTemplateDefaults() {
    const DEFT = (window.MX && window.MX.DEFT) || {};
    const mk = (text, i) => ({ id: uuid(), text, order: i });
    const defaults = [
      { isDefaultSeed: 'matin',   name: 'Matin',   icon: '☀️', color: '#FDE047', start: '08:00', end: '16:33', active: true, order: 0, tasks: (DEFT.matin   || []).map(mk) },
      { isDefaultSeed: 'journee', name: 'Journée', icon: '🌤',  color: '#3B82F6', start: '10:00', end: '18:33', active: true, order: 1, tasks: (DEFT.journee || []).map(mk) },
      { isDefaultSeed: 'soir',    name: 'Soir',    icon: '🌙', color: '#EF4444', start: '13:00', end: '21:33', active: true, order: 2, tasks: (DEFT.soir    || []).map(mk) },
    ];
    try {
      const snap = await R_SHIFT_TPL().get();
      const existingSeeds = new Set(snap.docs.map(d => d.data().isDefaultSeed).filter(Boolean));
      const missing = defaults.filter(t => !existingSeeds.has(t.isDefaultSeed));
      if (!missing.length) return;
      const batch = db.batch();
      missing.forEach(t => batch.set(R_SHIFT_TPL().doc(), Object.assign({}, t, { createdAt: FV.serverTimestamp() })));
      await batch.commit();
    } catch (e) {
      _fsError('shift_templates')(e);
    }
  }

  // ── ROLES (MÉTIERS) ──
  const R_ROLES = () => db.collection('roles');

  function listenRoles(cb) {
    return R_ROLES().orderBy('order').onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }

  async function addRole(data) {
    const { id: specId, ...rest } = data;
    const payload = { ...rest, createdAt: FV.serverTimestamp() };
    if (specId) {
      const ref  = R_ROLES().doc(specId);
      const snap = await ref.get();
      if (!snap.exists) await ref.set(payload);
      return specId;
    }
    const ref = await R_ROLES().add(payload);
    return ref.id;
  }

  async function updateRole(id, data) { await R_ROLES().doc(id).update(data); }
  async function deleteRole(id)       { await R_ROLES().doc(id).delete(); }

  // ── ALERT RULES (custom alert conditions) ──
  const R_ALERT_RULES = () => db.collection('alert_rules');
  const R_TRIG        = () => db.collection('triggered_alerts');

  function listenAlertRules(cb) {
    console.log('[DB] listenAlertRules: attaching snapshot listener on alert_rules');
    return R_ALERT_RULES().onSnapshot(snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      console.log('[DB] listenAlertRules: snapshot received,', list.length, 'alert(s)', list);
      cb(list);
    }, err => {
      console.error('[DB] listenAlertRules: snapshot error', err);
    });
  }

  async function addAlertRule(data) {
    console.log('[DB] addAlertRule: saving rule', data);
    const ref = await R_ALERT_RULES().add({ ...data, createdAt: FV.serverTimestamp() });
    console.log('[DB] addAlertRule: saved with id', ref.id);
    return ref.id;
  }

  async function updateAlertRule(id, data) { await R_ALERT_RULES().doc(id).update(data); }
  async function deleteAlertRule(id)        { await R_ALERT_RULES().doc(id).delete(); }

  function listenTriggeredAlerts(dateKey, cb) {
    return R_TRIG().where('dateKey', '==', dateKey).orderBy('ts', 'desc').onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, _fsError('triggered_alerts'));
  }

  // One stable document per rule per day (doc id = `${ruleId}_${dateKey}`) — a rule
  // re-firing within its cooldown window updates the SAME document instead of
  // creating a new one, so a recurring condition never piles up duplicate alerts.
  async function createTriggeredAlert(data) {
    const key = `${data.ruleId}_${data.dateKey}`;
    return R_TRIG().doc(key).set({ ...data, status: 'active', ts: FV.serverTimestamp() }, { merge: true });
  }

  async function resolveTriggeredAlert(ruleId, dateKey) {
    const key = `${ruleId}_${dateKey}`;
    await R_TRIG().doc(key).update({ status: 'resolved', resolvedAt: FV.serverTimestamp() }).catch(() => {});
  }

  async function acknowledgeAlert(id) {
    await R_TRIG().doc(id).update({ acknowledged: true });
  }

  async function clearTodayAlerts(dateKey) {
    const snap  = await R_TRIG().where('dateKey', '==', dateKey).get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    return batch.commit();
  }

  // ── CSO ENERGY ALERTS (meter overconsumption — cso_energy_alerts) ──
  // Exposed globally (not just inside consommations.js) so the dashboard and
  // notification center can show these alerts even if nobody opened the
  // Compteurs & Relevés page this session.
  const R_CSO_ALERTS = () => db.collection('cso_energy_alerts');
  function listenCsoAlerts(cb) {
    return R_CSO_ALERTS().orderBy('ts', 'desc').limit(200).onSnapshot(snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, _fsError('cso_energy_alerts'));
  }

  // ── WEEKLY CHECKS (historical archive per week) ──
  const R_WC = () => db.collection('weekly_checks');

  async function getWeeklyChecks(weekKey) {
    const snap = await R_WC().doc(weekKey).get();
    return snap.exists ? snap.data() : null;
  }

  async function saveWeeklyChecks(weekKey, data) {
    await R_WC().doc(weekKey).set({ ...data, savedAt: FV.serverTimestamp() });
  }

  async function deleteWeeklyChecks(weekKey) {
    await R_WC().doc(weekKey).delete();
  }

  async function updateWeeklyTasks(weekKey, dayId, slot, items) {
    await R_WC().doc(weekKey).update({ [`tasks.${dayId}_${slot}`]: items });
  }

  async function promoteWeeklyToActive(tasksData) {
    const batch = db.batch();
    Object.entries(tasksData).forEach(([key, items]) => {
      batch.set(db.collection('tasks').doc(key), { items });
    });
    batch.set(db.collection('config').doc('checks'), {});
    batch.set(db.collection('config').doc('assignments'), {});
    await batch.commit();
  }

  // ── EXPORT ──
  window.MX = window.MX || {};
  window.MX.DB = {
    initDefaults, unsubAll,
    listenWeek, listenTeams, listenAlerts, listenAssignments,
    listenChecks, listenTasks, listenAllTasks, listenProducts, listenMessages,
    listenUsers, listenLogs, listenTransfers, listenMissions,
    listenNotes, listenHistory,
    setCheck, setAssignment, setTasks,
    saveAlerts, resetChecks, newWeek,
    addProduct, updateProduct, deleteProduct,
    uploadMessageImage, sendMessage, deleteMessage,
    listenPlanning, uploadPlanningImage, savePlanning, clearPlanning,
    addUser, updateUser, updateUserPlanningOrder, deleteUser,
    addLog, clearLogs,
    createTransfer, updateTransfer, cancelTransfer,
    addMission, updateMission, deleteMission,
    listenRespTasks, addRespTask, updateRespTask, deleteRespTask,
    listenAnnouncements, sendAnnouncement, deleteAnnouncement,
    togglePin, toggleReaction, markReadAnnouncement,
    listenReplies, sendReply, deleteReply,
    setNote, archiveWeek,
    saveFcmToken, deleteFcmToken,
    updatePresence, listenPresence,
    listenOrders, addOrder, updateOrderStatus, deleteOrder,
    listenStockChecks, createStockCheck, saveStockCheckDraft, cancelStockCheck,
    commitStockCheck, getStockCheckItems,
    listenPlanningShifts, loadPlanningMonth, listenPlanningEntries, setPlanningEntry, deletePlanningEntry, savePlanningShifts,
    listenShiftTemplates, addShiftTemplate, updateShiftTemplate, deleteShiftTemplate, duplicateShiftTemplate, initShiftTemplateDefaults,
    listenWeekSlots, getWeekSlots, ensureWeekSlots, loadTemplateIntoWeekDay,
    setWeekSlotAssignee, setWeekSlotTaskDone, deleteWeekSlotInstance, copyWeekSlots,
    moveWeekSlotTask, restoreWeekSlotTask, resetWeekSlotDayMoves,
    listenAbsences, addAbsence, validateAbsence, deleteAbsence,
    listenBibleArticles, addBibleArticle, updateBibleArticle, deleteBibleArticle,
    incrementBibleViews, toggleBibleLike,
    listenBibleComments, addBibleComment, deleteBibleComment,
    listenBibleCategories, addBibleCategory, updateBibleCategory, deleteBibleCategory,
    countBibleCategoryArticles, moveBibleCategoryArticles,
    listenAdminJournal, addAdminJournal, clearAdminJournal,
    listenDailyClaims, setDailyClaim, clearDailyClaim,
    purgeOldHistory,
    getBiblePermissions, setBiblePermissions,
    getAdminSessionVersion, forceAdminLogout,
    getHotelConfig, saveHotelConfig, uploadHeroBanner, deleteHeroBannerImage,
    getVersions, saveVersions,
    listenMaintenance, saveMaintenance, logDeploy, listenDeployLog,
    listenNavVisibility, saveNavVisibility,
    getRecentBibleArticles,
    listenBadges, listenUserBadges,
    addBadge, updateBadge, deleteBadge,
    assignBadge, removeUserBadge, getUserBadges,
    initDefaultBadges,
    listenNotifications, createNotification,
    markNotificationRead, markAllNotificationsRead,
    deleteNotification, archiveNotification,
    listenRoles, addRole, updateRole, deleteRole,
    listenAlertRules, addAlertRule, updateAlertRule, deleteAlertRule,
    listenTriggeredAlerts, createTriggeredAlert, resolveTriggeredAlert, acknowledgeAlert, clearTodayAlerts,
    listenCsoAlerts,
    getWeeklyChecks, saveWeeklyChecks, deleteWeeklyChecks, updateWeeklyTasks, promoteWeeklyToActive,
  };
})();
