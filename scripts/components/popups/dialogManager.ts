// Preact dialog manager for phase 2 of issue #80.  One active dialog
// at a time, mounted into the active view's `popupContainerDomelem`
// inside a `<div class="Popup">` shell, with `.lockOn` + extend-class
// CSS that matches the legacy `RenderPopup` so `css/Render.css` keeps
// working unmodified.  Co-exists with `Render.Popup` during the
// transition: opening a new Preact dialog while another (legacy or
// Preact) is already active closes the existing one first.

import { type ComponentChildren, type ComponentType, h, render } from 'preact';
import setup from '../../setup.js';

// MainSprites.png window (x y, 65x65) for the legacy FX bling icons.
const FX_BLING_POS: Record<string, string> = {
  no_cash: '-401px -737px',
  no_AP: '-336px -737px',
  error: '-362px -860px', // legacy FXError → FXNoAP('bug')
};

/** Extend-class values accepted by `openDialog`.  Each is a CSS hook
 *  in `css/Render.css` (`.PopupContainer.lockOn.<class>`). */
export type ExtendClass = 'Tutorial' | 'Alert' | 'NewItems' | 'LevelUp' | 'Mission';

/** Minimal `addClass` / `removeClass` surface (jQuery-shaped) used by
 *  the FX-feedback `trigger` events. */
interface FXClassTarget {
  addClass(s: string): unknown;
  removeClass(s: string): unknown;
}

/** Minimal jQuery surface used to replicate the legacy SubpopClose
 *  handler when running inside a Preact-managed dialog. */
interface JQueryLikeForSubpop {
  removeClass(cls: string): JQueryLikeForSubpop;
  parents(selector: string): JQueryLikeForSubpop;
  find(selector: string): JQueryLikeForSubpop;
  length: number;
}

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

  // Subpop block below duplicates `RenderTopLevelUI.ts:816` (the legacy
  // jQuery delegated handler on RenderPopup's jdomelem doesn't fire on
  // Preact popups).  Both go away in tier-8 when subpops become Preact
  // components.
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
    if (!subpopCloseEl) return;
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
  };

  const close = (): void => {
    if (!isOpen) return;
    isOpen = false;
    opts.container.removeEventListener('click', handleInteraction);
    opts.container.removeEventListener('touchend', handleInteraction);
    render(null, opts.container);
    opts.container.classList.remove('lockOn', 'PopupPreact', 'PopupPreactBottom');
    if (opts.extendClass) opts.container.classList.remove(opts.extendClass);
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
      if (event === 'no_cash' || event === 'no_AP' || event === 'error') {
        const cls = event === 'error' ? 'ERROR' : event;
        // Mirror legacy RenderPopup.initBaseUI: clear the state from
        // every .Button first, then mark the last-clicked one (or the
        // MainButton if none was tracked).
        for (const b of opts.container.querySelectorAll('.Button')) {
          b.classList.remove('active', 'disabled', 'no_cash', 'no_AP', 'ERROR');
        }
        const lastButton = handle.lastButton;
        if (lastButton) {
          lastButton.removeClass('active');
          lastButton.addClass(`disabled ${cls}`);
        } else {
          const main = opts.container.querySelector('.Button[data-button-id="MainButton"]');
          if (main) {
            main.classList.remove('active');
            main.classList.add('disabled', ...cls.split(' '));
          }
        }
        // DOM port of the legacy FXNoCash/FXNoAP/FXError bling — a
        // RenderSprite on the board layer (occluded by the popup
        // overlay) doesn't work for a Preact dialog, so spawn the
        // sprite-window icon centred in the popup instead.  Self-
        // removes on animationend.
        const bling = document.createElement('div');
        bling.className = 'FXBling';
        bling.style.backgroundImage = `url(${setup.imagePathPrefix}MainSprites.png)`;
        bling.style.backgroundPosition = FX_BLING_POS[event] ?? '-362px -860px';
        bling.addEventListener('animationend', () => bling.remove());
        opts.container.appendChild(bling);
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

  // `onClose` + the live `popup` handle are framework-injected.  Perp
  // components fire `popup.trigger('button_click.ChargeButton',[g,d])`
  // on action-button clicks — exactly what the legacy jQuery `.Button`
  // delegated handler did.  Presentational components ignore `popup`.
  const body = h(opts.component, { ...opts.props, onClose: close, popup: handle });
  const wrapped = h('div', { class: 'Popup' }, body as ComponentChildren);
  render(wrapped, opts.container);

  active = { container: opts.container, extendClass: opts.extendClass, handle };

  return handle;
}
