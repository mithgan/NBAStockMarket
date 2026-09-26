/**
 * The profile's action bar: the move his market row offers, where you read
 * about him. Add or Short when you do not hold him, Drop or Close when you do,
 * with the same locks as the row (a pending action, another account change,
 * a locked roster, a full side, the season's end). A dimmed button always has
 * its reason written beside it. After an Add or Short the button turns into a
 * brief "Added ✓", so a second tap cannot land on the Drop that replaces it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { PerGameMarketPlayer, PerGamePosition, PerGamePositionSide } from '../../api/contracts';
import { isMockActive, mockSeasonStart } from '../../api/mockPerGameClient';
import {
  closeActionName,
  closeVerb,
  confirmCloseButton,
  confirmCloseMessage,
  confirmCloseName,
  exactMoney,
  openVerb,
  perGame,
  rosterReopensLine,
} from '../../copy/terms';
import { practiceProgress } from '../../data/chromeView';
import { actionName, isSeasonOver } from '../../data/marketView';
import { shortEndsNext } from '../../data/rosterView';
import { usePerGame } from '../../state/PerGameContext';
import { buildPerGameMarketRows } from '../../state/perGameState';
import { colors, control, fonts, space, type, weight } from '../../theme';
import { Button, ConfirmStrip, useCooldown } from '../../ui/kit';

export function ProfileActionBar({ player, position, side }: {
  player: PerGameMarketPlayer;
  /** The position you hold on him now, on either side. */
  position: PerGamePosition | null;
  /** The side the profile reads from: his position's side, else the market tab. */
  side: PerGamePositionSide;
}) {
  const { bootstrap, closePosition, openPosition, pendingActions } = usePerGame();
  // A brief tick after a move lands ("Added ✓"), in the button's place.
  const [done, showDone] = useCooldown();
  const [doneWords, setDoneWords] = useState({ tick: '', note: '' });
  const finish = (tick: string, note: string) => {
    setDoneWords({ tick, note });
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
  const row = useMemo(
    () => (bootstrap && !position
      ? buildPerGameMarketRows(bootstrap, side).find((entry) => entry.player.playerId === player.playerId) ?? null
      : null),
    [bootstrap, player.playerId, position, side],
  );
  if (!bootstrap) return null;

  const pending = pendingActions.has(`position:${side}:${player.playerId}`);
  const locked = pendingActions.has('account-mutation');
  const rosterLocked = bootstrap.ruleset.rosterMutationsLocked;
  const fee = bootstrap.ruleset.transactionFeeDollars;
  const seasonOver = isSeasonOver({
    practiceComplete: isMockActive() && practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).complete,
    lastSettledDate: bootstrap.game.lastSettledDate,
    nextGameDate: bootstrap.game.nextGameDate,
  });
  const lockLine = `Roster changes are locked. ${rosterReopensLine(bootstrap.ruleset.rosterLockGameDate)}.`;

  // Just added, shorted, dropped or closed: a quiet tick where the button was.
  if (done) {
    return (
      <Bar note={doneWords.note}>
        <View style={styles.done}>
          <Text maxFontSizeMultiplier={1.3} style={styles.doneText}>{doneWords.tick}</Text>
        </View>
      </Bar>
    );
  }
  if (seasonOver) return <Bar note="The season is over. No more adds, drops or shorts." />;
  if (position) {
    const held = position.side;
    const disabled = pending || locked || rosterLocked;
    if (confirming && !disabled) {
      return (
        <ConfirmStrip
          confirmAccessibilityLabel={confirmCloseName(held, player.name)}
          confirmLabel={confirmCloseButton(held, fee)}
          // One wording with the Roster and Market: fee, what stays, and what
          // coming back would cost today.
          message={confirmCloseMessage({
            side: held,
            playerName: player.name,
            feeDollars: fee,
            total: position.cumulativePnl,
            endsFreeAfter: shortEndsNext(position, bootstrap.game.nextGameDate) ? position.expiresOn : null,
            priceNow: player.currentGameCost,
          })}
          onCancel={cancel}
          onConfirm={() => {
            setConfirming(false);
            void closePosition(position).then((ok) => {
              if (!ok) return;
              if (held === 'long') finish('Dropped ✓', `${player.name} is off your roster.`);
              else finish('Closed ✓', `Your short on ${player.name} is closed.`);
            });
          }}
          style={styles.strip}
        />
      );
    }
    const costs = fee > 0
      ? `${held === 'long' ? 'Dropping him' : 'Closing the short'} costs ${exactMoney(fee)}.`
      : held === 'long' ? 'Dropping him frees a roster spot.' : 'Closing frees a short slot.';
    return (
      <Bar note={rosterLocked ? lockLine : costs} warn={rosterLocked}>
        <Button
          ref={closeRef}
          accessibilityHint={rosterLocked ? lockLine : undefined}
          accessibilityLabel={closeActionName(held, player.name)}
          disabled={disabled}
          focusableWhenDisabled
          label={pending ? 'Wait' : rosterLocked ? 'Locked' : closeVerb(held)}
          onPress={() => {
            if (!disabled) setConfirming(true);
          }}
          style={styles.action}
          variant="secondary"
        />
      </Bar>
    );
  }
  // Not in today's market (a roster-only record): nothing to open.
  if (!row) return null;
  if (row.blockedByOpposingPosition) return <Bar note={row.unavailableReason ?? ''} />;

  const disabled = !row.canSubmit || pending || locked || rosterLocked;
  const reason = rosterLocked ? lockLine : row.unavailableReason;
  const noun = side === 'long' ? 'price' : 'credit';
  const note = reason
    // A no-break space keeps "$250 fee" on one line.
    ?? `Locks his ${noun} at ${perGame(player.currentGameCost)}${fee > 0 ? ` · ${exactMoney(fee)} fee` : ''}`;
  const word = pending ? 'Wait' : rosterLocked ? 'Locked' : row.isFull ? 'Full' : openVerb(side);
  return (
    <Bar note={note} warn={reason !== null}>
      <Button
        accessibilityHint={reason ?? undefined}
        accessibilityLabel={actionName('open', side, player.name, player.currentGameCost)}
        disabled={disabled}
        focusableWhenDisabled
        label={word}
        onPress={() => {
          if (disabled) return;
          void openPosition({
            playerId: player.playerId,
            playerName: player.name,
            side,
            expectedQuoteVersion: player.quoteVersion,
          }).then((ok) => {
            if (!ok) return;
            if (side === 'long') finish('Added ✓', `${player.name} is on your roster.`);
            else finish('Shorted ✓', `You're shorting ${player.name}.`);
          });
        }}
        style={styles.action}
        variant="primary"
      />
    </Bar>
  );
}

/** One line of context on the left, the action on the right. */
function Bar({ note, warn = false, children }: { note: string; warn?: boolean; children?: ReactNode }) {
  return (
    <View style={styles.bar}>
      <Text maxFontSizeMultiplier={1.4} style={[styles.note, warn && styles.noteWarn]}>{note}</Text>
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
  note: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
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
  action: {
    minWidth: 88,
  },
  done: {
    minHeight: control.height,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  doneText: {
    color: colors.green,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
