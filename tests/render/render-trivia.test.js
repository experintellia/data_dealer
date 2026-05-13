// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
/**
 * Source-text guards for two low-risk render fixes:
 *
 *  - `RenderPerp.ts`: `config.draggable || true` silently coerced
 *    `draggable: false` to `true`. Switched to `??`.
 *  - `RenderSprite.ts`: `setFrameSrc(src)` guarded on `this.frameSrc` and
 *    built the URL from `this.frameSrc`, so the `src` argument was
 *    effectively dead. Now honoured.
 *
 * The render layer can't be instantiated under vitest (needs createjs +
 * Scroller globals + real DOM), so these are pure regression guards
 * against the specific source patterns rather than runtime tests.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PERP_SRC = readFileSync(resolve(__dirname, '../../scripts/render/RenderPerp.ts'), 'utf8');
const SPRITE_SRC = readFileSync(resolve(__dirname, '../../scripts/render/RenderSprite.ts'), 'utf8');

describe('RenderPerp — draggable nullish-coalesce', () => {
  it('uses `??` so an explicit draggable:false is preserved', () => {
    expect(PERP_SRC).toMatch(/draggable\s*:\s*config\.draggable\s*\?\?\s*true/);
    expect(PERP_SRC).not.toMatch(/draggable\s*:\s*config\.draggable\s*\|\|\s*true/);
  });
});

describe('RenderSprite.setFrameSrc — honours the src argument', () => {
  it('returns early on falsy `src`, not on `this.frameSrc`', () => {
    // Extract the setFrameSrc body to bound the assertions.
    const m = SPRITE_SRC.match(/setFrameSrc\s*\([^)]*\)\s*:\s*void\s*\{[\s\S]*?\n\s\s\}/);
    expect(m, 'setFrameSrc body should match').toBeTruthy();
    const body = m[0];

    // Early-return is now on the argument, not the field.
    expect(body).toMatch(/if\s*\(\s*!\s*src\s*\)/);
    expect(body).not.toMatch(/if\s*\(\s*!\s*this\.frameSrc\s*\)/);
  });

  it('builds the background-image URL from `src`, not `this.frameSrc`', () => {
    const m = SPRITE_SRC.match(/setFrameSrc\s*\([^)]*\)\s*:\s*void\s*\{[\s\S]*?\n\s\s\}/);
    expect(m).toBeTruthy();
    const body = m[0];

    expect(body).toMatch(/imagePathPrefix\s*\+\s*src/);
    expect(body).not.toMatch(/imagePathPrefix\s*\+\s*this\.frameSrc/);
  });

  it('writes `src` back into `this.frameSrc` so subsequent reads see it', () => {
    const m = SPRITE_SRC.match(/setFrameSrc\s*\([^)]*\)\s*:\s*void\s*\{[\s\S]*?\n\s\s\}/);
    expect(m).toBeTruthy();
    expect(m[0]).toMatch(/this\.frameSrc\s*=\s*src/);
  });
});
