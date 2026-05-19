// Shared `.PopupMenu` tab strip — the `<div class="PopupMenu">` +
// N × `<div class="PopupMenuButton[ active]" data-tab onClick>` block
// that CityPopup and ProjectPopup emitted identically.  Presentational
// only: the per-dialog `switchTab` *behaviour* (subpop close, bridge,
// tab_change / lastTab) stays in the caller — just like <PopupHeader>
// keeps the close handler's callers' concerns out of the markup.

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
  return (
    <div class="PopupMenu">
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
