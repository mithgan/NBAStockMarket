import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  cancelPlace,
  CHROME_FOLDED_CANCEL_MIN_WIDTH,
  foldedCancelLabel,
  queuedCancelControlName,
  queuedCancelHint,
  queueFullLine,
} from './chromeView';

const simBar = () => readFileSync(resolve(import.meta.dirname, '../components/SimBar.tsx'), 'utf8');

test('a tablet lays the practice bar out as one row: the hint beside the buttons, Cancel in Play to the end\'s place (walk 15 L1)', () => {
  const source = simBar();
  // No line under the buttons that comes and goes with the hint or Cancel.
  assert.doesNotMatch(source, /hintReserve|hintGap/);
  assert.match(source, /const tabletRow = !inline;/);
  assert.match(source, /const rowCancel = showCancel && !progress\.complete;/);
  assert.match(source, /tabletHintSlot/);
});

test('Cancel queued sits in a folded row wherever the row has room, and the words say where it is (walk 15 T4-01, T2-08)', () => {
  // Portrait phones, tablets and desktop: beside +1 week.
  assert.equal(cancelPlace(false, false, 390), 'week');
  assert.equal(cancelPlace(false, false, 1440), 'week');
  // Landscape 844x390 and a laptop at 150% (853x533): in the row, before +1 night.
  assert.equal(cancelPlace(true, false, 844), 'night');
  assert.equal(cancelPlace(true, false, 853), 'night');
  assert.equal(cancelPlace(true, false, CHROME_FOLDED_CANCEL_MIN_WIDTH), 'night');
  // Narrower folded rows (667x375 took a third line of facts) and 400% zoom: inside More.
  assert.equal(cancelPlace(true, false, 667), 'more');
  assert.equal(cancelPlace(true, true, 320), 'more');
  assert.equal(queueFullLine('2026-04-12'), 'The rest of the season is already queued, to the Apr 12 games. Cancel drops it.');
  assert.equal(queueFullLine('2026-04-12', 'night'), 'The rest of the season is already queued, to the Apr 12 games. Cancel drops it.');
  assert.equal(queueFullLine('2026-04-12', 'more'), 'The rest of the season is already queued, to the Apr 12 games. Cancel (in More) drops it.');
  assert.equal(queuedCancelHint(3), 'Press Cancel beside +1 week to drop them.');
  assert.equal(queuedCancelHint(1, 'night'), 'Press Cancel beside +1 night to drop it.');
  assert.equal(queuedCancelHint(2, 'more'), 'Press Cancel in More to drop them.');
  // Two short lines in the row; the name starts with the same words (voice control).
  assert.equal(foldedCancelLabel([]), 'Cancel\nqueued');
  assert.equal(foldedCancelLabel(['week']), 'Cancel\nqueued');
  assert.equal(foldedCancelLabel(['week', 'week', 'week']), 'Cancel\n3 queued');
  for (const queued of [['week'], ['week', 'week', 'week'], ['week', 'night']] as const) {
    assert.ok(queuedCancelControlName(queued).startsWith(foldedCancelLabel(queued).replace('\n', ' ')));
  }
  const source = simBar();
  assert.match(source, /\{cancelInRow \? cancelButton\('fold'\) : null\}/);
  assert.match(source, /cancelInRow \? null : cancelButton\('menu'\)/);
});

test('a practice question taller than its window opens at its title, focused; the way out is the next Tab (walk 15 T3-05)', () => {
  const source = simBar();
  assert.match(source, /panel\.getBoundingClientRect\(\)\.height > scroller\.clientHeight \+ 1/);
  assert.match(source, /scroller\.scrollTop = 0;\s+\(titleRef\.current as unknown as Focusable\)\?\.focus\?\.\(\{ preventScroll: true \}\);/);
  // The title is focusable by script only, and comes before the answers.
  assert.match(source, /\{\.\.\.\(\{ tabIndex: -1 \} as object\)\}\s+nativeID=\{QUESTION_TITLE_ID\}/);
});

