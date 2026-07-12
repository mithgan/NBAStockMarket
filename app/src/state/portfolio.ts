import type { Holding, Player, PortfolioSummary } from '../data/types';

export const STARTING_CASH = 140_000_000;

export interface PortfolioState {
  cash: number;
  holdings: Holding[];
}

export type TradeSide = 'buy' | 'sell';

export interface TradeResult {
  state: PortfolioState;
  error: string | null;
}

export const initialPortfolioState: PortfolioState = {
  cash: STARTING_CASH,
  holdings: [],
};

export function executeTrade(
  state: PortfolioState,
  player: Player,
  side: TradeSide,
): TradeResult {
  const holding = state.holdings.find((item) => item.player_id === player.id);

  if (side === 'buy') {
    if (holding) {
      return { state, error: 'One share per player maximum' };
    }
    if (state.cash < player.listing_price) {
      return { state, error: 'Not enough cash' };
    }

    return {
      state: {
        cash: state.cash - player.listing_price,
        holdings: [
          ...state.holdings,
          {
            player_id: player.id,
            shares: 1,
            average_price: player.listing_price,
          },
        ],
      },
      error: null,
    };
  }

  if (!holding) {
    return { state, error: 'No share to sell' };
  }

  return {
    state: {
      cash: state.cash + player.listing_price,
      holdings: state.holdings.filter((item) => item.player_id !== player.id),
    },
    error: null,
  };
}

export function getPortfolioSummary(
  state: PortfolioState,
  players: Player[],
): PortfolioSummary {
  const prices = new Map(players.map((player) => [player.id, player.listing_price]));
  const marketValue = state.holdings.reduce(
    (total, holding) => total + (prices.get(holding.player_id) ?? 0),
    0,
  );

  return {
    cash: state.cash,
    holdings: state.holdings,
    market_value: marketValue,
    total_value: state.cash + marketValue,
  };
}
