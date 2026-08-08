export type PlayerTier = 'star' | 'mid' | 'bench';

export interface Player {
  id: string;
  name: string;
  tier: PlayerTier;
  listing_price: number;
  actual_salary: number;
  available_shares?: number;
  buy_fee?: number;
  market_version?: number;
}

export interface DividendEvent {
  player_id: string;
  game_date: string;
  actual_net_points: number;
  expected_net_points: number;
  dividend_per_holder: number;
}

export interface Holding {
  player_id: string;
  shares: 1;
  average_price: number;
}

export interface PortfolioSummary {
  cash: number;
  holdings: Holding[];
  market_value: number;
  total_value: number;
}
