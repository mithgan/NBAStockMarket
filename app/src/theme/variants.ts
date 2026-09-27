import { BASE_FONTS, BASE_PALETTE } from '../theme';

/**
 * Design variants ("treatments").
 *
 * A variant owns a full palette, a font pair, and a handful of layout knobs.
 * On web, applyVariant() (web/globalStyles.ts) writes the palette into
 * `--c-*` / `--f-*` custom properties, which is all it takes: every token in
 * theme.ts reads through those properties.
 *
 * Palettes go through variant() so the chrome steps fall back to the
 * variant's OWN surface and background — not the base palette's — which keeps
 * a treatment that says nothing about its frame looking exactly as it did
 * before the chrome tokens existed.
 */

const MONO_STACK = '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';

export type VariantPalette = typeof BASE_PALETTE;

export type VariantFonts = {
  display: string;
  body: string;
};

export type VariantGlow = {
  /** Opacity of the green "up" field. */
  up: number;
  /** Opacity of the accent field. */
  accent: number;
  /** Blur radius in px, reaches CSS through --glow-blur. */
  blur: number;
  /** Diameter of each colour field in px. */
  size: number;
  /** Accent field colour; defaults to the palette cyan. */
  accentColor?: string;
};

export type DesignVariant = {
  id: VariantId;
  name: string;
  blurb: string;
  palette: VariantPalette;
  fonts: VariantFonts;
  layout: 'chrome';
  /** Portfolio chart height, the one honest per-variant layout difference. */
  chartHeight: number;
  /** How P&L signs render: a filled chip or a bare arrow. */
  signAs: 'chip' | 'arrow';
  /** Optional full-screen texture layer (see web/globalStyles.ts). */
  texture?: 'plate' | 'brushed';
  /** Optional ambient colour fields behind the content. */
  glow?: VariantGlow;
  /** Flagged in the picker. */
  isNew?: boolean;
};

function variant(overrides: Partial<VariantPalette>): VariantPalette {
  const merged = { ...BASE_PALETTE, ...overrides };
  return {
    ...merged,
    chrome: overrides.chrome ?? merged.surface,
    chromeMid: overrides.chromeMid ?? merged.surface,
    chromeSoft: overrides.chromeSoft ?? merged.background,
  };
}

export type VariantId =
  | 'default'
  | 'og'
  | 'immersive'
  | 'tape'
  | 'slab'
  | 'brushed'
  | 'grain'
  | 'dark'
  | 'light'
  | 'anvil'
  | 'monochrome'
  | 'ambient'
  | 'haze'
  | 'nocturne'
  | 'contrast';

