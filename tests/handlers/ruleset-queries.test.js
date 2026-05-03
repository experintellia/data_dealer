import { describe, it, expect, beforeEach } from 'vitest';
import { getProvidedPerps, getPowerups } from '../../scripts/LocalEngine.js';
import { setState } from '../../scripts/boot.js';
import { freshState } from '../../scripts/state.js';

// ── fixtures ──────────────────────────────────────────────────────────────────

function mkNode(gestalt, gameType, fullPath) {
  return {
    game_id: gestalt,
    game_type: gameType,
    gestalt: gestalt,
    full_type: gameType + ':' + gestalt,
    full_path: fullPath,
    instance_data: {}
  };
}

function mkState(overrides) {
  return Object.assign(freshState('test@local'), overrides || {});
}

// agent002 (AgentPerp) has provided_perps:
//   contact035 (required_level: 1), contact001 (required_level: 3),
//   contact019 (required_level: 4), contact022 (required_level: 6)
const AGENT_PATH = 'Imperium.CityVienna.Agent0';
const agentNode = mkNode('agent002', 'AgentPerp', AGENT_PATH);

// city002 (CityPerp) has provided_perps:
//   agent002   (required_level: 1, no providers)
//   agent004   (required_level: 6)
//   pusher004  (required_level: 1, required_providers: [project002,contact035,project003,contact001])
//   pusher003  (required_level: 1, required_providers: [contact026,contact008])
//   proxy001   (required_level: 2)
//   proxy004   (required_level: 9)
const CITY_PATH = 'Imperium.City';
const cityNode = mkNode('city002', 'CityPerp', CITY_PATH);

// ── getProvidedPerps — happy path ─────────────────────────────────────────────

describe('getProvidedPerps — happy path', () => {
  beforeEach(() => {
    setState(mkState({
      nodes: [agentNode],
      game_values: { xp_level: 1 }
    }));
  });

  it('resolves to an object with result.buyable array', async () => {
    const data = await getProvidedPerps(AGENT_PATH);
    expect(data).toHaveProperty('result');
    expect(Array.isArray(data.result.buyable)).toBe(true);
  });

  it('includes only gestalts whose required_level <= player xp_level', async () => {
    // xp_level: 1 — only contact035 (required_level 1) should pass
    const { result } = await getProvidedPerps(AGENT_PATH);
    expect(result.buyable).toContain('contact035');
    expect(result.buyable).not.toContain('contact001');  // level 3
    expect(result.buyable).not.toContain('contact019');  // level 4
    expect(result.buyable).not.toContain('contact022');  // level 6
  });

  it('includes additional gestalts when player level is higher', async () => {
    setState(mkState({
      nodes: [agentNode],
      game_values: { xp_level: 3 }
    }));
    const { result } = await getProvidedPerps(AGENT_PATH);
    expect(result.buyable).toContain('contact035');
    expect(result.buyable).toContain('contact001');
    expect(result.buyable).not.toContain('contact019');  // level 4
  });

  it('result contains gestalt strings, not objects', async () => {
    const { result } = await getProvidedPerps(AGENT_PATH);
    result.buyable.forEach(function (item) {
      expect(typeof item).toBe('string');
    });
  });
});

// ── getProvidedPerps — prerequisite filtering ─────────────────────────────────

describe('getProvidedPerps — prerequisite filtering', () => {
  it('excludes perps whose required_providers are not owned', async () => {
    setState(mkState({
      nodes: [cityNode],
      game_values: { xp_level: 3 }
    }));
    const { result } = await getProvidedPerps(CITY_PATH);
    // pusher004 needs project002, contact035, etc. — none owned
    expect(result.buyable).not.toContain('pusher004');
    // pusher003 needs contact026, contact008 — none owned
    expect(result.buyable).not.toContain('pusher003');
  });

  it('includes perp once all required_providers are owned', async () => {
    // pusher003 requires contact026 and contact008
    setState(mkState({
      nodes: [
        cityNode,
        mkNode('contact026', 'ContactPerp', 'Imperium.City.contact026'),
        mkNode('contact008', 'ContactPerp', 'Imperium.City.contact008')
      ],
      game_values: { xp_level: 3 }
    }));
    const { result } = await getProvidedPerps(CITY_PATH);
    expect(result.buyable).toContain('pusher003');
  });
});

// ── getProvidedPerps — edge cases ─────────────────────────────────────────────

