/**
 * Design tokens.
 *
 * Every colour is exposed two ways:
 *
 *  - `BASE_PALETTE` holds the literal hex values of the default (Flat navy)
 *    variant. Non-web platforms and anything that must do colour math read
 *    from here.
 *  - `colors` wraps each token in `var(--c-<name>, <hex>)` on web, so a design
 *    variant can restyle the whole app by rewriting custom properties on
 *    `:root` (see theme/variants.ts and web/globalStyles.ts) while native
 *    keeps the plain value.
 *
 * The chrome tokens are the app frame's own steps: `chrome` is the brand bar,
 * `chromeMid` the tab bar, `chromeSoft` the season strip. They default to the
 * base surface/background so a variant that says nothing about its frame looks
 * exactly as it did before the tokens existed; variants that darken or lighten
 * their surfaces override them explicitly.
 */
const isWeb = typeof document !== 'undefined';

function webVar(name: string, fallback: string): string {
  return isWeb ? `var(--c-${name}, ${fallback})` : fallback;
}

export const BASE_PALETTE = {
  background: '#0e1218',
  surface: '#151b24',
  surfaceRaised: '#1d2531',
  surfaceHigh: '#222b39',
  chrome: '#151b24',
  chromeMid: '#151b24',
  chromeSoft: '#0e1218',
  border: '#212936',
  borderStrong: '#323c4e',
  text: '#f7f8fa',
  muted: '#aab2c0',
  faint: '#8d97a8',
  gold: '#ffcd57',
  goldInk: '#ffcd57',
  goldSoft: '#2f2610',
  goldLine: '#6b571f',
  cyan: '#3abff8',
  cyanSoft: '#12303f',
  green: '#3ddc97',
  greenSoft: '#0f3225',
  red: '#ff8189',
  redSoft: '#33181e',
  focus: '#7cc4ff',
};

export const colors = {
  background: webVar('background', BASE_PALETTE.background),
  surface: webVar('surface', BASE_PALETTE.surface),
  surfaceRaised: webVar('surfaceRaised', BASE_PALETTE.surfaceRaised),
  surfaceHigh: webVar('surfaceHigh', BASE_PALETTE.surfaceHigh),
  chrome: webVar('chrome', BASE_PALETTE.chrome),
  chromeMid: webVar('chromeMid', BASE_PALETTE.chromeMid),
  chromeSoft: webVar('chromeSoft', BASE_PALETTE.chromeSoft),
  border: webVar('border', BASE_PALETTE.border),
  borderStrong: webVar('borderStrong', BASE_PALETTE.borderStrong),
  text: webVar('text', BASE_PALETTE.text),
  muted: webVar('muted', BASE_PALETTE.muted),
  faint: webVar('faint', BASE_PALETTE.faint),
  gold: webVar('gold', BASE_PALETTE.gold),
  goldInk: webVar('goldInk', BASE_PALETTE.goldInk),
  goldSoft: webVar('goldSoft', BASE_PALETTE.goldSoft),
  goldLine: webVar('goldLine', BASE_PALETTE.goldLine),
  cyan: webVar('cyan', BASE_PALETTE.cyan),
  cyanSoft: webVar('cyanSoft', BASE_PALETTE.cyanSoft),
  green: webVar('green', BASE_PALETTE.green),
  greenSoft: webVar('greenSoft', BASE_PALETTE.greenSoft),
  red: webVar('red', BASE_PALETTE.red),
  redSoft: webVar('redSoft', BASE_PALETTE.redSoft),
  focus: webVar('focus', BASE_PALETTE.focus),
};

export const radius = {
  none: 0,
  xs: 3,
  sm: 4,
  md: 6,
  lg: 8,
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

const DISPLAY_STACK = '"DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const BODY_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Literal font stacks, for the same reason BASE_PALETTE exists. */
export const BASE_FONTS = {
  display: DISPLAY_STACK,
  body: BODY_STACK,
};

/** Variant-aware font stacks: custom-property indirection on web only. */
export const fonts = {
  display: isWeb ? `var(--f-display, ${DISPLAY_STACK})` : DISPLAY_STACK,
  body: isWeb ? `var(--f-body, ${BODY_STACK})` : BODY_STACK,
};

export const type = {
  label: 11,
  body: 13,
  value: 15,
  title: 17,
  display: 34,
  hero: 46,
};

export const weight = {
  regular: '400',
  medium: '500',
  bold: '700',
  heavy: '800',
  black: '900',
} as const;

export const labelStyle = {
  fontFamily: fonts.display,
  fontSize: type.label,
  fontWeight: weight.heavy,
  letterSpacing: 1.1,
  color: colors.faint,
  textTransform: 'uppercase',
} as const;

export const headingStyle = {
  fontFamily: fonts.display,
  fontSize: type.title,
  fontWeight: weight.heavy,
  letterSpacing: -0.3,
  color: colors.text,
} as const;

/** Columns of live numbers hold still only when every digit is the same width. */
export const numeric = {
  fontFamily: fonts.display,
  fontVariant: ['tabular-nums'],
} as const;

export const heroNumber = {
  fontFamily: fonts.display,
  fontVariant: ['tabular-nums'],
  fontSize: type.hero,
  fontWeight: weight.bold,
  letterSpacing: -1.6,
  color: colors.text,
} as const;
