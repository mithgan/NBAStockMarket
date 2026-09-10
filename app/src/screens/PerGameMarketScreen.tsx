import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import type { PerGamePositionSide } from '../api/contracts';
import { positionSlotHint } from '../data/perGameRules';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { formatCompactMoney, formatMoney } from '../format';
import { usePerGame } from '../state/PerGameContext';
import { buildPerGameMarketRows, type PerGameMarketRow } from '../state/perGameState';
import { colors, fonts, headingStyle, labelStyle, space, type, weight } from '../theme';

const NAME_SUFFIXES = new Set(['jr.', 'jr', 'sr.', 'sr', 'ii', 'iii', 'iv', 'v']);

/** Broadcast lower-third: quiet given name over the loud surname. */
function splitPlayerName(name: string): { given: string; surname: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return { given: '', surname: name };
  let index = parts.length - 1;
  if (parts.length >= 3 && NAME_SUFFIXES.has(parts[index].toLowerCase())) index -= 1;
  return { given: parts.slice(0, index).join(' '), surname: parts.slice(index).join(' ') };
}

function rosterLockMessage(gameDate: string | null): string {
  if (!gameDate) return 'Roster changes are locked while the current game is in progress.';
  const date = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${gameDate}T00:00:00Z`));
  return `Roster changes are locked for the ${date} game.`;
}

function MarketRow({ row, compact }: { row: PerGameMarketRow; compact: boolean }) {
  const { bootstrap, closePosition, openPosition, pendingActions } = usePerGame();
  const { player, position, side } = row;
  const actionKey = `position:${side}:${player.playerId}`;
  const pending = pendingActions.has(actionKey);
  const locked = pendingActions.has('account-mutation');
  const rosterLocked = bootstrap?.ruleset.rosterMutationsLocked ?? true;
  const rosterLockHint = rosterLockMessage(bootstrap?.ruleset.rosterLockGameDate ?? null);
  const disabled = !row.canSubmit || pending || locked || rosterLocked;
  const currentGameCost = player.currentGameCost;
  const priorSeasonValuePerGame = player.priorSeasonValuePerGame;
  const inverse = side === 'short';
  const actionLabel = pending
    ? 'WAIT'
    : position
      ? inverse ? 'CLOSE' : 'DROP'
      : inverse ? 'SHORT' : 'ADD';
  const blockedActionLabel = row.blockedByOpposingPosition
    ? 'BLOCKED'
    : row.isFull
      ? 'FULL'
      : 'UNAVAILABLE';
  const visibleActionLabel = rosterLocked
    ? 'LOCKED'
    : row.unavailableReason && !position
      ? blockedActionLabel
      : actionLabel;
  const { given, surname } = splitPlayerName(player.name);
  const kicker = [given.toUpperCase(), player.tier.toUpperCase()]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={[styles.row, compact && styles.rowTight]}>
      <PlayerAvatar player={{ id: player.playerId, name: player.name }} size={compact ? 32 : 36} />
      <View
        accessible
        accessibilityLabel={[
          player.name,
          `${formatMoney(currentGameCost)} current game cost`,
          priorSeasonValuePerGame === null
            ? 'prior season value unavailable'
            : `${formatMoney(priorSeasonValuePerGame)} prior season value per game`,
          position ? `${inverse ? 'inverse' : 'roster'} position active` : 'not rostered',
        ].join(', ')}
        style={styles.details}
      >
        <View style={styles.identity}>
          <Text numberOfLines={1} style={styles.playerKicker}>{kicker}</Text>
          <Text numberOfLines={compact ? 2 : 1} style={styles.playerName}>{surname}</Text>
          {row.blockedByOpposingPosition ? (
            <Text numberOfLines={compact ? 2 : 1} style={styles.blockedReason}>
              {row.unavailableReason}
            </Text>
          ) : null}
        </View>
        <View style={styles.priceColumn}>
          <Text style={styles.currentPrice}>
            {formatCompactMoney(currentGameCost)}
            <Text style={styles.perGame}>/GM</Text>
          </Text>
          <Text style={styles.priorValue}>
            {priorSeasonValuePerGame === null
              ? 'LAST YEAR  —'
              : `LAST YEAR  ${formatCompactMoney(priorSeasonValuePerGame)}`}
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityHint={rosterLocked ? rosterLockHint : row.unavailableReason ?? undefined}
        accessibilityLabel={rosterLocked
          ? `${inverse ? 'Inverse' : 'Roster'} action for ${player.name} unavailable while roster changes are locked`
          : `${visibleActionLabel.toLowerCase()} ${inverse ? 'inverse position for' : ''} ${player.name}`.trim()}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          if (disabled) return;
          if (position) closePosition(position);
          else {
            openPosition({
              playerId: player.playerId,
              playerName: player.name,
              side,
              expectedQuoteVersion: player.quoteVersion,
            });
          }
        }}
        style={({ pressed }) => [
          styles.action,
          compact && styles.actionCompact,
          position ? styles.closeAction : inverse ? styles.inverseAction : styles.addAction,
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={[
          styles.actionText,
          !position && (inverse ? styles.inverseActionText : styles.addActionText),
        ]}>
          {visibleActionLabel}
        </Text>
      </Pressable>
    </View>
  );
}

export function PerGameMarketScreen({
  initialSide = 'long',
}: {
  initialSide?: PerGamePositionSide;
}) {
  const { bootstrap } = usePerGame();
  const { fontScale, width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [side, setSide] = useState<PerGamePositionSide>(initialSide);
  const compact = width < 420 || fontScale > 1.25;
  const rows = useMemo(() => {
    if (!bootstrap) return [];
    const normalized = query.trim().toLocaleLowerCase();
    return buildPerGameMarketRows(bootstrap, side)
      .filter((row) => normalized === '' || row.player.name.toLocaleLowerCase().includes(normalized))
      .sort((left, right) => (
        left.player.currentGameCost - right.player.currentGameCost
        || left.player.name.localeCompare(right.player.name)
      ));
  }, [bootstrap, query, side]);
  if (!bootstrap) return null;
  const slots = side === 'long' ? bootstrap.account.longSlots : bootstrap.account.shortSlots;

  const listHeader = (
    <View style={styles.header}>
      <View style={styles.titleLine}>
        <Text accessibilityRole="header" style={styles.title}>Market</Text>
        <Text style={styles.slots}>{slots.used} / {slots.limit}</Text>
      </View>
      <View accessibilityRole="tablist" style={styles.sideTabs}>
        {([
          { key: 'long' as const, label: 'ROSTER', hint: positionSlotHint('long', bootstrap.account.longSlots.limit) },
          { key: 'short' as const, label: 'INVERSE', hint: positionSlotHint('short', bootstrap.account.shortSlots.limit) },
        ]).map((option) => {
          const selected = side === option.key;
          return (
            <Pressable
              key={option.key}
              accessibilityHint={option.hint}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              aria-selected={selected}
              onPress={() => setSide(option.key)}
              style={[styles.sideTab, selected && styles.sideTabSelected]}
            >
              <Text style={[styles.sideTabText, selected && styles.sideTabTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {side === 'short' ? (
        <Text style={styles.inverseExplainer}>
          Inverse P&amp;L is your locked game-cost credit minus the player's dividend.
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel="Search players"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setQuery}
        placeholder="Search players"
        placeholderTextColor={colors.faint}
        returnKeyType="search"
        style={styles.search}
        value={query}
      />
      {!compact ? (
        <View style={styles.columnLabels}>
          <Text style={styles.columnPlayer}>PLAYER</Text>
          <Text style={styles.columnCost}>COST / GAME</Text>
          <Text style={styles.columnAction}>ACTION</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      contentContainerStyle={styles.content}
      data={rows}
      initialNumToRender={18}
      keyboardShouldPersistTaps="handled"
      keyExtractor={(row) => row.player.playerId}
      ListEmptyComponent={(
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No players match</Text>
          <Text style={styles.emptyCopy}>Clear the search to see the full market.</Text>
        </View>
      )}
      ListHeaderComponent={listHeader}
      renderItem={({ item }) => <MarketRow compact={compact} row={item} />}
      style={styles.list}
      windowSize={9}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  content: {
    paddingBottom: 110,
  },
  header: {
    backgroundColor: colors.surface,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  title: {
    ...headingStyle,
  },
  slots: {
    ...labelStyle,
    color: colors.goldInk,
    fontVariant: ['tabular-nums'],
  },
  sideTabs: {
    flexDirection: 'row',
    marginHorizontal: space.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  sideTab: {
    minHeight: 44,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  sideTabSelected: {
    backgroundColor: colors.goldSoft,
  },
  sideTabText: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
    letterSpacing: 1.1,
  },
  sideTabTextSelected: {
    color: colors.goldInk,
  },
  inverseExplainer: {
    marginHorizontal: space.lg,
    marginTop: space.md,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  search: {
    minHeight: 44,
    marginHorizontal: space.lg,
    marginTop: space.md,
    marginBottom: space.md,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    color: colors.text,
    backgroundColor: colors.background,
    fontSize: type.body,
  },
  columnLabels: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  columnPlayer: {
    ...labelStyle,
    flex: 1,
  },
  columnCost: {
    ...labelStyle,
    width: 132,
    textAlign: 'right',
  },
  columnAction: {
    ...labelStyle,
    width: 82,
    marginLeft: space.md,
    textAlign: 'center',
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  rowTight: {
    gap: space.sm,
    paddingHorizontal: space.md,
  },
  details: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  identity: {
    minWidth: 0,
    flex: 1,
  },
  playerKicker: {
    ...labelStyle,
    fontSize: type.label,
    letterSpacing: 0.6,
  },
  playerName: {
    marginTop: 1,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  blockedReason: {
    marginTop: 2,
    color: colors.goldInk,
    fontSize: 11,
    lineHeight: 15,
  },
  priceColumn: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  currentPrice: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  perGame: {
    color: colors.faint,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  priorValue: {
    marginTop: 2,
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: 11,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  action: {
    width: 82,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  actionCompact: {
    width: 64,
  },
  addAction: {
    borderColor: colors.gold,
    backgroundColor: colors.gold,
  },
  inverseAction: {
    borderColor: colors.goldLine,
    backgroundColor: colors.goldSoft,
  },
  closeAction: {
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  actionText: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
  },
  addActionText: {
    color: colors.background,
  },
  inverseActionText: {
    color: colors.goldInk,
  },
  empty: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  emptyTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.title,
    fontWeight: weight.heavy,
  },
  emptyCopy: {
    marginTop: space.sm,
    color: colors.muted,
    fontSize: type.body,
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.72,
  },
});
