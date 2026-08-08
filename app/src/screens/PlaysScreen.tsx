import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Player } from '../data/types';
import { formatMoney, formatSignedMoney } from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { DOLLARS_PER_NET_POINT, WEEKLY_TOTAL_CLAMP_NP } from '../state/game';
import { colors } from '../theme';

interface PlayCandidate {
  player: Player;
  gameDate: string;
  fee: number;
}

function SlotCard({ label, used, total }: { label: string; used: number; total: number }) {
  return (
    <View style={styles.slotCard}>
      <Text style={styles.slotLabel}>{label}</Text>
      <Text style={styles.slotValue}>{used} / {total}</Text>
      <Text style={styles.slotHelp}>{total - used} available</Text>
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
    owns,
    pendingActions,
    players,
    shortSlots,
    state,
    weeklyShortTargets,
  } = usePortfolio();
  if (!state) return null;
  const playerById = new Map(players.map((player) => [player.id, player]));
  const accountMutationPending = pendingActions.size > 0;

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

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>WEEKLY PLAYS</Text>
      <Text accessibilityRole="header" style={styles.title}>Make your calls</Text>
      <Text style={styles.subtle}>
        Fade players against projection or double one held player&apos;s next signed dividend. Slots reset each Monday.
      </Text>

      <View style={styles.slotRow}>
        <SlotCard label="Weekly shorts" total={shortSlots.total} used={shortSlots.used} />
        <SlotCard label="Boosts" total={boostSlots.total} used={boostSlots.used} />
      </View>
      <View style={styles.ruleCard}>
        <Text style={styles.ruleTitle}>{currentWeek ?? 'Season complete'}</Text>
        <Text style={styles.ruleText}>Shorts reserve $2M collateral and settle at up to +/-{formatMoney(WEEKLY_TOTAL_CLAMP_NP * DOLLARS_PER_NET_POINT)}.</Text>
        <Text style={styles.ruleText}>Boosts cost 0.25% and add one extra signed dividend, including losses.</Text>
      </View>

      <Text accessibilityRole="header" style={styles.sectionTitle}>Open positions</Text>
      {activeShorts.length === 0 && usedBoosts.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No active plays this week.</Text>
          <Text style={styles.subtle}>Use one only when you have a real conviction.</Text>
        </View>
      ) : (
        <View style={styles.positionList}>
          {activeShorts.map((position) => {
            const player = playerById.get(position.playerId);
            const markedPayout = Math.max(
              -WEEKLY_TOTAL_CLAMP_NP,
              Math.min(WEEKLY_TOTAL_CLAMP_NP, position.accruedNetPoints),
            ) * DOLLARS_PER_NET_POINT;
            return (
              <View key={position.id} style={styles.positionRow}>
                <View style={styles.positionCopy}>
                  <Text style={styles.rowName}>{player?.name ?? position.playerId}</Text>
                  <Text style={styles.subtle}>WEEKLY SHORT · {position.qualifyingGames} games</Text>
                </View>
                <Text style={[styles.positionValue, { color: markedPayout >= 0 ? colors.green : colors.red }]}>
                  {formatSignedMoney(markedPayout)}
                </Text>
              </View>
            );
          })}
          {usedBoosts.map((boost) => (
            <View key={boost.id} style={styles.positionRow}>
              <View style={styles.positionCopy}>
                <Text style={styles.rowName}>{playerById.get(boost.playerId)?.name ?? boost.playerId}</Text>
                <Text style={styles.subtle}>BOOST · {boost.gameDate} · {boost.status.toUpperCase()}</Text>
              </View>
              <Text style={[styles.positionValue, { color: boost.payout >= 0 ? colors.green : colors.red }]}>
                {boost.status === 'armed' ? 'ARMED' : formatSignedMoney(boost.payout)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Text accessibilityRole="header" style={styles.sectionTitle}>Weekly shorts</Text>
      <Text style={styles.subtle}>Pick an unowned player before his first game of the week.</Text>
      {shortCandidates.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{nextGameDate ? 'No eligible players right now.' : 'Replay complete.'}</Text>
          <Text style={styles.subtle}>Refresh after the next server settlement or free a slot to see more options.</Text>
        </View>
      ) : (
        <View style={styles.actionList}>
          {shortCandidates.map(({ player, gameDate, fee }) => {
            const pending = pendingActions.has(`short:${player.id}`);
            const disabled = shortSlots.remaining === 0 || accountMutationPending;
            return (
              <View key={player.id} style={styles.actionRow}>
                <View style={styles.actionCopy}>
                  <Text numberOfLines={1} style={styles.rowName}>{player.name}</Text>
                  <Text style={styles.subtle}>Next game {gameDate} · fee {formatMoney(fee)}</Text>
                </View>
                <Pressable
                  accessibilityLabel={`Arm weekly short on ${player.name}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled }}
                  disabled={disabled}
                  onPress={() => void armShort(player, gameDate)}
                  style={({ pressed }) => [styles.actionButton, disabled && styles.disabled, pressed && styles.pressed]}
                >
                  <Text style={styles.actionText}>{pending ? 'WAIT' : 'SHORT'}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      <Text accessibilityRole="header" style={styles.sectionTitle}>Boosts</Text>
      <Text style={styles.subtle}>Hold a player first, then boost his next game this week.</Text>
      {boostCandidates.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No held player is boostable this week.</Text>
          <Text style={styles.subtle}>Buy an eligible player in Market or refresh after the next week begins.</Text>
        </View>
      ) : (
        <View style={styles.actionList}>
          {boostCandidates.map(({ player, gameDate, fee }) => {
            const pending = pendingActions.has(`boost:${player.id}`);
            const disabled = boostSlots.remaining === 0 || accountMutationPending;
            const actionLabel = pending ? 'WAIT' : 'BOOST';
            return (
              <View key={player.id} style={styles.actionRow}>
                <View style={styles.actionCopy}>
                  <Text numberOfLines={1} style={styles.rowName}>{player.name}</Text>
                  <Text style={styles.subtle}>{gameDate} · fee {formatMoney(fee)}</Text>
                </View>
                <Pressable
                  accessibilityLabel={`Boost ${player.name} for ${gameDate}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled }}
                  disabled={disabled}
                  onPress={() => void armPlayerBoost(player, gameDate)}
                  style={({ pressed }) => [styles.boostButton, disabled && styles.disabled, pressed && styles.pressed]}
                >
                  <Text style={styles.boostText}>{actionLabel}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { flexGrow: 1, padding: 16, paddingBottom: 36, gap: 10 },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 29, fontWeight: '900' },
  subtle: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  slotRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  slotCard: { flex: 1, minWidth: 0, padding: 14, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8 },
  slotLabel: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  slotValue: { color: colors.text, fontSize: 22, fontWeight: '900', marginTop: 6 },
  slotHelp: { color: colors.gold, fontSize: 10, fontWeight: '700', marginTop: 2 },
  ruleCard: { padding: 14, backgroundColor: colors.goldSoft, borderColor: colors.gold, borderWidth: 1, borderRadius: 8, gap: 4 },
  ruleTitle: { color: colors.gold, fontSize: 11, fontWeight: '900' },
  ruleText: { color: colors.text, fontSize: 10, lineHeight: 15 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '900', marginTop: 13 },
  emptyCard: { padding: 16, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, gap: 4 },
  emptyTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  positionList: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  positionRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  positionCopy: { flex: 1, minWidth: 0 },
  positionValue: { fontSize: 12, fontWeight: '900' },
  actionList: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  actionRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  actionCopy: { flex: 1, minWidth: 0 },
  rowName: { color: colors.text, fontSize: 13, fontWeight: '800' },
  actionButton: { minWidth: 72, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 6, borderColor: colors.red, borderWidth: 1, backgroundColor: '#3b1d24' },
  actionText: { color: colors.red, fontSize: 10, fontWeight: '900' },
  boostButton: { minWidth: 72, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 6, borderColor: colors.green, borderWidth: 1, backgroundColor: '#103426' },
  boostText: { color: colors.green, fontSize: 10, fontWeight: '900' },
  disabled: { opacity: 0.38 },
  pressed: { opacity: 0.65 },
});
