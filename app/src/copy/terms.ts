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
  // "A player", not "he": the Rules and Settings open with it before any
  // player is named (walk 13 T1-03).
  'Each game a player plays, you pay his price and collect his dividend. Beat his price and you profit.';

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

/**
 * A run of days: "Oct 21–27", or "Oct 28–Nov 3" across a month; one day
 * reads as itself ("Oct 27"). The one spelling for several nights played at
 * once, in the status row and in the notice (walk 3 T1-20).
 */
export function humanDaySpan(firstDay: string, lastDay: string): string {
  if (firstDay >= lastDay) return humanDate(lastDay);
  const [firstMonth, firstDate] = humanDate(firstDay).split(/\s+/);
  const [lastMonth, lastDate] = humanDate(lastDay).split(/\s+/);
  return firstMonth === lastMonth
    ? `${firstMonth} ${firstDate}–${lastDate}`
    : `${humanDate(firstDay)}–${humanDate(lastDay)}`;
}

/**
 * The nights after `since` up to `through` ("Oct 21–27" for a week played at
 * once), so the result names its days instead of "Games through Oct 27".
 */
export function humanNightsSince(since: string | null, through: string): string {
  const end = asUtcDate(through);
  const start = since ? asUtcDate(since) : null;
  if (!end || !start) return humanDate(through);
  return humanDaySpan(new Date(start.getTime() + 86_400_000).toISOString().slice(0, 10), through);
}

