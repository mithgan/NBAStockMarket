import type { PerGamePositionSide, PerGameRuleset } from '../api/contracts';
import { LOCK_EXPLAINER, ROSTER_EXPLAINER, SHORT_EXPLAINER } from '../copy/terms';
import { formatMoney } from '../format';

/** What net points are, in box-score terms a fan already knows. */
export const NET_POINTS_EXPLAINER =
  'Net points boil his box score down to one number: points, rebounds, assists, steals and blocks add to it; turnovers, missed shots and minutes played take away.';

/** Why prices move, and why yours does not. */
export const PRICE_EXPLAINER =
  "A player's price can change from game to game. The price you add him at is locked for as long as you hold him.";

/** Why a dividend can be below zero, and who pays it. */
export const NEGATIVE_DIVIDEND_EXPLAINER =
  'A bad game can make his dividend negative: then a roster spot pays it and a short collects it.';

export function perGameRulesPresentation(rules: PerGameRuleset) {
  const raw = rules.dividendBasis === 'raw_net_points';
  return {
    facts: [
      { label: 'Starting score', value: '$0' },
      { label: 'Dividend basis', value: raw ? 'Net points scored' : 'Net points above projection' },
      { label: 'Dividend rate', value: `${formatMoney(rules.dividendDollarsPerNetPoint)} per net point` },
      { label: 'Roster slots', value: String(rules.longSlotLimit) },
      { label: 'Short slots', value: String(rules.shortSlotLimit) },
      { label: 'Open fee', value: formatMoney(rules.transactionFeeDollars) },
      { label: 'Drop fee', value: formatMoney(rules.transactionFeeDollars) },
      { label: 'Shorts last', value: rules.shortTermDays === null ? 'Until you close them' : `${rules.shortTermDays} days` },
    ],
    explanation: `${raw
      ? "A player's dividend comes from his net points each game."
      : "A player's dividend comes from how far his net points beat his pregame projection."} ${NET_POINTS_EXPLAINER} ${ROSTER_EXPLAINER} ${SHORT_EXPLAINER} Your score adds up those games, minus a ${formatMoney(rules.transactionFeeDollars)} fee each time you add or drop a player, or open or close a short. ${NEGATIVE_DIVIDEND_EXPLAINER} ${PRICE_EXPLAINER} ${LOCK_EXPLAINER}`,
    /** Plain definitions of the words the screens use. */
    glossary: [
      { term: 'Price', meaning: 'What one game of a player costs. The price you add him at stays locked while you hold him.' },
      { term: 'Dividend', meaning: 'What he pays out for one game: his net points times the dividend rate. It can be below zero.' },
      { term: 'Profit', meaning: 'Dividend minus price for a roster spot; price minus dividend for a short.' },
      { term: 'Short', meaning: 'A bet that he comes in under his price. It lasts a set number of days.' },
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
 * The explanation in short paragraphs, split before the roster sentence, the
 * short sentence, the bad-game sentence, the price sentence and the lock
 * sentence, without changing a word. The
 * Rules sheet and Settings both read it this way.
 */
export function rulesParagraphs(explanation: string): string[] {
  const paragraphs: string[] = [];
  let rest = explanation;
  for (const marker of [ROSTER_EXPLAINER, SHORT_EXPLAINER, NEGATIVE_DIVIDEND_EXPLAINER, PRICE_EXPLAINER, LOCK_EXPLAINER]) {
    const at = rest.indexOf(marker);
    if (at < 0) continue;
    paragraphs.push(rest.slice(0, at), marker);
    rest = rest.slice(at + marker.length);
  }
  paragraphs.push(rest);
  return paragraphs.map((part) => part.trim()).filter(Boolean);
}
