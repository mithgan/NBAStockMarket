import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelQueuedLabel,
  keepScoreTogether,
  continuesRun,
  NIGHT_RUN_CONTINUE_MS,
  RUN_CONTINUE_MS,
  runSpanFrom,
  emptyQuestionAfterGames,
  NOTHING_QUEUED,
  lockedWeekQuestion,
  practiceQuestion,
  QUESTION_NEWS_MS,
  queueEndedNotice,
  questionLeadsWithNews,
  menuResultText,
  seasonQueuedWeekName,
  SETTINGS_PANE_NAME,
  settingsPaneStop,
  themeTile,
} from './chromeView';
import { VARIANTS } from '../theme/variants';
import { newsFirst } from '../state/perGameNotices';

test('a question asked as games land leads with their news, and names shorts when one was held (walk 18 T4-06)', () => {
  const news = "Your score rose $86.5K in the Oct 21–27 games. Cade Cunningham's short ended after 7 days: +$86.5K in all. Moves pause for the Oct 28 games.";
  const asked = emptyQuestionAfterGames(lockedWeekQuestion('2025-10-28'), { news, shortsEnded: true });
  assert.equal(asked.title, 'Play a week with nobody on your roster or shorts?');
  // The week's result first; the lock is said once, by the question's own line.
  assert.equal(asked.lines[0], "Your score rose $86.5K in the Oct 21–27 games. Cade Cunningham's short ended after 7 days: +$86.5K in all.");
  assert.equal(asked.lines[1], 'Moves are locked for the Oct 28 games and reopen after them.');
  assert.equal(asked.lines.filter((line) => /Moves (?:pause|are locked)/.test(line)).length, 1);
  // The answers are the locked question's own.
  assert.equal(asked.primaryLabel, '+1 night instead');
  assert.equal(asked.secondLabel, 'Play the week');
  // The unlocked questions too.
  const night = emptyQuestionAfterGames(practiceQuestion('empty-night', '', 'Oct 30'), { news: 'Your score fell $12K in the Oct 29 games.', shortsEnded: true });
  assert.equal(night.title, 'Play with nobody on your roster or shorts?');
  assert.equal(night.lines[0], 'Your score fell $12K in the Oct 29 games.');
  assert.equal(night.confirmLabel, 'Play anyway');
});

test('a question asked with no games just in, or none held, reads as before', () => {
  const plain = lockedWeekQuestion('2025-10-28');
  assert.deepEqual(emptyQuestionAfterGames(plain, { news: null, shortsEnded: false }), plain);
  const week = practiceQuestion('empty-week', '');
  const same = emptyQuestionAfterGames(week, { news: null, shortsEnded: false });
  assert.equal(same.title, 'Play a week with nobody on your roster?');
  assert.deepEqual(same.lines, week.lines);
});

test('a queued press always leads with the news; a fresh one only within a moment of the games landing', () => {
  assert.equal(questionLeadsWithNews(true, null), true);
  assert.equal(questionLeadsWithNews(false, 300), true);
  assert.equal(questionLeadsWithNews(false, QUESTION_NEWS_MS), true);
  assert.equal(questionLeadsWithNews(false, QUESTION_NEWS_MS + 1), false);
  assert.equal(questionLeadsWithNews(false, null), false);
});

test('queued presses dropped after a short ended say "nobody is on your roster or shorts"', () => {
  assert.equal(queueEndedNotice(['week'], 'empty-roster', true), 'Queued week not played: nobody is on your roster or shorts.');
  assert.equal(queueEndedNotice(['week'], 'empty-roster'), 'Queued week not played: nobody is on your roster.');
  assert.equal(queueEndedNotice(['week'], 'season-over', true), 'Queued week not played: the season is over.');
});

test('Cancel reads "Nothing queued" the moment the queue empties, in its place and size (walk 18 T4-04)', () => {
  assert.equal(cancelQueuedLabel([], false), NOTHING_QUEUED);
  assert.equal(cancelQueuedLabel([], true), 'Nothing\nqueued');
  // Never "Cancel queued" with nothing to drop.
  assert.ok(!/^Cancel/.test(cancelQueuedLabel([], false)));
  assert.ok(!/^Cancel/.test(cancelQueuedLabel([], true)));
  // With presses waiting it says what a press drops, as before.
  assert.equal(cancelQueuedLabel(['week'], false), 'Cancel queued week');
  assert.equal(cancelQueuedLabel(['week', 'week'], false), 'Cancel 2 queued weeks');
  assert.equal(cancelQueuedLabel(['week'], true), 'Cancel\nqueued');
  assert.equal(cancelQueuedLabel(['week', 'night', 'week'], true), 'Cancel\n3 queued');
  // Two short lines folded, as "Cancel / queued" had.
  assert.equal(cancelQueuedLabel([], true).split('\n').length, 2);
});

test('+1 week is named for what a press does once the rest of the season is queued (walk 18 T3-12)', () => {
  const weeks = Array.from({ length: 7 }, () => 'week' as const);
  const name = seasonQueuedWeekName('2026-04-12', weeks);
  assert.equal(name, '+1 week: the rest of the season is queued, to Apr 12 (7 weeks). Cancel drops it.');
  // Its visible words first (voice control), and no promise of a week.
  assert.ok(name.startsWith('+1 week'));
  assert.ok(!/advance one week/.test(name));
  // Cancel in More (a folded row) says where it is, as the queue's line does.
  assert.equal(seasonQueuedWeekName('2026-04-12', ['night', 'week'], 'more'), '+1 week: the rest of the season is queued, to Apr 12 (1 night and 1 week). Cancel (in More) drops it.');
});

