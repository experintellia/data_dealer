// Shared `.PopupMenu` tab strip — the `<div class="PopupMenu">` +
// N × `<div class="PopupMenuButton[ active]" data-tab onClick>` block
// that CityPopup and ProjectPopup emitted identically.  The per-dialog
// `switchTab` *behaviour* (subpop close, bridge, tab_change / lastTab)
// stays in the caller — just like <PopupHeader> keeps the close
// handler's callers' concerns out of the markup.
//
// When the strip is too narrow for its tabs (the mobile City popup) it
// scrolls horizontally; the effect below tracks the scroll position so
// the CSS edge-fades only show on a side with more to reveal, and adds
// pointer-drag (mouse + touch) + vertical-wheel scrolling.  It is
// inert when the strip fits.  Touch drag is JS-driven rather than left
// to native `overflow-x` panning because the engine's global touch
// handlers can swallow the gesture; `touch-action: pan-y` (CSS) frees
// the horizontal axis for these handlers while leaving vertical pans
// to the browser.

import { useEffect, useRef } from 'preact/hooks';
import { attachDragScroll } from './scrollDrag.js';

export interface PopupMenuTab {
  /** `data-tab` value + the key passed to `onSelect`. */
  key: string;
  label: string;
}

export function PopupMenu({
  tabs,
  activeKey,
  onSelect,
}: {
  tabs: PopupMenuTab[];
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // `can-scroll-left/right` drive the CSS edge-fades.
    const update = (): void => {
      const max = el.scrollWidth - el.clientWidth;
      el.classList.toggle('can-scroll-left', el.scrollLeft > 1);
      el.classList.toggle('can-scroll-right', el.scrollLeft < max - 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Tab labels use a web font — re-measure once it has loaded.
    document.fonts?.ready.then(update).catch(() => {});

    // Pointer drag-to-scroll via shared utility (mouse + touch).
    const cleanupDrag = attachDragScroll(el, 'x');
    // Vertical wheel → horizontal scroll (only while the strip overflows).
    const onWheel = (e: WheelEvent): void => {
      if (el.scrollWidth <= el.clientWidth) return;
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      el.scrollLeft += delta;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
      cleanupDrag();
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  // When the active tab changes (e.g. tapping a tab on mobile that the
  // strip had clipped) scroll it fully into view, clear of the 38px
  // edge-fades.  Inert when the strip isn't overflowing.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const btn = el.querySelector<HTMLElement>(
      `.PopupMenuButton[data-tab="${CSS.escape(activeKey)}"]`
    );
    if (!btn) return;
    const FADE = 38; // matches the CSS edge-fade width
    const cr = el.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const leftGap = br.left - cr.left;
    const rightGap = br.right - cr.right;
    let target = el.scrollLeft;
    if (leftGap < FADE) target += leftGap - FADE;
    else if (rightGap > -FADE) target += rightGap + FADE;
    const max = el.scrollWidth - el.clientWidth;
    target = Math.max(0, Math.min(target, max));
    if (Math.abs(target - el.scrollLeft) > 1) el.scrollTo({ left: target, behavior: 'smooth' });
  }, [activeKey]);

  return (
    <div class="PopupMenu" ref={ref}>
      {tabs.map((t) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass
        <div
          key={t.key}
          class={activeKey === t.key ? 'PopupMenuButton active' : 'PopupMenuButton'}
          data-tab={t.key}
          onClick={() => onSelect(t.key)}
        >
          {t.label}
        </div>
      ))}
    </div>
  );
}
