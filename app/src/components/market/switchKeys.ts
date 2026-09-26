/**
 * Space toggles a switch (the WAI-ARIA switch pattern, and what screen-reader
 * users are told to press), as Enter already does through the Pressable.
 * react-native-web answers Space only on button roles, so without this the
 * page scrolls a screen instead and the switch stays as it was (walk 2:
 * T3-17). Holding Space toggles once. Spread onto a Pressable; no-op off the
 * web, where there is no keyboard event.
 */
export function spaceToggles(toggle: () => void): object {
  return {
    onKeyDown: (event: { key?: string; repeat?: boolean; preventDefault?: () => void }) => {
      if (event.key !== ' ' && event.key !== 'Spacebar') return;
      event.preventDefault?.();
      if (!event.repeat) toggle();
    },
  };
}
