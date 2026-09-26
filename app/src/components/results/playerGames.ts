/**
 * "See his games" (walk 8 T2-I4): the profile asks Results to show one
 * player's games. The request waits here until Results takes it, so it lands
 * whether Results is on screen already or opens next.
 */
import type { PerGamePositionSide } from '../../api/contracts';
import type { ProfileMetric, ProfileRange } from '../../data/profileView';

/**
 * The profile as it was when "See his games" was pressed (walk 9 T1-17), so
 * "Back to <player>" reopens him in the same view: the chart's metric, the
 * range picked (null: his default) and the side read from.
 */
export type ProfileView = { metric: ProfileMetric; range: ProfileRange | null; side: PerGamePositionSide | null };

export type PlayerGames = { playerId: string; playerName: string; from?: ProfileView };

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

/**
 * Set while Results shows one player's games asked for from his profile:
 * reopens that profile in the view it was in. For the frame's Back (walk 9
 * T1-17): Back from his games should return to his profile.
 */
let reopen: (() => boolean) | null = null;

export function setProfileReopen(next: (() => boolean) | null): void {
  reopen = next;
}

/** Reopen the profile "See his games" came from; false when Results has none to return to. */
export function reopenGamesProfile(): boolean {
  return reopen ? reopen() : false;
}
