import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BOOST_FEE_PCT,
  BOOST_SLOTS,
  DOLLARS_PER_NET_POINT,
  FEE_PCT,
  GAME_STATE_VERSION,
  IMPACT_K,
  SHORT_FEE_PCT,
  SHORT_MIN_FEE,
  STARTING_CASH,
  WEEKLY_GAME_CLAMP_NP,
  WEEKLY_SHORT_COLLATERAL,
  WEEKLY_SHORT_SLOTS,
  WEEKLY_TOTAL_CLAMP_NP,
  advanceReplayDay,
  armBoost,
  armWeeklyShort,
  createInitialGameState,
  getFreeCash,
  getGameSummary,
  isGameState,
  isGameStateForPlayers,
  rankGameLeaderboard,
  tradePlayer,
  type GamePlayer,
  type GameState,
  type SettlementEvent,
  type TransitionResult,
} from './game';

const monday = '2025-12-29';
const week = '2026-W01';

const players: GamePlayer[] = [
  { id: 'alpha', name: 'Alpha Guard', listing_price: 40_000_000 },
  { id: 'beta', name: 'Beta Wing', listing_price: 20_000_000 },
  { id: 'gamma', name: 'Gamma Big', listing_price: 10_000_000 },
  { id: 'delta', name: 'Delta Guard', listing_price: 5_000_000 },
  { id: 'epsilon', name: 'Epsilon Wing', listing_price: 1_000_000 },
];

function event(
  playerId: string,
  date: string,
  actualNetPoints: number,
  expectedNetPoints: number,
  dividendPerHolder: number,
): SettlementEvent {
  return {
    playerId,
    date,
    actualNetPoints,
    expectedNetPoints,
    dividendPerHolder,
  };
}

function assertAtomicError(
  result: TransitionResult,
  state: GameState,
  error: string,
) {
  assert.equal(result.error, error);
  assert.strictEqual(result.state, state);
}

test('exports the decided economy constants', () => {
  assert.equal(GAME_STATE_VERSION, 1);
  assert.equal(STARTING_CASH, 140_000_000);
  assert.equal(FEE_PCT, 0.0025);
  assert.equal(IMPACT_K, 0.003);
  assert.equal(WEEKLY_SHORT_SLOTS, 3);
  assert.equal(WEEKLY_GAME_CLAMP_NP, 25);
  assert.equal(WEEKLY_TOTAL_CLAMP_NP, 50);
  assert.equal(WEEKLY_SHORT_COLLATERAL, 2_000_000);
  assert.equal(SHORT_FEE_PCT, 0.0025);
  assert.equal(SHORT_MIN_FEE, 10_000);
  assert.equal(DOLLARS_PER_NET_POINT, 40_000);
  assert.equal(BOOST_SLOTS, 2);
  assert.equal(BOOST_FEE_PCT, 0.0025);
});

