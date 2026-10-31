(function () {
  window.__seedGst = async function () {
    var db = window.__mockDb;
    // pin vit désormais dans users_private/{id} (non lisible côté client,
    // voir firestore.rules.draft-claims-migration) — plus jamais dans
    // users/{id}, pour que le mock reflète fidèlement la nouvelle
    // architecture (et détecte toute régression qui s'attendrait encore à
    // lire u.pin depuis le listener users).
    var profiles = [
      { id: 'kevin',  name: 'Kevin',  role: 'technicien',  rank: 'utilisateur',  pin: '1111' },
      { id: 'jordan', name: 'Jordan', role: 'technicien',  rank: 'utilisateur',  pin: '2222' },
      { id: 'dorian', name: 'Dorian', role: 'technicien',  rank: 'utilisateur',  pin: '3333' },
      { id: 'sophie', name: 'Sophie', role: 'responsable', rank: 'responsable', pin: '9999' },
      { id: 'alban',  name: 'Alban',  role: 'responsable', rank: 'responsable', pin: '8888' },
    ];
    for (var i = 0; i < profiles.length; i++) {
      var p = profiles[i];
      await db.collection('users').doc(p.id).set({ name: p.name, role: p.role, rank: p.rank, color: null });
      await db.collection('users_private').doc(p.id).set({ pin: p.pin });
    }
    console.log('[seed-gst] Utilisateurs injectés (Kevin, Jordan, Dorian techniciens + Sophie, Alban responsables).');
  };
})();
