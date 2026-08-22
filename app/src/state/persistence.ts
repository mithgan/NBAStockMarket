export const GAME_STORAGE_KEY = '@nba-stock-market/game-state';
export const LOCAL_DEMO_STORAGE_KEY = 'nba-stock-market:local-demo:v1';
export const GAME_STORAGE_VERSION = 1;

export interface StorageAdapter {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

interface PersistedEnvelope<T> {
  version: number;
  state: T;
}

export interface PersistenceResult {
  error: string | null;
}

export interface PersistenceLoadResult<T> extends PersistenceResult {
  state: T | null;
  canAutosave: boolean;
}

export function persistenceErrorAfterSave(
  currentError: string | null,
  result: PersistenceResult,
): string | null {
  return result.error ?? currentError;
}

export async function loadPersistedGame<T>(
  storage: StorageAdapter,
  isValidState: (value: unknown) => value is T,
): Promise<PersistenceLoadResult<T>> {
  let serialized: string | null;
  try {
    serialized = await storage.getItem(GAME_STORAGE_KEY);
  } catch {
    return {
      state: null,
      error: 'Progress could not be loaded. Saved data was left untouched. Reset progress to start over.',
      canAutosave: false,
    };
  }

  if (serialized === null) {
    return { state: null, error: null, canAutosave: true };
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(serialized);
  } catch {
    return {
      state: null,
      error: 'Saved progress was invalid, so a new game was started.',
      canAutosave: true,
    };
  }

  if (!envelope || typeof envelope !== 'object') {
    return {
      state: null,
      error: 'Saved progress was invalid, so a new game was started.',
      canAutosave: true,
    };
  }

  const candidate = envelope as Partial<PersistedEnvelope<unknown>>;
  if (candidate.version !== GAME_STORAGE_VERSION) {
    return {
      state: null,
      error: 'Saved progress was from an unsupported version, so a new game was started.',
      canAutosave: true,
    };
  }

  if (!isValidState(candidate.state)) {
    return {
      state: null,
      error: 'Saved progress was invalid, so a new game was started.',
      canAutosave: true,
    };
  }

  return { state: candidate.state, error: null, canAutosave: true };
}

export async function savePersistedGame<T>(
  storage: StorageAdapter,
  state: T,
): Promise<PersistenceResult> {
  try {
    await storage.setItem(GAME_STORAGE_KEY, JSON.stringify({
      version: GAME_STORAGE_VERSION,
      state,
    } satisfies PersistedEnvelope<T>));
    return { error: null };
  } catch {
    return { error: 'Progress could not be saved. Open Portfolio and reset progress to continue.' };
  }
}

export async function clearPersistedGame(
  storage: StorageAdapter,
): Promise<PersistenceResult> {
  try {
    await storage.removeItem(GAME_STORAGE_KEY);
    return { error: null };
  } catch {
    return { error: 'Saved progress could not be cleared on this device.' };
  }
}

export async function resetPersistedGame<T>(
  storage: StorageAdapter,
  state: T,
): Promise<PersistenceResult> {
  return savePersistedGame(storage, state);
}

export function enqueuePersistedReset<T>(
  pendingSaves: Promise<void>,
  storage: StorageAdapter,
  state: T,
): Promise<PersistenceResult> {
  return pendingSaves.then(() => resetPersistedGame(storage, state));
}