test('a landscape row keeps Rules beside More where it fits; narrower folded rows keep it in More (walk 15 T1-05)', async () => {
  const { rulesInFoldedRow, CHROME_FOLDED_RULES_MIN_WIDTH } = await import('./chromeView');
  assert.equal(rulesInFoldedRow(false, 844), true);
  assert.equal(rulesInFoldedRow(false, 853), true);
  assert.equal(rulesInFoldedRow(false, CHROME_FOLDED_RULES_MIN_WIDTH - 1), false);
  assert.equal(rulesInFoldedRow(false, 812), false);
  assert.equal(rulesInFoldedRow(true, 900), false);
  const strip = readFileSync(resolve(import.meta.dirname, '../components/PerGameStatusStrip.tsx'), 'utf8');
  assert.match(strip, /onRules=\{rulesInRow \? undefined : \(\) => setRulesOpen\(true\)\}/);
  assert.match(strip, /\{folded && !rulesInRow \? null : \(/);
});

test('at season end the Roster\'s folded row leaves the slot blank under the card\'s gold button, and More separates Restart everywhere (walk 15 T1-06, T1-07)', () => {
  const source = simBar();
  assert.match(source, /\{screenName === 'Roster' \? null : \(\s+<Text maxFontSizeMultiplier=\{1\.3\} numberOfLines=\{2\} style=\{styles\.seasonDoneNext\}>\{SEASON_DONE_SLOT\}<\/Text>/);
  assert.match(source, /\{playToEndButton\(false, true\)\}<View style=\{styles\.menuDivider\} \/>\{secondaryButtons\(true\)\}/);
  assert.match(source, /\{progress\.complete \? null : <View style=\{styles\.menuDivider\} \/>\}\s+\{secondaryButtons\(true\)\}\s+\{settingsItem\}/);
});

test('Restart and Exit say what each answer does to queued weeks; Play to the end names shorts only when some are held (walk 15 T4-02, T2-12)', async () => {
  const { queuedAnswerLine, playToEndQuestion } = await import('./chromeView');
  assert.equal(queuedAnswerLine([], 'Keep playing', 'Start over'), null);
  assert.equal(queuedAnswerLine(['week', 'week', 'week'], 'Keep playing', 'Start over'), '3 weeks are queued: Keep playing plays them; Start over drops them.');
  assert.equal(queuedAnswerLine(['week'], 'Keep playing', 'Leave practice'), '1 week is queued: Keep playing plays it; Leave practice drops it.');
  assert.equal(queuedAnswerLine(['night', 'week'], 'Keep playing', 'Start over'), '1 night and 1 week are queued: Keep playing plays them; Start over drops them.');
  assert.deepEqual(playToEndQuestion(158, false, []).lines.slice(1), ['Your roster stays as it is; no moves between nights.']);
  assert.doesNotMatch(playToEndQuestion(158, false, []).lines.join(' '), /short/);
  assert.match(playToEndQuestion(170, false, ['2025-10-31']).lines.join(' '), /Your short ends by itself after Oct 31/);
  assert.match(simBar(), /asked\.kind === 'restart' \|\| asked\.kind === 'exit'\s+\? queuedAnswerLine\(queued, prompt\.cancelLabel, prompt\.confirmLabel\)/);
});

test('with the rest of the season queued, +1 night and +1 week draw quiet (walk 15 T4-03)', () => {
  const source = simBar();
  assert.match(source, /const seasonQueued = advanceBusy && isGameplayReady && !progress\.complete && playing\?\.step !== 'end' && !endQueued && !pressQueues;/);
  assert.match(source, /const quietNight = advanceQuiet\('night', emptyRoster, lockedNight\) \|\| seasonQueued;/);
  assert.match(source, /const quietWeek = advanceQuiet\('week', emptyRoster, lockedNight\) \|\| seasonQueued;/);
});

test('weeks queued behind a saving move are described as a queue, dated from the first press (walk 15 T2-03)', async () => {
  const { savingQueueHint, queuedThrough } = await import('./chromeView');
  const add = [{ verb: 'add' as const }];
  const plain = (text: string) => text.replace(/\u00a0/g, ' ').replace(/\u2060/g, '');
  assert.equal(plain(savingQueueHint(add, ['week', 'week', 'week'], '2025-10-20', '2026-04-12')), 'Saving your add… then Oct 21–Nov 10 plays (3 weeks).');
  assert.match(savingQueueHint(add, ['week'], '2025-10-20', '2026-04-12'), /^Saving your add… then Oct.21.*27 plays \(1 week\)\.$/);
  assert.equal(savingQueueHint([{ verb: 'add' }, { verb: 'add' }], ['night'], '2025-10-20', '2026-04-12'), 'Saving 2 adds… then 1 night plays.');
  // "Queued through" needs no step playing: the first queued press dates it.
  assert.equal(queuedThrough('2025-10-20', null, ['week', 'week', 'week'], '2026-04-12'), '2025-11-10');
  const source = simBar();
  assert.doesNotMatch(source, /isMockActive\(\) \|\| playing === null\) return null;/);
  assert.match(source, /\(emptyRoster \|\| rosterEmptyOn === settledOn\) && !playingNow \? savingHolds\(pendingActions, bootstrap\) : \[\]/);
});

test('+1 week is named with the dates it plays, like +1 night (walk 15 T3-06)', async () => {
  const { weekButtonName, weekSpanLabel, nightButtonName } = await import('./chromeView');
  const plain = (text: string) => text.replace(/ /g, ' ').replace(/⁠/g, '');
  assert.equal(plain(weekButtonName(weekSpanLabel('2025-10-29', '2026-04-12'))), '+1 week Oct 30–Nov 5: play the Oct 30–Nov 5 games');
  assert.equal(weekButtonName(null), '+1 week: advance one week');
  // The same shape as +1 night's name: visible words first.
  assert.equal(nightButtonName('Oct 30', true), '+1 night Oct 30: play the Oct 30 games');
  assert.match(simBar(), /: playingWeek \? `\+1 week: advance one week\. \$\{playingText\}` : weekButtonName\(nextWeekSpan\)\)\}/);
});
