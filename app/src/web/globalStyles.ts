import { BASE_FONTS, BASE_PALETTE, colors } from '../theme';

const STYLE_ELEMENT_ID = 'nba-stock-market-global-styles';
const FONT_LINK_ID = 'nba-stock-market-font';

/** databallr.com's display face. Falls back to the system stack if it fails. */
const DM_SANS = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800;900&display=swap';

/**
 * react-native-web renders every Pressable with `outline: none`, which leaves
 * keyboard users with no visible focus indicator at all (WCAG 2.4.7). Expo web
 * has no stylesheet of its own, so the rules are injected once at startup.
 *
 * The same sheet seeds the design-variant custom properties, loads the brand
 * font, paints the page background so overscroll matches the app, and carries
 * the global reduced-motion escape hatch.
 */
export function installGlobalWebStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;

  if (!document.getElementById(FONT_LINK_ID)) {
    const preconnect = document.createElement('link');
    preconnect.rel = 'preconnect';
    preconnect.href = 'https://fonts.gstatic.com';
    preconnect.crossOrigin = 'anonymous';
    document.head.appendChild(preconnect);

    const font = document.createElement('link');
    font.id = FONT_LINK_ID;
    font.rel = 'stylesheet';
    font.href = DM_SANS;
    document.head.appendChild(font);
  }

  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  const seededProperties = [
    ...Object.entries(BASE_PALETTE).map(([token, value]) => `  --c-${token}: ${value};`),
    `  --f-display: ${BASE_FONTS.display};`,
    `  --f-body: ${BASE_FONTS.body};`,
  ].join('\n');
  style.textContent = `
/* Seeds the default variant. applyVariant() overwrites these on the same
   element when a different design variant is chosen. */
:root {
${seededProperties}
}

html, body, #root {
  background-color: ${colors.background};
}

/* Rows answer the pointer.

   A list of thirty players that only responds on click reads as a printed
   table. The dataSet prop is how react-native-web exposes a real data
   attribute, which is the only reliable hook here: its class names are atomic
   and it drops the hover props outright. Only rows carry the marker, so filled
   buttons keep the colour they were given.

   Hover is gated on a pointer that can actually hover, or a touch device paints
   the last-tapped row as though it were still under a cursor. */
@media (hover: hover) and (pointer: fine) {
  [data-row]:hover {
    background-color: var(--c-surface, ${BASE_PALETTE.surface});
  }
}
[data-row] {
  transition: background-color 120ms ease-out;
}

/* A player card lifts toward the cursor and takes a gold edge.

   Rows only need to say "this one"; a card is an object on a board, so it can
   afford to move. The lift is 2px — enough to read as a response, small enough
   that a grid of ten does not appear to wobble. Transform and border only: a
   shadow here would need a real offset and blur to be honest depth, and the
   flat world this interface commits to does not have one. */
@media (hover: hover) and (pointer: fine) {
  [data-card="player"]:hover {
    transform: translateY(-2px);
    border-color: var(--c-goldLine, ${BASE_PALETTE.goldLine});
    background-color: var(--c-surfaceRaised, ${BASE_PALETTE.surfaceRaised});
  }
}
[data-card="player"] {
  transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1),
              border-color 140ms ease-out,
              background-color 140ms ease-out;
}

/* Scrubbing snaps to real settled dates, and it always will: every readout has
   to name a night that actually happened. But snapping to four points across a
   wide plot means the marker teleports, and the further apart the points the
   more it reads as a glitch rather than a reading. Animating the move keeps the
   honesty of the snap and gives the eye something to follow, which is the whole
   of what "clunky" was describing. Geometry properties are animatable in CSS,
   and browsers that disagree simply keep the instant jump.

   The global prefers-reduced-motion rule below neutralises these. */
#scrub-plot-portfolio svg circle,
#scrub-plot-watchlist svg circle,
#scrub-plot-detail svg circle {
  transition: cx 110ms cubic-bezier(0.22, 1, 0.36, 1), cy 110ms cubic-bezier(0.22, 1, 0.36, 1);
}
#scrub-plot-portfolio svg line,
#scrub-plot-watchlist svg line,
#scrub-plot-detail svg line {
  transition: x1 110ms cubic-bezier(0.22, 1, 0.36, 1), x2 110ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* SVG labels take the app's face. A presentation attribute cannot resolve the
   custom property the variant font ships as, so without this the high and low
   markers render in the browser's default serif. */
#scrub-plot-detail svg text {
  font-family: var(--f-display, ${BASE_FONTS.display});
  letter-spacing: 0.6px;
}

/* Brushed steel. The grain is a 3px repeating gradient running the length of
   the screen, and the raking light crossing it is what makes the two read as
   one milled surface instead of as stripes. Both are held near the threshold of
   visibility on purpose: this sits under live numbers, and a texture a reader
   can actually resolve is a texture competing with them. */
#variant-texture-brushed {
  background-image:
    repeating-linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.021) 0px,
      rgba(255, 255, 255, 0.021) 1px,
      transparent 1px,
      transparent 3px
    ),
    linear-gradient(
      168deg,
      rgba(255, 255, 255, 0.07) 0%,
      rgba(255, 255, 255, 0.018) 26%,
      transparent 52%
    );
}

/* A gradient is not a React Native style, so the plate reaches CSS the same way
   the blur does. */
#variant-texture-plate {
  background-image: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.055) 0,
    rgba(255, 255, 255, 0.012) 90px,
    transparent 200px
  );
}

/* Blur is not a React Native style, so Ambient's colour fields reach it here.
   nativeID renders as a DOM id, which is the typed way to address a view. */
#ambient-field-up, #ambient-field-accent {
  filter: blur(var(--glow-blur, 64px));
}

/* Atmosphere is decoration. A reader who has asked for less transparency has
   asked not to have colour fields drifting behind their money. */
@media (prefers-reduced-transparency: reduce) {
  #ambient-field-up, #ambient-field-accent { display: none; }
}

[role="button"]:focus-visible,
[role="tab"]:focus-visible,
[role="link"]:focus-visible,
button:focus-visible,
input:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid ${colors.focus} !important;
  outline-offset: 2px !important;
  border-radius: 4px;
}

/* Dense data table: keep the scrollbar from stealing row width. */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: ${colors.background}; }
::-webkit-scrollbar-thumb {
  background: ${colors.borderStrong};
  border-radius: 5px;
  border: 3px solid ${colors.background};
}
::-webkit-scrollbar-thumb:hover { background: ${colors.muted}; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;
  document.head.appendChild(style);
}
