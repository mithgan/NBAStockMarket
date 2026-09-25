import type { PerGamePositionSide, PerGameRuleset } from '../api/contracts';
import { ROSTER_EXPLAINER, SHORT_EXPLAINER } from '../copy/terms';
import { formatMoney } from '../format';

/** What net points are, in box-score terms a fan already knows. */
export const NET_POINTS_EXPLAINER =
  'Net points are a box-score score: points, rebounds, assists, steals and blocks count for him; turnovers, missed shots and minutes count against him.';

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
      : "A player's dividend comes from how far his net points beat his pregame projection."} ${NET_POINTS_EXPLAINER} ${ROSTER_EXPLAINER} ${SHORT_EXPLAINER} Your score is the total of those games plus fees. ${NEGATIVE_DIVIDEND_EXPLAINER}`,
  };
}

export function positionSlotHint(side: PerGamePositionSide, limit: number) {
  return side === 'long'
    ? `Add players to your ${limit}-player roster`
    : `Short up to ${limit} players`;
}

/**
 * The explanation in short paragraphs, split before the roster sentence, the
 * short sentence and the bad-game sentence, without changing a word. The
 * Rules sheet and Settings both read it this way.
 */
export function rulesParagraphs(explanation: string): string[] {
  const paragraphs: string[] = [];
  let rest = explanation;
  for (const marker of [ROSTER_EXPLAINER, SHORT_EXPLAINER, NEGATIVE_DIVIDEND_EXPLAINER]) {
    const at = rest.indexOf(marker);
    if (at < 0) continue;
    paragraphs.push(rest.slice(0, at), marker);
    rest = rest.slice(at + marker.length);
  }
  paragraphs.push(rest);
  return paragraphs.map((part) => part.trim()).filter(Boolean);
}
