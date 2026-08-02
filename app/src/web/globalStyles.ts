import { Platform } from 'react-native';

import { colors } from '../theme';

const STYLE_ELEMENT_ID = 'nba-stock-market-global-styles';
const FONT_LINK_ID = 'nba-stock-market-font';

/** databallr.com's display face. Falls back to the system stack if it fails. */
const DM_SANS = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800;900&display=swap';

/**
 * react-native-web renders every Pressable with `outline: none`, which leaves
 * keyboard users with no visible focus indicator at all (WCAG 2.4.7). Expo web
 * has no stylesheet of its own, so the rules are injected once at startup.
 *
 * The same sheet loads the brand font, paints the page background so overscroll
 * matches the app, and carries the global reduced-motion escape hatch.
 */
export function installGlobalWebStyles(): void {
  if (Platform.OS !== 'web') return;
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
  style.textContent = `
html, body, #root {
  background-color: ${colors.background};
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
