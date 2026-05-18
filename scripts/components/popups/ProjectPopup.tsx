// Project ("Scheinfirma") perp popup — Preact port of
// `views/popup_project.html` + every partial (computed in
// `scripts/game/powerupView.ts`).  Issue #80 phase 2 tier 7 — the most
// complex perp popup: a 4-entry `.PopupMenu` tab strip, a 3-category
// powerup-slot grid with buy/sell/buy-slots subpops, and the
// `close_powerup` graceful slot-swap animation (legacy DOM-walked via
// jQuery; here driven by component state through a perp-owned bridge).
//
// The Data tab (profileset + Charge/Collect) is structurally identical
// to popup_contact, so it reuses the shared tokenView VM + the
// perpShared TokenTile/TokenSubpop/PageArrows/fireAction pieces.

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type {
  BuySlotsVM,
  PowerupCategoryVM,
  ProjectPopupVM,
  ProvidedPowerupSubpopVM,
  ProvidedPowerupTileVM,
  SellSubpopVM,
} from '../../game/powerupView.js';
import i18n from '../../i18n.js';
import type { PreactDialogHandle } from './dialogManager.js';
import { PageArrows, TokenSubpop, TokenTile, fireAction } from './perpShared.js';

/** Imperative seam used by `ProjectPerp.updatePopupGracefully` to drive
 *  the buy/sell slot plug-out → plug-in animation without re-mounting
 *  (re-mount would cut the animation).  The perp builds the fresh VM
 *  (consistent with `openPopup`) and hands it over here. */
export interface ProjectBridge {
  gracefulSlot(pkey: string, slot: number, selling: boolean, nextVM: ProjectPopupVM): void;
}

export interface ProjectPopupProps {
  vm: ProjectPopupVM;
  /** Stable holder owned by the perp; the component publishes its
   *  bridge here on mount (mirrors how `renderPopup` is parked). */
  bridge: { current: ProjectBridge | null };
  /** Framework-injected by the dialog manager. */
  onClose: () => void;
  /** Framework-injected — the live perp popup handle. */
  popup: PreactDialogHandle;
}

const html = (s: string) => ({ __html: s });

/** One powerup slot tile (`powerup_free`/`_locked`/`powerup.html`). */
function PowerupSlotTile({
  cls,
  bgHtml,
  spriteHtml,
  labelHtml,
  subpopId,
  slot,
  onOpen,
}: {
  cls: string;
  bgHtml: string;
  spriteHtml: string;
  labelHtml: string;
  subpopId: string;
  slot: number;
  onOpen: (() => void) | null;
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass
    <div
      class={cls}
      data-subpop-id={subpopId}
      data-button-data={slot}
      onClick={onOpen ?? undefined}
    >
      <div class="PowerupPerp">
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
        <div class="PowerupBackground" dangerouslySetInnerHTML={html(bgHtml)} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
        <div class="PowerupSprite" dangerouslySetInnerHTML={html(spriteHtml)} />
      </div>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: ruleset label via crlf2html */}
      <div class="PowerupLabel" dangerouslySetInnerHTML={html(labelHtml)} />
    </div>
  );
}

/** `subpop_powerup.html` — the per-slot sell detail card. */
function SellSubpop({
  sub,
  isOpen,
  onClose,
  popup,
}: {
  sub: SellSubpopVM;
  isOpen: boolean;
  onClose: () => void;
  popup: PreactDialogHandle;
}) {
  const close = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };
  // Short local keeps the dangerouslySetInnerHTML line single-line so
  // the biome-ignore attaches (codebase convention, see perpShared).
  // Short locals keep the dangerouslySetInnerHTML lines single-line so
  // the biome-ignore attaches. Legacy subpop_powerup.html emits title /
  // description with `<%= … %>` (raw HTML — ruleset copy can contain a
  // `<div class="TabSubTitle">` etc.), so they render as innerHTML.
  const vd = sub.valuesDetailsHtml;
  const st = sub.title;
  const sx = sub.description;
  return (
    <div class={isOpen ? 'Subpop open' : 'Subpop'} data-subpop-id={sub.subpopId}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
      <div class="SubpopClose" data-button-id="CloseSubpop" onClick={close}>
        X
      </div>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
      <div class="SubpopLogo" dangerouslySetInnerHTML={html(sub.logoHtml)} />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: raw ruleset HTML (legacy <%= %>) */}
      <div class="SubpopTitle" dangerouslySetInnerHTML={html(st)} />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced bonus markup */}
      <div class="PowerupLabelData SubpopLabelData" dangerouslySetInnerHTML={html(vd)} />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: raw ruleset HTML (legacy <%= %>) */}
      <div class="SubpopText" dangerouslySetInnerHTML={html(sx)} />
      <div class="SubpopButtons">
        <div class="ButtonDecorator Cash">
          <div class="RenderSprite Tobi" />
          {sub.sellPriceText}
        </div>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
        <div
          class="Button sell"
          data-button-id="PowerupSellButton"
          data-button-gestalt={sub.gestalt}
          data-button-data={sub.slot}
          data-testid={`dd-powerup-sell-${sub.gestalt}`}
          onClick={(e) => fireAction(popup, e, 'PowerupSellButton', [sub.gestalt, sub.slot])}
        >
          {i18n.gettext('Sell')}
        </div>
      </div>
    </div>
  );
}

