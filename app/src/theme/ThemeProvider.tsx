import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { applyVariant } from './applyVariant';
import { restoreSavedVariant, type AppearanceChoice } from './variantPersistence';
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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<AppearanceChoice>(DEFAULT_VARIANT);
  // "Match device" follows the phone or computer's light or dark setting as
  // it changes (walk 4 T2-N4, walk 6 T1 NYI-4, T2-N6).
  const scheme = useColorScheme();
  const variantId: VariantId = choice === 'device' ? (scheme === 'light' ? 'light' : DEFAULT_VARIANT) : choice;

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
