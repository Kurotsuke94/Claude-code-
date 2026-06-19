(function () {
  const { DAYS, DEFT, mkWeekLabel, uuid } = window.MX;

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
  async function saveTeams(data)      { await R.teams().set(data); }
  async function saveAlerts(data)     { await R.alerts().set(data); }
  async function resetChecks()        { await R.checks().set({}); }
  async function newWeek(label, num)  { await R.week().set({ label, num }); await resetChecks(); }

  async function addProduct(p)        { await R.products().add(p); }
  async function updateProduct(id, p) { await R.products().doc(id).update(p); }
  async function deleteProduct(id)    { await R.products().doc(id).delete(); }

  async function uploadMessageImage(file) {
    if (!storage) throw new Error("Firebase Storage non disponible");
    const ext  = (file.name || "photo.jpg").split('.').pop().replace(/[^a-z0-9]/g, '') || "jpg";
    const path = `messages/${uuid()}.jpg`;
    const ref  = storage.ref(path);
    return await new Promise((resolve, reject) => {
      var done = false;
      var timer = setTimeout(function() {
        if (!done) { done = true; reject(new Error("Upload timeout — connexion trop lente")); }
      }, 30000);

      const task = ref.put(file, { contentType: "image/jpeg" });
      task.on('state_changed',
        snap => {
          const pct = Math.round(snap.bytesTransferred / snap.totalBytes * 100) || 0;
          const btn = document.querySelector(".compose .primary-btn");
          if (btn) btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Upload ${pct}%`;
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

  async function addUser(data)        { await R.users().add(data); }
  async function updateUser(id, data) { await R.users().doc(id).update(data); }
  async function deleteUser(id)       { await R.users().doc(id).delete(); }

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

  async function saveFcmToken(token, userName) {
    await db.collection("fcmTokens").doc(token).set({ token, userName: userName || "", ts: firebase.firestore.FieldValue.serverTimestamp() });
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
  async function sendAnnouncement({ type, content, authorName, authorRole }) {
    await R_ANN().add({
      type, content, authorName, authorRole,
      createdAt: FV.serverTimestamp(),
      pinned: false,
      reactions: { '👍': [], '✅': [], '⚠️': [] },
      readBy: [authorName],
      replyCount: 0
    });
  }
  async function deleteAnnouncement(id) {
    const batch = db.batch();
    const replies = await R_ANN().doc(id).collection('replies').get();
    replies.docs.forEach(d => batch.delete(d.ref));
    batch.delete(R_ANN().doc(id));
    await batch.commit();
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

  // ── EXPORT ──
  window.MX = window.MX || {};
  window.MX.DB = {
    initDefaults, unsubAll,
    listenWeek, listenTeams, listenAlerts, listenAssignments,
    listenChecks, listenTasks, listenAllTasks, listenProducts, listenMessages,
    listenUsers, listenLogs, listenTransfers, listenMissions,
    listenNotes, listenHistory,
    setCheck, setAssignment, setTasks,
    saveTeams, saveAlerts, resetChecks, newWeek,
    addProduct, updateProduct, deleteProduct,
    uploadMessageImage, sendMessage, deleteMessage,
    listenPlanning, uploadPlanningImage, savePlanning, clearPlanning,
    addUser, updateUser, deleteUser,
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
    listenOrders, addOrder, updateOrderStatus
  };
})();
