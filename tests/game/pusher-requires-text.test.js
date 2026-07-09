// Pusher locked-tile requirement copy must reflect AND semantics.
//
// A pusher (CityPerp "Pushers" tab) only unlocks once **all** of its
// `required_providers` are owned: `_isProvidable` in scripts/LocalEngine.ts
// ANDs the list, and tests/handlers/ruleset-queries.test.js asserts a pusher
// is "buyable once all required_providers are owned".  The locked tile used
// to render "Requires either A, B, or C", which wrongly implied any single
// provider would suffice — players reported chasing one provider and finding
// the pusher still locked.  This guards the corrected "Requires A, B, and C"
// copy so the OR wording can't silently return.
import { describe, expect, it } from 'vitest';
import { buildProvided } from '../../scripts/game/providedView.js';

const CTX = { xpLevel: 1, dbTokens: {}, typeOf: () => '' };

function lockedPusher(requiredProviders) {
  return {
    gestalt: 'pusher001',
    locked: true,
    data: { requiredProviders, price: 0, label: 'Pusher' },
  };
}

describe('pusher locked tile — requirement copy is AND, not OR', () => {
  it('joins multiple required providers with "and", under a plain "Requires"', () => {
    const row = lockedPusher(['Anti-piracy crawler', 'Franz Sauerzapf', 'Warranty Cards']);
    const { tiles } = buildProvided([row], 'pusher', CTX);
    const html = tiles[0].dataHtml;

    // All three providers are listed (all are required).
    expect(html).toContain('Anti-piracy crawler');
    expect(html).toContain('Franz Sauerzapf');
    expect(html).toContain('Warranty Cards');

    // AND semantics: "Requires … and …", never the misleading "either … or".
    expect(html).toContain('and<br/>');
    expect(html).not.toContain('Requires either');
    expect(html).not.toContain('or<br/>');
  });

  it('renders a lone provider with no dangling "and"', () => {
    const row = lockedPusher(['Warranty Cards']);
    const { tiles } = buildProvided([row], 'pusher', CTX);
    const html = tiles[0].dataHtml;
    expect(html).toContain('Warranty Cards');
    expect(html).not.toContain('Requires either');
    // A single provider has nothing to join, so no connector must appear.
    expect(html).not.toContain('and<br/>');
  });

  it('joins exactly two providers with "and" and no trailing comma-only tail', () => {
    const row = lockedPusher(['Franz Sauerzapf', 'Warranty Cards']);
    const { tiles } = buildProvided([row], 'pusher', CTX);
    const html = tiles[0].dataHtml;
    expect(html).toContain('and<br/>');
    expect(html).toContain('Franz Sauerzapf');
    expect(html).toContain('Warranty Cards');
  });
});
