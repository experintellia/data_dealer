import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// On this dev machine Chromium lives at a fixed path; in CI `playwright install`
// puts it wherever Playwright decides.  Only override when the path exists so
// the config works in both environments.
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const chromiumExecutablePath = existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined;

// Variant the dev server (and therefore the e2e run) builds against.
// Defaults to 'hq' to preserve historical behaviour; CI sets BUILD_VARIANT
// explicitly to exercise both variants on every push.  Validate early so a
// typo fails fast instead of being silently treated as 'hq' by vite.config.js.
const BUILD_VARIANT = process.env.BUILD_VARIANT ?? 'hq';
if (BUILD_VARIANT !== 'hq' && BUILD_VARIANT !== 'casual') {
  throw new Error(`BUILD_VARIANT must be 'hq' or 'casual', got '${BUILD_VARIANT}'`);
}

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  forbidOnly: !!process.env.CI,

  // `toHaveScreenshot` defaults to a pixel-perfect match; tiny
  // anti-aliasing differences between local Chromium and CI's
  // (also-Chromium-but-rebuilt-from-source) flag the dialog-screenshot
  // baselines as diffs.  Allow up to 1% of pixels to differ before
  // failing — well below the threshold for an actual visual
  // regression (a missing icon, a moved chip, a clipped header).
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },

  use: {
    baseURL: 'http://localhost:3000',
    // Traces and screenshots are captured on failure for CI artifact upload.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    // Pre-seed the webxdc-shim localStorage with a setLocale:'en' delta so
    // locale_persisted is true from the very first navigation.  Without this,
    // the language chooser appears before render() on every fresh context and
    // tests that wait directly for [data-testid="game-container"] time out.
    storageState: 'tests/e2e/playwright-storage-state.json',
  },

  projects: [
    {
      // webxdc runtimes are Chromium-based — no need to run on other engines.
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          ...(chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {}),
        },
      },
    },
  ],

  // Start the Vite dev server before the test suite.  In CI the server is
  // started fresh every run; locally an already-running server is reused so
  // we don't pay the cold-start cost on repeated runs.
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    // Propagate the variant so vite picks it up (vite.config.js reads
    // process.env.BUILD_VARIANT at config time).  CI runs the suite twice
    // — once per variant — to keep both code paths exercised.
    env: {
      BUILD_VARIANT,
    },
  },
});
