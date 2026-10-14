// The buy-slots cost must use the shared `toKSNum` price format
// (de-DE grouping, "1.500") like every other price — not "1.5k".

import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { ProjectPopup } from '../../scripts/components/popups/ProjectPopup.js';
import type { PreactDialogHandle } from '../../scripts/components/popups/dialogManager.js';
import type { PowerupCategoryVM, ProjectPopupVM } from '../../scripts/game/powerupView.js';

const cat: PowerupCategoryVM = {
  pkey: 'UpgradePowerup',
  typelower: 'upgrade',
  tabText: '',
  menuLabel: 'Upgrades',
  menuVisible: true,
  selectorTitle: '',
  slots: [],
  sellSubpops: [],
  providedTiles: [],
  providedSubpops: [],
  buySlots: {
    pkey: 'UpgradePowerup',
    title: '',
    subtitle: '',
    description: '',
    slotCost: 1500,
    slotsLeft: 3,
    buttonText: 'Buy',
  },
};

const vm: ProjectPopupVM = {
  spriteHtml: '',
  title: 'Project',
  description: '',
  cached: true,
  tokens: [],
  summaryProfiles: '0',
  summaryRisk: '0',
  summaryRiskUp: false,
  collectMode: false,
  chargeDisabled: false,
  chargeButtonText: '',
  chargeCostText: '',
  chargeTimeText: '',
  categories: [cat],
  initialTab: 'data',
};

it('renders the buy-slots cost with toKSNum grouping', () => {
  const html = renderToString(
    h(ProjectPopup, {
      vm,
      bridge: { current: null },
      onClose: () => {},
      popup: {} as PreactDialogHandle,
    })
  );
  expect(html.match(/<span class="SlotCost"[^>]*>([^<]*)</)?.[1]).toBe('1.500');
});
