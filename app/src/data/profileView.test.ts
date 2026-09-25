import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameSettledResult } from '../api/contracts';
import { moneyFine } from '../copy/terms';
import { positionValue } from './perGameMetrics';
import {
  buildProfileNights,
  chartSummary,
  formVerdict,
  gameLog,
  holdingStatus,
  isRecentRange,
  lastSeasonFacts,
  logPriceHeader,
  logRows,
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
  assert.deepEqual(nights, [
    { date: '2025-10-22', dividend: 160_000, price: 101_000, net: 59_000, source: 'market' },
    { date: '2025-10-23', dividend: 100_000, price: 100_000, net: 0, source: 'yours' },
    { date: '2025-10-25', dividend: 328_000, price: 100_000, net: 228_000, source: 'yours' },
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
  assert.deepEqual(nights, [{ date: '2025-11-01', dividend: 90_000, price: 100_000, net: -10_000, source: 'yours' }]);
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
  assert.equal(roster.price, 'Price a game');
  assert.equal(short.price, 'Credit a game');
  assert.equal(roster.beat, 'Beat his price');
  assert.equal(short.beat, 'Under his price');
  assert.equal(roster.missedCaption(3), 'missed 3');
  assert.equal(short.missedCaption(1), 'over 1');
  assert.equal(roster.missedCaption(0), 'every game');
  assert.equal(roster.legendBad, 'Missed his price');
  assert.equal(short.legendGood, 'Under his price');
  assert.equal(short.legendBad, 'Over his price');
});

test('the price is labelled by where it came from', () => {
  assert.equal(priceSourceCaption({ games: 4, yours: 4 }, 'long'), 'your price');
  assert.equal(priceSourceCaption({ games: 4, yours: 0 }, 'long'), 'his market price');
  assert.equal(priceSourceCaption({ games: 6, yours: 4 }, 'short'), 'average of both');
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
  assert.equal(priceSourceCaption(summarizeNights(withMarket), 'long'), 'average of both');
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

test('the Season range reads "All" where four tabs are only 44px wide (rigor S-5)', () => {
  assert.deepEqual(rangeOptions(false).map((option) => option.label), ['L5', 'L15', 'L30', 'Season']);
  assert.deepEqual(rangeOptions(true).map((option) => option.label), ['L5', 'L15', 'L30', 'All']);
  assert.equal(rangeOptions(true)[3].key, 'Season');
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
  assert.deepEqual(stakeLine({ games: 11, total: 1_632_000 }, true), { lead: '11 games with you ·', total: '+$1.63M total', tone: 'gain' });
  assert.deepEqual(stakeLine({ games: 3, total: 377_500 }, true)?.total, '+$377.5K total');
  assert.deepEqual(stakeLine({ games: 0, total: 0 }, true), { lead: 'No games yet at this price', total: null, tone: 'none' });
  assert.deepEqual(stakeLine({ games: 3, total: -60_000 }, false), { lead: 'Before: 3 games with you ·', total: '-$60K total', tone: 'loss' });
  assert.equal(stakeLine({ games: 0, total: 0 }, false), null);
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