/** `subpop_powerup_provided.html` — the buy detail card opened from a
 *  provided tile inside the Selector. */
function ProvidedSubpop({
  sub,
  slot,
  isOpen,
  onClose,
  popup,
}: {
  sub: ProvidedPowerupSubpopVM;
  slot: number;
  isOpen: boolean;
  onClose: () => void;
  popup: PreactDialogHandle;
}) {
  const close = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };
  // Short locals keep the dangerouslySetInnerHTML lines single-line so
  // the biome-ignore attaches. Legacy subpop_powerup_provided.html
  // emits title / description with `<%= … %>` (raw ruleset HTML).
  const vd = sub.valuesDetailsHtml;
  const st = sub.title;
  const sx = sub.description;
  return (
    <div
      class={isOpen ? 'Subpop InSelector open' : 'Subpop InSelector'}
      data-subpop-id={sub.subpopId}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
      <div class="SubpopClose" data-button-id="CloseSubpop" onClick={close}>
        X
      </div>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
      <div class="SubpopLogo" dangerouslySetInnerHTML={html(sub.logoHtml)} />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: raw ruleset HTML (legacy <%= %>) */}
      <div class="SubpopTitle" dangerouslySetInnerHTML={html(st)} />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced bonus markup */}
      <div class="PowerupLabelData SubpopLabelData" dangerouslySetInnerHTML={html(vd)} />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: raw ruleset HTML (legacy <%= %>) */}
      <div class="SubpopText" dangerouslySetInnerHTML={html(sx)} />
      <div class="SubpopButtons">
        <div class="ButtonDecorator Cash">
          <div class="RenderSprite Tobi" />
          {sub.priceText}
        </div>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
        <div
          class="Button"
          data-button-id="PowerupBuyButton"
          data-button-gestalt={sub.gestalt}
          data-button-data={slot}
          data-testid={`dd-powerup-buy-${sub.gestalt}`}
          onClick={(e) => fireAction(popup, e, 'PowerupBuyButton', [sub.gestalt, slot])}
        >
          {sub.buyButtonText}
        </div>
      </div>
    </div>
  );
}

/** One provided buy-grid tile (`powerup_provided.html`). */
function ProvidedTile({
  tile,
  onOpen,
}: {
  tile: ProvidedPowerupTileVM;
  onOpen: (() => void) | null;
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass
    <div
      class={tile.locked ? 'Powerup provided locked' : 'Powerup provided'}
      data-subpop-id={`Provided${tile.gestalt}`}
      data-gestalt={tile.gestalt}
      onClick={onOpen ?? undefined}
    >
      <div class="PowerupPerp">
        {tile.newBadge ? <div class="new">{i18n.gettext('New!')}</div> : null}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
        <div class="PowerupBackground" dangerouslySetInnerHTML={html(tile.backgroundHtml)} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
        <div class="PowerupSprite" dangerouslySetInnerHTML={html(tile.spriteHtml)} />
      </div>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: ruleset label via crlf2html */}
      <div class="PowerupLabel" dangerouslySetInnerHTML={html(tile.labelHtml)} />
      <div class="PowerupLabelData">
        <div class="Price">
          <div class="Buy Cash" />
          {tile.priceText}
        </div>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced values / requires markup */}
        <div style="display:contents" dangerouslySetInnerHTML={html(tile.dataHtml)} />
      </div>
    </div>
  );
}

