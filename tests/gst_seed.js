(function () {
  window.__seedGst = async function () {
    var db = window.__mockDb;
    await db.collection('users').doc('kevin').set({ name: 'Kevin',  role: 'technicien',  rank: 'utilisateur',  pin: '1111', color: null });
    await db.collection('users').doc('jordan').set({ name: 'Jordan', role: 'technicien', rank: 'utilisateur',  pin: '2222', color: null });
    await db.collection('users').doc('dorian').set({ name: 'Dorian', role: 'technicien', rank: 'utilisateur',  pin: '3333', color: null });
    await db.collection('users').doc('sophie').set({ name: 'Sophie', role: 'responsable', rank: 'responsable', pin: '9999', color: null });
    console.log('[seed-gst] Utilisateurs injectés (Kevin, Jordan, Dorian techniciens + Sophie responsable).');
  };
})();
