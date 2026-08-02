import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { players } from '../data/snapshot';
import { playerTrends } from '../data/trends';
import type { Player } from '../data/types';
import { formatSignedMoney } from '../format';
import {
  executeTrade,
  getPortfolioSummary,
  initialPortfolioState,
  type PortfolioState,
  type TradeSide,
} from './portfolio';
import {
  addDays,
  clampToSeason,
  collectDividends,
  SEASON_END,
  SIM_START,
  type CollectedDividend,
} from './sim';

interface PortfolioContextValue {
  state: PortfolioState;
  summary: ReturnType<typeof getPortfolioSummary>;
  message: string | null;
  simDate: string;
  seasonComplete: boolean;
  recentEvents: CollectedDividend[];
  dividendsCollected: number;
  trade: (player: Player, side: TradeSide) => void;
  owns: (playerId: string) => boolean;
  advanceSim: (days: number) => void;
  resetSeason: () => void;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialPortfolioState);
  const [message, setMessage] = useState<string | null>(null);
  const [simDate, setSimDate] = useState(SIM_START);
  const [recentEvents, setRecentEvents] = useState<CollectedDividend[]>([]);
  const [dividendsCollected, setDividendsCollected] = useState(0);
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

  const advanceSim = (days: number) => {
    const target = clampToSeason(addDays(simDate, days));
    if (target === simDate) return;
    const collection = collectDividends(state.holdings, playerTrends, simDate, target);
    setState((previous) => ({ ...previous, cash: previous.cash + collection.total }));
    setRecentEvents(collection.events);
    setDividendsCollected((previous) => previous + collection.total);
    setSimDate(target);
    setMessage(
      collection.events.length > 0
        ? `${collection.events.length} game${collection.events.length === 1 ? '' : 's'} settled · ${formatSignedMoney(collection.total)}`
        : null,
    );
  };

  const resetSeason = () => {
    setState(initialPortfolioState);
    setSimDate(SIM_START);
    setRecentEvents([]);
    setDividendsCollected(0);
    setMessage('Season restarted');
  };

  return (
    <PortfolioContext.Provider
      value={{
        state,
        summary,
        message,
        simDate,
        seasonComplete: simDate >= SEASON_END,
        recentEvents,
        dividendsCollected,
        trade,
        owns,
        advanceSim,
        resetSeason,
      }}
    >
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
