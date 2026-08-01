import { Platform } from 'react-native';

import { colors } from '../theme';

const STYLE_ELEMENT_ID = 'nba-stock-market-global-styles';

/**
 * react-native-web renders every Pressable with `outline: none`, which leaves
 * keyboard users with no visible focus indicator at all (WCAG 2.4.7). Expo web
 * has no stylesheet of its own, so the rules are injected once at startup.
 *
 * The same sheet carries the global reduced-motion escape hatch.
 */
export function installGlobalWebStyles(): void {
  if (Platform.OS !== 'web') return;
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
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
