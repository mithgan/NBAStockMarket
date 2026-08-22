import {
  GAME_STORAGE_KEY,
  LOCAL_DEMO_STORAGE_KEY,
  type StorageAdapter,
} from './persistence';

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
    const legacySave = await storage.getItem(GAME_STORAGE_KEY);
    const localDemoSave = await storage.getItem(LOCAL_DEMO_STORAGE_KEY);
    const legacySavePresent = legacySave !== null || localDemoSave !== null;
    return {
      legacySavePresent,
      transitionComplete: marker !== null && !legacySavePresent,
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
    await storage.removeItem(LOCAL_DEMO_STORAGE_KEY);
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
