import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { applyVariant } from './applyVariant';
import { DEFAULT_VARIANT, VARIANTS, isVariantId, type DesignVariant, type VariantId } from './variants';

const STORAGE_KEY = 'nba-stock-market.design-variant';

type ThemeContextValue = {
  variantId: VariantId;
  variant: DesignVariant;
  setVariant: (id: VariantId) => void;
  layout: DesignVariant['layout'];
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [variantId, setVariantId] = useState<VariantId>(DEFAULT_VARIANT);

  // Restore the saved choice once; a stale read must not clobber a pick the
  // user made while storage was still resolving.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && isVariantId(stored)) setVariantId(stored);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    applyVariant(variantId);
  }, [variantId]);

  const setVariant = useCallback((id: VariantId) => {
    setVariantId(id);
    AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});
  }, []);

  const value = useMemo(
    () => ({
      variantId,
      variant: VARIANTS[variantId],
      setVariant,
      layout: VARIANTS[variantId].layout,
    }),
    [setVariant, variantId],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useDesignVariant(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useDesignVariant must be used within ThemeProvider');
  return context;
}
