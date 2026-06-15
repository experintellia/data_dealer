// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { injectTranslations } from '../../scripts/inject-translations.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadJSON(relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ruleset i18n merge — lossless roundtrip', function () {
  var base, stringsEn, stringsDe, originalEn, originalDe;

  beforeAll(function () {
    base = loadJSON('data/ruleset_base.json');
    stringsEn = loadJSON('i18n/ruleset.en.json');
    stringsDe = loadJSON('i18n/ruleset.de.json');
    originalEn = loadJSON('data/ruleset_3.en.json');
    originalDe = loadJSON('data/ruleset_3.de.json');
  });

  it('merged (base + EN strings) deep-equals original EN ruleset', function () {
    var merged = injectTranslations(base, stringsEn);
    expect(merged).toEqual(originalEn);
  });

  it('merged (base + DE strings) deep-equals original DE ruleset', function () {
    var merged = injectTranslations(base, stringsDe);
    expect(merged).toEqual(originalDe);
  });

  it('injectTranslations throws for missing key', function () {
    expect(function () {
      injectTranslations('$t:nonexistent.path', {});
    }).toThrow('Missing translation for key: nonexistent.path');
  });

  it('passes through non-$t: values unchanged', function () {
    expect(injectTranslations('hello', {})).toBe('hello');
    expect(injectTranslations(42, {})).toBe(42);
    expect(injectTranslations(true, {})).toBe(true);
    expect(injectTranslations(null, {})).toBe(null);
    expect(injectTranslations([1, 2, 3], {})).toEqual([1, 2, 3]);
  });

  it('resolves $t: markers at any nesting depth', function () {
    var base = {
      a: { b: { c: '$t:foo' } },
      d: ['$t:bar', { e: '$t:baz' }],
    };
    var strings = { foo: 'FOO', bar: 'BAR', baz: 'BAZ' };
    var expected = {
      a: { b: { c: 'FOO' } },
      d: ['BAR', { e: 'BAZ' }],
    };
    expect(injectTranslations(base, strings)).toEqual(expected);
  });
});
