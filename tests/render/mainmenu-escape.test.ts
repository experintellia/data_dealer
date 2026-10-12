// The main menu prints the player's messenger display name; it must go
// through the escaping `<%- %>` tag, never the raw `<%= %>` one.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileTemplate, registerTemplateHelpers } from '../../scripts/dd-helpers.js';

describe('views/mainmenu.html', () => {
  it('escapes the display name', () => {
    registerTemplateHelpers({
      _: (s: string) => s,
      game: () => ({
        setup: { locale: 'en_US', localeShort: 'en' },
        data: { user: { display_name: '<img src=x onerror=alert(1)>' } },
      }),
    });
    const tpl = readFileSync(new URL('../../views/mainmenu.html', import.meta.url), 'utf8');
    const html = compileTemplate(tpl)({ buttons: [] });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
