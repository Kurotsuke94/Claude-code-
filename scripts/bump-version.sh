#!/usr/bin/env bash
# Usage: ./scripts/bump-version.sh
# Incrémente automatiquement :
#   - la version de cache SW  (maintix-vN)
#   - les query strings JS    (?v=N)
#   - la version d'application (_APP_VER "1.0.N")
set -e

SW="sw.js"
IDX="index.html"
APP="assets/js/app.js"

# ── Cache SW : maintix-vN → maintix-v(N+1)
CURRENT_CACHE=$(grep -oP 'maintix-v\K[0-9]+' "$SW")
NEW_CACHE=$((CURRENT_CACHE + 1))
sed -i "s/maintix-v${CURRENT_CACHE}/maintix-v${NEW_CACHE}/g" "$SW"

# ── Query strings JS : ?v=N → ?v=(N+1)
CURRENT_V=$(grep -oP '\?v=\K[0-9]+' "$IDX" | head -1)
NEW_V=$((CURRENT_V + 1))
sed -i "s/?v=${CURRENT_V}/?v=${NEW_V}/g" "$IDX"

# ── Version applicative : "1.0.N" → "1.0.(N+1)"
CURRENT_PATCH=$(grep -oP '_APP_VER = "1\.0\.\K[0-9]+' "$APP")
NEW_PATCH=$((CURRENT_PATCH + 1))
sed -i "s/_APP_VER = \"1\.0\.${CURRENT_PATCH}\"/_APP_VER = \"1.0.${NEW_PATCH}\"/" "$APP"

echo "✓ Cache   : maintix-v${CURRENT_CACHE} → maintix-v${NEW_CACHE}"
echo "✓ Scripts : ?v=${CURRENT_V} → ?v=${NEW_V}"
echo "✓ App     : 1.0.${CURRENT_PATCH} → 1.0.${NEW_PATCH}"
echo ""
echo "Next: git add sw.js index.html assets/js/app.js && git commit -m 'chore: bump v1.0.${NEW_PATCH}'"
