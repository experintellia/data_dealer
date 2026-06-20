// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Source-level guard for the mobile-conveyor scale fix.
//
// The mobile rule scales the fixed 520-px belt box down to fit the
// viewport with `transform: scale(<ratio>)`.  The responsive ratio uses
// `length / length` calc division, which older Android WebView / Gecko
// builds reject (Chrome 91+, Safari 16.4+, Firefox 116+ only).  When that
// declaration is dropped, the cascade must fall back to a *static* scale —
// otherwise the band stays 520 px wide and the "Ausbauen"/Upgrade button
// (anchored at the pipe's `right: 0`) is pushed off screen.
//
// Two things must hold in the source, and neither is observable through
// Chromium's CSSOM (it de-duplicates same-block `transform` declarations),
// so we assert them against the stylesheet text directly:
//   1. a static `transform: scale(<number>)` fallback exists;
//   2. it appears BEFORE the responsive (calc/clamp) declaration so the
//      cascade can fall back to it.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(root, 'css', 'Render.css'), 'utf8');

// Extract the body of the *mobile* `.DatabaseQueueConveyor` rule that owns
// the scale.  Match the first `.DatabaseQueueConveyor { ... }` block whose
// body contains a `transform: scale(`.
function conveyorScaleRuleBody() {
  const re = /\.DatabaseQueueConveyor\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    if (/transform\s*:\s*scale\(/.test(m[1])) return m[1];
  }
  return null;
}

describe('mobile conveyor scale fallback', () => {
  it('has a .DatabaseQueueConveyor rule that sets transform: scale()', () => {
    expect(conveyorScaleRuleBody()).not.toBeNull();
  });

  it('declares a static scale fallback before the responsive scale', () => {
    const body = conveyorScaleRuleBody();
    expect(body).not.toBeNull();

    const transforms = [...body.matchAll(/transform\s*:\s*([^;]+);/g)].map((x) => x[1].trim());

    // A static fallback: scale(<number>) with no var() and no calc/clamp.
    const staticIdx = transforms.findIndex(
      (t) =>
        /^scale\(\s*[\d.]+\s*\)$/.test(t) &&
        !t.includes('var(') &&
        !t.includes('calc(') &&
        !t.includes('clamp(')
    );
    expect(
      staticIdx,
      `transform declarations: ${JSON.stringify(transforms)}`
    ).toBeGreaterThanOrEqual(0);

    // The responsive declaration (calc/clamp) must come AFTER the fallback.
    const responsiveIdx = transforms.findIndex((t) => t.includes('calc(') || t.includes('clamp('));
    expect(responsiveIdx, 'responsive scale declaration missing').toBeGreaterThanOrEqual(0);
    expect(responsiveIdx).toBeGreaterThan(staticIdx);
  });

  it('does not consume the scale ratio through a custom property (var())', () => {
    // The original bug: `transform: scale(var(--conv-s))` parses fine but
    // fails at computed-value time on engines lacking length/length calc,
    // falling all the way back to `transform: none` instead of the static
    // fallback.  Inlining the calc avoids that trap.
    const body = conveyorScaleRuleBody();
    expect(body).not.toBeNull();
    expect(/transform\s*:\s*scale\(\s*var\(/.test(body)).toBe(false);
  });
});
