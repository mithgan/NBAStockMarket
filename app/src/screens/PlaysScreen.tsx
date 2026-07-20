import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { weekKey } from '../data/replay';
import { players } from '../data/snapshot';
import type { Player } from '../data/types';
import { formatMoney, formatSignedMoney } from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import {
  BOOST_SLOTS,
  DOLLARS_PER_NET_POINT,
  WEEKLY_SHORT_SLOTS,
  WEEKLY_TOTAL_CLAMP_NP,
} from '../state/game';
import { colors } from '../theme';

const playerById = new Map(players.map((player) => [player.id, player]));

interface BoostCandidate {
  player: Player;
  gameDate: string;
  selected: boolean;
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
    currentWeek,
    nextPlayerGame,
    nextReplayDay,
    owns,
    state,
  } = usePortfolio();

  const activeShorts = state.weeklyShorts.filter(
    (position) => position.week === currentWeek && position.status === 'active',
  );
  const usedBoosts = state.boosts.filter(
    (position) => position.week === currentWeek && position.status !== 'refunded',
  );
  const activeShortIds = new Set(activeShorts.map((position) => position.playerId));
  const boostedIds = new Set(usedBoosts.map((position) => position.playerId));
  const settledPlayerWeeks = new Set(state.settledPlayerWeeks);

  const shortCandidates = currentWeek ? players.filter((player) => {
    const event = nextPlayerGame(player.id);
    return (
      event
      && weekKey(event.date) === currentWeek
      && !owns(player.id)
      && !boostedIds.has(player.id)
      && !settledPlayerWeeks.has(`${currentWeek}:${player.id}`)
    );
  }) : [];

  const boostCandidates: BoostCandidate[] = currentWeek ? state.holdings.flatMap<BoostCandidate>((holding) => {
    const player = playerById.get(holding.player_id);
    const armedBoost = usedBoosts.find(
      (boost) => boost.playerId === holding.player_id && boost.status === 'armed',
    );
    if (!player) return [];
    if (armedBoost) {
      return [{ player, gameDate: armedBoost.gameDate, selected: true }];
    }
    const event = player ? nextPlayerGame(player.id) : null;
    if (!player || !event || weekKey(event.date) !== currentWeek) return [];
    if (activeShortIds.has(player.id)) return [];
    return [{ player, gameDate: event.date, selected: false }];
  }) : [];

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>WEEKLY PLAYS</Text>
      <Text accessibilityRole="header" style={styles.title}>Make your calls</Text>
      <Text style={styles.subtle}>
        Fade players against projection or double one held player&apos;s next signed dividend. Slots reset each Monday.
      </Text>

      <View style={styles.slotRow}>
        <SlotCard label="Weekly shorts" total={WEEKLY_SHORT_SLOTS} used={activeShorts.length} />
        <SlotCard label="Boosts" total={BOOST_SLOTS} used={usedBoosts.length} />
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
          <Text style={styles.emptyTitle}>{nextReplayDay ? 'No eligible players right now.' : 'Replay complete.'}</Text>
          <Text style={styles.subtle}>Advance the replay or free a slot to see more options.</Text>
        </View>
      ) : (
        <View style={styles.actionList}>
          {shortCandidates.map((player) => {
            const event = nextPlayerGame(player.id)!;
            const selected = activeShortIds.has(player.id);
            const disabled = selected || activeShorts.length >= WEEKLY_SHORT_SLOTS;
            return (
              <View key={player.id} style={styles.actionRow}>
                <View style={styles.actionCopy}>
                  <Text numberOfLines={1} style={styles.rowName}>{player.name}</Text>
                  <Text style={styles.subtle}>Next game {event.date} · fee {formatMoney(Math.max(10_000, state.prices[player.id] * 0.0025))}</Text>
                </View>
                <Pressable
                  accessibilityLabel={selected ? `${player.name} weekly short armed` : `Arm weekly short on ${player.name}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled }}
                  disabled={disabled}
                  onPress={() => armShort(player)}
                  style={({ pressed }) => [styles.actionButton, disabled && styles.disabled, pressed && styles.pressed]}
                >
                  <Text style={styles.actionText}>{selected ? 'ARMED' : 'SHORT'}</Text>
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
          <Text style={styles.subtle}>Buy an eligible player in Market or advance to the next week.</Text>
        </View>
      ) : (
        <View style={styles.actionList}>
          {boostCandidates.map(({ player, gameDate, selected }) => {
            const disabled = selected || usedBoosts.length >= BOOST_SLOTS;
            const actionLabel = selected ? 'ARMED' : 'BOOST';
            return (
              <View key={player.id} style={styles.actionRow}>
                <View style={styles.actionCopy}>
                  <Text numberOfLines={1} style={styles.rowName}>{player.name}</Text>
                  <Text style={styles.subtle}>{gameDate} · fee {formatMoney(state.prices[player.id] * 0.0025)}</Text>
                </View>
                <Pressable
                  accessibilityLabel={selected ? `${player.name} boost ${actionLabel.toLowerCase()}` : `Boost ${player.name} for ${gameDate}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled }}
                  disabled={disabled}
                  onPress={() => armPlayerBoost(player)}
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
