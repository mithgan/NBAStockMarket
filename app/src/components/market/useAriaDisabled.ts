import { useEffect, type RefObject } from 'react';

/**
 * Keep `aria-disabled` on a button that stays focusable while it cannot act
 * (LOCKED, FULL, "Added ✓"). react-native-web derives `aria-disabled` only
 * from a Pressable's own `disabled`, which would also drop it from the Tab
 * order, so the attribute is set on the DOM node here instead. Assistive tech
 * then hears "dimmed" and the reason in the name, and keyboard users can still
 * reach it. No-op off the web.
 */
export function useAriaDisabled(ref: RefObject<unknown>, disabled: boolean): void {
  useEffect(() => {
    const node = ref.current as { setAttribute?: (name: string, value: string) => void; removeAttribute?: (name: string) => void } | null;
    if (!node?.setAttribute || !node.removeAttribute) return;
    if (disabled) node.setAttribute('aria-disabled', 'true');
    else node.removeAttribute('aria-disabled');
  });
}
