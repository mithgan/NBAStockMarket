import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PortfolioHistoryChart } from '../components/PortfolioHistoryChart';
import { Sparkline } from '../components/Sparkline';
import { formatCompactMoney, formatCompactSignedMoney } from '../format';
import { useDesignVariant } from '../theme/ThemeProvider';
import { colors, fonts, headingStyle, numeric, radius, space, type, weight } from '../theme';
import { DesignScreen } from '../components/DesignScreen';
import type { TrendPoint } from '../data/trendPresentation';
import type { PortfolioPoint } from '../state/game';

/**
 * /treatments gallery. Mock portfolio and market rows with hand-picked sample
 * values, so every treatment can be judged on realistic content without an
 * account, followed by the picker itself (DesignScreen).
 */

/** A plausible five-week bankroll ride, in millions. */
const SAMPLE_TOTALS = [
  140.1, 140.4, 139.9, 140.8, 141.2, 140.7, 141.6, 142.3, 141.8, 142.6, 143.1,
  142.7, 143.6, 144.2, 143.8, 144.9, 145.4, 145, 145.9, 146.4, 146, 147.34,
];

const SAMPLE_DATES = [
  '2025-11-15', '2025-11-16', '2025-11-18', '2025-11-19', '2025-11-21',
  '2025-11-22', '2025-11-24', '2025-11-25', '2025-11-27', '2025-11-28',
  '2025-11-30', '2025-12-01', '2025-12-02', '2025-12-04', '2025-12-05',
  '2025-12-07', '2025-12-08', '2025-12-09', '2025-12-10', '2025-12-11',
  '2025-12-12', '2025-12-14',
];

const SAMPLE_POINTS: PortfolioPoint[] = SAMPLE_TOTALS.map((value, index) => ({
  id: `sample-${index}`,
  date: SAMPLE_DATES[index],
  cash: 52_700_000,
  marketValue: 1e6 * value - 52_700_000,
  totalValue: 1e6 * value,
  dailyChange: index === 0 ? 0 : 1e6 * (value - SAMPLE_TOTALS[index - 1]),
}));

/** Deterministic wobbly trend, so sparklines differ per player yet never change between renders. */
function sampleTrend(seed: number, length = 15): TrendPoint[] {
  return Array.from({ length }, (_, index) => {
    const swing = 6.2 * Math.sin((index + 1) * seed) + 3.1 * Math.cos(index * seed * 0.7) + 0.6 * seed;
    return {
      date: `2025-12-${String((index % 28) + 1).padStart(2, '0')}`,
      np: 24 + swing,
      expected_np: 24,
      dividend_per_holder: 40_000 * swing,
    };
  });
}

const SAMPLE_HOLDINGS = [
  { name: 'Shai Gilgeous-Alexander', tier: 'star', cost: 58_200_000, price: 63_148_900, seed: 1.3 },
  { name: 'Collin Sexton', tier: 'rotation', cost: 9_800_000, price: 8_904_200, seed: 2.7 },
  { name: 'Nikola Jokic', tier: 'star', cost: 68_400_000, price: 69_801_500, seed: 0.9 },
];

const SAMPLE_MARKET = [
  { name: 'Victor Wembanyama', tier: 'star', price: 61_402_000, move: 4.12, form: 2.4, seed: 1.9, held: false },
  { name: 'Tyrese Maxey', tier: 'starter', price: 28_940_000, move: -1.86, form: -0.8, seed: 3.4, held: true },
  { name: 'Alperen Sengun', tier: 'starter', price: 24_115_000, move: 2.05, form: 1.1, seed: 2.2, held: false },
  { name: 'Naz Reid', tier: 'rotation', price: 7_680_000, move: -0.42, form: 0.3, seed: 4.1, held: false },
];

