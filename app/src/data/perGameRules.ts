import type { PerGamePositionSide, PerGameRuleset } from '../api/contracts';
import { LOCK_EXPLAINER, moneyFine, ROSTER_EXPLAINER, SHORT_EXPLAINER, signedMoneyFine } from '../copy/terms';
import { formatMoney } from '../format';

/** What net points are, in box-score terms a fan already knows. */
export const NET_POINTS_EXPLAINER =
  'Net points boil his box score down to one number: points, rebounds, assists, steals and blocks add to it; turnovers, missed shots and minutes played take away, so a player has to produce for the minutes he gets.';

/** What you are playing for, before how it works (walk 3 T1-04). */
export const GOAL_EXPLAINER =
  'Finish the season with the highest score on the Leaders board. Your score comes from the NBA players you add to your roster.';

/**
 * Scoring in three short lines a fan can skim (walk 6 T1-03): pay his price
 * and collect his dividend; what the dividend is, with the real rate; beat the
 * price and you profit. The first and last are the loop the Market and
 * Results say (ROSTER_EXPLAINER), split around the rate.
 */
const PAY_LINE = ROSTER_EXPLAINER.slice(0, ROSTER_EXPLAINER.indexOf('. ') + 1);
const PROFIT_LINE = ROSTER_EXPLAINER.slice(ROSTER_EXPLAINER.indexOf('. ') + 2);

/** What a dividend is, for each dividend basis, at the real rate in K ("× $40K"). */
function dividendLine(rate: number, raw: boolean): string {
  const each = moneyFine(rate);
  return raw
    ? `His dividend is his net points each game × ${each}.`
    : `His dividend is how far his net points beat his pregame projection, × ${each}.`;
}

/** The worked game's label, set apart in the Rules sheet. */
export const EXAMPLE_LEAD = 'Example: ';

/**
 * One game worked through with the real rate, in K like the rest of the app
 * (walk 6 T1-03: exact dollars read in another style), so "$40K per net
 * point" connects to prices like "$117K a game": "Example: 3.5 net points =
 * $140K dividend; price $118K; profit +$22K."
 */
function workedExample(rate: number, raw: boolean): string {
  const dividend = Math.round(3.5 * rate);
  // The profit in whole thousands and the price the rest, so the three
  // figures add up as shown at any rate ($140K, $118K, +$22K at $40K).
  const profit = Math.round((dividend * 0.16) / 1000) * 1000;
  const price = dividend - profit;
  const points = raw ? '3.5 net points' : '3.5 net points above his projection';
  return `${EXAMPLE_LEAD}${points} = ${moneyFine(dividend)} dividend; price ${moneyFine(price)}; profit ${signedMoneyFine(dividend - price)}.`;
}

/** Why prices move, and why yours does not. */
/** What to expect from picking well (walk 3 T1-12: a good plan can trail for weeks). */
export const LUCK_EXPLAINER =
  'Single games are noisy: one week is mostly luck, while good picks show over a month or more.';

// One game rarely decides a price: a player's price fell after a +$194.5K
// night and read as the rules being wrong (walk 11 T2-01).
export const PRICE_EXPLAINER =
  "A player's price moves as people add and drop him and as his games add up: one game rarely decides it, so a price can dip after a great night. The price you add him at is locked for as long as you hold him.";

/**
 * Scoring's word on a bad game, beside what the dividend is: a roster-only
 * player met "Dividend a game -$56K" with nothing under Scoring to say a
 * dividend can go below zero (only Shorts did; walk 8 T1-01).
 */
export const BAD_GAME_LINE = 'A bad game can push his dividend below zero, and you pay that too.';

/** Why a dividend can be below zero, and who pays it. */
export const NEGATIVE_DIVIDEND_EXPLAINER =
  'A bad game can make his dividend negative: then a roster spot pays it and a short collects it.';

/** Practice's own opponents and calendar, for the rules' opening lines. */
export interface PracticeRulesContext {
  /** Computer rivals on the Leaders board. */
  rivals: number;
  /** "Oct 21", the first night of games. */
  opens: string;
  /** "Apr 12", the last day. */
  ends: string;
  /** 174. */
  days: number;
}

/**
 * Who you play and for how long, right after the goal, so a new player knows
 * what "the highest score" is measured against (walk 4 T2-17, T4-15).
 */
export function practiceGoalText(practice: PracticeRulesContext): string {
  const rivals = practice.rivals === 1 ? 'one computer rival' : `${practice.rivals} computer rivals`;
  return `In practice you play ${rivals} over one season, ${practice.opens} to ${practice.ends} (${practice.days} days).`;
}

