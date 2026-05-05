// ProfileSet — DB-queue entry representing a profileset awaiting integrate.
// Used both as a template for buyToken popups and as the cued object in the
// Database queue.  Extracted from scripts/Game.js's IIFE in PR 9 of
// issue #147.

import { GameNode, type GameNodeConfig } from './GameNode.js';

interface TokenInput {
  gestalt?: string;
  amount?: number;
  is_query?: boolean;
  origin_gestalt?: string;
  [key: string]: unknown;
}

/** ProfileSet's `tokens` arg can be either a flat token-list or a
 *  `{ tokens_map: {gestalt: {amount, …}} }` queue payload. */
type TokensInput =
  | TokenInput[]
  | { tokens_map: Record<string, { amount?: number; [key: string]: unknown }> };

interface TokenSetEntry {
  gestalt: string;
  amount?: number;
  collect_amount?: number;
  data?: Record<string, unknown>;
  database_amount?: number;
  database_absoluteAmount?: number;
  diffAbsoluteAmount?: number;
  diffAmount?: number;
  doneAmount?: number;
  doneAbsoluteAmount?: number;
  origin_gestalt?: string;
  is_query?: boolean;
  new?: boolean;
  locked?: boolean;
  [key: string]: unknown;
}

export interface UpgradeValuesShape {
  profiles_value: number;
  token_map: Record<string, number>;
}

interface ProfileSetOriginNode {
  states?: Record<string, boolean>;
  data?: Record<string, unknown>;
  gestalt?: string;
  id?: string;
}

/** GameRoot's surface this class touches.  Will collapse when GameRoot
 *  is extracted into its own typed module. */
interface GameRootForProfileSet {
  DBTokens: Record<string, number>;
  DBTokensAbsolute: Record<string, number>;
  profiles_value: number;
  raw_data?: { tokens_seen?: Record<string, unknown>; [key: string]: unknown };
  getTypeData(gestalt?: string): Record<string, unknown> | undefined;
}

/** ProfileSet config — extends the base GameNodeConfig with the
 *  ProfileSet-specific fields that callers stamp on at construction time
 *  (Database.cue and the various Perp `BuyToken` flows). */
export interface ProfileSetConfig extends GameNodeConfig {
  psid?: string;
  origin?: ProfileSetOriginNode;
  profiles_value?: number;
  markNew?: boolean;
  sortByGestalt?: boolean;
  convertTokens?: boolean;
  filter_is_query?: string;
  DBAmounts?: boolean;
  lockAmountZero?: boolean;
  lockNotInDB?: boolean;
  markUpgradeValues?: boolean;
  lastUpgradeValues?: UpgradeValuesShape;
}

export class ProfileSet extends GameNode {
  psid?: string;
  origin?: ProfileSetOriginNode;
  profiles_value?: number;
  markNew?: boolean;
  sortByGestalt?: boolean;
  convertTokens?: boolean;
  filter_is_query?: string;
  DBAmounts?: boolean;
  lockAmountZero?: boolean;
  lockNotInDB?: boolean;
  markUpgradeValues?: boolean;
  lastUpgradeValues?: UpgradeValuesShape;

  /** gestalt → { amount, … } map captured from the queue/collect payload. */
  tokens_map: Record<string, { amount?: number; [key: string]: unknown }> = {};
  /** Sorted token entries for the popup template. */
  tokens_set: TokenSetEntry[] = [];

  /** Popup-template scratch data; stamped by Database.openProfileSetPopup. */
  popupTemplateData?: Record<string, unknown>;

