/**
 * "See his games" (walk 8 T2-I4): the profile asks Results to show one
 * player's games. The request waits here until Results takes it, so it lands
 * whether Results is on screen already or opens next.
 */
export type PlayerGames = { playerId: string; playerName: string };

let pending: PlayerGames | null = null;
const listeners = new Set<(request: PlayerGames) => void>();

/** Ask Results to show only this player's games. */
export function showPlayerGames(request: PlayerGames): void {
  pending = request;
  listeners.forEach((listener) => listener(request));
}

/** The request waiting for Results, once: taking it clears it. */
export function takePlayerGames(): PlayerGames | null {
  const request = pending;
  pending = null;
  return request;
}

/** Results listens while it is on screen. */
export function onPlayerGames(listener: (request: PlayerGames) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
