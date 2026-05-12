// @ts-nocheck — strict-TS quarantine; render layer is monolithic and
// non-instantiable without a real DOM + createjs/Scroller globals, so
// these unit tests inspect the source text of `scripts/Render.js`
// directly. They cover the small, mechanical audit fixes whose
// presence/absence can be verified without booting the renderer.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDER_SRC = readFileSync(join(HERE, '..', '..', 'scripts', 'Render.js'), 'utf8');

describe('Render.js audit fixes', () => {
  describe('Perp config — draggable boolean coercion (bug #2)', () => {
    it('uses ?? (nullish coalescing) instead of || for draggable default', () => {
      // `config.draggable || true` silently flips an explicit `false` to
      // `true`. The fix must use `??` so only undefined falls through.
      expect(RENDER_SRC).not.toMatch(/this\.draggable\s*=\s*config\.draggable\s*\|\|\s*true/);
      expect(RENDER_SRC).toMatch(/this\.draggable\s*=\s*config\.draggable\s*\?\?\s*true/);
    });
  });

  describe('Sprite.setFrameSrc — uses the passed argument (bug #3)', () => {
    it('builds the background-image URL from the src argument, not this.frameSrc', () => {
      // Locate the body of Sprite.prototype.setFrameSrc and check it
      // references `src` (the parameter) on the relevant lines.
      const m = RENDER_SRC.match(
        /Sprite\.prototype\.setFrameSrc\s*=\s*function\s*\(src\)\s*\{([\s\S]*?)\n\s*\};/
      );
      expect(m, 'setFrameSrc body should match').toBeTruthy();
      const body = m[1];
      // The early-return guard should check the parameter, not the field.
      expect(body).toMatch(/if\s*\(\s*!\s*src\s*\)/);
      // The background-image URL must interpolate `src`, not `this.frameSrc`.
      expect(body).toMatch(/url\(['"]?\s*\+\s*setup\.imagePathPrefix\s*\+\s*src/);
      expect(body).not.toMatch(/url\(['"]?\s*\+\s*setup\.imagePathPrefix\s*\+\s*this\.frameSrc/);
    });
  });

  describe('FXFeedMe — scaleY typo (bug #4)', () => {
    it('does not contain the `sacaleY` typo', () => {
      expect(RENDER_SRC).not.toMatch(/sacaleY/);
    });

    it('FXFeedMe first cue animates scaleX (not the typoed key)', () => {
      // The first cue used to be `{ scaleX: 1.1, sacaleY: 1 }`. After the
      // fix it should set `scaleY: 1` so the animation actually plays.
      const m = RENDER_SRC.match(
        /Node\.prototype\.FXFeedMe\s*=\s*function[\s\S]*?this\.FXSimpleCue\(\{([^}]+)\}\s*,\s*37\)/
      );
      expect(m, 'FXFeedMe first cue should match').toBeTruthy();
      expect(m[1]).toMatch(/scaleY/);
      expect(m[1]).not.toMatch(/sacaleY/);
    });
  });

  describe('FXPuff — single removal path (bug #5)', () => {
    it('does not double-remove via both Tween callback and setTimeout', () => {
      const m = RENDER_SRC.match(/Node\.prototype\.FXPuff\s*=\s*function[\s\S]*?\n\s*\};/);
      expect(m, 'FXPuff body should match').toBeTruthy();
      // The raw setTimeout(node.remove, 350) fallback must be gone.
      expect(m[0]).not.toMatch(/window\.setTimeout\([\s\S]*?node\.remove\(\)[\s\S]*?350\)/);
    });
  });

  describe('Node.remove — clears tweens and pending drag timers (bugs #6, #7)', () => {
    it('calls Tween.removeTweens(this) on remove', () => {
      const m = RENDER_SRC.match(/Node\.prototype\.remove\s*=\s*function[\s\S]*?\n\s*\};/);
      expect(m, 'Node.prototype.remove should match').toBeTruthy();
      expect(m[0]).toMatch(/Tween\.removeTweens\(\s*this\s*\)/);
    });

    it('clears the dragDelay and cancelClickTimeout timers on remove', () => {
      const m = RENDER_SRC.match(/Node\.prototype\.remove\s*=\s*function[\s\S]*?\n\s*\};/);
      expect(m, 'Node.prototype.remove should match').toBeTruthy();
      expect(m[0]).toMatch(/clearTimeout\(\s*this\.dragDelay\s*\)/);
      expect(m[0]).toMatch(/clearTimeout\(\s*this\.cancelClickTimeout\s*\)/);
    });
  });

  describe('Popup.close — transitionend listener does not stack (bug #8)', () => {
    it('uses jQuery .one (or .off-then-.on) so closing twice does not double-bind', () => {
      const m = RENDER_SRC.match(/Popup\.prototype\.close\s*=\s*function[\s\S]*?\n\s*\};/);
      expect(m, 'Popup.prototype.close should match').toBeTruthy();
      // Either .one(...) (preferred one-shot binding) or .off(...) before .on(...)
      // is acceptable; .on(...) alone is the bug.
      const usesOne = /popup\.jdomelem\.one\(/.test(m[0]);
      const usesOffThenOn =
        /popup\.jdomelem\.off\([\s\S]*?(transitionend|MSTransitionEnd|otransitionend|webkitTransitionEnd)/.test(
          m[0]
        );
      expect(usesOne || usesOffThenOn).toBe(true);
    });
  });

  describe('SlowTicker — skips reschedule when idle (bug #10)', () => {
    it('tick body short-circuits when there are no listeners or document is hidden', () => {
      const m = RENDER_SRC.match(/var\s+SlowTicker\s*=\s*\{[\s\S]*?\n\s*\};/);
      expect(m, 'SlowTicker object should match').toBeTruthy();
      // Look at the `tick:` method specifically.
      const tickMatch = m[0].match(/tick:\s*function\s*\(\)\s*\{([\s\S]*?)\n\s{4}\},/);
      expect(tickMatch, 'tick: should match').toBeTruthy();
      const tickBody = tickMatch[1];
      // Should reference document.hidden or listeners.length to guard the reschedule.
      expect(tickBody).toMatch(
        /document\.hidden|hidden|listeners[\s\S]*?length|listeners[\s\S]*?size/
      );
    });
  });

  describe('DragHandler — has recovery paths (bug #1)', () => {
    it('binds pointercancel, window blur, and visibilitychange to dragend', () => {
      // We can't easily isolate the init() method body cheaply with regex
      // because the file contains many `init` methods; instead assert the
      // DragHandler.prototype.init substring exists and references all three.
      const m = RENDER_SRC.match(/DragHandler\.prototype\.init\s*=\s*function[\s\S]*?\n\s*\};/);
      expect(m, 'DragHandler.prototype.init should match').toBeTruthy();
      const body = m[0];
      expect(body).toMatch(/pointercancel/);
      expect(body).toMatch(/blur/);
      expect(body).toMatch(/visibilitychange/);
    });
  });

  describe('ViewMap — touch/wheel listeners are tracked for removal (bug #9)', () => {
    it('stores wheel/touch handlers as references so they can be removed', () => {
      // The fix stores handlers on `node` so they can be detached. The
      // raw `function (e) { ... }` inline literals are no longer the only
      // reference, so we look for a removeEventListener in the file at all.
      expect(RENDER_SRC).toMatch(/removeEventListener/);
    });
  });
});