  constructor(config: ProfileSetConfig, tokens: TokensInput) {
    // Used both as a Template and as a cued object in DBQueue.
    super(config);
    const groot = this.GameRoot as unknown as GameRootForProfileSet;

    // Shallow clone to match legacy `_.clone(tokens)` — array → slice
    // (elements shared by reference), object → top-level shallow copy
    // (`tokens_map` reference shared).  Anything deeper would diverge
    // from the legacy mutation-propagation behaviour; in practice the
    // downstream `addtokens.forEach` builds fresh TokenSetEntry objects
    // so deeper cloning would wash out anyway, but matching legacy is
    // the safer default for this PR.
    let workTokens: TokensInput;
    if (Array.isArray(tokens)) {
      workTokens = tokens.slice();
    } else {
      workTokens = { tokens_map: tokens.tokens_map };
    }

    this.data = (groot.getTypeData('ProfileSet') || {}) as Record<string, unknown>;
    const filter_is_query = this.filter_is_query;

    if (this.convertTokens && Array.isArray(workTokens)) {
      workTokens = workTokens.map((t: TokenInput) => ({ gestalt: t as unknown as string }));
    }

    this.tokens_map = {};
    this.tokens_set = [];
    let addtokens: TokenInput[] = [];

    if (!Array.isArray(workTokens) && this.origin) {
      // Assume it's a token_map from the queue or collect.
      // FIXME: this messes with sorting; either use a sort key or have
      // backend supply an array.
      const tokens_map = workTokens.tokens_map || {};
      for (const k in tokens_map) {
        if (Object.prototype.hasOwnProperty.call(tokens_map, k)) {
          const v = tokens_map[k];
          const addme: TokenInput = { gestalt: k };
          if (v?.amount !== undefined) addme.amount = v.amount;
          // collect_amount is profiles_value here.
          if (this.profiles_value !== undefined) addme.collect_amount = this.profiles_value;
          // exclude origin tokens
          if (k.substring(0, 6) !== 'origin') {
            addtokens.push(addme);
          }
        }
      }
      this.tokens_map = tokens_map;
    } else if (Array.isArray(workTokens)) {
      // Assume it's from the source perp.
      // exclude origin tokens
      addtokens = workTokens.filter((n) => {
        if (n.gestalt) return n.gestalt.substring(0, 6) !== 'origin';
        return false;
      });
      if (config.filter_is_query) {
        const is_query = filter_is_query === 'blue';
        addtokens = workTokens.filter((n) => n.is_query === is_query);
      }
    }

    // Build and extend the tokens_set.
    addtokens.forEach((token) => {
      // Don't mess with the original data.
      const t: TokenSetEntry = { gestalt: token.gestalt || '', ...token };
      const td = groot.getTypeData(token.gestalt);
      if (td) t.data = td;
      if (this.DBAmounts) {
        t.database_amount = (token.gestalt ? groot.DBTokens[token.gestalt] : undefined) || 0;
        t.database_absoluteAmount =
          (token.gestalt ? groot.DBTokensAbsolute[token.gestalt] : undefined) || 0;
      }
      if (this.markNew) {
        const seenMap: Record<string, unknown> =
          (groot.raw_data && groot.raw_data.tokens_seen) || {};
        if (
          token.gestalt &&
          !Object.prototype.hasOwnProperty.call(groot.DBTokens, token.gestalt) &&
          !seenMap[token.gestalt]
        ) {
          t.new = true;
        }
      }
      if (this.lockAmountZero && token.amount === 0) {
        t.locked = true;
      }
      if (
        this.lockNotInDB &&
        token.gestalt &&
        !Object.prototype.hasOwnProperty.call(groot.DBTokens, token.gestalt)
      ) {
        t.locked = true;
      }
      if (this.markUpgradeValues && this.lastUpgradeValues && !t.locked) {
        const lastProfileValues = this.lastUpgradeValues.profiles_value;
        const lastAmount = (t.gestalt && this.lastUpgradeValues.token_map[t.gestalt]) || 0;
        const lastAbsoluteAmount = (lastProfileValues * lastAmount) / 100;
        const currentAbsoluteAmount = (t.gestalt && groot.DBTokensAbsolute[t.gestalt]) || 0;
        t.diffAbsoluteAmount = currentAbsoluteAmount - lastAbsoluteAmount;
        t.doneAbsoluteAmount = (t.database_absoluteAmount || 0) - t.diffAbsoluteAmount;
        const denom = groot.profiles_value;
        t.diffAmount = denom ? 100 / (denom / t.diffAbsoluteAmount) : 0;
        t.doneAmount = (t.database_amount || 0) - t.diffAmount;
      } else if (this.markUpgradeValues && !this.lastUpgradeValues && !t.locked) {
        t.diffAbsoluteAmount = (token.gestalt ? groot.DBTokensAbsolute[token.gestalt] : 0) || 0;
        t.diffAmount = (token.gestalt ? groot.DBTokens[token.gestalt] : 0) || 0;
        t.doneAmount = 0;
        t.doneAbsoluteAmount = 0;
      }

      // FIXME: Show origin data for debug reasons only.
      if (token.origin_gestalt) {
        const otd = groot.getTypeData(token.origin_gestalt);
        if (otd) t.data = otd;
      }
      if (t.data) {
        this.tokens_set.push(t);
      }
    });

    // Sort when locked tokens are marked.
    // biome-ignore lint/suspicious/noSelfCompare: legacy always-true guard, removal is a separate refactor
    if (this.lockAmountZero || this.lockNotInDB || 0 === 0) {
      let sorted = this.tokens_set;
      // FIXME: sortBy Gestalt for messed up TokenSets from CMS/Backend
      // (DBQueue and Clients).
      if (this.sortByGestalt) {
        sorted = sorted
          .slice()
          .sort((a, b) => (a.gestalt < b.gestalt ? -1 : a.gestalt > b.gestalt ? 1 : 0));
      }
      const unlocked = sorted.filter((t) => !t.locked);
      const locked = sorted.filter((t) => t.locked);
      this.tokens_set = unlocked.concat(locked);
    }
  }

  updateNewMarker(): void {
    const groot = this.GameRoot as unknown as GameRootForProfileSet;
    const seenMap: Record<string, unknown> = (groot.raw_data && groot.raw_data.tokens_seen) || {};
    this.tokens_set.forEach((token) => {
      if (
        token.gestalt &&
        !Object.prototype.hasOwnProperty.call(groot.DBTokens, token.gestalt) &&
        !seenMap[token.gestalt]
      ) {
        token.new = true;
      } else {
        token.new = false;
      }
    });
    if (this.popupTemplateData) {
      this.popupTemplateData.ProfileSet = this;
    }
  }
}
