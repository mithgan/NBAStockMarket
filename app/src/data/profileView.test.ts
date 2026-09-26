import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameSettledResult } from '../api/contracts';
import { moneyFine } from '../copy/terms';
import { positionValue } from './perGameMetrics';
import {
  buildProfileNights,
  chartLegend,
  chartSummary,
  defaultRange,
  formVerdict,
  gameLog,
  holdingStatus,
  isRecentRange,
  lastSeasonFacts,
  logCaption,
  logPriceHeader,
  logRows,
  logStatusNights,
  mixNote,
  nightIndexAt,
  nightReadout,
  nightSourceLabel,
  priceSourceCaption,
  priceStory,
  profileChartModel,
  rangeNights,
  rangeOptions,
  sideNet,
  sideWords,
  pastStintLead,
  positionOpenedDay,
  stakeLine,
  statusNights,
  steppedIndex,
  summarizeNights,
  unsettledNote,
  type ProfileNight,
} from './profileView';
import type { TrendPoint } from './trendPresentation';

const RATE = 40_000;

/** A practice-mode night exactly as the sandbox records it: market price that night. */
function trend(date: string, np: number, price: number): TrendPoint {
  return {
    date,
    np,
    expected_np: Math.round((price / RATE) * 10) / 10,
    dividend_per_holder: Math.round(np * RATE) - price,
  };
}

let cursor = 0;
function result(overrides: Partial<PerGameSettledResult>): PerGameSettledResult {
  cursor += 1;
  const side = overrides.side ?? 'long';
  const cost = overrides.lockedGameCost ?? 100_000;
  const dividend = overrides.dividendDollars === undefined ? 150_000 : overrides.dividendDollars;
  return {
    eventCursor: cursor,
    positionId: 'pos-1',
    playerId: 'p1',
    gameId: `g-${cursor}`,
    gameDate: '2025-11-01',
    resultRevision: 1,
    side,
    kind: 'base',
    status: 'settled',
    lockedGameCost: cost,
    dividendDollars: dividend,
    netPnl: dividend === null ? null : side === 'long' ? dividend - cost : cost - dividend,
    adjustsResultRevision: null,
    ...overrides,
  };
}

test('a night nets dividend minus price on a roster and price minus dividend on a short', () => {
  assert.equal(sideNet('long', 150_000, 100_000), 50_000);
  assert.equal(sideNet('short', 150_000, 100_000), -50_000);
  assert.equal(sideNet('short', -120_000, 225_000), 345_000);
});

test('nights you held him use your locked price; the rest are his market price that night', () => {
  const trends = [
    trend('2025-10-22', 4, 101_000),
    trend('2025-10-23', 2.5, 102_000),
    trend('2025-10-25', 8.2, 104_000),
  ];
  // You added him after Oct 22 at a locked $100K.
  const mine = [
    result({ gameDate: '2025-10-23', lockedGameCost: 100_000, dividendDollars: 100_000 }),
    result({ gameDate: '2025-10-25', lockedGameCost: 100_000, dividendDollars: 328_000 }),
  ];
  const nights = buildProfileNights({ results: mine, trends, dividendRate: RATE, latestSettledDate: '2025-10-25', side: 'long' });
  // Every night also carries his market price, yours included (walk-1 T2-33).
  assert.deepEqual(nights, [
    { date: '2025-10-22', dividend: 160_000, price: 101_000, net: 59_000, source: 'market', market: 101_000 },
    { date: '2025-10-23', dividend: 100_000, price: 100_000, net: 0, source: 'yours', market: 102_000 },
    { date: '2025-10-25', dividend: 328_000, price: 100_000, net: 228_000, source: 'yours', market: 104_000 },
  ]);
});

test('an owned player all season matches his roster row to the dollar (one net a game on the sheet)', () => {
  // Grader BIG-2: the profile priced Jokic at the market ($102K avg) while
  // Roster and Results used his locked $100K.
  const trends = [trend('2025-10-21', 7.4, 100_000), trend('2025-10-22', 3, 101_500), trend('2025-11-05', 8.1, 104_000)];
  const mine = [
    result({ gameDate: '2025-10-21', dividendDollars: 296_000 }),
    result({ gameDate: '2025-10-22', dividendDollars: 120_000 }),
    result({ gameDate: '2025-11-05', dividendDollars: 324_000 }),
  ];
  const nights = buildProfileNights({ results: mine, trends, dividendRate: RATE, latestSettledDate: '2025-11-05', side: 'long' });
  const summary = summarizeNights(nights);
  const roster = positionValue(mine, 'pos-1');
  assert.equal(summary.avgNet, roster.avgNet);
  assert.equal(summary.total, roster.total);
  assert.equal(summary.avgPrice, 100_000);
  assert.equal(summary.yours, 3);
  assert.equal(nights[2].net, 224_000, 'Nov 5 at the locked price, as Results shows it');
});

