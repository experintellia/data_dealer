// Pointer-drag-to-scroll shared by PopupMenu (horizontal tab strip) and the
// global popup scroll handler (vertical/horizontal grids).  Uses pointer
// events so the game engine's native touchstart preventDefault() cannot
// interfere — pointerdown fires before touchstart, so our capture-phase
// document listener beats the game engine to the event.
//
// Why document-level listeners + no setPointerCapture:
//   • setPointerCapture on a scrollable element (overflow-y:auto) during a
//     vertical gesture causes Chrome/Safari to fire pointercancel immediately
//     (conflict between capture and the browser's own scroll tracking).
//   • Document capture-phase listeners receive events before any element
//     handler, so we never need to redirect via capture.

/** Attach drag-to-scroll to `el` on the given axis.  Returns a cleanup fn.
 *  Used by PopupMenu.tsx for the horizontal tab strip. */
export function attachDragScroll(el: HTMLElement, axis: 'x' | 'y'): () => void {
  let activeId = -1;
  let dragged = false;
  let start = 0;
  let startScroll = 0;

  const coord = (e: PointerEvent) => (axis === 'x' ? e.clientX : e.clientY);

  const onDocMove = (e: PointerEvent): void => {
    if (e.pointerId !== activeId) return;
    const delta = coord(e) - start;
    if (!dragged) {
      if (Math.abs(delta) < 4) return;
      dragged = true;
    }
    if (axis === 'x') el.scrollLeft = startScroll - delta;
    else el.scrollTop = startScroll - delta;
    e.preventDefault();
    e.stopPropagation();
  };

  const onDocUp = (e: PointerEvent): void => {
    if (e.pointerId !== activeId) return;
    activeId = -1;
    document.removeEventListener('pointermove', onDocMove, true);
    document.removeEventListener('pointerup', onDocUp, true);
    document.removeEventListener('pointercancel', onDocUp, true);
    if (dragged)
      setTimeout(() => {
        dragged = false;
      }, 0);
  };

  const onDown = (e: PointerEvent): void => {
    if (activeId !== -1) return;
    activeId = e.pointerId;
    dragged = false;
    start = coord(e);
    startScroll = axis === 'x' ? el.scrollLeft : el.scrollTop;
    document.addEventListener('pointermove', onDocMove, { capture: true, passive: false });
    document.addEventListener('pointerup', onDocUp, true);
    document.addEventListener('pointercancel', onDocUp, true);
  };

  const onClickCapture = (e: MouseEvent): void => {
    if (!dragged) return;
    dragged = false;
    e.stopPropagation();
    e.preventDefault();
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('click', onClickCapture, true);

  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('click', onClickCapture, true);
    document.removeEventListener('pointermove', onDocMove, true);
    document.removeEventListener('pointerup', onDocUp, true);
    document.removeEventListener('pointercancel', onDocUp, true);
  };
}

// ── Global popup scroll ──────────────────────────────────────────────────────
// A single document-level pointerdown handler that hit-tests the nearest
// scrollable popup element on every tap.  This covers:
//   • Legacy popups (not opened via openDialog — dialogManager never runs)
//   • Async data loads (token grid may be empty when dialog first renders)
//   • All Preact dialogs (belt-and-suspenders alongside the per-dialog path)

const VERTICAL_SCROLL_SEL = '.PopupTokens, .PowerupsPage';
const HORIZONTAL_SCROLL_SEL = '.PopupSelector';

function findScrollTarget(from: Element | null): { el: HTMLElement; axis: 'x' | 'y' } | null {
  let el = from as HTMLElement | null;
  while (el) {
    if (el.matches(VERTICAL_SCROLL_SEL) && el.scrollHeight > el.clientHeight) {
      return { el, axis: 'y' };
    }
    if (el.matches(HORIZONTAL_SCROLL_SEL) && el.scrollWidth > el.clientWidth) {
      return { el, axis: 'x' };
    }
    // Don't walk above the popup container boundary.
    if (el.classList.contains('PopupContainer')) break;
    el = el.parentElement;
  }
  return null;
}

let globalInitialised = false;

/** Call once during app init (or lazily on first openDialog).  The returned
 *  cleanup is only needed if the entire popup system is torn down. */
export function initGlobalPopupScrollDrag(): () => void {
  if (globalInitialised || typeof document === 'undefined') return () => {};
  globalInitialised = true;

  let activeId = -1;
  let dragged = false;
  let scrollEl: HTMLElement | null = null;
  let scrollAxis: 'x' | 'y' = 'y';
  let start = 0;
  let startScroll = 0;

  const coord = (e: PointerEvent) => (scrollAxis === 'x' ? e.clientX : e.clientY);

  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== activeId || !scrollEl) return;
    const delta = coord(e) - start;
    if (!dragged) {
      if (Math.abs(delta) < 4) return;
      dragged = true;
    }
    if (scrollAxis === 'x') scrollEl.scrollLeft = startScroll - delta;
    else scrollEl.scrollTop = startScroll - delta;
    e.preventDefault();
    e.stopPropagation();
  };

  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== activeId) return;
    activeId = -1;
    scrollEl = null;
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    // On mobile, preventDefault() on pointermove suppresses the browser's
    // synthetic click after pointer-up, so onClickCapture never fires and
    // `dragged` stays true — the next genuine tap gets incorrectly eaten.
    // Defer the reset one turn: if a click does fire (desktop), it is
    // still caught and suppressed first; if not (mobile), dragged clears.
    if (dragged)
      setTimeout(() => {
        dragged = false;
      }, 0);
  };

  const onDown = (e: PointerEvent): void => {
    if (activeId !== -1) return;
    // Only act inside a popup container.
    if (!(e.target as Element).closest?.('.PopupContainer')) return;
    const found = findScrollTarget(e.target as Element);
    if (!found) return;
    activeId = e.pointerId;
    dragged = false;
    scrollEl = found.el;
    scrollAxis = found.axis;
    start = coord(e);
    startScroll = scrollAxis === 'x' ? scrollEl.scrollLeft : scrollEl.scrollTop;
    document.addEventListener('pointermove', onMove, { capture: true, passive: false });
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  };

  const onClickCapture = (e: MouseEvent): void => {
    if (!dragged) return;
    dragged = false;
    e.stopPropagation();
    e.preventDefault();
  };

  // Capture phase so we beat the game engine's own document listeners.
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('click', onClickCapture, true);

  return () => {
    globalInitialised = false;
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('click', onClickCapture, true);
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
  };
}
