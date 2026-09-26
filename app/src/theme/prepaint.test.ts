import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

import { DEFAULT_VARIANT, VARIANTS } from './variants';

const html = readFileSync(resolve(__dirname, '../../public/index.html'), 'utf8');
const script = html.match(/<script id="theme-prepaint">([\s\S]*?)<\/script>/)?.[1] ?? '';

/** The background the page paints before the app loads. */
function prepaint({ saved, light = false, moreContrast = false }: { saved?: string | null; light?: boolean; moreContrast?: boolean }): string {
  const documentElement = { style: { backgroundColor: '' } };
  runInNewContext(script, {
    document: { documentElement },
    window: {
      localStorage: { getItem: (key: string) => (key === 'nba-stock-market.design-variant' ? saved ?? null : null) },
      matchMedia: (query: string) => ({
        matches: query === '(prefers-color-scheme: light)' ? light : query === '(prefers-contrast: more)' ? moreContrast : false,
      }),
    },
  });
  return documentElement.style.backgroundColor;
}

test('the page paints every look\'s own background before the app loads (walk 8 T4-02)', () => {
  assert.ok(script, 'public/index.html keeps its theme-prepaint script');
  const map = JSON.parse(script.match(/var backgrounds = (\{[^}]*\});/)?.[1] ?? '{}') as Record<string, string>;
  const expected = Object.fromEntries(Object.entries(VARIANTS).map(([id, variant]) => [id, variant.palette.background]));
  assert.deepEqual(map, expected);
  const provider = readFileSync(resolve(__dirname, 'ThemeProvider.tsx'), 'utf8');
  assert.ok(provider.includes("const STORAGE_KEY = 'nba-stock-market.design-variant';"), 'the same saved key as ThemeProvider');
});

test('before the app loads, the page picks the look ThemeProvider will', () => {
  // A saved look wins, whatever the device says.
  assert.equal(prepaint({ saved: 'dark', light: true }), VARIANTS.dark.palette.background);
  assert.equal(prepaint({ saved: 'light' }), VARIANTS.light.palette.background);
  // "Match device" (or nothing saved): more contrast, then light, else navy.
  assert.equal(prepaint({ saved: 'device', moreContrast: true, light: true }), VARIANTS.contrast.palette.background);
  assert.equal(prepaint({ saved: null, light: true }), VARIANTS.light.palette.background);
  assert.equal(prepaint({ saved: null }), VARIANTS[DEFAULT_VARIANT].palette.background);
  assert.equal(prepaint({ saved: 'not-a-look' }), VARIANTS[DEFAULT_VARIANT].palette.background);
});
