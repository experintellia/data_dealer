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

# Bundle dist/ (the built app) plus top-level metadata required by webxdc spec.
zip -r "$OUT" "$DIST"/
zip "$OUT" manifest.toml icon.png LICENSE.txt LICENSE-CODE.txt LICENSE-ASSETS.txt 2>/dev/null || true

echo "Created $OUT ($(du -sh "$OUT" | cut -f1))"
