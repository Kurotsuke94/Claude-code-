(function () {
  'use strict';

  var FV = firebase.firestore.FieldValue;

  function _by() {
    var cu = MX.state.currentUser;
    var ad = MX.state.adminUser;
    if (cu) return cu.name || cu.id || 'Inconnu';
    if (ad) return ad.email || 'Admin';
    return 'Inconnu';
  }

  window.MX.Trash = {

    sendToTrash: async function (collection, docId, meta) {
      await db.collection(collection).doc(docId).update({
        inTrash:     true,
        trashedAt:   FV.serverTimestamp(),
        trashedBy:   _by(),
        trashReason: meta.reason || '',
        _trashName:  meta.name   || '',
        _trashType:  meta.type   || '',
      });
    },

    restore: async function (collection, docId) {
      await db.collection(collection).doc(docId).update({
        inTrash:     false,
        trashedAt:   FV.delete(),
        trashedBy:   FV.delete(),
        trashReason: FV.delete(),
        _trashName:  FV.delete(),
        _trashType:  FV.delete(),
      });
    },

    archive: async function (collection, docId) {
      await db.collection(collection).doc(docId).update({
        inTrash:    false,
        archived:   true,
        archivedAt: FV.serverTimestamp(),
        archivedBy: _by(),
        trashedAt:   FV.delete(),
        trashedBy:   FV.delete(),
        trashReason: FV.delete(),
        _trashName:  FV.delete(),
        _trashType:  FV.delete(),
      });
    },

    purge: async function (collection, docId) {
      if (!MX.Auth.isAdmin()) {
        MX.toast('Suppression définitive réservée à l\'administrateur', true);
        return false;
      }
      await db.collection(collection).doc(docId).delete();
      return true;
    },
  };
})();
