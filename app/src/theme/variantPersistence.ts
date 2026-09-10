import { isVariantId, type VariantId } from './variants';

export async function restoreSavedVariant(
  read: () => Promise<string | null>,
  apply: (variant: VariantId) => void,
  isCurrent: () => boolean,
): Promise<void> {
  try {
    const stored = await read();
    if (isCurrent() && isVariantId(stored)) apply(stored);
  } catch {
    // A device with unavailable storage can still choose an appearance.
  }
}
