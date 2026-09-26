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
  assert.deepEqual(lastNightFigure(-3_500), { text: '-$3,500', accessibilityLabel: '-$3,500' });
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
  assert.equal(dividendText('raw_net_points', 40_000), 'His net points each game · $40,000\u00a0for\u00a0each\u00a0net\u00a0point');
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
  assert.equal(readyHint('2025-10-21'), 'Ready. +1 night plays the Oct 21 games.');
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
  assert.equal(practiceHint({ ...base, emptyRoster: false, playedWithoutRoster: true }), 'Ready. +1 night plays the Oct 21 games.');
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
  assert.deepEqual(resultSpan([week], '2025-10-27'), { after: OPENING_EVE, through: '2025-10-27', label: 'Oct 21–27' });
  // +1 night pressed next: while it plays the row keeps the week...
  const night = { step: 'night' as const, from: '2025-10-27' };
  assert.equal(resultSpan([week, night], '2025-10-27')?.label, 'Oct 21–27');
  // ...and once it lands, the one night: "Oct 28 games".
  assert.deepEqual(resultSpan([week, night], '2025-10-28'), { after: '2025-10-27', through: '2025-10-28', label: 'Oct 28' });
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

test('a press while a week plays says it is still playing (walk 4 T4-04)', async () => {
  const { stillPlayingLine, weekSpanLabel } = await import('./chromeView');
  assert.equal(weekSpanLabel(OPENING_EVE, practiceSeasonEnd(OPENING_EVE)), 'Oct 21–27');
  assert.equal(weekSpanLabel('2025-10-27', practiceSeasonEnd(OPENING_EVE)), 'Oct 28–Nov 3');
  // The last press stops at the season's last day.
  assert.equal(weekSpanLabel('2026-04-07', practiceSeasonEnd(OPENING_EVE)), 'Apr 8–12');
  assert.equal(stillPlayingLine('Oct 21–27', 'week'), "Still playing Oct 21–27. Press +1 week again once it's in.");
  assert.equal(stillPlayingLine('Oct 21', 'night'), "Still playing Oct 21. Press +1 night again once it's in.");
  assert.equal(stillPlayingLine(null, 'night'), "Still playing. Press +1 night again once it's in.");
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
