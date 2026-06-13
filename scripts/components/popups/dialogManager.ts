// Preact dialog manager for phase 2 of issue #80.  One active dialog
// at a time, mounted into the active view's `popupContainerDomelem`
// inside a `<div class="Popup">` shell, with `.lockOn` + extend-class
// CSS that matches the legacy `RenderPopup` so `css/Render.css` keeps
// working unmodified.  Co-exists with `Render.Popup` during the
// transition: opening a new Preact dialog while another (legacy or
// Preact) is already active closes the existing one first.

import { type ComponentChildren, type ComponentType, type JSX, h, render } from 'preact';
import setup from '../../setup.js';

// MainSprites.png window (x y, 65x65) for the legacy FX bling icons.
const FX_BLING_BUG = '-362px -860px'; // legacy FXError → FXNoAP('bug')
// Container-local px the FX bling is lifted above the click point.
const FX_BLING_Y_OFFSET = 20;
const FX_BLING_POS: Record<string, string> = {
  no_cash: '-401px -737px',
  no_AP: '-336px -737px',
  error: FX_BLING_BUG,
};

/** Mirror legacy `RenderPopup.on('no_cash'|'no_AP'|'error')`: reset the
 *  state from every `.Button`, mark the last-clicked one (or MainButton
 *  fallback), and spawn the floating bling icon — DOM-ported because a
 *  Preact dialog has no render node and the board layer is occluded by
 *  the popup overlay. */
const FX_RESET_CLASSES = ['active', 'disabled', 'no_cash', 'no_AP', 'ERROR'];

function applyFxFeedback(
  event: string,
  container: HTMLElement,
  lastButton: FXClassTarget | undefined,
  point: { x: number; y: number } | undefined
): void {
  const cls = event === 'error' ? 'ERROR' : event;
  // Reset only the FX classes from every button — `disabled` is owned
  // by the VM and the snapshot component never re-renders to restore
  // it, so clearing it here would wrongly enable a VM-disabled button.
  // The marked button still gets `disabled ${cls}` below (it was
  // clicked, so it was enabled) and resetMarked() clears that.
  for (const b of container.querySelectorAll('.Button')) {
    b.classList.remove('active', 'no_cash', 'no_AP', 'ERROR');
  }
  const mainFallback = container.querySelector('.Button[data-button-id="MainButton"]');
  const target = lastButton ?? (mainFallback ? toFXTarget(mainFallback) : undefined);
  let resetMarked: () => void = () => {};
  if (target) {
    target.removeClass('active');
    target.addClass(`disabled ${cls}`);
    resetMarked = () => target.removeClass(FX_RESET_CLASSES.join(' '));
  }
  const bling = document.createElement('div');
  // Legacy FXNoCash spins/drops in; FXNoAP (and FXError, which is
  // FXNoAP('bug')) scales up with no rotation and drifts upward — two
  // distinct cues, so no_AP/error get a separate keyframe.
  bling.className = event === 'no_cash' ? 'FXBling' : 'FXBling FXBlingNoAP';
  bling.style.backgroundImage = `url(${setup.imagePathPrefix}MainSprites.png)`;
  bling.style.backgroundPosition = FX_BLING_POS[event] ?? FX_BLING_BUG;
  // Convert the click's screen coords into the container's local
  // space — the game scales the viewport, so a plain client-coord
  // offset would be off by the scale factor.
  if (point) {
    const rect = container.getBoundingClientRect();
    const scaleX = rect.width / container.clientWidth || 1;
    const scaleY = rect.height / container.clientHeight || 1;
    bling.style.position = 'absolute';
    bling.style.left = `${(point.x - rect.left) / scaleX}px`;
    bling.style.top = `${(point.y - rect.top) / scaleY - FX_BLING_Y_OFFSET}px`;
  }
  bling.addEventListener('animationend', () => {
    bling.remove();
    resetMarked();
  });
  container.appendChild(bling);
}

/** Extend-class values accepted by `openDialog`.  Each is a CSS hook
 *  in `css/Render.css` (`.PopupContainer.lockOn.<class>`). */
export type ExtendClass = 'Tutorial' | 'Alert' | 'NewItems' | 'LevelUp' | 'Mission';

/** Minimal `addClass` / `removeClass` surface (jQuery-shaped) used by
 *  the FX-feedback `trigger` events.  Exported so perp components
 *  typing `popup.lastButton` share the contract. */
