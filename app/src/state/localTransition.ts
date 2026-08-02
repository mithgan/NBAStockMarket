import { GAME_STORAGE_KEY, type StorageAdapter } from './persistence';

const TRANSITION_MARKER_PREFIX = '@nba-stock-market/server-transition/v1:';

export interface LocalTransitionInspection {
  legacySavePresent: boolean;
  transitionComplete: boolean;
  error: string | null;
}

export interface LocalTransitionResult {
  complete: boolean;
  error: string | null;
}

export function transitionMarkerKey(userId: string): string {
  return `${TRANSITION_MARKER_PREFIX}${encodeURIComponent(userId)}`;
}

export function shouldInspectLocalTransition(
  inspectionComplete: boolean,
  transitionRequired: boolean,
): boolean {
  return !inspectionComplete || transitionRequired;
}

export async function inspectLocalTransition(
  storage: StorageAdapter,
  userId: string,
): Promise<LocalTransitionInspection> {
  try {
    const marker = await storage.getItem(transitionMarkerKey(userId));
    if (marker !== null) {
      return { legacySavePresent: false, transitionComplete: true, error: null };
    }
    const legacySave = await storage.getItem(GAME_STORAGE_KEY);
    return {
      legacySavePresent: legacySave !== null,
      transitionComplete: false,
      error: null,
    };
  } catch {
    return {
      legacySavePresent: false,
      transitionComplete: false,
      error: 'Saved prototype progress could not be checked on this device. Try again.',
    };
  }
}

export async function finalizeLocalTransition(
  storage: StorageAdapter,
  userId: string,
): Promise<LocalTransitionResult> {
  try {
    await storage.removeItem(GAME_STORAGE_KEY);
  } catch {
    return {
      complete: false,
      error: 'Prototype progress could not be cleared. Nothing was imported; try again.',
    };
  }

  try {
    await storage.setItem(transitionMarkerKey(userId), 'complete');
    return { complete: true, error: null };
  } catch {
    return {
      complete: false,
      error: 'Prototype progress was cleared, but this device could not finish setup. Try again.',
    };
  }
}
