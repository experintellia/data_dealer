import { useEffect, useState } from 'preact/hooks';
import { span, sprintf, toKSNum, toTime } from '../../dd-helpers.js';
import i18n from '../../i18n.js';
import { PopupShell } from './PopupShell.js';

export interface APStatusPopupProps {
  apValue: number;
  apMax: number;
  /** Milliseconds until the next AP tick. Omit (or pass undefined) when AP is already full. */
  apRemaining?: number | undefined;
  /** Total AP tick interval in ms — drives the progress bar fill. */
  apInterval?: number | undefined;
  onClose: () => void;
}

/** Animated progress bar that fills as time elapses toward the next AP tick. */
function APRefillBar({
  apRemaining,
  apInterval,
}: {
  apRemaining: number;
  apInterval: number | undefined;
}) {
  const [remaining, setRemaining] = useState(apRemaining);

  useEffect(() => {
    const openedAt = Date.now();
    let timer: number;
    const tick = () => {
      const elapsed = Date.now() - openedAt;
      const current = Math.max(0, apRemaining - elapsed);
      setRemaining(current);
      if (current > 0) {
        timer = window.setTimeout(tick, 500);
      }
    };
    timer = window.setTimeout(tick, 500);
    return () => window.clearTimeout(timer);
  }, [apRemaining]);

  const pct =
    apInterval && apInterval > 0 ? Math.min(100, ((apInterval - remaining) / apInterval) * 100) : 0;

  return (
    <div class="APRefillBar">
      <div class="APRefillBarFill" style={{ width: `${pct}%` }} />
      <span class="APRefillBarText">{toTime(remaining)}</span>
    </div>
  );
}

export function APStatusPopup({
  apValue,
  apMax,
  apRemaining,
  apInterval,
  onClose,
}: APStatusPopupProps) {
  const subtitleHtml = sprintf(
    i18n.gettext('sb_AP subtitle %s/%s'),
    span(toKSNum(apValue)),
    span(toKSNum(apMax))
  );
  const showRefill = apValue < apMax && apRemaining != null;
  return (
    <PopupShell
      spriteClass="AP"
      bodyClass="Status"
      title={i18n.gettext('sb_AP title')}
      buttonLabel={i18n.gettext('Close')}
      onClose={onClose}
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted i18n catalog string */}
      <div class="PopupSubTitle" dangerouslySetInnerHTML={{ __html: subtitleHtml }} />
      <div class="PopupText">{i18n.gettext('sb_AP description')}</div>
      {apValue < apMax && apRemaining != null && (
        <>
          <div class="PopupText APRefillLabel">{i18n.gettext('More Energy in')}</div>
          <APRefillBar apRemaining={apRemaining} apInterval={apInterval} />
        </>
      )}
    </PopupShell>
  );
}
