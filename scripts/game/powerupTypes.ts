// Mapping helpers between Powerup game-type names ('UpgradePowerup',
// 'AdPowerup', 'TeamMemberPowerup') and their gestalt-prefix
// shorthand ('upgrade', 'ad', 'teammember').  Used by ProjectPerp's
// compilePowerups / BuySlots / updatePopupGracefully.
//
// Extracted from scripts/Game.js's IIFE in PR 15 of issue #147.

const TYPE_TO_PREFIX: Record<string, string> = {
  UpgradePowerup: 'upgrade',
  AdPowerup: 'ad',
  TeamMemberPowerup: 'teammember',
};

const PREFIX_TO_TYPE: Record<string, string> = {
  upgrade: 'UpgradePowerup',
  ad: 'AdPowerup',
  teammember: 'TeamMemberPowerup',
};

export function convertPowerupType(game_type: string): string | undefined {
  return TYPE_TO_PREFIX[game_type];
}

export function getPowerupTypeFromGestalt(gestalt: string): string | undefined {
  for (const prefix of Object.keys(PREFIX_TO_TYPE)) {
    if (gestalt.startsWith(prefix)) return PREFIX_TO_TYPE[prefix];
  }
  return undefined;
}
