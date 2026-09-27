/**
 * "See his games" (walk 8 T2-I4): the profile asks Results to show one
 * player's games. The request waits here until Results takes it, so it lands
 * whether Results is on screen already or opens next.
 */
import type { PerGamePositionSide } from '../../api/contracts';
import type { ProfileMetric, ProfileRange } from '../../data/profileView';
import type { AppTab } from '../../state/uiActions';

/**
 * The profile as it was when "See his games" was pressed (walk 9 T1-17), so
 * "Back to <player>" reopens him in the same view: the chart's metric, the
 * range picked (null: his default) and the side read from.
 */
export type ProfileView = { metric: ProfileMetric; range: ProfileRange | null; side: PerGamePositionSide | null };

/**
 * `fromTab`: the screen his profile was open over when "See his games" was
 * pressed, so the browser's Back undoes the trip there (walk 16 T2-05).
 */
export type PlayerGames = { playerId: string; playerName: string; from?: ProfileView; fromTab?: AppTab };

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

/**
 * Back from his games to the screen his profile was open over (walk 16
 * T2-05: Back reopened him over Results, then left Results for the Roster, so
 * the Market the trip started on was never reached). Results switches to that
 * screen, and the first profile sheet drawn there opens him again, in the view
 * he was in, once the screen's history step has landed; the next Back closes
 * him there. A request left untaken expires, so it never opens a profile later.
 */
export type ProfileReturn = { playerId: string; view: ProfileView; tab: AppTab; at: number };

const RETURN_EXPIRES_MS = 2500;
let profileReturn: ProfileReturn | null = null;

export function returnToProfile(request: Omit<ProfileReturn, 'at'>): void {
  profileReturn = { ...request, at: Date.now() };
}

/** The return waiting for a sheet, if still fresh (not taken). */
export function peekProfileReturn(now = Date.now()): ProfileReturn | null {
  if (profileReturn && now - profileReturn.at > RETURN_EXPIRES_MS) profileReturn = null;
  return profileReturn;
}

/** Take this return (once): false when another sheet took it or it expired. */
export function takeProfileReturn(request: ProfileReturn, now = Date.now()): boolean {
  if (peekProfileReturn(now) !== request) return false;
  profileReturn = null;
  return true;
}

/** The screen under the sheet the press came from (its history entry names the tab). */
export function tabUnderSheet(): AppTab | undefined {
  if (typeof window === 'undefined') return undefined;
  const tab = (window.history?.state as { tab?: unknown } | null)?.tab;
  return tab === 'portfolio' || tab === 'market' || tab === 'plays' || tab === 'leaderboard' ? tab : undefined;
}