test('creates a versioned JSON state with finite prices and a correct summary', () => {
  const state = createInitialGameState([
    ...players,
    { id: 'broken', name: 'Broken', listing_price: Number.NaN },
  ]);
  const summary = getGameSummary(state, players);

  assert.equal(state.version, 1);
  assert.equal(state.cash, STARTING_CASH);
  assert.equal(state.prices.alpha, 40_000_000);
  assert.equal('broken' in state.prices, false);
  assert.equal(getFreeCash(state), STARTING_CASH);
  assert.deepEqual(summary, {
    cash: STARTING_CASH,
    freeCash: STARTING_CASH,
    reservedCollateral: 0,
    marketValue: 0,
    totalValue: STARTING_CASH,
    holdings: [],
    latestDailyChange: 0,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('buy and sell charge fees, apply one-share exponential impact, and use state prices', () => {
  const initial = createInitialGameState(players);
  const stalePlayer = { ...players[0], listing_price: 1 };
  const bought = tradePlayer(initial, stalePlayer, 'buy');
  const buyFee = 40_000_000 * FEE_PCT;

  assert.equal(bought.error, null);
  assert.equal(bought.state.cash, STARTING_CASH - 40_000_000 - buyFee);
  assert.equal(bought.state.holdings[0].average_price, 40_000_000);
  assert.equal(bought.state.prices.alpha, 40_000_000 * Math.exp(IMPACT_K));
  const boughtSummary = getGameSummary(bought.state, players);
  assert.equal(boughtSummary.marketValue, bought.state.prices.alpha);
  assert.equal(boughtSummary.holdings[0].costBasis, 40_000_000 + buyFee);
  assert.equal(
    boughtSummary.holdings[0].unrealizedPnl,
    bought.state.prices.alpha - 40_000_000 - buyFee,
  );

  const sold = tradePlayer(bought.state, players[0], 'sell');
  const sellExecution = bought.state.prices.alpha;
  assert.equal(sold.error, null);
  assert.equal(
    sold.state.cash,
    bought.state.cash + sellExecution - sellExecution * FEE_PCT,
  );
  assert.ok(Math.abs(sold.state.prices.alpha - 40_000_000) < 1e-6);
  assert.deepEqual(sold.state.holdings, []);
});

test('trade failures are atomic and affordability uses free cash', () => {
  const initial = createInitialGameState(players);
  const bought = tradePlayer(initial, players[0], 'buy').state;
  assertAtomicError(
    tradePlayer(bought, players[0], 'buy'),
    bought,
    'One share per player maximum',
  );
  assertAtomicError(
    tradePlayer(initial, players[0], 'sell'),
    initial,
    'No share to sell',
  );

  const shorted = armWeeklyShort(initial, players[1], week).state;
  assertAtomicError(
    tradePlayer(shorted, players[1], 'buy'),
    shorted,
    'Cannot buy a player you are shorting',
  );
  const collateralBound = { ...shorted, cash: 41_000_000 };
  assert.equal(getFreeCash(collateralBound), 39_000_000);
  assertAtomicError(
    tradePlayer(collateralBound, players[0], 'buy'),
    collateralBound,
    'Not enough free cash',
  );
});

test('weekly shorts charge the percent/minimum fee and reserve collateral', () => {
  const initial = createInitialGameState(players);
  const high = armWeeklyShort(initial, players[0], week);
  assert.equal(high.error, null);
  assert.equal(high.state.weeklyShorts[0].feePaid, 100_000);
  assert.equal(high.state.cash, STARTING_CASH - 100_000);
  assert.equal(getFreeCash(high.state), STARTING_CASH - 100_000 - WEEKLY_SHORT_COLLATERAL);

  const low = armWeeklyShort(high.state, players[4], week);
  assert.equal(low.error, null);
  assert.equal(low.state.weeklyShorts[1].feePaid, 10_000);
});

test('weekly short duplicate, held, boosted, slot, and collateral conflicts are atomic', () => {
  const initial = createInitialGameState(players);
  const held = tradePlayer(initial, players[0], 'buy').state;
  assertAtomicError(
    armWeeklyShort(held, players[0], week),
    held,
    'Cannot short a player you hold',
  );

  const boosted = armBoost(held, players[0], monday, week).state;
  assertAtomicError(
    tradePlayer(boosted, players[0], 'sell'),
    boosted,
    'Cannot sell a player with an active boost',
  );
  const boostedWithoutHolding = { ...boosted, holdings: [] };
  assertAtomicError(
    armWeeklyShort(boostedWithoutHolding, players[0], week),
    boostedWithoutHolding,
    'Cannot short a player you boosted this week',
  );

  const first = armWeeklyShort(initial, players[0], week).state;
  assertAtomicError(
    armWeeklyShort(first, players[0], week),
    first,
    'Already shorting this player',
  );

  const second = armWeeklyShort(first, players[1], week).state;
  const third = armWeeklyShort(second, players[2], week).state;
  assertAtomicError(
    armWeeklyShort(third, players[3], week),
    third,
    'All weekly short slots are armed',
  );

  const poor = { ...initial, cash: WEEKLY_SHORT_COLLATERAL + 99_999 };
  assertAtomicError(
    armWeeklyShort(poor, players[0], week),
    poor,
    'Not enough free cash for fee plus collateral',
  );
});

test('weekly shorts cannot be armed after that player has already played in the window', () => {
  const initial = createInitialGameState(players);
  const replayed = advanceReplayDay(
    initial,
    monday,
    [event('alpha', monday, 10, 0, 400_000)],
    '2025-12-30',
    players,
  ).state;

  assertAtomicError(
    armWeeklyShort(replayed, players[0], week),
    replayed,
    'Player has already played this week',
  );
  assert.equal(armWeeklyShort(replayed, players[1], week).error, null);
});

test('weekly short accrual negates and clamps each surprise and the weekly payout', () => {
  let state = createInitialGameState(players);
  state = armWeeklyShort(state, players[0], week).state;
  state = armWeeklyShort(state, players[1], week).state;

  const dates = ['2025-12-29', '2025-12-30', '2025-12-31'];
  dates.forEach((date, index) => {
    const next = index === dates.length - 1 ? '2026-01-05' : dates[index + 1];
    state = advanceReplayDay(
      state,
      date,
      [
        event('alpha', date, -100, 0, -4_000_000),
        event('beta', date, 100, 0, 4_000_000),
      ],
      next,
      players,
    ).state;
  });

  const alpha = state.weeklyShorts.find((position) => position.playerId === 'alpha');
  const beta = state.weeklyShorts.find((position) => position.playerId === 'beta');
  assert.equal(alpha?.accruedNetPoints, 75);
  assert.equal(alpha?.payout, 50 * DOLLARS_PER_NET_POINT);
  assert.equal(alpha?.status, 'settled');
  assert.equal(beta?.accruedNetPoints, -75);
  assert.equal(beta?.payout, -50 * DOLLARS_PER_NET_POINT);
  assert.equal(beta?.status, 'settled');
});

test('weekly shorts settle from the bias-corrected dividend signal', () => {
  const initial = createInitialGameState(players);
  const armed = armWeeklyShort(initial, players[0], week).state;
  const settled = advanceReplayDay(
    armed,
    monday,
    [event('alpha', monday, 100, 0, 400_000)],
    '2026-01-05',
    players,
  ).state;

  assert.equal(settled.weeklyShorts[0].accruedNetPoints, -10);
  assert.equal(settled.weeklyShorts[0].payout, -400_000);
});

test('a weekly short with no qualifying event voids and refunds its fee', () => {
  const initial = createInitialGameState(players);
  const armed = armWeeklyShort(initial, players[0], week).state;
  const settled = advanceReplayDay(
    armed,
    '2026-01-04',
    [event('unknown', '2026-01-04', 10, 0, 400_000)],
    '2026-01-05',
    players,
  );

  assert.equal(settled.error, null);
  assert.equal(settled.state.cash, STARTING_CASH);
  assert.equal(settled.state.weeklyShorts[0].status, 'voided');
  assert.equal(settled.state.weeklyShorts[0].payout, 0);
  assert.equal(getFreeCash(settled.state), STARTING_CASH);
});

test('boosts charge a fee and add one extra signed held dividend', () => {
  const initial = createInitialGameState(players);
  const held = tradePlayer(initial, players[0], 'buy').state;
  const armed = armBoost(held, players[0], monday, week);
  const fee = held.prices.alpha * BOOST_FEE_PCT;
  assert.equal(armed.error, null);
  assert.equal(armed.state.cash, held.cash - fee);

  const settled = advanceReplayDay(
    armed.state,
    monday,
    [event('alpha', monday, 0, 0, -250_000)],
    '2025-12-30',
    players,
  );
  assert.equal(settled.error, null);
  assert.equal(settled.state.cash, armed.state.cash - 500_000);
  assert.equal(settled.state.boosts[0].status, 'consumed');
  assert.equal(settled.state.boosts[0].payout, -250_000);
});

test('an active boost keeps its required holding until the game settles', () => {
  const initial = createInitialGameState(players);
  const held = tradePlayer(initial, players[0], 'buy').state;
  const armed = armBoost(held, players[0], monday, week).state;

  assertAtomicError(
    tradePlayer(armed, players[0], 'sell'),
    armed,
    'Cannot sell a player with an active boost',
  );
});

test('boost limits, duplicate targets, ownership, short conflicts, and dates are enforced', () => {
  const initial = createInitialGameState(players);
  assertAtomicError(
    armBoost(initial, players[0], monday, week),
    initial,
    'Boosts require holding the player',
  );

  const shorted = armWeeklyShort(initial, players[0], week).state;
  const heldWhileShort: GameState = {
    ...shorted,
    cash: shorted.cash - shorted.prices.alpha,
    holdings: [
      {
        player_id: players[0].id,
        shares: 1,
        average_price: shorted.prices.alpha,
      },
    ],
  };
  assertAtomicError(
    armBoost(heldWhileShort, players[0], monday, week),
    heldWhileShort,
    'Cannot boost a player you shorted this week',
  );

  let held = tradePlayer(initial, players[0], 'buy').state;
  held = tradePlayer(held, players[1], 'buy').state;
  held = tradePlayer(held, players[2], 'buy').state;
  const first = armBoost(held, players[0], monday, week).state;
  assertAtomicError(
    armBoost(first, players[0], monday, week),
    first,
    'Already have an armed boost for this player',
  );
  assertAtomicError(
    armBoost(first, players[0], '2025-12-30', week),
    first,
    'Already have an armed boost for this player',
  );
  const second = armBoost(first, players[1], '2025-12-30', week).state;
  assertAtomicError(
    armBoost(second, players[2], '2025-12-31', week),
    second,
    'All boost slots are used this week',
  );
  assertAtomicError(
    armBoost(held, players[0], '2026-01-05', week),
    held,
    'Game date does not match week',
  );
});

test('signed dividend losses can make cash negative without stalling the replay', () => {
  const initial = createInitialGameState(players);
  const held = tradePlayer(initial, players[4], 'buy').state;
  const nearZeroCash = { ...held, cash: 100_000 };
  const settled = advanceReplayDay(
    nearZeroCash,
    monday,
    [event('epsilon', monday, -12.5, 0, -500_000)],
    '2025-12-30',
    players,
  );

  assert.equal(settled.error, null);
  assert.equal(settled.state.cash, -400_000);
  assert.equal(settled.state.settledDates.includes(monday), true);
  assert.equal(isGameState(settled.state), true);
  assertAtomicError(
    tradePlayer(settled.state, players[3], 'buy'),
    settled.state,
    'Not enough free cash',
  );
  assert.equal(tradePlayer(settled.state, players[4], 'sell').error, null);
});

test('a missing boost target refunds its fee and returns the weekly slot', () => {
  const initial = createInitialGameState(players);
  let state = tradePlayer(initial, players[0], 'buy').state;
  state = tradePlayer(state, players[1], 'buy').state;
  const beforeFee = state.cash;
  state = armBoost(state, players[0], monday, week).state;
  state = advanceReplayDay(state, monday, [], '2025-12-30', players).state;

  assert.equal(state.cash, beforeFee);
  assert.equal(state.boosts[0].status, 'refunded');
  const replacement = armBoost(state, players[1], '2025-12-30', week);
  assert.equal(replacement.error, null);
});

test('replay applies each held player event once and rejects duplicate dates atomically', () => {
  const initial = createInitialGameState(players);
  const held = tradePlayer(initial, players[0], 'buy').state;
  const replayed = advanceReplayDay(
    held,
    monday,
    [
      event('alpha', monday, 10, 0, 400_000),
      event('alpha', monday, 10, 0, 400_000),
    ],
    '2025-12-30',
    players,
  );

  assert.equal(replayed.error, null);
  assert.equal(replayed.state.cash, held.cash + 400_000);
  assertAtomicError(
    advanceReplayDay(
      replayed.state,
      monday,
      [event('alpha', monday, 10, 0, 400_000)],
      '2025-12-30',
      players,
    ),
    replayed.state,
    'This replay date has already been settled',
  );
});

test('ISO year rollover keeps shorts open until the Monday-Sunday week ends', () => {
  const initial = createInitialGameState(players);
  const armed = armWeeklyShort(initial, players[0], week).state;
  const newYear = advanceReplayDay(
    armed,
    '2025-12-31',
    [event('alpha', '2025-12-31', 10, 0, 400_000)],
    '2026-01-01',
    players,
  ).state;
  assert.equal(newYear.weeklyShorts[0].status, 'active');

  const boundary = advanceReplayDay(
    newYear,
    '2026-01-04',
    [],
    '2026-01-05',
    players,
  ).state;
  assert.equal(boundary.weeklyShorts[0].status, 'settled');
  assert.equal(boundary.weeklyShorts[0].payout, -400_000);
});

test('non-finite state and settlement inputs are rejected without mutation', () => {
  const initial = createInitialGameState(players);
  const corrupt = {
    ...initial,
    prices: { ...initial.prices, alpha: Number.POSITIVE_INFINITY },
  };
  assertAtomicError(
    tradePlayer(corrupt, players[0], 'buy'),
    corrupt,
    'Game state contains non-finite values',
  );

  assertAtomicError(
    advanceReplayDay(
      initial,
      monday,
      [event('alpha', monday, Number.NaN, 0, 0)],
      '2025-12-30',
      players,
    ),
    initial,
    'Settlement events must contain finite values',
  );
});

test('persisted-state validation rejects malformed nested records and duplicates', () => {
  const initial = createInitialGameState(players);
  const replayDates = ['2025-10-21', '2025-10-22', '2025-10-23'];
  assert.equal(isGameState(initial), true);
  assert.equal(isGameState({ ...initial, settledDates: ['not-a-date'] }), false);
  assert.equal(
    isGameState({ ...initial, holdings: [{ player_id: 'alpha', shares: 2, average_price: 1 }] }),
    false,
  );
  assert.equal(
    isGameState({
      ...initial,
      holdings: [
        { player_id: 'alpha', shares: 1, average_price: 1 },
        { player_id: 'alpha', shares: 1, average_price: 1 },
      ],
    }),
    false,
  );
  assert.equal(isGameState({ ...initial, settledDates: [] , prices: {} }), false);
  const withActivity = tradePlayer(initial, players[0], 'buy').state;
  assert.equal(
    isGameState({
      ...withActivity,
      activity: [{ ...withActivity.activity[0], message: { malformed: true } }],
    }),
    false,
  );
  assert.equal(isGameStateForPlayers(initial, players, replayDates), true);
  assert.equal(
    isGameStateForPlayers({ ...initial, settledDates: replayDates.slice(0, 2) }, players, replayDates),
    true,
  );
  assert.equal(
    isGameStateForPlayers({ ...initial, settledDates: ['2025-10-23'] }, players, replayDates),
    false,
  );
  assert.equal(
    isGameStateForPlayers(
      { ...initial, settledDates: ['2025-10-21', '2025-10-23'] },
      players,
      replayDates,
    ),
    false,
  );
  assert.equal(
    isGameStateForPlayers({ ...initial, settledDates: ['2025-10-20'] }, players, replayDates),
    false,
  );
  assert.equal(
    isGameStateForPlayers({ ...initial, prices: { bogus: 1 } }, players, replayDates),
    false,
  );
  assert.equal(
    isGameStateForPlayers(
      { ...initial, prices: { ...initial.prices, bogus: 1 } },
      players,
      replayDates,
    ),
    false,
  );
});

test('activity and portfolio history are deterministic and retain only the latest 200 records', () => {
  function playSeason() {
    let state = tradePlayer(createInitialGameState(players), players[0], 'buy').state;
    const start = Date.UTC(2025, 0, 1);
    for (let index = 0; index < 205; index += 1) {
      const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
      const next = new Date(start + (index + 1) * 86_400_000).toISOString().slice(0, 10);
      state = advanceReplayDay(
        state,
        date,
        [event('alpha', date, 0, 0, 1)],
        next,
        players,
      ).state;
    }
    return state;
  }

  const first = playSeason();
  const second = playSeason();
  assert.equal(first.activity.length, 200);
  assert.equal(first.portfolioHistory.length, 200);
  assert.equal(first.portfolioHistory[0].date, '2025-01-06');
  assert.deepEqual(second.activity, first.activity);
  assert.deepEqual(second.portfolioHistory, first.portfolioHistory);
  assert.equal(new Set(first.activity.map((item) => item.id)).size, 200);
});

test('leaderboard ranking advances deterministic rival values and rejects non-finite rows', () => {
  const ranked = rankGameLeaderboard(
    [
      { name: 'Steady', value: 139_000_000, dailyChange: 1_000_000 },
      { name: 'Flat', value: 141_000_000, dailyChange: 0 },
      { name: 'Broken', value: Number.NaN, dailyChange: 0 },
    ],
    142_000_000,
    2,
  );

  assert.deepEqual(ranked.map((entry) => entry.name), ['You', 'Steady', 'Flat']);
  assert.deepEqual(ranked.map((entry) => entry.rank), [1, 2, 3]);
  assert.equal(ranked[1].value, 141_000_000);
  assert.equal(ranked[0].returnPct, (142_000_000 / STARTING_CASH - 1) * 100);
});
