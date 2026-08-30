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
import { formatCompactMoney, formatMoney } from '../format';
import { usePerGame } from '../state/PerGameContext';
import { buildPerGameMarketRows, type PerGameMarketRow } from '../state/perGameState';
import { colors, fonts, headingStyle, labelStyle, space, type, weight } from '../theme';

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

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
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
        style={[styles.details, compact && styles.detailsCompact]}
      >
        <View style={[styles.identity, compact && styles.identityCompact]}>
          <Text numberOfLines={1} style={styles.playerName}>{player.name}</Text>
          <Text numberOfLines={1} style={styles.playerMeta}>
            {player.tier.toUpperCase()}{position ? ` · ${inverse ? 'INVERSE ACTIVE' : 'ON ROSTER'}` : ''}
          </Text>
          {row.blockedByOpposingPosition ? (
            <Text style={styles.blockedReason}>{row.unavailableReason}</Text>
          ) : null}
        </View>
        <View style={[styles.priceColumn, compact && styles.priceColumnCompact]}>
          <Text style={styles.priceLabel}>CURRENT / GAME</Text>
          <Text style={styles.currentPrice}>
            {formatCompactMoney(currentGameCost)}
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
          position ? styles.closeAction : inverse ? styles.inverseAction : styles.addAction,
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={[
          styles.actionText,
          !position && !inverse && styles.addActionText,
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
  const compact = width < 520 || fontScale > 1.25;
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
        <View>
          <Text accessibilityRole="header" style={styles.title}>MARKET</Text>
          <Text style={styles.subtitle}>
            Lock today's per-game cost until you drop the player.
          </Text>
        </View>
        <Text style={styles.slots}>{slots.used} / {slots.limit}</Text>
      </View>
      <View accessibilityRole="tablist" style={styles.sideTabs}>
        {([
          { key: 'long' as const, label: 'ROSTER', hint: 'Add players to your ten-player roster' },
          { key: 'short' as const, label: 'INVERSE', hint: 'Open inverse positions in up to five slots' },
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.lg,
  },
  title: {
    ...headingStyle,
    letterSpacing: 0,
  },
  subtitle: {
    maxWidth: 520,
    marginTop: space.xs,
    color: colors.muted,
    fontSize: type.body,
    lineHeight: 20,
  },
  slots: {
    ...labelStyle,
    color: colors.gold,
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
  },
  sideTabTextSelected: {
    color: colors.gold,
  },
  inverseExplainer: {
    marginHorizontal: space.lg,
    marginTop: space.md,
    color: colors.cyan,
    fontSize: 12,
    lineHeight: 18,
  },
  search: {
    minHeight: 48,
    margin: space.lg,
    marginBottom: space.md,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    color: colors.text,
    backgroundColor: colors.background,
    fontSize: type.body,
  },
  columnLabels: {
    minHeight: 34,
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
    width: 142,
    textAlign: 'right',
  },
  columnAction: {
    ...labelStyle,
    width: 82,
    textAlign: 'right',
  },
  row: {
    minHeight: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  rowCompact: {
    minHeight: 142,
    alignItems: 'center',
  },
  details: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  detailsCompact: {
    flexWrap: 'wrap',
  },
  identity: {
    minWidth: 0,
    flex: 1,
  },
  identityCompact: {
    flexBasis: '100%',
  },
  playerName: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  playerMeta: {
    marginTop: 4,
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: 11,
    fontWeight: weight.bold,
  },
  blockedReason: {
    marginTop: space.xs,
    color: colors.gold,
    fontSize: 11,
    lineHeight: 16,
  },
  priceColumn: {
    width: 142,
    alignItems: 'flex-end',
  },
  priceColumnCompact: {
    width: 'auto',
    flex: 1,
    alignItems: 'flex-start',
  },
  priceLabel: {
    ...labelStyle,
    fontSize: 11,
  },
  currentPrice: {
    marginTop: 2,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  priorValue: {
    marginTop: 3,
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
  addAction: {
    borderColor: colors.gold,
    backgroundColor: colors.gold,
  },
  inverseAction: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanSoft,
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
