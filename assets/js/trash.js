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

    // NOTE — corrige un défaut préexistant découvert pendant l'audit de
    // cette fonctionnalité (restoreMany ci-dessous appelle le même champ) :
    // un élément déjà archivé (archived:true) que l'on restaure via le
    // bouton "Restaurer" (disponible aussi bien en Corbeille qu'en
    // Archives) gardait archived:true faute d'être explicitement effacé —
    // l'élément restait donc visible dans l'onglet Archives malgré une
    // restauration "réussie". archived:FV.delete() ajouté ci-dessous pour
    // que "Restaurer" retire réellement l'élément de l'état archivé, sans
    // toucher à aucun autre champ (contenu, historique inchangés).
    restore: async function (collection, docId) {
      await db.collection(collection).doc(docId).update({
        inTrash:     false,
        archived:    FV.delete(),
        archivedAt:  FV.delete(),
        archivedBy:  FV.delete(),
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

    // ── ACTIONS EN MASSE ──────────────────────────────────────────────────
    // items: [{ col, id }, ...] — appliquent EXACTEMENT les mêmes champs que
    // restore()/archive()/purge() ci-dessus, groupés en db.batch() (limite
    // Firestore : 500 écritures/batch, on découpe par lots de 400 par
    // sécurité). Chaque lot est atomique (tout ou rien) ; un lot en échec
    // n'empêche pas les lots suivants d'être tentés, et le résultat renvoyé
    // distingue précisément ce qui a réellement été appliqué de ce qui ne
    // l'a pas été — jamais de compte optimiste (voir _batchApply).
    restoreMany: async function (items) {
      return _batchApply(items, function (batch, ref) {
        batch.update(ref, {
          inTrash:     false,
          archived:    FV.delete(),
          archivedAt:  FV.delete(),
          archivedBy:  FV.delete(),
          trashedAt:   FV.delete(),
          trashedBy:   FV.delete(),
          trashReason: FV.delete(),
          _trashName:  FV.delete(),
          _trashType:  FV.delete(),
        });
      });
    },

    archiveMany: async function (items) {
      var by = _by();
      return _batchApply(items, function (batch, ref) {
        batch.update(ref, {
          inTrash:     false,
          archived:    true,
          archivedAt:  FV.serverTimestamp(),
          archivedBy:  by,
          trashedAt:   FV.delete(),
          trashedBy:   FV.delete(),
          trashReason: FV.delete(),
          _trashName:  FV.delete(),
          _trashType:  FV.delete(),
        });
      });
    },

    purgeMany: async function (items) {
      if (!MX.Auth.isAdmin()) {
        MX.toast('Suppression définitive réservée à l\'administrateur', true);
        return { succeeded: [], failed: items.slice() };
      }
      return _batchApply(items, function (batch, ref) { batch.delete(ref); });
    },
  };

  async function _batchApply(items, applyToBatch) {
    var CHUNK = 400;
    var succeeded = [];
    var failed = [];
    for (var i = 0; i < items.length; i += CHUNK) {
      var chunk = items.slice(i, i + CHUNK);
      var batch = db.batch();
      chunk.forEach(function (it) { applyToBatch(batch, db.collection(it.col).doc(it.id)); });
      try {
        await batch.commit();
        succeeded = succeeded.concat(chunk);
      } catch (e) {
        failed = failed.concat(chunk);
      }
    }
    return { succeeded: succeeded, failed: failed };
  }
})();
