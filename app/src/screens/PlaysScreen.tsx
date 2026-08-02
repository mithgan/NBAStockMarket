import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Player } from '../data/types';
import { formatCompactMoney, formatCompactSignedMoney, formatMoney, formatSignedMoney } from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { DOLLARS_PER_NET_POINT, WEEKLY_TOTAL_CLAMP_NP } from '../state/game';
import { colors, fonts, labelStyle, numeric, radius, space, type, weight } from '../theme';
import { Button, SectionHeader, Tag } from '../ui/primitives';

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
      <Text style={styles.slotLabel}>{label.toUpperCase()}</Text>
      <View style={styles.slotValueRow}>
        <Text style={styles.slotValue}>{used}</Text>
        <Text style={styles.slotTotal}>/ {total}</Text>
        <Tag label={`${total - used} LEFT`} tone={total - used > 0 ? 'gold' : 'neutral'} />
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
        <Button
          accessibilityHint={
            slots.remaining === 0
              ? `No ${kind === 'short' ? 'short' : 'boost'} slots remain this week`
              : undefined
          }
          accessibilityLabel={kind === 'short'
            ? `Arm weekly short on ${player.name}, fee ${formatMoney(fee)}`
            : `Boost ${player.name} for ${gameDate}, fee ${formatMoney(fee)}`}
          compact
          disabled={disabled}
          fixedWidth={78}
          label={pending ? 'WAIT' : kind === 'short' ? 'SHORT' : 'BOOST'}
          onPress={() => void (kind === 'short'
            ? armShort(player)
            : armPlayerBoost(player, gameDate))}
          tone={kind === 'short' ? 'danger' : 'positive'}
        />
      </View>
    );
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.headingRow}>
        <View>
          <Text accessibilityRole="header" style={styles.title}>PLAYS</Text>
          <Text style={styles.titleMeta}>WEEKLY INSTRUMENTS</Text>
        </View>
        <Tag label={currentWeek ?? 'SEASON COMPLETE'} tone="gold" />
      </View>

      <View style={styles.slotRow}>
        <SlotCard label="Weekly shorts" total={shortSlots.total} used={shortSlots.used} />
        <SlotCard label="Boosts" total={boostSlots.total} used={boostSlots.used} />
      </View>
      <Text style={styles.rulesCopy}>
        Shorts reserve {formatCompactMoney(2_000_000)} collateral and settle at up to
        {' '}+/-{formatCompactMoney(WEEKLY_TOTAL_CLAMP_NP * DOLLARS_PER_NET_POINT)}. Boosts cost 0.25% and
        add one extra signed dividend, including losses. Slots reset each Monday.
      </Text>

      <SectionHeader label="OPEN POSITIONS" />
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

      <SectionHeader label="WEEKLY SHORTS" meta="UNOWNED ONLY" />
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

      <SectionHeader label="BOOSTS" meta="PLAYERS YOU HOLD" />
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
  content: { flexGrow: 1, paddingBottom: space.xxl },
  headingRow: {
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: weight.black,
    },
  titleMeta: { ...labelStyle, marginTop: 2 },
  subtle: { color: colors.muted, fontFamily: fonts.body, fontSize: type.label, lineHeight: 17 },
  rulesCopy: {
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.label,
    lineHeight: 17,
    paddingHorizontal: space.md,
    paddingTop: space.md,
  },

  slotRow: {
    paddingHorizontal: space.md,
    flexDirection: 'row',
    borderTopColor: colors.border,
    borderBottomColor: colors.border,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  slotCard: { flex: 1, minWidth: 0, paddingVertical: space.md, paddingRight: space.md },
  slotLabel: { ...labelStyle },
  slotValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs, marginTop: space.xs, flexWrap: 'wrap' },
  slotValue: { ...numeric, color: colors.text, fontSize: 26, fontWeight: weight.black },
  slotTotal: { ...numeric, color: colors.faint, fontSize: type.value, fontWeight: weight.heavy, marginRight: space.xs },

  list: { borderTopColor: colors.border, borderTopWidth: 1 },
  listCard: { borderTopColor: colors.border, borderTopWidth: 1 },
  emptyCard: {
    paddingHorizontal: space.md,
    paddingVertical: space.lg,
    gap: space.xs,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  emptyTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
  },

  positionRow: {
    paddingHorizontal: space.md,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  lastRow: { borderBottomWidth: 0 },
  positionCopy: { flex: 1, minWidth: 0 },
  positionValue: { ...numeric, fontSize: type.body, fontWeight: weight.black, flexShrink: 0 },

  actionRow: {
    paddingHorizontal: space.md,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  actionCopy: { flex: 1, minWidth: 0 },
  rowName: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
  },
  rowMeta: { ...numeric, color: colors.faint, fontSize: type.label, marginTop: 2, letterSpacing: 0.3 },

  positive: { color: colors.green },
  negative: { color: colors.red },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.62 },
});
