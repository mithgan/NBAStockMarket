/**
 * The app's vocabulary, in one place.
 *
 * Every screen says the same thing the same way by importing from here rather
 * than spelling it inline. The rule for every string: say what happens to the
 * player's money, in words a basketball fan uses. "Short", never "inverse".
 * "$105K a game", never "/GM". "Nov 6", never "2025-11-06".
 *
 * These are pure functions and constants so they can be unit tested and used
 * from state code as well as from components.
 */
import type { PerGamePositionSide } from '../api/contracts';
import { formatMoney, formatSignedMoney } from '../format';

/** How a short works, in one breath. Used wherever a short is explained. */
export const SHORT_EXPLAINER =
  "A short pays you when his dividend comes in under his price. Each game you're credited his price, then pay out his dividend.";

/** How a roster spot works, in one breath. */
export const ROSTER_EXPLAINER =
  'Each game he plays, you pay his price and collect his dividend. Beat his price and you profit.';

/** Name of practice mode everywhere it is labelled. */
export const PRACTICE_LABEL = 'Practice';

/** Section / tab name for each side. */
export function sideLabel(side: PerGamePositionSide): 'Roster' | 'Short' {
  return side === 'long' ? 'Roster' : 'Short';
}

/** Plural section heading for each side's open positions. */
export function sideHeading(side: PerGamePositionSide): 'Your roster' | 'Your shorts' {
  return side === 'long' ? 'Your roster' : 'Your shorts';
}

/** Verb on the button that opens a position on this side. */
export function openVerb(side: PerGamePositionSide): 'Add' | 'Short' {
  return side === 'long' ? 'Add' : 'Short';
}

/** Verb on the button that closes an open position on this side. */
export function closeVerb(side: PerGamePositionSide): 'Drop' | 'Close' {
  return side === 'long' ? 'Drop' : 'Close';
}

function isoDay(value: string): string {
  return value.includes('T') ? value.slice(0, 10) : value;
}

function asUtcDate(value: string): Date | null {
  const date = new Date(`${isoDay(value)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Nov 6". Accepts "2025-11-06" or a full ISO timestamp; game dates are UTC days. */
export function humanDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = asUtcDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

/** "Wed, Nov 6". */
export function humanDay(value: string | null | undefined): string {
  if (!value) return '';
  const date = asUtcDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** "Nov 6, 2025". For the few places a year is genuinely needed. */
export function humanDateWithYear(value: string | null | undefined): string {
  if (!value) return '';
  const date = asUtcDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * Money, the one way the app writes it: "$3,500", "$237.5K", "$1.06M". Every
 * screen, notice and screen-reader label uses this (or `signedMoney`), so the
 * same amount never reads two ways. See `moneyFine` for the rule.
 */
export function money(amount: number): string {
  return moneyFine(amount);
}

/** Signed money: "+$237.5K", "-$1.06M", and plain "$0" for zero. */
export function signedMoney(amount: number): string {
  return signedMoneyFine(amount);
}

/** Exact money for screen readers and equations: "$237,500". */
export function exactMoney(amount: number): string {
  return formatMoney(amount);
}

/** Exact signed money: "+$237,500". Zero is plain "$0". */
export function exactSignedMoney(amount: number): string {
  if (Math.round(amount) === 0) return '$0';
  return formatSignedMoney(amount);
}

function trimDecimals(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

/**
 * Money with enough digits that figures shown side by side still add up:
 * "$3,500", "$137.5K", "$4.85M". Use it where two amounts are compared or
 * summed on screen (a score breakdown, dividend against price); use the
 * compact `money` for a lone headline figure.
 */
export function moneyFine(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  if (abs < 10_000) return `${sign}$${abs.toLocaleString('en-US')}`;
  if (abs < 999_950) return `${sign}$${trimDecimals((abs / 1_000).toFixed(1))}K`;
  return `${sign}$${trimDecimals((abs / 1_000_000).toFixed(2))}M`;
}

/** Signed `moneyFine`: "+$137.5K", "-$4.85M", and "$0" for zero. */
export function signedMoneyFine(amount: number): string {
  const text = moneyFine(amount);
  if (text === '$0') return text;
  return text.startsWith('-') ? text : `+${text}`;
}

/**
 * A player name that never breaks at its hyphen ("Gilgeous-Alexander" stays
 * whole when a row wraps). Swaps the hyphen for a non-breaking hyphen.
 */
export function unbrokenName(name: string): string {
  return name.replace(/-/g, '\u2011');
}

/** "$104.6K a game" — the price of a player, in words. */
export function perGame(amount: number): string {
  return `${moneyFine(amount)} a game`;
}

/** "$104.6K/game" — the same price where space is tight. */
export function perGameShort(amount: number): string {
  return `${moneyFine(amount)}/game`;
}

/** "1 game", "12 games". */
export function gamesCount(count: number): string {
  return `${count} ${count === 1 ? 'game' : 'games'}`;
}

/** "1 night", "7 nights". */
export function nightsCount(count: number): string {
  return `${count} ${count === 1 ? 'night' : 'nights'}`;
}

/**
 * When roster changes reopen. One sentence everywhere a lock shows: the
 * server keeps roster changes locked while that date's games are played and
 * settled, then unlocks, so the promise is "after" that date.
 */
export function rosterReopensLine(lockGameDate: string | null | undefined): string {
  return lockGameDate ? `Roster reopens after ${humanDate(lockGameDate)}` : 'Roster reopens after these games';
}

/** Label on a Drop or Close button while it waits for the second tap. */
export const CONFIRM_LABEL = 'Confirm';

/** Accessible name of the armed Drop or Close button. */
export function confirmCloseName(side: PerGamePositionSide, playerName: string): string {
  return side === 'long' ? `Confirm dropping ${playerName}` : `Confirm closing your short on ${playerName}`;
}

/**
 * The line under an armed Drop or Close: what it costs and what stays. The
 * total is what the position made while you held it, which stays in the
 * score after it closes.
 */
export function confirmCloseLine(side: PerGamePositionSide, feeDollars: number, total: number): string {
  const stays = side === 'long' ? `his ${signedMoneyFine(total)}` : `this short's ${signedMoneyFine(total)}`;
  const fee = feeDollars > 0 ? `${exactMoney(feeDollars)} fee · ` : '';
  return `${fee}${stays} stays in your score`;
}

/** Accessible name of a row's Drop or Close button, the same on every screen. */
export function closeActionName(side: PerGamePositionSide, playerName: string): string {
  return side === 'long' ? `Drop ${playerName}` : `Close your short on ${playerName}`;
}

/** Label on the destructive button of a Drop or Close confirm: "Drop for $250". */
export function confirmCloseButton(side: PerGamePositionSide, feeDollars: number): string {
  const verb = side === 'long' ? 'Drop' : 'Close';
  return feeDollars > 0 ? `${verb} for ${exactMoney(feeDollars)}` : verb;
}

/** Why a roster lock exists, in one breath. */
export const LOCK_EXPLAINER =
  "On some nights roster moves pause while that night's games are played. Your players still play; moves reopen once those games are in.";

/** Text for screen readers: separators a speech engine reads aloud become pauses. */
export function spoken(text: string): string {
  return text.replace(/\s·\s/g, ', ').replace(/\s+·/g, ',');
}
