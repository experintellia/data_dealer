// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getMessengerDisplayNameChange } from '../scripts/webxdc-identity.js';

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
    const newName = getMessengerDisplayNameChange(user);
    expect(newName).toBe('Alice');
  });

  it('unchanged messenger name returns null on subsequent boots', () => {
    const user = { display_name: 'Alice' };
    const newName = getMessengerDisplayNameChange(user);
    expect(newName).toBe(null);
  });

  it('updated messenger name returns the new selfName on boot', () => {
    const user = { display_name: 'OldName' };
    const newName = getMessengerDisplayNameChange(user);
    expect(newName).toBe('Alice');
  });

  it('does not mutate the input user object', () => {
    const user = { display_name: 'OldName' };
    getMessengerDisplayNameChange(user);
    expect(user.display_name).toBe('OldName');
  });

  it('does not add display_name to a user that lacks one', () => {
    const user = {};
    getMessengerDisplayNameChange(user);
    expect(Object.prototype.hasOwnProperty.call(user, 'display_name')).toBe(false);
  });

  it('returns null for a missing user', () => {
    expect(getMessengerDisplayNameChange(null)).toBe(null);
    expect(getMessengerDisplayNameChange(undefined)).toBe(null);
  });
});
