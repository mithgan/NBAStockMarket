import assert from 'node:assert/strict';
import test from 'node:test';

import type { ServerBootstrap } from '../api/contracts';
import { STARTING_CASH } from './game';
import {
  isServerAccountPristine,
  mapServerBootstrap,
  mergeIncrementalBootstrap,
  serverRefreshNotice,
} from './serverState';

function bootstrapFixture(): ServerBootstrap {
  return {
    market: [
      {
        id: 'sga', name: 'Shai Gilgeous-Alexander', tier: 'star',
        current_price_cents: 5_100_000_000, opening_price_cents: 5_000_000_000,
        actual_salary_cents: 4_000_000_000, shares_outstanding: 100,
        available_shares: 99, buy_fee_cents: 63_750_000, ownership_bps: 100,
        volume_30d: 1, version: 3,
      },
      {
        id: 'jokic', name: 'Nikola Jokic', tier: 'star',
        current_price_cents: 6_000_000_000, opening_price_cents: 5_900_000_000,
        actual_salary_cents: 5_900_000_000, shares_outstanding: 100,
        available_shares: 100, buy_fee_cents: 15_000_000, ownership_bps: 0,
        volume_30d: 0, version: 4,
      },
    ],
    portfolio: {
      account_id: 'alice', display_name: 'Alice', version: 3,
      reset_at: '2026-07-21T00:00:00Z', cash_cents: 15_709_650_000,
      free_cash_cents: 15_509_650_000, reserved_collateral_cents: 200_000_000,
      market_value_cents: 5_100_000_000, total_value_cents: 20_809_650_000,
      holdings: [{
        player_id: 'sga', player_name: 'Shai Gilgeous-Alexander', shares: 1,
        average_cost_cents: 5_012_500_000, current_price_cents: 5_100_000_000,
        market_value_cents: 5_100_000_000, unrealized_pnl_cents: 87_500_000,
      }],
      recent_trades: [],
      instruments: {
        week_start: '2025-10-20', reserved_collateral_cents: 200_000_000,
        free_cash_cents: 8_687_250_000,
        weekly_short_slots: { limit: 3, used: 1, remaining: 2 },
        boost_slots: { limit: 2, used: 1, remaining: 1 },
        weekly_shorts: [{
          id: 'short-1', player_id: 'jokic', week_start: '2025-10-20', status: 'active',
          opening_price_cents: 6_000_000_000, fee_cents: 15_000_000,
          collateral_cents: 200_000_000, accrued_net_points_micros: 1_500_000,
          qualifying_games: 1, payout_cents: null, settled_game_date: null,
          created_at: '2025-10-20T12:00:00Z',
        }],
        boosts: [{
          id: 'boost-1', player_id: 'sga', week_start: '2025-10-20',
          game_date: '2025-10-23', status: 'armed', opening_price_cents: 5_100_000_000,
          fee_cents: 12_750_000, payout_cents: null, settled_game_date: null,
          created_at: '2025-10-20T12:01:00Z',
        }],
        weekly_short_targets: [{
          player_id: 'jokic', game_date: '2025-10-24', fee_cents: 15_000_000,
        }],
        boost_targets: [{
          player_id: 'sga', game_date: '2025-10-23', fee_cents: 12_750_000,
        }],
      },
    },
    game: {
      season_id: '2025-26', last_settled_date: '2025-10-21',
      next_game_date: '2025-10-22', is_complete: false, version: 1,
    },
    activity: {
      items: [
        {
          id: 'newer', kind: 'boost_armed', player_id: 'sga', game_date: '2025-10-23',
          amount_cents: -12_750_000, details: { fee_cents: 12_750_000 },
          occurred_at: '2025-10-21T01:00:00Z',
        },
        {
          id: 'older', kind: 'trade_buy', player_id: 'sga', game_date: null,
          amount_cents: -5_012_500_000,
          details: { execution_price_cents: 5_000_000_000, fee_cents: 12_500_000 },
          occurred_at: '2025-10-20T01:00:00Z',
        },
        {
          id: 'future-kind', kind: 'new_server_event', player_id: null, game_date: null,
          amount_cents: 0, details: {}, occurred_at: '2025-10-22T01:00:00Z',
        },
      ],
      next_cursor: null,
    },
    portfolioHistory: {
      items: [
        {
          game_date: '2025-10-22', cash_cents: 15_709_650_000,
          free_cash_cents: 15_509_650_000, reserved_collateral_cents: 200_000_000,
          market_value_cents: 5_100_000_000, total_value_cents: 20_809_650_000,
          created_at: '2025-10-22T02:00:00Z',
        },
        {
          game_date: '2025-10-21', cash_cents: 15_722_400_000,
          free_cash_cents: 15_522_400_000, reserved_collateral_cents: 200_000_000,
          market_value_cents: 5_050_000_000, total_value_cents: 20_772_400_000,
          created_at: '2025-10-21T02:00:00Z',
        },
      ], next_cursor: null,
    },
    settlements: [],
    leaderboard: [{
      rank: 2, account_id: 'alice', display_name: 'Alice',
      total_value_cents: 20_809_650_000, return_bps: 13,
      is_current_user: true,
    }],
    settledResults: [{
      player_id: 'sga', game_date: '2025-10-21',
      actual_net_points_micros: 35_000_000,
      expected_net_points_micros: 25_000_000,
      dividend_cents: 80_000_000,
    }],
    capabilities: { can_advance_day: true },
  };
}

