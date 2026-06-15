// Sentinel prefix for translatable markers.
// Assumes no game text ever legitimately starts with "$t:" — extremely unlikely
// for this dataset (all source strings are normal English prose). The extraction
// tool keeps identical-across-locale strings inline, so only actual translated
// strings ever get the $t: marker.
var MARKER = '$t:';
var MARKER_LEN = MARKER.length;

export function injectTranslations(base: any, strings: Record<string, string>): any {
  if (typeof base === 'string' && base.startsWith(MARKER)) {
    var key = base.slice(MARKER_LEN);
    if (!(key in strings)) {
      throw new Error('Missing translation for key: ' + key);
    }
    return strings[key];
  }

  if (base === null || typeof base !== 'object') {
    return base;
  }

  if (Array.isArray(base)) {
    return base.map(function (item) {
      return injectTranslations(item, strings);
    });
  }

  var result: any = {};
  for (var key in base) {
    if (Object.prototype.hasOwnProperty.call(base, key)) {
      result[key] = injectTranslations(base[key], strings);
    }
  }
  return result;
}
