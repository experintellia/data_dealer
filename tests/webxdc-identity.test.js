import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyWebxdcIdentity } from '../scripts/webxdc-identity.js';

describe('webxdc identity', () => {
  let savedWebxdc;

  beforeEach(() => {
    savedWebxdc = globalThis.webxdc;
    globalThis.webxdc = { selfName: 'Alice', selfAddr: 'alice@example.com' };
  });

  afterEach(() => {
    globalThis.webxdc = savedWebxdc;
  });

  it('first boot seeds display_name from webxdc.selfName', () => {
    const user = {};
    const seeded = applyWebxdcIdentity(user);
    expect(user.display_name).toBe('Alice');
    expect(seeded).toBe(true);
  });

  it('existing display_name is preserved on subsequent boots', () => {
    const user = { display_name: 'CustomName' };
    const seeded = applyWebxdcIdentity(user);
    expect(user.display_name).toBe('CustomName');
    expect(seeded).toBe(false);
  });
});
