// Lightweight gettext/ngettext layer.  In the AMD original, locale JSON
// files were fetched via $.getJSON at module-load time.  In the ESM port
// they are statically imported so the module body has no async work and
// no jQuery dependency, which means it is safe to evaluate eagerly inside
// the esm-bundle IIFE before vendor libs have loaded.
//
// Underscore is still required for ngettext's _.sprintf / _.toKSNum
// helpers (registered as mixins by app.ts), so those calls read `_` from
// globalThis at call time — long after vendor/underscore.js has loaded.

import deAT from '../i18n/de_AT.json' with { type: 'json' };
import enUS from '../i18n/en_US.json' with { type: 'json' };
import setup from './setup.js';

/** Union of all known translation keys derived directly from the canonical locale file. */
type I18nKey = keyof typeof enUS;
/** Locale-table entry: the actual value type from the JSON (metadata object or [msgctxt, msgstr] tuple). */
type I18nEntry = (typeof enUS)[I18nKey];
/** Typed over the exact key set of the canonical locale file — no unknown-key undefined overhead. */
type I18nTable = typeof enUS;

interface I18nApi {
  de_AT: I18nTable;
  en_US: I18nTable;
  getLocale(): string;
  setLocale(l: string): I18nApi;
  ready(): Promise<I18nApi>;
  gettext(msgid: string): string;
  ngettext(msgid: string, msgidPlural: string, amount: number): string;
  /** Index access used by getLocale() lookup (i18n[locale]). */
  [key: string]: unknown;
}

let locale = 'en_US';

const i18n: I18nApi = {
  de_AT: deAT,
  en_US: enUS,

  getLocale(): string {
    return locale;
  },

  setLocale(l: string): I18nApi {
    locale = l || locale;
    setup.locale = locale;
    setup.localeShort = locale.substr(0, 2);
    return i18n;
  },

  // The translation files are bundled at build time, so readiness is
  // immediate.  Kept as a Promise-returning function for callers that
  // still chain .then() on the legacy return shape.
  ready(): Promise<I18nApi> {
    return Promise.resolve(i18n);
  },

  gettext(msgid: string): string {
    const language = i18n[locale] as I18nTable | undefined;
    if (language) {
      const message = language[msgid as I18nKey];
      if (Array.isArray(message) && message[1]) {
        return message[1];
      }
      console.warn('No %s translation available for msgid "%s"', locale, msgid);
    } else {
      console.warn('No language file available for locale %s (msgid "%s")', locale, msgid);
    }
    return msgid;
  },

  ngettext(msgid: string, msgidPlural: string, amount: number): string {
    const language = i18n[locale] as I18nTable | undefined;
    if (language) {
      const message = language[msgid as I18nKey];
      if (Array.isArray(message) && message.length > 0) {
        const arr = message as readonly (string | null | undefined)[];
        const text = amount === 1 ? arr[1] : arr[2];
        if (text) return _.sprintf(text, _.toKSNum(amount));
      }
      console.warn('No %s translation available for msgid "%s"', locale, msgid);
    } else {
      console.warn('No language file available for locale %s (msgid "%s")', locale, msgid);
    }
    return _.sprintf(amount === 1 ? msgid : msgidPlural, _.toKSNum(amount));
  },
};

export default i18n;
