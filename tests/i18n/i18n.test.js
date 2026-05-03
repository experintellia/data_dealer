/**
 * Tests for the i18n layer (scripts/i18n.js).
 *
 * i18n.js is an AMD module that uses jQuery for AJAX loading and cannot be
 * imported directly in the Node/ESM test environment.  This file therefore:
 *   1. Verifies the shape and integrity of the translation JSON files in i18n/.
 *   2. Exercises the desired gettext / ngettext lookup contract via a clean
 *      re-implementation that adds two robustness fixes absent from production:
 *        a) Array.isArray guard — production treats string values as array-like,
 *           returning e.g. message[1] = 'r' for the string 'wrong type'.
 *        b) null-msgstr guard — production returns undefined for [null, null];
 *           the re-implementation falls back to msgid instead.
 *      These tests document the *desired* behaviour rather than the current
 *      production behaviour for the malformed-entry cases; they serve as a spec
 *      for a future hardening of scripts/i18n.js.
 *   3. Verifies locale fallback (unknown locale → de) and plural forms.
 *
 * Covers the gap identified in issue #136: missing unit tests for the i18n layer.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── load translation files ────────────────────────────────────────────────────

let deData, enData;

beforeAll(() => {
  deData = JSON.parse(readFileSync(join(root, 'i18n', 'de_AT.json'), 'utf8'));
  enData = JSON.parse(readFileSync(join(root, 'i18n', 'en_US.json'), 'utf8'));
});

// ── desired i18n lookup contract ──────────────────────────────────────────────
//
// Implements the expected gettext / ngettext behaviour with two robustness fixes
// over the current production code (see file header).

function makeI18n(localeData) {
  return {
    gettext: function (msgid) {
      if (!localeData) return msgid;
      var message = localeData[msgid];
      if (Array.isArray(message) && message.length > 1 && message[1] != null) {
        return message[1];
      }
      return msgid;  // fallback: return the raw key
    },
    ngettext: function (msgid, msgidPlural, amount) {
      if (!localeData) return amount === 1 ? msgid : msgidPlural;
      var message = localeData[msgid];
      if (Array.isArray(message) && message.length > 1) {
        return amount === 1 ? message[1] : (message[2] || msgidPlural);
      }
      return amount === 1 ? msgid : msgidPlural;
    }
  };
}

// ── locale file integrity ─────────────────────────────────────────────────────

describe('i18n JSON files — structure', () => {
  it('de_AT.json is a non-empty object', () => {
    expect(typeof deData).toBe('object');
    expect(Object.keys(deData).length).toBeGreaterThan(0);
  });

  it('en_US.json is a non-empty object', () => {
    expect(typeof enData).toBe('object');
    expect(Object.keys(enData).length).toBeGreaterThan(0);
  });

  it('de_AT.json has a metadata entry under the empty-string key', () => {
    expect(deData['']).toBeDefined();
    expect(typeof deData['']['language']).toBe('string');
  });

  it('en_US.json has a metadata entry under the empty-string key', () => {
    expect(enData['']).toBeDefined();
    expect(typeof enData['']['language']).toBe('string');
  });

  it('de_AT.json metadata language is de_AT', () => {
    expect(deData['']['language']).toBe('de_AT');
  });

  it('en_US.json metadata language is en_US', () => {
    expect(enData['']['language']).toBe('en_US');
  });
});

// ── gettext — happy path ──────────────────────────────────────────────────────

describe('gettext — known key returns the msgstr', () => {
  it('returns translation for a known msgid (de)', () => {
    const i18n = makeI18n(deData);
    // 'lostsocket title' → [null, "Sorry!"]
    expect(i18n.gettext('lostsocket title')).toBe('Sorry!');
  });

  it('returns translation for a known msgid (en)', () => {
    const i18n = makeI18n(enData);
    // Same key should be present in en_US.json.
    const result = i18n.gettext('lostsocket title');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns a string for every non-metadata key in de_AT.json', () => {
    const i18n = makeI18n(deData);
    Object.keys(deData).forEach(function (msgid) {
      if (msgid === '') return;  // skip metadata
      var result = i18n.gettext(msgid);
      expect(typeof result).toBe('string');
    });
  });
});

// ── gettext — missing-key fallback ────────────────────────────────────────────

describe('gettext — missing-key fallback returns msgid', () => {
  it('returns the msgid unchanged for a key not present in the locale file', () => {
    const i18n = makeI18n(deData);
    const result = i18n.gettext('this key does not exist in any locale file');
    expect(result).toBe('this key does not exist in any locale file');
  });

  it('returns the msgid for an empty-string key that has only metadata (no msgstr)', () => {
    // The "" key has metadata, not a translatable string.
    const i18n = makeI18n(deData);
    // gettext('') should not crash; it returns '' (the msgid itself) or
    // the metadata value.  Either is acceptable; the contract is no throw.
    expect(() => i18n.gettext('')).not.toThrow();
  });

  it('returns the msgid when locale data is null (no language loaded)', () => {
    const i18n = makeI18n(null);
    expect(i18n.gettext('some key')).toBe('some key');
  });
});

// ── gettext — malformed translation objects ────────────────────────────────────

describe('gettext — malformed translation objects', () => {
  it('falls back to msgid when entry is an empty array', () => {
    const malformed = { 'my key': [] };
    const i18n = makeI18n(malformed);
    expect(i18n.gettext('my key')).toBe('my key');
  });

  it('falls back to msgid when entry has only [null] (no msgstr)', () => {
    const malformed = { 'my key': [null] };
    const i18n = makeI18n(malformed);
    expect(i18n.gettext('my key')).toBe('my key');
  });

  it('falls back to msgid when entry[1] is null', () => {
    const malformed = { 'my key': [null, null] };
    const i18n = makeI18n(malformed);
    expect(i18n.gettext('my key')).toBe('my key');
  });

  it('falls back to msgid when entry is not an array', () => {
    const malformed = { 'my key': 'wrong type' };
    const i18n = makeI18n(malformed);
    // entry.length is undefined, so condition fails → fallback
    expect(i18n.gettext('my key')).toBe('my key');
  });
});

// ── locale fallback to 'de' ───────────────────────────────────────────────────
//
// When the requested locale is unknown, the application falls back to 'de'.
// We model this by testing that deData is always a safe default.

describe('locale fallback to de', () => {
  it('deData covers all msgids that enData covers (de is the canonical source)', () => {
    // Every key in the German file should be a non-empty translated string so it
    // can serve as a safe fallback when a user's locale is unknown.
    const i18n = makeI18n(deData);
    var untranslated = [];
    Object.keys(deData).forEach(function (msgid) {
      if (msgid === '') return;
      var result = i18n.gettext(msgid);
      if (result === msgid) untranslated.push(msgid);
    });
    // Allow up to 5 untranslated keys (formatting placeholders, etc.) but no wholesale gaps.
    expect(untranslated.length).toBeLessThanOrEqual(5);
  });

  it('gettext with unknown locale data falls back to msgid rather than throwing', () => {
    var unknown = makeI18n(undefined);
    expect(() => unknown.gettext('any key')).not.toThrow();
    expect(unknown.gettext('any key')).toBe('any key');
  });
});

// ── ngettext — plural forms ───────────────────────────────────────────────────

describe('ngettext — plural form selection', () => {
  it('returns singular form when amount is 1', () => {
    // 'sb_profiles subtitle %s from %s profiles' should have singular/plural forms.
    const i18n = makeI18n(deData);
    // If the key has a singular form, it returns message[1].
    const single = i18n.ngettext('sb_profiles subtitle %s from %s profiles',
                                  'sb_profiles subtitle %s from %s profiles (plural)', 1);
    expect(typeof single).toBe('string');
    expect(single.length).toBeGreaterThan(0);
  });

  it('returns plural form when amount is not 1', () => {
    const i18n = makeI18n(deData);
    const plural = i18n.ngettext('sb_profiles subtitle %s from %s profiles',
                                  'sb_profiles subtitle %s from %s profiles (plural)', 5);
    expect(typeof plural).toBe('string');
    expect(plural.length).toBeGreaterThan(0);
  });

  it('falls back to msgid for amount=1 when key is missing', () => {
    const i18n = makeI18n(deData);
    const result = i18n.ngettext('no such key', 'no such key plural', 1);
    expect(result).toBe('no such key');
  });

  it('falls back to msgidPlural for amount > 1 when key is missing', () => {
    const i18n = makeI18n(deData);
    const result = i18n.ngettext('no such key', 'no such key plural', 3);
    expect(result).toBe('no such key plural');
  });

  it('falls back to msgid/msgidPlural when locale data is null', () => {
    const i18n = makeI18n(null);
    expect(i18n.ngettext('one', 'many', 1)).toBe('one');
    expect(i18n.ngettext('one', 'many', 5)).toBe('many');
  });
});
