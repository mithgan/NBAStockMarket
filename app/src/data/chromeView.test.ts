import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { parsePerGameBootstrap } from '../api/contracts';
import { ROSTER_EXPLAINER, SHORT_EXPLAINER } from '../copy/terms';
import {
  chromeLayout,
  daysBetween,
  dividendBasisText,
  dividendText,
  explanationParagraphs,
  keepTogether,
  lockLineText,
  lockReopensText,
  nextGamesText,
  practiceDayText,
  practiceProgress,
  SEASON_TOTAL_DAYS,
  shortTermText,
  statusSummary,
} from './chromeView';
import { NEGATIVE_DIVIDEND_EXPLAINER, NET_POINTS_EXPLAINER, perGameRulesPresentation } from './perGameRules';

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

test('short phrases hold together when large text wraps', () => {
  assert.equal(keepTogether('Day 16 of 174'), 'Day\u00a016\u00a0of\u00a0174');
  assert.equal(keepTogether('Thu, Nov 6'), 'Thu,\u00a0Nov\u00a06');
  assert.equal(keepTogether('Nov 5'), 'Nov\u00a05');
});

test('layout: phones stack two short lines, wide screens use one line, large text wraps', () => {
  const base = { wide: false, merged: false, largeText: false, iconOnly: false, narrow: false, compact: false };
  assert.deepEqual(chromeLayout(390, 1), base);
  assert.deepEqual(chromeLayout(360, 1), { ...base, iconOnly: true });
  assert.deepEqual(chromeLayout(768, 1), { ...base, wide: true });
  assert.deepEqual(chromeLayout(1440, 1), { ...base, wide: true, merged: true });
  assert.deepEqual(chromeLayout(1440, 2), { ...base, largeText: true });
  assert.deepEqual(chromeLayout(360, 2), { ...base, largeText: true });
});

test('layout: narrow phones tighten, and a phone at 200% zoom goes compact', () => {
  // 340-359: tighter gutters, and the signed-in toolbar still icon-only beside the facts.
  assert.deepEqual(chromeLayout(350, 1), {
    wide: false, merged: false, largeText: false, iconOnly: true, narrow: true, compact: false,
  });
  // 320-339: the signed-in toolbar drops under the facts, so it keeps its labels.
  assert.equal(chromeLayout(330, 1).iconOnly, false);
  assert.equal(chromeLayout(330, 1).compact, false);
  // 390px at 200% zoom is 195 CSS px: compact.
  assert.deepEqual(chromeLayout(195, 1), {
    wide: false, merged: false, largeText: false, iconOnly: false, narrow: true, compact: true,
  });
  assert.equal(chromeLayout(319, 1).compact, true);
  assert.equal(chromeLayout(320, 1).compact, false);
});

test('the roster lock says when changes reopen, never just a date', () => {
  // A lock covers one game date and lifts once that date's games are settled.
  assert.equal(lockReopensText('2025-11-06'), 'reopens after Nov 6');
  assert.equal(lockReopensText(null), 'while games are on');
  assert.equal(lockLineText('2025-11-16'), 'Roster reopens after Nov 16');
  assert.equal(lockLineText(null), 'Roster locked for now');
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
    'Practice, Nov 5, day 16 of 174. Last night +$323,400. Next games Thu, Nov 6.',
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
    'Practice, Apr 12, season complete. Last night -$12,000. Restart to play again.',
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
    'Games through Nov 5. Last night $0. Next games Thu, Nov 6. Roster changes are locked for the Nov 6 game.',
  );
  assert.equal(
    statusSummary({ mode: 'live', lastSettledDate: null, nextGameDate: null, lastNight: null }),
    'No games settled yet. Next games not scheduled yet.',
  );
});

test('rule wording matches the shared rules copy for both dividend bases', () => {
  for (const dividendBasis of ['raw_net_points', 'surprise_vs_projection'] as const) {
    const facts = perGameRulesPresentation({ ...rules, dividendBasis }).facts;
    assert.equal(dividendBasisText(dividendBasis), facts.find((fact) => fact.label === 'Dividend basis')?.value);
  }
  assert.equal(dividendText('raw_net_points', 40_000), 'Net points scored · $40,000\u00a0per\u00a0net\u00a0point');
  assert.equal(shortTermText(7), 'A short closes after 7 days');
  assert.equal(shortTermText(1), 'A short closes after 1 day');
  assert.equal(shortTermText(null), 'A short stays open until you close it');
});

test('the rules explanation reads as short paragraphs without changing a word', () => {
  const markers = [ROSTER_EXPLAINER, SHORT_EXPLAINER, NEGATIVE_DIVIDEND_EXPLAINER];
  for (const dividendBasis of ['raw_net_points', 'surprise_vs_projection'] as const) {
    const { explanation } = perGameRulesPresentation({ ...rules, dividendBasis });
    const paragraphs = explanationParagraphs(explanation, markers);
    // Dividends and what net points are; the roster; shorts; the score; bad games.
    assert.equal(paragraphs.length, 5);
    assert.match(paragraphs[0], /^A player's dividend comes from/);
    assert.ok(paragraphs[0].endsWith(NET_POINTS_EXPLAINER));
    assert.equal(paragraphs[1], ROSTER_EXPLAINER);
    assert.equal(paragraphs[2], SHORT_EXPLAINER);
    assert.match(paragraphs[3], /^Your score is the total/);
    assert.equal(paragraphs[4], NEGATIVE_DIVIDEND_EXPLAINER);
    assert.equal(paragraphs.join(' '), explanation);
  }
  // Copy that no longer contains a shared sentence still renders, whole.
  assert.deepEqual(explanationParagraphs('Plain rules.', markers), ['Plain rules.']);
  assert.deepEqual(
    explanationParagraphs(`Intro. ${SHORT_EXPLAINER}`, markers),
    ['Intro.', SHORT_EXPLAINER],
  );
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
    lockReopensText('2025-11-06'),
    lockLineText('2025-11-06'),
    lockLineText(null),
  ].join('\n');
  assert.doesNotMatch(copy, /\binverse\b|\/GM\b|raw net points|cumulative|sandbox|\b\d{4}-\d{2}-\d{2}\b/i);
});
