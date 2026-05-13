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
import { describe, expect, it } from 'vitest';
import { readRenderSrc } from './_helpers.js';

const DRAG_SRC = readRenderSrc('RenderDragHandler.ts');
const VIEWS_SRC = readRenderSrc('RenderViews.ts');
const POPUP_SRC = readRenderSrc('RenderTopLevelUI.ts');

const INIT_BODY = DRAG_SRC.match(/init\(\)\s*:\s*void\s*\{[\s\S]*?\n  \}/)?.[0] ?? '';
const DISPOSE_BODY = DRAG_SRC.match(/dispose\(\)\s*:\s*void\s*\{[\s\S]*?\n  \}/)?.[0] ?? '';
const VIEW_REMOVE_BODY =
  VIEWS_SRC.match(/override\s+remove\s*\(\)\s*:\s*void\s*\{[\s\S]*?\n  \}/)?.[0] ?? '';
const CLOSE_BODY = POPUP_SRC.match(/close\(cb\?[\s\S]*?\n  \}/)?.[0] ?? '';

describe('RenderDragHandler — recovery handlers', () => {
  it('init() body is locatable', () => {
    expect(INIT_BODY).not.toBe('');
  });

  it('registers pointercancel, blur, and visibilitychange', () => {
    expect(INIT_BODY).toMatch(/['"]pointercancel['"]/);
    expect(INIT_BODY).toMatch(/['"]blur['"]/);
    expect(INIT_BODY).toMatch(/['"]visibilitychange['"]/);
  });

  it('recovery handlers funnel into dragend only when dragging', () => {
    expect(DRAG_SRC).toMatch(/if\s*\(\s*this\.dragging\s*\)\s*this\.dragend/);
  });

  it('dispose() detaches every recovery handler', () => {
    expect(DISPOSE_BODY).not.toBe('');
    expect(DISPOSE_BODY).toMatch(/removeEventListener/);
  });
});

describe('RenderViewMap.remove — disposes the dragHandler', () => {
  it('calls dragHandler.dispose() before super.remove()', () => {
    expect(VIEW_REMOVE_BODY).toMatch(/this\.dragHandler\??\.dispose\??\(\)/);
    const disposeIdx = VIEW_REMOVE_BODY.indexOf('dispose(');
    const superIdx = VIEW_REMOVE_BODY.indexOf('super.remove');
    expect(disposeIdx).toBeGreaterThan(-1);
    expect(superIdx).toBeGreaterThan(disposeIdx);
  });
});

describe('RenderPopup.close — one-shot transitionend', () => {
  it('close() body is locatable', () => {
    expect(CLOSE_BODY).not.toBe('');
  });

  it('binds AND unbinds the transitionend handler', () => {
    expect(CLOSE_BODY).toMatch(/jq\.on\(/);
    expect(CLOSE_BODY).toMatch(/jq\.off\(/);
  });

  it('clears the fallback timer when the early path fires', () => {
    expect(CLOSE_BODY).toMatch(/clearTimeout\s*\(\s*removeFallback/);
  });
});
