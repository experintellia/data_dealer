// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
/**
 * Source-text guards for the render-input audit fixes:
 *
 *  - `RenderDragHandler.init()` registers `pointercancel` / `blur` /
 *    `visibilitychange` recovery handlers funneling into `dragend`,
 *    and tracks them so `dispose()` can detach. ViewMap.remove() now
 *    calls `dragHandler.dispose()`.
 *  - `RenderPopup.close()` uses a one-shot transitionend handler that
 *    self-detaches and cancels the 500ms fallback when either path
 *    fires.
 *
 * Render-layer code cannot be instantiated under vitest (no createjs /
 * Scroller globals, no real DOM); these are pattern guards rather than
 * runtime tests. Manual smoke-test still required for the drag flow
 * (alt-tab mid-drag, touch cancel, etc) — see PR description.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDER_DIR = resolve(__dirname, '../../scripts/render');
const readSrc = (file) => readFileSync(resolve(RENDER_DIR, file), 'utf8');

const DRAG_SRC = readSrc('RenderDragHandler.ts');
const VIEWS_SRC = readSrc('RenderViews.ts');
const POPUP_SRC = readSrc('RenderTopLevelUI.ts');

describe('RenderDragHandler — recovery handlers', () => {
  it('init() registers pointercancel, blur, and visibilitychange', () => {
    const m = DRAG_SRC.match(/init\(\)\s*:\s*void\s*\{[\s\S]*?\n  \}/);
    expect(m, 'init() body must be locatable').toBeTruthy();
    const body = m[0];
    expect(body).toMatch(/['"]pointercancel['"]/);
    expect(body).toMatch(/['"]blur['"]/);
    expect(body).toMatch(/['"]visibilitychange['"]/);
  });

  it('recovery handlers funnel into dragend when dragging', () => {
    // The recover closure should call this.dragend(...) only if
    // this.dragging is currently true (idempotent against the normal
    // mouseup/touchend fire).
    expect(DRAG_SRC).toMatch(/if\s*\(\s*this\.dragging\s*\)\s*this\.dragend/);
  });

  it('exports a dispose() that detaches every recovery handler', () => {
    const m = DRAG_SRC.match(/dispose\(\)\s*:\s*void\s*\{[\s\S]*?\n  \}/);
    expect(m, 'dispose() body must be locatable').toBeTruthy();
    expect(m[0]).toMatch(/removeEventListener/);
  });
});

describe('RenderViewMap.remove — disposes the dragHandler', () => {
  it('calls dragHandler.dispose() before super.remove()', () => {
    const m = VIEWS_SRC.match(/override\s+remove\s*\(\)\s*:\s*void\s*\{[\s\S]*?\n  \}/);
    expect(m).toBeTruthy();
    const body = m[0];
    expect(body).toMatch(/this\.dragHandler\??\.dispose\??\(\)/);
    // dispose must precede super.remove so the parent teardown sees
    // the detached state.
    const disposeIdx = body.indexOf('dispose(');
    const superIdx = body.indexOf('super.remove');
    expect(disposeIdx).toBeGreaterThan(-1);
    expect(superIdx).toBeGreaterThan(disposeIdx);
  });
});

describe('RenderPopup.close — one-shot transitionend', () => {
  it('detaches the transitionend handler and clears the fallback timer', () => {
    const m = POPUP_SRC.match(/close\(cb\?[\s\S]*?\n  \}/);
    expect(m, 'close() body must be locatable').toBeTruthy();
    const body = m[0];
    // .off() with the handler ref must appear inside the close body.
    expect(body).toMatch(/jq\.off\(/);
    // The fallback timer must be tracked so the early-firing path can
    // clear it.
    expect(body).toMatch(/clearTimeout\s*\(\s*removeFallback/);
  });

  it('no longer leaves the transitionend handler unbound', () => {
    // Pre-fix the close() called jq.on('transitionend', () => this.remove())
    // with no matching jq.off. Catch any future revert that drops the
    // unbind logic.
    const m = POPUP_SRC.match(/close\(cb\?[\s\S]*?\n  \}/);
    const body = m[0];
    const hasOn = /jq\.on\(\s*TRANSITION_EVENTS/.test(body) || /jq\.on\(/.test(body);
    const hasOff = /jq\.off\(/.test(body);
    expect(hasOn && hasOff, 'close() must both bind AND unbind the transitionend handler').toBe(
      true
    );
  });
});
