#!/usr/bin/env bash
# Usage: ./scripts/bump-version.sh
set -e

SW="sw.js"
IDX="index.html"

# Extract current cache version number from sw.js (e.g. maintix-v37 → 37)
CURRENT_CACHE=$(grep -oP 'maintix-v\K[0-9]+' "$SW")
NEW_CACHE=$((CURRENT_CACHE + 1))

# Extract current script version from index.html (e.g. ?v=41 → 41)
CURRENT_V=$(grep -oP '\?v=\K[0-9]+' "$IDX" | head -1)
NEW_V=$((CURRENT_V + 1))

# Replace in sw.js
sed -i "s/maintix-v${CURRENT_CACHE}/maintix-v${NEW_CACHE}/g" "$SW"

# Replace all ?v=N occurrences in index.html
sed -i "s/?v=${CURRENT_V}/?v=${NEW_V}/g" "$IDX"

echo "✓ Cache: maintix-v${CURRENT_CACHE} → maintix-v${NEW_CACHE}"
echo "✓ Scripts: ?v=${CURRENT_V} → ?v=${NEW_V}"
echo "Next: git add sw.js index.html && git commit -m 'chore: bump cache v${NEW_CACHE}'"
