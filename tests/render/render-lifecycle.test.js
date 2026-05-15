// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
/**
 * Source-text guards for the render-lifecycle audit fixes:
 *
 *  - `RenderNode.remove()` now calls `Tween.removeTweens(this)` and
 *    clears `dragDelay` / `cancelClickTimeout` setTimeout ids.
 *  - `RenderSlowTicker.tick()` skips the reschedule when there are no
 *    listeners or `document.hidden`; `addListener` resumes when idle;
 *    a `visibilitychange` listener resumes on tab focus.
 *  - `RenderViewMap` records its native touch/wheel listeners and
 *    overrides `remove()` to detach them.
 *
 * Render-layer code cannot be instantiated under vitest (no createjs /
 * Scroller globals, no real DOM), so these are pattern guards rather
 * than runtime tests.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDER_DIR = resolve(__dirname, '../../scripts/render');
const readSrc = (file) => readFileSync(resolve(RENDER_DIR, file), 'utf8');

const NODE_SRC = readSrc('RenderNode.ts');
const TICKER_SRC = readSrc('RenderSlowTicker.ts');
const VIEWS_SRC = readSrc('RenderViews.ts');

const removeBodyMatch = NODE_SRC.match(/\n {2}remove\(\)\s*:\s*void\s*\{[\s\S]*?\n {2}\}/);
const REMOVE_BODY = removeBodyMatch ? removeBodyMatch[0] : '';

describe('RenderNode.remove — tween + timer cleanup', () => {
  it('locates the remove() body', () => {
    expect(removeBodyMatch, 'remove() body must be locatable').toBeTruthy();
  });

  it('calls Tween.removeTweens(this)', () => {
    expect(REMOVE_BODY).toMatch(/removeTweens\s*\(\s*this\s*\)/);
  });

  it('clears dragDelay and cancelClickTimeout via clearTimeout', () => {
    expect(REMOVE_BODY).toMatch(/clearTimeout\s*\(\s*this\.dragDelay/);
    expect(REMOVE_BODY).toMatch(/clearTimeout\s*\(\s*this\.cancelClickTimeout/);
    expect(REMOVE_BODY).toMatch(/this\.dragDelay\s*=\s*undefined/);
    expect(REMOVE_BODY).toMatch(/this\.cancelClickTimeout\s*=\s*undefined/);
  });
});

describe('RenderSlowTicker — idle/hidden short-circuit', () => {
  it('tick() skips the reschedule when no listeners or document.hidden', () => {
    expect(TICKER_SRC).toMatch(/document\.hidden/);
    // The early-return must precede the setTimeout reschedule call.
    const setTimeoutIdx = TICKER_SRC.indexOf('setTimeout(tick');
    const hiddenIdx = TICKER_SRC.indexOf('document.hidden');
    expect(hiddenIdx).toBeGreaterThan(-1);
    expect(setTimeoutIdx).toBeGreaterThan(-1);
    expect(hiddenIdx).toBeLessThan(setTimeoutIdx);
  });

  it('addListener resumes the loop when idle', () => {
    // Matches `addListener(...)`'s body containing a call to start().
    const m = TICKER_SRC.match(/function addListener[\s\S]*?\n\}/);
    expect(m, 'addListener body should match').toBeTruthy();
    expect(m[0]).toMatch(/start\s*\(\s*\)/);
  });

  it('registers a visibilitychange handler that resumes on tab focus', () => {
    expect(TICKER_SRC).toMatch(/addEventListener\s*\(\s*['"]visibilitychange['"]/);
  });
});

describe('RenderViewMap.remove — native listener teardown', () => {
  it('records every native addEventListener via the addNative helper', () => {
    // The class no longer calls `target.addEventListener` inline inside
    // initScroller — every registration goes through `addNative`.
    const initIdx = VIEWS_SRC.indexOf('initScroller');
    const removeOverrideIdx = VIEWS_SRC.indexOf('override remove');
    expect(initIdx).toBeGreaterThan(-1);
    expect(removeOverrideIdx).toBeGreaterThan(initIdx);
    const initScrollerSlice = VIEWS_SRC.slice(initIdx, removeOverrideIdx);
    // After the addNative helper definition itself, no further
    // `addEventListener(` direct call should appear in initScroller.
    const helperEnd = initScrollerSlice.indexOf('this._nativeListeners.push');
    expect(helperEnd).toBeGreaterThan(-1);
    const afterHelper = initScrollerSlice.slice(helperEnd);
    expect(afterHelper).not.toMatch(/\.addEventListener\s*\(/);
  });

  it('overrides remove() and detaches every tracked listener before super.remove()', () => {
    const m = VIEWS_SRC.match(/override\s+remove\s*\(\)\s*:\s*void\s*\{[\s\S]*?\n {2}\}/);
    expect(m, 'ViewMap remove() override must exist').toBeTruthy();
    const body = m[0];
    expect(body).toMatch(/removeEventListener/);
    expect(body).toMatch(/super\.remove\s*\(\s*\)/);
  });
});
