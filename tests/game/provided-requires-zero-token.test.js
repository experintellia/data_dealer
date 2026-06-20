// Regression: the "Requires" / "Benötigt" block on a locked supertoken
// buy tile must list every still-needed required token — including ones
// that are present in DBTokens but with a zero count.
//
// Database.ts locks a buyable supertoken when a required token is missing
// OR present with count 0. providedView's buildPerpTile used to filter the
// displayed list on key-presence alone, so a zero-count required token was
// dropped and the tile rendered just the bare word "Requires" with an
// empty `.RequiresProviders` list. See issue: health-forecast requirements.

import { describe, expect, it } from 'vitest';
import { buildProvided } from '../../scripts/game/providedView.ts';

const ctx = (dbTokens) => ({
  xpLevel: 20,
  dbTokens,
  typeOf: () => 'TokenPerp',
});

const lockedSuperRow = () => ({
  gestalt: 'supertoken002',
  locked: true,
  data: {
    is_supertoken: true,
    required_level: 17,
    title: 'Gesundheits-Prognose',
    requiredTokens: [
      { gestalt: 'token017', type_data: { title: 'Krankenakten' } },
      { gestalt: 'token055', type_data: { title: 'Body Mass Index' } },
    ],
  },
});

describe('buildPerpTile Requires list (zero-count required token)', () => {
  it('lists a required token that is present but has a zero count', () => {
    const { tiles } = buildProvided([lockedSuperRow()], 'perp', ctx({ token017: 0, token055: 5 }));
    const html = tiles[0].dataHtml;
    expect(html).toContain('Krankenakten');
    // sanity: the Requires shell is there and not just a bare label
    expect(html).toContain('RequiresProviders');
  });

  it('lists a required token that is entirely missing', () => {
    const { tiles } = buildProvided([lockedSuperRow()], 'perp', ctx({ token055: 5 }));
    expect(tiles[0].dataHtml).toContain('Krankenakten');
  });

  it('omits required tokens already owned with a positive count', () => {
    const { tiles } = buildProvided([lockedSuperRow()], 'perp', ctx({ token017: 0, token055: 5 }));
    expect(tiles[0].dataHtml).not.toContain('Body Mass Index');
  });
});
