// Minimal Preact-native dialog manager for phase 2 of issue #80.
//
// One active dialog at a time.  Mounts the active dialog's component
// tree into a designated `.PopupContainer` DOM node (the existing
// `popupContainerDomelem` of the active view), wraps it in the same
// `<div class="Popup">` shell the legacy `RenderPopup` produced, and
// manages the `.lockOn` / extend-class CSS so the existing
// `css/Render.css` rules keep working unmodified.
//
// Co-exists with `Render.Popup` during the phase 2 transition:
//   - Tier 1 / 2 Preact-ported dialogs (status info, level-up, new
//     items, tutorial / story / simplemessage) open via `openDialog`.
//   - Tier 3+ legacy templates (mission popups, popup_karma, perp
//     popups) continue to open via `Render.Popup` + the Underscore.js
//     template flow.
//   - Both systems mount into the same `popupContainerDomelem`, so
//     only one is visible at a time.  The manager bails if a legacy
//     popup is already open.
//
// The `EventTarget`-shaped handle returned by `openDialog` exposes the
// `.trigger(event)` / `.open` surface that pre-Preact code paths
// (e.g., `GameRoot.handleBoughtKarma` force-closing a karma incident
// popup) read off `this.renderPopup` / `this.notificationPopup`.

import { type ComponentChildren, type ComponentType, h, render } from 'preact';

/** Minimal jQuery surface used to replicate the legacy SubpopClose
 *  handler when running inside a Preact-managed dialog. */
interface JQueryLikeForSubpop {
  removeClass(cls: string): JQueryLikeForSubpop;
  parents(selector: string): JQueryLikeForSubpop;
  find(selector: string): JQueryLikeForSubpop;
  length: number;
}

/** What `GameRoot.renderPopup` / `.notificationPopup` looked like
 *  before phase 2.  Pre-Preact callers use this surface to trigger
 *  popup_close, render hooks, and FX feedback on the open popup. */
export interface PreactDialogHandle {
  /** `false` once close has run; matches the legacy `RenderPopup.open` flag. */
  open: boolean;
  trigger(event: string, args?: unknown[]): void;
  render(): void;
  close(): void;
}

export interface OpenDialogOptions<P> {
  /** Component to render as the dialog body.  Receives `props` plus an
   *  injected `onClose` callback. */
  component: ComponentType<P & { onClose: () => void }>;
  /** Props passed through to the component.  Snapshot data — the
   *  manager does not re-render. */
  props: P;
  /** The `.PopupContainer` DOM node to mount into.  Caller picks the
   *  active view's container (`groot.renderNode.popupContainerDomelem`). */
  container: HTMLElement;
  /** Optional extra class added alongside `lockOn` (matches the legacy
   *  `extendClass` config field: `Tutorial`, `Alert`, `NewItems`,
   *  `LevelUp`, `Mission`). */
  extendClass?: string;
  /** Fires once after the dialog has been removed from the DOM.  Used
   *  by the notification queue to advance to the next cue. */
  onAfterClose?: () => void;
}

let active: ActiveDialog | null = null;
const subs = new Set<(active: ActiveDialog | null) => void>();

interface ActiveDialog {
  container: HTMLElement;
  extendClass?: string | undefined;
  handle: PreactDialogHandle;
}

function notifyChange(): void {
  for (const sub of subs) sub(active);
}

/** Open a dialog.  If one is already open it's closed first.  Returns
 *  a handle whose `.trigger('popup_close')` (etc.) matches the legacy
 *  `RenderPopup` surface so pre-Preact callers don't need to change. */
