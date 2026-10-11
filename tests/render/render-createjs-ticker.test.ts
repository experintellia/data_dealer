// The bundled TweenJS Ticker picks its loop from `timingMode`; the legacy
// `useRAF` flag no longer exists there, so setting it left tweens on
// setTimeout.  Fake Ticker carries the vendor constants
// (vendor/tweenjs.js: RAF_SYNCHED="synched", RAF="raf", TIMEOUT="timeout").

import { expect, it } from 'vitest';

it('tickerSetUseRAF drives Ticker.timingMode', async () => {
  const Ticker = {
    RAF_SYNCHED: 'synched',
    RAF: 'raf',
    TIMEOUT: 'timeout',
    timingMode: null as string | null,
    framerate: 0,
    addEventListener() {},
    removeEventListener() {},
  };
  (globalThis as { createjs?: unknown }).createjs = { Ticker };
  const { tickerSetUseRAF } = await import('../../scripts/render/renderCreatejsTicker.js');

  tickerSetUseRAF(true);
  expect(Ticker.timingMode).toBe('synched');
  tickerSetUseRAF(false);
  expect(Ticker.timingMode).toBe('timeout');
});
