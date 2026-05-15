// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
// Shared utilities for source-text guard tests under tests/render/.
// The render layer can't be instantiated under vitest (needs createjs +
// Scroller globals + real DOM), so the regression tests read the
// extracted .ts source as text and assert on patterns.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RENDER_DIR = resolve(here, '../../scripts/render');

export function readRenderSrc(file) {
  return readFileSync(resolve(RENDER_DIR, file), 'utf8');
}