export const VARIANTS: Record<VariantId, DesignVariant> = {
  default: {
    id: 'default',
    name: 'Flat',
    blurb: "The navy that shipped first, with no texture behind it.",
    palette: variant({}),
    fonts: { ...BASE_FONTS },
    layout: 'chrome',
    chartHeight: 168,
    signAs: 'chip',
  },
  og: {
    id: 'og',
    name: 'OG',
    blurb: "Ryan's original palette: lighter navy, softer surfaces.",
    palette: variant({
      background: '#1b212c',
      surface: '#232a39',
      surfaceRaised: '#2d3443',
      surfaceHigh: '#2a3347',
      border: '#2e3542',
      borderStrong: '#3d475c',
      text: '#fafafa',
      muted: '#b0b5bf',
      faint: '#9aa3b0',
      goldSoft: '#3a2f14',
      green: '#34d399',
      greenSoft: '#123b2b',
      red: '#ff7a83',
      redSoft: '#3b1d24',
    }),
    fonts: { ...BASE_FONTS },
    layout: 'chrome',
    chartHeight: 124,
    signAs: 'arrow',
  },
  immersive: {
    id: 'immersive',
    name: 'Immersive',
    blurb: "Near-black and chart-led. Nothing competes with the number.",
    palette: variant({
      background: '#07090d',
      surface: '#10141b',
      surfaceRaised: '#171d26',
      surfaceHigh: '#1c2330',
      border: '#1a202a',
      borderStrong: '#2b3441',
    }),
    fonts: { ...BASE_FONTS },
    layout: 'chrome',
    chartHeight: 250,
    signAs: 'arrow',
  },
  tape: {
    id: 'tape',
    name: 'Tape',
    blurb: "Ticker tape. Monospace on near-black, hard divisions.",
    palette: variant({
      background: '#0c0d10',
      surface: '#15171c',
      surfaceRaised: '#1c1f26',
      surfaceHigh: '#22252d',
      border: '#23262e',
      borderStrong: '#39404c',
    }),
    fonts: { display: MONO_STACK, body: MONO_STACK },
    layout: 'chrome',
    chartHeight: 150,
    signAs: 'arrow',
  },
  slab: {
    id: 'slab',
    name: 'Slab',
    blurb: "Machined plates, lit along the top edge.",
    palette: variant({
      background: '#111214',
      surface: '#191b1f',
      surfaceRaised: '#212429',
      surfaceHigh: '#282b31',
      border: '#2c2f35',
      borderStrong: '#434750',
    }),
    fonts: { ...BASE_FONTS },
    layout: 'chrome',
    chartHeight: 168,
    signAs: 'chip',
    texture: 'plate',
  },
  brushed: {
    id: 'brushed',
    name: 'Brushed',
    blurb: "Brushed steel, with a milled grain and a raking light.",
    palette: variant({
      background: '#0f1214',
      surface: '#171c20',
      surfaceRaised: '#1f252a',
      surfaceHigh: '#262d34',
      border: '#2a3138',
      borderStrong: '#434d57',
      muted: '#aeb7c1',
      faint: '#939da8',
    }),
    fonts: { ...BASE_FONTS },
    layout: 'chrome',
    chartHeight: 168,
    signAs: 'arrow',
    texture: 'brushed',
    isNew: true,
  },
  grain: {
    id: 'grain',
    // Named for what it is: "Match device" is where a new player starts, so
    // a theme called "Default" would mislead (walk 7 T1-N5).
    name: 'Navy',
    blurb: "Databallr's navy, the standard look.",
    palette: variant({}),
    fonts: { ...BASE_FONTS },
    layout: 'chrome',
    chartHeight: 168,
    signAs: 'arrow',
    texture: 'brushed',
  },
  dark: {
    id: 'dark',
    name: 'Dark',
    blurb: 'Near-black, easier on the eyes at night.',
    // Truly near-black and less blue: a step or two below Default's navy read
    // as the same theme on a phone (walk 7 T1-15).
    palette: variant({
      background: '#040506',
      surface: '#0a0c0f',
      surfaceRaised: '#121519',
      surfaceHigh: '#171a1f',
      border: '#171a1f',
      borderStrong: '#282d34',
      controlBorder: '#66708a',
    }),
    fonts: { ...BASE_FONTS },
    layout: 'chrome',
    chartHeight: 168,
    signAs: 'arrow',
    texture: 'brushed',
  },
  light: {
    id: 'light',
    name: 'Light',
    blurb: 'Cream and ink, for bright rooms.',
    palette: variant({
      background: '#f3ecdf',
      surface: '#faf5ea',
      surfaceRaised: '#e8dfcb',
      surfaceHigh: '#f7f1e4',
      chrome: '#e0cfae',
      chromeMid: '#e9dcc3',
      chromeSoft: '#efe7d6',
      border: '#dacdb2',
      borderStrong: '#bfaf9b',
      controlBorder: '#7d6e58',
      text: '#231f1a',
      muted: '#4c4339',
      faint: '#5c5244',
      gold: '#d9a227',
      goldInk: '#6a4e0d',
      goldSoft: '#f0e2bd',
      goldLine: '#b8912f',
      onGold: '#231f1a',
      cyan: '#14567d',
      cyanSoft: '#dae8f2',
      // Gains and losses must be told apart at a glance, not only by sign.
      green: '#1d6b3c',
      greenSoft: '#dcefe2',
      red: '#a33a30',
      redSoft: '#f6dfdb',
      focus: '#14567d',
    }),
    fonts: { ...BASE_FONTS },
    layout: 'chrome',
    chartHeight: 168,
    signAs: 'chip',
  },
  anvil: {
    id: 'anvil',
    name: 'Anvil',
    blurb: "Slab in a warmer, browner metal.",
    palette: variant({
      background: '#131211',
      surface: '#1c1a17',
      surfaceRaised: '#242220',
      surfaceHigh: '#2c2926',
      border: '#302c28',
      borderStrong: '#4b453d',
      muted: '#b6b0a6',
      faint: '#9b948a',
      goldSoft: '#2e2612',
      goldLine: '#6d5a24',
    }),
    fonts: { ...BASE_FONTS },
    layout: 'chrome',
    chartHeight: 168,
    signAs: 'chip',
    texture: 'plate',
    isNew: true,
  },
  monochrome: {
    id: 'monochrome',
    name: 'Monochrome',
    blurb: "No green or red. Gold means up, grey means down.",
    palette: variant({
      background: '#0f1114',
      surface: '#161920',
      surfaceRaised: '#1e2229',
      surfaceHigh: '#232830',
      border: '#1e2126',
      borderStrong: '#333941',
      green: '#ffcd57',
      greenSoft: '#231d0c',
      red: '#9aa1ab',
      redSoft: '#1c1f24',
    }),
    fonts: { ...BASE_FONTS },
    layout: 'chrome',
    chartHeight: 168,
    signAs: 'arrow',
  },
  ambient: {
    id: 'ambient',
    name: 'Ambient',
    blurb: "Soft colour fields behind the content.",
    palette: variant({
      background: '#0a0d14',
      surface: '#141926',
      surfaceRaised: '#1b2130',
      surfaceHigh: '#212839',
      border: '#1e2534',
      borderStrong: '#333c50',
    }),
    fonts: { ...BASE_FONTS },
    layout: 'chrome',
    chartHeight: 180,
    signAs: 'chip',
    glow: { up: 0.17, accent: 0.1, blur: 64, size: 340 },
  },
  haze: {
    id: 'haze',
    name: 'Haze',
    blurb: "Ambient with the volume down. Muted mint and rose.",
    palette: variant({
      background: '#0c0f16',
      surface: '#161b27',
      surfaceRaised: '#1d2331',
      surfaceHigh: '#232a3a',
      border: '#1f2532',
      borderStrong: '#333b4c',
      green: '#93d9b8',
      greenSoft: '#12281f',
      red: '#f0a9ae',
      redSoft: '#2b1a1d',
    }),
    fonts: { ...BASE_FONTS },
    layout: 'chrome',
    chartHeight: 180,
    signAs: 'chip',
    glow: { up: 0.1, accent: 0.07, blur: 104, size: 440 },
    isNew: true,
  },
  nocturne: {
    id: 'nocturne',
    name: 'Aurora',
    // Honest about what shows: the warm glow sits behind the page, so only
    // wide screens' margins show it (walk 4 T2-13).
    blurb: 'A lighter, softer navy.',
    palette: variant({
      background: '#161d2b',
      surface: '#1f2736',
      surfaceRaised: '#273040',
      surfaceHigh: '#2d374a',
      border: '#27313f',
      borderStrong: '#3e4a5d',
      controlBorder: '#74819b',
      muted: '#bcc4d1',
      faint: '#a6b1c1',
      green: '#8ed4b0',
      greenSoft: '#102520',
      red: '#eda6ab',
      redSoft: '#28181b',
    }),
    fonts: { ...BASE_FONTS },
    layout: 'chrome',
    chartHeight: 250,
    signAs: 'arrow',
    glow: { up: 0.07, accent: 0.11, blur: 130, size: 480, accentColor: '#e8833a' },
    texture: 'plate',
    isNew: true,
  },
  contrast: {
    id: 'contrast',
    name: 'High contrast',
    blurb: 'Bright text and strong edges. Gains in blue, losses in orange.',
    // Built for low vision and colour-blind players: pure text on black,
    // 3:1+ borders everywhere, and a blue/orange gain/loss pair that stays
    // distinct for red-green colour blindness. Arrows mark every signed change.
    palette: variant({
      background: '#000000',
      surface: '#0b0b0b',
      surfaceRaised: '#161616',
      surfaceHigh: '#1f1f1f',
      chrome: '#000000',
      chromeMid: '#0b0b0b',
      chromeSoft: '#000000',
      border: '#8a8a8a',
      borderStrong: '#d6d6d6',
      controlBorder: '#d6d6d6',
      text: '#ffffff',
      muted: '#ebebeb',
      faint: '#d2d2d2',
      gold: '#ffd21f',
      goldInk: '#ffd21f',
      goldSoft: '#2b2400',
      goldLine: '#ffd21f',
      onGold: '#000000',
      cyan: '#62d4ff',
      cyanSoft: '#00243a',
      green: '#5cb8ff',
      greenSoft: '#001c38',
      red: '#ffa24d',
      redSoft: '#381d00',
      focus: '#ffffff',
    }),
    fonts: { ...BASE_FONTS },
    layout: 'chrome',
    chartHeight: 168,
    signAs: 'arrow',
    isNew: true,
  },
};

/** Every variant, in the order the design picker lists them. */
export const VARIANT_ORDER: VariantId[] = [
  'default',
  'og',
  'immersive',
  'monochrome',
  'ambient',
  'haze',
  'nocturne',
  'contrast',
  'tape',
  'slab',
  'anvil',
  'brushed',
  'grain',
  'dark',
  'light',
];

/** The short list surfaced as appearance choices in settings. */
export const APPEARANCE_CHOICES: VariantId[] = ['grain', 'dark', 'nocturne', 'light', 'contrast'];

export const DEFAULT_VARIANT: VariantId = 'grain';

export function isVariantId(value: unknown): value is VariantId {
  return typeof value === 'string' && value in VARIANTS;
}
