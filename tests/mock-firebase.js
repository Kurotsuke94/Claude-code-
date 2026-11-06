// Mock Firebase (compat v8 shape) injecté AVANT tout script de la page,
// pour vérifier la page Stock dans un vrai navigateur SANS jamais toucher
// au projet Firebase réel (maintix-c9dbd). Aucune requête réseau vers
// Firebase n'est faite : tout est simulé en mémoire dans l'onglet.
(function () {
  function normVal(v) { return (v && typeof v === 'object' && 'seconds' in v) ? v.seconds : v; }
  function matchOp(a, op, v) {
    switch (op) {
      case '==': return a === v;
      case '!=': return a !== v;
      case '>=': return a >= v;
      case '<=': return a <= v;
      case '>':  return a > v;
      case '<':  return a < v;
      case 'array-contains': return Array.isArray(a) && a.indexOf(v) !== -1;
      case 'in': return Array.isArray(v) && v.indexOf(a) !== -1;
      case 'not-in': return Array.isArray(v) && v.indexOf(a) === -1;
      case 'array-contains-any': return Array.isArray(a) && Array.isArray(v) && a.some(function (x) { return v.indexOf(x) !== -1; });
      default: return true;
    }
  }
  function stamp(data, existing) {
    var out = {};
    Object.keys(data || {}).forEach(function (k) {
      var v = data[k];
      if (v && v.__sv === 'timestamp') out[k] = { seconds: Date.now() / 1000, toDate: function () { return new Date(); } };
      else if (v && typeof v === 'object' && '__inc' in v) out[k] = ((existing && typeof existing[k] === 'number') ? existing[k] : 0) + v.__inc;
      else out[k] = v;
    });
    return out;
  }

  function makeFirestoreMock() {
    var store = {};     // "coll/doc/sub" -> { id: data }
    var listeners = {}; // path -> [{cb,q}]

    var docListeners = {}; // "coll/doc" -> [cb]
    function ensureColl(path) { var k = path.join('/'); if (!store[k]) store[k] = {}; return store[k]; }
    window.__fireLog = window.__fireLog || [];
    function fire(path) {
      var k = path.join('/');
      window.__fireLog.push(k + ':' + ((listeners[k] || []).length));
      (listeners[k] || []).slice().forEach(function (entry) { entry.cb(makeSnapshot(path, entry.q)); });
    }
    function fireDoc(path, id) {
      var k = path.concat([id]).join('/');
      var coll = ensureColl(path);
      (docListeners[k] || []).slice().forEach(function (cb) { cb({ id: id, exists: !!coll[id], data: function () { return coll[id]; } }); });
    }
    function applyQuery(docs, q) {
      var out = docs;
      (q.wheres || []).forEach(function (w) { out = out.filter(function (d) { return matchOp(d.data[w[0]], w[1], w[2]); }); });
      if (q.orderField) {
        out = out.slice().sort(function (a, b) {
          var av = normVal(a.data[q.orderField]), bv = normVal(b.data[q.orderField]);
          var c = av < bv ? -1 : av > bv ? 1 : 0;
          return q.orderDir === 'desc' ? -c : c;
        });
      }
      if (q.limitN) out = out.slice(0, q.limitN);
      return out;
    }
    function makeSnapshot(path, q) {
      var coll = ensureColl(path);
      var docs = Object.keys(coll).map(function (id) { return { id: id, data: coll[id] }; });
      docs = applyQuery(docs, q || {});
      return {
        docs: docs.map(function (d) { return { id: d.id, data: function () { return d.data; } }; }),
        size: docs.length, empty: docs.length === 0, docChanges: function () { return []; }
      };
    }
    function makeQuery(path, q) {
      q = q || { wheres: [] };
      return {
        where:   function (f, op, v) { return makeQuery(path, Object.assign({}, q, { wheres: (q.wheres || []).concat([[f, op, v]]) })); },
        orderBy: function (f, dir)   { return makeQuery(path, Object.assign({}, q, { orderField: f, orderDir: dir || 'asc' })); },
        limit:   function (n)        { return makeQuery(path, Object.assign({}, q, { limitN: n })); },
        get:     function ()         { return _deniedColl(path) ? Promise.reject(_denyErr()) : Promise.resolve(makeSnapshot(path, q)); },
        // onError (2e paramètre, optionnel) : enregistré avec le listener pour
        // pouvoir être déclenché depuis un test via
        // firebase.firestore().triggerSnapshotError(collName) — simule une
        // VRAIE erreur de snapshot (ex. permission-denied), jamais une simple
        // réponse météo/donnée invalide, voir tests/cta_vc_test.js.
        onSnapshot: function (cb, onError) {
          var k = path.join('/');
          listeners[k] = listeners[k] || [];
          var entry = { cb: cb, q: q, onError: onError };
          listeners[k].push(entry);
          setTimeout(function () { cb(makeSnapshot(path, q)); }, 0);
          return function () { var i = listeners[k].indexOf(entry); if (i >= 0) listeners[k].splice(i, 1); };
        },
        doc: function (id) { return makeDocRef(path, id || ('auto_' + Math.random().toString(36).slice(2))); },
        add: function (data) {
          var id = 'auto_' + Math.random().toString(36).slice(2);
          ensureColl(path)[id] = stamp(data);
          fire(path);
          return Promise.resolve(makeDocRef(path, id));
        },
      };
    }
    // Simule UNIQUEMENT les règles firestore.rules "config/adminSession" et
    // "config/navigation_visibility" (écriture réservée au super-admin) —
    // pas un moteur de règles générique, seulement ces documents précis,
    // pour que les tests d'admin normal rejeté reflètent fidèlement la
    // vraie contrainte serveur (voir firestore.rules).
    var SUPER_ADMIN_EMAIL_MOCK = 'keyzeur94460@hotmail.fr';
    var SUPER_ADMIN_ONLY_DOCS = { adminSession: true, navigation_visibility: true };
    // Simule un refus firestore.rules générique sur une collection entière
    // (ex. un test qui veut reproduire "shift_templates sans règle" sans
    // dépendre d'un vrai moteur de règles). Piloté depuis le test via
    // window.__mockDenyColl = {shift_templates: true} — n'affecte rien
    // d'autre que les collections explicitement listées. Couvre set(),
    // update() ET delete() (une vraie règle "deny" bloque toute écriture,
    // pas seulement set()).
    function _deniedColl(path) {
      var deny = window.__mockDenyColl || {};
      return path.length >= 1 && !!deny[path[0]];
    }
    function _denyErr() {
      var err = new Error('Missing or insufficient permissions.');
      err.code = 'permission-denied';
      return err;
    }
    function _checkAdminSessionWriteAllowed(path, id) {
      if (path.length === 1 && path[0] === 'config' && SUPER_ADMIN_ONLY_DOCS[id]) {
        var u = window.__mockAuth && window.__mockAuth.currentUser;
        if (!u || u.isAnonymous || u.email !== SUPER_ADMIN_EMAIL_MOCK) {
          var err = new Error('Missing or insufficient permissions.');
          err.code = 'permission-denied';
          return Promise.reject(err);
        }
      }
      return null; // autorisé
    }
    // Fidèle au vrai SDK Firestore : set(data, {merge:true}) fusionne les
    // champs de type "map" en PROFONDEUR (récursivement), pas seulement au
    // premier niveau — sinon écrire days.mardi effacerait days.lundi. Les
    // tableaux et les valeurs atomiques (Timestamp-like) sont toujours
    // remplacés intégralement, jamais fusionnés élément par élément.
    function _isPlainObj(v) {
      return !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.toDate !== 'function';
    }
    function _deepMerge(target, source) {
      var out = Object.assign({}, target);
      Object.keys(source).forEach(function (k) {
        out[k] = (_isPlainObj(source[k]) && _isPlainObj(target[k])) ? _deepMerge(target[k], source[k]) : source[k];
      });
      return out;
    }
    function makeDocRef(path, id) {
      var full = path.concat([id]);
      return {
        id: id,
        get: function () { var c = ensureColl(path); return Promise.resolve({ id: id, exists: !!c[id], data: function () { return c[id]; } }); },
        set: function (data, opts) {
          if (_deniedColl(path)) return Promise.reject(_denyErr());
          var denied = _checkAdminSessionWriteAllowed(path, id);
          if (denied) return denied;
          var c = ensureColl(path);
          var existing = c[id] || {};
          c[id] = (opts && opts.merge) ? _deepMerge(existing, stamp(data, existing)) : stamp(data, existing);
          fire(path); fireDoc(path, id);
          return Promise.resolve();
        },
        update: function (data) {
          if (_deniedColl(path)) return Promise.reject(_denyErr());
          var c = ensureColl(path);
          var cur = Object.assign({}, c[id] || {});
          Object.keys(data).forEach(function (k) {
            if (data[k] && data[k].__del) delete cur[k];
            else cur[k] = stamp({ x: data[k] }, { x: cur[k] }).x;
          });
          c[id] = cur;
          fire(path); fireDoc(path, id);
          return Promise.resolve();
        },
        delete: function () {
          if (_deniedColl(path)) return Promise.reject(_denyErr());
          var c = ensureColl(path); delete c[id]; fire(path); fireDoc(path, id); return Promise.resolve();
        },
        onSnapshot: function (cb) {
          var k = full.join('/');
          docListeners[k] = docListeners[k] || [];
          docListeners[k].push(cb);
          var c = ensureColl(path);
          setTimeout(function () { cb({ id: id, exists: !!c[id], data: function () { return c[id]; } }); }, 0);
          return function () { var i = docListeners[k].indexOf(cb); if (i >= 0) docListeners[k].splice(i, 1); };
        },
        collection: function (name) { return makeQuery(full.concat([name])); },
      };
    }
    return {
      collection: function (name) { return makeQuery([name]); },
      batch: function () {
        var ops = [];
        return {
          set:    function (ref, data, opts) { ops.push(function () { return ref.set(data, opts); }); },
          update: function (ref, data)       { ops.push(function () { return ref.update(data); }); },
          delete: function (ref)             { ops.push(function () { return ref.delete(); }); },
          commit: function () { return ops.reduce(function (p, fn) { return p.then(fn); }, Promise.resolve()); }
        };
      },
      // runTransaction — simulation MINIMALE, SÉQUENTIELLE, pour pouvoir
      // exercer le code qui utilise db.runTransaction() (ex. db.js:
      // applyWeekTemplateToWeek). Reproduit :
      //   • lectures via transaction.get(ref) — COPIE profonde des données
      //     (comme le vrai SDK : modifier l'objet lu ne modifie jamais le
      //     store) ;
      //   • règle du vrai SDK : toutes les lectures AVANT toute écriture ;
      //   • écritures (set/update/delete) MISES EN ATTENTE, appliquées
      //     seulement si la fonction réussit ; si elle échoue, AUCUNE
      //     écriture n'est appliquée.
      // NE SIMULE PAS : les conflits concurrents, les nouvelles tentatives
      // automatiques, ni l'isolation entre plusieurs clients. Un test qui
      // passe avec ce mock NE PROUVE PAS la sécurité face aux écritures
      // concurrentes — seule la conception (relecture dans la transaction)
      // y répond, sur le vrai Firestore.
      // window.__mockTxLog : compteurs pour vérifier depuis un test qu'une
      // transaction a bien été utilisée (commits / annulations).
      runTransaction: function (fn) {
        window.__mockTxLog = window.__mockTxLog || { started: 0, committed: 0, aborted: 0 };
        window.__mockTxLog.started++;
        var pending = [];
        var tx = {
          get: function (ref) {
            if (pending.length) {
              return Promise.reject(new Error('Firestore transactions require all reads to be executed before all writes.'));
            }
            return ref.get().then(function (snap) {
              var copy = snap.exists ? JSON.parse(JSON.stringify(snap.data())) : undefined;
              return { id: snap.id, exists: snap.exists, data: function () { return copy; } };
            });
          },
          set:    function (ref, data, opts) { pending.push(function () { return ref.set(data, opts); }); return tx; },
          update: function (ref, data)       { pending.push(function () { return ref.update(data); }); return tx; },
          delete: function (ref)             { pending.push(function () { return ref.delete(); }); return tx; },
        };
        return Promise.resolve()
          .then(function () { return fn(tx); })
          .then(function (result) {
            return pending.reduce(function (p, w) { return p.then(w); }, Promise.resolve()).then(function () {
              window.__mockTxLog.committed++;
              return result;
            });
          }, function (err) {
            window.__mockTxLog.aborted++;
            throw err;
          });
      },
      _debugStore: store,
      _debugListeners: listeners,
      // triggerSnapshotError(collName, err) — simule une VRAIE erreur de
      // snapshot Firestore (ex. permission-denied) sur une collection de
      // premier niveau, pour les listeners actuellement actifs. Fidèle au
      // comportement réel du SDK Firestore : un onSnapshot qui reçoit une
      // erreur est détaché définitivement (jamais de redémarrage automatique
      // tout seul) — les entrées sont donc retirées de `listeners[k]` ici
      // aussi, pas seulement notifiées.
      triggerSnapshotError: function (collName, err) {
        var k = collName;
        var entries = (listeners[k] || []).slice();
        listeners[k] = [];
        var e = err || (function () { var x = new Error('Missing or insufficient permissions.'); x.code = 'permission-denied'; return x; })();
        entries.forEach(function (entry) { if (entry.onError) entry.onError(e); });
      },
    };
  }

  // ── Persistance simulée (LOCAL par défaut, comme le vrai SDK) ──
  // LOCAL  -> localStorage   (survit à un F5 ET à une fermeture/réouverture
  //           complète du navigateur, si storageState est réutilisé entre
  //           deux BrowserContext Playwright)
  // SESSION -> sessionStorage (survit à un F5 dans le MÊME BrowserContext,
  //           mais jamais transféré à un nouveau BrowserContext — Playwright
  //           ne propage jamais sessionStorage entre contextes, exactement
  //           comme un vrai navigateur fermé/rouvert)
  var _persistMode = 'local';
  var AUTH_KEY = '__mock_auth_user';
  function _authStore() { return _persistMode === 'session' ? sessionStorage : localStorage; }
  function _saveAuthUser() {
    try {
      if (_authUser) _authStore().setItem(AUTH_KEY, JSON.stringify(_authUser));
      else _authStore().removeItem(AUTH_KEY);
    } catch (e) {}
  }
  function _loadAuthUser() {
    // Le mode de persistance courant est prioritaire ; on retombe sur
    // l'autre stockage pour rester tolérant à l'ordre d'appel réel de
    // setPersistence() par rapport au chargement du mock.
    try {
      var s = sessionStorage.getItem(AUTH_KEY);
      if (s) return JSON.parse(s);
    } catch (e) {}
    try {
      var l = localStorage.getItem(AUTH_KEY);
      if (l) return JSON.parse(l);
    } catch (e) {}
    return null;
  }
  // getIdTokenResult(), lu par auth.js (onAuthStateChanged) pour distinguer
  // Admin ('password')/anonyme ('anonymous')/PIN custom token ('custom') —
  // voir la migration custom claims. Les données JSON (provider/claims) sont
  // sérialisables (survivent à _saveAuthUser/_loadAuthUser via
  // localStorage/sessionStorage) ; la méthode elle-même est ré-attachée
  // après chaque restauration, puisque les fonctions ne survivent pas à
  // JSON.stringify/parse.
  function _attachTokenResult(u) {
    if (!u) return u;
    var provider = u.__provider || (u.isAnonymous ? 'anonymous' : 'password');
    var claims   = u.__claims || {};
    u.getIdTokenResult = function () {
      return Promise.resolve({ claims: Object.assign({ firebase: { sign_in_provider: provider } }, claims) });
    };
    return u;
  }

  // ── Cloud Functions mock (verifyPin) ──
  // Reproduit la logique SERVEUR réelle de functions/index.js:verifyPin
  // (lecture du hash stocké dans le mock Firestore users/{id}, comparaison
  // SHA-256 via crypto.subtle — disponible nativement dans le vrai
  // navigateur piloté par Playwright) pour que confirmPin() (assets/js/
  // auth.js) puisse être exercé de bout en bout par les tests existants
  // SANS jamais toucher un vrai projet Firebase. Le "token" renvoyé n'est
  // jamais un vrai JWT : juste un sachet JSON que signInWithCustomToken()
  // ci-dessous sait décoder, suffisant pour vérifier le FLUX client (appel
  // verifyPin -> signInWithCustomToken -> rôle reflété dans le jeton) — pas
  // pour valider la sécurité serveur elle-même (voir
  // tests/firestore_rules_cta_vc_claims_test.js, seul test faisant foi pour
  // cela, contre un véritable émulateur de règles).
  function _sha256HexMock(str) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str))).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }
  function _normalizeRoleMock(userDoc) {
    return (userDoc.rank === 'responsable' || userDoc.role === 'responsable') ? 'responsable' : 'technicien';
  }
  function _mockVerifyPin(data) {
    var userId = data && data.userId, pin = data && data.pin;
    // Même séparation que la vraie Cloud Function (functions/index.js:
    // verifyPin) : le rôle vient de users/{id}, le hash de
    // users_private/{id} (non lisible par le client en réalité — voir
    // firestore.rules.draft-claims-migration — mais le mock n'a pas besoin
    // de simuler ce blocage de lecture : il reproduit seulement la SOURCE
    // de données réelle, pas les règles elles-mêmes, voir
    // tests/firestore_rules_cta_vc_claims_test.js pour la preuve contre un
    // véritable moteur de règles).
    var store = (window.__mockDb && window.__mockDb._debugStore) || {};
    var userDoc = (store['users'] || {})[userId] || null;
    var privateDoc = (store['users_private'] || {})[userId] || null;
    return _sha256HexMock(pin).then(function (enteredHash) {
      var storedPin = privateDoc ? String(privateDoc.pin || '') : '';
      var match;
      if (/^[0-9a-f]{64}$/.test(storedPin)) match = !!userDoc && enteredHash === storedPin;
      else match = !!userDoc && pin === storedPin;
      if (!match) {
        var err = new Error('PIN incorrect.');
        err.code = 'functions/permission-denied';
        throw err;
      }
      var role = _normalizeRoleMock(userDoc);
      var claims = { role: role, userId: userId };
      if (userDoc.roleId) claims.roleId = userDoc.roleId;
      return { data: { token: 'mock-custom-token:' + JSON.stringify(claims) } };
    });
  }
  function functionsFn() {
    return {
      httpsCallable: function (name) {
        return function (data) {
          if (name !== 'verifyPin') return Promise.reject(new Error('mock: fonction callable inconnue ' + name));
          return _mockVerifyPin(data);
        };
      },
    };
  }

  var _authUser = _attachTokenResult(_loadAuthUser());
  var _authCbs = [];
  function fireAuth() { _authCbs.forEach(function (cb) { cb(_authUser); }); }
  var authMock = {
    get currentUser() { return _authUser; },
    setPersistence: function (mode) {
      _persistMode = (mode === 'session' || mode === 'SESSION') ? 'session' : 'local';
      return Promise.resolve();
    },
    onAuthStateChanged: function (cb) { _authCbs.push(cb); setTimeout(function () { cb(_authUser); }, 0); return function () {}; },
    signInAnonymously: function () {
      _authUser = _attachTokenResult({ uid: 'anon-' + Math.random().toString(36).slice(2), isAnonymous: true, email: null, __provider: 'anonymous' });
      _saveAuthUser();
      setTimeout(fireAuth, 0);
      return Promise.resolve({ user: _authUser });
    },
    signInWithEmailAndPassword: function (email) {
      _authUser = _attachTokenResult({ uid: 'admin-uid', isAnonymous: false, email: email, __provider: 'password' });
      _saveAuthUser();
      setTimeout(fireAuth, 0);
      return Promise.resolve({ user: _authUser });
    },
    // Simule auth.signInWithCustomToken(token) (compat SDK) : décode le
    // sachet JSON renvoyé par le mock verifyPin ci-dessus et établit une
    // session dont getIdTokenResult() reflète fidèlement
    // sign_in_provider:'custom' + les claims role/userId/roleId — exactement
    // ce que lit onAuthStateChanged (assets/js/auth.js) pour distinguer une
    // session PIN d'une vraie session Admin.
    signInWithCustomToken: function (token) {
      var claims = {};
      if (typeof token === 'string' && token.indexOf('mock-custom-token:') === 0) {
        try { claims = JSON.parse(token.slice('mock-custom-token:'.length)); } catch (e) {}
      }
      _authUser = _attachTokenResult({
        uid: 'pinuser_' + (claims.userId || 'unknown'), isAnonymous: false, email: null,
        __provider: 'custom', __claims: claims,
      });
      _saveAuthUser();
      setTimeout(fireAuth, 0);
      return Promise.resolve({ user: _authUser });
    },
    signOut: function () { _authUser = null; _saveAuthUser(); setTimeout(fireAuth, 0); return Promise.resolve(); },
    // TEST-ONLY : simule un écrivain Firestore distinct (un autre poste)
    // sans déclencher onAuthStateChanged sur CETTE page — un vrai autre
    // navigateur ne notifierait jamais cette page directement. Ne pas
    // utiliser pour simuler la propre identité de la page testée.
    __setCurrentUserForTest: function (u) { _authUser = _attachTokenResult(u); },
  };

  var mockDb = makeFirestoreMock();
  window.__mockDb = mockDb;
  window.__mockAuth = authMock;
  function firestoreFn() { return mockDb; }
  firestoreFn.FieldValue = {
    serverTimestamp: function () { return { __sv: 'timestamp' }; },
    delete: function () { return { __del: true }; },
    increment: function (n) { return { __inc: n }; },
  };
  firestoreFn.Timestamp = {
    fromDate: function (d) { return { seconds: d.getTime() / 1000, toDate: function () { return d; } }; },
    now: function () { return { seconds: Date.now() / 1000, toDate: function () { return new Date(); } }; },
  };

  function authFn() { return authMock; }
  authFn.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };

  // ── Storage mock (v8-compat shape) — juste assez fidèle pour tester le
  // flux upload → getDownloadURL()/refFromURL().delete() sans jamais
  // toucher un vrai bucket. Les URLs "uploadées"/"supprimées" sont tracées
  // dans window.__storageLog pour les assertions de test. ──
  window.__storageLog = { uploads: [], deletes: [] };
  function storageFn() {
    return {
      ref: function (path) {
        return {
          put: function (file) {
            // blob: URL — unique par appel, résolu localement par le navigateur
            // (zéro E/S réseau, contrairement à un faux hostname externe qui
            // déclencherait un vrai essai de connexion via le proxy de sortie
            // dès que la page l'utilise en background-image, avec un risque
            // de blocage/attente côté navigateur).
            var url = URL.createObjectURL(file);
            var task = {};
            task.on = function (event, onNext, onError, onComplete) {
              setTimeout(function () {
                window.__storageLog.uploads.push(url);
                task.snapshot = { ref: { getDownloadURL: function () { return Promise.resolve(url); } } };
                if (onComplete) onComplete();
              }, 0);
            };
            return task;
          },
        };
      },
      refFromURL: function (url) {
        return {
          delete: function () {
            window.__storageLog.deletes.push(url);
            return Promise.resolve();
          },
        };
      },
    };
  }

  var _appMock = { functions: function () { return functionsFn(); } };
  window.firebase = {
    initializeApp: function () { window.firebase.apps.push({}); },
    apps: [],
    app: function () { return _appMock; },
    firestore: firestoreFn,
    auth: authFn,
    functions: functionsFn,
    storage: storageFn,
  };
})();
