// Custom template / formatting helpers, extracted from the
// `_.mixin({...})` block that used to live in scripts/app.ts. These
// were never underscore APIs — they were project-local utilities the
// IIFE port stuffed onto `_` because the legacy templates already
// resolved everything through that namespace.
//
// Two surfaces are exported:
//
//   - Named ESM functions (`toKSNum`, `sprintf`, `span`, …) — what
//     application code now imports directly instead of reaching
//     through `globalThis._`.
//
//   - `templateHelpers` — a single object passed into every compiled
//     view template as the `_` parameter, so existing template source
//     (`<%= _.toKSNum(...) %>`, `<% _.each(...) %>`) keeps working
//     without rewriting all 60+ files in views/.
//
// Plus `compileTemplate(text)`, a ~30-line replacement for
// `_.template(text, null, { variable: 'D' })`. Templates only use
// `<% … %>` and `<%= … %>` (no `<%- … %>` HTML-escape interpolation
// — verified by `grep -rn '<%-' views/` returning nothing), so the
// implementation is intentionally minimal.

// ── primitive helpers ──────────────────────────────────────────────────────

// `Intl.NumberFormat('de-DE')` alone defaults to maximumFractionDigits: 3,
// which would silently regress against the legacy `_.numeral(n).format('0,0')`
// (integer-only) contract — pin the fraction digits to 0 so a fractional
// input renders as a rounded thousands-grouped integer.
const KSNumFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

export function toKSNum(n: number): string {
  return KSNumFormat.format(n || 0);
}

export function pad0(n: number, length: number): string {
  return String(n).padStart(length, '0');
}

export function crlf2html(str: unknown): string {
  return String(str ?? '').replace(/\r?\n|\r/g, '<br>');
}

export function span(text: string | number, cls?: string): string {
  return '<span class="' + (cls || 'highlight') + '">' + text + '</span>';
}

export function toTime(ms: number): string {
  const date = new Date(ms || 0);
  if (ms >= 3600000) {
    return (
      pad0(date.getUTCHours(), 2) +
      ':' +
      pad0(date.getUTCMinutes(), 2) +
      ':' +
      pad0(date.getUTCSeconds(), 2)
    );
  }
  return pad0(date.getUTCMinutes(), 2) + ':' + pad0(date.getUTCSeconds(), 2);
}

// Re-export the vendor sprintf global as a typed function so callers
// can `import { sprintf } from './dd-helpers.js'` without each file
// re-declaring the global ambient.
export function sprintf(template: string, ...subs: unknown[]): string {
  return (globalThis as unknown as { sprintf: (t: string, ...s: unknown[]) => string }).sprintf(
    template,
    ...subs
  );
}

// ── shuffle / debounce — replaces the only two real underscore APIs ────────
//   (`_.clone` was already inlined as a manual `slice()` in
//    scripts/game/ProfileSet.ts.)

