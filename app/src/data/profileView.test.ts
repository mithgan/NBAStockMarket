import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameSettledResult } from '../api/contracts';
import {
  chartSummary,
  formVerdict,
  gameLog,
  holdingStatus,
  isRecentRange,
  lastSeasonFacts,
  nightIndexAt,
  nightReadout,
  nightsFromResults,
  nightsFromTrends,
  priceStory,
  profileChartModel,
  rangeNights,
  summarizeNights,
  type ProfileNight,
} from './profileView';
import type { TrendPoint } from './trendPresentation';

const RATE = 40_000;

/** A practice-mode night exactly as the sandbox records it. */
function trend(date: string, np: number, price: number): TrendPoint {
  return {
    date,
    np,
    expected_np: Math.round((price / RATE) * 10) / 10,
    dividend_per_holder: Math.round(np * RATE) - price,
  };
}

test('practice nights recover the exact dividend, price and net in dollars', () => {
  const nights = nightsFromTrends(
    [trend('2025-10-23', 4.2, 101_234), trend('2025-10-22', 1.5, 100_000), trend('2025-10-30', 9, 100_000)],
    RATE,
    '2025-10-25',
  );
  assert.deepEqual(nights, [
    { date: '2025-10-22', dividend: 60_000, price: 100_000, net: -40_000 },
    { date: '2025-10-23', dividend: 168_000, price: 101_234, net: 66_766 },
  ]);
  assert.deepEqual(nightsFromTrends([trend('2025-10-22', 3, 100_000)], RATE, null), []);
});

let cursor = 0;
function result(overrides: Partial<PerGameSettledResult>): PerGameSettledResult {
  cursor += 1;
  return {
    eventCursor: cursor,
    positionId: 'pos-1',
    playerId: 'p1',
    gameId: `g-${cursor}`,
    gameDate: '2025-11-01',
    resultRevision: 1,
    side: 'long',
    kind: 'base',
    status: 'settled',
    lockedGameCost: 100_000,
    dividendDollars: 150_000,
    netPnl: 50_000,
    adjustsResultRevision: null,
    ...overrides,
  };
}

test('account nights are exact, count a correction once, and skip DNP and unsettled nights', () => {
  const base = result({ gameId: 'g-a', gameDate: '2025-11-01', dividendDollars: 150_000 });
  const corrected = result({ gameId: 'g-a', gameDate: '2025-11-01', resultRevision: 2, kind: 'correction', dividendDollars: 90_000, netPnl: -10_000 });
  const dnp = result({ gameId: 'g-b', gameDate: '2025-11-02', status: 'verified_dnp', dividendDollars: 0, netPnl: 0 });
  const unsettled = result({ gameId: 'g-c', gameDate: '2025-11-03', status: 'unsettled', dividendDollars: null, netPnl: null });
  const shortNight = result({ gameId: 'g-d', gameDate: '2025-11-04', side: 'short', positionId: 'pos-2', lockedGameCost: 120_000, dividendDollars: 80_000, netPnl: 40_000 });
  assert.deepEqual(nightsFromResults([corrected, base, dnp, unsettled, shortNight]), [
    { date: '2025-11-01', dividend: 90_000, price: 100_000, net: -10_000 },
    // A short night still describes the player: he fell $40K short of his price.
    { date: '2025-11-04', dividend: 80_000, price: 120_000, net: -40_000 },
  ]);
});

const nights: ProfileNight[] = [
  { date: '2025-10-22', dividend: 60_000, price: 100_000, net: -40_000 },
  { date: '2025-10-23', dividend: 180_000, price: 101_000, net: 79_000 },
  { date: '2025-10-25', dividend: 140_000, price: 102_000, net: 38_000 },
  { date: '2025-10-26', dividend: -20_000, price: 103_000, net: -123_000 },
  { date: '2025-10-28', dividend: 400_000, price: 104_000, net: 296_000 },
  { date: '2025-10-29', dividend: 110_000, price: 105_000, net: 5_000 },
];

test('the season summary compares what he paid with what he cost, per game', () => {
  const summary = summarizeNights(nights);
  assert.equal(summary.games, 6);
  assert.equal(summary.beat, 4);
  assert.equal(summary.avgPaid, 145_000);
  assert.equal(summary.avgPrice, 102_500);
  assert.equal(summary.avgNet, 42_500);
  assert.equal(summary.total, 255_000);
  assert.equal(summary.best?.date, '2025-10-28');
  assert.equal(summary.worst?.date, '2025-10-26');
  const none = summarizeNights([]);
  assert.equal(none.avgNet, null);
  assert.equal(none.best, null);
});

test('the verdict is one plain sentence with no percentages', () => {
  assert.equal(
    formVerdict(summarizeNights(nights)),
    'Beat his price in 4 of his 6 games this season, $43K a game ahead on average.',
  );
  assert.equal(
    formVerdict(summarizeNights(nights.slice(-3)), true),
    'Beat his price in 2 of his last 3 games, $59K a game ahead on average.',
  );
  assert.equal(
    formVerdict(summarizeNights(nights.slice(0, 1))),
    'Fell short of his price by $40K in his only game so far.',
  );
  assert.equal(formVerdict(summarizeNights([])), 'No games yet this season.');
  const even = summarizeNights([{ date: '2025-10-22', dividend: 100_200, price: 100_000, net: 200 }, { date: '2025-10-23', dividend: 99_900, price: 100_000, net: -100 }]);
  assert.equal(formVerdict(even), 'Beat his price in 1 of his 2 games this season, about even on average.');
  for (const text of [formVerdict(summarizeNights(nights)), priceStory(nights), chartSummary(nights, 'dividends')]) {
    assert.doesNotMatch(text, /%|paid back|yield|\d{4}-\d{2}-\d{2}|hover|inverse/i);
  }
});

