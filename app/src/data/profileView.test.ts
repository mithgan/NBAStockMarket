import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameSettledResult } from '../api/contracts';
import { moneyFine } from '../copy/terms';
import { shownEdge } from './marketView';
import { positionValue } from './perGameMetrics';
import {
  buildProfileNights,
  chartDateLabels,
  chartLegend,
  chartSummary,
  defaultRange,
  drawsHollow,
  formVerdict,
  gameLog,
  holdingStatus,
  isRecentRange,
  lastSeasonFacts,
  lastSeasonValue,
  logCaption,
  logPriceHeader,
  logRows,
  logStatusNights,
  missStroke,
  missSwatchHollow,
  mixNote,
  nightIndexAt,
  nightReadout,
  nightSourceLabel,
  openTermsNote,
  priceSourceCaption,
  priceStory,
  profileChartModel,
  profileCloseName,
  profileCloseWord,
  profileSide,
  rangeNights,
  rangeOptions,
  readoutCaption,
  sideNet,
  shortEndsOn,
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
  assert.equal(nightReadout(nights[0], 'dividends', 'short'), 'Dividend -$120K · price $225K · +$345K');
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
  // Both sides say price: a short is credited his price (walk 5 T1-11).
  assert.equal(short.price, 'Price');
  assert.equal(short.netCaption, 'price − dividend');
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
  assert.equal(logPriceHeader(nights.slice(2), 'short'), 'Your price');
  assert.equal(logPriceHeader(nights.slice(0, 2), 'long'), 'Market price');
  assert.equal(nightSourceLabel(nights[0], 'long'), 'market price');
  assert.equal(nightSourceLabel(nights[3], 'short'), 'your price');
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
  assert.equal(priceSourceCaption(summary, 'short'), 'average of your prices');
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
  assert.equal(mixNote(twoPrices, 'short'), 'These 11 games: 2 with you (1 at $169K, 1 at $172.5K), 9 at his market price.');
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
  // All of his games were yours: one tab, and it says so ("With you").
  assert.deepEqual(labels(rangeOptions({ total: 4, yours: 4, room: 'phone' })), ['With you']);
  assert.equal(rangeOptions({ total: 4, yours: 4, room: 'phone' })[0].key, 'Season');
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
  // Held all his games: opens on them (labelled "With you"), matching the header (walk 3 T2-08).
  assert.equal(defaultRange(rangeOptions({ total: 19, yours: 19, room: 'wide' }), true), 'Season');
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
  assert.equal(priceStory(nights.slice(2), 'short'), 'His price went from $102K to $105K a game over 4 games (your locked price).');
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

test('"Short instead" reads the whole profile as a short, as if opened from the Short tab; "Add instead" flips back (walk 4 T1-03, T2-N3)', () => {
  // Opened from the Market's Roster side, not held.
  const opened = profileSide(null, 'long');
  const shortInstead = profileSide(null, 'long', 'short');
  const addInstead = profileSide(null, 'long', 'long');
  assert.equal(opened, 'long');
  assert.equal(shortInstead, 'short');
  assert.equal(shortInstead, profileSide(null, 'short'), 'the side opening him from the Short tab reads');
  assert.equal(addInstead, 'long');
  assert.equal(profileSide(null, 'short', 'long'), 'long', 'Add instead from the Short tab');

  // Last season's value: Duren at $176K, $207.5K a game last season.
  const duren = { currentGameCost: 176_000, priorSeasonValuePerGame: 207_500 };
  assert.deepEqual(lastSeasonFacts(duren, opened), { worth: 207_500, edge: 31_500, edgeCaption: 'a game, against $176K now' });
  assert.deepEqual(lastSeasonFacts(duren, shortInstead), lastSeasonFacts(duren, profileSide(null, 'short')));
  assert.equal(lastSeasonFacts(duren, shortInstead).edge, -31_500, 'red, not a green +$31.5K beside SHORT');
  assert.equal(lastSeasonFacts(duren, shortInstead).edgeCaption, 'a game for a short, against $176K now');
  assert.deepEqual(lastSeasonFacts(duren, addInstead), lastSeasonFacts(duren, opened));

  // His games: four at a $400K market price that he mostly missed.
  const trends = [
    trend('2025-10-21', 11.25, 400_000),
    trend('2025-10-23', 2.5, 400_000),
    trend('2025-10-25', 4, 400_000),
    trend('2025-10-27', -0.07, 400_000),
  ];
  const read = (side: 'long' | 'short') => {
    const nights = buildProfileNights({ results: [], trends, dividendRate: RATE, latestSettledDate: '2025-10-27', side });
    const summary = summarizeNights(nights);
    return {
      nets: nights.map((night) => night.net),
      profit: summary.avgNet,
      beat: summary.beat,
      verdict: formVerdict(summary, { side }),
      labels: sideWords(side).beat,
    };
  };
  assert.deepEqual(read(opened), {
    nets: [50_000, -300_000, -240_000, -402_800],
    profit: -223_200,
    beat: 1,
    verdict: 'Beat his price in 1 of his 4 games this season, $223.2K a game behind on average.',
    labels: 'Beat his price',
  });
  assert.deepEqual(read(shortInstead), {
    nets: [-50_000, 300_000, 240_000, 402_800],
    profit: 223_200,
    beat: 3,
    verdict: 'Stayed under his price in 3 of his 4 games this season, $223.2K a game ahead on average for a short.',
    labels: 'Under his price',
  });
  assert.deepEqual(read(shortInstead), read(profileSide(null, 'short')));
  assert.deepEqual(read(addInstead), read(opened));

  // A player you hold reads from the side you hold him on, whatever the tab or switch.
  assert.equal(profileSide({ side: 'long' }, 'short', 'short'), 'long');
  assert.equal(profileSide({ side: 'short' }, 'long', 'long'), 'short');
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
  assert.deepEqual(chartLegend(held, 'dividends', 'short'), { line: 'Your price $125K', yours: null });
  assert.equal(nightReadout(held[2], 'price'), 'Market $128K · your price $125K');
  assert.equal(
    priceStory(held, 'long', 128_500, '2025-10-21'),
    // Only today's price is named "today" (walk-2 T2-19, walk 3 T1-18); the
    // chart's last point differs, and the last line says why.
    'Your price: $125K (locked).\nMarket price: $128.5K today, up from $120K at his first game with you.\nHis market price moves between games too.',
  );
  assert.equal(
    priceStory(held, 'long', 128_000, '2025-10-21'),
    'Your price: $125K (locked).\nMarket price: $128K today, up from $120K at his first game with you.',
  );
  const steady = held.map((night, index) => ({ ...night, market: 128_000 + index * 150 }));
  assert.equal(
    priceStory(steady, 'long', 128_300, '2025-10-21'),
    'Your price: $125K (locked).\nMarket price: $128.3K today, up from $128K at his first game with you.',
  );
  assert.equal(priceStory(held, 'short'), 'You locked $125K. Over these 3 games his market price went from $120K to $128K.');
  assert.equal(
    priceStory(held.slice(1), 'long', 99_700, '2025-10-21'),
    'Your price: $125K (locked).\nMarket price: $99.7K today, down from $124K at his Oct 22 game.\nHis market price moves between games too.',
  );
  assert.equal(priceStory(held.slice(0, 1), 'short'), 'You locked $125K. His market price was $120K in that game.');
  assert.match(chartSummary(held, 'price'), /^His market price a game over 3 games, against your locked price\. High \$128K/);
  // Outside practice there is no market line: your price is the one line.
  const live = held.map(({ market: _market, ...night }) => night);
  assert.deepEqual(chartLegend(live, 'price'), { line: 'Your price $125K', yours: null });
  assert.equal(profileChartModel(live, 'price', 316, 180, INSETS).yourPricePath, '');
  // Equal high and low are not read out (walk-1 T2-33).
  assert.equal(chartSummary(live, 'price'), 'His price a game over 3 games.');
});

test('the Price view is short lines, and up or down compares today with the first game (walk 4 T2-05, T1-22)', () => {
  const night = (date: string, market: number, price: number, source: 'yours' | 'market' = 'yours'): ProfileNight => ({
    date, dividend: 150_000, price, net: 150_000 - price, source, market,
  });
  // T2-05, Luka: $418.5K at his first game with you, $419.8K after his last, $417.6K today: down, not "rose".
  const luka = [night('2025-10-21', 418_500, 417_500), night('2025-10-23', 419_000, 417_500), night('2025-10-26', 419_800, 417_500)];
  assert.equal(
    priceStory(luka, 'long', 417_600, '2025-10-21'),
    'Your price: $417.5K (locked).\nMarket price: $417.6K today, down from $418.5K at his first game with you.\nHis market price moves between games too.',
  );
  // T1-22, Barnes: one price a line, today's against the first game's, no third "after his game" price.
  const barnes = [night('2025-10-22', 259_600, 259_000), night('2025-10-30', 251_000, 259_000), night('2025-11-02', 248_900, 259_000)];
  const story = priceStory(barnes, 'long', 252_600, '2025-10-22');
  assert.equal(story, 'Your price: $259K (locked).\nMarket price: $252.6K today, down from $259.6K at his first game with you.\nHis market price moves between games too.');
  assert.doesNotMatch(story, /\$248\.9K|rose|fell|;/);
  // Today where he started: said plainly, and no between-games line when today is his last game's price.
  assert.equal(
    priceStory([night('2025-10-22', 250_000, 250_000), night('2025-10-24', 250_000, 250_000)], 'long', 250_000, '2025-10-22'),
    'Your price: $250K (locked).\nMarket price: $250K today, the same as at his first game with you.',
  );
  // A short reads his price too (walk 5 T1-11); two stints name both prices.
  assert.equal(
    priceStory([night('2025-10-22', 230_000, 225_000)], 'short', 236_000, '2025-10-22'),
    'Your price: $225K (locked).\nMarket price: $236K today, up from $230K at his first game with you.\nHis market price moves between games too.',
  );
  assert.equal(
    priceStory([night('2025-10-22', 101_000, 100_000), night('2025-10-24', 104_000, 104_300)], 'long', 104_000, '2025-10-22').split('\n')[0],
    'Your prices: 1 at $100K, 1 at $104.3K (locked).',
  );
  // Not yours: only his market price, from the first game shown.
  assert.equal(
    priceStory([night('2025-11-30', 112_000, 112_000, 'market'), night('2025-12-02', 113_000, 113_000, 'market')], 'long', 113_000, null),
    'Market price: $113K today, up from $112K at his Nov 30 game.',
  );
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
  assert.equal(nightReadout(nights[1], 'price', 'short'), 'Price $101K a game');
  assert.match(chartSummary(nights, 'dividends'), /High \$400K on Oct 28, low -\$20K on Oct 26\./);
  const shortNights = nights.map((night) => ({ ...night, net: sideNet('short', night.dividend, night.price) }));
  assert.match(chartSummary(shortNights, 'dividends', 'short'), /stayed under his price in 2 of them, which is what a short wants/);
  assert.equal(chartSummary([], 'price'), 'No games yet.');
});

test('the chart read-out is captioned as a sentence, not three labels (walk 3 T1-18)', async () => {
  const { readoutCaption } = await import('./profileView');
  const yours = { date: '2025-10-27', source: 'yours' as const };
  const market = { date: '2025-10-24', source: 'market' as const };
  assert.equal(readoutCaption(yours, 'dividends', 'long', true), 'Latest game, Oct 27, against your price');
  assert.equal(readoutCaption(yours, 'dividends', 'short', false), 'Oct 27 game, against your price');
  assert.equal(readoutCaption(market, 'dividends', 'long', false), 'Oct 24 game, against his market price');
  assert.equal(readoutCaption(yours, 'price', 'long', true), 'Latest game, Oct 27, against your price');
  // A game at his market price in the Price view has nothing to set against it.
  assert.equal(readoutCaption(market, 'price', 'long', true), 'Latest game, Oct 24, his market price');
});

test("a held player's value is measured against the price you locked, like the Roster (walk 5 T4-02)", () => {
  // Doncic: $488.5K a game last season, added at $417.5K; your own add and a week moved him to $431.5K.
  const doncic = { currentGameCost: 431_500, priorSeasonValuePerGame: 488_500 };
  const held = lastSeasonValue(doncic, 'long', { side: 'long', lockedGameCost: 417_500 });
  assert.deepEqual(held, {
    worth: 488_500,
    edge: 71_000,
    label: 'Value at your price',
    caption: 'a game, against your $417.5K (now $431.5K)',
  });
  // The same +$71K the Market row showed before the add ("$71K over his price"), not +$57K at today's price.
  assert.equal(lastYearEdgeAtToday(doncic), 57_000);
  // Today's price only joins the caption once it reads differently from yours.
  assert.equal(
    lastSeasonValue({ currentGameCost: 417_540, priorSeasonValuePerGame: 488_500 }, 'long', { side: 'long', lockedGameCost: 417_500 }).caption,
    'a game, against your $417.5K',
  );
  // A short you hold: your locked price against what he paid out.
  const short = lastSeasonValue({ currentGameCost: 331_000, priorSeasonValuePerGame: 300_000 }, 'short', { side: 'short', lockedGameCost: 329_200 });
  assert.equal(short.edge, 29_200);
  assert.equal(short.label, 'Value at your price');
  assert.equal(short.caption, 'a game for your short, against your $329.2K (now $331K)');
  // No last season: nothing to measure, held or not.
  assert.equal(lastSeasonValue({ currentGameCost: 100_000, priorSeasonValuePerGame: null }, 'long', { side: 'long', lockedGameCost: 99_000 }).edge, null);
  // The Market's rule, to the dollar: printed dividend minus printed locked price
  // ($488.5K − $417.5K = +$71K even when the raw figures carry odd dollars).
  const odd = lastSeasonValue({ currentGameCost: 431_512, priorSeasonValuePerGame: 488_537 }, 'long', { side: 'long', lockedGameCost: 417_468 });
  assert.equal(odd.edge, 71_000);
  assert.equal(odd.edge, shownEdge({ currentGameCost: 417_468, priorSeasonValuePerGame: 488_537 }, 'long'));
  assert.equal(lastSeasonValue({ currentGameCost: 331_000, priorSeasonValuePerGame: 300_000 }, 'short').edge, shownEdge({ currentGameCost: 331_000, priorSeasonValuePerGame: 300_000 }, 'short'));
});

test('a player you do not hold reads at today\'s price, and "Short instead" still flips it (walk 4 D1)', () => {
  const duren = { currentGameCost: 176_000, priorSeasonValuePerGame: 207_500 };
  assert.deepEqual(lastSeasonValue(duren, profileSide(null, 'long')), {
    worth: 207_500,
    edge: 31_500,
    label: "Value at today's price",
    caption: 'a game, against $176K now',
  });
  const flipped = lastSeasonValue(duren, profileSide(null, 'long', 'short'));
  assert.equal(flipped.edge, -31_500);
  assert.equal(flipped.label, "Value at today's price");
  assert.equal(flipped.caption, 'a game for a short, against $176K now');
  assert.equal(lastSeasonValue(duren, profileSide(null, 'long', 'long')).edge, 31_500, 'Add instead flips back');
  // Only a position on the side read counts as "your price".
  assert.equal(lastSeasonValue(duren, 'long', { side: 'short', lockedGameCost: 150_000 }).label, "Value at today's price");
});

function lastYearEdgeAtToday(player: { currentGameCost: number; priorSeasonValuePerGame: number }): number {
  return player.priorSeasonValuePerGame - player.currentGameCost;
}

test('a short speaks of his price, never a "credit" or "market credit" of its own (walk 5 T1-11)', () => {
  const nights: ProfileNight[] = [
    { date: '2025-10-21', dividend: 120_000, price: 125_000, net: 5_000, source: 'yours', market: 121_000 },
    { date: '2025-10-22', dividend: 90_000, price: 125_000, net: 35_000, source: 'yours', market: 124_000 },
    { date: '2025-10-24', dividend: 150_000, price: 128_000, net: -22_000, source: 'market', market: 128_000 },
  ];
  const words = sideWords('short');
  const texts = [
    words.price, words.priceShort, words.netCaption, words.beat, words.legendGood, words.legendBad, words.legendLine,
    words.missedCaption(2),
    priceSourceCaption(summarizeNights(nights), 'short'),
    priceSourceCaption(summarizeNights(nights.slice(2)), 'short'),
    mixNote(nights, 'short') ?? '',
    logPriceHeader(nights, 'short'),
    logPriceHeader(nights.slice(2), 'short'),
    ...nights.flatMap((night) => [
      readoutCaption(night, 'dividends', 'short', true),
      readoutCaption(night, 'price', 'short', false),
      nightReadout(night, 'dividends', 'short'),
      nightReadout(night, 'price', 'short'),
      nightSourceLabel(night, 'short'),
    ]),
    priceStory(nights, 'short', 130_000, nights[0].date),
    priceStory(nights.slice(2), 'short'),
    chartSummary(nights, 'price', 'short'),
    chartSummary(nights, 'dividends', 'short'),
    chartLegend(nights, 'price', 'short').line,
    chartLegend(nights, 'price', 'short').yours ?? '',
    chartLegend(nights, 'dividends', 'short').line,
    lastSeasonValue({ currentGameCost: 331_000, priorSeasonValuePerGame: 300_000 }, 'short').caption,
  ];
  for (const text of texts) assert.doesNotMatch(text, /credit/i, text);
  // The chart caption and legend the tester read, now in price words.
  assert.equal(readoutCaption(nights[2], 'dividends', 'short', true), 'Latest game, Oct 24, against his market price');
  assert.equal(chartLegend(nights.slice(2), 'dividends', 'short').line, 'His market price');
});

test('the Price view names its high and low price on a scale, like the Score chart (walk 5 T2-08)', () => {
  // Doncic, locked at $417.5K; his market price climbs from $418.5K to $431.5K.
  const nights: ProfileNight[] = [
    { date: '2025-10-21', dividend: 500_000, price: 417_500, net: 82_500, source: 'yours', market: 418_500 },
    { date: '2025-10-22', dividend: 400_000, price: 417_500, net: -17_500, source: 'yours', market: 424_900 },
    { date: '2025-10-24', dividend: 450_000, price: 417_500, net: 32_500, source: 'yours', market: 431_500 },
  ];
  const insets = { top: 12, right: 6, bottom: 12, left: 52 };
  const model = profileChartModel(nights, 'price', 300, 176, insets);
  assert.deepEqual(model.priceMarks.map((mark) => [mark.kind, mark.value]), [['high', 431_500], ['low', 417_500]]);
  const [high, low] = model.priceMarks;
  assert.ok(high.y < low.y, 'the high sits above the low');
  assert.ok(high.y >= insets.top && low.y <= 176 - insets.bottom, 'both inside the plot');
  assert.equal(high.y, model.anchors[2].y, 'the high mark is level with his top point');
  // Three games already get a scale (the old in-plot labels waited for five).
  assert.equal(model.high, null);
  // A flat price has one mark; the dividends view has none.
  const flat = profileChartModel(nights.map((night) => ({ ...night, market: 417_500 })), 'price', 300, 176, insets);
  assert.equal(flat.priceMarks.length, 1);
  assert.equal(profileChartModel(nights, 'dividends', 300, 176, insets).priceMarks.length, 0);
  // Far apart, each mark's words sit on its line.
  assert.equal(high.labelY, high.y);
  assert.equal(low.labelY, low.y);
  // One game: market $418.5K against your $417.5K draws two close lines; their words step apart.
  const close = profileChartModel(nights.slice(0, 1), 'price', 300, 176, insets).priceMarks;
  assert.deepEqual(close.map((mark) => mark.value), [418_500, 417_500]);
  assert.ok(close[1].y - close[0].y < 16, 'the lines are close');
  assert.ok(close[1].labelY - close[0].labelY >= 16, 'the words do not overlap');
  assert.ok(close[0].labelY >= 7 && close[1].labelY <= 176 - 7);
});

test('chart dates sit under their game, and a lone game gets its date under its bar (walk 5 T2-15)', () => {
  const one: ProfileNight[] = [{ date: '2025-10-21', dividend: 56_000, price: 371_000, net: -315_000, source: 'yours' }];
  const model = profileChartModel(one, 'dividends', 300, 176, { top: 22, right: 6, bottom: 20, left: 6 });
  const [only] = chartDateLabels(model.anchors.map((point) => point.x), 300, 64);
  assert.equal(only.align, 'center');
  assert.equal(only.left + 32, model.anchors[0].x, 'centred on the bar, not at the left edge');
  // Many games: the first and the latest, hung from the chart's edges.
  const xs = Array.from({ length: 20 }, (_, index) => 6 + (index + 0.5) * 14.4);
  assert.deepEqual(chartDateLabels(xs, 300, 64).map((label) => [label.index, label.align]), [[0, 'left'], [19, 'right']]);
  // Two games far apart: each date centred under its own bar.
  assert.deepEqual(chartDateLabels([78, 222], 300, 64).map((label) => [label.index, label.align, label.left]), [[0, 'center', 46], [1, 'center', 190]]);
  // Too close for both: the latest keeps its date.
  assert.deepEqual(chartDateLabels([100, 120], 300, 64).map((label) => label.index), [1]);
  assert.deepEqual(chartDateLabels([], 300, 64), []);
});

test('the profile names what its Drop or Close button ends, and the spoken name starts with those words (walk 6 T2-04)', () => {
  assert.equal(profileCloseWord('short'), 'Close short');
  assert.equal(profileCloseWord('long'), 'Drop player');
  assert.equal(profileCloseName('short', 'Luka Doncic'), 'Close short on Luka Doncic');
  assert.equal(profileCloseName('long', 'Luka Doncic'), 'Drop player Luka Doncic');
  for (const side of ['long', 'short'] as const) {
    assert.ok(profileCloseName(side, 'Luka Doncic').startsWith(profileCloseWord(side)));
  }
});

test('a short says how long it runs and the day it ends by itself before you pay (walk 6 T1-11)', () => {
  // Starts with the next night of games and lasts the term: the Roster's "Ends Oct 27".
  assert.equal(shortEndsOn('2025-10-21', 7), '2025-10-27');
  assert.equal(shortEndsOn('2025-10-28', 7), '2025-11-03');
  assert.equal(shortEndsOn('2025-10-21', 1), '2025-10-21');
  assert.equal(shortEndsOn(null, 7), null);
  assert.equal(shortEndsOn('2025-10-21', null), null);
  const base = { priceDollars: 176_000, feeDollars: 250, shortTermDays: 7, nextGameDate: '2025-10-21' };
  assert.equal(
    openTermsNote({ ...base, side: 'short' }),
    'Locks his price at $176K a game for 7 days (ends Oct 27 by itself) · $250 fee',
  );
  // The roster side has no term: unchanged.
  assert.equal(openTermsNote({ ...base, side: 'long' }), 'Locks his price at $176K a game · $250 fee');
  // Across a month, one day, no next night known, no term, no fee.
  assert.match(openTermsNote({ ...base, side: 'short', nextGameDate: '2025-10-28' }), /ends Nov 3 by itself/);
  assert.match(openTermsNote({ ...base, side: 'short', shortTermDays: 1 }), /for 1 day \(ends Oct 21 by itself\)/);
  assert.equal(
    openTermsNote({ ...base, side: 'short', nextGameDate: null }),
    'Locks his price at $176K a game for 7 days, then ends by itself · $250 fee',
  );
  assert.equal(openTermsNote({ ...base, side: 'short', shortTermDays: null }), 'Locks his price at $176K a game · $250 fee');
  assert.equal(openTermsNote({ ...base, side: 'short', feeDollars: 0 }), 'Locks his price at $176K a game for 7 days (ends Oct 27 by itself)');
});

test('the legend draws "Missed his price" the way the bars are drawn, at every width (walk 6 T1-09)', () => {
  const nights: ProfileNight[] = Array.from({ length: 82 }, (_, index) => {
    const dividend = 100_000 + (index % 2 === 0 ? 50_000 : -50_000);
    const date = new Date(Date.UTC(2025, 9, 21 + index * 2)).toISOString().slice(0, 10);
    return { date, dividend, price: 100_000, net: dividend - 100_000, source: 'market' };
  });
  const insets = { top: 22, right: 6, bottom: 20, left: 6 };
  // A whole season on a phone: about 3px a bar, too narrow for an outline, so every miss is solid and so is the swatch.
  const phone = profileChartModel(nights, 'dividends', 358, 180, insets);
  assert.ok(phone.bars.every((bar) => bar.width < 4));
  assert.ok(phone.bars.every((bar) => !drawsHollow(bar)));
  assert.equal(missSwatchHollow(phone.bars), false);
  // The same season in the desktop panel: hollow bars, hollow swatch.
  const desk = profileChartModel(nights, 'dividends', 560, 220, insets);
  assert.ok(desk.bars.some((bar) => drawsHollow(bar)));
  assert.equal(missSwatchHollow(desk.bars), true);
  // A week on a phone: wide bars, hollow.
  const week = profileChartModel(nights.slice(0, 4), 'dividends', 358, 180, insets);
  assert.equal(missSwatchHollow(week.bars), true);
  // A narrow bar keeps a dark centre: 1px outline under 6px, 1.5px from 6px.
  assert.equal(missStroke(4), 1);
  assert.equal(missStroke(5.9), 1);
  assert.equal(missStroke(6), 1.5);
  assert.equal(drawsHollow({ width: 4, height: 3 }), false);
});
