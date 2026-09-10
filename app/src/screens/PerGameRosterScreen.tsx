import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { PerGameLedgerEntry, PerGamePosition } from '../api/contracts';
import { PerGamePnlChart } from '../components/PerGamePnlChart';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { formatCompactMoney, formatCompactSignedMoney, formatMoney, formatSignedMoney } from '../format';
import { usePerGame } from '../state/PerGameContext';
import { colors, fonts, headingStyle, heroNumber, labelStyle, space, type, weight } from '../theme';

function formatTermDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

const DIVIDEND_KINDS = new Set(['game_dividend', 'dividend', 'dividend_correction', 'correction']);
const FEE_KINDS = new Set(['open_fee', 'drop_fee', 'fee', 'penalty']);

/** The hero decomposed: score = dividends − game costs − fees, from the ledger. */
function scoreComponents(entries: PerGameLedgerEntry[]) {
  let dividends = 0;
  let gameCosts = 0;
  let fees = 0;
  for (const entry of entries) {
    if (entry.kind === 'game_cost') gameCosts += entry.amountDollars;
    else if (DIVIDEND_KINDS.has(entry.kind)) dividends += entry.amountDollars;
    else if (FEE_KINDS.has(entry.kind)) fees += entry.amountDollars;
  }
  return { dividends, gameCosts, fees };
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text
        accessibilityLabel={`${label} ${formatSignedMoney(value)}`}
        style={[styles.statValue, value >= 0 ? styles.positive : styles.negative]}
      >
        {formatCompactSignedMoney(value)}
      </Text>
    </View>
  );
}