export function DesignPreviewScreen() {
  const { layout, variant } = useDesignVariant();
  const sampleTotal = SAMPLE_POINTS.at(-1)!.totalValue;
  const sampleChange = SAMPLE_POINTS.at(-1)!.dailyChange;
  return (
    <ScrollView style={styles.scroll}>
      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          Treatment picker. Sample values, no account needed. A treatment picked here applies to the app too. Drop /treatments from the address to play it.
        </Text>
      </View>
      <PortfolioHistoryChart
        footnote="Settled 2025-12-14. Includes cash payouts and player-price movement."
        height={variant.chartHeight}
        points={SAMPLE_POINTS}
        totalValue={sampleTotal}
      />
      <View style={styles.cashStrip}>
        <View style={styles.cashCell}>
          <Text style={styles.cashLabel}>Free cash</Text>
          <Text style={styles.cashValue}>{formatCompactMoney(52_700_000)}</Text>
        </View>
        <View style={styles.cashCell}>
          <Text style={styles.cashLabel}>Holdings</Text>
          <Text style={styles.cashValue}>{formatCompactMoney(141_854_600)}</Text>
        </View>
        <View style={styles.cashCell}>
          <Text style={styles.cashLabel}>All time</Text>
          <Text style={[styles.cashValue, styles.positive]}>+5.24%</Text>
        </View>
      </View>
      <Text accessibilityRole="header" style={styles.sectionHeading}>Your players</Text>
      <View>
        {SAMPLE_HOLDINGS.map((holding) => {
          const change = holding.price - holding.cost;
          const up = change >= 0;
          return (
            <View key={holding.name} style={[styles.row, (layout as string) === 'grid' && styles.rowGrid]}>
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={styles.rowName}>{holding.name}</Text>
                <Text numberOfLines={1} style={styles.rowMeta}>
                  {`1 share · cost ${formatCompactMoney(holding.cost)}`}
                </Text>
              </View>
              <Sparkline points={sampleTrend(holding.seed)} />
              <View style={styles.rowNumbers}>
                <Text
                  style={[
                    styles.rowValue,
                    variant.signAs === 'chip' && styles.rowValueFilled,
                    variant.signAs === 'chip' && (up ? styles.fillUp : styles.fillDown),
                  ]}
                >
                  {formatCompactMoney(holding.price)}
                </Text>
                <Text style={[styles.rowPnl, up ? styles.positive : styles.negative]}>
                  {variant.signAs === 'arrow'
                    ? `${up ? '▲' : '▼'} ${formatCompactSignedMoney(change)}`
                    : formatCompactSignedMoney(change)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      <Text accessibilityRole="header" style={styles.sectionHeading}>Market</Text>
      <View>
        {SAMPLE_MARKET.map((player) => {
          const up = player.move >= 0;
          return (
            <View key={player.name} style={styles.row}>
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={styles.rowName}>{player.name}</Text>
                <Text numberOfLines={1} style={styles.rowMeta}>
                  {`${player.tier} · L15 ${player.form >= 0 ? '+' : ''}${player.form.toFixed(1)} NP`}
                </Text>
              </View>
              <Sparkline points={sampleTrend(player.seed)} />
              <View style={styles.rowNumbers}>
                <Text style={styles.rowValue}>{formatCompactMoney(player.price)}</Text>
                <Text style={[styles.rowPnl, up ? styles.positive : styles.negative]}>
                  {`${up ? '▲' : '▼'} ${Math.abs(player.move).toFixed(2)}%`}
                </Text>
              </View>
              <View style={[styles.action, player.held && styles.actionHeld]}>
                <Text style={[styles.actionText, player.held && styles.actionTextHeld]}>
                  {player.held ? 'Sell' : 'Buy'}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      <View style={styles.divider} />
      <DesignScreen />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  banner: {
    backgroundColor: colors.goldSoft,
    borderBottomColor: colors.goldLine,
    borderBottomWidth: 1,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  bannerText: {
    color: colors.goldInk,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 18,
  },
  cashStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xl,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    marginTop: space.sm,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  cashCell: { minWidth: 92 },
  cashLabel: {
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.body,
    fontWeight: weight.medium,
  },
  cashValue: {
    ...numeric,
    color: colors.text,
    fontSize: type.title,
    fontWeight: weight.heavy,
    marginTop: 3,
  },
  sectionHeading: {
    ...headingStyle,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  rowGrid: {
    minHeight: 48,
    paddingVertical: space.xs,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    borderBottomWidth: 0,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowName: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  rowMeta: {
    ...numeric,
    color: colors.faint,
    fontSize: type.body,
    fontWeight: weight.medium,
    marginTop: 2,
  },
  rowNumbers: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  rowValue: {
    ...numeric,
    color: colors.text,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  rowPnl: {
    ...numeric,
    fontSize: type.body,
    fontWeight: weight.heavy,
    marginTop: 2,
  },
  rowValueFilled: {
    overflow: 'hidden',
    borderRadius: radius.md,
    paddingHorizontal: 7,
    paddingVertical: 3,
    minWidth: 76,
    textAlign: 'right',
  },
  fillUp: { backgroundColor: colors.greenSoft },
  fillDown: { backgroundColor: colors.redSoft },
  action: {
    minHeight: 34,
    minWidth: 62,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.goldLine,
  },
  actionHeld: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionText: {
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
    color: colors.goldInk,
  },
  actionTextHeld: {
    color: colors.muted,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: space.xl,
  },
  positive: { color: colors.green },
  negative: { color: colors.red },
});
