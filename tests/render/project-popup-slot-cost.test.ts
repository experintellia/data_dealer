// The buy-slots cost must use the shared `toKSNum` price format
// (de-DE grouping, "1.500") like every other price — not "1.5k".

import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import rulesetBase from '../../data/ruleset_base.json' with { type: 'json' };
import { buySlots } from '../../scripts/LocalEngine.js';
import { getState, setState } from '../../scripts/boot.js';
import { ProjectPopup } from '../../scripts/components/popups/ProjectPopup.js';
import type { PreactDialogHandle } from '../../scripts/components/popups/dialogManager.js';
import {
  type PowerupCategoryVM,
  type ProjectPopupVM,
  buildProjectPopupVM,
} from '../../scripts/game/powerupView.js';
import { freshState } from '../../scripts/state.js';

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

it('charges the shown buy-slots cost, also for a slot_cost_modifier perp', async () => {
  // project001: slot_cost 10, slot_cost_modifier 1, 3 upgrade slots.
  const html = renderToString(
    h(ProjectPopup, {
      vm: buildProjectPopupVM(
        {
          slot_cost: rulesetBase.perps.project001.type_data.slot_cost,
          powerupsCached: true,
          powerups_compiled: {
            UpgradePowerup: { slots: [], provided: [], typelower: 'upgrade', slots_left: 7 },
          },
        },
        undefined,
        1
      ),
      bridge: { current: null },
      onClose: () => {},
      popup: {} as PreactDialogHandle,
    })
  );
  const shown = html.match(/<span class="SlotCost"[^>]*>([^<]*)</)?.[1];
  const path = 'Imperium.CityVienna.p1';
  setState({
    ...freshState('t@local'),
    nodes: [
      {
        game_id: 'p1',
        game_type: 'ProjectPerp',
        full_path: path,
        full_type: 'ProjectPerp:project001',
        instance_data: {},
      },
    ],
  });
  const before = getState().game_values.cash_value ?? 0;
  const { result } = await buySlots(path, 'upgrade', 1);
  const after = (result as { game_values: { cash_value: number } }).game_values.cash_value;
  expect(String(before - after)).toBe(shown);
});