test('a short reads from the short: the grader SGA case is +$126K a game, best Oct 25, worst Oct 21', () => {
  const shortResults = [
    result({ side: 'short', positionId: 'pos-s', gameDate: '2025-10-21', lockedGameCost: 112_500, dividendDollars: 328_000 }),
    result({ side: 'short', positionId: 'pos-s', gameDate: '2025-10-23', lockedGameCost: 112_500, dividendDollars: -48_500 }),
    result({ side: 'short', positionId: 'pos-s', gameDate: '2025-10-25', lockedGameCost: 112_500, dividendDollars: -320_000 }),
  ];
  const trends = [trend('2025-10-21', 8.2, 112_500), trend('2025-10-23', -1.2, 113_000), trend('2025-10-25', -8, 114_000)];
  const nights = buildProfileNights({ results: shortResults, trends, dividendRate: RATE, latestSettledDate: '2025-10-25', side: 'short' });
  assert.deepEqual(nights.map((night) => night.net), [-215_500, 161_000, 432_500]);
  const summary = summarizeNights(nights);
  assert.equal(summary.total, 378_000);
  assert.equal(summary.avgNet, 126_000);
  assert.equal(summary.beat, 2);
  assert.equal(summary.best?.date, '2025-10-25');
  assert.equal(summary.worst?.date, '2025-10-21');
  assert.equal(summary.avgNet, positionValue(shortResults, 'pos-s').avgNet, 'matches the Shorts row');
  assert.equal(
    formVerdict(summary, { side: 'short', held: true }),
    'Stayed under his price in 2 of his 3 games this season, $126K a game ahead on average for your short.',
  );
  // Green means a gain for the reader: every bar colour follows the short's net.
  assert.deepEqual(nights.map((night) => night.net > 0), [false, true, true]);
});

test('a negative dividend is a winning short (grader B3: Maxey at $225K, dividend -$120K)', () => {
  const maxey = [result({ side: 'short', gameDate: '2025-10-21', lockedGameCost: 225_000, dividendDollars: -120_000 })];
  const nights = buildProfileNights({ results: maxey, trends: [], dividendRate: RATE, latestSettledDate: '2025-10-21', side: 'short' });
  const summary = summarizeNights(nights);
  assert.equal(summary.avgNet, 345_000);
  assert.equal(summary.best?.net, 345_000);
  assert.equal(formVerdict(summary, { side: 'short', held: true }), 'Stayed under his price by $345K in his only game so far.');
  assert.equal(nightReadout(nights[0], 'dividends', 'short'), 'Dividend -$120K · credit $225K · +$345K');
});

test('outside practice the nights are your results; the other side counts as market nights', () => {
  const mixed = [
    result({ gameDate: '2025-10-21', dividendDollars: 150_000 }),
    result({ side: 'short', positionId: 'pos-2', gameDate: '2025-10-24', lockedGameCost: 120_000, dividendDollars: 80_000 }),
  ];
  const nights = buildProfileNights({ results: mixed, trends: undefined, dividendRate: RATE, latestSettledDate: null, side: 'long' });
  assert.deepEqual(nights, [
    { date: '2025-10-21', dividend: 150_000, price: 100_000, net: 50_000, source: 'yours' },
    { date: '2025-10-24', dividend: 80_000, price: 120_000, net: -40_000, source: 'market' },
  ]);
  assert.deepEqual(buildProfileNights({ results: [], trends: undefined, dividendRate: RATE, latestSettledDate: null, side: 'long' }), []);
  assert.equal(formVerdict(summarizeNights([]), { scope: 'yours' }), 'No games with you yet.');
});

