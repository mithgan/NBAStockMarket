import assert from 'node:assert/strict';
import test from 'node:test';

import { colors, radius, type } from './theme';

function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Every background a text token can land on. */
const SURFACES: [string, string][] = [
  ['background', colors.background],
  ['surface', colors.surface],
  ['surfaceRaised', colors.surfaceRaised],
  ['surfaceHigh', colors.surfaceHigh],
  ['goldSoft', colors.goldSoft],
  ['redSoft', colors.redSoft],
  ['greenSoft', colors.greenSoft],
];

/**
 * Text tokens, all of which are used at 11-17px somewhere in the app, so they
 * are held to the WCAG AA normal-text ratio rather than the large-text one.
 */
const TEXT_TOKENS: [string, string][] = [
  ['text', colors.text],
  ['muted', colors.muted],
  ['faint', colors.faint],
  ['gold', colors.gold],
  ['green', colors.green],
  ['red', colors.red],
  ['cyan', colors.cyan],
];

test('every text colour clears WCAG AA against every surface it can sit on', () => {
  for (const [tokenName, token] of TEXT_TOKENS) {
    for (const [surfaceName, surface] of SURFACES) {
      const ratio = contrast(token, surface);
      assert.ok(
        ratio >= 4.5,
        `${tokenName} on ${surfaceName} is ${ratio.toFixed(2)}:1, below the 4.5:1 minimum`,
      );
    }
  }
});

test('the contrast helper itself is calibrated', () => {
  // Known anchors: black on white is 21:1, a colour on itself is 1:1.
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(Math.round(contrast(colors.gold, colors.gold)), 1);
});

test('the palette stays the databallr navy and gold, not a generic dark theme', () => {
  // The base world deepened for the design variants, but it is still the
  // databallr navy-and-gold family; Ryan's original #1b212c lives on as the
  // OG variant (see theme/variants.ts).
  assert.equal(colors.background, '#0e1218');
  assert.equal(colors.gold, '#ffcd57');
  assert.equal(colors.cyan, '#3abff8');
});

test('radii stay flat and no type role drops below 11px', () => {
  assert.equal(radius.lg, 8);
  for (const [role, size] of Object.entries(type)) {
    assert.ok(size >= 11, `type.${role} is ${size}px`);
  }
});
