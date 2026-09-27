import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { advanceTap, NO_ADVANCE_TAPS, queueEndedNotice, queueingAdvanceName, SEASON_DONE_SLOT } from './chromeView';

const simBar = () => readFileSync(resolve(import.meta.dirname, '../components/SimBar.tsx'), 'utf8');

test('the practice queue and its run live above the frame layouts, so a rotation keeps them (walk 13 T4-09)', () => {
  const source = simBar();
  const controls = source.slice(source.indexOf('export function PracticeControls('));
  // The queue, the run and the step playing are the shared engine's, not the controls' own.
  assert.match(controls, /const queuedSteps = practiceEngine\.queuedSteps;/);
  assert.match(controls, /const runRef = practiceEngine\.run;/);
  assert.match(controls, /useSharedState\(playingState\)/);
  assert.match(controls, /useSharedState\(runOverState\)/);
  // No unmount clears them: controls a rotation takes away leave the queue for the next ones.
  assert.doesNotMatch(controls, /useEffect\(\(\) => \(\) => \{\s*publishQueued\(NO_QUEUE\)/);
  assert.doesNotMatch(controls, /useEffect\(\(\) => \(\) => stopQueueLine\(\), \[\]\)/);
  // The run's Cancel slot ends on the controls mounted now.
  assert.match(controls, /setTimeout\(\(\) => practiceEngine\.endRunSlot\.current\?\.\(\), RUN_CONTINUE_MS\)/);
});

test('queued presses that end without playing are said with the reason (walk 13 T4-09)', () => {
  assert.equal(queueEndedNotice([], 'empty-roster'), null);
  assert.equal(queueEndedNotice(['week'], 'empty-roster'), 'Queued week not played: nobody is on your roster.');
  assert.equal(queueEndedNotice(['week', 'week'], 'empty-roster'), '2 queued weeks not played: nobody is on your roster.');
  assert.equal(queueEndedNotice(['night', 'week'], 'season-over'), '1 queued night and 1 week not played: the season is over.');
});

test('a folded row never puts a season-changing button where +1 night was (walk 13 T4-10)', () => {
  const source = simBar();
  const controls = source.slice(source.indexOf('export function PracticeControls('));
  // Words only; the status line above says "Season complete", so the slot says where to go next.
  assert.equal(SEASON_DONE_SLOT, 'New season is in More');
  // The early season-end row (Restart and Exit in the advance buttons' place) skips folded rows.
  assert.match(controls, /\(compact \|\| phoneRow\) && progress\.complete && !folded\)/);
  const folded = controls.slice(controls.indexOf('  if (folded) {'));
  assert.match(folded, /progress\.complete \? \(\s*<View style=\{\[styles\.seasonDone/);
  // The way on waits in More.
  assert.match(folded, /menu\(progress\.complete \? <>\{secondaryButtons\(true\)\}\{rulesItem\}<\/>/);
  // A tap on the advance spot within a moment of the end is the same run.
  assert.match(controls, /if \(progress\.complete && seasonEndRepeat\(\)\) return;/);
});

test('a steady run of taps is judged by when each finger went down, so a slow frame never drops one (walk 13 T4-01)', () => {
  const plays = (times: number[]) => {
    let state = NO_ADVANCE_TAPS;
    let total = 0;
    for (const at of times) {
      const tap = advanceTap(state, at);
      state = tap.state;
      total += tap.plays;
    }
    return total;
  };
  // Finger-down times of the walk's run (pointerdown gaps 299, 265, 408 ms): four weeks.
  assert.equal(plays([0, 299, 564, 972]), 4);
  // The same taps timed by their late clicks (the landing week held tap 3's back 140 ms): three.
  assert.equal(plays([0, 289, 693, 980]), 3);
  // An isolated double tap still counts once.
  assert.equal(plays([0, 292]), 1);
  assert.match(simBar(), /advanceTap\(advanceTaps\[step\], pressDownAt\(Date\.now\(\)\)\)/);
});

test('+1 week says what a press does while it would queue, and is not announced unavailable (walk 13 T3-06)', () => {
  assert.equal(queueingAdvanceName('week', { step: 'week', date: 'Oct 21–27' }, 0), '+1 week: queue another week; Oct 21–27 is playing');
  assert.equal(queueingAdvanceName('week', { step: 'night', date: 'Oct 21' }, 0), '+1 week: queue a week; Oct 21 is playing');
  assert.equal(queueingAdvanceName('night', { step: 'week', date: 'Oct 21–27' }, 2), '+1 night: queue another night; Oct 21–27 is playing');
  assert.equal(queueingAdvanceName('week', null, 0), '+1 week: queue a week; your move is saving');
  assert.equal(queueingAdvanceName('night', { step: 'night', date: null }, 0), '+1 night: queue another night; the games are playing');
  const source = simBar();
  // aria-disabled only where a press does nothing.
  assert.match(source, /const advanceUnavailable = progress\.complete \|\| \(advanceBusy && !pressQueues\);/);
  assert.equal((source.match(/disabled=\{advanceUnavailable\}/g) ?? []).length, 2);
});

test('a practice question is named by its heading and described by its lines, which stay readable (walk 13 T3-04)', () => {
  const source = simBar();
  const choices = source.slice(source.indexOf('function PracticeChoices('), source.indexOf('const QUESTION_TITLE_ID'));
  assert.match(choices, /'aria-labelledby': QUESTION_TITLE_ID, 'aria-describedby': QUESTION_LINES_ID/);
  assert.doesNotMatch(choices, /accessibilityLabel=\{\[title, \.\.\.lines\]\.join/);
  assert.match(choices, /nativeID=\{QUESTION_TITLE_ID\}/);
  assert.match(choices, /nativeID=\{QUESTION_LINES_ID\}/);
  assert.doesNotMatch(choices, /<Text key=\{line\}[^>]*aria-hidden/);
});

test('the Ready and empty-roster hints name the night +1 night plays (walk 13 T2-01)', async () => {
  const { emptyRosterHint, practiceWeekHint, readyHint, savingHint, keepControlNames } = await import('./chromeView');
  assert.equal(readyHint('2025-10-28'), 'Ready. +1 night plays the Oct 28 games.');
  assert.equal(emptyRosterHint('2025-10-21'), 'Add a player first. +1 night plays the Oct 21 games.');
  assert.equal(savingHint([{ verb: 'add' }], false, '2025-10-21'), 'Saving your add… then +1 night plays the Oct 21 games.');
  // +1 week's own description still follows each form.
  assert.equal(practiceWeekHint(keepControlNames(emptyRosterHint('2025-10-21')), 'Oct 21–27'), 'Add a player first. +1 week plays the Oct 21–27 games.');
  assert.equal(practiceWeekHint(keepControlNames(savingHint([{ verb: 'add' }], false, '2025-10-21')), 'Oct 21–27'), 'Saving your add… then +1 week plays the Oct 21–27 games.');
  assert.equal(practiceWeekHint(keepControlNames(readyHint('2025-10-21')), 'Oct 21–27'), 'Ready. +1 week plays the Oct 21–27 games.');
});

test('the folded phone row names the season from the second, keeps "Settings" and is the banner (walk 13 T4-04, T4-08, T1-11)', async () => {
  const { seasonTagged, CHROME_FOLDED_SETTINGS_WORD_MIN_WIDTH, CHROME_FOLDED_ONE_LINE_MIN_WIDTH } = await import('./chromeView');
  assert.equal(seasonTagged('Oct 20 · Day 0', 1), 'Oct 20 · Day 0');
  assert.equal(seasonTagged('Oct 20 · Day 0', 2), 'S2 · Oct 20 · Day 0');
  assert.equal(seasonTagged('Season complete', 3), 'S3 · Season complete');
  // A 320px phone gets the word; a 195px row keeps the icon on the day's line.
  assert.ok(320 >= CHROME_FOLDED_SETTINGS_WORD_MIN_WIDTH && 320 < CHROME_FOLDED_ONE_LINE_MIN_WIDTH);
  assert.ok(195 < CHROME_FOLDED_SETTINGS_WORD_MIN_WIDTH);
  const strip = readFileSync(resolve(import.meta.dirname, '../components/PerGameStatusStrip.tsx'), 'utf8');
  // One banner at every width wraps the frame (App, walk 14 T3-03): the row takes no role of its own,
  // never a role that switches at the fold (react-native-web would rebuild it).
  assert.doesNotMatch(strip, /role=\{short \? 'banner'/);
  const app = readFileSync(resolve(import.meta.dirname, '../../App.tsx'), 'utf8');
  assert.match(app, /<View role="banner">/);
});

test('every practice screen but the Market ends with "Back to the practice controls" (walk 13 T3-N1)', () => {
  const source = simBar();
  assert.match(source, /export const BACK_TO_CONTROLS_LABEL = 'Back to the practice controls';/);
  const hook = source.slice(source.indexOf('function useBackToControlsLink('), source.indexOf('export function SimBar('));
  assert.match(hook, /screen\.appendChild\(link\)/);
  assert.match(hook, /link\.hidden = screenName === 'Market'/);
  assert.match(hook, /!isMockActive\(\)\) return undefined;/);
  assert.match(source.slice(source.indexOf('export function SimBar(')), /useBackToControlsLink\(\);/);
});