test('a correction counts once; did-not-play, unsettled and unsettled-dated nights are skipped', () => {
  const base = result({ gameId: 'g-a', gameDate: '2025-11-01', dividendDollars: 150_000 });
  const corrected = result({ gameId: 'g-a', gameDate: '2025-11-01', resultRevision: 2, kind: 'correction', dividendDollars: 90_000, netPnl: -10_000 });
  const dnp = result({ gameId: 'g-b', gameDate: '2025-11-02', status: 'verified_dnp', dividendDollars: 0, netPnl: 0 });
  const unsettled = result({ gameId: 'g-c', gameDate: '2025-11-03', status: 'unsettled', dividendDollars: null, netPnl: null });
  const future = result({ gameId: 'g-d', gameDate: '2025-11-09', dividendDollars: 150_000 });
  const nights = buildProfileNights({
    results: [corrected, base, dnp, unsettled, future],
    trends: [trend('2025-11-01', 3.75, 100_000), trend('2025-11-09', 5, 100_000)],
    dividendRate: RATE,
    latestSettledDate: '2025-11-05',
    side: 'long',
  });
  assert.deepEqual(nights, [{ date: '2025-11-01', dividend: 90_000, price: 100_000, net: -10_000, source: 'yours', market: 100_000 }]);
});

const nights: ProfileNight[] = [
  { date: '2025-10-22', dividend: 60_000, price: 100_000, net: -40_000, source: 'market' },
  { date: '2025-10-23', dividend: 180_000, price: 101_000, net: 79_000, source: 'market' },
  { date: '2025-10-25', dividend: 140_000, price: 102_000, net: 38_000, source: 'yours' },
  { date: '2025-10-26', dividend: -20_000, price: 103_000, net: -123_000, source: 'yours' },
  { date: '2025-10-28', dividend: 400_000, price: 104_000, net: 296_000, source: 'yours' },
  { date: '2025-10-29', dividend: 110_000, price: 105_000, net: 5_000, source: 'yours' },
];

test('the summary compares his dividend with his price, per game, and counts your nights', () => {
  const summary = summarizeNights(nights);
  assert.equal(summary.games, 6);
  assert.equal(summary.beat, 4);
  assert.equal(summary.avgDividend, 145_000);
  assert.equal(summary.avgPrice, 102_500);
  assert.equal(summary.avgNet, 42_500);
  assert.equal(summary.total, 255_000);
  assert.equal(summary.yours, 4);
  assert.equal(summary.best?.date, '2025-10-28');
  assert.equal(summary.worst?.date, '2025-10-26');
  const none = summarizeNights([]);
  assert.equal(none.avgNet, null);
  assert.equal(none.best, null);
});

test('the verdict is one plain sentence per side, with misses as misses and no percentages', () => {
  assert.equal(
    formVerdict(summarizeNights(nights)),
    'Beat his price in 4 of his 6 games this season, $42.5K a game ahead on average.',
  );
  assert.equal(
    formVerdict(summarizeNights(nights.slice(-3)), { recent: true }),
    'Beat his price in 2 of his last 3 games, $59.3K a game ahead on average.',
  );
  assert.equal(formVerdict(summarizeNights(nights.slice(0, 1))), 'Missed his price by $40K in his only game so far.');
  assert.equal(
    formVerdict(summarizeNights(nights), { scope: 'yours' }),
    'Beat his price in 4 of your 6 games with him, $42.5K a game ahead on average.',
  );
  assert.equal(
    formVerdict(summarizeNights([{ ...nights[0], net: 40_000 }]), { side: 'short' }),
    'Stayed under his price by $40K in his only game so far.',
  );
  assert.equal(
    formVerdict(summarizeNights([{ ...nights[0], net: -40_000 }]), { side: 'short' }),
    'Went over his price by $40K in his only game so far.',
  );
  assert.equal(
    formVerdict(summarizeNights(nights), { side: 'short' }),
    'Stayed under his price in 4 of his 6 games this season, $42.5K a game ahead on average for a short.',
  );
  assert.equal(formVerdict(summarizeNights([])), 'No games yet this season.');
  const even = summarizeNights([
    { date: '2025-10-22', dividend: 100_200, price: 100_000, net: 200, source: 'yours' },
    { date: '2025-10-23', dividend: 99_900, price: 100_000, net: -100, source: 'yours' },
  ]);
  assert.equal(formVerdict(even), 'Beat his price in 1 of his 2 games this season, about even on average.');
  const all = [
    formVerdict(summarizeNights(nights)),
    formVerdict(summarizeNights(nights), { side: 'short' }),
    priceStory(nights),
    chartSummary(nights, 'dividends'),
    chartSummary(nights, 'dividends', 'short'),
    ...nights.map((night) => nightReadout(night, 'dividends')),
    ...nights.map((night) => nightReadout(night, 'dividends', 'short')),
  ];
  for (const text of all) {
    // "Short" only ever names the position; a miss is a miss (grader M4).
    assert.doesNotMatch(text, /%|paid|yield|\d{4}-\d{2}-\d{2}|hover|inverse|fell short|games short|\d short/i);
  }
});

