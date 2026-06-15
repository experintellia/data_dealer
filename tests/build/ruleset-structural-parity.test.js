// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let en, de;

function load() {
  if (!en) {
    en = JSON.parse(readFileSync(join(root, 'data', 'ruleset_3.en.json'), 'utf8'));
    de = JSON.parse(readFileSync(join(root, 'data', 'ruleset_3.de.json'), 'utf8'));
  }
  return { en, de };
}

// ── recursive structural comparison ───────────────────────────────────────────

/**
 * Walk both EN and DE objects in parallel, collecting structural mismatches.
 * Only string leaf values are allowed to differ; non-string leaves and all
 * structural properties (keys, nesting, types, array lengths) must match.
 */
function structuralDiff(enObj, deObj, path) {
  var issues = [];

  // Handle null before typeof checks (typeof null === 'object')
  if (enObj === null || deObj === null) {
    if (enObj !== deObj) {
      issues.push({ path: path, issue: 'null mismatch', en: enObj, de: deObj });
    }
    return issues;
  }

  var enType = typeof enObj;
  var deType = typeof deObj;

  if (enType !== deType) {
    issues.push({ path: path, issue: 'type mismatch', en: enType, de: deType });
    return issues;
  }

  // Leaf: strings may differ (translations)
  if (enType === 'string') {
    return issues;
  }

  // Leaf: numbers, booleans must be identical
  if (enType !== 'object') {
    if (enObj !== deObj) {
      issues.push({ path: path, issue: 'value mismatch', en: enObj, de: deObj });
    }
    return issues;
  }

  // Both are objects (possibly arrays)
  var enIsArray = Array.isArray(enObj);
  var deIsArray = Array.isArray(deObj);

  if (enIsArray !== deIsArray) {
    issues.push({ path: path, issue: 'array/object mismatch', en: enIsArray ? 'array' : 'object', de: deIsArray ? 'array' : 'object' });
    return issues;
  }

  if (enIsArray) {
    if (enObj.length !== deObj.length) {
      issues.push({ path: path, issue: 'array length mismatch', en: enObj.length, de: deObj.length });
      return issues;
    }
    for (var i = 0; i < enObj.length; i++) {
      issues = issues.concat(structuralDiff(enObj[i], deObj[i], path + '[' + i + ']'));
    }
    return issues;
  }

  // Plain objects: compare keys
  var enKeys = Object.keys(enObj).sort();
  var deKeys = Object.keys(deObj).sort();
  if (enKeys.length !== deKeys.length) {
    issues.push({ path: path, issue: 'key count mismatch', en: enKeys.length, de: deKeys.length, enKeys: enKeys, deKeys: deKeys });
    return issues;
  }
  for (var k = 0; k < enKeys.length; k++) {
    if (enKeys[k] !== deKeys[k]) {
      issues.push({ path: path, issue: 'key mismatch', enKeys: enKeys, deKeys: deKeys });
      return issues;
    }
  }

  for (var j = 0; j < enKeys.length; j++) {
    var key = enKeys[j];
    var childPath = path ? path + '.' + key : key;
    issues = issues.concat(structuralDiff(enObj[key], deObj[key], childPath));
  }

  return issues;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ruleset structural parity (EN ↔ DE)', function () {
  it('both files decode as objects', function () {
    var data = load();
    expect(typeof data.en).toBe('object');
    expect(typeof data.de).toBe('object');
    expect(data.en).not.toBeNull();
    expect(data.de).not.toBeNull();
  });

  it('have identical top-level keys', function () {
    var data = load();
    expect(Object.keys(data.en).sort()).toEqual(Object.keys(data.de).sort());
  });

  it('have zero structural differences (strings may differ)', function () {
    var data = load();
    var issues = structuralDiff(data.en, data.de, '');
    expect(issues).toEqual([]);
  });

  it('have at least some strings that actually differ (translation)', function () {
    var data = load();
    // Spot-check a known translated field to ensure we're not comparing identical files
    expect(data.en.karmalauters[0].type_data.title).not.toBe(data.de.karmalauters[0].type_data.title);
  });
});
