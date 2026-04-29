#!/usr/bin/env bash
# Builds data-dealer.xdc — the distributable webxdc archive.
# Usage: pnpm build && bash scripts/build-xdc.sh
# Or just: pnpm run build-xdc  (wires both steps)
set -euo pipefail

DIST="dist"
OUT="data-dealer.xdc"

if [[ ! -d "$DIST" ]]; then
  echo "error: $DIST/ not found — run 'pnpm build' first" >&2
  exit 1
fi

rm -f "$OUT"

# webxdc spec requires index.html at the zip root, not inside dist/.
# cd into dist/ so all paths in the archive are relative to the app root.
(cd "$DIST" && zip -r "../$OUT" .)
zip "$OUT" manifest.toml icon.png LICENSE.txt LICENSE-CODE.txt LICENSE-ASSETS.txt 2>/dev/null || true

echo "Created $OUT ($(du -sh "$OUT" | cut -f1))"