export function perGameRulesPresentation(rules: PerGameRuleset, practice: PracticeRulesContext | null = null) {
  const raw = rules.dividendBasis === 'raw_net_points';
  // The rivals and dates follow the goal's first sentence: what the highest
  // score is measured against, before where a score comes from.
  const goalEnd = GOAL_EXPLAINER.indexOf('. ') + 1;
  const goal = practice
    ? `${GOAL_EXPLAINER.slice(0, goalEnd)} ${practiceGoalText(practice)}${GOAL_EXPLAINER.slice(goalEnd)}`
    : GOAL_EXPLAINER;
  // The Rules sheet draws Scoring from these parts: the three lines, what
  // net points are, the example set apart, then the luck line. The
  // explanation below holds the same words in the same order.
  const scoring: ScoringParts = {
    lines: [PAY_LINE, dividendLine(rules.dividendDollarsPerNetPoint, raw), BAD_GAME_LINE, PROFIT_LINE],
    netPoints: NET_POINTS_EXPLAINER,
    example: workedExample(rules.dividendDollarsPerNetPoint, raw),
    luck: LUCK_EXPLAINER,
  };
  return {
    scoring,
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
    // In steps (walk 5 T1-09, T3-13): the goal; how a game scores (the loop,
    // where dividends come from, net points, then one worked night, which
    // used "net points" before they were explained); shorts and bad games;
    // fees; prices; locks. rulesSections cuts it there and names each part.
    explanation: `${goal} ${scoring.lines.join(' ')} ${scoring.netPoints} ${scoring.example} ${scoring.luck} ${SHORT_EXPLAINER} ${NEGATIVE_DIVIDEND_EXPLAINER} ${FEES_LEAD}, minus a ${formatMoney(rules.transactionFeeDollars)} fee each time you add or drop a player, or open or close a short. ${PRICE_EXPLAINER} ${LOCK_EXPLAINER}`,
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
      // A guide, not a promise: over a season players paid out well under
      // last season, which the old "best guide to what he is worth" hid
      // (walk 6 T2-16).
      {
        term: 'Dividend last season',
        meaning: 'What he paid out a game last season: a guide, not a promise. Players usually pay out less than last season, and prices already expect part of that.',
      },
      // One definition with the held rows, which use your locked price (walk 6 T1-13).
      {
        term: 'Value',
        meaning: "Last season's dividend against his price today. On the Roster side it is dividend minus price; on the Short side, price minus dividend. A plus figure is good for the side you are on. For a player you hold, it is measured against the price you locked.",
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
 * Where the fees sentence starts. Under its own heading it cannot lean on the
 * section before it ("adds up those games" had nothing to point at; walk 7
 * T2-07).
 */
const FEES_LEAD = 'Your score adds up the games of every player you hold or short';

/**
 * The rules' parts and their short headings, each starting at its sentence
 * (walk 5 T1-09, T3-13: one run of text with no headings to jump by).
 */
const SECTION_STARTS: ReadonlyArray<readonly [string, string]> = [
  ['Scoring', PAY_LINE],
  ['Shorts', SHORT_EXPLAINER],
  ['Fees', FEES_LEAD],
  ['Prices', PRICE_EXPLAINER],
  ['Locks', LOCK_EXPLAINER],
];

export interface RulesSection {
  heading: string;
  text: string;
}

/**
 * The explanation as headed parts, without changing a word: Goal, Scoring,
 * Shorts, Fees, Prices, Locks. The Rules sheet reads it this way.
 */
export function rulesSections(explanation: string): RulesSection[] {
  const cuts = SECTION_STARTS
    .map(([heading, marker]) => ({ heading, at: explanation.indexOf(marker) }))
    .filter((cut) => cut.at > 0)
    .sort((left, right) => left.at - right.at);
  const sections: RulesSection[] = [];
  let start = 0;
  let heading = 'Goal';
  for (const cut of cuts) {
    sections.push({ heading, text: explanation.slice(start, cut.at).trim() });
    start = cut.at;
    heading = cut.heading;
  }
  sections.push({ heading, text: explanation.slice(start).trim() });
  return sections.filter((section) => section.text);
}

/** The explanation in short paragraphs (the sections' text), without changing a word. */
export function rulesParagraphs(explanation: string): string[] {
  return rulesSections(explanation).map((section) => section.text);
}

/**
 * Settings' lede: the goal, then the loop in one breath ("Each game he
 * plays, you pay his price and collect his dividend…"); the rest is one tap
 * away in the rules.
 */
export function rulesSummary(explanation: string): string | null {
  const goal = rulesSections(explanation)[0]?.text;
  if (!goal) return null;
  return explanation.includes(PAY_LINE) && !goal.includes(PAY_LINE) ? `${goal} ${ROSTER_EXPLAINER}` : goal;
}

/** Scoring's parts, as the Rules sheet draws them (walk 6 T1-03). */
export interface ScoringParts {
  /** Pay his price and collect his dividend; what the dividend is; a bad game; beat the price and you profit. */
  lines: string[];
  /** What net points are. */
  netPoints: string;
  /** "Example: 3.5 net points = $140K dividend; price $118K; profit +$22K." */
  example: string;
  /** Single games are noisy. */
  luck: string;
}
