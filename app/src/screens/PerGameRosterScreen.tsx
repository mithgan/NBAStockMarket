import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { PerGamePosition } from '../api/contracts';
import { PerGamePnlChart } from '../components/PerGamePnlChart';
import { formatCompactMoney, formatCompactSignedMoney, formatMoney, formatSignedMoney } from '../format';
import { usePerGame } from '../state/PerGameContext';
import { colors, fonts, headingStyle, labelStyle, space, type, weight } from '../theme';

function formatTermDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
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
  const compact = width < 420 || fontScale > 1.25;

  return (
    <View style={[styles.positionRow, compact && styles.positionRowCompact]}>
      <View style={styles.positionCopy}>
        <View style={styles.positionNameLine}>
          <Text numberOfLines={1} style={styles.positionName}>{position.playerName}</Text>
          <Text style={[styles.sideTag, inverse && styles.inverseTag]}>
            {inverse ? 'INVERSE' : 'ROSTER'}
          </Text>
        </View>
        <Text
          accessibilityLabel={`Locked game cost ${formatMoney(position.lockedGameCost)}`}
          style={styles.lockedCost}
        >
          {formatCompactMoney(position.lockedGameCost)} locked / game
        </Text>
        <View style={styles.metrics}>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>{inverse ? 'COST CREDITS' : 'GAME COSTS'}</Text>
            <Text accessibilityLabel={formatMoney(position.cumulativeGameCost)} style={styles.metricValue}>
              {formatCompactMoney(position.cumulativeGameCost)}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>{inverse ? 'DIVIDENDS PAID' : 'DIVIDENDS'}</Text>
            <Text accessibilityLabel={formatMoney(position.cumulativeDividend)} style={styles.metricValue}>
              {formatCompactMoney(position.cumulativeDividend)}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>P&amp;L</Text>
            <Text
              accessibilityLabel={formatSignedMoney(position.cumulativePnl)}
              style={[
                styles.metricValue,
                position.cumulativePnl >= 0 ? styles.positive : styles.negative,
              ]}
            >
              {formatCompactSignedMoney(position.cumulativePnl)}
            </Text>
          </View>
        </View>
        {inverse ? (
          <Text style={styles.inverseCopy}>
            Each game credits your locked cost, then subtracts the player's dividend.
            {position.expiresOn ? ` Active through ${formatTermDate(position.expiresOn)}.` : ''}
          </Text>
        ) : null}
      </View>
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
          compact && styles.dropButtonCompact,
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

function PositionSection({
  title,
  used,
  limit,
  positions,
  emptyCopy,
  onOpenMarket,
}: {
  title: string;
  used: number;
  limit: number;
  positions: PerGamePosition[];
  emptyCopy: string;
  onOpenMarket: () => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
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
  if (!bootstrap) return null;
  const active = bootstrap.positions.filter((position) => position.status === 'active');
  const longs = active.filter((position) => position.side === 'long');
  const shorts = active.filter((position) => position.side === 'short');
  const pnl = bootstrap.account.cumulativePnl;
  const latest = bootstrap.account.latestGamePnl;

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
        <Text
          accessibilityLabel={`Latest game profit and loss ${formatSignedMoney(latest)}`}
          style={styles.latest}
        >
          Latest game {formatCompactSignedMoney(latest)}
        </Text>
      </View>
      <PerGamePnlChart entries={bootstrap.ledger.items} />
      <PositionSection
        emptyCopy="Add a player to lock today's per-game cost. Your score starts at $0."
        limit={bootstrap.account.longSlots.limit}
        onOpenMarket={() => onOpenMarket('long')}
        positions={longs}
        title="Your roster"
        used={bootstrap.account.longSlots.used}
      />
      <PositionSection
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
    minHeight: 150,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  eyebrow: {
    ...labelStyle,
    marginBottom: space.sm,
  },
  heroValue: {
    fontFamily: fonts.display,
    fontSize: 46,
    fontWeight: weight.black,
    fontVariant: ['tabular-nums'],
  },
  latest: {
    marginTop: space.sm,
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  section: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  sectionHeader: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    ...headingStyle,
    letterSpacing: 0,
  },
  slotCount: {
    ...labelStyle,
    color: colors.gold,
    fontVariant: ['tabular-nums'],
  },
  positionRow: {
    minHeight: 150,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  positionRowCompact: {
    flexWrap: 'wrap',
  },
  positionCopy: {
    minWidth: 0,
    flex: 1,
  },
  positionNameLine: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  positionName: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  sideTag: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    color: colors.gold,
    backgroundColor: colors.goldSoft,
    fontFamily: fonts.display,
    fontSize: 11,
    fontWeight: weight.heavy,
  },
  inverseTag: {
    color: colors.cyan,
    backgroundColor: colors.cyanSoft,
  },
  lockedCost: {
    marginTop: 5,
    color: colors.muted,
    fontSize: type.body,
    fontVariant: ['tabular-nums'],
  },
  metrics: {
    marginTop: space.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.lg,
  },
  metric: {
    minWidth: 88,
  },
  metricLabel: {
    ...labelStyle,
    fontSize: 11,
  },
  metricValue: {
    marginTop: 3,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  inverseCopy: {
    marginTop: space.sm,
    color: colors.faint,
    fontSize: 11,
    lineHeight: 16,
  },
  dropButton: {
    minWidth: 72,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  dropButtonCompact: {
    marginLeft: 'auto',
  },
  dropButtonText: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
  },
  empty: {
    minHeight: 160,
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