test('ranges keep the latest games, and only a shortened range counts as recent', () => {
  assert.equal(rangeNights(nights, 'L5').length, 5);
  assert.equal(rangeNights(nights, 'L5')[0].date, '2025-10-23');
  assert.equal(rangeNights(nights, 'Season').length, 6);
  assert.equal(isRecentRange('L5', 5, 6), true);
  assert.equal(isRecentRange('L15', 6, 6), false);
  assert.equal(isRecentRange('Season', 6, 6), false);
});

test('price story reads the move in plain words', () => {
  assert.equal(priceStory(nights), 'His price went from $100K to $105K a game over 6 games.');
  assert.equal(priceStory(nights.slice(0, 1)), 'His price held near $100K a game over 1 game.');
  assert.equal(priceStory([]), 'No games yet.');
});

test('holding status names the side and the locked price', () => {
  assert.deepEqual(holdingStatus(null), { tag: null, text: 'Not on your roster or shorted' });
  assert.deepEqual(holdingStatus({ side: 'long', lockedGameCost: 100_000, expiresOn: null }), {
    tag: 'On your roster',
    text: 'Locked in at $100K a game',
  });
  assert.deepEqual(holdingStatus({ side: 'short', lockedGameCost: 237_500, expiresOn: '2025-11-12' }), {
    tag: 'Shorted',
    text: 'Locked in at $238K a game, ends Nov 12',
  });
});

test('last season facts flip the edge for a short and admit a missing season', () => {
  const player = { currentGameCost: 105_000, priorSeasonValuePerGame: 120_000 };
  assert.deepEqual(lastSeasonFacts(player, 'long'), { worth: 120_000, edge: 15_000, edgeCaption: 'a game, for a roster spot' });
  assert.equal(lastSeasonFacts(player, 'short').edge, -15_000);
  assert.deepEqual(lastSeasonFacts({ currentGameCost: 105_000, priorSeasonValuePerGame: null }, 'long').edge, null);
});

test('the game log runs newest first and can be capped', () => {
  assert.deepEqual(gameLog(nights, 2).map((night) => night.date), ['2025-10-29', '2025-10-28']);
  assert.equal(gameLog(nights).length, 6);
});

const INSETS = { top: 22, right: 8, bottom: 20, left: 8 };

test('bars start at $0, the price line spans every slot, and HIGH/LOW mark the extremes', () => {
  const model = profileChartModel(nights, 'dividends', 316, 180, INSETS);
  assert.equal(model.bars.length, 6);
  assert.equal(model.slot, 50);
  assert.ok(model.zeroY !== null);
  const zero = model.zeroY as number;
  // A positive night rises from the zero line; the negative one hangs below it.
  assert.ok(Math.abs(model.bars[1].y + model.bars[1].height - zero) < 0.001);
  assert.ok(Math.abs(model.bars[3].y - zero) < 0.001);
  assert.equal(model.high, 4);
  assert.equal(model.low, 3);
  // Every bar sits inside the plot.
  for (const bar of model.bars) {
    assert.ok(bar.x >= INSETS.left && bar.x + bar.width <= 316 - INSETS.right + 0.001);
    assert.ok(bar.y >= INSETS.top - 0.001 && bar.y + bar.height <= 180 - INSETS.bottom + 0.001);
  }
  assert.match(model.priceStepPath, /^M 8 /);
  assert.equal(model.priceStepPath.split('L').length - 1, 6 * 2 - 1);
});

test('the price view plots his price, and few or flat nights get no HIGH/LOW labels', () => {
  const model = profileChartModel(nights, 'price', 316, 180, INSETS);
  assert.equal(model.bars.length, 0);
  assert.equal(model.anchors.length, 6);
  assert.ok(model.anchors[0].y > model.anchors[5].y, 'a rising price draws upward');
  assert.equal(profileChartModel(nights.slice(0, 4), 'dividends', 316, 180, INSETS).high, null);
  const flat = nights.map((night) => ({ ...night, price: 100_000 }));
  assert.equal(profileChartModel(flat, 'price', 316, 180, INSETS).high, null);
  assert.deepEqual(profileChartModel([], 'dividends', 316, 180, INSETS).bars, []);
});

test('a pointer reads the night under it, clamped to the plot', () => {
  assert.equal(nightIndexAt(8, 50, 8, 6), 0);
  assert.equal(nightIndexAt(160, 50, 8, 6), 3);
  assert.equal(nightIndexAt(-40, 50, 8, 6), 0);
  assert.equal(nightIndexAt(999, 50, 8, 6), 5);
  assert.equal(nightIndexAt(10, 50, 8, 0), null);
});

test('read-outs and summaries use dollars and human dates', () => {
  assert.equal(nightReadout(nights[1], 'dividends'), 'Paid $180K · price $101K · +$79K');
  assert.equal(nightReadout(nights[1], 'price'), 'Price $101K a game');
  assert.match(chartSummary(nights, 'dividends'), /High \$400K on Oct 28, low -\$20K on Oct 26\./);
  assert.equal(chartSummary([], 'price'), 'No games yet.');
});