/** `selector_powerups.html` — the paged buy grid (`.Subpop.Selector`). */
function BuySelectorSubpop({
  cat,
  isOpen,
  hasPopup,
  page,
  setPage,
  onProvidedOpen,
  onClose,
}: {
  cat: PowerupCategoryVM;
  isOpen: boolean;
  hasPopup: boolean;
  page: number;
  setPage: (next: (p: number) => number) => void;
  onProvidedOpen: (gestalt: string) => void;
  onClose: () => void;
}) {
  const close = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };
  const size = cat.selectorPageSize;
  const pageCount = Math.max(1, Math.ceil(cat.providedTiles.length / size));
  const pageTiles = cat.providedTiles.slice(page * size, page * size + size);
  let cls = 'Subpop Selector';
  if (isOpen) cls += ' open';
  if (hasPopup) cls += ' hasPopup';
  return (
    <div class={cls} data-subpop-id={`Provided${cat.pkey}`}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
      <div class="SubpopClose" data-button-id="CloseSubpop" onClick={close}>
        X
      </div>
      <div class="SubpopHeader">
        <div class="SubpopHeaderTitle">{cat.selectorTitle}</div>
      </div>
      <div class="Pagination Selector">
        <div class="PopupSelector">
          <div class="PopupPageWrap">
            <div class="PopupPage PowerupPage" data-page-id={page}>
              {pageTiles.map((t) => (
                <ProvidedTile
                  key={t.gestalt}
                  tile={t}
                  onOpen={t.locked ? null : () => onProvidedOpen(t.gestalt)}
                />
              ))}
            </div>
          </div>
        </div>
        <PageArrows page={page} pageCount={pageCount} setPage={setPage} />
      </div>
      <div class="SubpopButtons">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
        <div class="Button" data-button-id="OKButton" onClick={close}>
          {i18n.gettext('Close')}
        </div>
      </div>
    </div>
  );
}

/** `subpop_buyslots.html` — the +/- buy-slots card (counter is local
 *  state; legacy did the same via jQuery attr round-trips). */
function BuySlotsSubpop({
  bs,
  isOpen,
  onClose,
  popup,
}: {
  bs: BuySlotsVM;
  isOpen: boolean;
  onClose: () => void;
  popup: PreactDialogHandle;
}) {
  const [num, setNum] = useState(1);
  const close = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };
  // Legacy BuySlotsInc: num+1 > slots_left ? num : num+1; Dec: max(1).
  const dec = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    setNum((n) => (n - 1 < 1 ? 1 : n - 1));
  };
  const inc = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    setNum((n) => (n + 1 > bs.slotsLeft ? n : n + 1));
  };
  // Legacy subpop_buyslots.html emits title / subtitle / description
  // with `<%= … %>` (raw ruleset HTML); short locals keep the
  // dangerouslySetInnerHTML lines single-line so the biome-ignore
  // attaches. Description sits inline before .BuySlotsWrap (legacy
  // renders both inside .SubpopText), so it's a display:contents span.
  const bt = bs.title;
  const bsub = bs.subtitle;
  const bd = bs.description;
  return (
    <div class={isOpen ? 'Subpop open' : 'Subpop'} data-subpop-id="buyslots">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
      <div class="SubpopClose" data-button-id="CloseSubpop" onClick={close}>
        X
      </div>
      <div class="SubpopLogo">
        <div class="BuySlotsLogo" />
      </div>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: raw ruleset HTML (legacy <%= %>) */}
      <div class="SubpopTitle" dangerouslySetInnerHTML={html(bt)} />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: raw ruleset HTML (legacy <%= %>) */}
      <div class="SubpopSubTitle" dangerouslySetInnerHTML={html(bsub)} />
      <div class="SubpopText">
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: raw ruleset HTML (legacy <%= %>) */}
        <span style="display:contents" dangerouslySetInnerHTML={html(bd)} />
        <div class="BuySlotsWrap">
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
          <div class="BuySlotsDec ButtonInc" onClick={dec}>
            -
          </div>
          <div class="BuySlotsNumWrap">
            <div class="BuySlotsNum">{num}</div>/<div class="BuySlotsNumLeft">{bs.slotsLeft}</div>
          </div>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
          <div class="BuySlotsInc ButtonDec" onClick={inc}>
            +
          </div>
        </div>
      </div>
      <div class="SubpopButtons">
        <div class="ButtonDecorator Cash">
          <div class="RenderSprite Tobi" />
          <span class="SlotCost" data-slot-cost={bs.slotCost}>
            {numToK(bs.slotCost * num)}
          </span>
        </div>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
        <div
          class="Button"
          data-button-id="PowerupBuySlotsButton"
          data-button-gestalt={`buyslots:${bs.pkey}`}
          data-button-data={num}
          onClick={(e) =>
            fireAction(popup, e, 'PowerupBuySlotsButton', [`buyslots:${bs.pkey}`, num])
          }
        >
          {bs.buttonText}
        </div>
      </div>
    </div>
  );
}

