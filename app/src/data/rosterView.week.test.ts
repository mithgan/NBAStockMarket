import assert from 'node:assert/strict';
import test from 'node:test';

import { MockPerGameApiClient } from '../api/mockPerGameClient';
import { money, signedMoney } from '../copy/terms';
import { refreshNotice } from '../state/perGameNotices';
import { earningsBetween, recentEarnings } from './perGameMetrics';
import { WEEK_LABEL } from './rosterView';

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round(
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
);

/**
 * The Roster header shows `<Money value={recentEarnings().week} />` under
 * WEEK_LABEL. With a single rostered player most days have no game for him,
 * which is where a week of game nights and a week of calendar days part ways,
 * so this plays practice's real engine one player deep and checks the header
 * figure against the notice the app shows after each 7-day advance.
 */
test('one rostered player: after each 7-day advance the notice equals the Last 7 days figure to the dollar', async () => {
  assert.equal(WEEK_LABEL, 'Last 7 days');
  const client = new MockPerGameApiClient();
  const opening = await client.bootstrap();
  const player = opening.market[0];
  await client.openPosition({
    playerId: player.playerId,
    side: 'long',
    expectedAccountVersion: opening.account.version,
    expectedQuoteVersion: player.quoteVersion,
  });

  let previous = await client.bootstrap();
  let thinWeeks = 0;
  let movingWeeks = 0;
  for (let week = 0; week < 8; week += 1) {
    const before = previous.game.lastSettledDate as string;
    client.advanceDays(7);
    const next = await client.bootstrap();
    const after = next.game.lastSettledDate as string;
    // Practice's week is exactly seven days on the clock.
    assert.equal(daysBetween(before, after), 7);

    const header = recentEarnings(next.ledger.items, after);
    assert.ok(header);
    // What the notice reports: games only, over exactly the days that settled.
    const settled = earningsBetween(next.ledger.items, before, after, { gamesOnly: true });
    assert.equal(header.week, settled, `week ${week + 1}: header ${header.week} vs notice ${settled}`);

    // The words on screen agree too: the notice's amount is the header's.
    const notice = refreshNotice(previous, next, false);
    if (settled === 0) {
      assert.match(notice, /no change to your score/);
      assert.equal(signedMoney(header.week), '$0');
    } else {
      assert.ok(
        notice.includes(`your score ${settled > 0 ? 'rose' : 'fell'} ${money(Math.abs(settled))}.`),
        notice,
      );
      assert.equal(signedMoney(header.week), `${settled > 0 ? '+' : '-'}${money(Math.abs(settled))}`);
      movingWeeks += 1;
    }
    if (header.weekNights < 7) thinWeeks += 1;
    previous = next;
  }
  // The case that used to disagree really happened: weeks in which he did not
  // play every night, and weeks in which the figure moved.
  assert.ok(thinWeeks > 0, 'expected weeks with fewer than seven game nights');
  assert.ok(movingWeeks > 0, 'expected weeks in which the score moved');
});
