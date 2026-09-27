import { DEFAULT_VARIANT, isVariantId, type VariantId } from './variants';

/** A theme, or "Match device": Light while the device is light, Default while it is dark. */
export type AppearanceChoice = VariantId | 'device';

export function isAppearanceChoice(value: unknown): value is AppearanceChoice {
  return value === 'device' || isVariantId(value);
}

/**
 * The look on screen for a choice. "Match device" follows the device's ask
 * for more contrast, then its light or dark setting (navy while dark). The
 * page's prepaint (public/index.html), the first frame and every render use
 * this one rule, so the look never changes as the app starts (walk 11 T4-09).
 */
export function resolveVariant(choice: AppearanceChoice, moreContrast: boolean, scheme: string | null | undefined): VariantId {
  if (choice !== 'device') return choice;
  return moreContrast ? 'contrast' : scheme === 'light' ? 'light' : DEFAULT_VARIANT;
}

export async function restoreSavedVariant(
  read: () => Promise<string | null>,
  apply: (choice: AppearanceChoice) => void,
  isCurrent: () => boolean,
): Promise<void> {
  try {
    const stored = await read();
    if (isCurrent() && isAppearanceChoice(stored)) apply(stored);
  } catch {
    // A device with unavailable storage can still choose an appearance.
  }
}
