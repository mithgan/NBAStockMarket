import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { parsePerGameBootstrap } from '../api/contracts';
import { signedMoneyFine } from '../copy/terms';
import {
  readyHint,
  chromeLayout,
  daysBetween,
  dividendBasisText,
  dividendText,
  keepTogether,
  lastNightFigure,
  nextGamesText,
  practiceDayText,
  practiceProgress,
  practiceSeasonEnd,
  SEASON_TOTAL_DAYS,
  shortTermText,
  statusSummary,
} from './chromeView';
import { perGameRulesPresentation } from './perGameRules';

const example = JSON.parse(readFileSync(resolve(import.meta.dirname, '../api/fixtures/perGameApiExample.json'), 'utf8'));
const rules = parsePerGameBootstrap(example.bootstrap).ruleset;

const OPENING_EVE = '2025-10-20';

test('the practice clock counts whole days from opening-night eve', () => {
  assert.equal(daysBetween(OPENING_EVE, '2025-11-05'), 16);
  assert.equal(daysBetween(OPENING_EVE, '2025-11-05T23:00:00Z'), 16);
  const progress = practiceProgress(OPENING_EVE, '2025-11-05');
  assert.equal(progress.day, 16);
  assert.equal(progress.total, SEASON_TOTAL_DAYS);
  assert.equal(progress.complete, false);
  assert.equal(progress.fraction, 16 / 174);
  // QA and the reset regression check parse exactly this shape.
  assert.equal(progress.accessibilityLabel, 'Practice progress: day 16 of 174');
  assert.equal(practiceDayText(progress), 'Day 16 of 174');
});

test('the practice clock starts at day 0 and stops at the last night', () => {
  assert.equal(practiceProgress(OPENING_EVE, OPENING_EVE).day, 0);
  assert.equal(practiceProgress(null, '2025-11-05').day, 0);
  assert.equal(practiceProgress(OPENING_EVE, null).day, 0);
  assert.equal(practiceProgress(OPENING_EVE, '2025-10-01').day, 0);
  const last = practiceProgress(OPENING_EVE, '2026-04-12');
  assert.equal(last.day, 174);
  assert.equal(last.complete, true);
  const past = practiceProgress(OPENING_EVE, '2026-05-30');
  assert.equal(past.day, 174);
  assert.equal(past.fraction, 1);
  assert.equal(practiceDayText(past), 'Season complete');
  assert.equal(past.accessibilityLabel, 'Practice progress: day 174 of 174');
});

test('the practice season ends on day 174 of its track', () => {
  // Opening-night eve of 2025-26 plus 174 days: the last day of the regular season.
  assert.equal(practiceSeasonEnd(OPENING_EVE), '2026-04-12');
  assert.equal(daysBetween(OPENING_EVE, practiceSeasonEnd(OPENING_EVE) ?? ''), SEASON_TOTAL_DAYS);
  assert.equal(practiceSeasonEnd(null), null);
  // Settling on the last day is exactly when the shared progress says complete.
  assert.equal(practiceProgress(OPENING_EVE, '2026-04-11').complete, false);
  assert.equal(practiceProgress(OPENING_EVE, practiceSeasonEnd(OPENING_EVE)).complete, true);
});

test('short phrases hold together when large text wraps', () => {
  assert.equal(keepTogether('Day 16 of 174'), 'Day\u00a016\u00a0of\u00a0174');
  assert.equal(keepTogether('Thu, Nov 6'), 'Thu,\u00a0Nov\u00a06');
  assert.equal(keepTogether('Nov 5'), 'Nov\u00a05');
});

test('layout: phones stack two short lines, wide screens use one line, large text wraps', () => {
  const base = {
    wide: false, merged: false, largeText: false, iconOnly: false, narrow: false, compact: false, tightDots: false,
  };
  assert.deepEqual(chromeLayout(390, 1), base);
  // 360px phones take the tighter gutters, so a tag and the lock sentence fit.
  assert.deepEqual(chromeLayout(360, 1), { ...base, iconOnly: true, narrow: true });
  assert.equal(chromeLayout(370, 1).narrow, false);
  assert.deepEqual(chromeLayout(768, 1), { ...base, wide: true });
  assert.deepEqual(chromeLayout(1440, 1), { ...base, wide: true, merged: true });
  assert.deepEqual(chromeLayout(1440, 2), { ...base, largeText: true });
  assert.deepEqual(chromeLayout(360, 2), { ...base, largeText: true, narrow: true });
});

test('layout: narrow phones tighten, and a phone at 200% zoom goes compact', () => {
  // 340-359: tighter gutters, and the signed-in toolbar still icon-only beside the facts.
  assert.deepEqual(chromeLayout(350, 1), {
    wide: false, merged: false, largeText: false, iconOnly: true, narrow: true, compact: false, tightDots: false,
  });
  // 320-339: the signed-in toolbar drops under the facts, so it keeps its labels.
  assert.equal(chromeLayout(330, 1).iconOnly, false);
  assert.equal(chromeLayout(330, 1).compact, false);
  // 390px at 200% zoom is 195 CSS px: compact.
  assert.deepEqual(chromeLayout(195, 1), {
    wide: false, merged: false, largeText: false, iconOnly: false, narrow: true, compact: true, tightDots: false,
  });
  assert.equal(chromeLayout(319, 1).compact, true);
  assert.equal(chromeLayout(320, 1).compact, false);
});

test('layout: the narrowest phones single-space the first line\'s dots so it keeps to one line', () => {
  assert.equal(chromeLayout(320, 1).tightDots, true);
  assert.equal(chromeLayout(343, 1).tightDots, true);
  assert.equal(chromeLayout(344, 1).tightDots, false);
  assert.equal(chromeLayout(390, 1).tightDots, false);
  // Compact rows give last night its own line, so their dots stay roomy.
  assert.equal(chromeLayout(319, 1).tightDots, false);
});

test('next games read as a day, never an ISO date', () => {
  assert.equal(nextGamesText('2025-11-06'), 'Thu, Nov 6');
  assert.equal(nextGamesText(null), null);
});

test('the status sentence says the practice clock, last night and next games in plain English', () => {
  const progress = practiceProgress(OPENING_EVE, '2025-11-05');
  assert.equal(
    statusSummary({
      mode: 'practice', lastSettledDate: '2025-11-05', nextGameDate: '2025-11-06', lastNight: 323_400, progress,
    }),
    'Practice, day 16 of 174. Nov 5 games +$323,400. Next games Thu, Nov 6.',
  );
  assert.equal(
    statusSummary({
      mode: 'practice',
      lastSettledDate: OPENING_EVE,
      nextGameDate: '2025-10-21',
      lastNight: null,
      progress: practiceProgress(OPENING_EVE, OPENING_EVE),
    }),
    'Practice, Oct 20, day 0 of 174. Season opens Tue, Oct 21.',
  );
  // A finished season has no next games to offer, only a restart.
  assert.equal(
    statusSummary({
      mode: 'practice',
      lastSettledDate: '2026-04-12',
      nextGameDate: '2026-04-13',
      lastNight: -12_000,
      progress: practiceProgress(OPENING_EVE, '2026-04-12'),
    }),
    'Practice, season complete. Apr 12 games -$12,000. Play another season.',
  );
});

test('the live status sentence names the last settled night and the lock', () => {
  assert.equal(
    statusSummary({
      mode: 'live',
      lastSettledDate: '2025-11-05',
      nextGameDate: '2025-11-06',
      lastNight: 0,
      lockSentence: 'Roster changes are locked for the Nov 6 game.',
    }),
    'Nov 5 games $0. Next games Thu, Nov 6. Roster changes are locked for the Nov 6 game.',
  );
  assert.equal(
    statusSummary({ mode: 'live', lastSettledDate: null, nextGameDate: null, lastNight: null }),
    'No games settled yet. Next games not scheduled yet.',
  );
});

test('last night reads at the Results night precision, and to the dollar for screen readers', () => {
  assert.deepEqual(lastNightFigure(322_500), { text: '+$322.5K', accessibilityLabel: '+$322,500' });
  assert.deepEqual(lastNightFigure(-178_500), { text: '-$178.5K', accessibilityLabel: '-$178,500' });
  assert.deepEqual(lastNightFigure(-3_500), { text: '-$3.5K', accessibilityLabel: '-$3,500' });
  assert.deepEqual(lastNightFigure(0), { text: '$0', accessibilityLabel: '$0' });
  // Whatever the size, the bar uses the fine formatter itself, never the compact one.
  for (const amount of [224_000, -96_000, 12_000, 999_949, 1_339_000, -1_756_500]) {
    assert.equal(lastNightFigure(amount).text, signedMoneyFine(amount));
  }
});

