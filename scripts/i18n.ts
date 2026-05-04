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

/** Locale-table entry: msgctxt at [0], singular msgstr at [1], optional plural msgstr at [2]. */
type I18nEntry = readonly (string | undefined)[];
type I18nTable = Record<string, I18nEntry | undefined>;

interface UnderscoreI18nMixins {
  sprintf(template: string, ...subs: unknown[]): string;
  toKSNum(n: number): string;
}

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
  de_AT: deAT as unknown as I18nTable,
  en_US: enUS as unknown as I18nTable,

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
      const message = language[msgid];
      if (message && message.length > 0) {
        return (message[1] as string | undefined) ?? msgid;
      }
      console.warn('No %s translation available for msgid "%s"', locale, msgid);
    } else {
      console.warn('No language file available for locale %s (msgid "%s")', locale, msgid);
    }
    return msgid;
  },

  ngettext(msgid: string, msgidPlural: string, amount: number): string {
    const _ = (globalThis as unknown as { _: UnderscoreI18nMixins })._;
    const language = i18n[locale] as I18nTable | undefined;
    if (language) {
      const message = language[msgid];
      if (message && message.length > 0) {
        const text = (amount === 1 ? message[1] : message[2]) as string | undefined;
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