describe('getProvidedPerps — edge cases', () => {
  it('returns {error: 0} for unknown path (node not in state)', async () => {
    setState(mkState({ nodes: [] }));
    const data = await getProvidedPerps('Imperium.NoSuchNode');
    expect(data.result).toEqual({ error: 0 });
  });

  it('returns {error: 0} for node with gestalt absent from ruleset', async () => {
    const unknownNode = mkNode('nonexistent_gestalt', 'ContactPerp', 'Imperium.X');
    setState(mkState({ nodes: [unknownNode] }));
    const data = await getProvidedPerps('Imperium.X');
    expect(data.result).toEqual({ error: 0 });
  });

  it('returns empty buyable array for a perp with no provided_perps', async () => {
    // ContactPerp nodes have no provided_perps
    const contactNode = mkNode('contact001', 'ContactPerp', 'Imperium.City.contact001');
    setState(mkState({
      nodes: [contactNode],
      game_values: { xp_level: 10 }
    }));
    const { result } = await getProvidedPerps('Imperium.City.contact001');
    expect(result.buyable).toEqual([]);
  });

  it('derives gestalt from full_type when gestalt field is absent', async () => {
    const nodeNoGestalt = {
      game_id: 'agent002',
      game_type: 'AgentPerp',
      full_type: 'AgentPerp:agent002',
      full_path: AGENT_PATH,
      instance_data: {}
      // intentionally omit gestalt
    };
    setState(mkState({
      nodes: [nodeNoGestalt],
      game_values: { xp_level: 1 }
    }));
    const { result } = await getProvidedPerps(AGENT_PATH);
    expect(Array.isArray(result.buyable)).toBe(true);
    expect(result.buyable).toContain('contact035');
  });
});

// ── getProvidedPerps — locale fallback ────────────────────────────────────────

describe('getProvidedPerps — locale fallback', () => {
  it('uses EN ruleset when state.locale is "en"', async () => {
    setState(mkState({
      locale: 'en',
      nodes: [agentNode],
      game_values: { xp_level: 1 }
    }));
    // EN ruleset has same gesture structure; handler must not throw or error out
    const data = await getProvidedPerps(AGENT_PATH);
    expect(Array.isArray(data.result.buyable)).toBe(true);
  });

  it('falls back to DE ruleset for unknown locale values', async () => {
    setState(mkState({
      locale: 'fr',  // unknown locale → falls back to DE
      nodes: [agentNode],
      game_values: { xp_level: 1 }
    }));
    const data = await getProvidedPerps(AGENT_PATH);
    expect(Array.isArray(data.result.buyable)).toBe(true);
    expect(data.result.buyable).toContain('contact035');
  });
});

// ── getPowerups — happy path ───────────────────────────────────────────────────

describe('getPowerups — happy path', () => {
  beforeEach(() => setState(mkState()));

  it('resolves to an object with a result array', async () => {
    const data = await getPowerups('project001', '1');
    expect(data).toHaveProperty('result');
    expect(Array.isArray(data.result)).toBe(true);
    expect(data.result.length).toBeGreaterThan(0);
  });

  it('each entry has game_gestalt, game_type, and type_data with gestalt', async () => {
    const { result } = await getPowerups('project001', '1');
    result.forEach(function (item) {
      expect(typeof item.game_gestalt).toBe('string');
      expect(typeof item.game_type).toBe('string');
      expect(typeof item.type_data).toBe('object');
      expect(typeof item.type_data.gestalt).toBe('string');
    });
  });

  it('game_gestalt matches type_data.gestalt', async () => {
    const { result } = await getPowerups('project001', '1');
    result.forEach(function (item) {
      expect(item.game_gestalt).toBe(item.type_data.gestalt);
    });
  });

  it('type_data includes project-specific modifiers', async () => {
    const { result } = await getPowerups('project001', '1');
    result.forEach(function (item) {
      expect(typeof item.type_data.price).toBe('number');
      expect(typeof item.type_data.charge_cost_modifier).toBe('number');
    });
  });

  it('type_data includes global powerup fields (label, popup_sprite)', async () => {
    const { result } = await getPowerups('project001', '1');
    result.forEach(function (item) {
      expect(typeof item.type_data.label).toBe('string');
    });
  });

  it('result covers all three slot categories (ads + upgrades + teammembers)', async () => {
    const { result } = await getPowerups('project001', '1');
    const types = result.map(function (item) { return item.game_type; });
    expect(types).toContain('AdPowerup');
    expect(types).toContain('UpgradePowerup');
    expect(types).toContain('TeamMemberPowerup');
  });

  it('version argument is ignored — same result regardless of value', async () => {
    const a = await getPowerups('project001', '1');
    const b = await getPowerups('project001', '999');
    expect(a.result).toEqual(b.result);
  });
});

// ── getPowerups — edge cases ───────────────────────────────────────────────────

describe('getPowerups — edge cases', () => {
  beforeEach(() => setState(mkState()));

  it('returns empty array for unknown projectGestalt', async () => {
    const data = await getPowerups('nonexistent_project', '1');
    expect(data).toEqual({ result: [] });
  });

  it('returns empty array for a perp type with no provided powerups (e.g. ContactPerp)', async () => {
    const data = await getPowerups('contact001', '1');
    expect(data.result).toEqual([]);
  });

  it('project with no provided_ads still returns upgrades and teammembers', async () => {
    // project005 has provided_ads: [] in the DE ruleset
    const { result } = await getPowerups('project005', '1');
    expect(result.length).toBeGreaterThan(0);
    const types = result.map(function (i) { return i.game_type; });
    expect(types).not.toContain('AdPowerup');
    expect(types).toContain('UpgradePowerup');
    expect(types).toContain('TeamMemberPowerup');
  });
});
