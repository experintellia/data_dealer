export function injectTranslations(base: any, strings: Record<string, string>): any {
  if (typeof base === 'string' && base.startsWith('$t:')) {
    var key = base.slice(3);
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