test('rule wording matches the shared rules copy for both dividend bases', () => {
  for (const dividendBasis of ['raw_net_points', 'surprise_vs_projection'] as const) {
    const facts = perGameRulesPresentation({ ...rules, dividendBasis }).facts;
    assert.equal(dividendBasisText(dividendBasis), facts.find((fact) => fact.label === 'Dividend basis')?.value);
  }
  // In K, as the welcome and Scoring say it (walk 8 T1-04).
  assert.equal(dividendText('raw_net_points', 40_000), 'His net points each game · $40K\u00a0for\u00a0each\u00a0net\u00a0point');
  assert.equal(dividendText('raw_net_points', 12_500), 'His net points each game · $12.5K\u00a0for\u00a0each\u00a0net\u00a0point');
  assert.equal(shortTermText(7), 'A short runs 7 days, then ends by itself with no fee');
  assert.equal(shortTermText(1), 'A short runs 1 day, then ends by itself with no fee');
  assert.equal(shortTermText(null), 'A short stays open until you close it');
});

test('chrome copy never uses the words the design bans', () => {
  const copy = [
    statusSummary({
      mode: 'practice',
      lastSettledDate: '2025-11-05',
      nextGameDate: '2025-11-06',
      lastNight: 1,
      progress: practiceProgress(OPENING_EVE, '2025-11-05'),
    }),
    statusSummary({ mode: 'live', lastSettledDate: '2025-11-05', nextGameDate: null, lastNight: -5 }),
    dividendText('raw_net_points', 40_000),
    dividendText('surprise_vs_projection', 40_000),
    shortTermText(7),
    shortTermText(null),
  ].join('\n');
  assert.doesNotMatch(copy, /\binverse\b|\/GM\b|raw net points|cumulative|sandbox|\b\d{4}-\d{2}-\d{2}\b/i);
});

test('Restart and Exit say what the season would lose', async () => {
  const { practiceQuestion, practiceStakes } = await import('./chromeView');
  const stakes = practiceStakes({
    progress: practiceProgress(OPENING_EVE, '2025-11-05'), players: 8, shorts: 1, score: 120_000,
  });
  assert.equal(stakes, 'Day 16 of 174, 8 players, 1 short, score +$120K');
  const restart = practiceQuestion('restart', stakes);
  assert.equal(restart.confirmLabel, 'Start over');
  assert.match(restart.lines[0], /Day 16 of 174, 8 players/);
  assert.equal(practiceQuestion('exit', stakes).confirmLabel, 'Leave practice');
  assert.equal(
    practiceStakes({ progress: practiceProgress(OPENING_EVE, '2026-04-12'), players: 8, shorts: 0, score: -40_000 }),
    'a finished season, 8 players, score -$40K',
  );
  assert.equal(
    practiceStakes({ progress: practiceProgress(OPENING_EVE, OPENING_EVE), players: 0, shorts: 0, score: 0 }),
    'Day 0 of 174, no players, score $0',
  );
});

test('Exit is offered only where the live market is set up (walk 4 T2-10, T4-05, T1-12)', async () => {
  const { practiceOffersExit, practiceQuestion } = await import('./chromeView');
  const { resolvePublicAppConfig } = await import('../api/config');
  // A site without the public config: Exit would land on "The live market
  // isn't open yet" after throwing the season away, so it is not offered.
  assert.equal(practiceOffersExit(resolvePublicAppConfig({})), false);
  assert.equal(practiceOffersExit(resolvePublicAppConfig({ apiUrl: 'http://127.0.0.1:8011/', apiPrefix: '/api/v2/' })), false);
  assert.equal(practiceOffersExit(null), false);
  // A site with it keeps today's Exit and its question.
  assert.equal(practiceOffersExit(resolvePublicAppConfig({
    apiUrl: 'http://127.0.0.1:8011/',
    apiPrefix: '/api/v2/',
    supabaseUrl: 'https://example.supabase.co/',
    supabasePublishableKey: 'public-key',
  })), true);
  const exit = practiceQuestion('exit', 'Day 1 of 174, 1 player, score -$250');
  assert.equal(exit.title, 'Leave practice for the live market?');
  assert.equal(exit.confirmLabel, 'Leave practice');
});

test('a finished season starts the next at once; Restart and Exit ask once there is anything to lose (walk 4 T1-13)', async () => {
  const { practiceAsksFirst } = await import('./chromeView');
  // Season over: the season is lost either way, so no question, and none in red.
  assert.equal(practiceAsksFirst('play-again', { day: SEASON_TOTAL_DAYS, moves: 14 }), false);
  // The opening eve with no moves: nothing to lose, so they just act.
  assert.equal(practiceAsksFirst('restart', { day: 0, moves: 0 }), false);
  assert.equal(practiceAsksFirst('exit', { day: 0, moves: 0 }), false);
  // A move or a night played: ask first.
  assert.equal(practiceAsksFirst('restart', { day: 0, moves: 1 }), true);
  assert.equal(practiceAsksFirst('exit', { day: 1, moves: 0 }), true);
  const bar = readFileSync(resolve(import.meta.dirname, '../components/SimBar.tsx'), 'utf8');
  assert.doesNotMatch(bar, /Keep this result/);
});

test('the folded frame, short day count, lock reason and no-games night', async () => {
  const { chromeFolded, lockLine, playedOn, practiceDayShort } = await import('./chromeView');
  assert.equal(chromeFolded(390), true);
  assert.equal(chromeFolded(500), false);
  assert.equal(practiceDayShort(practiceProgress(OPENING_EVE, '2025-11-05')), 'Day 16/174');
  assert.equal(lockLine('2025-10-30'), 'Moves reopen after Oct 30 · your players still play');
  const ledger = [{ gameId: 'g1', gameDate: '2025-10-22' }, { gameId: null, gameDate: '2025-10-23' }];
  assert.equal(playedOn(ledger, '2025-10-22'), true);
  assert.equal(playedOn(ledger, '2025-10-23'), false);
  assert.equal(
    statusSummary({
      mode: 'practice', lastSettledDate: '2025-11-05', nextGameDate: '2025-11-06', lastNight: 0, noGames: true,
      progress: practiceProgress(OPENING_EVE, '2025-11-05'),
    }),
    'Practice, day 16 of 174. Nov 5: none of your players played. Next games Thu, Nov 6.',
  );
});

