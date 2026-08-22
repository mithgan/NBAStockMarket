import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { PlayerAvatar } from '../components/PlayerAvatar';
import { PositionCard } from '../components/PositionCard';
import type { Player } from '../data/types';
import { formatCompactMoney, formatMoney, formatSignedMoney } from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { WEEKLY_SHORT_DOLLARS_PER_NET_POINT } from '../state/economy';
import { WEEKLY_TOTAL_CLAMP_NP } from '../state/game';
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
  const [rulesOpen, setRulesOpen] = useState(false);
  const {
    armPlayerBoost,
    armShort,
    boostTargets,
    boostSlots,
    currentWeek,
    isSeasonComplete,
    nextGameDate,
    pendingActions,
    players,
    shortSlots,
    state,
    weeklyShortTargets,
  } = usePortfolio();
  const { width } = useWindowDimensions();
  if (!state) return null;
  const playerById = new Map(players.map((player) => [player.id, player]));
  const accountMutationPending = pendingActions.size > 0;
  // Position cards pack into as many columns as fit a comfortable card width,
  // capped at the same 1040px content column the rest of the app uses.
  const contentWidth = Math.min(width, 1040) - 2 * space.md;
  const columns = contentWidth >= 880 ? 5 : contentWidth >= 660 ? 4 : contentWidth >= 460 ? 3 : 2;
  const cardWidth = Math.floor((contentWidth - space.sm * (columns - 1)) / columns);
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
        <PlayerAvatar player={player} size={34} />
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
        <Tag label={currentWeek ?? (isSeasonComplete ? 'SEASON COMPLETE' : 'WAITING FOR SCHEDULE')} tone="gold" />
      </View>

      <Text
        accessibilityLabel={`Weekly shorts, ${shortSlots.used} of ${shortSlots.total} used. Boosts, ${boostSlots.used} of ${boostSlots.total} used. Slots reset each Monday.`}
        numberOfLines={1}
        style={styles.slotLine}
      >
        <Text style={styles.slotStrong}>{`SHORTS ${shortSlots.used}/${shortSlots.total}`}</Text>
        {'   ·   '}
        <Text style={styles.slotStrong}>{`BOOSTS ${boostSlots.used}/${boostSlots.total}`}</Text>
      </Text>
      <Pressable
        accessibilityLabel={rulesOpen ? 'Collapse how plays work' : 'Expand how plays work'}
        accessibilityRole="button"
        accessibilityState={{ expanded: rulesOpen }}
        onPress={() => setRulesOpen((current) => !current)}
        style={({ pressed }: { pressed: boolean }) => [styles.rulesToggle, pressed && styles.pressed]}
      >
        <Text style={styles.rulesToggleText}>{`How plays work  ${rulesOpen ? '▾' : '▸'}`}</Text>
      </Pressable>
      {rulesOpen ? (
        <Text style={styles.rulesCopy}>
        Shorts reserve {formatCompactMoney(2_000_000)} collateral and settle at up to
        {' '}+/-{formatCompactMoney(WEEKLY_TOTAL_CLAMP_NP * WEEKLY_SHORT_DOLLARS_PER_NET_POINT)}. Boosts cost 0.25% and
        add one extra signed dividend, including losses. Slots reset each Monday.
        </Text>
      ) : null}

      <SectionHeader label="OPEN POSITIONS" />
      {activeShorts.length === 0 && usedBoosts.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No active plays this week.</Text>
          <Text style={styles.subtle}>Use one only when you have a real conviction.</Text>
        </View>
      ) : (
        <View>
          {activeShorts.map((position) => {
            const markedPayout = Math.max(
              -WEEKLY_TOTAL_CLAMP_NP,
              Math.min(WEEKLY_TOTAL_CLAMP_NP, position.accruedNetPoints),
            ) * WEEKLY_SHORT_DOLLARS_PER_NET_POINT;
            return (
              <PositionCard
                clampValue={WEEKLY_TOTAL_CLAMP_NP * WEEKLY_SHORT_DOLLARS_PER_NET_POINT}
                figureLabel="MARKED"
                key={position.id}
                kind="SHORT"
                markedLabel={`Marked at ${formatSignedMoney(markedPayout)}`}
                markedValue={markedPayout}
                meta={`${position.qualifyingGames} ${position.qualifyingGames === 1 ? 'game' : 'games'} settled`}
                player={playerById.get(position.playerId)}
                width={cardWidth}
              />
            );
          })}
          {usedBoosts.map((boost) => (
            <PositionCard
              // A boost has no clamp; the meter just fills fully when settled.
              clampValue={Math.max(Math.abs(boost.payout), 1)}
              figureLabel={boost.status === 'armed' ? 'ARMED' : 'SETTLED'}
              key={boost.id}
              kind="BOOST"
              markedLabel={boost.status === 'armed'
                ? 'Armed, not settled yet'
                : `Settled at ${formatSignedMoney(boost.payout)}`}
              markedValue={boost.payout}
              meta={boost.status === 'armed'
                ? `Armed for ${boost.gameDate}`
                : `${boost.status} · ${boost.gameDate}`}
              player={playerById.get(boost.playerId)}
              settled={boost.status !== 'armed'}
              width={cardWidth}
            />
          ))}
        </View>
      )}

      <SectionHeader label="WEEKLY SHORTS" meta="UNOWNED ONLY" />
      {shortCandidates.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>
            {nextGameDate
              ? 'No eligible players right now.'
              : isSeasonComplete
                ? 'Replay complete.'
                : 'Waiting for the next game date.'}
          </Text>
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

  slotLine: {
    ...numeric,
    color: colors.faint,
    fontSize: type.body,
    fontWeight: weight.medium,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
  },
  slotStrong: { ...labelStyle, color: colors.text },
  rulesToggle: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  rulesToggleText: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    letterSpacing: 0.6,
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
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingTop: space.xs,
  },
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
  positionValue: { ...numeric, fontSize: type.value, fontWeight: weight.black, flexShrink: 0 },
  clampTrack: {
    height: 4,
    marginTop: 6,
    borderRadius: radius.xs,
    backgroundColor: colors.border,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  clampMidpoint: {
    position: 'absolute',
    left: '50%',
    width: 1,
    top: 0,
    bottom: 0,
    backgroundColor: colors.borderStrong,
  },
  clampFill: { position: 'absolute', left: '50%', height: 4, borderRadius: radius.xs },
  clampUp: { backgroundColor: colors.green },
  clampDown: { backgroundColor: colors.red, left: undefined, right: '50%' },

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
