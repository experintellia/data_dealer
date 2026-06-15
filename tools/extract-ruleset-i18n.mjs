/**
 * Extract translatable strings from the dual ruleset files into a base file
 * + per-locale flat string maps.
 *
 * Expects data/ruleset_3.en.json and data/ruleset_3.de.json as input.
 * To re-extract after upstream changes, first restore the vendored source
 * files from https://github.com/datadealer/dd_rules (see data/UPSTREAM.txt).
 *
 * Usage: node tools/extract-ruleset-i18n.mjs
 *
 * Produces:
 *   data/ruleset_base.json      — canonical data with $t:path markers for strings
 *   i18n/ruleset.en.json        — flat { "path": "English text" }
 *   i18n/ruleset.de.json        — flat { "path": "German text" }
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const en = JSON.parse(readFileSync(join(root, 'data', 'ruleset_3.en.json'), 'utf8'));
const de = JSON.parse(readFileSync(join(root, 'data', 'ruleset_3.de.json'), 'utf8'));

const enMap = {};
const deMap = {};

function buildBase(enVal, deVal, path) {
  const enType = typeof enVal;
  const deType = typeof deVal;

  if (enType !== deType) {
    throw new Error(`Type mismatch at "${path}": ${enType} vs ${deType}`);
  }

  // ── string leaf ─────────────────────────────────────────────────────────
  if (enType === 'string') {
    if (enVal === deVal) {
      return enVal; // identical across locales, keep inline
    }
    enMap[path] = enVal;
    deMap[path] = deVal;
    return '$t:' + path;
  }

  // ── non-object primitives (number, boolean) — keep inline ───────────────
  if (enType !== 'object' || enVal === null) {
    return enVal;
  }

  // ── arrays ──────────────────────────────────────────────────────────────
  if (Array.isArray(enVal)) {
    if (enVal.length !== deVal.length) {
      throw new Error(`Array length mismatch at "${path}": ${enVal.length} vs ${deVal.length}`);
    }
    var arr = new Array(enVal.length);
    for (var i = 0; i < enVal.length; i++) {
      arr[i] = buildBase(enVal[i], deVal[i], path + '[' + i + ']');
    }
    return arr;
  }

  // ── plain objects ───────────────────────────────────────────────────────
  var enKeys = Object.keys(enVal);
  var deKeys = Object.keys(deVal);
  if (enKeys.length !== deKeys.length) {
    throw new Error(
      'Key count mismatch at "' +
        path +
        '": ' +
        enKeys.length +
        ' vs ' +
        deKeys.length +
        '\n  EN keys: ' +
        JSON.stringify(enKeys) +
        '\n  DE keys: ' +
        JSON.stringify(deKeys)
    );
  }
  for (var k = 0; k < enKeys.length; k++) {
    if (enKeys[k] !== deKeys[k]) {
      throw new Error(
        'Key mismatch at "' +
          path +
          '":\n' +
          '  EN keys: ' +
          JSON.stringify(enKeys) +
          '\n' +
          '  DE keys: ' +
          JSON.stringify(deKeys)
      );
    }
  }

  var obj = {};
  for (var j = 0; j < enKeys.length; j++) {
    var key = enKeys[j];
    var childPath = path ? path + '.' + key : key;
    obj[key] = buildBase(enVal[key], deVal[key], childPath);
  }
  return obj;
}

// ── run ───────────────────────────────────────────────────────────────────────

console.log('Walking EN ↔ DE rulesets to extract translatable strings...');
var base = buildBase(en, de, '');

console.log('  Total strings extracted:', Object.keys(enMap).length);
var diffCount = 0;
for (var p in enMap) {
  if (enMap[p] !== deMap[p]) diffCount++;
}
console.log('  Strings that differ (actual translations):', diffCount);

console.log('\nWriting data/ruleset_base.json ...');
writeFileSync(join(root, 'data', 'ruleset_base.json'), JSON.stringify(base, null, 2), 'utf8');

console.log('Writing i18n/ruleset.en.json ...');
writeFileSync(join(root, 'i18n', 'ruleset.en.json'), JSON.stringify(enMap, null, 2), 'utf8');

console.log('Writing i18n/ruleset.de.json ...');
writeFileSync(join(root, 'i18n', 'ruleset.de.json'), JSON.stringify(deMap, null, 2), 'utf8');

console.log('\nDone.');
