import type { PerGamePositionSide, PerGameRuleset } from '../api/contracts';
import { LOCK_EXPLAINER, ROSTER_EXPLAINER, SHORT_EXPLAINER } from '../copy/terms';
import { formatMoney } from '../format';

/** What net points are, in box-score terms a fan already knows. */
export const NET_POINTS_EXPLAINER =
  'Net points boil his box score down to one number: points, rebounds, assists, steals and blocks add to it; turnovers, missed shots and minutes played take away, so a player has to produce for the minutes he gets.';

/** What you are playing for, before how it works (walk 3 T1-04). */
export const GOAL_EXPLAINER =
  'Finish the season with the highest score on the Leaders board. Your score comes from the NBA players you add to your roster.';

/** Where a dividend comes from, for each dividend basis. */
const DIVIDEND_RAW = "A player's dividend comes from his net points each game.";
const DIVIDEND_PROJECTION = "A player's dividend comes from how far his net points beat his pregame projection.";

/**
 * One night worked through with the real rate, so "$40,000 per net point"
 * connects to prices like "$117K a game": 3.5 net points pay $140,000; at a
 * $118,000 price that game made $22,000.
 */
function workedExample(rate: number, raw: boolean): string {
  const dividend = Math.round(3.5 * rate);
  const price = Math.round((dividend * 0.84) / 1000) * 1000;
  const points = raw ? '3.5 net points' : '3.5 net points above his projection';
  return `For example, a game of ${points} pays a ${formatMoney(dividend)} dividend; at a ${formatMoney(price)} price, you made ${formatMoney(dividend - price)}.`;
}

/** Why prices move, and why yours does not. */
/** What to expect from picking well (walk 3 T1-12: a good plan can trail for weeks). */
export const LUCK_EXPLAINER =
  'Single games are noisy: one week is mostly luck, while good picks show over a month or more.';

export const PRICE_EXPLAINER =
  "A player's price moves as people add and drop him and as he plays. The price you add him at is locked for as long as you hold him.";

/** Why a dividend can be below zero, and who pays it. */
export const NEGATIVE_DIVIDEND_EXPLAINER =
  'A bad game can make his dividend negative: then a roster spot pays it and a short collects it.';

export function perGameRulesPresentation(rules: PerGameRuleset) {
  const raw = rules.dividendBasis === 'raw_net_points';
  return {
    facts: [
      { label: 'Starting score', value: '$0' },
      { label: 'Dividend basis', value: raw ? 'His net points each game' : 'His net points above projection' },
      { label: 'Dividend rate', value: `${formatMoney(rules.dividendDollarsPerNetPoint)} for each net point` },
      { label: 'Roster slots', value: String(rules.longSlotLimit) },
      { label: 'Short slots', value: String(rules.shortSlotLimit) },
      { label: 'Open fee', value: formatMoney(rules.transactionFeeDollars) },
      { label: 'Drop fee', value: formatMoney(rules.transactionFeeDollars) },
      { label: 'Shorts last', value: rules.shortTermDays === null ? 'Until you close them' : `${rules.shortTermDays} days` },
    ],
    // The loop first (what you do and how you profit), one worked night,
    // then where dividends come from, then the rest.
    explanation: `${GOAL_EXPLAINER} ${ROSTER_EXPLAINER} ${workedExample(rules.dividendDollarsPerNetPoint, raw)} ${raw ? DIVIDEND_RAW : DIVIDEND_PROJECTION} ${NET_POINTS_EXPLAINER} ${SHORT_EXPLAINER} Your score adds up those games, minus a ${formatMoney(rules.transactionFeeDollars)} fee each time you add or drop a player, or open or close a short. ${NEGATIVE_DIVIDEND_EXPLAINER} ${LUCK_EXPLAINER} ${PRICE_EXPLAINER} ${LOCK_EXPLAINER}`,
    /** Plain definitions of the words the screens use. */
    glossary: [
      { term: 'Price', meaning: 'What one game of a player costs. The price you add him at stays locked while you hold him.' },
      { term: 'Dividend', meaning: 'What he pays out for one game: his net points times the dividend rate. It can be below zero.' },
      { term: 'Profit', meaning: 'Dividend minus price for a roster spot; price minus dividend for a short.' },
      {
        term: 'Short',
        meaning: rules.shortTermDays === null
          ? 'A bet that he comes in under his price. It lasts until you close it.'
          : `A bet that he comes in under his price. It lasts ${rules.shortTermDays} ${rules.shortTermDays === 1 ? 'day' : 'days'}, then ends by itself.`,
      },
      { term: 'Tier', meaning: 'Star, starter or role: how good the market thinks he is. Pricier tiers are not always better value.' },
      { term: 'Dividend last season', meaning: 'What he paid out a game last season: the market\'s best guide to what he is worth.' },
      {
        term: 'Value',
        meaning: "Last season's dividend against his price today. On the Roster side it is dividend minus price; on the Short side, price minus dividend. A plus figure is good for the side you are on.",
      },
      { term: 'Net points', meaning: 'His box score in one number. Scoring and hustle add; turnovers, misses and minutes take away.' },
      { term: 'Roster lock', meaning: "Some nights, moves pause while that night's games are played." },
    ],
  };
}

export function positionSlotHint(side: PerGamePositionSide, limit: number) {
  return side === 'long'
    ? `Add players to your ${limit}-player roster`
    : `Short up to ${limit} players`;
}

/**
 * The explanation in short paragraphs, each starting at one of these
 * sentences and running to the next, without changing a word: the loop and
 * its example; where dividends come from; shorts and fees; bad games;
 * prices; locks. The Rules sheet and Settings both read it this way.
 */
export function rulesParagraphs(explanation: string): string[] {
  const markers = [DIVIDEND_RAW, DIVIDEND_PROJECTION, SHORT_EXPLAINER, NEGATIVE_DIVIDEND_EXPLAINER, PRICE_EXPLAINER, LOCK_EXPLAINER];
  const cuts = markers
    .map((marker) => explanation.indexOf(marker))
    .filter((at) => at > 0)
    .sort((left, right) => left - right);
  const paragraphs: string[] = [];
  let start = 0;
  for (const at of cuts) {
    paragraphs.push(explanation.slice(start, at));
    start = at;
  }
  paragraphs.push(explanation.slice(start));
  return paragraphs.map((part) => part.trim()).filter(Boolean);
}
