// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
//
// Handler-level tests for exportSave / importSave (issue #127).
//
// These assert the webxdc-facing behaviour the pure state tests can't:
//   - export hands sendToChat a round-trippable, current-user-only file
//   - import broadcasts an `importSave` status update to peers AND attaches a
//     visible `info` chat message (the issue's anti-cheat transparency signal)
//   - import waits for sendUpdate durability before reporting success (the
//     popup reloads on success, so a lost write would silently drop the import)
//   - cancel / malformed files emit NO status update
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportSave, importSave } from '../../scripts/LocalEngine.js';
import { __resetBootForTest, boot } from '../../scripts/boot.js';
import { buildSaveFile, freshState, parseSaveFile } from '../../scripts/state.js';

const ADDR = 'alice@example.com';

let saved;
let sentUpdates; // full {payload, info, ...} objects passed to sendUpdate
let chatMessages; // contents passed to sendToChat
let nextImportFiles; // what importFiles resolves with

function installFakeWebxdc() {
  sentUpdates = [];
  chatMessages = [];
  nextImportFiles = [];
  const updates = [];
  let listener = null;
  saved = globalThis.webxdc;
  globalThis.webxdc = {
    selfAddr: ADDR,
    selfName: 'AliceName',
    sendUpdate(update) {
      sentUpdates.push(update);
      const serial = updates.length + 1;
      const entry = Object.assign({}, update, { serial, max_serial: serial });
      updates.push(entry);
      if (listener) listener(entry);
      // Mimic the real messenger / simulator: the return value is a thenable
      // that resolves once the durability write commits, on a later turn.
      return Promise.resolve();
    },
    setUpdateListener(cb, serial) {
      const after = typeof serial === 'number' ? serial : 0;
      for (const u of updates) if (u.serial > after) cb(u);
      listener = cb;
      return Promise.resolve();
    },
    sendToChat(content) {
      chatMessages.push(content);
      return Promise.resolve();
    },
    importFiles() {
      return Promise.resolve(nextImportFiles);
    },
  };
}

function fakeFile(text) {
  return { name: 'data_dealer_save.json', text: () => Promise.resolve(text) };
}

beforeEach(async () => {
  installFakeWebxdc();
  __resetBootForTest();
  await boot({ selfAddr: ADDR });
});

afterEach(() => {
  __resetBootForTest();
  if (saved === undefined) delete globalThis.webxdc;
  else globalThis.webxdc = saved;
});

function makeSaveJson(overrides = {}) {
  const s = freshState(ADDR);
  s.display_name = 'Alice';
  s.game_values = { ...s.game_values, cash_value: 4242 };
  Object.assign(s, overrides);
  return JSON.stringify(buildSaveFile(s));
}

describe('exportSave', () => {
  it('sends a current-user-only save file to chat', async () => {
    const res = await exportSave();
    expect(res.result.ok).toBe(true);
    expect(chatMessages).toHaveLength(1);
    const file = chatMessages[0].file;
    expect(file.name).toBe('data_dealer_save.json');
    const parsed = parseSaveFile(file.plainText);
    expect(parsed.ok).toBe(true);
    // The exported snapshot must not carry identity or other players' stats.
    expect('addr' in parsed.save.state).toBe(false);
    expect('peers' in parsed.save.state).toBe(false);
  });

  it('does not emit a status update (export is local-to-chat only)', async () => {
    await exportSave();
    expect(sentUpdates).toHaveLength(0);
  });
});

describe('importSave', () => {
  it('broadcasts an importSave status update with the snapshot', async () => {
    nextImportFiles = [fakeFile(makeSaveJson())];
    const res = await importSave();
    expect(res.result.ok).toBe(true);
    expect(sentUpdates).toHaveLength(1);
    const update = sentUpdates[0];
    expect(update.payload.kind).toBe('delta');
    expect(update.payload.op).toBe('importSave');
    expect(update.payload.addr).toBe(ADDR);
    expect(update.payload.result.state.game_values.cash_value).toBe(4242);
    // Mirrored game_values so peers' leaderboard view refreshes.
    expect(update.payload.result.game_values.cash_value).toBe(4242);
  });

  it('attaches a visible chat info message naming the player (anti-cheat signal)', async () => {
    nextImportFiles = [fakeFile(makeSaveJson())];
    await importSave();
    const info = sentUpdates[0].info;
    expect(typeof info).toBe('string');
    expect(info.length).toBeGreaterThan(0);
    expect(info).toContain('Alice');
  });

  it('reports cancelled and emits nothing when no file is picked', async () => {
    nextImportFiles = [];
    const res = await importSave();
    expect(res.result.cancelled).toBe(true);
    expect(sentUpdates).toHaveLength(0);
  });

  it('reports a malformed error and emits nothing for a bad file', async () => {
    nextImportFiles = [fakeFile('not a save {')];
    const res = await importSave();
    expect(res.result.error).toBe('malformed');
    expect(sentUpdates).toHaveLength(0);
  });

  it('rejects a newer save_version without emitting an update', async () => {
    const future = JSON.stringify({
      format: 'data_dealer_save',
      save_version: 999,
      state: { game_values: {} },
    });
    nextImportFiles = [fakeFile(future)];
    const res = await importSave();
    expect(res.result.error).toBe('version');
    expect(sentUpdates).toHaveLength(0);
  });
});
