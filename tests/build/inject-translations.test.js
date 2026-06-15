// @ts-nocheck — strict-TS quarantine
import { describe, expect, it } from 'vitest';
import { injectTranslations } from '../../scripts/inject-translations.ts';

// ── helpers ──────────────────────────────────────────────────────────────────

function merge(base, strings) {
  return injectTranslations(base, strings);
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('injectTranslations — marker resolution', function () {
  it('resolves $t: marker at root', function () {
    expect(merge('$t:foo', { foo: 'bar' })).toBe('bar');
  });

  it('resolves $t: marker nested in object', function () {
    expect(merge({ a: { b: '$t:foo' } }, { foo: 'bar' })).toEqual({ a: { b: 'bar' } });
  });

  it('resolves $t: marker inside array', function () {
    expect(merge(['$t:foo', '$t:bar'], { foo: 'FOO', bar: 'BAR' })).toEqual(['FOO', 'BAR']);
  });

  it('resolves markers at mixed nesting', function () {
    var base = {
      title: '$t:title',
      items: [
        { label: '$t:label_a', cost: 10 },
        { label: '$t:label_b', cost: 20 },
      ],
    };
    var strings = { title: 'Hello', label_a: 'Apple', label_b: 'Banana' };
    var expected = {
      title: 'Hello',
      items: [
        { label: 'Apple', cost: 10 },
        { label: 'Banana', cost: 20 },
      ],
    };
    expect(merge(base, strings)).toEqual(expected);
  });
});

describe('injectTranslations — non-marker passthrough', function () {
  it('passes through plain strings unchanged', function () {
    expect(merge('hello', {})).toBe('hello');
  });

  it('passes through numbers unchanged', function () {
    expect(merge(42, {})).toBe(42);
  });

  it('passes through booleans unchanged', function () {
    expect(merge(true, {})).toBe(true);
    expect(merge(false, {})).toBe(false);
  });

  it('passes through null unchanged', function () {
    expect(merge(null, {})).toBe(null);
  });

  it('passes through arrays of primitives unchanged', function () {
    var arr = [1, 'two', true, null];
    expect(merge(arr, {})).toEqual(arr);
  });

  it('passes through nested objects without markers unchanged', function () {
    var obj = { a: { b: { c: 'hello', d: 99 } } };
    expect(merge(obj, {})).toEqual(obj);
  });

  it('handles empty objects and arrays', function () {
    expect(merge({}, {})).toEqual({});
    expect(merge([], {})).toEqual([]);
  });
});

describe('injectTranslations — error handling', function () {
  it('throws for missing translation key', function () {
    expect(function () {
      merge('$t:no_such_key', {});
    }).toThrow('Missing translation for key: no_such_key');
  });

  it('throws only for the missing key (not earlier resolvable ones)', function () {
    var base = {
      good: '$t:exists',
      bad: '$t:missing',
    };
    expect(function () {
      merge(base, { exists: 'yay' });
    }).toThrow('Missing translation for key: missing');
  });
});

describe('injectTranslations — object identity', function () {
  it('returns a new object (does not mutate base)', function () {
    var base = { a: '$t:foo' };
    var result = merge(base, { foo: 'bar' });
    expect(result).not.toBe(base);
    expect(base.a).toBe('$t:foo');
  });

  it('returns a new array (does not mutate base)', function () {
    var base = ['$t:foo'];
    var result = merge(base, { foo: 'bar' });
    expect(result).not.toBe(base);
    expect(base[0]).toBe('$t:foo');
  });
});
