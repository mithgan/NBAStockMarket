import { StyleSheet, Text, View } from 'react-native';

import { derivePlayerStats } from '../data/playerStats';
import { formatCompactSignedMoney } from '../format';
import type { TrendPoint } from '../data/trendPresentation';
import { colors, fonts, numeric, space, type, weight } from '../theme';

function signed(value: number, digits = 1): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

/**
 * Season-to-date read on one player: headline rates in a ruled grid, then a
 * ten-game log, newest first. Everything derives from the same settled trend
 * points the charts draw from, so the two can never disagree.
 */
export function PlayerStats({ points }: { points: TrendPoint[] }) {
  const stats = derivePlayerStats(points);
  if (!stats) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          No settled games yet. Stats appear once a date this player played has settled.
        </Text>
      </View>
    );
  }

  const cells: { key: string; value: string; hint: string; tone?: 'up' | 'down' }[] = [
    {
      key: 'Net points / game',
      value: stats.avgNp.toFixed(1),
      hint: `projected ${stats.avgExpected.toFixed(1)}`,
    },
    {
      key: 'Surprise / game',
      value: signed(stats.avgSurprise),
      hint: 'actual less projected',
      tone: stats.avgSurprise >= 0 ? 'up' : 'down',
    },
    {
      key: 'Beat rate',
      value: `${Math.round(100 * stats.beatRate)}%`,
      hint: `${Math.round(stats.beatRate * stats.games)} of ${stats.games} games`,
      tone: stats.beatRate >= 0.5 ? 'up' : 'down',
    },
    {
      key: 'Consistency',
      value: `±${stats.consistency.toFixed(1)}`,
      hint: 'lower is more repeatable',
    },
    {
      key: 'Last 5 form',
      value: signed(stats.lastFive),
      hint: 'surprise per game',
      tone: stats.lastFive >= 0 ? 'up' : 'down',
    },
    {
      key: 'Paid holders',
      value: formatCompactSignedMoney(stats.totalPaid),
      hint: `across ${stats.games} settled games`,
      tone: stats.totalPaid >= 0 ? 'up' : 'down',
    },
  ];
  const recent = [...points].reverse().slice(0, 10);

  return (
    <View>
      <View style={styles.grid}>
        {cells.map((cell) => (
          <View key={cell.key} style={styles.cell}>
            <Text style={styles.cellKey}>{cell.key.toUpperCase()}</Text>
            <Text
              style={[styles.cellValue, cell.tone === 'up' && styles.up, cell.tone === 'down' && styles.down]}
            >
              {cell.value}
            </Text>
            <Text style={styles.cellHint}>{cell.hint}</Text>
          </View>
        ))}
      </View>
      <View style={styles.logHead}>
        <Text style={[styles.logCol, styles.colDate]}>DATE</Text>
        <Text style={[styles.logCol, styles.colNum]}>NP</Text>
        <Text style={[styles.logCol, styles.colNum]}>PROJ</Text>
        <Text style={[styles.logCol, styles.colNum]}>+/-</Text>
        <Text style={[styles.logCol, styles.colPay]}>PAID</Text>
      </View>
      {recent.map((point) => {
        const surprise = point.np - point.expected_np;
        const beat = surprise >= 0;
        return (
          <View
            accessibilityLabel={`${point.date}. ${point.np.toFixed(1)} net points against ${point.expected_np.toFixed(1)} projected, ${beat ? 'up' : 'down'} ${Math.abs(surprise).toFixed(1)}, paid ${formatCompactSignedMoney(point.dividend_per_holder)}`}
            key={point.date}
            style={styles.logRow}
          >
            <Text numberOfLines={1} style={[styles.logCell, styles.colDate]}>
              {point.date}
            </Text>
            <Text style={[styles.logCell, styles.colNum]}>{point.np.toFixed(1)}</Text>
            <Text style={[styles.logCell, styles.colNum, styles.dim]}>
              {point.expected_np.toFixed(1)}
            </Text>
            <Text style={[styles.logCell, styles.colNum, beat ? styles.up : styles.down]}>
              {signed(surprise)}
            </Text>
            <Text style={[styles.logCell, styles.colPay, beat ? styles.up : styles.down]}>
              {formatCompactSignedMoney(point.dividend_per_holder)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  // 33% basis with a minWidth floor: three-up on wide screens, reflowing to
  // two-up before any cell gets crushed.
  cell: {
    flexGrow: 1,
    flexBasis: '33%',
    minWidth: 108,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRightColor: colors.border,
    borderBottomColor: colors.border,
    borderRightWidth: 1,
    borderBottomWidth: 1,
  },
  cellKey: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.8,
  },
  cellValue: {
    ...numeric,
    color: colors.text,
    fontSize: type.title,
    fontWeight: weight.black,
    marginTop: 4,
  },
  cellHint: {
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.label,
    marginTop: 3,
  },
  logHead: {
    flexDirection: 'row',
    paddingHorizontal: space.md,
    paddingTop: space.lg,
    paddingBottom: space.xs,
  },
  logCol: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.8,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    paddingHorizontal: space.md,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  logCell: {
    ...numeric,
    color: colors.text,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  colDate: { flex: 1, textAlign: 'left' },
  colNum: { width: 54, textAlign: 'right' },
  colPay: { width: 72, textAlign: 'right' },
  dim: { color: colors.faint, fontWeight: weight.medium },
  up: { color: colors.green },
  down: { color: colors.red },
  empty: { paddingHorizontal: space.md, paddingVertical: space.lg },
  emptyText: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 18,
  },
});
