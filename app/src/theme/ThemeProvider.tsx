import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { applyVariant } from './applyVariant';
import { isAppearanceChoice, restoreSavedVariant, type AppearanceChoice } from './variantPersistence';
import { DEFAULT_VARIANT, VARIANTS, type DesignVariant, type VariantId } from './variants';

const STORAGE_KEY = 'nba-stock-market.design-variant';

type ThemeContextValue = {
  /** The theme on screen ("Match device" resolves to Light or Default). */
  variantId: VariantId;
  variant: DesignVariant;
  /** What the player chose in Settings, "device" included. */
  choice: AppearanceChoice;
  setVariant: (id: AppearanceChoice) => void;
  layout: DesignVariant['layout'];
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const MORE_CONTRAST = '(prefers-contrast: more)';

function moreContrastQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(MORE_CONTRAST) : null;
}

function prefersMoreContrast(): boolean {
  return moreContrastQuery()?.matches ?? false;
}

function subscribeMoreContrast(onChange: () => void): () => void {
  const query = moreContrastQuery();
  if (!query) return () => {};
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** The saved choice, read at once where storage allows it (the web), else "device". */
function savedChoiceNow(): AppearanceChoice {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 'device';
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isAppearanceChoice(stored) ? stored : 'device';
  } catch {
    return 'device';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // A new player starts on "Match device": the app follows the phone or
  // computer's light or dark setting as it changes, and its ask for more
  // contrast (walk 4 T2-N4, walk 6 T1 NYI-4, T2-N6; walk 7 T1-06, T2-16,
  // T3-N1). A saved choice still wins.
  // On the web the saved choice is read before the first render, so the
  // loading screen is already in the player's look: a saved Dark on a light
  // device flashed a cream "Starting practice" (walk 10 T2-08).
  const [choice, setChoice] = useState<AppearanceChoice>(savedChoiceNow);
  const scheme = useColorScheme();
  const moreContrast = useSyncExternalStore(subscribeMoreContrast, prefersMoreContrast, () => false);
  const variantId: VariantId = choice !== 'device'
    ? choice
    : moreContrast ? 'contrast' : scheme === 'light' ? 'light' : DEFAULT_VARIANT;

  const selectionRevision = useRef(0);

  // Restore the saved choice once; a stale read must not clobber a pick the
  // user made while storage was still resolving.
  useEffect(() => {
    let cancelled = false;
    const revision = selectionRevision.current;
    void restoreSavedVariant(
      () => AsyncStorage.getItem(STORAGE_KEY),
      setChoice,
      () => !cancelled && selectionRevision.current === revision,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    applyVariant(variantId);
  }, [variantId]);

  const setVariant = useCallback((id: AppearanceChoice) => {
    selectionRevision.current += 1;
    setChoice(id);
    AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});
  }, []);

  const value = useMemo(
    () => ({
      variantId,
      variant: VARIANTS[variantId],
      choice,
      setVariant,
      layout: VARIANTS[variantId].layout,
    }),
    [choice, setVariant, variantId],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useDesignVariant(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useDesignVariant must be used within ThemeProvider');
  return context;
}
