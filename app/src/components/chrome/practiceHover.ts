import { useEffect } from 'react';

import { colors } from '../../theme';

/**
 * +1 night and +1 week answer the pointer as the frame's other buttons do
 * (walk 9 T2-09): the kit's hover tint sits under their own gold fill, so it
 * never showed. One rule, written once, for the two buttons it marks. The
 * gold deepens a step under the pointer (the pale surface tint made the one
 * ready button look switched off as you aimed at it: walk 11 T2-05); the
 * label keeps 4.5:1 or more on it in every look.
 */
const STYLE_ID = 'practice-hover';
const MARK = 'data-practice-advance';

function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `@media (hover: hover) { [${MARK}]:hover:not([aria-disabled="true"]) { background-color: color-mix(in srgb, ${colors.goldSoft} 86%, ${colors.goldInk}); } }`;
  document.head.appendChild(style);
}

export function usePracticeHover(...refs: Array<{ current: unknown }>): void {
  useEffect(() => {
    ensureStyle();
    refs.forEach((ref) => (ref.current as { setAttribute?: (name: string, value: string) => void } | null)?.setAttribute?.(MARK, ''));
  });
}