export function shuffle<T>(arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

export function debounce<F extends (...args: never[]) => void>(
  fn: F,
  ms: number
): (...args: Parameters<F>) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return function (...args: Parameters<F>): void {
    if (t !== undefined) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ── template-engine collection helpers ─────────────────────────────────────
//   Tiny shims for the four underscore collection functions still
//   reached via `_.foo(...)` from inside view templates: `each`,
//   `range`, `contains`, `filter`. Kept narrow on purpose — templates
//   pass plain arrays / records, never the chained / wrapped values
//   underscore's full surface supports.

function each<T>(
  coll: readonly T[] | Record<string, T> | null | undefined,
  fn: (value: T, key: number | string) => void
): void {
  if (!coll) return;
  if (Array.isArray(coll)) {
    for (let i = 0; i < coll.length; i++) fn(coll[i] as T, i);
  } else {
    for (const k of Object.keys(coll)) fn((coll as Record<string, T>)[k] as T, k);
  }
}

function range(start: number, stop?: number, step = 1): number[] {
  let s = start;
  let e = stop;
  if (e === undefined) {
    e = s;
    s = 0;
  }
  const out: number[] = [];
  if (step > 0) {
    for (let i = s; i < e; i += step) out.push(i);
  } else {
    for (let i = s; i > e; i += step) out.push(i);
  }
  return out;
}

function contains<T>(arr: readonly T[] | null | undefined, val: T): boolean {
  return !!arr && arr.indexOf(val) !== -1;
}

function filter<T>(arr: readonly T[] | null | undefined, pred: (v: T) => boolean): T[] {
  return arr ? arr.filter(pred) : [];
}

// ── template helper namespace ──────────────────────────────────────────────
//
// `templateHelpers` is the `_` parameter every compiled template
// receives. Values are stable across ticks (templates close over
// it transitively via their generated function body), so app.ts /
// Render.ts register their two late-bound entries (`renderView`,
// `game`, `RenderSprite`, `RenderAmount`) by mutating this object
// instead of recompiling. Ordering: app.ts populates `renderView`
// + `game` from inside the Application factory; Render.ts populates
// the two Render* entries from inside `getRender()` — both run
// before any template is actually evaluated, since templates are
// only triggered by user-visible UI events.

export interface TemplateHelpers {
  _: (msgid: string) => string;
  __: (msgid: string, msgidPlural: string, amount: number) => string;
  toKSNum: typeof toKSNum;
  toTime: typeof toTime;
  pad0: typeof pad0;
  span: typeof span;
  crlf2html: typeof crlf2html;
  sprintf: typeof sprintf;
  each: typeof each;
  range: typeof range;
  contains: typeof contains;
  filter: typeof filter;
  // Late-bound — registered by app.ts / Render.ts at startup. Templates
  // never run before both have populated their entries.
  renderView: (viewName: string, data?: unknown) => string;
  game: () => unknown;
  // Late-bound by Render.ts. Signatures stay loose at the namespace
  // level (templates pass unknown shapes) — the real implementations
  // declare their own narrower types in scripts/render/ and Render.ts
  // casts at registration time.
  RenderSprite: (...args: any[]) => string;
  RenderAmount: (...args: any[]) => string;
}

function _missingHelper(name: string): (...args: unknown[]) => string {
  return function (..._args: unknown[]): string {
    console.warn('templateHelpers.%s called before registration', name);
    return '';
  };
}

export const templateHelpers: TemplateHelpers = {
  _: _missingHelper('_') as (msgid: string) => string,
  __: _missingHelper('__') as (msgid: string, msgidPlural: string, amount: number) => string,
  toKSNum,
  toTime,
  pad0,
  span,
  crlf2html,
  sprintf,
  each,
  range,
  contains,
  filter,
  renderView: _missingHelper('renderView'),
  game: _missingHelper('game') as () => unknown,
  RenderSprite: _missingHelper('RenderSprite'),
  RenderAmount: _missingHelper('RenderAmount'),
};

export function registerTemplateHelpers(extra: Partial<TemplateHelpers>): void {
  Object.assign(templateHelpers, extra);
}

// ── tiny template engine ───────────────────────────────────────────────────
//
// Replacement for `_.template(text, null, { variable: 'D' })`. Walks
// the source for `<% … %>` and `<%= … %>` tags, emits a function
// body that pushes string fragments into `__p`, and returns a
// closure that takes the data object and returns the rendered HTML.
//
// The generated function signature matches what the existing
// templates expect: `function (D, _) { … return __p; }` — `D` is
// the data variable underscore's `variable: 'D'` opt-in already
// configured, and `_` is the templateHelpers namespace defined
// above.  A thin wrapper hides the second parameter from callers so
// `templates['foo.html'](data)` still works exactly like before.

const PRINT_FN = 'function print(){for(var i=0;i<arguments.length;i++)__p+=arguments[i];}';

function compile(text: string): (D: unknown, helpers: TemplateHelpers) => string {
  let body = "var __p='';" + PRINT_FN + '\nvar __t;\n';
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('<%', i);
    if (start === -1) {
      body += '__p+=' + JSON.stringify(text.slice(i)) + ';\n';
      break;
    }
    if (start > i) {
      body += '__p+=' + JSON.stringify(text.slice(i, start)) + ';\n';
    }
    const end = text.indexOf('%>', start + 2);
    if (end === -1) throw new Error('compileTemplate: unclosed <% tag');
    const tag = text.slice(start + 2, end);
    if (tag.charAt(0) === '=') {
      body += '__t=(' + tag.slice(1) + ');__p+=(__t==null?"":__t);\n';
    } else if (tag.charAt(0) === '-') {
      // Templates don't use this today, but keep the surface complete.
      body += '__t=(' + tag.slice(1) + ');__p+=__esc(__t==null?"":__t);\n';
    } else {
      body += tag + '\n';
    }
    i = end + 2;
  }
  body += 'return __p;';
  const ESC: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  function __esc(s: unknown): string {
    return String(s).replace(/[&<>"']/g, (c) => ESC[c] as string);
  }
  // eslint-disable-next-line no-new-func
  const fn = new Function('D', '_', '__esc', body) as (
    D: unknown,
    helpers: TemplateHelpers,
    esc: typeof __esc
  ) => string;
  return (D, helpers) => fn(D, helpers, __esc);
}

export function compileTemplate(text: string): (data?: unknown) => string {
  const fn = compile(text);
  return (data?: unknown) => fn(data ?? {}, templateHelpers);
}