test('labels follow the side, so a short never reads as a roster spot', () => {
  const roster = sideWords('long');
  const short = sideWords('short');
  assert.equal(roster.price, 'Price');
  assert.equal(short.price, 'Credit');
  assert.equal(roster.beat, 'Beat his price');
  assert.equal(short.beat, 'Under his price');
  assert.equal(roster.missedCaption(3), 'missed 3');
  assert.equal(short.missedCaption(1), 'over 1');
  assert.equal(roster.missedCaption(0), 'no misses');
  assert.equal(short.missedCaption(0), 'never over');
  assert.equal(roster.legendBad, 'Missed his price');
  assert.equal(short.legendGood, 'Under his price');
  assert.equal(short.legendBad, 'Over his price');
});

test('the price is labelled by where it came from', () => {
  assert.equal(priceSourceCaption({ games: 4, yours: 4 }, 'long'), 'your price');
  assert.equal(priceSourceCaption({ games: 4, yours: 0 }, 'long'), 'his market price');
  assert.equal(priceSourceCaption({ games: 6, yours: 4 }, 'short'), 'yours and market');
  assert.equal(logPriceHeader(nights, 'long'), 'Price');
  assert.equal(logPriceHeader(nights.slice(2), 'long'), 'Your price');
  assert.equal(logPriceHeader(nights.slice(2), 'short'), 'Your credit');
  assert.equal(logPriceHeader(nights.slice(0, 2), 'long'), 'Market price');
  assert.equal(nightSourceLabel(nights[0], 'long'), 'market price');
  assert.equal(nightSourceLabel(nights[3], 'short'), 'your credit');
});

test('after a drop and re-add the price is plainly an average of your two prices (rigor round-3 L-2)', () => {
  // Jokic held for 11 games at $100K, dropped, re-added at $104,250: 12 nights, all yours.
  const stints: ProfileNight[] = [
    ...Array.from({ length: 11 }, (_, index) => ({ date: `2025-10-${21 + index}`, dividend: 150_000, price: 100_000, net: 50_000, source: 'yours' as const })),
    { date: '2025-11-02', dividend: 90_000, price: 104_250, net: -14_250, source: 'yours' },
  ];
  const summary = summarizeNights(stints);
  assert.equal(summary.yourPrices, 2);
  assert.equal(moneyFine(summary.avgPrice ?? 0), '$100.4K');
  assert.equal(priceSourceCaption(summary, 'long'), 'average of your prices', 'never "your price" beside "Locked in at $104.3K"');
  assert.equal(priceSourceCaption(summary, 'short'), 'average of your credits');
  assert.equal(mixNote(stints, 'long'), 'These 12 games were at your prices: 11 at $100K, 1 at $104.3K.');
  assert.equal(priceSourceCaption(summarizeNights(stints.slice(0, 11)), 'long'), 'your price', 'one stint');
  assert.equal(mixNote(stints.slice(0, 11), 'long'), null, 'one stint: the caption says it');
  // Two stints that read the same are one price to the reader.
  const alike = stints.map((night, index) => (index === 11 ? { ...night, price: 100_040 } : night));
  assert.equal(summarizeNights(alike).yourPrices, 1);
  assert.equal(mixNote(alike, 'long'), null);
  // Two stints and market nights: the stints are spelled out inside the mix.
  const withMarket: ProfileNight[] = [
    { date: '2025-10-20', dividend: 120_000, price: 99_000, net: 21_000, source: 'market' },
    ...stints,
  ];
  assert.equal(priceSourceCaption(summarizeNights(withMarket), 'long'), 'yours and market');
  assert.equal(
    mixNote(withMarket, 'long'),
    'These 13 games: 12 with you (11 at $100K, 1 at $104.3K), 1 at his market price.',
  );
});

