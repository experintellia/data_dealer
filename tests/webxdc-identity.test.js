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

  it('first boot returns the selfName when display_name is missing', () => {
    const user = {};
    const newName = applyWebxdcIdentity(user);
    expect(newName).toBe('Alice');
  });

  it('unchanged messenger name returns null on subsequent boots', () => {
    const user = { display_name: 'Alice' };
    const newName = applyWebxdcIdentity(user);
    expect(newName).toBe(null);
  });

  it('updated messenger name returns the new selfName on boot', () => {
    const user = { display_name: 'OldName' };
    const newName = applyWebxdcIdentity(user);
    expect(newName).toBe('Alice');
  });

  it('does not mutate the input user object', () => {
    const user = { display_name: 'OldName' };
    applyWebxdcIdentity(user);
    expect(user.display_name).toBe('OldName');
  });

  it('does not add display_name to a user that lacks one', () => {
    const user = {};
    applyWebxdcIdentity(user);
    expect(Object.prototype.hasOwnProperty.call(user, 'display_name')).toBe(false);
  });

  it('returns null for a missing user', () => {
    expect(applyWebxdcIdentity(null)).toBe(null);
    expect(applyWebxdcIdentity(undefined)).toBe(null);
  });
});
