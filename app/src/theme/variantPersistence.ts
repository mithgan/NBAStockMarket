import { isVariantId, type VariantId } from './variants';

/** A theme, or "Match device": Light while the device is light, Default while it is dark. */
export type AppearanceChoice = VariantId | 'device';

export function isAppearanceChoice(value: unknown): value is AppearanceChoice {
  return value === 'device' || isVariantId(value);
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
