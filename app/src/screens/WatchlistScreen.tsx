import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { PlayerAvatar } from '../components/PlayerAvatar';
import { useChartSurface } from '../hooks/useChartSurface';
import { smoothLinePath, windowSurprise } from '../data/marketPresentation';
import { cumulativeValues, selectTrendRange, type TrendPoint, type TrendRange } from '../data/trendPresentation';
import type { Player } from '../data/types';
import { formatCompactSignedMoney, formatSignedMoney } from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { STARTING_BANKROLL } from '../state/economy';
import { useWatchlist, WATCHLIST_LIMIT } from '../state/watchlist';
import { rowMarker } from '../ui/domMarkers';
import { colors, fonts, headingStyle, numeric, radius, space, type, weight } from '../theme';
import { Segmented } from '../ui/primitives';

/** One line per watched player; assignment order keeps a player's colour stable. */
const SERIES_COLORS = [
  colors.gold,
  colors.cyan,
  colors.green,
  colors.red,
  colors.muted,
  colors.goldLine,
];

const WINDOWS: readonly { key: TrendRange; label: string; hint: string }[] = [
  { key: 'L5', label: 'L5', hint: 'Compare the last five settled games' },
  { key: 'L15', label: 'L15', hint: 'Compare the last fifteen settled games' },
  { key: 'L30', label: 'L30', hint: 'Compare the last thirty settled games' },
  { key: 'Season', label: 'Season', hint: 'Compare the settled season' },
];

interface WatchedSeries {
  player: Player;
  points: TrendPoint[];
  /** Running dividend total, with a leading 0 so every line shares an origin. */
  cumulative: number[];
  total: number;
  perGame: number | null;
  color: string;
}

/**
 * The watchlist as one comparison: every watched player's cumulative dividends
 * over the chosen window on a single scrub surface, so hovering reads one
 * night across everyone at once.
 */
