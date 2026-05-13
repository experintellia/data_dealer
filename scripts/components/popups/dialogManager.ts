// Preact dialog manager for phase 2 of issue #80.  One active dialog
// at a time, mounted into the active view's `popupContainerDomelem`
// inside a `<div class="Popup">` shell, with `.lockOn` + extend-class
// CSS that matches the legacy `RenderPopup` so `css/Render.css` keeps
// working unmodified.  Co-exists with `Render.Popup` during the
// transition: opening a new Preact dialog while another (legacy or
// Preact) is already active closes the existing one first.

import { type ComponentChildren, type ComponentType, h, render } from 'preact';

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
  render(): void;
  close(): void;
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
    opts.container.classList.remove('lockOn');
    if (opts.extendClass) opts.container.classList.remove(opts.extendClass);
    active = null;
    opts.onAfterClose?.();
  };

  const handle: PreactDialogHandle = {
    get open() {
      return isOpen;
    },
    trigger(event: string): void {
      if (event === 'popup_close' || event === 'popup_cancel') {
        close();
        return;
      }
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
      // Snapshot props captured at open time; tier 5+ stateful
      // components should manage their own re-renders via hooks.
    },
    close,
  };

  opts.container.addEventListener('click', handleInteraction);
  opts.container.addEventListener('touchend', handleInteraction);
  opts.container.classList.add('lockOn');
  if (opts.extendClass) opts.container.classList.add(opts.extendClass);

  const body = h(opts.component, { ...opts.props, onClose: close });
  const wrapped = h('div', { class: 'Popup' }, body as ComponentChildren);
  render(wrapped, opts.container);

  active = { container: opts.container, extendClass: opts.extendClass, handle };

  return handle;
}
