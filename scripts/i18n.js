// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
// Lightweight gettext/ngettext layer.  In the AMD original, locale JSON
// files were fetched via $.getJSON at module-load time.  In the ESM port
// they are statically imported so the module body has no async work and
// no jQuery dependency, which means it is safe to evaluate eagerly inside
// the esm-bundle IIFE before vendor libs have loaded.
//
// Underscore is still required for ngettext's _.sprintf / _.toKSNum
// helpers (registered as mixins by app.js), so those calls read `_` from
// globalThis at call time — long after vendor/underscore.js has loaded.

import deAT from '../i18n/de_AT.json' with { type: 'json' };
import enUS from '../i18n/en_US.json' with { type: 'json' };
import setup from './setup.js';

let locale = 'en_US';

const i18n = {
  de_AT: deAT,
  en_US: enUS,

  getLocale() {
    return locale;
  },

  setLocale(l) {
    locale = l || locale;
    setup.locale = locale;
    setup.localeShort = locale.substr(0, 2);
    return i18n;
  },

  // The translation files are bundled at build time, so readiness is
  // immediate.  Kept as a Promise-returning function for callers that
  // still chain .then() on the legacy return shape.
  ready() {
    return Promise.resolve(i18n);
  },

  gettext(msgid) {
    const language = i18n[locale];
    if (language) {
      const message = language[msgid];
      if (message && message.length > 0) {
        return message[1];
      }
      console.warn('No %s translation available for msgid "%s"', locale, msgid);
    } else {
      console.warn('No language file available for locale %s (msgid "%s")', locale, msgid);
    }
    return msgid;
  },

  ngettext(msgid, msgidPlural, amount) {
    const _ = globalThis._;
    const language = i18n[locale];
    if (language) {
      const message = language[msgid];
      if (message && message.length > 0) {
        const text = amount === 1 ? message[1] : message[2];
        return _.sprintf(text, _.toKSNum(amount));
      }
      console.warn('No %s translation available for msgid "%s"', locale, msgid);
    } else {
      console.warn('No language file available for locale %s (msgid "%s")', locale, msgid);
    }
    return _.sprintf(amount === 1 ? msgid : msgidPlural, _.toKSNum(amount));
  },
};

export default i18n;
