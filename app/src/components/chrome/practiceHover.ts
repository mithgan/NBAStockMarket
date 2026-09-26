import { useEffect } from 'react';

import { colors } from '../../theme';

/**
 * +1 night and +1 week answer the pointer as the frame's other buttons do
 * (walk 9 T2-09): the kit's hover tint sits under their own gold fill, so it
 * never showed. One rule, written once, for the two buttons it marks.
 */
const STYLE_ID = 'practice-hover';
const MARK = 'data-practice-advance';

function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `@media (hover: hover) { [${MARK}]:hover:not([aria-disabled="true"]) { background-color: ${colors.surfaceHigh}; } }`;
  document.head.appendChild(style);
}

export function usePracticeHover(...refs: Array<{ current: unknown }>): void {
  useEffect(() => {
    ensureStyle();
    refs.forEach((ref) => (ref.current as { setAttribute?: (name: string, value: string) => void } | null)?.setAttribute?.(MARK, ''));
  });
}