export interface FXClassTarget {
  addClass(s: string): unknown;
  removeClass(s: string): unknown;
}

/** Popup close click handler — `stopPropagation` so the dialog
 *  manager's backdrop click (which also closes) doesn't double-fire,
 *  then `onClose`.  Every `.PopupClose` / `.SubpopClose` reproduced
 *  this 3-liner verbatim. */
export function stopAndClose(
  onClose: () => void
): (e: JSX.TargetedMouseEvent<HTMLDivElement>) => void {
  return (e) => {
    e.stopPropagation();
    onClose();
  };
}

/** Wrap a button element as an `FXClassTarget` so `no_cash`/`no_AP`/
 *  `error` FX targets the element the player clicked, mirroring the
 *  legacy jQuery handler's `node.lastButton = $(this)`.  Shared by perp
 *  components (`popup.lastButton`) and the MainButton fallback here. */
export function toFXTarget(el: Element): FXClassTarget {
  return {
    addClass: (s) => {
      for (const c of s.split(' ')) if (c) el.classList.add(c);
    },
    removeClass: (s) => {
      for (const c of s.split(' ')) if (c) el.classList.remove(c);
    },
  };
}

const FX_EVENTS = new Set(['no_cash', 'no_AP', 'error']);

/** Compatibility-shaped handle returned by `openDialog`.  Pre-Preact
 *  callers read it off `groot.renderPopup` / `groot.notificationPopup`
 *  via the same `.trigger(event)` / `.open` / `.close()` surface the
 *  legacy `RenderPopup` exposes. */
export interface PreactDialogHandle {
  readonly open: boolean;
  trigger(event: string, args?: unknown[]): void;
  /** Register a listener (legacy `RenderPopupLike.on` shape).  Lets
   *  `GameNode.initPopupEvents` bind `button_click.X` handlers to a
   *  Preact-managed perp popup unchanged. */
  on(event: string, handler: (...a: unknown[]) => void): void;
  render(): void;
  close(cb?: () => void): void;
  /** Last button the player clicked.  Set externally (phase-1 test
   *  contract; tier 5+ buy-button code) — read by `no_cash` /
   *  `no_AP` / `error` triggers. */
  lastButton?: FXClassTarget;
  /** Viewport coords of the last action click — the FX bling is pinned
   *  here (legacy spawned the cue at the click/tap point). */
  lastButtonPoint?: { x: number; y: number };
}

export interface OpenDialogOptions<P> {
  component: ComponentType<P & { onClose: () => void }>;
  props: P;
  /** Active view's `popupContainerDomelem`. */
  container: HTMLElement;
  /** Optional extra class — typically one of `ExtendClass`, but kept as
   *  `string` so legacy call sites and forward extensions don't need to
   *  thread the literal type through every config. */
  extendClass?: string;
  /** Dock the dialog at the bottom of the viewport instead of centred
   *  (legacy `RenderPopup.placeBottom` — Tutorial / Story / LevelUp). */
  placeBottom?: boolean;
  /** Fires once the dialog has been removed from the DOM. */
  onAfterClose?: () => void;
}

interface ActiveDialog {
  container: HTMLElement;
  extendClass?: string | undefined;
  handle: PreactDialogHandle;
}

let active: ActiveDialog | null = null;