test('a mixed range says which games were yours and at what price (grader N-S3)', () => {
  assert.equal(mixNote(nights, 'long'), 'These 6 games: 4 with you at $102K to $105K, 2 at his market price.');
  assert.equal(mixNote(nights.slice(2), 'long'), 'These 4 games were at your prices, $102K to $105K.');
  const white: ProfileNight[] = [
    ...Array.from({ length: 9 }, (_, index) => ({ date: `2025-10-${21 + index}`, dividend: 150_000, price: 171_000, net: -21_000, source: 'market' as const })),
    { date: '2025-11-10', dividend: 340_000, price: 169_000, net: 171_000, source: 'yours' },
    { date: '2025-11-12', dividend: 339_600, price: 169_000, net: 170_600, source: 'yours' },
  ];
  assert.equal(mixNote(white, 'long'), 'These 11 games: 2 with you at $169K, 9 at his market price.');
  assert.equal(mixNote(white.slice(9), 'long'), null, 'all yours');
  assert.equal(mixNote(white.slice(0, 9), 'long'), null, 'all market');
  const twoPrices = white.map((night, index) => (index === 10 ? { ...night, price: 172_500 } : night));
  assert.equal(mixNote(twoPrices, 'short'), 'These 11 games: 2 with you (1 at $169K, 1 at $172.5K), 9 at his market credit.');
});

test('did-not-play and unsettled nights keep a line in the log and a note (rigor S-6)', () => {
  const list = [
    result({ gameId: 'a', gameDate: '2025-11-01', dividendDollars: 150_000 }),
    result({ gameId: 'b', gameDate: '2025-11-02', status: 'verified_dnp', dividendDollars: 0, netPnl: 0 }),
    result({ gameId: 'c', gameDate: '2025-11-03', status: 'unsettled', dividendDollars: null, netPnl: null }),
    result({ gameId: 'd', gameDate: '2025-11-04', status: 'unsettled_missing_projection', dividendDollars: null, netPnl: null }),
    result({ gameId: 'e', gameDate: '2025-11-05', side: 'short', positionId: 'pos-2', status: 'verified_dnp', dividendDollars: 0, netPnl: 0 }),
  ];
  assert.deepEqual(statusNights(list, 'long'), [
    { date: '2025-11-02', kind: 'dnp' },
    { date: '2025-11-03', kind: 'pending' },
    { date: '2025-11-04', kind: 'pending' },
  ]);
  assert.deepEqual(statusNights(list, 'short'), [{ date: '2025-11-05', kind: 'dnp' }]);
  const settled = buildProfileNights({ results: list, trends: undefined, dividendRate: RATE, latestSettledDate: null, side: 'long' });
  const rows = logRows(settled, statusNights(list, 'long'));
  assert.deepEqual(rows.map((row) => (row.kind === 'game' ? `game ${row.night.date}` : `${row.kind} ${row.date}`)), [
    'pending 2025-11-04',
    'pending 2025-11-03',
    'dnp 2025-11-02',
    'game 2025-11-01',
  ]);
  assert.equal(logRows(settled, statusNights(list, 'long'), 2).length, 2);
  assert.equal(unsettledNote({ dnp: 1, pending: 2 }), 'Did not play 1 night (nothing charged) · 2 games waiting to settle');
  assert.equal(unsettledNote({ dnp: 2, pending: 0 }), 'Did not play 2 nights (nothing charged)');
  assert.equal(unsettledNote({ dnp: 0, pending: 1 }), '1 game waiting to settle');
  assert.equal(unsettledNote({ dnp: 0, pending: 0 }), null);
});

test('ranges are spelled out, only offered when they narrow his games, and fit 44px tabs (rigor S-5, walk-1 T1-28)', () => {
  const labels = (options: { label: string }[]) => options.map((option) => option.label);
  assert.deepEqual(labels(rangeOptions({ total: 40, yours: 0, room: 'wide' })), ['Last 5', 'Last 15', 'Last 30', 'Season']);
  assert.deepEqual(labels(rangeOptions({ total: 40, yours: 0, room: 'phone' })), ['Last 5', 'Last 15', 'Last 30', 'Season']);
  // One game played: "Last 15" would show that one game, so only Season shows.
  assert.deepEqual(labels(rangeOptions({ total: 1, yours: 0, room: 'phone' })), ['Season']);
  assert.deepEqual(labels(rangeOptions({ total: 10, yours: 0, room: 'phone' })), ['Last 5', 'Season']);
  // Your games get their own tab; the longest recent range makes room for it.
  assert.deepEqual(labels(rangeOptions({ total: 40, yours: 3, room: 'phone' })), ['With you', 'Last 5', 'Last 15', 'Season']);
  assert.deepEqual(labels(rangeOptions({ total: 40, yours: 3, room: 'narrow' })), ['Yours', 'L5', 'All']);
  assert.equal(rangeOptions({ total: 40, yours: 3, room: 'narrow' })[2].key, 'Season');
  // All of his games were yours: "With you" would repeat Season.
  assert.deepEqual(labels(rangeOptions({ total: 4, yours: 4, room: 'phone' })), ['Season']);
});