// Local KS formatter for the live slot-cost*num (mirrors dd-helpers
// toKSNum's k/M rounding without importing the game helper into a
// component — the cost values here are already integers).
function numToK(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1_000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

export function ProjectPopup({ vm: initialVm, bridge, onClose, popup }: ProjectPopupProps) {
  const [vm, setVm] = useState(initialVm);
  const [activeTab, setActiveTab] = useState(initialVm.initialTab);
  // Data-tab profileset token subpop (Contact-shaped).
  const [openToken, setOpenToken] = useState<string | null>(null);
  const [tokenPage, setTokenPage] = useState(0);
  // Powerup-tab subpop state. `selPkey` = which category's buy Selector
  // is open; `subId` = a card open on top (sell `<pkey><slot>`,
  // `buyslots`, or an InSelector `Provided<gestalt>`).
  const [selPkey, setSelPkey] = useState<string | null>(null);
  const [subId, setSubId] = useState<string | null>(null);
  // The free-slot index the Selector was opened from — legacy stamps
  // it onto the buy buttons (`data-button-data`) so `PowerupBuyButton`
  // forwards `[gestalt, slot]` to `BuyPowerup(gestalt, slot)`.
  const [buySlot, setBuySlot] = useState(0);
  const [slotPage, setSlotPage] = useState<Record<string, number>>({});
  const [selPage, setSelPage] = useState<Record<string, number>>({});
  // Single in-flight slot animation (buy/sell touches one slot).
  const [anim, setAnim] = useState<{ key: string; phase: 'out' | 'in' } | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = (): void => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  };
  const closeSubpops = (): void => {
    setSelPkey(null);
    setSubId(null);
  };

  // Publish the graceful-slot bridge + register the `close_powerup`
  // seam (the dialog manager dispatches arbitrary `.trigger` events to
  // `.on` listeners; legacy bound this on RenderPopup, gone for Preact).
  // popup/bridge are stable for the dialog's lifetime — mount-only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only seam registration
  useEffect(() => {
    bridge.current = {
      gracefulSlot(pkey, slot, selling, nextVM) {
        const key = `${pkey}:${slot}`;
        setAnim({ key, phase: 'out' });
        timers.current.push(
          setTimeout(() => {
            setVm(nextVM);
            setAnim({ key, phase: 'in' });
            setNewKey(selling ? null : key);
            timers.current.push(setTimeout(() => setAnim(null), 400));
          }, 400)
        );
      },
    };
    const onClosePowerup = (_e: unknown, cb?: unknown): void => {
      closeSubpops();
      if (typeof cb === 'function') {
        // 400ms matches the legacy `setTimeout(cb, 400)` — lets the
        // subpop scale-out play before the slot swap / re-mount.
        timers.current.push(setTimeout(() => (cb as () => void)(), 400));
      }
    };
    popup.on('close_powerup', onClosePowerup);
    return () => {
      clearTimers();
      bridge.current = null;
    };
  }, []);

  const switchTab = (tab: string): void => {
    if (tab === activeTab) return;
    closeSubpops();
    setActiveTab(tab);
    popup.trigger('tab_change', [tab]);
  };

  const closeX = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };

  // SubpopClose / OKButton: close the topmost (InSelector/sell/buyslots
  // first, then the Selector) — mirrors the legacy delegated handler.
  const closeTopSubpop = (): void => {
    if (subId !== null) setSubId(null);
    else setSelPkey(null);
  };

  const slotClass = (pkey: string, slot: number, kind: 'free' | 'locked' | 'taken'): string => {
    const base = kind === 'locked' ? 'Powerup' : `Powerup ${kind}`;
    if (anim && anim.key === `${pkey}:${slot}`) {
      return anim.phase === 'out' ? `${base} updating hide` : 'Powerup updating';
    }
    if (newKey === `${pkey}:${slot}` && kind === 'taken') return `${base} new`;
    return base;
  };

  const dataActive = activeTab === 'data';
  // Legacy popup_project.html emits the tab/description copy with
  // `<%= … %>` (raw HTML — it contains a `<div class="TabSubTitle">`
  // prefix), so these render as innerHTML, not escaped text.
  const desc = vm.description;
  const dataTabCls = dataActive ? 'PopupText TabText' : 'PopupText TabText hidden';
  const tokPageCount = Math.max(1, Math.ceil(vm.tokens.length / vm.pageSize));
  const pageTokens = vm.tokens.slice(
    tokenPage * vm.pageSize,
    tokenPage * vm.pageSize + vm.pageSize
  );

  return (
    <div class="PopupBody ProjectPerp">
      <div class="PopupHeader">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
        <div class="PopupClose" onClick={closeX}>
          X
        </div>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
        <div class="PopupLogo" dangerouslySetInnerHTML={html(vm.spriteHtml)} />
        <div class="PopupTitle">{vm.title}</div>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: raw ruleset HTML (legacy <%= %> tab copy) */}
        <div class={dataTabCls} data-tab="data" dangerouslySetInnerHTML={html(desc)} />
        {vm.categories.map((c) => {
          const tcls = activeTab === c.pkey ? 'PopupText TabText' : 'PopupText TabText hidden';
          const tt = c.tabText;
          return (
            // biome-ignore lint/security/noDangerouslySetInnerHtml: raw ruleset HTML (legacy <%= %> tab copy)
            <div key={c.pkey} class={tcls} data-tab={c.pkey} dangerouslySetInnerHTML={html(tt)} />
          );
        })}
        <div class="PopupMenu">
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
          <div
            class={dataActive ? 'PopupMenuButton active' : 'PopupMenuButton'}
            data-tab="data"
            onClick={() => switchTab('data')}
          >
            {i18n.gettext('Data')}
          </div>
          {vm.categories
            .filter((c) => c.menuVisible)
            .map((c) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass
              <div
                key={c.pkey}
                class={activeTab === c.pkey ? 'PopupMenuButton active' : 'PopupMenuButton'}
                data-tab={c.pkey}
                onClick={() => switchTab(c.pkey)}
              >
                {c.menuLabel}
              </div>
            ))}
        </div>
      </div>
      <div class="PopupContent">
        <div class="PopupTab data" data-tab="data" style={dataActive ? undefined : 'display:none'}>
          <div class={openToken ? 'SubpopContainer open' : 'SubpopContainer'}>
            {vm.tokens.map((t) => (
              <TokenSubpop
                key={t.gestalt}
                token={t}
                isOpen={openToken === t.gestalt}
                onClose={() => setOpenToken(null)}
              />
            ))}
          </div>
          <div class="Pagination">
            <div class="PopupTokens">
              <div class="PopupPageWrap">
                <div class="PopupPage" data-page-id={tokenPage}>
                  {pageTokens.map((t) => (
                    <TokenTile key={t.gestalt} token={t} onOpen={setOpenToken} />
                  ))}
                </div>
              </div>
            </div>
            <PageArrows page={tokenPage} pageCount={tokPageCount} setPage={setTokenPage} />
          </div>
          <div class="PopupSummary">
            <div class="PopupSummaryItem Profiles">
              <div class="RenderSprite Tobi" />
              {vm.summaryProfiles}
            </div>
            <div class={`PopupSummaryItem Risk ${vm.summaryRiskUp ? 'Up' : 'Down'}`}>
              <div class="RenderSprite Tobi" />
              {vm.summaryRisk}
            </div>
          </div>
          {vm.collectMode ? (
            <div class="PopupButtons">
              <div class="ButtonDecorator AP">
                <div class="RenderSprite Tobi" />1
              </div>
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
              <div
                class="Button"
                data-button-id="CollectButton"
                data-testid="dd-collect-button"
                onClick={(e) => fireAction(popup, e, 'CollectButton')}
              >
                {i18n.gettext('Collect')}
              </div>
            </div>
          ) : (
            <div class="PopupButtons">
              <div class="ButtonDecorator Cash">
                <div class="RenderSprite Tobi" />
                {vm.chargeCostText}
              </div>
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
              <div
                class={vm.chargeDisabled ? 'Button disabled' : 'Button'}
                data-button-id="ChargeButton"
                data-testid="dd-charge-button"
                onClick={(e) => fireAction(popup, e, 'ChargeButton')}
              >
                {vm.chargeButtonText}
              </div>
              <div class="ButtonDecorator Time">
                <div class="RenderSprite Tobi" />
                {vm.chargeTimeText}
              </div>
            </div>
          )}
        </div>

        {!vm.cached ? (
          <div class="PopupContentLoading">
            <div class="LoadingSpinner" />
            {i18n.gettext('Loading...')}
          </div>
        ) : null}
        {vm.cached
          ? vm.categories.map((cat) => {
              const tabOpen = activeTab === cat.pkey;
              // Subpops only ever open in the active tab (a slot in a
              // hidden tab can't be clicked, and tab-switch closes
              // subpops), so scope `subId` here — `buyslots` is the one
              // subpop-id shared across all three categories.
              const sub = tabOpen ? subId : null;
              const selOpen = selPkey === cat.pkey;
              const containerOpen = selOpen || sub !== null;
              const inSelectorOpen = sub !== null && sub.startsWith('Provided');
              const size = cat.pageSize;
              const sp = slotPage[cat.pkey] ?? 0;
              const pageCount = Math.max(1, Math.ceil(cat.slots.length / size));
              const pageSlots = cat.slots.slice(sp * size, sp * size + size);
              return (
                <div
                  key={cat.pkey}
                  class={
                    containerOpen
                      ? `PopupTab Powerups ${cat.pkey} hasPopup`
                      : `PopupTab Powerups ${cat.pkey}`
                  }
                  data-tab={cat.pkey}
                  style={tabOpen ? undefined : 'display:none'}
                >
                  <div class={containerOpen ? 'SubpopContainer open' : 'SubpopContainer'}>
                    {cat.sellSubpops.map((s) => (
                      <SellSubpop
                        key={s.subpopId}
                        sub={s}
                        isOpen={sub === s.subpopId}
                        onClose={closeTopSubpop}
                        popup={popup}
                      />
                    ))}
                    <BuySelectorSubpop
                      cat={cat}
                      isOpen={selOpen}
                      hasPopup={selOpen && inSelectorOpen}
                      page={selPage[cat.pkey] ?? 0}
                      setPage={(next) =>
                        setSelPage((m) => ({ ...m, [cat.pkey]: next(m[cat.pkey] ?? 0) }))
                      }
                      onProvidedOpen={(g) => setSubId(`Provided${g}`)}
                      onClose={closeTopSubpop}
                    />
                    {cat.providedSubpops.map((s) => (
                      <ProvidedSubpop
                        key={s.subpopId}
                        sub={s}
                        slot={buySlot}
                        isOpen={sub === s.subpopId}
                        onClose={closeTopSubpop}
                        popup={popup}
                      />
                    ))}
                    <BuySlotsSubpop
                      bs={cat.buySlots}
                      isOpen={sub === 'buyslots'}
                      onClose={closeTopSubpop}
                      popup={popup}
                    />
                  </div>
                  <div class="Pagination">
                    <div class="PowerupsPage">
                      <div class="PopupPageWrap">
                        <div class="PopupPage PowerupPage" data-page-id={sp}>
                          {pageSlots.map((slot) => {
                            const open =
                              slot.kind === 'free'
                                ? () => {
                                    setSubId(null);
                                    setBuySlot(slot.slot);
                                    setSelPkey(cat.pkey);
                                  }
                                : slot.kind === 'locked'
                                  ? () => {
                                      setSelPkey(null);
                                      setSubId('buyslots');
                                    }
                                  : () => {
                                      setSelPkey(null);
                                      setSubId(slot.subpopId);
                                    };
                            const isUpdating =
                              anim !== null && anim.key === `${cat.pkey}:${slot.slot}`;
                            return (
                              <PowerupSlotTile
                                key={`${cat.pkey}:${slot.slot}`}
                                cls={slotClass(cat.pkey, slot.slot, slot.kind)}
                                bgHtml={slot.backgroundHtml}
                                spriteHtml={slot.spriteHtml}
                                labelHtml={slot.labelHtml}
                                subpopId={slot.subpopId}
                                slot={slot.slot}
                                onOpen={isUpdating ? null : open}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <PageArrows
                      page={sp}
                      pageCount={pageCount}
                      setPage={(next) =>
                        setSlotPage((m) => ({ ...m, [cat.pkey]: next(m[cat.pkey] ?? 0) }))
                      }
                    />
                  </div>
                </div>
              );
            })
          : null}
      </div>
    </div>
  );
}
