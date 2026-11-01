(function () {
  window.__seedGst = async function () {
    var db = window.__mockDb;
    // Branche dju-mx-deploy-prep : authentification PIN restaurée à son
    // état historique (verifyPin/custom claims non déployés, migration PIN
    // volontairement suspendue — voir assets/js/auth.js) — confirmPin() lit
    // désormais le PIN directement sur users/{id}.pin, jamais plus
    // users_private, jamais plus via le callable verifyPin. Ce seed reflète
    // fidèlement CE modèle : le pin en clair vit sur le document users lui-
    // même, exactement comme avant la refonte claims (la branche "legacy
    // plain-text" de confirmPin() le compare alors par égalité stricte,
    // sans hash — voir auth.js:confirmPin).
    var profiles = [
      { id: 'kevin',  name: 'Kevin',  role: 'technicien',  rank: 'utilisateur',  pin: '1111' },
      { id: 'jordan', name: 'Jordan', role: 'technicien',  rank: 'utilisateur',  pin: '2222' },
      { id: 'dorian', name: 'Dorian', role: 'technicien',  rank: 'utilisateur',  pin: '3333' },
      { id: 'sophie', name: 'Sophie', role: 'responsable', rank: 'responsable', pin: '9999' },
      { id: 'alban',  name: 'Alban',  role: 'responsable', rank: 'responsable', pin: '8888' },
    ];
    for (var i = 0; i < profiles.length; i++) {
      var p = profiles[i];
      await db.collection('users').doc(p.id).set({ name: p.name, role: p.role, rank: p.rank, pin: p.pin, color: null });
    }
    console.log('[seed-gst] Utilisateurs injectés (Kevin, Jordan, Dorian techniciens + Sophie, Alban responsables).');
  };
})();
