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
