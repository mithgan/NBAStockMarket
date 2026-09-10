import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type {
  PerGameMarketPlayer,
  PerGamePosition,
  PerGameSettledResult,
} from '../api/contracts';
import { splitPlayerName } from '../data/playerName';
import { lineChartCoordinates, smoothLinePath } from '../data/marketPresentation';
import {
  formatCompactMoney,
  formatCompactSignedMoney,
  formatMoney,
  formatSignedMoney,
} from '../format';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { colors, fonts, labelStyle, space, type, weight } from '../theme';
import { PlayerAvatar } from './PlayerAvatar';

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function Cell({ label, children }: { label: string; children: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={styles.cellValue}>{children}</Text>
    </View>
  );
}

/**
 * The per-game player profile: quote anchors, your position's economics, and
 * the nights he actually settled for you. Every readout names a real settled
 * date; the chart appears only once two nights exist to draw.
 */
export function PlayerProfileSheet({
  visible,
  onClose,
  player,
  position,
  results,
  dividendRate,
}: {
  visible: boolean;
  onClose: () => void;
  player: PerGameMarketPlayer | null;
  position: PerGamePosition | null;
  results: PerGameSettledResult[];
  dividendRate: number;
}) {
  const reducedMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  if (!player) return null;
  const { given, surname } = splitPlayerName(player.name);
  const settled = results
    .filter((result) => result.status === 'settled' && result.netPnl !== null)
    .sort((left, right) => left.gameDate.localeCompare(right.gameDate));
  const cumulative: number[] = [0];
  for (const result of settled) cumulative.push((cumulative.at(-1) ?? 0) + (result.netPnl ?? 0));
  const total = cumulative.at(-1) ?? 0;
  const chartWidth = Math.min(width, 520) - space.lg * 2;
  const coordinates = lineChartCoordinates(cumulative, chartWidth, 96);
  const zeroY = coordinates[0]?.y ?? 48;

  return (
    <Modal
      animationType={reducedMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <Pressable
        accessibilityLabel="Close player profile"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.scrim}
      />
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <PlayerAvatar player={{ id: player.playerId, name: player.name }} size={44} />
          <View style={styles.headCopy}>
            <Text numberOfLines={1} style={styles.kicker}>
              {[given.toUpperCase(), player.tier.toUpperCase()].filter(Boolean).join(' · ')}
            </Text>
            <Text accessibilityRole="header" numberOfLines={1} style={styles.surname}>
              {surname}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Close player profile"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.sheetBody}>
          <View style={styles.cells}>
            <Cell label="COST / GAME">{formatCompactMoney(player.currentGameCost)}</Cell>
            <View style={styles.cellRule} />
            <Cell label="LAST YEAR">
              {player.priorSeasonValuePerGame === null
                ? '—'
                : formatCompactMoney(player.priorSeasonValuePerGame)}
            </Cell>
            <View style={styles.cellRule} />
            <Cell label="YOUR LOCK">
              {position ? formatCompactMoney(position.lockedGameCost) : '—'}
            </Cell>
          </View>
          {position ? (
            <View
              accessible
              accessibilityLabel={[
                `${position.side === 'short' ? 'Inverse position' : 'Roster position'}`,
                `${position.side === 'short' ? 'cost credits' : 'game costs'} ${formatMoney(position.cumulativeGameCost)}`,
                `dividends ${formatMoney(position.cumulativeDividend)}`,
                `profit and loss ${formatSignedMoney(position.cumulativePnl)}`,
              ].join(', ')}
              style={styles.cells}
            >
              <Cell label={position.side === 'short' ? 'CREDITS' : 'COSTS'}>
                {formatCompactMoney(position.cumulativeGameCost)}
              </Cell>
              <View style={styles.cellRule} />
              <Cell label="DIVIDENDS">{formatCompactMoney(position.cumulativeDividend)}</Cell>
              <View style={styles.cellRule} />
              <View style={styles.cell}>
                <Text style={styles.cellLabel}>P&amp;L</Text>
                <Text
                  style={[
                    styles.cellValue,
                    position.cumulativePnl >= 0 ? styles.positive : styles.negative,
                  ]}
                >
                  {formatCompactSignedMoney(position.cumulativePnl)}
                </Text>
              </View>
            </View>
          ) : null}
          {settled.length >= 2 ? (
            <View
              accessible
              accessibilityLabel={`Cumulative profit and loss across ${settled.length} settled nights: ${formatSignedMoney(total)}`}
              style={styles.chart}
            >
              <Svg height={96} width={chartWidth}>
                <Path
                  d={`M 0 ${zeroY} L ${chartWidth} ${zeroY}`}
                  fill="none"
                  stroke={colors.border}
                  strokeDasharray="2 3"
                  strokeWidth={1}
                />
                <Path
                  d={smoothLinePath(coordinates)}
                  fill="none"
                  stroke={total >= 0 ? colors.green : colors.red}
                  strokeLinecap="round"
                  strokeWidth={2}
                />
              </Svg>
              <View style={styles.chartCaptions}>
                <Text style={styles.chartCaption}>
                  {dateLabel(settled[0].gameDate).toUpperCase()}
                </Text>
                <Text style={styles.chartCaption}>
                  {dateLabel(settled[settled.length - 1].gameDate).toUpperCase()}
                </Text>
              </View>
            </View>
          ) : null}
          <Text accessibilityRole="header" style={styles.sectionTitle}>Settled nights</Text>
          {settled.length === 0 ? (
            <Text style={styles.emptyCopy}>
              No settled nights for this player in your ledger yet.
            </Text>
          ) : (
            [...settled].reverse().slice(0, 10).map((result) => {
              const np = result.dividendDollars === null
                ? null
                : Math.round((result.dividendDollars / dividendRate) * 10) / 10;
              const pnl = result.netPnl ?? 0;
              return (
                <View key={`${result.gameId}-${result.resultRevision}`} style={styles.resultRow}>
                  <Text style={styles.resultDate}>{dateLabel(result.gameDate)}</Text>
                  <Text numberOfLines={1} style={styles.resultLine}>
                    {np === null ? '—' : `${np} np`} · {result.side === 'short' ? 'inverse' : 'roster'}
                  </Text>
                  <Text
                    accessibilityLabel={`Net ${formatSignedMoney(pnl)}`}
                    style={[styles.resultPnl, pnl >= 0 ? styles.positive : styles.negative]}
                  >
                    {formatCompactSignedMoney(pnl)}
                  </Text>
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheet: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    marginTop: 64,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderBottomWidth: 0,
  },
  sheetHead: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  headCopy: {
    minWidth: 0,
    flex: 1,
  },
  kicker: {
    ...labelStyle,
    letterSpacing: 0.6,
  },
  surname: {
    marginTop: 1,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.title,
    fontWeight: weight.heavy,
  },
  close: {
    minHeight: 44,
    justifyContent: 'center',
    paddingLeft: space.md,
  },
  closeText: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.bold,
  },
  sheetBody: {
    flex: 1,
  },
  cells: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  cell: {
    flex: 1,
    paddingHorizontal: space.lg,
  },
  cellRule: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  cellLabel: {
    ...labelStyle,
    marginBottom: 3,
  },
  cellValue: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  chart: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  chartCaptions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space.xs,
  },
  chartCaption: {
    ...labelStyle,
    fontSize: 10,
  },
  sectionTitle: {
    ...labelStyle,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  emptyCopy: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xl,
    color: colors.muted,
    fontSize: type.body,
    lineHeight: 20,
  },
  resultRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  resultDate: {
    width: 58,
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  resultLine: {
    minWidth: 0,
    flex: 1,
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontVariant: ['tabular-nums'],
  },
  resultPnl: {
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  positive: {
    color: colors.green,
  },
  negative: {
    color: colors.red,
  },
  pressed: {
    opacity: 0.72,
  },
});
