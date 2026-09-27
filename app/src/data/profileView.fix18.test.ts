import assert from 'node:assert/strict';
import test from 'node:test';

import { heldTag } from './marketView';
import { breakEvenLine, holdingStatus, stakeLine } from './profileView';

const none = { games: 0, total: 0 };

test('a just-added player before the first night: his games start with the season (walk 18 T1-01)', () => {
  // Practice day 0: the eve of the opener (Oct 20), the season opens Tue, Oct 21.
  const eve = { lastNight: '2025-10-20', nextNight: '2025-10-21', opens: '2025-10-21' };
  assert.deepEqual(
    stakeLine(none, true, 'long', { since: '2025-10-20', calendar: eve }),
    { lead: 'No games yet · the season opens Tue, Oct 21', total: null, tone: 'none' },
  );
  assert.equal(stakeLine(none, true, 'short', { since: '2025-10-20', calendar: eve })?.lead, 'No games yet · the season opens Tue, Oct 21');
  // Added after the Oct 25 games, before the next night is played: nothing missed yet.
  const midSeason = { lastNight: '2025-10-25', nextNight: '2025-10-26', opens: null };
  assert.equal(stakeLine(none, true, 'long', { since: '2025-10-25', calendar: midSeason })?.lead, 'No games yet · next games Sun, Oct 26');
  // A night played since the add, and he had no game in it: now he missed games.
  const after = { lastNight: '2025-10-26', nextNight: '2025-10-27', opens: null };
  assert.equal(stakeLine(none, true, 'long', { since: '2025-10-25', calendar: after })?.lead, 'No games since you added him (Oct 25)');
  assert.equal(stakeLine(none, true, 'short', { since: '2025-10-25', calendar: after })?.lead, 'No games since you shorted him (Oct 25)');
  // A re-add keeps "at this price"; games played lead with the result as before.
  assert.equal(stakeLine(none, true, 'long', { since: '2025-10-25', readd: true, calendar: midSeason })?.lead, 'No games yet at this price');
  assert.equal(stakeLine({ games: 1, total: 50_000 }, true, 'long', { since: '2025-10-20', calendar: eve })?.lead, 'Your result:');
  // Not held: no line.
  assert.equal(stakeLine(none, false, 'long', { calendar: eve }), null);
});

test('at season end the profile chip speaks of the season past, as the Market row does (walk 18 T2-01)', () => {
  for (const side of ['long', 'short'] as const) {
    const held = { side, lockedGameCost: 417_500, expiresOn: side === 'short' ? '2026-04-14' : null };
    assert.equal(holdingStatus(held, side, false, 439_500, true).tag, heldTag(side, true));
    // During the season, as before.
    assert.equal(holdingStatus(held, side, false, 439_500, false).tag, heldTag(side, false));
  }
  assert.equal(holdingStatus({ side: 'long', lockedGameCost: 417_500, expiresOn: null }, 'long', false, 439_500, true).tag, 'On your roster this season');
  assert.equal(holdingStatus({ side: 'short', lockedGameCost: 259_000, expiresOn: '2026-04-14' }, 'short', false, 250_000, true).tag, 'Shorted this season');
  // The line under it does not say "this season" twice.
  assert.doesNotMatch(holdingStatus({ side: 'long', lockedGameCost: 417_500, expiresOn: null }, 'long', false, 439_500, true).text, /season/i);
});

test('"a game" stays with its figure in the net points line (walk 18 T1-09)', () => {
  // The tester's 360px line: "Stays under his price at 8.4 or fewer net points a" / "game".
  const short = breakEvenLine(337_600, 40_000, 'raw_net_points', 'short');
  assert.equal(short, 'Stays under his price at 8.4\u00a0or\u00a0fewer\u00a0net\u00a0points\u00a0a\u00a0game');
  assert.equal(breakEvenLine(417_500, 40_000, 'raw_net_points', 'long'), 'Beats his price at 10.5+\u00a0net\u00a0points\u00a0a\u00a0game');
  // The line may wrap only before the figure: no breaking space after "at".
  for (const line of [short, breakEvenLine(417_500, 40_000, 'raw_net_points', 'long')]) {
    assert.match(String(line), /^(Beats|Stays under) his price at [^ ]+$/);
  }
});

test('until he plays for you, a market price off yours is named as your move\'s doing (walk 18 T1-03)', () => {
  const luka = { side: 'long' as const, lockedGameCost: 417_500, expiresOn: null };
  // Right after the add: the market moved to $418.5K, yours stays $417.5K.
  assert.deepEqual(holdingStatus(luka, 'long', false, 418_500, false, true), { tag: 'On your roster', text: 'Market $418.5K after your add' });
  const cade = { side: 'short' as const, lockedGameCost: 388_500, expiresOn: '2025-10-27' };
  assert.deepEqual(holdingStatus(cade, 'short', false, 387_600, false, true), {
    tag: 'Shorted',
    text: 'Ends Oct 27, market $387.6K after your short',
  });
  assert.equal(holdingStatus({ ...cade, expiresOn: null }, 'short', false, 387_600, false, true).text, 'Market $387.6K after your short');
  // After his first game for you, the short's line is as before.
  assert.equal(holdingStatus(cade, 'short', false, 387_600, false, false).text, 'Credited each game, ends Oct 27, market now $387.6K');
  // Once he has played for you, or when the market reads the same: as before.
  assert.equal(holdingStatus(luka, 'long', false, 418_500, false, false).text, 'Locked in, market now $418.5K');
  assert.equal(holdingStatus(luka, 'long', false, 417_520, false, true).text, 'Locked in, the same as the market');
  // While his move saves, and at season end: unchanged.
  assert.equal(holdingStatus(luka, 'long', true, 418_500, false, true).text, 'Dropping him from your roster…');
  assert.equal(holdingStatus(luka, 'long', false, 439_500, true, true).tag, 'On your roster this season');
});