export function openDialog<P>(opts: OpenDialogOptions<P>): PreactDialogHandle {
  if (active) active.handle.close();

  let isOpen = true;

  // Mount into a fresh full-screen overlay appended to the render
  // container (a sibling of `.Stage`), so the backdrop escapes the
  // Stage's `overflow:hidden` + transform and covers the whole screen;
  // the dialog is CSS-centred within it.  `opts.container` is only used
  // to locate the render container — it is repointed at the overlay so
  // the rest of this function is container-agnostic.
  const rc = opts.container.closest<HTMLElement>(setup.renderContainer);
  let ownContainer: HTMLElement | null = null;
  if (rc) {
    ownContainer = document.createElement('div');
    ownContainer.className = 'PopupContainer PopupFullViewport';
    rc.appendChild(ownContainer);
    opts.container = ownContainer;
  }

  // The full-screen overlay is transparent (it carries only the
  // vignette box-shadow), so the menu shows through it.  Dim the menu
  // while a dialog is open (CSS `.MainMenu.DialogLock`) so it reads as
  // part of the darkened backdrop.  Clicks over the menu land on the
  // overlay (which sits above it) and dismiss via `handleInteraction`.
  const lockMenu = rc?.querySelector<HTMLElement>('.MainMenu') ?? null;

  // Backdrop click / tap closes the dialog.  Subpop close controls are
  // Preact components owning their own `onClose` — no legacy jQuery
  // delegation here: it mutated Preact-owned DOM behind the vdom's back
  // and, on touch, its `preventDefault()` on `touchend` suppressed the
  // `click` that drives `onClose`, desyncing state so a closed subpop
  // could not be reopened.
  const handleInteraction = (e: Event): void => {
    if (e.target === opts.container) {
      // Consume the event so the backdrop tap can't fall through to the
      // game underneath — on touch, `close()` removes the overlay
      // before the synthesized click fires, so without preventDefault
      // that click would land on whatever is now exposed.
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  };

  const close = (): void => {
    if (!isOpen) return;
    isOpen = false;
    opts.container.removeEventListener('click', handleInteraction);
    opts.container.removeEventListener('touchend', handleInteraction);
    render(null, opts.container);
    // `.FXBling` is created outside the Preact tree (raw appendChild),
    // so `render(null, …)` won't reap an in-flight one — drop it
    // explicitly or it orphans (listener + visual) on early close.
    for (const b of opts.container.querySelectorAll('.FXBling')) b.remove();
    opts.container.classList.remove('lockOn', 'PopupPreact', 'PopupPreactBottom');
    if (opts.extendClass) opts.container.classList.remove(opts.extendClass);
    lockMenu?.classList.remove('DialogLock');
    ownContainer?.remove();
    active = null;
    opts.onAfterClose?.();
  };

  // Listener registry — the emitter half of the legacy `popup` seam.
  // `GameNode.initPopupEvents` does `p.on('button_click.ChargeButton',
  // fn)`; perp Preact components fire
  // `popup.trigger('button_click.ChargeButton', [g, d])` on click.
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  // Minimal event stub — `GameNode._stopProp` only probes
  // `.stopPropagation`; handlers also call `.preventDefault`.
  const evStub = { stopPropagation() {}, preventDefault() {} };

  const handle: PreactDialogHandle = {
    get open() {
      return isOpen;
    },
    on(event: string, fn: (...a: unknown[]) => void): void {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(fn);
    },
    trigger(event: string, args?: unknown[]): void {
      if (event === 'popup_close' || event === 'popup_cancel') {
        close();
        return;
      }
      if (FX_EVENTS.has(event)) {
        applyFxFeedback(event, opts.container, handle.lastButton, handle.lastButtonPoint);
      }
      const set = listeners.get(event);
      if (set) for (const fn of set) fn(evStub, ...(args ?? []));
    },
    render(): void {
      // Snapshot props captured at open time; tier 5+ stateful
      // components manage their own re-renders via hooks.
    },
    close(cb?: () => void): void {
      close();
      cb?.();
    },
  };

  opts.container.addEventListener('click', handleInteraction);
  opts.container.addEventListener('touchend', handleInteraction);
  opts.container.classList.add('lockOn', 'PopupPreact');
  if (opts.placeBottom) opts.container.classList.add('PopupPreactBottom');
  if (opts.extendClass) opts.container.classList.add(opts.extendClass);
  lockMenu?.classList.add('DialogLock');

  // `onClose` + the live `popup` handle are framework-injected.  Perp
  // components fire `popup.trigger('button_click.ChargeButton',[g,d])`
  // on action-button clicks — exactly what the legacy jQuery `.Button`
  // delegated handler did.  Presentational components ignore `popup`.
  const body = h(opts.component, { ...opts.props, onClose: close, popup: handle });
  // Mirror legacy RenderPopup: the extend-class lives on the `.Popup`
  // element too (not just `.PopupContainer`), so `.Popup.Tutorial` /
  // `.Popup.LevelUp` / `.Popup.Mission` / `.Popup.NewItems` /
  // `.Popup.Alert` rules (border:none, margins, …) actually match.
  const wrapped = h(
    'div',
    { class: opts.extendClass ? `Popup ${opts.extendClass}` : 'Popup' },
    body as ComponentChildren
  );
  render(wrapped, opts.container);

  active = { container: opts.container, extendClass: opts.extendClass, handle };

  return handle;
}
