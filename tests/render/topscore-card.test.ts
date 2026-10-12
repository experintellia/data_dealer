// Leaderboard rows carry other chat members' display names and addrs —
// they must render as text, never as markup (the jQuery template this
// replaced interpolated them unescaped).

import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { TopscoreCard } from '../../scripts/components/TopscoreCard.js';

describe('TopscoreCard', () => {
  it('escapes peer display names and addrs', () => {
    const html = renderToString(
      h(TopscoreCard, {
        type: 'cash',
        data: {
          type_headlines: { cash: 'Data Dealer Leaderboard<br />CASH' },
          top: [
            {
              addr: 'a"><img src=x>',
              display_name: '<img src=x onerror=alert(1)>',
              value: 1,
              self: false,
            },
          ],
        },
      })
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)>');
    expect(html).toContain('data-testid="dd-leaderboard-row-a&quot;>&lt;img src=x>"');
    expect(html).toContain('<div class="TopscoreLabelLine">Data Dealer Leaderboard</div>');
  });
});
