import type { PerGamePositionSide, PerGameRuleset } from '../api/contracts';
import { formatMoney } from '../format';

export function perGameRulesPresentation(rules: PerGameRuleset) {
  const raw = rules.dividendBasis === 'raw_net_points';
  return {
    facts: [
      { label: 'Starting score', value: '$0' },
      { label: 'Dividend basis', value: raw ? 'Raw net points' : 'Surprise vs projection' },
      { label: 'Dividend rate', value: `${formatMoney(rules.dividendDollarsPerNetPoint)} per net point` },
      { label: 'Roster slots', value: String(rules.longSlotLimit) },
      { label: 'Inverse slots', value: String(rules.shortSlotLimit) },
      { label: 'Open fee', value: formatMoney(rules.transactionFeeDollars) },
      { label: 'Drop fee', value: formatMoney(rules.transactionFeeDollars) },
      { label: 'Inverse term', value: rules.shortTermDays === null ? 'No expiry' : `${rules.shortTermDays} days` },
    ],
    explanation: `${raw
      ? "Dividends use each game's raw net points."
      : 'Dividends use the difference between actual net points and the saved pregame projection.'} A roster position receives the dividend and pays its locked game cost. An inverse position receives that cost and pays the dividend. Your score includes these cash flows and fees.`,
  };
}

export function positionSlotHint(side: PerGamePositionSide, limit: number) {
  return side === 'long'
    ? `Add players to your ${limit}-player roster`
    : `Open inverse positions in up to ${limit} slots`;
}
