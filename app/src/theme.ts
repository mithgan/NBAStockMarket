/**
 * Databallr design tokens.
 *
 * Colours are the hex equivalents of the HSL custom properties in the
 * databallr.com stylesheet (`src/index.css`), so this app sits in the same
 * navy/gold world as the rest of the product rather than approximating it:
 *
 *   --background 220 24% 14%  -> #1b212c      --primary   42 100% 67% -> #ffcd57
 *   --card       220 24% 18%  -> #232a39      --secondary 198 93% 60% -> #3abff8
 *   --muted      220 20% 22%  -> #2d3443      --border    220 18% 22% -> #2e3542
 */
export const colors = {
  /** Page background. */
  background: '#1b212c',
  /** Raised surface: rows, tiles, inputs. */
  surface: '#232a39',
  /** Pressed / selected surface. */
  surfaceRaised: '#2d3443',
  /** Highest surface: modals, popovers. */
  surfaceHigh: '#2a3347',
  /** Hairlines and section rules. */
  border: '#2e3542',
  /** Stronger divider for structural edges. */
  borderStrong: '#3d475c',

  text: '#fafafa',
  muted: '#b0b5bf',
  /**
   * Dimmest legible tier. Verified >= 4.5:1 against background, surface,
   * surfaceRaised, redSoft and goldSoft — it carries real 11px text, so it
   * cannot be a decorative grey.
   */
  faint: '#9aa3b0',

  /** Primary accent. You, selected, primary action, positive moments. */
  gold: '#ffcd57',
  goldSoft: '#3a2f14',
  goldLine: '#6b571f',

  /** Secondary accent. Rivals, informational states. */
  cyan: '#3abff8',
  cyanSoft: '#12303f',

  green: '#34d399',
  greenSoft: '#123b2b',
  /** Lightened from the databallr --destructive so 11px P&L clears 4.5:1. */
  red: '#ff7a83',
  redSoft: '#3b1d24',

  focus: '#7cc4ff',
};

/**
 * Databallr's own `--radius` is 16px, but this surface is a dense data table
 * rather than a marketing page, so it stays flat: 8px is the ceiling and most
 * structure is expressed with rules instead of rounded containers.
 */
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

/**
 * DM Sans is the databallr.com display face. On web it is loaded by
 * `installGlobalWebStyles`; native falls back to the system stack.
 */
export const fonts = {
  display: '"DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

/**
 * Four deliberate roles. Nothing renders below 11px.
 *
 *  label   tiny uppercase, wide tracking — names a value, never competes with it
 *  body    row text
 *  value   numbers inside rows
 *  title   section and screen headings
 *  display the one number per screen that should be read first
 */
export const type = {
  label: 11,
  body: 13,
  value: 15,
  title: 17,
  display: 34,
};

export const weight = {
  regular: '400',
  medium: '500',
  bold: '700',
  heavy: '800',
  black: '900',
} as const;

/** Uppercase micro-label used above every number and section. */
export const labelStyle = {
  fontFamily: fonts.display,
  fontSize: type.label,
  fontWeight: weight.heavy,
  letterSpacing: 1.1,
  color: colors.faint,
  textTransform: 'uppercase',
} as const;

/** Tabular figures so columns of money never jitter as values change. */
export const numeric: { fontFamily: string; fontVariant: 'tabular-nums'[] } = {
  fontFamily: fonts.display,
  fontVariant: ['tabular-nums'],
};