test('mapServerBootstrap converts exact server cents and state into screen data', () => {
  const mapped = mapServerBootstrap(bootstrapFixture());

  assert.equal(mapped.state.cash, 157_096_500);
  assert.equal(mapped.canAdvanceDay, true);
  assert.equal(mapped.state.prices.sga, 51_000_000);
  assert.equal(mapped.players[0].listing_price, 50_000_000);
  assert.equal(mapped.players[0].available_shares, 99);
  assert.equal(mapped.players[0].buy_fee, 637_500);
  assert.equal(mapped.players[0].market_version, 3);
  assert.equal(mapped.state.holdings[0].average_price, 50_125_000);
  assert.equal(mapped.state.holdings[0].cost_basis, 50_125_000);
  assert.equal(mapped.state.weeklyShorts[0].accruedNetPoints, 1.5);
  assert.equal(mapped.state.weeklyShorts[0].week, '2025-W43');
  assert.equal(mapped.state.boosts[0].gameDate, '2025-10-23');
  assert.equal(mapped.state.boosts[0].payout, 0);
  assert.deepEqual(mapped.shortSlots, { used: 1, total: 3 });
  assert.deepEqual(mapped.boostSlots, { used: 1, total: 2 });
  assert.deepEqual(mapped.weeklyShortTargets, [{
    playerId: 'jokic', gameDate: '2025-10-24', fee: 150_000,
  }]);
  assert.deepEqual(mapped.boostTargets, [{
    playerId: 'sga', gameDate: '2025-10-23', fee: 127_500,
  }]);
  assert.equal(mapped.currentWeek, '2025-W43');
  assert.equal(mapped.nextGameDate, '2025-10-22');
  assert.equal(mapped.settledGameDateCount, 1);
  assert.deepEqual(mapped.playerTrends.sga, [{
    date: '2025-10-21', np: 35, expected_np: 25, dividend_per_holder: 800_000,
  }]);
  assert.equal(mapped.leaderboard[0].returnPct, 0.13);
  assert.equal(mapped.leaderboard[0].id, 'alice');
});

