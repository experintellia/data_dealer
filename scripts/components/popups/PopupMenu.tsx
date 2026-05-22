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

    // Pointer drag-to-scroll (mouse + touch).  A drag past the
    // threshold captures the pointer so it continues outside the thin
    // strip, and suppresses the click so it doesn't also switch a tab.
    let down = false;
    let dragged = false;
    let startX = 0;
    let startScroll = 0;
    const onPointerDown = (e: PointerEvent): void => {
      down = true;
      dragged = false;
      startX = e.clientX;
      startScroll = el.scrollLeft;
    };
    const onPointerMove = (e: PointerEvent): void => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (!dragged) {
        if (Math.abs(dx) < 4) return;
        dragged = true;
        el.setPointerCapture(e.pointerId);
      }
      el.scrollLeft = startScroll - dx;
      e.preventDefault();
    };
    const onPointerUp = (e: PointerEvent): void => {
      if (dragged) {
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          /* pointer already released */
        }
      }
      down = false;
    };
    const onClickCapture = (e: MouseEvent): void => {
      if (!dragged) return;
      dragged = false;
      e.stopPropagation();
      e.preventDefault();
    };
    // Vertical wheel → horizontal scroll (only while the strip overflows).
    const onWheel = (e: WheelEvent): void => {
      if (el.scrollWidth <= el.clientWidth) return;
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      el.scrollLeft += delta;
      e.preventDefault();
    };
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('click', onClickCapture, true);
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('click', onClickCapture, true);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

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