test('the game log follows the range and says which games it lists (walk-1 T2-36)', () => {
  assert.equal(logCaption('L15', 15, 'season'), 'His last 15 games, newest first.');
  assert.equal(logCaption('Yours', 3, 'season'), 'Your games with him, newest first.');
  assert.equal(logCaption('Season', 32, 'season'), 'Every game this season, newest first.');
  assert.equal(logCaption('Season', 4, 'yours'), 'Your games with him, newest first.');
  const status = [{ date: '2025-10-20', kind: 'dnp' as const }, { date: '2025-10-26', kind: 'pending' as const }];
  const recent = rangeNights(nights, 'L5');
  assert.deepEqual(logStatusNights(status, 'L5', recent).map((night) => night.date), ['2025-10-26']);
  assert.equal(logStatusNights(status, 'Season', recent).length, 2);
});

test('the profile opens on your games when you hold him, else a range that narrows (walk-1 T1-44, T1-28)', () => {
  assert.equal(defaultRange(rangeOptions({ total: 10, yours: 3, room: 'phone' }), true), 'Yours');
  assert.equal(defaultRange(rangeOptions({ total: 10, yours: 3, room: 'phone' }), false), 'Season');
  assert.equal(defaultRange(rangeOptions({ total: 20, yours: 0, room: 'phone' }), false), 'L15');
  assert.equal(defaultRange(rangeOptions({ total: 1, yours: 0, room: 'phone' }), true), 'Season');
  assert.deepEqual(rangeNights(nights, 'Yours').map((night) => night.source), ['yours', 'yours', 'yours', 'yours']);
  assert.equal(isRecentRange('Yours', 4, 6), false);
});

test('ranges keep the latest games, and only a shortened range counts as recent', () => {
  assert.equal(rangeNights(nights, 'L5').length, 5);
  assert.equal(rangeNights(nights, 'L5')[0].date, '2025-10-23');
  assert.equal(rangeNights(nights, 'Season').length, 6);
  assert.equal(isRecentRange('L5', 5, 6), true);
  assert.equal(isRecentRange('L15', 6, 6), false);
  assert.equal(isRecentRange('Season', 6, 6), false);
});

test('price story reads the move in plain words and says when the price was yours', () => {
  assert.equal(priceStory(nights), 'His price went from $100K to $105K a game over 6 games (your locked price in 4).');
  assert.equal(priceStory(nights.slice(0, 1)), 'His price held near $100K a game over 1 game.');
  assert.equal(priceStory(nights.slice(2), 'short'), 'His credit went from $102K to $105K a game over 4 games (your locked credit).');
  assert.equal(priceStory([]), 'No games yet.');
});

test('holding status and stake line say where you stand, from the same numbers as your row', () => {
  assert.deepEqual(holdingStatus(null), { tag: null, text: 'Not on your roster or shorted' });
  assert.deepEqual(holdingStatus({ side: 'long', lockedGameCost: 100_000, expiresOn: null }), {
    tag: 'On your roster',
    text: 'Locked in at $100K a game',
  });
  // The Roster's precision (moneyFine): $112.5K, not $113K (grader N-S2).
  assert.deepEqual(holdingStatus({ side: 'short', lockedGameCost: 112_500, expiresOn: '2025-11-12' }), {
    tag: 'Shorted',
    text: 'Credited $112.5K a game, ends Nov 12',
  });
  assert.deepEqual(stakeLine({ games: 11, total: 1_632_000 }, true), { lead: 'Your roster spot:', total: '+$1.63M over 11 games', tone: 'gain' });
  assert.deepEqual(stakeLine({ games: 3, total: 377_500 }, true)?.total, '+$377.5K over 3 games');
  // A short leads with its own result (walk-1 T1-44).
  assert.deepEqual(stakeLine({ games: 3, total: -699_200 }, true, 'short'), { lead: 'Your short:', total: '-$699.2K over 3 games', tone: 'loss' });
  // No games yet (walk-2 T2-11): since when, and "at this price" only for a re-add.
  assert.deepEqual(stakeLine({ games: 0, total: 0 }, true, 'long', { since: '2025-10-20' }), { lead: 'No games since you added him (Oct 20)', total: null, tone: 'none' });
  assert.equal(stakeLine({ games: 0, total: 0 }, true, 'short', { since: '2025-10-20' })?.lead, 'No games since you shorted him (Oct 20)');
  assert.equal(stakeLine({ games: 0, total: 0 }, true)?.lead, 'No games since you added him');
  assert.deepEqual(stakeLine({ games: 0, total: 0 }, true, 'long', { since: '2025-10-25', readd: true }), { lead: 'No games yet at this price', total: null, tone: 'none' });
  assert.deepEqual(stakeLine({ games: 3, total: -60_000 }, false), { lead: 'Before, with you:', total: '-$60K over 3 games', tone: 'loss' });
  assert.equal(stakeLine({ games: 0, total: 0 }, false), null);
});

