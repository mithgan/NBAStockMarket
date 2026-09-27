import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { advanceQuiet, asksBeforeEmptyNight, asksBeforeEmptyWeek } from './chromeView';

const simBar = () => readFileSync(resolve(import.meta.dirname, '../components/SimBar.tsx'), 'utf8');

test('with nobody held +1 night / +1 week stay quiet whatever was answered, and +1 week asks every time (walk 14 T1-06)', () => {
  // Quiet (no gold) while nobody is on the roster or shorts, before and after "Play anyway".
  assert.equal(advanceQuiet('night', true), true);
  assert.equal(advanceQuiet('week', true), true);
  assert.equal(advanceQuiet('night', false), false);
  assert.equal(advanceQuiet('week', false), false);
  // A locked night with nobody held: +1 night is the way on (it plays just that night).
  assert.equal(advanceQuiet('night', true, true), false);
  assert.equal(advanceQuiet('week', true, true), true);
  // +1 night asks once a season; +1 week asks every time nobody is held.
  assert.equal(asksBeforeEmptyNight(true, true), false);
  assert.equal(asksBeforeEmptyWeek(true, true), true);
  assert.equal(asksBeforeEmptyWeek(true, false), true);
  assert.equal(asksBeforeEmptyWeek(false, true), false);
  // The buttons' style follows advanceQuiet, not whether the press asks.
  const source = simBar();
  assert.match(source, /quietNight && styles\.advanceQuiet/);
  assert.match(source, /quietWeek && styles\.advanceQuiet/);
  assert.doesNotMatch(source, /asksNight && styles\.advanceQuiet/);
  assert.doesNotMatch(source, /asksFirst && styles\.advanceQuiet/);
});

test('at 400% zoom on a desktop (320x200) the tiny row keeps +1 night beside More (walk 14 T3-02)', async () => {
  const { chromeTiny, tinyRowHoldsNight, CHROME_TINY_NIGHT_MIN_WIDTH } = await import('./chromeView');
  assert.equal(chromeTiny(320, 200), true);
  assert.equal(tinyRowHoldsNight(320), true);
  assert.equal(tinyRowHoldsNight(256), true);
  // A phone at 400% (98px): the day and More fill the row; +1 night stays in More.
  assert.equal(tinyRowHoldsNight(98), false);
  assert.equal(tinyRowHoldsNight(CHROME_TINY_NIGHT_MIN_WIDTH - 1), false);
  // Season over: nothing to advance.
  assert.equal(tinyRowHoldsNight(320, true), false);
  // A locked night's padlock date needs the room below 320px.
  assert.equal(tinyRowHoldsNight(256, false, true), false);
  assert.equal(tinyRowHoldsNight(320, false, true), true);
  // The row's +1 night is not repeated in More, which keeps +1 week.
  const tinyBranch = simBar().slice(simBar().indexOf('if (folded && tiny) {'), simBar().indexOf('// A short window: one row with +1 night'));
  assert.match(tinyBranch, /\{nightInRow \? nightButton : null\}/);
  assert.match(tinyBranch, /nightInRow \? weekButton : advanceButtons/);
});

test('at season end a phone frame keeps no row for one button pushed right (walk 14 T1-04)', async () => {
  const { seasonEndRowShows, seasonEndStanding } = await import('./chromeView');
  // The Roster's card holds the gold Play another season: the row goes, unless Exit is offered.
  assert.equal(seasonEndRowShows(true, false), false);
  assert.equal(seasonEndRowShows(true, true), true);
  assert.equal(seasonEndRowShows(false, false), true);
  // Elsewhere the final place leads the row, in words where +1 night was.
  assert.equal(seasonEndStanding('#2 of 5'), 'Finished #2 of 5');
  assert.equal(seasonEndStanding(null), null);
  const source = simBar();
  const end = source.slice(source.indexOf('if ((compact || phoneRow) && progress.complete && !folded) {'), source.indexOf('// Rules joins More only where the frame folds'));
  assert.match(end, /if \(!seasonEndRowShows\(onRoster, liveMarketToExitTo\(\)\)\) return null;/);
  assert.match(end, /spokenRanks\(standing\)/);
});

test('a step heard with the season end keeps its result, not its lock (walk 14 T4-02)', async () => {
  const { isGamesNotice } = await import('./chromeView');
  assert.equal(isGamesNotice("Oct 21–27 games: your score rose $540.5K. Cade Cunningham's short ended after 7 days: +$86.5K in all."), true);
  assert.equal(isGamesNotice('Oct 21–Nov 3 games (2 weeks): your score rose $910K.'), true);
  assert.equal(isGamesNotice('Oct 21 games: nobody on your roster, so your score held.'), true);
  assert.equal(isGamesNotice('Luka Doncic added at $417.5K a game, locked in. $250 fee.'), false);
  assert.equal(isGamesNotice(null), false);
  // Play to the end re-says the step's drawn words (no lock sentence) silently, before the season's notice joins them.
  const source = simBar();
  const playToEnd = source.slice(source.indexOf('const playToEnd = async () => {'), source.indexOf('playToEndRef.current = () => {'));
  assert.match(playToEnd, /if \(speakRun\.current\) \{\s*stopSpeakRun\(\);\s*if \(isGamesNotice\(message\)\) notify\(message as string, \{ spoken: '' \}\);/);
  assert.match(source, /if \(endQueuedRef\.current && isGamesNotice\(message\)\) notify\(message as string, \{ spoken: '' \}\);\s*dismissNotice\(\);/);
});

test('"+1 NIGHT" keeps one line while weeks queue, and after Cancel its name says what still plays (walk 14 T4-06, T4-08)', async () => {
  const { nightAfterQueue } = await import('./chromeView');
  assert.equal(nightAfterQueue('2025-10-27', 'week', [], '2026-04-12', 'Oct 28–Nov 3')?.name,
    '+1 night: plays the next night after Nov 3, once Oct 28–Nov 3 is in');
  // Weeks still queued: they are what it waits for.
  assert.equal(nightAfterQueue('2025-10-27', 'week', ['week'], '2026-04-12', 'Oct 28–Nov 3')?.name,
    '+1 night: plays the next night after Nov 10, once the queued weeks are in');
  const source = simBar();
  assert.match(source, /afterQueue \? \(stackedDate \? '\+1\\u00a0night' : stackLabels \? '\+1\\nnight' : '\+1 night'\)/);
});

test('More says it opens a dialog and keeps its expanded state (walk 14 T3-06)', () => {
  const button = readFileSync(resolve(import.meta.dirname, '../components/chrome/ChromeButton.tsx'), 'utf8');
  assert.match(button, /aria-haspopup=\{hasPopup\}/);
  assert.match(button, /aria-expanded=\{expanded\}/);
  const more = simBar().slice(simBar().indexOf('function MoreMenu('), simBar().indexOf('const ADVANCE_REFRESH_ATTEMPTS'));
  assert.match(more, /accessibilityLabel="More practice controls"\s*expanded=\{open\}\s*hasPopup="dialog"/);
});
