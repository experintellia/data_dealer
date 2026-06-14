// Pointer-drag-to-scroll shared by PopupMenu (horizontal tab strip) and
// dialogManager (vertical .PopupContent + horizontal .PopupSelector /
// .PopupTokens).  Uses pointer events so the game engine's native touch
// handlers — which call preventDefault() and suppress browser-native panning
// — cannot interfere.  CSS `touch-action` on the caller's element frees the
// relevant axis so the browser synthesises pointer events from touch input.

/** Attach drag-to-scroll to `el` on the given axis.  Returns a cleanup fn. */
export function attachDragScroll(el: HTMLElement, axis: 'x' | 'y'): () => void {
  let down = false;
  let dragged = false;
  let start = 0;
  let startScroll = 0;

  const coord = (e: PointerEvent) => (axis === 'x' ? e.clientX : e.clientY);

  const onPointerDown = (e: PointerEvent): void => {
    down = true;
    dragged = false;
    start = coord(e);
    startScroll = axis === 'x' ? el.scrollLeft : el.scrollTop;
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!down) return;
    const delta = coord(e) - start;
    if (!dragged) {
      if (Math.abs(delta) < 4) return;
      dragged = true;
      el.setPointerCapture(e.pointerId);
    }
    if (axis === 'x') el.scrollLeft = startScroll - delta;
    else el.scrollTop = startScroll - delta;
    e.preventDefault();
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (dragged) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
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

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('click', onClickCapture, true);

  return () => {
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerUp);
    el.removeEventListener('click', onClickCapture, true);
  };
}