test('a past stint is named by side and dates (walk-2 T2-20)', () => {
  const row = (positionId: string, side: 'long' | 'short', gameDate: string) => ({ positionId, side, gameDate });
  assert.equal(pastStintLead([row('s1', 'short', '2025-10-27'), row('s1', 'short', '2025-10-21'), row('s1', 'short', '2025-10-24')]), 'Your short, Oct 21 to 27:');
  assert.equal(pastStintLead([row('l1', 'long', '2025-10-30'), row('l1', 'long', '2025-11-03')]), 'Your roster spot, Oct 30 to Nov 3:');
  assert.equal(pastStintLead([row('l1', 'long', '2025-10-22')]), 'Your roster spot, Oct 22:');
  assert.equal(pastStintLead([row('l1', 'long', '2025-10-22'), row('l2', 'long', '2025-11-02')]), 'Your 2 roster spots, Oct 22 to Nov 2:');
  assert.equal(pastStintLead([row('l1', 'long', '2025-10-22'), row('s1', 'short', '2025-11-02')]), 'With you, Oct 22 to Nov 2:');
  assert.equal(pastStintLead([]), null);
  assert.deepEqual(stakeLine({ games: 3, total: -37_500 }, false, 'long', { past: 'Your short, Oct 21 to 27:' }), { lead: 'Your short, Oct 21 to 27:', total: '-$37.5K over 3 games', tone: 'loss' });
});

test('a position opens on the day its add or short fee was booked', () => {
  const fee = (positionId: string, eventCursor: number, createdAt: string, kind = 'open_fee') => ({
    positionId, eventCursor, createdAt, kind: kind as 'open_fee', gameDate: null,
  });
  const entries = [
    fee('p1', 3, '2025-10-20T23:45:00.000Z'),
    { positionId: 'p1', eventCursor: 9, createdAt: '2025-10-22T23:30:00.000Z', kind: 'game_cost' as const, gameDate: '2025-10-22' },
    fee('p2', 12, '2025-10-25T23:45:00.000Z', 'fee'),
    fee('p2', 20, '2025-10-30T23:45:00.000Z', 'drop_fee'),
  ];
  assert.equal(positionOpenedDay(entries, 'p1'), '2025-10-20');
  assert.equal(positionOpenedDay(entries, 'p2'), '2025-10-25');
  assert.equal(positionOpenedDay(entries, 'p3'), null);
});

