import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Polygon, Stop, Text as SvgText } from 'react-native-svg';

import { nearestPointIndex } from '../data/chartGeometry';
import type { ChartCoordinate } from '../data/marketPresentation';
import {
  availablePortfolioRanges,
  chartCoordinates,
  portfolioPeriodChange,
  selectPortfolioRange,
  type PortfolioRange,
} from '../data/portfolioRanges';
import {
  formatCompactMoney,
  formatCompactSignedMoney,
  formatMoney,
  formatSignedMoney,
} from '../format';
import { useChartSurface } from '../hooks/useChartSurface';
import { useCountUp } from '../hooks/useCountUp';
import { STARTING_CASH, type PortfolioPoint } from '../state/game';
import { colors, fonts, heroNumber, labelStyle, numeric, space, type, weight } from '../theme';

const DEFAULT_CHART_HEIGHT = 168;

/**
 * The portfolio hero: an animated total, a scrubbable area chart of settled
 * portfolio value, and range tabs that only appear once the history is long
 * enough for a shorter window to mean anything.
 *
 * Scrubbing feeds one pair of handlers from two inputs: DOM pointer events
 * via useChartSurface (hover on web) and a PanResponder (touch drags).
 */
export function PortfolioHistoryChart({
  points,
  height = DEFAULT_CHART_HEIGHT,
  totalValue,
  earnings,
  freeCash,
  beforePlot,
}: {
  points: PortfolioPoint[];
  height?: number;
  totalValue?: number;
  /** Tonight and trailing-week dividends — tonight IS the hero now. */
  earnings?: { tonight: number; week: number } | null;
  /** Spendable cash, for the demoted balance line above the plot. */
  freeCash?: number;
  /** Rendered between the hero number and the plot — the "what happened last
      night" strip lives here so the daily update is read before the chart. */
  beforePlot?: ReactNode;
}) {
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [range, setRange] = useState<PortfolioRange>('1M');
  // The scrub handlers stay stable across renders; they read the latest
  // geometry through this ref instead of re-subscribing pointer listeners.
  const scrubGeometry = useRef<{ coordinates: ChartCoordinate[]; width: number }>({
    coordinates: [],
    width: 0,
  });
  const handleScrub = useCallback((locationX: number) => {
    const index = nearestPointIndex(
      scrubGeometry.current.coordinates,
      locationX,
      scrubGeometry.current.width,
    );
    setScrubIndex((current) => (current === index ? current : index));
  }, []);
  const endScrub = useCallback(() => setScrubIndex(null), []);
  const { width, ref, onLayout } = useChartSurface({ onScrub: handleScrub, onScrubEnd: endScrub });
  const ranges = useMemo(() => availablePortfolioRanges(points.length), [points.length]);
  // A stored pick can outlive its availability when the history shrinks
  // (account reset); fall back to the always-available full season.
  const activeRange = ranges.includes(range) ? range : 'Season';
  const { visible, baseline } = useMemo(
    () => selectPortfolioRange(points, activeRange, STARTING_CASH),
    [activeRange, points],
  );
  const { coordinates, linePath, areaPath } = useMemo(() => {
    const coords = chartCoordinates(visible.map((point) => point.totalValue), width, height);
    const line = coords
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
      .join(' ');
    return {
      coordinates: coords,
      linePath: line,
      areaPath: coords.length > 0
        ? `${line} L ${coords.at(-1)!.x} ${height} L ${coords[0].x} ${height} Z`
        : '',
    };
  }, [height, visible, width]);
  const lastCoordinate = coordinates.at(-1) ?? null;
  scrubGeometry.current = { coordinates, width };
  // Sparkline discipline (after the declutter research): the plot keeps only
  // the line, its fill, the dashed start-of-range rule, and the end value.
  const baselineY = useMemo(() => {
    const values = visible.map((point) => point.totalValue);
    if (values.length === 0) return null;
    const high = Math.max(...values);
    const low = Math.min(...values);
    const span = high - low;
    if (span === 0) return height / 2;
    if (baseline <= low || baseline >= high) return null;
    return 12 + ((high - baseline) / span) * (height - 24);
  }, [baseline, height, visible]);
  const firstDate = visible[0]?.date ?? null;
  const lastDate = visible.at(-1)?.date ?? null;
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => handleScrub(event.nativeEvent.locationX),
        onPanResponderMove: (event) => handleScrub(event.nativeEvent.locationX),
        onPanResponderRelease: endScrub,
        onPanResponderTerminate: endScrub,
      }),
    [endScrub, handleScrub],
  );
  const scrubPoint = scrubIndex === null ? null : visible[scrubIndex] ?? null;
  const scrubCoordinate = scrubIndex === null ? null : coordinates[scrubIndex] ?? null;
  const latestValue = totalValue ?? visible.at(-1)?.totalValue ?? STARTING_CASH;
  const shownValue = scrubPoint ? scrubPoint.totalValue : latestValue;
  const change = scrubPoint
    ? scrubPoint.totalValue - baseline
    : portfolioPeriodChange(visible, baseline);
  const changePct = baseline === 0 ? 0 : (change / baseline) * 100;
  const up = change >= 0;
  const changeColor = up ? colors.green : colors.red;
  // The hero counts up on tonight's result — the thing that changed.
  const tonight = earnings?.tonight ?? 0;
  const animatedTonight = useCountUp(tonight);
  const animatedWeek = useCountUp(earnings?.week ?? 0);
  const animatedChange = useCountUp(change, scrubPoint !== null);
  const emptyHero = useCountUp(latestValue);
  const heroColor = tonight > 0 ? colors.green : tonight < 0 ? colors.red : colors.muted;

  if (visible.length === 0) {
    return (
      <View onLayout={onLayout} ref={ref} style={[styles.emptyBlock, { minHeight: height }]}>
        <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={styles.heroValue}>
          {formatCompactMoney(emptyHero)}
        </Text>
        <Text style={styles.emptyTitle}>Your chart starts after the first replay day.</Text>
        <Text style={styles.emptyText}>
          Buy a player, then settle the next date to see your portfolio move.
        </Text>
      </View>
    );
  }

  return (
    <View
      accessible
      accessibilityLabel={`Portfolio value ${formatMoney(latestValue)}. Over the selected range, ${formatSignedMoney(portfolioPeriodChange(visible, baseline))} across ${visible.length} settled dates.`}
      style={styles.block}
    >
      <View style={styles.hero}>
        {/* The inversion the council ordered: with flat prices net worth
            cannot move, so the thing that CAN — tonight's result — takes the
            hero slot, and the balance sheet demotes to a line over its graph. */}
        <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={styles.heroKicker}>TONIGHT</Text>
        <Text
          accessibilityLabel={`Tonight ${formatSignedMoney(tonight)}`}
          maxFontSizeMultiplier={1.4}
          numberOfLines={1}
          style={[styles.heroTonight, { color: heroColor }]}
        >
          {formatCompactSignedMoney(animatedTonight)}
        </Text>
        <View style={styles.statRow}>
          <View
            accessible
            accessibilityLabel={`Past seven nights ${formatSignedMoney(earnings?.week ?? 0)}`}
            style={styles.statCell}
          >
            <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={[styles.statValue, toneStyle(earnings?.week ?? 0)]}>
              {formatCompactSignedMoney(animatedWeek)}
            </Text>
            <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={styles.statLabel}>THIS WEEK</Text>
          </View>
          <View style={styles.statDivider} />
          <View
            accessible
            accessibilityLabel={`${formatSignedMoney(change)}, ${changePct >= 0 ? 'up' : 'down'} ${Math.abs(changePct).toFixed(2)} percent, ${scrubPoint ? scrubPoint.date : rangeLabel(activeRange)}`}
            style={styles.statCell}
          >
            <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={[styles.statValue, { color: changeColor }]}>
              {formatCompactSignedMoney(animatedChange)}
            </Text>
            <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={styles.statLabel}>
              {scrubPoint ? scrubPoint.date : rangeLabel(activeRange).toUpperCase()}
            </Text>
          </View>
        </View>
      </View>
      {beforePlot}
      {/* The demoted balance sheet, naming the graph beneath it. */}
      <Text
        accessibilityLabel={`Net worth ${formatMoney(latestValue)}${freeCash === undefined ? '' : `. ${formatMoney(freeCash)} cash available`}`}
        maxFontSizeMultiplier={1.4}
        numberOfLines={1}
        style={styles.balanceLine}
      >
        <Text style={styles.balanceStrong}>{`${formatCompactMoney(latestValue)} net worth`}</Text>
        {freeCash === undefined ? '' : `  ·  ${formatCompactMoney(freeCash)} cash`}
      </Text>
      <View
        nativeID="scrub-plot-portfolio"
        onLayout={onLayout}
        ref={ref}
        style={[styles.plot, { height }]}
        {...panResponder.panHandlers}
      >
        {width > 0 ? (
          <Svg height={height} width={width}>
            <Defs>
              <LinearGradient id="portfolioFill" x1="0" x2="0" y1="0" y2="1">
                <Stop offset="0" stopColor={changeColor} stopOpacity={0.22} />
                <Stop offset="1" stopColor={changeColor} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {baselineY !== null ? (
              <Line
                stroke={colors.borderStrong}
                strokeDasharray="3 5"
                strokeWidth={1}
                x1={0}
                x2={width}
                y1={baselineY}
                y2={baselineY}
              />
            ) : null}
            <Path d={areaPath} fill="url(#portfolioFill)" />
            <Path
              d={linePath}
              fill="none"
              stroke={changeColor}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
            />
            {scrubCoordinate ? (
              <>
                <Line
                  stroke={colors.borderStrong}
                  strokeDasharray="3 4"
                  strokeWidth={1}
                  x1={scrubCoordinate.x}
                  x2={scrubCoordinate.x}
                  y1={0}
                  y2={height}
                />
                <Circle
                  cx={scrubCoordinate.x}
                  cy={scrubCoordinate.y}
                  fill={changeColor}
                  fillOpacity={0.2}
                  r={11}
                />
                <Circle cx={scrubCoordinate.x} cy={scrubCoordinate.y} fill={changeColor} r={5} />
              </>
            ) : lastCoordinate ? (
              <Circle cx={lastCoordinate.x} cy={lastCoordinate.y} fill={changeColor} r={4.5} />
            ) : null}
          </Svg>
        ) : null}
      </View>
      {firstDate && lastDate ? (
        <View style={styles.dateAxis}>
          <Text numberOfLines={1} style={styles.dateAxisText}>{shortDate(firstDate)}</Text>
          {lastDate !== firstDate ? (
            <Text numberOfLines={1} style={styles.dateAxisText}>{shortDate(lastDate)}</Text>
          ) : null}
        </View>
      ) : null}
      {ranges.length > 1 ? (
        <View accessibilityRole="tablist" aria-label="Chart range" style={styles.ranges}>
          {ranges.map((option) => {
            const selected = option === activeRange;
            return (
              <Pressable
                accessibilityLabel={rangeLabel(option)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                aria-selected={selected}
                key={option}
                onPress={() => setRange(option)}
                style={({ pressed }) => [styles.range, pressed && styles.pressed]}
              >
                <Text
                  maxFontSizeMultiplier={1.4}
                  numberOfLines={1}
                  style={[styles.rangeText, selected && { color: changeColor }]}
                >
                  {option}
                </Text>
                <View style={[styles.rangeRule, selected && { backgroundColor: changeColor }]} />
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}


const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2025-10-21" → "Oct 21"; anything malformed passes through untouched. */
function shortDate(date: string): string {
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (!Number.isFinite(month) || !Number.isFinite(day) || month < 1 || month > 12) return date;
  return `${MONTH_ABBREVIATIONS[month - 1]} ${day}`;
}

function toneStyle(value: number) {
  return { color: value > 0 ? colors.green : value < 0 ? colors.red : colors.muted };
}

function rangeLabel(range: PortfolioRange): string {
  if (range === 'Season') return 'Settled season';
  if (range === '1W') return 'Past week';
  if (range === '1M') return 'Past month';
  return 'Past 3 months';
}

const styles = StyleSheet.create({
  block: { paddingTop: space.lg },
  hero: {
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  heroKicker: { ...labelStyle, color: colors.faint, marginBottom: 2 },
  heroValue: { ...heroNumber },
  // Display tier, not the hero's full 46: tonight leads without shouting —
  // a giant red figure as the app's opening line read as an alarm.
  heroTonight: {
    ...numeric,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: weight.black,
    letterSpacing: -1,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: space.md,
  },
  // Equal thirds: a long label in one cell can never starve a value in
  // another, so figures render whole at every width.
  statCell: { flex: 1, gap: 3, minWidth: 0 },
  statValue: { ...numeric, fontSize: 20, fontWeight: weight.black, letterSpacing: -0.3 },
  statLabel: { ...labelStyle, color: colors.faint },
  balanceLine: {
    ...numeric,
    color: colors.faint,
    fontSize: type.body,
    fontWeight: weight.medium,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  balanceStrong: { color: colors.text, fontSize: 21, fontWeight: weight.black, letterSpacing: -0.4 },
  statDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.borderStrong,
    marginHorizontal: space.md,
  },
  // Air between the night strip and the curve; the plot's own 12px inset
  // was carrying all of it.
  plot: { marginTop: space.md },
  // Date labels line up with the plot's 10px horizontal insets.
  dateAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: space.xs,
  },
  dateAxisText: {
    ...numeric,
    color: colors.faint,
    fontSize: type.label,
    fontWeight: weight.medium,
  },
  ranges: {
    flexDirection: 'row',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
  },
  // 44pt minimums keep each tab a full touch target.
  range: {
    minHeight: 44,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  rangeText: { ...numeric, color: colors.faint, fontSize: type.body, fontWeight: weight.heavy },
  // Transparent until selected, so tabs don't jump when the rule appears.
  rangeRule: {
    height: 2,
    alignSelf: 'stretch',
    marginTop: 6,
    backgroundColor: 'transparent',
  },
  emptyBlock: {
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    gap: space.xs,
  },
  emptyTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    marginTop: space.sm,
  },
  emptyText: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 19,
  },
  pressed: { opacity: 0.62 },
});
