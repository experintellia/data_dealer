// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
// Asserts that every file in img/ is referenced from at least one shipped
// source so that orphaned assets are caught at PR time.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readDir(dir) {
  const entries = readdirSync(dir);
  const texts = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      texts.push(...readDir(full));
    } else {
      texts.push(readFileSync(full, 'utf8'));
    }
  }
  return texts;
}

function readFile(path) {
  return readFileSync(path, 'utf8');
}

const shippedSrc = [
  ...readDir(join(root, 'scripts')),
  ...readDir(join(root, 'css')),
  ...readDir(join(root, 'views')),
  ...readDir(join(root, 'data')),
  readFile(join(root, 'index.html')),
  readFile(join(root, 'manifest.toml')),
].join('\n');

const images = readdirSync(join(root, 'img')).filter(f => /\.(png|jpg|gif|svg|webp)$/i.test(f));

describe('img/ asset references', () => {
  for (const img of images) {
    it(`${img} is referenced in shipped source`, () => {
      expect(shippedSrc).toContain(img);
    });
  }
});
