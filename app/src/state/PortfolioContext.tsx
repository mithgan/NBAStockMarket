import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { players } from '../data/snapshot';
import type { Player } from '../data/types';
import {
  executeTrade,
  getPortfolioSummary,
  initialPortfolioState,
  type PortfolioState,
  type TradeSide,
} from './portfolio';

interface PortfolioContextValue {
  state: PortfolioState;
  summary: ReturnType<typeof getPortfolioSummary>;
  message: string | null;
  trade: (player: Player, side: TradeSide) => void;
  owns: (playerId: string) => boolean;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialPortfolioState);
  const [message, setMessage] = useState<string | null>(null);
  const summary = useMemo(() => getPortfolioSummary(state, players), [state]);

  const trade = (player: Player, side: TradeSide) => {
    const result = executeTrade(state, player, side);
    setState(result.state);
    setMessage(
      result.error ?? `${side === 'buy' ? 'Bought' : 'Sold'} 1 share of ${player.name}`,
    );
  };

  const owns = (playerId: string) =>
    state.holdings.some((holding) => holding.player_id === playerId);

  return (
    <PortfolioContext.Provider value={{ state, summary, message, trade, owns }}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  const context = useContext(PortfolioContext);
  if (!context) {
    throw new Error('usePortfolio must be used within PortfolioProvider');
  }
  return context;
}
