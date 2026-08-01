import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Player } from '../data/types';
import { formatCompactMoney, formatCompactSignedMoney, formatMoney, formatSignedMoney } from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { DOLLARS_PER_NET_POINT, WEEKLY_TOTAL_CLAMP_NP } from '../state/game';
import { colors, radius, space, type } from '../theme';

interface PlayCandidate {
  player: Player;
  gameDate: string;
  fee: number;
}

function SlotCard({ label, used, total }: { label: string; used: number; total: number }) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${used} of ${total} used, ${total - used} available`}
      style={styles.slotCard}
    >
      <Text style={styles.slotLabel}>{label}</Text>
      <View style={styles.slotValueRow}>
        <Text style={styles.slotValue}>{used} / {total}</Text>
        <Text style={styles.slotHelp}>{total - used} left</Text>
      </View>
    </View>
  );
}

export function PlaysScreen() {
  const {
    armPlayerBoost,
    armShort,
    boostTargets,
    boostSlots,
    currentWeek,
    nextGameDate,
    pendingActions,
    players,
    shortSlots,
    state,
    weeklyShortTargets,
  } = usePortfolio();
  if (!state) return null;
  const playerById = new Map(players.map((player) => [player.id, player]));
  const accountMutationPending = pendingActions.size > 0;
  const priceOf = (playerId: string) =>
    state.prices[playerId] ?? playerById.get(playerId)?.listing_price ?? 0;

  const activeShorts = state.weeklyShorts.filter(
    (position) => position.week === currentWeek && position.status === 'active',
  );
  const usedBoosts = state.boosts.filter(
    (position) => position.week === currentWeek && position.status !== 'refunded',
  );
  const shortCandidates = weeklyShortTargets.flatMap<PlayCandidate>((target) => {
    const player = playerById.get(target.playerId);
    return player ? [{ player, gameDate: target.gameDate, fee: target.fee }] : [];
  });
  const boostCandidates = boostTargets.flatMap<PlayCandidate>((target) => {
    const player = playerById.get(target.playerId);
    return player ? [{ player, gameDate: target.gameDate, fee: target.fee }] : [];
  });

  const renderCandidate = (
    { player, gameDate, fee }: PlayCandidate,
    kind: 'short' | 'boost',
    isLast: boolean,
  ) => {
    const pending = pendingActions.has(`${kind}:${player.id}`);
    const slots = kind === 'short' ? shortSlots : boostSlots;
    const disabled = slots.remaining === 0 || accountMutationPending;
    return (
      <View key={player.id} style={[styles.actionRow, isLast && styles.lastRow]}>
        <View
          accessible
          accessibilityLabel={`${player.name}. Price ${formatMoney(priceOf(player.id))}. Next game ${gameDate}. Fee ${formatMoney(fee)}`}
          style={styles.actionCopy}
        >
          <Text numberOfLines={1} style={styles.rowName}>{player.name}</Text>
          <Text numberOfLines={1} style={styles.rowMeta}>
            {formatCompactMoney(priceOf(player.id))} · {gameDate} · fee {formatCompactMoney(fee)}
          </Text>
        </View>
        <Pressable
          accessibilityHint={
            slots.remaining === 0
              ? `No ${kind === 'short' ? 'short' : 'boost'} slots remain this week`
              : undefined
          }
          accessibilityLabel={kind === 'short'
            ? `Arm weekly short on ${player.name}, fee ${formatMoney(fee)}`
            : `Boost ${player.name} for ${gameDate}, fee ${formatMoney(fee)}`}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => void (kind === 'short'
            ? armShort(player)
            : armPlayerBoost(player, gameDate))}
          style={({ pressed }) => [
            kind === 'short' ? styles.actionButton : styles.boostButton,
            disabled && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={kind === 'short' ? styles.actionText : styles.boostText}>
            {pending ? 'WAIT' : kind === 'short' ? 'SHORT' : 'BOOST'}
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={styles.title}>Plays</Text>
        <Text style={styles.badge}>{currentWeek ?? 'SEASON COMPLETE'}</Text>
      </View>

      <View style={styles.slotRow}>
        <SlotCard label="Weekly shorts" total={shortSlots.total} used={shortSlots.used} />
        <SlotCard label="Boosts" total={boostSlots.total} used={boostSlots.used} />
      </View>
      <Text style={styles.subtle}>
        Shorts reserve {formatCompactMoney(2_000_000)} collateral and settle at up to
        {' '}+/-{formatCompactMoney(WEEKLY_TOTAL_CLAMP_NP * DOLLARS_PER_NET_POINT)}. Boosts cost 0.25% and
        add one extra signed dividend, including losses. Slots reset each Monday.
      </Text>

      <Text accessibilityRole="header" style={styles.sectionTitle}>Open positions</Text>
      {activeShorts.length === 0 && usedBoosts.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No active plays this week.</Text>
          <Text style={styles.subtle}>Use one only when you have a real conviction.</Text>
        </View>
      ) : (
        <View style={styles.listCard}>
          {activeShorts.map((position, index) => {
            const player = playerById.get(position.playerId);
            const markedPayout = Math.max(
              -WEEKLY_TOTAL_CLAMP_NP,
              Math.min(WEEKLY_TOTAL_CLAMP_NP, position.accruedNetPoints),
            ) * DOLLARS_PER_NET_POINT;
            const isLast = index === activeShorts.length - 1 && usedBoosts.length === 0;
            return (
              <View key={position.id} style={[styles.positionRow, isLast && styles.lastRow]}>
                <View style={styles.positionCopy}>
                  <Text numberOfLines={1} style={styles.rowName}>{player?.name ?? position.playerId}</Text>
                  <Text numberOfLines={1} style={styles.rowMeta}>
                    WEEKLY SHORT · {position.qualifyingGames} games
                  </Text>
                </View>
                <Text
                  accessibilityLabel={`Marked at ${formatSignedMoney(markedPayout)}`}
                  numberOfLines={1}
                  style={[styles.positionValue, markedPayout >= 0 ? styles.positive : styles.negative]}
                >
                  {formatCompactSignedMoney(markedPayout)}
                </Text>
              </View>
            );
          })}
          {usedBoosts.map((boost, index) => (
            <View
              key={boost.id}
              style={[styles.positionRow, index === usedBoosts.length - 1 && styles.lastRow]}
            >
              <View style={styles.positionCopy}>
                <Text numberOfLines={1} style={styles.rowName}>
                  {playerById.get(boost.playerId)?.name ?? boost.playerId}
                </Text>
                <Text numberOfLines={1} style={styles.rowMeta}>
                  BOOST · {boost.gameDate} · {boost.status.toUpperCase()}
                </Text>
              </View>
              <Text
                accessibilityLabel={boost.status === 'armed'
                  ? 'Armed, not settled yet'
                  : `Settled at ${formatSignedMoney(boost.payout)}`}
                numberOfLines={1}
                style={[styles.positionValue, boost.payout >= 0 ? styles.positive : styles.negative]}
              >
                {boost.status === 'armed' ? 'ARMED' : formatCompactSignedMoney(boost.payout)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Weekly shorts</Text>
        <Text style={styles.subtle}>Unowned players only</Text>
      </View>
      {shortCandidates.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{nextGameDate ? 'No eligible players right now.' : 'Replay complete.'}</Text>
          <Text style={styles.subtle}>Refresh after the next server settlement or free a slot to see more options.</Text>
        </View>
      ) : (
        <View style={styles.listCard}>
          {shortCandidates.map((candidate, index) =>
            renderCandidate(candidate, 'short', index === shortCandidates.length - 1))}
        </View>
      )}

      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Boosts</Text>
        <Text style={styles.subtle}>Players you already hold</Text>
      </View>
      {boostCandidates.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No held player is boostable this week.</Text>
          <Text style={styles.subtle}>Buy an eligible player in Market or refresh after the next week begins.</Text>
        </View>
      ) : (
        <View style={styles.listCard}>
          {boostCandidates.map((candidate, index) =>
            renderCandidate(candidate, 'boost', index === boostCandidates.length - 1))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { flexGrow: 1, padding: space.md, paddingBottom: space.xl, gap: space.sm },
  headingRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  title: { color: colors.text, fontSize: type.heading, fontWeight: '900' },
  badge: { color: colors.gold, fontSize: type.micro, fontWeight: '900', letterSpacing: 0.6 },
  subtle: { color: colors.muted, fontSize: type.micro, lineHeight: 17 },
  slotRow: { flexDirection: 'row', gap: space.sm },
  slotCard: {
    flex: 1,
    minWidth: 0,
    padding: space.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  slotLabel: { color: colors.muted, fontSize: type.micro, fontWeight: '800' },
  slotValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginTop: 4 },
  slotValue: { color: colors.text, fontSize: type.heading, fontWeight: '900', fontVariant: ['tabular-nums'] },
  slotHelp: { color: colors.gold, fontSize: type.micro, fontWeight: '800' },
  sectionHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  sectionTitle: { color: colors.text, fontSize: type.heading, fontWeight: '900', marginTop: space.md },
  emptyCard: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    gap: space.xs,
  },
  emptyTitle: { color: colors.text, fontSize: type.body, fontWeight: '800' },
  listCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  positionRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastRow: { borderBottomWidth: 0 },
  positionCopy: { flex: 1, minWidth: 0 },
  positionValue: { fontSize: type.label, fontWeight: '900', flexShrink: 0, fontVariant: ['tabular-nums'] },
  actionRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionCopy: { flex: 1, minWidth: 0 },
  rowName: { color: colors.text, fontSize: type.body, fontWeight: '800' },
  rowMeta: { color: colors.muted, fontSize: type.micro, marginTop: 2, fontVariant: ['tabular-nums'] },
  actionButton: {
    minWidth: 72,
    minHeight: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderColor: colors.red,
    borderWidth: 1,
    backgroundColor: '#3b1d24',
  },
  actionText: { color: colors.red, fontSize: type.micro, fontWeight: '900' },
  boostButton: {
    minWidth: 72,
    minHeight: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderColor: colors.green,
    borderWidth: 1,
    backgroundColor: '#103426',
  },
  boostText: { color: colors.green, fontSize: type.micro, fontWeight: '900' },
  positive: { color: colors.green },
  negative: { color: colors.red },
  disabled: { opacity: 0.38 },
  pressed: { opacity: 0.65 },
});
