import type { PerGameLedgerEntry } from '../api/contracts';

const DIVIDEND_KINDS = new Set(['game_dividend', 'dividend', 'dividend_correction', 'correction']);
const FEE_KINDS = new Set(['open_fee', 'drop_fee', 'fee', 'penalty']);

/** Signed ledger components sum to score, including cost credits for shorts. */
export function scoreComponents(entries: readonly PerGameLedgerEntry[]) {
  let dividends = 0;
  let gameCosts = 0;
  let fees = 0;
  for (const entry of entries) {
    if (entry.kind === 'game_cost' || entry.kind === 'game_cost_correction') {
      gameCosts += entry.amountDollars;
    } else if (DIVIDEND_KINDS.has(entry.kind)) dividends += entry.amountDollars;
    else if (FEE_KINDS.has(entry.kind)) fees += entry.amountDollars;
  }
  return { dividends, gameCosts, fees };
}
