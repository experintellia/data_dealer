// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Source-level guard for the mobile-conveyor scale.
//
// The mobile rule shrinks the fixed 520-px belt box with
// `transform: scale(<ratio>)` so it fills the viewport width.  A *CSS*
// responsive ratio would need `length / length` calc division
// (`(100vw - 24px) / 520px`), which Firefox and older Android WebView
// reject — there the belt collapses to a too-small size and hugs the left
// edge.  So the responsive ratio is computed in JS
// (RenderDBQueue.fitMobileConveyor) and written inline; the CSS keeps only
// a static `transform: scale()` fallback for the first paint.
//
// This test locks in that the CSS does NOT reintroduce the fragile
// length/length calc (or the even worse `var()`-behind-scale form that
// silently falls back to `transform: none`), and that a static fallback is
// present.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(root, 'css', 'Render.css'), 'utf8');
const js = readFileSync(join(root, 'scripts', 'render', 'RenderTopLevelUI.ts'), 'utf8');

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

describe('mobile conveyor scale', () => {
  it('has a .DatabaseQueueConveyor rule that sets transform: scale()', () => {
    expect(conveyorScaleRuleBody()).not.toBeNull();
  });

  it('keeps a static scale fallback in CSS (for the first paint)', () => {
    const body = conveyorScaleRuleBody();
    expect(body).not.toBeNull();

    const transforms = [...body.matchAll(/transform\s*:\s*([^;]+);/g)].map((x) => x[1].trim());
    const hasStatic = transforms.some(
      (t) =>
        /^scale\(\s*[\d.]+\s*\)$/.test(t) &&
        !t.includes('var(') &&
        !t.includes('calc(') &&
        !t.includes('clamp(')
    );
    expect(hasStatic, `transform declarations: ${JSON.stringify(transforms)}`).toBe(true);
  });

  it('does not use fragile length/length calc or var()-behind-scale in CSS', () => {
    // `scale(var(...))` parses but fails at computed-value time on engines
    // lacking length/length calc, falling to `transform: none` (no scale →
    // 520-px band → button off-screen).  `calc(... / <length>)` is the
    // length/length division those engines can't compute.  Both must stay
    // out of the conveyor scale — the responsive value comes from JS.
    const body = conveyorScaleRuleBody();
    expect(body).not.toBeNull();
    expect(/transform\s*:\s*scale\(\s*var\(/.test(body)).toBe(false);
    // No division by a length inside the conveyor's transform.
    expect(/calc\([^)]*\/\s*[\d.]+px/.test(body)).toBe(false);
  });

  it('computes the responsive scale in JS mirroring clamp(0.4, (100vw-24)/520, 1)', () => {
    // Guard that the JS fallback path exists and uses the same formula the
    // CSS media query documents, so the belt fills the width on every
    // engine (not just those with length/length calc).
    expect(js).toMatch(/fitMobileConveyor/);
    expect(js).toMatch(/\(vw\s*-\s*24\)\s*\/\s*520/);
  });
});