test('activity and history are ordered for the existing UI without inventing unknown events', () => {
  const mapped = mapServerBootstrap(bootstrapFixture());

  assert.deepEqual(mapped.state.activity.map((item) => item.id), ['older', 'newer']);
  assert.equal(mapped.state.activity[0].message, 'Bought one share of Shai Gilgeous-Alexander');
  assert.equal(mapped.state.activity[0].cashDelta, -50_125_000);
  assert.equal(mapped.state.activity[0].fee, 125_000);
  assert.deepEqual(mapped.state.portfolioHistory.map((point) => point.date), [
    '2025-10-21',
    '2025-10-22',
  ]);
  assert.equal(
    mapped.state.portfolioHistory[0].dailyChange,
    207_724_000 - STARTING_CASH,
  );
  assert.equal(mapped.state.portfolioHistory[1].dailyChange, 372_500);
});

test('pristine detection permits only the backend one-time transition shape', () => {
  const fixture = bootstrapFixture();
  fixture.portfolio.version = 0;
  fixture.portfolio.cash_cents = STARTING_CASH * 100;
  fixture.portfolio.holdings = [];
  fixture.portfolio.recent_trades = [];
  fixture.portfolio.instruments.weekly_shorts = [];
  fixture.portfolio.instruments.boosts = [];
  fixture.activity.items = [];
  assert.equal(isServerAccountPristine(fixture), true);

  fixture.activity.items.push({
    id: 'trade', kind: 'trade_buy', player_id: 'sga', game_date: null,
    amount_cents: 0, details: {}, occurred_at: '2025-10-20T00:00:00Z',
  });
  assert.equal(isServerAccountPristine(fixture), false);
});

test('an unknown server replay date remains visible without exposing fabricated events', () => {
  const fixture = bootstrapFixture();
  fixture.game.next_game_date = '2026-10-20';

  const mapped = mapServerBootstrap(fixture);

  assert.equal(mapped.nextGameDate, '2026-10-20');
});

test('refresh feedback explains that syncing does not advance the shared replay', () => {
  const fixture = bootstrapFixture();

  assert.equal(
    serverRefreshNotice(fixture),
    'You are up to date. Next replay date: Oct 22, 2025. Replay dates advance for everyone only after the server settles them.',
  );

  fixture.game.next_game_date = null;
  fixture.game.is_complete = true;
  assert.equal(
    serverRefreshNotice(fixture),
    'Server data is up to date. The historical replay is complete.',
  );
});

test('mapping refuses results after the authoritative settled date', () => {
  const fixture = bootstrapFixture();
  fixture.settledResults.push({
    player_id: 'sga', game_date: '2025-10-22',
    actual_net_points_micros: 99_000_000,
    expected_net_points_micros: 1_000_000,
    dividend_cents: 999_000_000,
  });

  const mapped = mapServerBootstrap(fixture);

  assert.equal(mapped.playerTrends.sga.length, 1);
  assert.equal(mapped.playerTrends.sga[0].date, '2025-10-21');
});

test('incremental bootstrap merges new settled results without duplicating history', () => {
  const previous = bootstrapFixture();
  const incoming = bootstrapFixture();
  incoming.game.last_settled_date = '2025-10-22';
  incoming.game.next_game_date = '2025-10-23';
  incoming.settledResults = [{
    player_id: 'sga', game_date: '2025-10-22',
    actual_net_points_micros: 42_000_000,
    expected_net_points_micros: 25_000_000,
    dividend_cents: 136_000_000,
  }];

  const merged = mergeIncrementalBootstrap(previous, incoming, '2025-10-21');

  assert.equal(merged.kind, 'merged');
  assert.deepEqual(merged.bootstrap.settledResults.map((row) => row.game_date), [
    '2025-10-21',
    '2025-10-22',
  ]);
  assert.equal(merged.bootstrap.settledResults.at(-1)?.dividend_cents, 136_000_000);
});

test('incremental bootstrap requests a full reload when the server clock moves backward', () => {
  const previous = bootstrapFixture();
  previous.game.last_settled_date = '2025-10-22';
  const incoming = bootstrapFixture();
  incoming.game.last_settled_date = '2025-10-20';
  incoming.settledResults = [];

  const merged = mergeIncrementalBootstrap(previous, incoming, '2025-10-22');

  assert.equal(merged.kind, 'reload');
});