test('last season facts flip the edge for a short and admit a missing season', () => {
  const player = { currentGameCost: 105_000, priorSeasonValuePerGame: 120_000 };
  assert.deepEqual(lastSeasonFacts(player, 'long'), { worth: 120_000, edge: 15_000, edgeCaption: 'a game, against $105K now' });
  assert.equal(lastSeasonFacts(player, 'short').edge, -15_000);
  assert.equal(lastSeasonFacts(player, 'short').edgeCaption, 'a game for a short, against $105K now');
  assert.equal(lastSeasonFacts({ currentGameCost: 105_000, priorSeasonValuePerGame: null }, 'long').edge, null);
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
  assert.ok(Math.abs(model.bars[1].y + model.bars[1].height - zero) < 0.001);
  assert.ok(Math.abs(model.bars[3].y - zero) < 0.001);
  assert.equal(model.high, 4);
  assert.equal(model.low, 3);
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

test('the price view plots his market price against your locked price (walk-1 T2-33, T1-29)', () => {
  // Held all along at $125K while his market price rose from $120K to $128K.
  const held: ProfileNight[] = [120_000, 124_000, 128_000].map((market, index) => ({
    date: `2025-10-2${index + 1}`, dividend: 150_000, price: 125_000, net: 25_000, source: 'yours', market,
  }));
  const model = profileChartModel(held, 'price', 316, 180, INSETS);
  assert.ok(model.anchors[0].y > model.anchors[2].y, 'the market line rises, not a flat line of your own price');
  assert.match(model.yourPricePath, /^M /);
  assert.equal(model.high, null, 'three games are too few for HIGH/LOW labels');
  assert.equal(profileChartModel(held, 'dividends', 316, 180, INSETS).yourPricePath, '');
  // Every line carries a label with its value.
  assert.deepEqual(chartLegend(held, 'price'), { line: 'His market price', yours: 'Your price $125K' });
  assert.deepEqual(chartLegend(held, 'dividends'), { line: 'Your price $125K', yours: null });
  assert.deepEqual(chartLegend(held, 'dividends', 'short'), { line: 'Your credit $125K', yours: null });
  assert.equal(nightReadout(held[2], 'price'), 'Market $128K · your price $125K');
  assert.equal(
    priceStory(held, 'long', 128_500),
    // "Today" for the header's price, "in these games" for the chart's points (walk-2 T2-19).
    'Today his market price is $128.5K a game; you locked $125K. In these 3 games it went from $120K to $128K.',
  );
  assert.equal(priceStory(held, 'short'), 'You locked $125K. Over these 3 games his market credit went from $120K to $128K.');
  assert.equal(priceStory(held.slice(0, 1), 'long', 99_700), 'Today his market price is $99.7K a game; you locked $125K. In that game it was $120K.');
  assert.equal(priceStory(held.slice(0, 1), 'short'), 'You locked $125K. His market credit was $120K in that game.');
  assert.match(chartSummary(held, 'price'), /^His market price a game over 3 games, against your locked price\. High \$128K/);
  // Outside practice there is no market line: your price is the one line.
  const live = held.map(({ market: _market, ...night }) => night);
  assert.deepEqual(chartLegend(live, 'price'), { line: 'Your price $125K', yours: null });
  assert.equal(profileChartModel(live, 'price', 316, 180, INSETS).yourPricePath, '');
  // Equal high and low are not read out (walk-1 T2-33).
  assert.equal(chartSummary(live, 'price'), 'His price a game over 3 games.');
});

test('a pointer reads the night under it; arrow keys, Home and End step the slider', () => {
  assert.equal(nightIndexAt(8, 50, 8, 6), 0);
  assert.equal(nightIndexAt(160, 50, 8, 6), 3);
  assert.equal(nightIndexAt(-40, 50, 8, 6), 0);
  assert.equal(nightIndexAt(999, 50, 8, 6), 5);
  assert.equal(nightIndexAt(10, 50, 8, 0), null);
  assert.equal(steppedIndex('ArrowLeft', 3, 6), 2);
  assert.equal(steppedIndex('ArrowLeft', 0, 6), 0);
  assert.equal(steppedIndex('ArrowRight', 5, 6), 5);
  assert.equal(steppedIndex('Home', 4, 6), 0);
  assert.equal(steppedIndex('End', 0, 6), 5);
  assert.equal(steppedIndex('Enter', 2, 6), null);
  assert.equal(steppedIndex('ArrowRight', 0, 0), null);
});

test('read-outs and summaries say Dividend, use human dates, and read naturally below zero', () => {
  assert.equal(nightReadout(nights[1], 'dividends'), 'Dividend $180K · price $101K · +$79K');
  assert.equal(nightReadout(nights[3], 'dividends'), 'Dividend -$20K · price $103K · -$123K');
  // The Results screen's precision: $112.5K, never "$113K" for the same price.
  assert.equal(
    nightReadout({ date: '2025-11-05', dividend: -80_000, price: 112_500, net: -192_500, source: 'yours' }, 'dividends'),
    'Dividend -$80K · price $112.5K · -$192.5K',
  );
  assert.equal(nightReadout(nights[1], 'price'), 'Price $101K a game');
  assert.equal(nightReadout(nights[1], 'price', 'short'), 'Credit $101K a game');
  assert.match(chartSummary(nights, 'dividends'), /High \$400K on Oct 28, low -\$20K on Oct 26\./);
  const shortNights = nights.map((night) => ({ ...night, net: sideNet('short', night.dividend, night.price) }));
  assert.match(chartSummary(shortNights, 'dividends', 'short'), /stayed under his price in 2 of them, which is what a short wants/);
  assert.equal(chartSummary([], 'price'), 'No games yet.');
});
