(function () {
  const { DAYS, DEFT, mkWeekLabel, uuid } = window.MX;

  // ── FIRESTORE REFS ──
  const R = {
    week:        () => db.collection("config").doc("week"),
    teams:       () => db.collection("config").doc("teams"),
    alerts:      () => db.collection("config").doc("alerts"),
    assignments: () => db.collection("config").doc("assignments"),
    checks:      () => db.collection("config").doc("checks"),
    tasks:  (key) => db.collection("tasks").doc(key),   // key = "lundi_matin"
    products:    () => db.collection("products"),
    messages:    () => db.collection("messages")
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

      // Init default tasks for each day/slot
      const taskBatch = db.batch();
      DAYS.forEach(day => {
        const slots = day.we ? ["soir"] : ["matin", "journee", "soir"];
        slots.forEach(sl => {
          const items = DEFT[sl].map((text, i) => ({ id: uuid(), text, order: i }));
          taskBatch.set(R.tasks(`${day.id}_${sl}`), { items });
        });
      });

      // Default products
      const prods = [
        { name: "Ampoule E27",   ref: "REF-AMP-E27",  qty: 8,  minQty: 10, controller: "" },
        { name: "Gants latex M", ref: "REF-GANT-M",   qty: 25, minQty: 10, controller: "" },
        { name: "Papier A4",     ref: "REF-PAP-A4",   qty: 3,  minQty: 5,  controller: "" },
        { name: "Désinfectant",  ref: "REF-DES-1L",   qty: 7,  minQty: 4,  controller: "" }
      ];
      prods.forEach(p => { taskBatch.set(R.products().doc(), p); });

      // Welcome message
      taskBatch.set(R.messages().doc(), {
        author: "Admin",
        title:  "Bienvenue sur Maintix",
        body:   "Plateforme de gestion et maintenance. Consultez les onglets pour vos checklists.",
        imageUrl: "", ts: firebase.firestore.FieldValue.serverTimestamp()
      });

      await taskBatch.commit();
    }
  }

  // ── REAL-TIME LISTENERS ──
  function listenWeek(cb) {
    _unsub.week = R.week().onSnapshot(snap => {
      if (snap.exists) cb(snap.data());
    });
  }
  function listenTeams(cb) {
    _unsub.teams = R.teams().onSnapshot(snap => {
      if (snap.exists) cb(snap.data());
    });
  }
  function listenAlerts(cb) {
    _unsub.alerts = R.alerts().onSnapshot(snap => {
      if (snap.exists) cb(snap.data());
    });
  }
  function listenAssignments(cb) {
    _unsub.assignments = R.assignments().onSnapshot(snap => {
      if (snap.exists) cb(snap.data());
    });
  }
  function listenChecks(cb) {
    _unsub.checks = R.checks().onSnapshot(snap => {
      cb(snap.exists ? snap.data() : {});
    });
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
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      cb(list);
    });
  }
  function listenMessages(cb) {
    _unsub.messages = R.messages().orderBy("ts", "desc").limit(50).onSnapshot(snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      cb(list);
    });
  }

  // ── WRITES ──
  async function setCheck(taskKey, done) {
    await R.checks().update({ [taskKey]: done });
  }
  async function setAssignment(dayId, slot, name) {
    await R.assignments().update({ [`${dayId}_${slot}`]: name });
  }
  async function setTasks(dayId, slot, items) {
    await R.tasks(`${dayId}_${slot}`).set({ items });
  }
  async function saveTeams(data)      { await R.teams().set(data); }
  async function saveAlerts(data)     { await R.alerts().set(data); }
  async function resetChecks()        { await R.checks().set({}); }
  async function newWeek(label, num)  { await R.week().set({ label, num }); await resetChecks(); }

  // Products
  async function addProduct(p)        { await R.products().add(p); }
  async function updateProduct(id, p) { await R.products().doc(id).update(p); }
  async function deleteProduct(id)    { await R.products().doc(id).delete(); }

  // Messages
  async function sendMessage(data)    { await R.messages().add({ author: data.author, title: data.title, body: data.body, ts: firebase.firestore.FieldValue.serverTimestamp() }); }
  async function deleteMessage(id)    { await R.messages().doc(id).delete(); }

  // ── EXPORT ──
  window.MX = window.MX || {};
  window.MX.DB = {
    initDefaults, unsubAll,
    listenWeek, listenTeams, listenAlerts, listenAssignments,
    listenChecks, listenTasks, listenAllTasks, listenProducts, listenMessages,
    setCheck, setAssignment, setTasks,
    saveTeams, saveAlerts, resetChecks, newWeek,
    addProduct, updateProduct, deleteProduct,
    sendMessage, deleteMessage
  };
})();