/** A finished season in a phrase: "+$3.97M, #1 of 5". */
export function seasonResultLine(score: number, rank: string | null): string {
  const money = Math.round(score) === 0 ? '$0' : signedMoneyFine(score);
  return rank ? `${money}, ${rank}` : money;
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
 * Whole dollars `abs` in units of `unit`, to `places` decimals, a half always
 * rounding up: "$2,065,000" is "2.07" in millions, as "$2,075,000" is "2.08".
 * `toFixed` on the binary fraction rounded some halves down (2.065 is stored
 * as 2.06499…), so two amounts $10K apart could read one step apart or two
 * (walk 14 lead). Integer steps first, then the digits.
 */
function scaled(abs: number, unit: number, places: number): string {
  const perStep = unit / 10 ** places;
  const steps = Math.round(abs / perStep);
  const whole = Math.floor(steps / 10 ** places);
  if (places === 0) return String(whole);
  return `${whole}.${String(steps % 10 ** places).padStart(places, '0')}`;
}

/**
 * Money with enough digits that figures shown side by side still add up:
 * "$250", "$3.5K", "$1.25K", "$137.5K", "$4.85M". Use it where two amounts
 * are compared or summed on screen (a score breakdown, dividend against
 * price); use the compact `money` for a lone headline figure.
 *
 * Thousands read in K from $1,000, like the figures around them: "-$9,000"
 * under "-$84K" has more digits and read as the bigger loss (walk 5 T1-08).
 * Below $10K the K keeps two decimals, so fees ($250 a move: "$1.25K") and
 * small edges still add up by eye; full dollars stay for amounts under $1,000
 * and inside the math a Results row opens (`exactMoney`).
 */
export function moneyFine(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  if (abs < 1_000) return `${sign}$${abs}`;
  if (abs < 9_995) return `${sign}$${trimDecimals(scaled(abs, 1_000, 2))}K`;
  if (abs < 999_950) return `${sign}$${trimDecimals(scaled(abs, 1_000, 1))}K`;
  // Millions keep two decimals, so "+$1.60M" sits beside "+$1.61M" as one
  // precision, not "+$1.6M" that looks $10K away (walk 7 T4-14).
  return `${sign}$${scaled(abs, 1_000_000, 2)}M`;
}

/**
 * Money for a column or list of per-game figures, where every amount should
 * read in one style: thousands in K from $1,000 ("$6.5K" beside "$21.5K",
 * not "$6,500"), full dollars only under $1,000 ("$250"). Totals that must
 * add up on screen keep `moneyFine` (walk 3 T1-02, walk 2 T1-05/T4-18).
 */
export function moneyCompact(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  if (abs < 1_000) return `${sign}$${abs}`;
  if (abs < 999_950) return `${sign}$${trimDecimals(scaled(abs, 1_000, 1))}K`;
  // Millions keep two decimals, so "+$1.60M" sits beside "+$1.61M" as one
  // precision, not "+$1.6M" that looks $10K away (walk 7 T4-14).
  return `${sign}$${scaled(abs, 1_000_000, 2)}M`;
}

/** Signed `moneyCompact`: "+$6.5K", "-$950", and "$0" for zero. */
export function signedMoneyCompact(amount: number): string {
  const text = moneyCompact(amount);
  if (text === '$0') return text;
  return text.startsWith('-') ? text : `+${text}`;
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
  // "Moves", not "Roster": shorts pause too (walk 4 T1-07).
  return lockGameDate ? `Moves reopen after ${humanDate(lockGameDate)}` : 'Moves reopen after these games';
}

/** Label on a Drop or Close button while it waits for the second tap. */
export const CONFIRM_LABEL = 'Confirm';

/** Accessible name of the armed Drop or Close button. */
export function confirmCloseName(side: PerGamePositionSide, playerName: string, feeDollars = 0): string {
  // The name starts with the words on the button, so a voice-control user
  // can say what they see ("Drop for $250"; walk 8 T3-16), then says whom.
  return `${confirmCloseButton(side, feeDollars)}, ${side === 'long' ? playerName : `your short on ${playerName}`}`;
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

/**
 * What a LOCKED button says when pressed: when moves pause and when they come
 * back, in one sentence that names the games ("those games" pointed at
 * nothing; walk 7 T2-02).
 */
export function lockNotice(lockGameDate: string | null | undefined): string {
  return lockGameDate
    ? `Moves pause for the ${humanDate(lockGameDate)} games and reopen after them.`
    : 'Moves pause for these games and reopen after them.';
}

/**
 * The confirm strip's sentence before a Drop or Close: what it costs, what
 * stays in your score, and what changing your mind later would cost.
 * "Drop Nikola Jokic for a $250 fee? His +$1.24M stays in your score. Adding
 * him back later costs his price at that time, plus another $250 fee."
 * A short in its last games also says it ends by itself, for free.
 */
export function confirmCloseMessage({
  side,
  playerName,
  feeDollars,
  total,
  endsFreeAfter = null,
  priceNow = null,
  dropImpactBps = null,
  playing = null,
}: {
  side: PerGamePositionSide;
  playerName: string;
  feeDollars: number;
  /** What the position has made so far; it stays in the score. */
  total: number;
  /**
   * A short's last day: the question says that, left alone, it ends by itself
   * then at no cost, so closing early is a choice (walk 3 T1-N3).
   */
  endsFreeAfter?: string | null;
  /** His price a game in the market today: what re-opening would lock. */
  priceNow?: number | null;
  /**
   * The ruleset's `quoteDropImpactBps`: with it the question quotes his price
   * right after this move, as the Closed row shows it seconds later ("His
   * price right after this drop: about $261.4K a game."), never "today about
   * $262K" (walk 11 T1-05). Without it, today's price.
   */
  dropImpactBps?: number | null;
  /**
   * The games playing now ("Oct 21–27"), when the question is asked while
   * they play: the move waits for them, his games in them still count, and
   * moves paused right after them would stop it (walk 18 T4-03: a drop
   * confirmed during a week read as instant, then the lock after the week
   * refused it). His price after them is not known yet, so none is quoted.
   */
  playing?: string | null;
}): string {
  const fee = feeDollars > 0 ? exactMoney(feeDollars) : null;
  const forFee = fee ? ` for a ${fee} fee` : '';
  if (playing) {
    const after = `after the ${playing} games`;
    const another = fee ? `, plus another ${fee} fee` : '';
    const kept = Math.round(total) !== 0
      ? side === 'long' ? ` His ${signedMoneyFine(total)} so far stays in your score.` : ` This short's ${signedMoneyFine(total)} so far stays in your score.`
      : '';
    return side === 'long'
      ? `Drop ${playerName} ${after}${forFee}? His games in them still count, and if moves pause after them, he stays on your roster.${kept} Adding him back later costs his price at that time${another}.`
      : `Close your short on ${playerName} ${after}${forFee}?${endsFreeAfter ? ` Left alone, it ends by itself after ${humanDate(endsFreeAfter)}, at no cost.` : ''} Its games in them still count, and if moves pause after them, it stays open.${kept} Shorting him again later sets a new price${another}.`;
  }
  // Closing a short early is asked in two sentences, not five, on every
  // screen that quotes the price after the move (walk 13 T1-13): the choice
  // first, the free way in it, then one line for the rest. The first
  // sentence names the strip for screen readers, so it stays the question.
  if (side === 'short' && dropImpactBps !== null) {
    const choice = endsFreeAfter
      ? `Close your short on ${playerName} now${forFee}, or let it end by itself after ${humanDate(endsFreeAfter)} at no cost?`
      : `Close your short on ${playerName}${forFee}?`;
    const kept = Math.round(total) !== 0
      ? `Its ${signedMoneyFine(total)} stays in your score`
      : fee ? `Only its ${fee} fee is in your score so far` : 'Its games have not moved your score yet';
    const more = fee ? `, plus another ${fee} fee` : '';
    const again = priceNow !== null && priceNow > 0
      ? `shorting him again: about ${moneyCompact(priceAfterClose('short', priceNow, dropImpactBps))} a game${more}`
      : `shorting him again sets a new price${more}`;
    return `${choice} ${kept}; ${again}.`;
  }
  const ask = side === 'long' ? `Drop ${playerName}${forFee}?` : `Close your short on ${playerName}${forFee}?`;
  const sentences = [ask];
  if (Math.round(total) !== 0) {
    sentences.push(side === 'long'
      ? `His ${signedMoneyFine(total)} stays in your score.`
      : `This short's ${signedMoneyFine(total)} stays in your score.`);
  } else if (fee) {
    // His add fee is already in the score, so "has not changed your score"
    // read as "dropping puts me back to $0" (walk 6 T4-02).
    sentences.push(side === 'long'
      ? `His games have not changed your score yet; only his ${fee} add fee has.`
      : `This short's games have not changed your score yet; only its ${fee} fee has.`);
  } else {
    sentences.push(side === 'long' ? 'His games have not changed your score yet.' : "This short's games have not changed your score yet.");
  }
  if (side === 'short' && endsFreeAfter) {
    // The day, not "the Oct 27 games": his term can end on a day he does
    // not play (walk 4 T4-07).
    sentences.push(`Left alone, it ends by itself after ${humanDate(endsFreeAfter)}, at no cost.`);
  }
  const another = fee ? `, plus another ${fee} fee` : '';
  if (dropImpactBps !== null) {
    // The price the Closed row's Add again / Short again shows right after
    // this move, in its format. "About": nights move prices too.
    sentences.push(side === 'long'
      ? `Adding him back later costs his price at that time${another}.`
      : `Shorting him again later sets a new price${another}.`);
    if (priceNow !== null && priceNow > 0) {
      const when = dropImpactBps <= 0 ? 'today' : side === 'long' ? 'right after this drop' : 'right after this close';
      sentences.push(`His price ${when}: about ${moneyCompact(priceAfterClose(side, priceNow, dropImpactBps))} a game.`);
    }
    return sentences.join(' ');
  }
  // "About": today's quote can include your own position's pull on it.
  const today = priceNow !== null && priceNow > 0 ? ` (today about ${perGame(priceNow)})` : '';
  sentences.push(side === 'long'
    ? `Adding him back later costs his price at that time${today}${another}.`
    : `Shorting him again later sets a new price${today}${another}.`);
  return sentences.join(' ');
}

/**
 * His price a game right after you drop him (or close your short on him):
 * the move itself nudges his quote by the ruleset's drop impact, down for a
 * drop and up for a closed short, as the backend moves it (walk 11 T1-05).
 */
export function priceAfterClose(side: PerGamePositionSide, priceNow: number, dropImpactBps: number): number {
  const step = Math.round((priceNow * Math.max(0, dropImpactBps)) / 10_000);
  return side === 'long' ? Math.max(0, priceNow - step) : priceNow + step;
}

/** Why a roster lock exists, in one breath. */
export const LOCK_EXPLAINER =
  "On some nights roster moves pause while that night's games are played. Your players still play; moves reopen once those games are in.";

/** Text for screen readers: separators a speech engine reads aloud become pauses. */
export function spoken(text: string): string {
  return spokenRanks(text.replace(/\s·\s/g, ', ').replace(/\s+·/g, ','));
}

const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

/**
 * A place in words for screen readers, which read "#1" as "number sign 1"
 * or "hash 1": 1 → "first" (in words to tenth), then "11th", "22nd", "103rd".
 */
export function ordinalWords(rank: number): string {
  const n = Math.abs(Math.round(rank));
  if (n >= 1 && n <= ORDINAL_WORDS.length) return ORDINAL_WORDS[n - 1];
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/**
 * Text the eye reads with "#" places, said in words: "#1 of 5" → "first of
 * 5", "$12K behind #2" → "$12K behind second place". The places may be held
 * together by non-breaking spaces ("#2\u00a0of\u00a05"), which it reads too.
 */
export function spokenRanks(text: string): string {
  return text
    .replace(/#(\d+)[\s\u00a0]+of[\s\u00a0]+(\d+)/g, (_match, rank: string, of: string) => `${ordinalWords(Number(rank))} of ${of}`)
    .replace(/#(\d+)/g, (_match, rank: string) => `${ordinalWords(Number(rank))} place`);
}
