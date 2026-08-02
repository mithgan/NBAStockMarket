import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * True when the viewer asked the OS/browser to minimise motion. Hover and focus
 * transitions are suppressed so the interface stays completely still for them.
 */
function initialPreference(): boolean {
  // Web can answer synchronously, so the very first paint is already correct.
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  // Native only resolves asynchronously. Start in the still state so a viewer
  // with Reduce Motion on never catches an animated first frame; it flips back
  // as soon as the real preference arrives.
  return true;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(initialPreference);

  useEffect(() => {
    let active = true;

    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return undefined;
      }
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReduced(query.matches);
      const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
      // Safari < 14 and older WebViews expose matchMedia but only the legacy
      // addListener API; calling addEventListener there throws on mount.
      if (typeof query.addEventListener === 'function') {
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
      }
      if (typeof query.addListener === 'function') {
        query.addListener(onChange);
        return () => query.removeListener(onChange);
      }
      return undefined;
    }

    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