function PositionRow({ position }: { position: PerGamePosition }) {
  const { bootstrap, closePosition, pendingActions } = usePerGame();
  const { fontScale, width } = useWindowDimensions();
  const actionKey = `position:${position.side}:${position.playerId}`;
  const pending = pendingActions.has(actionKey);
  const locked = pendingActions.has('account-mutation');
  const rosterLocked = bootstrap?.ruleset.rosterMutationsLocked ?? true;
  const rosterLockDate = bootstrap?.ruleset.rosterLockGameDate ?? null;
  const rosterLockHint = rosterLockDate
    ? `Roster changes are locked for the ${formatTermDate(rosterLockDate)} game.`
    : 'Roster changes are locked while the current game is in progress.';
  const disabled = pending || locked || rosterLocked;
  const inverse = position.side === 'short';
  const kicker = [
    `${formatCompactMoney(position.lockedGameCost)}/GM LOCKED`,
    inverse && position.expiresOn ? `THRU ${formatTermDate(position.expiresOn).toUpperCase()}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <View style={styles.positionRow}>
      <PlayerAvatar player={{ id: position.playerId, name: position.playerName }} size={36} />
      <View
        accessible
        accessibilityLabel={[
          position.playerName,
          `locked game cost ${formatMoney(position.lockedGameCost)}`,
          `${inverse ? 'cost credits' : 'game costs'} ${formatMoney(position.cumulativeGameCost)}`,
          `dividends ${formatMoney(position.cumulativeDividend)}`,
          `profit and loss ${formatSignedMoney(position.cumulativePnl)}`,
        ].join(', ')}
        style={styles.positionCopy}
      >
        <Text style={styles.positionKicker}>{kicker}</Text>
        <Text numberOfLines={fontScale > 1.25 ? undefined : width < 420 ? 2 : 1} style={styles.positionName}>
          {position.playerName}
        </Text>
        <Text style={styles.positionDetail}>
          {inverse ? 'credits' : 'costs'} {formatCompactMoney(position.cumulativeGameCost)}
          {' · '}divs {formatCompactMoney(position.cumulativeDividend)}
        </Text>
      </View>
      <Text
        accessibilityLabel={`Profit and loss ${formatSignedMoney(position.cumulativePnl)}`}
        style={[
          styles.positionPnl,
          position.cumulativePnl >= 0 ? styles.positive : styles.negative,
        ]}
      >
        {formatCompactSignedMoney(position.cumulativePnl)}
      </Text>
      <Pressable
        accessibilityHint={rosterLocked ? rosterLockHint : undefined}
        accessibilityLabel={rosterLocked
          ? `${inverse ? 'Close inverse position on' : 'Drop'} ${position.playerName} unavailable while roster changes are locked`
          : `${inverse ? 'Close inverse position on' : 'Drop'} ${position.playerName}`}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          if (!disabled) closePosition(position);
        }}
        style={({ pressed }) => [
          styles.dropButton,
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.dropButtonText}>
          {rosterLocked ? 'LOCKED' : pending ? 'WAIT' : inverse ? 'CLOSE' : 'DROP'}
        </Text>
      </Pressable>
    </View>
  );
}

/** react-native-web exposes this as data-card="player" for the hover lift. */
const cardMarker: Record<string, unknown> = { dataSet: { card: 'player' } };

/** Column count derives from a minimum tile width, not fixed breakpoints. */
function gridColumns(width: number, fontScale: number): number {
  const usable = Math.min(width, 1040) - space.lg * 2;
  const minTile = fontScale > 1.3 ? 220 : 168;
  return Math.max(2, Math.min(5, Math.floor(usable / minTile)));
}

function RosterSlotBox({ position, width }: { position: PerGamePosition; width: number }) {
  const { bootstrap, closePosition, pendingActions } = usePerGame();
  const actionKey = `position:${position.side}:${position.playerId}`;
  const pending = pendingActions.has(actionKey);
  const locked = pendingActions.has('account-mutation');
  const rosterLocked = bootstrap?.ruleset.rosterMutationsLocked ?? true;
  const rosterLockDate = bootstrap?.ruleset.rosterLockGameDate ?? null;
  const rosterLockHint = rosterLockDate
    ? `Roster changes are locked for the ${formatTermDate(rosterLockDate)} game.`
    : 'Roster changes are locked while the current game is in progress.';
  const disabled = pending || locked || rosterLocked;

  return (
    <View {...cardMarker} style={[styles.slotBox, { width }]}>
      <View style={styles.slotHead}>
        <PlayerAvatar player={{ id: position.playerId, name: position.playerName }} size={44} />
        <View style={styles.slotIdentity}>
          <Text numberOfLines={1} style={styles.slotKicker}>
            {formatCompactMoney(position.lockedGameCost)}/GM
          </Text>
          <Text numberOfLines={2} style={styles.slotName}>{position.playerName}</Text>
        </View>
      </View>
      <Text
        accessibilityLabel={`Profit and loss ${formatSignedMoney(position.cumulativePnl)}`}
        style={[styles.slotPnl, position.cumulativePnl >= 0 ? styles.positive : styles.negative]}
      >
        {formatCompactSignedMoney(position.cumulativePnl)}
      </Text>
      <View style={styles.slotFoot}>
        <Text
          accessibilityLabel={`Game costs ${formatMoney(position.cumulativeGameCost)}, dividends ${formatMoney(position.cumulativeDividend)}`}
          numberOfLines={1}
          style={styles.slotDetail}
        >
          {formatCompactMoney(position.cumulativeDividend)} divs
        </Text>
        <Pressable
          accessibilityHint={rosterLocked ? rosterLockHint : undefined}
          accessibilityLabel={rosterLocked
            ? `Drop ${position.playerName} unavailable while roster changes are locked`
            : `Drop ${position.playerName}`}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          hitSlop={8}
          onPress={() => {
            if (!disabled) closePosition(position);
          }}
          style={({ pressed }) => [
            styles.slotDrop,
            disabled && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.slotDropText}>
            {rosterLocked ? 'LOCKED' : pending ? 'WAIT' : 'DROP'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function EmptySlotBox({ slot, width, onPress }: {
  slot: number;
  width: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`Roster slot ${slot} is empty. Open the market to add a player`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.emptySlot, { width }, pressed && styles.pressed]}
    >
      <Text style={styles.emptySlotAdd}>+ ADD</Text>
      <Text style={styles.emptySlotLabel}>SLOT {slot}</Text>
    </Pressable>
  );
}

/** The ten roster slots as physical boxes: your shelf, filled or waiting. */
function RosterGridSection({
  positions,
  used,
  limit,
  onOpenMarket,
}: {
  positions: PerGamePosition[];
  used: number;
  limit: number;
  onOpenMarket: () => void;
}) {
  const { fontScale, width } = useWindowDimensions();
  const columns = gridColumns(width, fontScale);
  const usable = Math.min(width, 1040) - space.lg * 2;
  const tileWidth = Math.floor((usable - (columns - 1) * space.sm) / columns);
  const emptyCount = Math.max(0, limit - positions.length);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Your roster</Text>
        <Text style={styles.slotCount}>{used} / {limit}</Text>
      </View>
      <View style={styles.grid}>
        {positions.map((position) => (
          <RosterSlotBox key={position.positionId} position={position} width={tileWidth} />
        ))}
        {Array.from({ length: emptyCount }, (_, index) => (
          <EmptySlotBox
            key={`empty-${index}`}
            onPress={onOpenMarket}
            slot={positions.length + index + 1}
            width={tileWidth}
          />
        ))}
      </View>
    </View>
  );
}

function PositionSection({
  title,
  caption,
  used,
  limit,
  positions,
  emptyCopy,
  onOpenMarket,
}: {
  title: string;
  caption?: string;
  used: number;
  limit: number;
  positions: PerGamePosition[];
  emptyCopy: string;
  onOpenMarket: () => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionCopy}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
          {caption ? <Text style={styles.sectionCaption}>{caption}</Text> : null}
        </View>
        <Text style={styles.slotCount}>{used} / {limit}</Text>
      </View>
      {positions.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyCopy}>{emptyCopy}</Text>
          <Pressable
            accessibilityLabel="Open the player market"
            accessibilityRole="button"
            onPress={onOpenMarket}
            style={({ pressed }) => [styles.marketButton, pressed && styles.pressed]}
          >
            <Text style={styles.marketButtonText}>OPEN MARKET</Text>
          </Pressable>
        </View>
      ) : positions.map((position) => (
        <PositionRow key={position.positionId} position={position} />
      ))}
    </View>
  );
}

export function PerGameRosterScreen({
  onOpenMarket,
}: {
  onOpenMarket: (side: PerGamePosition['side']) => void;
}) {
  const { bootstrap } = usePerGame();
  const components = useMemo(
    () => scoreComponents(bootstrap?.ledger.items ?? []),
    [bootstrap?.ledger.items],
  );
  if (!bootstrap) return null;
  const active = bootstrap.positions.filter((position) => position.status === 'active');
  const longs = active.filter((position) => position.side === 'long');
  const shorts = active.filter((position) => position.side === 'short');
  const pnl = bootstrap.account.cumulativePnl;

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>YOUR SCORE</Text>
        <Text
          accessibilityLabel={`Cumulative profit and loss ${formatSignedMoney(pnl)}`}
          style={[styles.heroValue, pnl >= 0 ? styles.positive : styles.negative]}
        >
          {formatCompactSignedMoney(pnl)}
        </Text>
      </View>
      <View style={styles.statBar}>
        <StatCell label="DIVIDENDS" value={components.dividends} />
        <View style={styles.statRule} />
        <StatCell label="GAME COSTS" value={components.gameCosts} />
        <View style={styles.statRule} />
        <StatCell label="FEES" value={components.fees} />
      </View>
      <PerGamePnlChart entries={bootstrap.ledger.items} />
      <RosterGridSection
        limit={bootstrap.account.longSlots.limit}
        onOpenMarket={() => onOpenMarket('long')}
        positions={longs}
        used={bootstrap.account.longSlots.used}
      />
      <PositionSection
        caption="Each game credits your locked cost, then subtracts the player's dividend."
        emptyCopy="Inverse positions profit when a player's dividend finishes below your locked game-cost credit."
        limit={bootstrap.account.shortSlots.limit}
        onOpenMarket={() => onOpenMarket('short')}
        positions={shorts}
        title="Inverse positions"
        used={bootstrap.account.shortSlots.used}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: 110,
  },
  hero: {
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.lg,
    backgroundColor: colors.surface,
  },
  eyebrow: {
    ...labelStyle,
    marginBottom: space.sm,
  },
  heroValue: {
    ...heroNumber,
  },
  statBar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: space.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  statCell: {
    flex: 1,
    paddingHorizontal: space.lg,
  },
  statRule: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  statLabel: {
    ...labelStyle,
    marginBottom: 3,
  },
  statValue: {
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  section: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  sectionHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.surface,
  },
  sectionCopy: {
    minWidth: 0,
    flexShrink: 1,
  },
  sectionTitle: {
    ...headingStyle,
    letterSpacing: 0,
  },
  sectionCaption: {
    marginTop: 3,
    color: colors.faint,
    fontSize: type.label,
    lineHeight: 15,
  },
  slotCount: {
    ...labelStyle,
    color: colors.goldInk,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
    minWidth: 48,
    textAlign: 'right',
  },
  positionRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  positionCopy: {
    minWidth: 0,
    flex: 1,
  },
  positionKicker: {
    ...labelStyle,
    fontSize: type.label,
    letterSpacing: 0.6,
  },
  positionName: {
    marginTop: 1,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  positionDetail: {
    marginTop: 2,
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  positionPnl: {
    fontFamily: fonts.display,
    fontSize: type.title,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  dropButton: {
    minWidth: 64,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  dropButtonText: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
  },
  empty: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: space.xl,
    backgroundColor: colors.background,
  },
  emptyCopy: {
    maxWidth: 520,
    marginBottom: space.lg,
    color: colors.muted,
    fontSize: type.body,
    lineHeight: 20,
  },
  marketButton: {
    minHeight: 44,
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    backgroundColor: colors.gold,
  },
  marketButtonText: {
    color: colors.background,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    backgroundColor: colors.background,
  },
  slotBox: {
    minHeight: 148,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: colors.surface,
  },
  slotHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  slotIdentity: {
    minWidth: 0,
    flex: 1,
  },
  slotKicker: {
    ...labelStyle,
    fontSize: type.label,
    letterSpacing: 0.6,
  },
  slotName: {
    marginTop: 1,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
    lineHeight: 16,
  },
  slotPnl: {
    marginTop: space.sm,
    fontFamily: fonts.display,
    fontSize: type.title,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  slotFoot: {
    marginTop: 'auto',
    paddingTop: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  slotDetail: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  slotDrop: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 4,
    backgroundColor: colors.surfaceRaised,
  },
  slotDropText: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
  },
  emptySlot: {
    minHeight: 148,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: 6,
    backgroundColor: colors.background,
  },
  emptySlotAdd: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.black,
    letterSpacing: 1.1,
  },
  emptySlotLabel: {
    ...labelStyle,
  },
  positive: {
    color: colors.green,
  },
  negative: {
    color: colors.red,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.72,
  },
});
