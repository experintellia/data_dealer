// Pointer-drag-to-scroll shared by PopupMenu (horizontal tab strip) and
// dialogManager (vertical .PopupContent + horizontal .PopupSelector /
// .PopupTokens).  Uses pointer events so the game engine's native touch
// handlers (which call preventDefault on touchstart) cannot interfere.
//
// Why document-level listeners instead of element + setPointerCapture:
// Calling setPointerCapture on a scrollable element (overflow-y:auto) during
// a vertical gesture causes Chrome/Safari to fire pointercancel immediately
// because the browser detects a conflict between pointer capture and its own
// scroll handling, even when touch-action:none is set.  Attaching move/up
// listeners to document at capture phase sidesteps this entirely — we never
// touch setPointerCapture, and the events arrive before the game engine's
// own document listeners can swallow them.

/** Attach drag-to-scroll to `el` on the given axis.  Returns a cleanup fn. */
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
  };

  const onDown = (e: PointerEvent): void => {
    if (activeId !== -1) return; // ignore second touch while dragging
    activeId = e.pointerId;
    dragged = false;
    start = coord(e);
    startScroll = axis === 'x' ? el.scrollLeft : el.scrollTop;
    // Capture-phase document listeners intercept moves before anything else
    // (including the game engine) and prevent double-scroll from the browser.
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
