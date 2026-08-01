export const colors = {
  background: '#071017',
  surface: '#0d1923',
  surfaceRaised: '#132431',
  border: '#203442',
  text: '#f4f7f8',
  muted: '#8fa3af',
  green: '#31d07c',
  red: '#ff6470',
  gold: '#e6bd5a',
  goldSoft: '#4a3b1d',
  focus: '#7cc4ff',
};

/** Operational interface: flat corners, never above 8px. */
export const radius = {
  xs: 3,
  sm: 5,
  md: 6,
  lg: 8,
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

/**
 * Minimum legible size is 11px. Nothing below that ships — the previous build
 * used 6-9px for row metadata, which failed at arm's length on a phone.
 */
export const type = {
  micro: 11,
  label: 12,
  body: 13,
  value: 15,
  heading: 17,
  display: 24,
};

/** Web-only keyboard focus ring; ignored by native. */
export const focusRing = {
  outlineColor: colors.focus,
  outlineStyle: 'solid',
  outlineWidth: 2,
  outlineOffset: 1,
} as const;