export function WatchlistScreen() {
  const { players, playerTrends, owns, summary } = usePortfolio();
  const { watched, toggle, clear } = useWatchlist();
  const [range, setRange] = useState<TrendRange>('L15');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const { width } = useWindowDimensions();
  const playerById = new Map(players.map((player) => [player.id, player]));
  const series: WatchedSeries[] = watched.flatMap((playerId, index) => {
    const player = playerById.get(playerId);
    if (!player) return [];
    const points = selectTrendRange(playerTrends[playerId] ?? [], range);
    const cumulative = [0, ...cumulativeValues(points.map((point) => point.dividend_per_holder))];
    return [
      {
        player,
        points,
        cumulative,
        total: cumulative.at(-1) ?? 0,
        perGame: windowSurprise(points, null),
        color: SERIES_COLORS[index % SERIES_COLORS.length],
      },
    ];
  });
  // The chart keeps watch order (stable colours); the list ranks by payout.
  const ranked = [...series].sort((a, b) => b.total - a.total);

  if (watched.length === 0) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.headingRow}>
          <Text accessibilityRole="header" style={styles.heading}>Watchlist</Text>
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nobody on the list yet.</Text>
          <Text style={styles.subtle}>
            {`Open Market and use WATCH on any player. Up to ${WATCHLIST_LIMIT} at a time, kept on this device, and untouched by a season reset.`}
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={styles.heading}>Watchlist</Text>
        <Pressable
          accessibilityLabel="Clear the whole watchlist"
          accessibilityRole="button"
          onPress={clear}
          style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
        >
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
      </View>
      <Text style={styles.intro}>
        Who has been paying, and how fast. Hover the chart to read one night across everyone.
      </Text>
      <View style={styles.controls}>
        <Segmented groupLabel="Comparison window" onChange={setRange} options={WINDOWS} value={range} />
      </View>
      <ComparisonChart activeIndex={activeIndex} onScrubIndex={setActiveIndex} series={series} />
      <View style={styles.list}>
        {ranked.map((entry) => {
          const owned = owns(entry.player.id);
          const atIndex = activeIndex === null ? undefined : entry.cumulative[activeIndex];
          const shown = atIndex ?? entry.total;
          return (
            <View key={entry.player.id} style={styles.row}>
              <View style={[styles.swatch, { backgroundColor: entry.color }]} />
              <PlayerAvatar player={entry.player} size={34} />
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={styles.rowName}>{entry.player.name}</Text>
                <Text numberOfLines={1} style={styles.rowMeta}>
                  {entry.points.length === 0
                    ? 'No settled games in this window'
                    : `${entry.points.length} games · ${entry.perGame === null ? '0.0' : entry.perGame >= 0 ? `+${entry.perGame.toFixed(1)}` : entry.perGame.toFixed(1)} NP per game vs projection`}
                </Text>
              </View>
              <View style={styles.rowNumbers}>
                <Text
                  accessibilityLabel={`${entry.player.name} paid ${formatSignedMoney(entry.total)} across this window${owned ? ', and you own him' : ', which you did not receive because you do not own him'}`}
                  numberOfLines={1}
                  style={[styles.rowValue, shown >= 0 ? styles.positive : styles.negative]}
                >
                  {formatCompactSignedMoney(shown)}
                </Text>
                <Text numberOfLines={1} style={styles.rowNote}>
                  {activeIndex === null
                    ? owned ? 'you own him' : 'had you owned him'
                    : atIndex === undefined ? 'no game yet' : `after ${activeIndex} games`}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={`Remove ${entry.player.name} from the watchlist`}
                accessibilityRole="button"
                onPress={() => toggle(entry.player.id)}
                style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
                {...rowMarker}
              >
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
      <Text style={styles.footnote}>
        {`Dividends are what a player paid per holder over the window, from settled games only. Your own portfolio is ${summary ? formatSignedMoney(summary.totalValue - STARTING_BANKROLL) : 'unchanged'} against the opening bankroll.`}
      </Text>
    </ScrollView>
  );
}

/**
 * All watched lines on one surface. Scrubbing snaps to the nearest game index
 * shared by every series, so the vertical rule reads the same night for all.
 */
function ComparisonChart({
  series,
  height = 200,
  onScrubIndex,
  activeIndex,
}: {
  series: WatchedSeries[];
  height?: number;
  onScrubIndex: (index: number | null) => void;
  activeIndex: number | null;
}) {
  const count = series.reduce((max, entry) => Math.max(max, entry.cumulative.length), 0);
  const scrubGeometry = useRef({ width: 0, count: 0 });
  const handleScrub = useCallback(
    (offsetX: number) => {
      const { width, count } = scrubGeometry.current;
      if (width <= 0 || count <= 1) return;
      const clamped = Math.max(0, Math.min(width - 20, offsetX - 10));
      const index = Math.round((clamped / (width - 20)) * (count - 1));
      onScrubIndex(Math.max(0, Math.min(count - 1, index)));
    },
    [onScrubIndex],
  );
  const { width, ref, onLayout } = useChartSurface({
    onScrub: handleScrub,
    onScrubEnd: useCallback(() => onScrubIndex(null), [onScrubIndex]),
  });
  // The pointer listeners attach to the DOM node once and never re-subscribe,
  // so they read the freshest layout through this ref instead of a closure.
  scrubGeometry.current = { width, count };

  const values = series.flatMap((entry) => entry.cumulative);
  // Always include zero so the baseline stays on screen even when every
  // watched player has paid (or lost) in the same direction.
  const high = Math.max(0, ...values);
  const low = Math.min(0, ...values);
  const span = high - low || 1;
  const yAt = (value: number) => 10 + ((high - value) / span) * (height - 20);
  const xAt = (index: number) => (count <= 1 ? width / 2 : 10 + (index / (count - 1)) * (width - 20));

  return (
    <View nativeID="scrub-plot-watchlist" onLayout={onLayout} ref={ref} style={[styles.chart, { height }]}>
      {width > 0 && series.length > 0 ? (
        <Svg height={height} width={width}>
          <Line
            stroke={colors.borderStrong}
            strokeDasharray="3 5"
            strokeWidth={1}
            x1={0}
            x2={width}
            y1={yAt(0)}
            y2={yAt(0)}
          />
          {activeIndex !== null ? (
            <Line
              stroke={colors.borderStrong}
              strokeDasharray="3 4"
              strokeWidth={1}
              x1={xAt(activeIndex)}
              x2={xAt(activeIndex)}
              y1={0}
              y2={height}
            />
          ) : null}
          {series.map((entry) => (
            <Path
              d={smoothLinePath(entry.cumulative.map((value, index) => ({ x: xAt(index), y: yAt(value) })))}
              fill="none"
              key={entry.player.id}
              stroke={entry.color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
            />
          ))}
          {activeIndex !== null
            ? series.map((entry) => {
                const value = entry.cumulative[activeIndex];
                if (value === undefined) return null;
                return <Circle cx={xAt(activeIndex)} cy={yAt(value)} fill={entry.color} key={entry.player.id} r={4} />;
              })
            : null}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: space.xxl },

  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
  },
  // Padding lives on headingRow (both states render inside it), so the title
  // never double-indents against the copy below it.
  heading: { ...headingStyle },
  clear: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm },
  clearText: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  intro: {
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 19,
    paddingHorizontal: space.lg,
    paddingTop: space.xs,
  },
  controls: { alignItems: 'flex-start', paddingHorizontal: space.lg, paddingTop: space.md },
  chart: { marginTop: space.md, marginHorizontal: space.lg },

  list: { paddingTop: space.md },
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
  swatch: { width: 4, height: 30, borderRadius: radius.xs, flexShrink: 0 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowName: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  rowMeta: { ...numeric, color: colors.faint, fontSize: type.body, fontWeight: weight.medium, marginTop: 2 },
  rowNumbers: { alignItems: 'flex-end', flexShrink: 0 },
  rowValue: { ...numeric, fontSize: type.value, fontWeight: weight.heavy },
  rowNote: { color: colors.faint, fontFamily: fonts.body, fontSize: type.label, marginTop: 1 },
  remove: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm, flexShrink: 0 },
  removeText: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
  },

  empty: { paddingHorizontal: space.lg, paddingVertical: space.lg, gap: space.xs },
  emptyTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  subtle: { color: colors.muted, fontFamily: fonts.body, fontSize: type.body, lineHeight: 19 },
  footnote: {
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 18,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },

  pressed: { opacity: 0.65 },
  positive: { color: colors.green },
  negative: { color: colors.red },
});
