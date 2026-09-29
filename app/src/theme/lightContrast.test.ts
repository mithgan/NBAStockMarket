import assert from 'node:assert/strict';
import test from 'node:test';

import { VARIANTS } from './variants';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const palette = VARIANTS.light.palette;
const surfaces = [
  'background', 'surface', 'surfaceRaised', 'surfaceHigh',
  'chrome', 'chromeMid', 'chromeSoft',
  'goldSoft', 'cyanSoft', 'greenSoft', 'redSoft',
] as const;

test('Light accent text remains readable on every pale surface', () => {
  for (const surface of surfaces) {
    const ratio = contrast(palette.goldInk, palette[surface]);
    assert.ok(ratio >= 4.5, `goldInk on ${surface}: ${ratio.toFixed(2)}:1`);
  }
});

test('Light primary button labels and switch knobs contrast with their fill', () => {
  const ratio = contrast(palette.onGold, palette.gold);
  assert.ok(ratio >= 4.5, `onGold on gold: ${ratio.toFixed(2)}:1`);
});

test('Light focus rings remain visible inside primary buttons and on pale surfaces', () => {
  // Sheets use inset rings; their indicator must contrast with the primary
  // fill as well as with the pale backgrounds behind other controls.
  for (const surface of [...surfaces, 'gold'] as const) {
    const ratio = contrast(palette.focus, palette[surface]);
    assert.ok(ratio >= 3, `focus on ${surface}: ${ratio.toFixed(2)}:1`);
  }
});

test('Light accent borders remain distinguishable on pale surfaces', () => {
  for (const surface of surfaces) {
    const ratio = contrast(palette.goldLine, palette[surface]);
    assert.ok(ratio >= 3, `goldLine on ${surface}: ${ratio.toFixed(2)}:1`);
  }
});
