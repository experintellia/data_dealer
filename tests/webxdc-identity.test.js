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

  it('unchanged messenger name is a no-op on subsequent boots', () => {
    const user = { display_name: 'Alice' };
    const seeded = applyWebxdcIdentity(user);
    expect(user.display_name).toBe('Alice');
    expect(seeded).toBe(false);
  });

  it('updated messenger name replaces stored name on boot', () => {
    const user = { display_name: 'OldName' };
    const seeded = applyWebxdcIdentity(user);
    expect(user.display_name).toBe('Alice');
    expect(seeded).toBe(true);
  });
});
