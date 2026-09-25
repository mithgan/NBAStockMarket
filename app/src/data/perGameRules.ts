import type { PerGamePositionSide, PerGameRuleset } from '../api/contracts';
import { ROSTER_EXPLAINER, SHORT_EXPLAINER } from '../copy/terms';
import { formatMoney } from '../format';

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
      : "A player's dividend comes from how far his net points beat his pregame projection."} ${ROSTER_EXPLAINER} ${SHORT_EXPLAINER} Your score is the total of those games plus fees.`,
  };
}

export function positionSlotHint(side: PerGamePositionSide, limit: number) {
  return side === 'long'
    ? `Add players to your ${limit}-player roster`
    : `Short up to ${limit} players`;
}
