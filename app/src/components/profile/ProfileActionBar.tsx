/**
 * The profile's action bar: the move his market row offers, where you read
 * about him. Add or Short when you do not hold him, Drop or Close when you do,
 * with the same locks as the row (a pending action, another account change,
 * a locked roster, a full side, the season's end). A dimmed button always has
 * its reason written beside it. While a move saves the button reads "Adding…"
 * (solid: busy, not locked) with a status line; once it lands it turns into a
 * brief "Added ✓", named like the Market row's ("Added Devin Booker to your
 * roster"), so a second tap cannot land on the Drop that replaces it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { PerGameMarketPlayer, PerGamePosition, PerGamePositionSide } from '../../api/contracts';
import { isMockActive, mockSeasonStart } from '../../api/mockPerGameClient';
import {
  confirmCloseButton,
  confirmCloseMessage,
  confirmCloseName,
  moneyFine,
  openVerb,
  rosterReopensLine,
} from '../../copy/terms';
import { practiceProgress } from '../../data/chromeView';
import { actionName, fullNote, isSeasonOver, justClosedName, justOpenedName } from '../../data/marketView';
import { moveSaving, openTermsNote, profileCloseName, profileCloseWord, savingWords } from '../../data/profileView';
import { usePerGame } from '../../state/PerGameContext';
import { buildPerGameMarketRows } from '../../state/perGameState';
import { openTab, requestRosterPick } from '../../state/uiActions';
import { colors, space, type } from '../../theme';
import { Button, ConfirmStrip, repeatSafe, useCooldown } from '../../ui/kit';
import { sheetIsOpen } from '../../web/appHistory';

export function ProfileActionBar({ player, position, side, onSwitchSide, onLeave }: {
  player: PerGameMarketPlayer;
  /** The position you hold on him now, on either side. */
  position: PerGamePosition | null;
  /**
   * The side the bar offers, which the whole profile reads from: his
   * position's side, else the market tab he was opened from, or the side
   * "Short instead" / "Add instead" switched to (profileView's profileSide).
   */
  side: PerGamePositionSide;
  /**
   * "Short instead" / "Add instead": the profile switches to the other side's
   * terms, figures and all (walk 4 T1-03); only the main button makes the move
   * (walk 3 T2-06: it used to short at once).
   */
  onSwitchSide: (side: PerGamePositionSide) => void;
  /** Closes the profile (for "Choose who to drop", which leaves for the Roster). */
  onLeave?: () => void;
}) {
  const { bootstrap, closePosition, notify, openPosition, pendingActions } = usePerGame();
  // A brief tick after a move lands ("Added ✓"), in the button's place.
  const [done, showDone] = useCooldown();
  const [doneWords, setDoneWords] = useState({ tick: '', note: '', name: '' });
  // Keyboard focus follows the move: onto the tick while it shows, then onto
  // the button that replaces it (Drop after an Add, Add after a Drop), so it
  // never falls out of the sheet to the page (walk-2 T2-24, in the profile).
  const doneRef = useRef<View>(null);
  const openRef = useRef<View>(null);
  const follow = useRef(false);
  const finish = (tick: string, note: string, name: string) => {
    setDoneWords({ tick, note, name });
    follow.current = true;
    showDone();
  };
  // Drop and Close ask once more in the kit's ConfirmStrip. Keep hands focus
  // back to the Drop button it replaced.
  const [confirming, setConfirming] = useState(false);
  const closeRef = useRef<View>(null);
  const refocus = useRef(false);
  const cancel = useCallback(() => {
    refocus.current = true;
    setConfirming(false);
  }, []);
  useEffect(() => {
    if (confirming || !refocus.current) return;
    refocus.current = false;
    (closeRef.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [confirming]);
  useEffect(() => {
    setConfirming(false);
  }, [position?.positionId]);
  useEffect(() => {
    if (!follow.current || typeof document === 'undefined') return;
    // Only when focus was lost with the button (not if you moved on).
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected
      || active === (doneRef.current as unknown as Element | null);
    if (done) {
      if (lost) focusView(doneRef.current);
      return;
    }
    follow.current = false;
    if (lost) focusView(closeRef.current ?? openRef.current);
  }, [done]);
  const row = useMemo(
    () => (bootstrap && !position
      ? buildPerGameMarketRows(bootstrap, side).find((entry) => entry.player.playerId === player.playerId) ?? null
      : null),
    [bootstrap, player.playerId, position, side],
  );
  // The other side, offered quietly beside the main move (walk-2 T2-23), so
  // you can short a player you opened from the roster side, or the reverse,
  // without closing him, switching the market's side and reopening him.
  const otherSide: PerGamePositionSide = side === 'long' ? 'short' : 'long';
  const otherRow = useMemo(
    () => (bootstrap && !position
      ? buildPerGameMarketRows(bootstrap, otherSide).find((entry) => entry.player.playerId === player.playerId) ?? null
      : null),
    [bootstrap, otherSide, player.playerId, position],
  );
  // Nothing to offer still leaves the bar's rule, the one line between his
  // status and "Game by game" (walk 8 T1-06).
  if (!bootstrap) return <View style={styles.rule} />;

  // A move waiting its turn counts as pending; another player's move does not
  // rest this bar (a press waits its turn; walk 5 T4-01).
  const pending = moveSaving(pendingActions, side, player.playerId);
  const rosterLocked = bootstrap.ruleset.rosterMutationsLocked;
  const fee = bootstrap.ruleset.transactionFeeDollars;
  const seasonOver = isSeasonOver({
    practiceComplete: isMockActive() && practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).complete,
    lastSettledDate: bootstrap.game.lastSettledDate,
    nextGameDate: bootstrap.game.nextGameDate,
  });
  const lockLine = `Roster changes are locked. ${rosterReopensLine(bootstrap.ruleset.rosterLockGameDate)}.`;

  // Just added, shorted, dropped or closed: a quiet tick where the button
  // was, a button named for what happened (walk 8 T3-12: an unnamed block
  // held focus and read "Added check mark").
  if (done) {
    return (
      <Bar note={doneWords.note}>
        <Button
          ref={doneRef}
          accessibilityLabel={doneWords.name}
          disabled
          done
          focusableWhenDisabled
          label={doneWords.tick}
          onPress={() => undefined}
          style={styles.action}
        />
      </Bar>
    );
  }
  if (seasonOver) return <Bar note="The season is over. No more adds, drops or shorts." />;
  if (position) {
    const held = position.side;
    const disabled = pending || rosterLocked;
    if (confirming && !disabled) {
      return (
        <ConfirmStrip
          confirmAccessibilityLabel={confirmCloseName(held, player.name, fee)}
          confirmLabel={confirmCloseButton(held, fee)}
          // One wording with the Roster and Market: fee, what stays, and what
          // coming back would cost today.
          message={confirmCloseMessage({
            side: held,
            playerName: player.name,
            feeDollars: fee,
            total: position.cumulativePnl,
            endsFreeAfter: position.expiresOn,
            priceNow: player.currentGameCost,
          })}
          onCancel={cancel}
          onConfirm={() => {
            setConfirming(false);
            void closePosition(position).then((ok) => {
              if (!ok) return;
              if (held === 'long') finish('Dropped ✓', `${player.name} is off your roster.`, justClosedName(held, player.name));
              else finish('Closed ✓', `Your short on ${player.name} is closed.`, justClosedName(held, player.name));
            });
          }}
          style={styles.strip}
        />
      );
    }
    const costs = fee > 0
      ? `${held === 'long' ? 'Dropping him' : 'Closing the short'} costs ${moneyFine(fee)}.`
      : held === 'long' ? 'Dropping him frees a roster spot.' : 'Closing frees a short slot.';
    const closing = pending ? savingWords('close', held, player.name) : null;
    return (
      <Bar note={closing ? closing.note : rosterLocked ? lockLine : costs} warn={rosterLocked && !closing}>
        <Button
          ref={closeRef}
          accessibilityHint={rosterLocked && !closing ? lockLine : undefined}
          // "Close short" / "Drop player": the sheet's × also closes, so a
          // bare "Close" read like closing the panel (walk 6 T2-04).
          accessibilityLabel={closing ? closing.name : profileCloseName(held, player.name)}
          disabled={disabled}
          focusableWhenDisabled
          label={closing ? closing.word : rosterLocked ? 'Locked' : profileCloseWord(held)}
          // A tap on LOCKED says why, as well as the line beside it.
          onDisabledPress={rosterLocked ? () => notify(lockLine) : undefined}
          onPress={() => {
            if (!disabled) setConfirming(true);
          }}
          // Busy, not locked: a solid edge and full-contrast words.
          style={[styles.action, closing && styles.busy]}
          textStyle={closing ? styles.busyText : undefined}
          variant="secondary"
        />
      </Bar>
    );
  }
  // Not in today's market (a roster-only record): nothing to open.
  if (!row) return <View style={styles.rule} />;
  if (row.blockedByOpposingPosition) return <Bar note={row.unavailableReason ?? ''} />;

  const open = (which: PerGamePositionSide) => {
    void openPosition({
      playerId: player.playerId,
      playerName: player.name,
      side: which,
      expectedQuoteVersion: player.quoteVersion,
    }).then((ok) => {
      if (!ok) return;
      if (which === 'long') finish('Added ✓', `${player.name} is on your roster.`, justOpenedName(which, player.name));
      else finish('Shorted ✓', `You're shorting ${player.name}.`, justOpenedName(which, player.name));
    });
  };
  // While its own move is pending it stays, dimmed, so focus stays on it.
  const otherPending = moveSaving(pendingActions, otherSide, player.playerId);
  const otherBlocked = otherPending || pending;
  const instead = otherRow && !rosterLocked && (otherPending || (otherRow.canSubmit && !otherRow.isFull)) ? (
    <Button
      accessibilityLabel={`${openVerb(otherSide)} instead: show the ${otherSide === 'short' ? 'short' : 'roster'} terms`}
      disabled={otherBlocked}
      focusableWhenDisabled
      label={otherPending ? 'Wait' : `${openVerb(otherSide)} instead`}
      // "Add instead" takes the place of "Short instead": a double tap's
      // second tap would switch straight back, so it acts once (walk 6 T4-11).
      onPress={repeatSafe(() => {
        if (otherBlocked) return;
        // Switch the bar, don't trade: the terms, the main button and the
        // profile's figures change, and focus moves to that button.
        onSwitchSide(otherSide);
        setTimeout(() => focusView(openRef.current, true), 0);
      })}
      style={styles.instead}
      variant="quiet"
    />
  ) : null;

  // Full: say so in full, and offer the way forward instead of a dead FULL.
  if (row.isFull && /full/i.test(row.unavailableReason ?? '') && !rosterLocked && !pending) {
    const limit = side === 'long' ? bootstrap.account.longSlots.limit : bootstrap.account.shortSlots.limit;
    const { message, action } = fullNote(side, player.name, limit);
    const why = side === 'long'
      ? `Pick a player to drop to make room for ${player.name}.`
      : `Pick a short to close to make room for ${player.name}.`;
    return (
      <Bar below={instead} note={message} warn>
        <Button
          accessibilityLabel={`${action} to ${side === 'long' ? 'add' : 'short'} ${player.name}`}
          label={action}
          onPress={() => leaveForRoster(why, side, onLeave, notify, { playerId: player.playerId, playerName: player.name })}
          style={styles.action}
          variant="secondary"
        />
      </Bar>
    );
  }

  const disabled = !row.canSubmit || pending || rosterLocked;
  const reason = rosterLocked ? lockLine : row.unavailableReason;
  // Both sides lock his price: a short is credited it each game (walk 5
  // T1-11: never a "credit" of his own). A short also says how long it runs
  // and the day it ends by itself, before you pay (walk 6 T1-11). The fee
  // reads like every other figure ("$1.25K" from $1,000).
  const note = reason ?? openTermsNote({
    side,
    priceDollars: player.currentGameCost,
    feeDollars: fee,
    shortTermDays: bootstrap.ruleset.shortTermDays,
    nextGameDate: bootstrap.game.nextGameDate,
  });
  // Saving: "Adding…" with a line saying so (walk 8 T4-11); the other side's
  // switch steps aside until it lands (an empty slot keeps the button where
  // it was, so nothing under a finger moves).
  const saving = pending ? savingWords('open', side, player.name) : null;
  const word = saving ? saving.word : rosterLocked ? 'Locked' : row.isFull ? 'Full' : openVerb(side);
  return (
    <Bar below={saving && instead ? <View /> : instead} note={saving ? saving.note : note} warn={reason !== null && !saving}>
      <Button
        ref={openRef}
        accessibilityHint={saving ? undefined : reason ?? undefined}
        accessibilityLabel={saving ? saving.name : actionName('open', side, player.name, player.currentGameCost)}
        disabled={disabled}
        focusableWhenDisabled
        label={word}
        onDisabledPress={reason && !saving ? () => notify(reason) : undefined}
        onPress={() => {
          if (!disabled) open(side);
        }}
        // Busy, not locked: a solid gold edge and full-contrast words.
        style={[styles.action, saving && styles.busy]}
        textStyle={saving ? styles.busyText : undefined}
        variant="primary"
      />
    </Bar>
  );
}

function focusView(node: unknown, reveal = false) {
  const view = node as { focus?: (options?: object) => void; scrollIntoView?: (options?: object) => void } | null;
  view?.focus?.({ preventScroll: true });
  // The bar's new main button after a side switch comes fully into view: the
  // bar grows a line or two, and on a short window (a phone at 200% zoom) its
  // lower edge and focus ring sat under the bottom of the screen (walk 10 T3-12).
  if (reveal) view?.scrollIntoView?.({ block: 'nearest' });
}

/**
 * "Choose who to drop": the Roster says why when it opens, the profile closes,
 * and the Roster tab opens once the sheet has stepped Back out of its history
 * entry, so one Back from the Roster returns to the Market. Opened over the
 * Roster itself, the list is already behind the sheet: close it and say why.
 */
function leaveForRoster(
  why: string,
  side: 'long' | 'short',
  close: (() => void) | undefined,
  say: (text: string) => void,
  target?: { playerId: string; playerName: string },
) {
  const web = typeof window !== 'undefined';
  const onRoster = web && (window.history?.state as { tab?: string } | null)?.tab === 'portfolio';
  if (onRoster) {
    close?.();
    say(why);
    return;
  }
  // The Roster brings the matching list forward: "Your roster" or "Your shorts".
  requestRosterPick(why, side, target);
  if (!close || !web || !sheetIsOpen()) {
    close?.();
    openTab('portfolio');
    return;
  }
  let gone = false;
  const go = () => {
    if (gone) return;
    gone = true;
    window.removeEventListener('popstate', go);
    openTab('portfolio');
  };
  window.addEventListener('popstate', go);
  close();
  // No Back step came (the sheet's entry was not on top): go anyway.
  setTimeout(go, 400);
}

/**
 * One line of context on the left, the action on the right. With a quieter
 * move beside it ("Short instead"), the context takes its own line and the two
 * buttons share the row under it, the main one on the right (walk 7 T1-04:
 * the switch hung under the note like a caption).
 */
function Bar({ note, warn = false, below, children }: {
  note: string;
  warn?: boolean;
  below?: ReactNode;
  children?: ReactNode;
}) {
  const text = <Text maxFontSizeMultiplier={1.4} style={[styles.note, warn && styles.noteWarn]}>{note}</Text>;
  if (below) {
    return (
      <View style={[styles.bar, styles.barStacked]}>
        {text}
        <View style={styles.buttons}>
          {below}
          {children}
        </View>
      </View>
    );
  }
  return (
    <View style={styles.bar}>
      <View style={styles.noteColumn}>{text}</View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    columnGap: space.md,
    rowGap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  noteColumn: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
    alignItems: 'flex-start',
  },
  note: {
    color: colors.muted,
    fontSize: type.body,
    lineHeight: 18,
  },
  noteWarn: {
    color: colors.text,
  },
  strip: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rule: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  action: {
    minWidth: 88,
  },
  // The quieter move looks like a control: a ghost button with a 3:1 edge.
  instead: {
    borderColor: colors.controlBorder,
  },
  // One column that spans the bar (a wrapping column would be only as wide
  // as a short note, leaving the main button mid-row).
  barStacked: {
    flexDirection: 'column',
    flexWrap: 'nowrap',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space.md,
    rowGap: space.sm,
  },
  // A move on its way: the kit draws a reachable disabled button dashed
  // (LOCKED, FULL); saving is busy, not unavailable (walk 8 T4-11).
  busy: {
    borderStyle: 'solid',
    borderColor: colors.gold,
  },
  busyText: {
    color: colors.text,
  },
});