test('the bars name the night, never "last night" (walk 2 T1-07, T1-14, T4-09)', async () => {
  const { lockLine, nightGamesLabel, noGamesText } = await import('./chromeView');
  assert.equal(nightGamesLabel('2025-10-21'), 'Oct 21 games');
  assert.equal(noGamesText('2025-10-22'), 'Oct 22: none of your players played');
  const progress = practiceProgress(OPENING_EVE, '2025-10-22');
  const copy = [
    statusSummary({
      mode: 'practice', lastSettledDate: '2025-10-22', nextGameDate: '2025-10-24', lastNight: 0, noGames: true, progress,
    }),
    statusSummary({
      mode: 'practice', lastSettledDate: '2025-10-21', nextGameDate: '2025-10-22', lastNight: 35_000,
      progress: practiceProgress(OPENING_EVE, '2025-10-21'),
    }),
    statusSummary({ mode: 'live', lastSettledDate: '2025-10-21', nextGameDate: '2025-10-22', lastNight: -5 }),
    lockLine('2025-10-22'),
  ];
  assert.equal(copy[0], 'Practice, day 2 of 174. Oct 22: none of your players played. Next games Fri, Oct 24.');
  assert.equal(copy[1], 'Practice, day 1 of 174. Oct 21 games +$35,000. Next games Wed, Oct 22.');
  assert.equal(copy[3], 'Moves reopen after Oct 22 · your players still play');
  for (const line of copy) assert.doesNotMatch(line, /last night|lineups set/i);
  const strip = readFileSync(resolve(import.meta.dirname, '../components/PerGameStatusStrip.tsx'), 'utf8');
  assert.doesNotMatch(strip, /'Last night|No games last night/);
});

test('a folded row at 400% zoom keeps to one line: the day and More (walk 2 T3-11)', async () => {
  const { chromeTiny, practiceDayTiny } = await import('./chromeView');
  assert.equal(chromeTiny(98, 211), true);
  assert.equal(chromeTiny(320, 299), true);
  // 200% zoom (195x422) keeps its two lines; wider short rows are one line already.
  assert.equal(chromeTiny(195, 422), false);
  assert.equal(chromeTiny(340, 211), false);
  assert.equal(chromeTiny(98, 800), false);
  assert.equal(practiceDayTiny(practiceProgress(OPENING_EVE, '2025-11-05')), 'Day 16\nof 174');
  assert.equal(practiceDayTiny(practiceProgress(OPENING_EVE, '2026-04-12')), 'Season\nover');
});

test('the hint under the advance buttons keeps its line once the first player is in', () => {
  // No date: the button above names the night (walk 7 T1-11: "Oct 21" four or five times).
  assert.equal(readyHint('2025-10-21'), "Ready. +1 night plays the next night's games.");
  assert.equal(readyHint(null), "Ready. +1 night plays the next night's games.");
});

test('a narrow locked night names its padlock and says "Locked · Nov 1" (walk 3 T3-29)', async () => {
  const { lockIconName, lockShortText } = await import('./chromeView');
  assert.equal(lockIconName('2025-11-01'), 'Roster locked until after Nov 1');
  assert.equal(lockIconName(null), 'Roster locked until after these games');
  // The date never breaks inside ("Nov / 1"); the words may wrap after the dot.
  assert.equal(lockShortText('2025-11-01'), 'Locked · Nov 1');
  assert.equal(lockShortText(null), 'Locked');
});

test('sheets at 400% zoom give Done its own row below ~160px (walk 3 T3-31)', async () => {
  const { sheetNarrow, SHEET_NARROW_MAX_WIDTH } = await import('./chromeView');
  assert.equal(SHEET_NARROW_MAX_WIDTH, 160);
  // 390x844 at 400% is 98 wide; at 200% (195) and up, title and Done share a line.
  assert.equal(sheetNarrow(98), true);
  assert.equal(sheetNarrow(159), true);
  assert.equal(sheetNarrow(160), false);
  assert.equal(sheetNarrow(195), false);
});

test('the empty-roster question is asked once a season; then the hint line says it (walk 3 T1-19, T2-14)', async () => {
  const { asksBeforeEmptyNight, EMPTY_ROSTER_HINT, EMPTY_ROSTER_PLAYING_HINT, practiceHint } = await import('./chromeView');
  assert.equal(asksBeforeEmptyNight(true, false), true);
  assert.equal(asksBeforeEmptyNight(true, true), false);
  assert.equal(asksBeforeEmptyNight(false, false), false);
  const base = { complete: false, emptyRoster: true, playedWithoutRoster: false, justFilled: true, nextGameDate: '2025-10-21' };
  assert.equal(practiceHint(base), EMPTY_ROSTER_HINT);
  assert.equal(practiceHint({ ...base, playedWithoutRoster: true }), 'Nobody on your roster: nights play without you');
  assert.equal(EMPTY_ROSTER_PLAYING_HINT, 'Nobody on your roster: nights play without you');
  // The first add swaps in Ready until the next advance, whichever way the empty nights went.
  assert.equal(practiceHint({ ...base, emptyRoster: false, playedWithoutRoster: true }), "Ready. +1 night plays the next night's games.");
  assert.equal(practiceHint({ ...base, emptyRoster: false, justFilled: false }), null);
  assert.equal(practiceHint({ ...base, complete: true }), null);
});

test('after +1 week the status row names the week it played until the next advance (walk 3 T1-20)', async () => {
  const { dateSpanText, playedBetween, resultSpan } = await import('./chromeView');
  assert.equal(dateSpanText('2025-10-21', '2025-10-27'), 'Oct 21–27');
  assert.equal(dateSpanText('2025-10-28', '2025-11-03'), 'Oct 28–Nov 3');
  assert.equal(dateSpanText('2025-12-29', '2026-01-04'), 'Dec 29–Jan 4');
  assert.equal(dateSpanText('2025-10-27', '2025-10-27'), 'Oct 27');
  // Day 0 (Oct 20) + 1 week: the span Oct 21-27, games after Oct 20 through Oct 27.
  const week = { step: 'week' as const, from: OPENING_EVE };
  assert.deepEqual(resultSpan([week], '2025-10-27'), { after: OPENING_EVE, through: '2025-10-27', label: 'Oct 21–27', nobody: false });
  // +1 night pressed next: while it plays the row keeps the week...
  const night = { step: 'night' as const, from: '2025-10-27' };
  assert.equal(resultSpan([week, night], '2025-10-27')?.label, 'Oct 21–27');
  // ...and once it lands, the one night: "Oct 28 games".
  assert.deepEqual(resultSpan([week, night], '2025-10-28'), { after: '2025-10-27', through: '2025-10-28', label: 'Oct 28', nobody: false });
  // No advance yet, a +1 night, or a final week cut to one day: the last night alone.
  assert.equal(resultSpan([], '2025-10-21')?.label, 'Oct 21');
  assert.equal(resultSpan([{ step: 'night', from: '2025-10-22' }], '2025-10-24')?.after, '2025-10-23');
  assert.equal(resultSpan([{ step: 'week', from: '2026-04-11' }], '2026-04-12')?.label, 'Apr 12');
  assert.equal(resultSpan([{ step: 'week', from: '2026-04-08' }], '2026-04-12')?.label, 'Apr 9–12');
  assert.equal(resultSpan([week], null), null);
  const ledger = [{ gameId: 'g1', gameDate: '2025-10-23' }, { gameId: null, gameDate: '2025-10-25' }];
  assert.equal(playedBetween(ledger, OPENING_EVE, '2025-10-27'), true);
  assert.equal(playedBetween(ledger, '2025-10-23', '2025-10-27'), false);
  // Spoken the same way: the span's figure, and "none of your players played" for the span.
  assert.equal(
    statusSummary({
      mode: 'practice', lastSettledDate: '2025-10-27', nextGameDate: '2025-10-28', lastNight: -32_500,
      progress: practiceProgress(OPENING_EVE, '2025-10-27'), resultLabel: 'Oct 21–27',
    }),
    'Practice, day 7 of 174. Oct 21–27 games -$32,500. Next games Tue, Oct 28.',
  );
  assert.equal(
    statusSummary({
      mode: 'practice', lastSettledDate: '2025-10-27', nextGameDate: '2025-10-28', lastNight: 0, noGames: true,
      progress: practiceProgress(OPENING_EVE, '2025-10-27'), resultLabel: 'Oct 21–27',
    }),
    'Practice, day 7 of 174. Oct 21–27: none of your players played. Next games Tue, Oct 28.',
  );
});

test('a finished season states its final score; only the button names the way on (walk 3 T4-04)', () => {
  assert.equal(
    statusSummary({
      mode: 'practice',
      lastSettledDate: '2026-04-12',
      nextGameDate: null,
      lastNight: 0,
      noGames: true,
      progress: practiceProgress(OPENING_EVE, '2026-04-12'),
      finalScore: 209_800,
    }),
    'Practice, season complete. Apr 12: none of your players played. Final score +$209,800.',
  );
  const strip = readFileSync(resolve(import.meta.dirname, '../components/PerGameStatusStrip.tsx'), 'utf8');
  assert.doesNotMatch(strip, /PRACTICE_OVER_TEXT|PLAY AGAIN|'Play again'/);
  const bar = readFileSync(resolve(import.meta.dirname, '../components/SimBar.tsx'), 'utf8');
  assert.doesNotMatch(bar, /label="Play again"|'PLAY AGAIN'|label=\{'Play again'\}/);
});

test('rows with no line to spare keep a short hint, and +1 night its night (walk 4 T1-09, T3-11)', async () => {
  const { NIGHT_DATE_STACKED_MIN_WIDTH, practiceHintShort } = await import('./chromeView');
  const base = { complete: false, emptyRoster: false, playedWithoutRoster: false, justFilled: false, nextGameDate: '2025-10-21' };
  assert.equal(practiceHintShort({ ...base, emptyRoster: true }), 'Add a player first');
  assert.equal(practiceHintShort({ ...base, emptyRoster: true, playedWithoutRoster: true }), 'No players yet');
  assert.equal(practiceHintShort({ ...base, justFilled: true }), 'Ready for +1 night');
  assert.equal(practiceHintShort(base), null);
  assert.equal(practiceHintShort({ ...base, emptyRoster: true, complete: true }), null);
  // A 390px phone at 200% zoom (195px) names the night: "+1 NIGHT" over "OCT 21".
  assert.ok(NIGHT_DATE_STACKED_MIN_WIDTH <= 195);
});

test('a press while a week plays is queued once and says so (walk 5 T3-11, T4-06)', async () => {
  const { queuedLabel, queuedLine, weekSpanLabel } = await import('./chromeView');
  assert.equal(weekSpanLabel(OPENING_EVE, practiceSeasonEnd(OPENING_EVE)), 'Oct 21–27');
  assert.equal(weekSpanLabel('2025-10-27', practiceSeasonEnd(OPENING_EVE)), 'Oct 28–Nov 3');
  // The last press stops at the season's last day.
  assert.equal(weekSpanLabel('2026-04-07', practiceSeasonEnd(OPENING_EVE)), 'Apr 8–12');
  assert.equal(queuedLine('week', 'Oct 21–27'), 'Next week queued. It plays once Oct 21–27 is in.');
  assert.equal(queuedLine('night', 'Oct 21'), 'Next night queued. It plays once Oct 21 is in.');
  // Behind a move that is saving: no nights to name.
  assert.equal(queuedLine('night', null), 'Next night queued. It plays in a moment.');
  // On the button, where sighted players see it; the stacked 55px button keeps two short words.
  assert.equal(queuedLabel('week', false), '+1 week\nqueued');
  assert.equal(queuedLabel('night', true), 'Next\nqueued');
});

test('with nobody on the roster the status row says so, as the notice does (walk 5 T1-17)', async () => {
  const { noGamesWords, resultSpan } = await import('./chromeView');
  assert.equal(noGamesWords(true), ' games: nobody on your roster');
  assert.equal(noGamesWords(false), ': none of your players played');
  // Who you held is who you held when you pressed (Play anyway with nobody).
  const empty = { step: 'night' as const, from: OPENING_EVE, emptyRoster: true };
  assert.equal(resultSpan([empty], '2025-10-21')?.nobody, true);
  // Adding a player afterwards does not rewrite the night you played without one.
  assert.equal(resultSpan([empty], '2025-10-21', false)?.nobody, true);
  // A press with a roster: "none of your players played" still fits.
  assert.equal(resultSpan([{ step: 'week', from: OPENING_EVE, emptyRoster: false }], '2025-10-27', true)?.nobody, false);
  // No press recorded (the live market): the roster now answers.
  assert.equal(resultSpan([], '2025-10-21', true)?.nobody, true);
  assert.equal(
    statusSummary({
      mode: 'practice', lastSettledDate: '2025-10-21', nextGameDate: '2025-10-22', lastNight: 0, noGames: true, nobody: true,
      progress: practiceProgress(OPENING_EVE, '2025-10-21'), resultLabel: 'Oct 21',
    }),
    'Practice, day 1 of 174. Oct 21 games: nobody on your roster. Next games Wed, Oct 22.',
  );
});

test('sheets start where the status row starts, never mid-line (walk 4 T1-01)', async () => {
  const { sheetTopFor } = await import('./chromeView');
  // Under the brand bar on a phone (it was a fixed 64px, through "Practice · Oct 20").
  assert.equal(sheetTopFor(52.6), 53);
  // A short window has no brand bar: the sheet covers the row from the top.
  assert.equal(sheetTopFor(0), 0);
  // Not measured: the sheets keep their own margins.
  assert.equal(sheetTopFor(null), null);
  assert.equal(sheetTopFor(undefined), null);
  assert.equal(sheetTopFor(Number.NaN), null);
  assert.equal(sheetTopFor(-8), null);
  // The quiet advance buttons keep a solid edge: dashed means unavailable (walk 4 T2-03).
  const bar = readFileSync(resolve(import.meta.dirname, '../components/SimBar.tsx'), 'utf8');
  const quiet = bar.slice(bar.indexOf('  advanceQuiet: {'), bar.indexOf('},', bar.indexOf('  advanceQuiet: {')));
  assert.doesNotMatch(quiet, /dashed/);
});

test('wide windows float Rules and Settings under the frame, never on it (walk 5 T2-05)', async () => {
  const { floatTopFor, sheetFloats } = await import('./chromeView');
  // Desktop and tablets float; phones and short (folded) windows keep the sheet.
  assert.equal(sheetFloats(1440, 900), true);
  assert.equal(sheetFloats(768, 1024), true);
  assert.equal(sheetFloats(390, 844), false);
  assert.equal(sheetFloats(844, 390), false);
  // 16px under the frame's bottom edge (the practice bar's rule at 151 on a desktop).
  assert.equal(floatTopFor(151), 167);
  assert.equal(floatTopFor(167.6), 184);
  assert.equal(floatTopFor(null), null);
  assert.equal(floatTopFor(Number.NaN), null);
});

test('a tight Appearance row puts IN USE under the theme name, never beside a squeezed name (walk 6 T3-15)', async () => {
  const { appearanceTagUnder, sheetNarrow } = await import('./chromeView');
  // A 390px phone at 200% zoom (195px) and at 150% (260px): under the name.
  assert.equal(appearanceTagUnder(195), true);
  assert.equal(appearanceTagUnder(260), true);
  // A phone, and 1280 at 400% zoom (320px): beside, where the words keep 176px or more.
  assert.equal(appearanceTagUnder(320), false);
  assert.equal(appearanceTagUnder(390), false);
  // 400% zoom (98px) is the narrow sheet, where the swatch and the tag sit under the words.
  assert.equal(sheetNarrow(98), true);
  // Descriptions are never cut to two lines; the pair swatch's halves hide what does not fit.
  const sheet = readFileSync(resolve(import.meta.dirname, '../components/SettingsSheet.tsx'), 'utf8');
  assert.doesNotMatch(sheet, /numberOfLines=\{narrow \? undefined : 2\}/);
  assert.match(sheet, /swatchHalf: \{[^}]*overflow: 'hidden'/);
});

test('a run of presses played back to back has one notice and one row figure for all of it (walk 6 T4-N2, T2-09)', async () => {
  const { resultSpan, runNotice } = await import('./chromeView');
  // Two weeks: the second pressed while the first played.
  const weeks = [
    { step: 'week' as const, from: '2025-10-20' },
    { step: 'week' as const, from: '2025-10-27', runFrom: '2025-10-20' },
  ];
  assert.deepEqual(resultSpan(weeks, '2025-11-03'), {
    after: '2025-10-20', through: '2025-11-03', label: 'Oct 21–Nov 3', nobody: false,
  });
  // While the queued week plays, the row keeps the first week.
  assert.equal(resultSpan(weeks, '2025-10-27')?.label, 'Oct 21–27');
  // Two nights run together read as their span; one night alone as its date.
  const nights = [
    { step: 'night' as const, from: '2025-10-21' },
    { step: 'night' as const, from: '2025-10-22', runFrom: '2025-10-21' },
  ];
  assert.equal(resultSpan(nights, '2025-10-23')?.label, 'Oct 22–23');
  assert.equal(resultSpan([{ step: 'night' as const, from: '2025-10-22' }], '2025-10-23')?.label, 'Oct 23');
  // The notice counts the run after its span; a single press is left as it is.
  assert.equal(
    runNotice(['week', 'week'], 'Oct 21–Nov 3 games: your score rose $890.5K. Moves pause for the Nov 5 games.'),
    'Oct 21–Nov 3 games (2 weeks): your score rose $890.5K. Moves pause for the Nov 5 games.',
  );
  assert.equal(
    runNotice(['night', 'week'], 'Oct 23–30 games: your score rose $370K.'),
    'Oct 23–30 games (1 night and 1 week): your score rose $370K.',
  );
  assert.equal(runNotice(['night', 'night', 'night'], 'Oct 21–23 games: none of your players played.'),
    'Oct 21–23 games (3 nights): none of your players played.');
  assert.equal(runNotice(['week'], 'Oct 21–27 games: your score rose $454K.'), 'Oct 21–27 games: your score rose $454K.');
  // A run that ends the season keeps the season's own notice.
  assert.equal(runNotice(['week', 'week'], 'Season complete. Final score +$4.95M, #1 of 5.'),
    'Season complete. Final score +$4.95M, #1 of 5.');
});

test('the hint line keeps its place once its night is in (walk 6 T4-13)', async () => {
  const { gamesInLine, heldLineEnds } = await import('./chromeView');
  assert.equal(gamesInLine('Oct 21'), 'Oct 21 games in.');
  assert.equal(gamesInLine('Oct 21–27'), 'Oct 21–27 games in.');
  // It never goes by itself: only the player's press or a tab switch ends it
  // (walk 7 T1-14: it went after 3 s idle and the list jumped 24px).
  assert.equal(heldLineEnds('idle'), false);
  assert.equal(heldLineEnds('night-landed'), false);
  assert.equal(heldLineEnds('queued-press'), false);
  assert.equal(heldLineEnds('press'), true);
  assert.equal(heldLineEnds('tab-switch'), true);
});

test('a tiny row keeps "Day 1 of 174" on one line where it has room, and capitals are spoken in sentence case (walk 6 T3-05, T3-09)', async () => {
  const { practiceDayTinyText, spokenLabel } = await import('./chromeView');
  const day1 = practiceProgress(OPENING_EVE, '2025-10-21');
  // 1280x1024 at 400% zoom (320px): one line, held together.
  assert.equal(practiceDayTinyText(day1, 320), 'Day 1 of 174');
  assert.equal(practiceDayTinyText(practiceProgress(OPENING_EVE, '2026-04-12'), 320), 'Season complete');
  // 390x844 at 400% zoom (98px): the two short lines.
  assert.equal(practiceDayTinyText(day1, 98), 'Day 1\nof 174');
  assert.equal(spokenLabel('OPEN FEE'), 'Open fee');
  assert.equal(spokenLabel('SHORT TERM'), 'Short term');
  assert.equal(spokenLabel('SCORE'), 'Score');
});

test('Play to the end asks what it plays and what stays, in days (walk 6 T2-N1, T4-N3)', async () => {
  const { PLAY_TO_END_LABEL, playToEndQuestion } = await import('./chromeView');
  assert.deepEqual(playToEndQuestion(158, false), {
    title: 'Play the remaining 158 days now?',
    lines: ['Your roster and shorts stay as they are; no moves between nights.'],
    confirmLabel: 'Play to the end',
    cancelLabel: 'Not now',
  });
  assert.equal(playToEndQuestion(1, false).title, 'Play the remaining 1 day now?');
  // Nobody to play for: it says the score won't move.
  assert.deepEqual(playToEndQuestion(174, true).lines, [
    'Your roster and shorts stay as they are; no moves between nights.',
    "Nobody is on your roster, so your score won't move.",
  ]);
  assert.equal(PLAY_TO_END_LABEL, 'Play to the end');
});

test('quick presses form one run, with or without a delay; a queued button counts its presses (walk 7 T4-03, T2-05, T2-06)', async () => {
  const { continuesRun, playToEndQueuedLine, queuedLabel, queuedLine, RUN_CONTINUE_MS } = await import('./chromeView');
  // A press queued behind a playing step always continues its run.
  assert.equal(continuesRun(true, null), true);
  // A press soon after the last step landed continues it too (no network delay).
  assert.equal(continuesRun(false, 430), true);
  assert.equal(continuesRun(false, RUN_CONTINUE_MS), true);
  assert.ok(RUN_CONTINUE_MS >= 1000 && RUN_CONTINUE_MS <= 2000);
  // Later, or with no run landed, it starts a new one.
  assert.equal(continuesRun(false, RUN_CONTINUE_MS + 1), false);
  assert.equal(continuesRun(false, null), false);
  // A second press on a queued button queues one more and says so.
  assert.equal(queuedLine('week', 'Oct 21–27', 1), 'Next week queued. It plays once Oct 21–27 is in.');
  assert.equal(queuedLine('week', 'Oct 21–27', 2), '2 weeks queued. They play once Oct 21–27 is in.');
  assert.equal(queuedLabel('week', false, 2), '+1 week\n×2 queued');
  assert.equal(queuedLabel('night', true, 3), '×3\nqueued');
  assert.equal(queuedLabel('week', false, 1), '+1 week\nqueued');
  // Play to the end confirmed mid-night waits its turn and says so (walk 7 T2-04).
  assert.equal(playToEndQueuedLine('Oct 21'), 'Play to the end queued. It plays once Oct 21 is in.');
  assert.equal(playToEndQueuedLine(null), 'Play to the end queued. It plays in a moment.');
});

test('Restart on a season with nothing in it says so instead of reloading into the same screen (walk 7 T1-09, T2-08)', async () => {
  const { FRESH_SEASON_NOTICE, restartHasNothingToDo } = await import('./chromeView');
  assert.equal(restartHasNothingToDo({ day: 0, moves: 0 }), true);
  assert.equal(restartHasNothingToDo({ day: 0, moves: 1 }), false);
  assert.equal(restartHasNothingToDo({ day: 3, moves: 0 }), false);
  assert.equal(FRESH_SEASON_NOTICE, "This season hasn't started yet, so there's nothing to restart.");
});

test('+1 week describes the week; Play to the end says when shorts end; a finished season names only its final score (walk 7 T3-02, T4-04, T4-09)', async () => {
  const { EMPTY_ROSTER_HINT, EMPTY_ROSTER_PLAYING_HINT, playToEndQuestion, practiceWeekHint, statusRowResult } = await import('./chromeView');
  assert.equal(practiceWeekHint(EMPTY_ROSTER_HINT, 'Oct 21–27'), 'Add a player first. +1 week plays the Oct 21–27 games.');
  assert.equal(practiceWeekHint(EMPTY_ROSTER_PLAYING_HINT, 'Oct 21–27'), 'Nobody on your roster: the week plays without you.');
  assert.equal(practiceWeekHint(readyHint(null), 'Oct 21–27'), 'Ready. +1 week plays the Oct 21–27 games.');
  assert.equal(practiceWeekHint(readyHint(null), null), 'Ready. +1 week plays the next seven days.');
  assert.equal(practiceWeekHint(null, 'Oct 21–27'), null);
  assert.ok(!/\+1 night/.test(practiceWeekHint(EMPTY_ROSTER_HINT, 'Oct 21–27') ?? ''));
  // Five shorts opened on the opening eve all end after Oct 27.
  assert.deepEqual(playToEndQuestion(174, false, Array(5).fill('2025-10-27')).lines, [
    'Your roster stays as it is; no moves between nights.',
    'Your 5 shorts end by themselves after Oct 27; their slots stay empty.',
  ]);
  assert.deepEqual(playToEndQuestion(170, false, ['2025-10-31']).lines, [
    'Your roster stays as it is; no moves between nights.',
    'Your short ends by itself after Oct 31; its slot stays empty.',
  ]);
  assert.equal(playToEndQuestion(170, false, ['2025-10-27', '2025-10-31']).lines[1],
    'Your 2 shorts end by themselves by the Oct 31 games; their slots stay empty.');
  // No shorts: today's line.
  assert.deepEqual(playToEndQuestion(158, false, []).lines, ['Your roster and shorts stay as they are; no moves between nights.']);
  // The row's figure: none on the opening eve or once the season is complete.
  assert.equal(statusRowResult(practiceProgress(OPENING_EVE, '2025-11-05'), 7_890_000), 7_890_000);
  assert.equal(statusRowResult(practiceProgress(OPENING_EVE, '2026-04-12'), 7_890_000), null);
  assert.equal(statusRowResult(practiceProgress(OPENING_EVE, OPENING_EVE), 5), null);
  assert.equal(statusRowResult(null, 5), 5);
});

test('queued presses wait for a practice question, and say so (walk 8 T4-06)', async () => {
  const { queuedWaitLine } = await import('./chromeView');
  assert.equal(queuedWaitLine([]), null);
  assert.equal(queuedWaitLine(['week']), '1 week still queued: it waits until you choose.');
  assert.equal(queuedWaitLine(['week', 'week']), '2 weeks still queued: they wait until you choose.');
  assert.equal(queuedWaitLine(['night', 'week', 'week']), '1 night and 2 weeks still queued: they wait until you choose.');
  // The step already playing is named: the summary changes once when it lands.
  assert.equal(queuedWaitLine([], 'Nov 4–10'), 'Nov 4–10 is still playing.');
  assert.equal(queuedWaitLine(['week', 'week'], 'Nov 4–10'), 'Nov 4–10 is still playing. 2 weeks still queued: they wait until you choose.');
});

test('queued presses can be cancelled, named by their visible words, with a notice (walk 8 T4-N1)', async () => {
  const { QUEUED_CANCEL_LABEL, queuedCancelName, queuedCancelledNotice } = await import('./chromeView');
  assert.equal(QUEUED_CANCEL_LABEL, 'Cancel queued');
  assert.equal(queuedCancelName(['week', 'week']), 'Cancel queued: 2 weeks');
  assert.equal(queuedCancelName(['night']), 'Cancel queued: 1 night');
  assert.ok(queuedCancelName(['night', 'week']).startsWith(QUEUED_CANCEL_LABEL));
  assert.equal(queuedCancelledNotice(['week', 'week'], null), '2 queued weeks cancelled.');
  assert.equal(queuedCancelledNotice(['week'], 'Oct 21–27'), 'Queued week cancelled. Oct 21–27 still plays.');
  assert.equal(queuedCancelledNotice(['night', 'week', 'week'], 'Oct 22'), '1 queued night and 2 weeks cancelled. Oct 22 still plays.');
});

test('the empty-roster hint fits a player who has held shorts before (walk 8 T4-10)', async () => {
  const { NOBODY_HELD_HINT, practiceHint, practiceHintShort, practiceWeekHint } = await import('./chromeView');
  const base = { complete: false, emptyRoster: true, playedWithoutRoster: false, justFilled: false, nextGameDate: '2025-10-27' };
  assert.equal(practiceHint(base), "Add a player first. +1 night plays the next night's games.");
  assert.equal(practiceHint({ ...base, heldBefore: true }), NOBODY_HELD_HINT);
  assert.match(NOBODY_HELD_HINT, /roster or shorts now/);
  assert.equal(practiceHintShort({ ...base, heldBefore: true }), 'Add or short someone');
  assert.equal(practiceWeekHint(NOBODY_HELD_HINT, 'Oct 27–Nov 2'), 'Nobody on your roster or shorts now: add or short someone before the next week.');
  // "Play anyway" said this season still wins.
  assert.equal(practiceHint({ ...base, heldBefore: true, playedWithoutRoster: true }), 'Nobody on your roster: nights play without you');
});

test('the progress bar is named by how much of the season is played (walk 8 T1-03)', async () => {
  const { practiceProgress, seasonPlayedLabel } = await import('./chromeView');
  const start = '2025-10-20';
  assert.equal(seasonPlayedLabel(practiceProgress(start, start)), 'Season 0% played');
  assert.equal(seasonPlayedLabel(practiceProgress(start, '2025-10-21')), 'Season 1% played');
  assert.equal(seasonPlayedLabel(practiceProgress(start, '2025-11-05')), 'Season 9% played');
  assert.equal(seasonPlayedLabel(practiceProgress(start, '2026-04-11')), 'Season 99% played');
  assert.equal(seasonPlayedLabel(practiceProgress(start, '2026-04-12')), 'Season 100% played');
});

test('short rows keep the date before the day count (walk 8 T3-05)', async () => {
  const { practiceDateDay, practiceProgress } = await import('./chromeView');
  const start = '2025-10-20';
  assert.equal(practiceDateDay(practiceProgress(start, start), start), 'Oct\u00a020\u00a0·\u00a0Day\u00a00');
  assert.equal(practiceDateDay(practiceProgress(start, '2025-11-05'), '2025-11-05', true), 'Nov\u00a05\nDay\u00a016');
  assert.equal(practiceDateDay(practiceProgress(start, '2026-04-12'), '2026-04-12'), 'Season complete');
  assert.equal(practiceDateDay(practiceProgress(start, null), null), 'Day 0/174');
});

test('Settings lists recent notices with their age, and Match device says what it shows (walk 8 T3-I2, T2-I7)', async () => {
  const { deviceChoiceName, NO_RECENT_NOTICES, noticeAgeText } = await import('./chromeView');
  const now = new Date(2026, 8, 26, 13, 5, 0).getTime();
  assert.equal(noticeAgeText(now - 20_000, now), 'Just now');
  assert.equal(noticeAgeText(now - 4 * 60_000, now), '4 min ago');
  assert.equal(noticeAgeText(now - 59 * 60_000, now), '59 min ago');
  assert.equal(noticeAgeText(new Date(2026, 8, 26, 11, 7).getTime(), now), '11:07 AM');
  assert.equal(noticeAgeText(new Date(2026, 8, 26, 0, 30).getTime(), now), '12:30 AM');
  assert.equal(noticeAgeText(now + 5_000, now), 'Just now');
  assert.match(NO_RECENT_NOTICES, /^No notices yet\./);
  assert.equal(deviceChoiceName('Light'), 'Match device · Light now');
  assert.equal(deviceChoiceName(null), 'Match device');
});

test('walk 9: a steady run of taps plays every press; an isolated pair is a double tap', async () => {
  const { advanceTap, NO_ADVANCE_TAPS } = await import('./chromeView');
  const run = (gaps: number[]) => {
    let state = NO_ADVANCE_TAPS;
    let at = 1000;
    let plays = 0;
    for (const gap of [0, ...gaps]) {
      at += gap;
      const tap = advanceTap(state, at);
      state = tap.state;
      plays += tap.plays;
    }
    return plays;
  };
  assert.equal(run([250, 250, 250, 250]), 5);
  assert.equal(run([330, 330, 330, 330]), 5);
  assert.equal(run([420, 420, 420, 420]), 5);
  assert.equal(run([200]), 1);
  assert.equal(run([150, 900, 150]), 2);
  // Deliberate taps at uneven gaps each count, a quick one mid-rhythm too.
  assert.equal(run([366, 383, 419, 292]), 5);
  // A finger bouncing (21 ms) never counts, even mid-run.
  assert.equal(run([371, 373, 21, 403]), 4);
  // An isolated double tap after a pause still plays once.
  assert.equal(run([1200, 180]), 2);
});

test('walk 9: locked night with nobody held says what can be done', async () => {
  const { asksBeforeEmptyNight, lockedEmptyHint, lockedWeekQuestion, practiceHint, practiceHintShort, practiceWeekHint } = await import('./chromeView');
  const base = { complete: false, emptyRoster: true, playedWithoutRoster: false, justFilled: true, nextGameDate: '2025-10-28', heldBefore: true, locked: true, lockGameDate: '2025-10-28' };
  assert.equal(practiceHint(base), 'Nobody on your roster or shorts. Moves reopen after Oct 28.');
  assert.equal(lockedEmptyHint('2025-10-28', false), 'Nobody on your roster yet. Moves reopen after Oct 28.');
  assert.equal(practiceHintShort(base), 'Locked · Oct 28');
  assert.equal(practiceWeekHint(practiceHint(base), 'Oct 28–Nov 3'), 'Nobody on your roster or shorts. Moves reopen after Oct 28.');
  assert.equal(asksBeforeEmptyNight(true, false, true), false);
  assert.equal(asksBeforeEmptyNight(true, false), true);
  const week = lockedWeekQuestion('2025-10-28');
  assert.equal(week.primaryLabel, '+1 night instead');
  assert.ok(week.lines[0].includes('locked for the Oct 28 games'));
});

test('walk 9: queue count, cancel words, and a cancel said with the result', async () => {
  const { queuedCancelControlName, queuedCancelLabel, withCancelledNote } = await import('./chromeView');
  assert.equal(queuedCancelLabel(['week']), 'Cancel queued week');
  assert.equal(queuedCancelLabel(['week', 'week']), 'Cancel 2 queued weeks');
  assert.equal(queuedCancelLabel(['night', 'week', 'week']), 'Cancel 3 queued');
  assert.equal(queuedCancelControlName(['night', 'week']), 'Cancel 2 queued: 1 night and 1 week');
  assert.equal(withCancelledNote('Oct 21–27 games: your score rose $454K.', 'Queued week cancelled.'), 'Oct 21–27 games: your score rose $454K. Queued week cancelled.');
  assert.equal(withCancelledNote('x. Queued week cancelled.', 'Queued week cancelled.'), 'x. Queued week cancelled.');
});

test('walk 9: Play to the end with only shorts says nobody plays after they end, and offers the Market', async () => {
  const { playToEndOffersMarket, playToEndShortsOnlyLines } = await import('./chromeView');
  assert.deepEqual(playToEndShortsOnlyLines(['2025-10-27']), [
    'Nobody is on your roster, so after Oct 27 nobody plays for you.',
    'Your short ends by itself after Oct 27.',
  ]);
  assert.equal(playToEndShortsOnlyLines([null]), null);
  assert.equal(playToEndOffersMarket(0, false), true);
  assert.equal(playToEndOffersMarket(0, true), false);
  assert.equal(playToEndOffersMarket(2, false), false);
});

test('walk 10: the queue reaches the season end, the Cancel hint only when there is time, one way on at season end', async () => {
  const { asksBeforeEmptyWeek, cancelHintFits, lockLine, nightButtonName, queueFullLine, queueHasRoom, seasonEndControl } = await import('./chromeView');
  // T4-02: presses queue to the season's last day, not five and silence.
  const weeks = (n: number) => Array.from({ length: n }, () => 'week' as const);
  assert.equal(queueHasRoom(weeks(5), 160), true);
  assert.equal(queueHasRoom(weeks(22), 160), true);
  assert.equal(queueHasRoom(weeks(23), 160), false);
  assert.equal(queueHasRoom([], 0), false);
  assert.equal(queueHasRoom(['night', 'night'], 3), true);
  assert.equal(queueFullLine('2026-04-12'), 'The rest of the season is already queued, to the Apr 12 games. Cancel drops it.');
  // T3-09: "Press Cancel" only when the queue should last a few seconds.
  assert.equal(cancelHintFits(1, null), false);
  assert.equal(cancelHintFits(1, 700), false);
  assert.equal(cancelHintFits(5, 700), true);
  assert.equal(cancelHintFits(0, 5000), false);
  // T2-13: nobody held, so no "your players still play".
  assert.equal(lockLine('2025-10-28', true), 'Moves reopen after Oct 28 · play that night, then add players');
  assert.equal(lockLine('2025-10-28'), 'Moves reopen after Oct 28 · your players still play');
  // T2-14: +1 week on a locked night with nobody held always asks, even after Play anyway.
  assert.equal(asksBeforeEmptyWeek(true, true, true), true);
  assert.equal(asksBeforeEmptyWeek(true, true, false), false);
  assert.equal(asksBeforeEmptyWeek(true, false, false), true);
  assert.equal(asksBeforeEmptyWeek(false, false, true), false);
  // T3-05: the name starts with the visible words.
  assert.equal(nightButtonName('Oct 21', true), '+1 night Oct 21: play the Oct 21 games');
  assert.equal(nightButtonName('Oct 21', false), '+1 night: play the Oct 21 games');
  assert.equal(nightButtonName(null, false), "+1 night: play the next night's games");
  // T4-03: one primary way on where the result card shows it.
  assert.deepEqual(seasonEndControl(true), { label: 'New season', name: 'New season: restart practice', primary: false });
  assert.deepEqual(seasonEndControl(false), { label: 'Play another season', name: 'Play another season: restart practice', primary: true });
});

test('walk 11: Play to the end on a lock eve offers the night, one order for every question', async () => {
  const { playToEndLockedLine, playToEndOffersMarket, playToEndOffersNight, questionAnswerOrder } = await import('./chromeView');
  // T4-03: nobody on the roster and the next games locked: +1 night instead, with the reason.
  assert.equal(playToEndOffersNight(0, true), true);
  assert.equal(playToEndOffersNight(0, false), false);
  assert.equal(playToEndOffersNight(2, true), false);
  assert.equal(playToEndOffersMarket(0, true), false);
  assert.equal(
    playToEndLockedLine('2025-10-28'),
    'Moves are locked for the Oct 28 games. +1 night plays just that night, then you can add players.',
  );
  // T2-06: the way out first, the risky action next, a recommended move last; focus on the way out.
  assert.deepEqual(questionAnswerOrder(true), { order: ['safe', 'risky', 'recommended'], focus: 'safe' });
  assert.deepEqual(questionAnswerOrder(false), { order: ['safe', 'risky'], focus: 'safe' });
  // T3-04: with a reader's text spacing at 320 the slot says the date alone, never "Locked · …".
  const { lockSlotText } = await import('./chromeView');
  assert.equal(lockSlotText('2025-10-28', 320, true), 'Oct 28');
  assert.equal(lockSlotText('2025-10-28', 320, false), 'Locked · Oct\u00a028');
  assert.equal(lockSlotText('2025-10-28', 390, false), 'Moves reopen after Oct 28');
  assert.equal(lockSlotText('2025-10-28', 390, true), 'Moves reopen after Oct 28');
  // T4-06: once nothing waits, the queue-full line says what is playing, without "Cancel drops it".
  const { queueLastLine, queueFullLine, NOTHING_TO_CANCEL, QUEUE_LINE_PAUSE_MS } = await import('./chromeView');
  assert.equal(queueLastLine('week', '2026-04-12'), 'The last week is playing now: the season ends after the Apr 12 games.');
  assert.doesNotMatch(queueLastLine('night', '2026-04-12'), /Cancel/);
  assert.match(queueFullLine('2026-04-12'), /Cancel drops it\.$/);
  // T1-14: Cancel answers on itself; T3-15: the count waits for a pause.
  assert.equal(NOTHING_TO_CANCEL, 'Nothing to cancel');
  assert.equal(QUEUE_LINE_PAUSE_MS, 700);
  // T4-02 (walk 11), T4-01 (walk 12): the figures hold while the week plays and update once, in
  // place; the line says so, and never a second score.
  const { questionFlightLine } = await import('./chromeView');
  assert.equal(
    questionFlightLine({ playing: 'Oct 28–Nov 3', moves: [], outcomes: null }),
    'Oct 28–Nov 3 is still playing: the figures above update when it is in.',
  );
  assert.equal(questionFlightLine({ playing: 'Oct 28–Nov 3', moves: [], outcomes: [] }), 'Updated: Oct 28–Nov 3 is in.');
  assert.doesNotMatch(questionFlightLine({ playing: 'Oct 28–Nov 3', moves: [], outcomes: [] }) ?? '', /score|\$/);
  assert.equal(questionFlightLine({ playing: null, moves: [], outcomes: null }), null);
  // T1-08: the hint follows a playing night; T4-04: "+1 night" never splits.
  const { keepControlNames, playingHint } = await import('./chromeView');
  assert.equal(playingHint('Oct 21', false), 'Playing the Oct 21 games…');
  assert.equal(playingHint('Oct 21', true), 'Playing Oct 21…');
  assert.equal(playingHint("rest of the season's", true), 'Playing the rest…');
  assert.equal(keepControlNames('Ready for +1 night'), 'Ready for +1\u00a0night');
  assert.equal(keepControlNames('Ready. +1 week plays the Oct 21–27 games.'), 'Ready. +1\u00a0week plays the Oct 21–27 games.');
  // T4-N2: a queued run of weeks says where it ends.
  const { queuedThrough, queuedLineThrough, queuedLine } = await import('./chromeView');
  assert.equal(queuedThrough('2025-10-20', 'week', ['week', 'week', 'week', 'week'], '2026-04-12'), '2025-11-24');
  assert.equal(queuedThrough('2026-03-16', 'week', ['week', 'week', 'week', 'week'], '2026-04-12'), '2026-04-12');
  assert.equal(queuedThrough('2025-10-20', 'night', ['week'], '2026-04-12'), null);
  assert.equal(queuedThrough('2025-10-20', 'week', [], '2026-04-12'), null);
  assert.equal(
    queuedLineThrough(queuedLine('week', 'Nov 4–10', 2), '2025-11-24'),
    '2 weeks queued, through Nov 24. They play once Nov 4–10 is in.',
  );
  // T2-09: at short laptop heights the lock sits beside the day, not on a line of its own.
  const { lockBesideDay } = await import('./chromeView');
  assert.equal(lockBesideDay(600, true), true);
  assert.equal(lockBesideDay(533, true), true);
  assert.equal(lockBesideDay(900, true), false);
  assert.equal(lockBesideDay(600, false), false);
});

test('a wide short window folds the frame too, a portrait phone keeps the height rule (walk 11 T3-13)', async () => {
  const { chromeFolded } = await import('./chromeView');
  // Laptops at 150% zoom: 1280x800 and 1366x768.
  assert.equal(chromeFolded(533, 853), true);
  assert.equal(chromeFolded(512, 911), true);
  // A short laptop window that still has room, and a phone in Safari.
  assert.equal(chromeFolded(600, 960), false);
  assert.equal(chromeFolded(553, 375), false);
  // Walk 12 T4-10: the smallest phones (320x568) fold too, so content keeps two thirds or more.
  assert.equal(chromeFolded(568, 320), true);
  assert.equal(chromeFolded(640, 320), false);
  assert.equal(chromeFolded(740, 360), false);
  // The height rule alone, as before (a phone on its side, 200% zoom).
  assert.equal(chromeFolded(390, 844), true);
  assert.equal(chromeFolded(422, 195), true);
});

test('Restart always asks while a move saves or a week waits, and its figures wait for them (walk 12 T1-07, T4-01, T4-04)', async () => {
  const { movesInFlight, practiceAsksFirst, practiceStakes, questionFlightLine, restartHasNothingToDo } = await import('./chromeView');
  // T1-07: Day 0, no moves in the ledger yet, but an add saving (or a week queued): ask.
  assert.equal(restartHasNothingToDo({ day: 0, moves: 0, inFlight: true }), false);
  assert.equal(practiceAsksFirst('restart', { day: 0, moves: 0, inFlight: true }), true);
  assert.equal(practiceAsksFirst('play-again', { day: SEASON_TOTAL_DAYS, moves: 3, inFlight: true }), false);
  assert.equal(restartHasNothingToDo({ day: 0, moves: 0 }), true);
  // pendingActions keys: a running move, a queued one, a drop of a held player, a refresh.
  const names = new Map([['luka', 'Luka Doncic'], ['scottie', 'Scottie Barnes'], ['booker', 'Devin Booker']]);
  const positions = [{ playerId: 'booker', side: 'long', status: 'active' }];
  const moves = movesInFlight(
    ['position:long:luka', 'account-refresh', 'queued:position:long:scottie', 'queued:position:long:luka', 'position:long:booker'],
    positions,
    names,
  );
  assert.deepEqual(moves.map((move) => `${move.verb} ${move.name}`), ['add Luka Doncic', 'add Scottie Barnes', 'drop Devin Booker']);
  // The line the card asks for, and the figures that wait with it.
  assert.equal(
    questionFlightLine({ playing: null, moves: moves.slice(0, 1), outcomes: null }),
    'Your add of Luka Doncic is still saving: the figures above update when it lands.',
  );
  assert.equal(
    questionFlightLine({ playing: 'Nov 4–10', moves, outcomes: null }),
    'Nov 4–10 is still playing and your adds of Luka Doncic and Scottie Barnes and your drop of Devin Booker are still saving: the figures above update when they are in.',
  );
  assert.equal(
    questionFlightLine({ playing: null, moves: moves.slice(0, 2), outcomes: [true, false] }),
    'Updated: your add of Luka Doncic is in; your add of Scottie Barnes did not go through.',
  );
  assert.equal(questionFlightLine({ playing: 'Nov 4–10', moves: moves.slice(0, 1), outcomes: [true] }), 'Updated: Nov 4–10 and your add of Luka Doncic are in.');
  // T4-04: adds still saving are counted, and said.
  const progress = practiceProgress(OPENING_EVE, '2025-10-21');
  assert.equal(
    practiceStakes({ progress, players: 4, shorts: 0, score: 194_300, savingPlayers: 3 }),
    'Day 1 of 174, 4 players, 3 still saving, score +$194.3K',
  );
  assert.equal(
    practiceStakes({ progress: practiceProgress(OPENING_EVE, OPENING_EVE), players: 1, shorts: 0, score: 0, savingPlayers: 1 }),
    'Day 0 of 174, 1 player, still saving, score $0',
  );
});

test('a finished season never shows or says a lock (walk 12 T4-12)', async () => {
  const { frameLocked } = await import('./chromeView');
  assert.equal(frameLocked(true, practiceProgress(OPENING_EVE, '2026-04-12')), false);
  assert.equal(frameLocked(true, practiceProgress(OPENING_EVE, '2025-10-27')), true);
  assert.equal(frameLocked(false, practiceProgress(OPENING_EVE, '2025-10-27')), false);
  // The live market (no practice progress) keeps its lock.
  assert.equal(frameLocked(true, null), true);
});

test('at 400% zoom a practice question gives its words room to wrap at spaces (walk 12 T4-15)', async () => {
  const { questionTight, QUESTION_TIGHT_MAX_WIDTH } = await import('./chromeView');
  assert.equal(questionTight(98), true);
  assert.equal(questionTight(195), true);
  assert.equal(questionTight(320), false);
  assert.equal(QUESTION_TIGHT_MAX_WIDTH, 240);
  const bar = readFileSync(resolve(import.meta.dirname, '../components/SimBar.tsx'), 'utf8');
  // The panel scrolls from its title when taller than the window.
  assert.match(bar, /<ScrollView contentContainerStyle=\{styles\.questionScrollContent\} style=\{styles\.questionScroll\}>/);
});

test('+1 week never says "Ready" with nobody held, as the hint reaches it (walk 12 T3-02)', async () => {
  const { EMPTY_ROSTER_HINT, NOBODY_HELD_HINT, EMPTY_ROSTER_PLAYING_HINT, keepControlNames, practiceWeekHint, playingHint } = await import('./chromeView');
  // usePracticeHint hands the hint over with "+1 night" kept together.
  assert.equal(practiceWeekHint(keepControlNames(EMPTY_ROSTER_HINT), 'Oct 21–27'), 'Add a player first. +1 week plays the Oct 21–27 games.');
  assert.equal(practiceWeekHint(keepControlNames(NOBODY_HELD_HINT), 'Oct 27–Nov 2'), 'Nobody on your roster or shorts now: add or short someone before the next week.');
  assert.equal(practiceWeekHint(keepControlNames(EMPTY_ROSTER_PLAYING_HINT), 'Oct 21–27'), 'Nobody on your roster: the week plays without you.');
  // While a night plays, +1 week says what the screen says.
  assert.equal(practiceWeekHint(playingHint('Oct 21', false), 'Oct 21–27'), 'Playing the Oct 21 games…');
});

test('adds still saving count for the frame hint (walk 12 T2-08)', async () => {
  const { savingHint, practiceWeekHint } = await import('./chromeView');
  const adds = [{ verb: 'add' as const }, { verb: 'add' as const }, { verb: 'add' as const }];
  assert.equal(savingHint(adds, false), "Saving 3 adds… then +1 night plays the next night's games.");
  assert.equal(savingHint(adds.slice(0, 1), true), 'Saving your add…');
  assert.equal(savingHint([{ verb: 'short' }], true), 'Saving your short…');
  assert.equal(practiceWeekHint(savingHint(adds, false), 'Oct 21–27'), 'Saving 3 adds… then +1 week plays the Oct 21–27 games.');
});

test('a phone row says an empty week without "games", so it keeps to one line (walk 12 T1-02)', async () => {
  const { noGamesWords } = await import('./chromeView');
  assert.equal(noGamesWords(true, true), ': nobody on your roster');
  assert.equal(noGamesWords(true), ' games: nobody on your roster');
  assert.equal(noGamesWords(false, true), ': none of your players played');
});

test('"+1 WEEK" keeps to one line in the 195px stacked row (walk 12 T3-03, T4-09)', async () => {
  const { stackedWeekLabel, WEEK_ONE_LINE_STACKED_MIN_WIDTH } = await import('./chromeView');
  assert.equal(stackedWeekLabel(195), '+1 week');
  assert.equal(stackedWeekLabel(230), '+1 week');
  assert.equal(stackedWeekLabel(160), '+1\nweek');
  assert.equal(WEEK_ONE_LINE_STACKED_MIN_WIDTH, 192);
});

test('the season number is spoken with the status from the second season (walk 12 T3-07)', () => {
  const base = { mode: 'practice' as const, lastSettledDate: OPENING_EVE, nextGameDate: '2025-10-21', lastNight: null, progress: practiceProgress(OPENING_EVE, OPENING_EVE) };
  assert.match(statusSummary({ ...base, season: 2 }), /^Practice, Season 2, Oct 20, day 0 of 174\./);
  assert.match(statusSummary({ ...base, season: 1 }), /^Practice, Oct 20, day 0 of 174\./);
  assert.match(statusSummary(base), /^Practice, Oct 20, day 0 of 174\./);
});

test('while weeks play or wait, +1 night never names a night the queue will play (walk 12 T4-08)', async () => {
  const { nightAfterQueue } = await import('./chromeView');
  assert.equal(nightAfterQueue('2025-10-27', null, [], '2026-04-12'), null);
  assert.equal(nightAfterQueue('2025-10-27', 'night', ['night'], '2026-04-12'), null);
  assert.deepEqual(nightAfterQueue('2025-11-03', 'week', ['week', 'week'], '2026-04-12'), {
    name: '+1 night: plays the next night after Nov 24, once the queued weeks are in',
    seasonQueued: false,
  });
  assert.equal(nightAfterQueue('2025-11-03', 'week', [], '2026-04-12')?.name, '+1 night: plays the next night after Nov 10, once the queued weeks are in');
  assert.equal(nightAfterQueue('2025-11-03', 'night', ['week'], '2026-04-12')?.name, '+1 night: plays the next night once the queued weeks are in');
  assert.deepEqual(nightAfterQueue('2026-03-30', 'week', ['week', 'week'], '2026-04-12'), {
    name: '+1 night: the rest of the season is already queued, to the Apr 12 games',
    seasonQueued: true,
  });
});
