#!/usr/bin/env bash
# ── MAINTIX — GÉNÉRATION AUTOMATIQUE DE VERSION ──
#
# Génère version.js (source unique de version de MX) à partir de
# l'horodatage du build, au format YYYYMMDDHHmmss (UTC, pour éviter toute
# ambiguïté liée aux changements d'heure été/hiver locaux).
#
# Ce script est destiné à être appelé UNIQUEMENT par le hook "predeploy"
# de firebase.json, lui-même déclenché automatiquement par :
#   firebase deploy --only hosting --project maintix-c9dbd
#
# NE JAMAIS l'exécuter manuellement pour "tester" une modification locale :
# une exécution manuelle régénère version.js immédiatement, même sans
# déploiement réel. C'est `firebase deploy` (via le hook) qui doit rester
# le seul déclencheur d'une nouvelle version publique.
#
# MX_BUILD (entier) pilote la vraie logique de comparaison dans
# MX.UpdateManager.checkVersion() (_serverBuild > localBuild) — toujours
# strictement croissant tant que l'horloge de la machine avance, sans
# dépendre de l'historique Git (donc insensible à un rebase/squash futur).
# MX_VERSION (string) n'est qu'un affichage cosmétique dérivé du même
# horodatage.
#
# Le même TS_BUILD est AUSSI injecté dans sw.js (ligne MX_BUILD_STAMP), en
# plus de version.js — une seule exécution de ce script, une seule valeur
# pour les deux fichiers, garantissant qu'ils restent synchronisés. Ça fait
# varier les octets de sw.js à chaque déploiement : sans ça, sw.js importe
# ses constantes de version via importScripts('/version.js') et son propre
# contenu ne changerait jamais, empêchant le navigateur de détecter la
# moindre mise à jour du Service Worker (comparaison native octet par
# octet du script enregistré).
set -euo pipefail

cd "$(dirname "$0")/.."

TS_BUILD=$(date -u +%Y%m%d%H%M%S)          # ex: 20260915030215
TS_VERSION=$(date -u +%Y.%m.%d.%H%M%S)     # ex: 2026.09.15.030215

cat > version.js << EOF
// ── MAINTIX — SOURCE UNIQUE DE VERSION ──
// Fichier GÉNÉRÉ AUTOMATIQUEMENT par scripts/generate-version.sh, exécuté
// par le hook "predeploy" de firebase.json à chaque \`firebase deploy\`.
// NE JAMAIS ÉDITER CE FICHIER À LA MAIN — toute modification manuelle sera
// écrasée sans avertissement au prochain déploiement.
// Chargé par : index.html (window), sw.js (importScripts → self)
(function (ctx) {
  ctx.MX_VERSION = "${TS_VERSION}";
  ctx.MX_BUILD   = ${TS_BUILD};
})(typeof self !== "undefined" ? self : window);
EOF

echo "✓ version.js généré — MX_VERSION=${TS_VERSION}  MX_BUILD=${TS_BUILD}"

# ── Injection du même build dans sw.js (fait varier ses octets) ──
node -e "
const fs = require('fs');
const build = ${TS_BUILD};
const path = 'sw.js';
const content = fs.readFileSync(path, 'utf8');
const marker = /^\/\/ MX_BUILD_STAMP:\d+.*\$/m;
if (!marker.test(content)) {
  console.error('✗ ERREUR : marqueur MX_BUILD_STAMP introuvable dans sw.js — build NON injecté, le déploiement est interrompu.');
  process.exit(1);
}
const updated = content.replace(marker, '// MX_BUILD_STAMP:' + build + ' — regénéré automatiquement par scripts/generate-version.sh à chaque déploiement (hook predeploy de firebase.json), même valeur que MX_BUILD dans version.js. NE PAS ÉDITER À LA MAIN.');
fs.writeFileSync(path, updated);
console.log('✓ sw.js mis à jour — MX_BUILD_STAMP=' + build);
"