export function openDialog<P>(opts: OpenDialogOptions<P>): PreactDialogHandle {
  if (active) active.handle.close();

  let isOpen = true;
  const close = (): void => {
    if (!isOpen) return;
    isOpen = false;
    render(null, opts.container);
    opts.container.classList.remove('lockOn');
    if (opts.extendClass) opts.container.classList.remove(opts.extendClass);
    active = null;
    notifyChange();
    opts.onAfterClose?.();
  };

  const handle: PreactDialogHandle & {
    lastButton?: { addClass(s: string): unknown; removeClass(s: string): unknown };
  } = {
    get open() {
      return isOpen;
    },
    set open(_v: boolean) {
      /* read-only via getter; setter exists to satisfy structural compat */
    },
    trigger(event: string): void {
      if (event === 'popup_close' || event === 'popup_cancel') {
        close();
        return;
      }
      // FX feedback events — `no_cash` / `no_AP` / `error` — mirror the
      // legacy `RenderPopup` handler that adds `.disabled <event>` to
      // `lastButton` (the last `.Button` the player clicked).  Phase-1
      // contract: tests prime `popup.lastButton` then fire the trigger.
      if (event === 'no_cash' || event === 'no_AP' || event === 'error') {
        const cls = event === 'error' ? 'ERROR' : event;
        const lastButton = handle.lastButton;
        if (lastButton) {
          lastButton.removeClass('active');
          lastButton.addClass(`disabled ${cls}`);
        }
      }
    },
    render(): void {
      // No-op: Preact dialogs use snapshot props captured at openDialog
      // time.  Components that need to react to engine data changes
      // should manage their own state via hooks.
    },
    close,
  };

  // Single delegated click handler on the popup container:
  //   - click on the container itself (backdrop) → close
  //   - click on a `.SubpopClose` or `.Button[data-button-id="OKButton"]`
  //     inside a `.Subpop` → strip `.open` from the subpop (mirrors the
  //     legacy `RenderPopup.initBaseUI` delegated handler so tier 5+
  //     subpops dismissed inside Preact popups still close)
  //   - click anywhere else inside the popup body → ignored here
  //     (components handle their own onClick)
  const handleInteraction = (e: Event): void => {
    if (e.target === opts.container) {
      close();
      return;
    }
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const subpopCloseEl = t.closest(
      '.SubpopClose, .Button[data-button-id="OKButton"]'
    ) as HTMLElement | null;
    if (subpopCloseEl) {
      e.stopPropagation();
      e.preventDefault();
      const jq = (globalThis as unknown as { jQuery?: (el: HTMLElement) => JQueryLikeForSubpop })
        .jQuery;
      if (!jq) return;
      const jelem = jq(subpopCloseEl);
      jelem.removeClass('active');
      const tab = jelem.parents('.PopupTab');
      const containerJq = tab.find('.SubpopContainer');
      containerJq.find('.Selector.open').removeClass('hasPopup');
      tab.removeClass('hasPopup');
      const subpop = jelem.parents('.Subpop');
      subpop.removeClass('open');
      if (!containerJq.find('.Subpop.open').length) {
        containerJq.removeClass('open');
      }
    }
  };
  opts.container.addEventListener('click', handleInteraction);
  opts.container.addEventListener('touchend', handleInteraction);

  const cleanup = close;
  const wrappedClose = (): void => {
    opts.container.removeEventListener('click', handleInteraction);
    opts.container.removeEventListener('touchend', handleInteraction);
    cleanup();
  };
  handle.close = wrappedClose;
  const baseTrigger = handle.trigger;
  handle.trigger = (event: string): void => {
    if (event === 'popup_close' || event === 'popup_cancel') {
      wrappedClose();
      return;
    }
    baseTrigger(event);
  };

  opts.container.classList.add('lockOn');
  if (opts.extendClass) opts.container.classList.add(opts.extendClass);

  // Mount: `<div class="Popup"><userComponent onClose={...}/></div>`
  // mirrors the legacy `RenderPopup` jdomelem so CSS selectors like
  // `.PopupContainer .Popup` keep matching.  No `stopPropagation` on
  // the wrapper — clicks bubble up to the container handler above,
  // which only acts on backdrop hits and subpop close affordances.
  const body = h(opts.component, { ...opts.props, onClose: wrappedClose });
  const wrapped = h('div', { class: 'Popup' }, body as ComponentChildren);
  render(wrapped, opts.container);

  active = { container: opts.container, extendClass: opts.extendClass, handle };
  notifyChange();

  return handle;
}

/** Currently active dialog, or `null` if none. */
export function getActiveDialog(): ActiveDialog | null {
  return active;
}

/** Subscribe to active-dialog changes.  Returns an unsubscribe fn. */
export function subscribeActiveDialog(fn: (active: ActiveDialog | null) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
