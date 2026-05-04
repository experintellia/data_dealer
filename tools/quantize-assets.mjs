// Generate img-casual/ and icon-casual.png from img/ and icon.png by
// running pngquant + oxipng. Both are committed to the repo so CI and
// fork builds don't need to install these tools.
//
// Re-run this script whenever the canonical assets in img/ or
// icon.png change. The casual outputs are deterministic for a given
// set of inputs + tool versions, so a re-run produces a clean diff
// that's safe to commit.
//
// Usage: pnpm quantize-assets

import { execSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOLERATED_PNGQUANT_EXIT = new Set([98, 99]);

function sh(cmd, { tolerate = [] } = {}) {
  try {
    execSync(cmd, { cwd: root, stdio: 'inherit' });
  } catch (err) {
    if (tolerate.includes(err.status)) {
      console.warn(
        `[quantize-assets] ${cmd.split(' ')[0]} exited ${err.status} (some files kept as-is); continuing`
      );
      return;
    }
    throw new Error(
      `[quantize-assets] ${cmd.split(' ')[0]} failed (exit ${err.status}). Is it installed? See README.md.`
    );
  }
}

console.log('[quantize-assets] resetting img-casual/ and icon-casual.png from sources');
rmSync(join(root, 'img-casual'), { recursive: true, force: true });
mkdirSync(join(root, 'img-casual'), { recursive: true });
cpSync(join(root, 'img'), join(root, 'img-casual'), { recursive: true });
copyFileSync(join(root, 'icon.png'), join(root, 'icon-casual.png'));

console.log('[quantize-assets] pngquant pass');
sh(
  'pngquant --quality 40-95 --strip --skip-if-larger --force --ext .png img-casual/*.png icon-casual.png',
  { tolerate: [...TOLERATED_PNGQUANT_EXIT] }
);

console.log('[quantize-assets] oxipng -o max --strip safe pass');
sh('oxipng -o max --strip safe img-casual/*.png icon-casual.png');

console.log('[quantize-assets] done. Commit any diffs in img-casual/ and icon-casual.png.');