test('+1 night pressed after reading the last night starts a notice of its own; a quick double press is one run (walk 18 T2-10)', () => {
  // About once a second, on purpose: each night on its own.
  assert.equal(continuesRun(false, 1100, 'night'), false);
  assert.equal(continuesRun(false, NIGHT_RUN_CONTINUE_MS + 1, 'night'), false);
  // A quick double press (walk 7 T4-03) and a press queued behind a night still join.
  assert.equal(continuesRun(false, 430, 'night'), true);
  assert.equal(continuesRun(true, null, 'night'), true);
  assert.ok(NIGHT_RUN_CONTINUE_MS < RUN_CONTINUE_MS);
  // +1 week keeps its moment.
  assert.equal(continuesRun(false, 1100, 'week'), true);
  assert.equal(continuesRun(false, 1100), true);
});

test("a run's span starts on its first night with games (walk 18 T2-10, T2-03)", () => {
  // From Oct 28, +1 night plays Oct 30 (no games Oct 29): the run counts from Oct 30.
  assert.equal(runSpanFrom('2025-10-28', '2025-10-30', 'night'), '2025-10-29');
  // Play to the end on its own from Nov 17, next games Nov 19: "Nov 19–Apr 12 games".
  assert.equal(runSpanFrom('2025-11-17', '2025-11-19', null), '2025-11-18');
  // Games the next day: nothing to skip.
  assert.equal(runSpanFrom('2025-10-27', '2025-10-28', 'night'), '2025-10-27');
  // A run that began with +1 week keeps the week's first day, as its notice named it.
  assert.equal(runSpanFrom('2025-10-28', '2025-10-30', 'week'), '2025-10-28');
  // Nothing known: as it was.
  assert.equal(runSpanFrom('2025-10-28', null, 'night'), '2025-10-28');
  assert.equal(runSpanFrom(null, '2025-10-21', 'night'), null);
});

test('the Restart and Exit questions keep "score -$250" together (walk 18 T1-08)', () => {
  assert.equal(keepScoreTogether('Day 0 of 174, 1 player, score -$250'), 'Day 0 of 174, 1 player, score\u00a0-\u2060$250');
  assert.equal(keepScoreTogether('Day 16 of 174, score +$120K'), 'Day 16 of 174, score\u00a0+\u2060$120K');
  assert.equal(keepScoreTogether('Day 0 of 174, no players, score $0'), 'Day 0 of 174, no players, score\u00a0$0');
  const restart = practiceQuestion('restart', 'Day 0 of 174, 1 player, score -$250');
  assert.equal(restart.lines[0], "You'd lose this season: Day 0 of 174, 1 player, score\u00a0-\u2060$250.");
  // The words read the same (no break chars other than a no-break space and a word joiner).
  assert.equal(restart.lines[0].replace(/\u2060/g, '').replace(/\u00a0/g, ' '), "You'd lose this season: Day 0 of 174, 1 player, score -$250.");
  assert.match(practiceQuestion('exit', 'Day 3 of 174, score -$9K').lines[0], /score\u00a0-\u2060\$9K\.$/);
});

test("Settings' tiles paint each look's own ground, card and accent, so Navy, Dark and Aurora differ (walk 18 T1-04)", () => {
  const navy = themeTile(VARIANTS.grain);
  const dark = themeTile(VARIANTS.dark);
  const aurora = themeTile(VARIANTS.nocturne);
  // Their own grounds and cards.
  assert.equal(navy.ground, VARIANTS.grain.palette.background);
  assert.equal(dark.ground, '#040506');
  assert.equal(aurora.ground, '#161d2b');
  assert.equal(aurora.card, '#1f2736');
  assert.equal(new Set([navy.ground, dark.ground, aurora.ground]).size, 3);
  // What sets each apart: Navy's grain, Dark flat near-black, Aurora's warm glow.
  assert.ok(navy.grain);
  assert.equal(dark.grain, null);
  assert.equal(aurora.grain, null);
  assert.equal(aurora.glow, '#e8833a');
  assert.equal(navy.glow, null);
  assert.equal(dark.glow, null);
  // Light and High contrast keep their plain tiles.
  assert.equal(themeTile(VARIANTS.light).grain, null);
  assert.equal(themeTile(VARIANTS.contrast).glow, null);
});

test("Settings' scrolling content is no Tab stop of its own while controls are in view (walk 18 T3-02)", () => {
  // Controls in view: Tab goes from Done to the first choice.
  assert.equal(settingsPaneStop(true, 3), false);
  assert.equal(settingsPaneStop(false, 3), false);
  // Nothing to scroll: never a stop.
  assert.equal(settingsPaneStop(false, 0), false);
  // 400% zoom scrolled to the season notes: a named stop the keyboard can reach and scroll.
  assert.equal(settingsPaneStop(true, 0), true);
  assert.equal(SETTINGS_PANE_NAME, 'Settings, scrolls');
});

test("More's result at 400% reads news first, the lock left to its own note (walk 18 T3-06)", () => {
  assert.equal(
    menuResultText('Oct 21–27 games: your score fell $158K. Moves pause for the Oct 28 games.', newsFirst),
    'Your score fell $158K in the Oct 21–27 games.',
  );
  assert.equal(menuResultText('Oct 21–27 games: your score fell $158K.', newsFirst), 'Your score fell $158K in the Oct 21–27 games.');
  // A notice that is only the lock keeps its words.
  assert.equal(menuResultText('Moves pause for the Oct 28 games.', newsFirst), 'Moves pause for the Oct 28 games.');
});
