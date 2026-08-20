import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { PlayerAvatar } from '../components/PlayerAvatar';
import { PlayerStats } from '../components/PlayerStats';
import { Sparkline } from '../components/Sparkline';
import { nearestPointIndex } from '../data/chartGeometry';
import {
  buildMarketRows,
  MARKET_FILTERS,
  MARKET_SORTS,
  type MarketFilter,
  type MarketRowModel,
  type MarketSort,
} from '../data/marketOrdering';
import { dividendYield, marketAverageRate, summarizeDividends } from '../data/dividendMetrics';
import {
  formatOwnership,
  formatOwnershipShort,
  formatTradeVolume,
  smoothLinePath,
} from '../data/marketPresentation';
import {
  cumulativeValues,
  selectHighLowPoints,
  selectSettledTrendPoints,
  selectTrendRange,
  type TrendPoint,
  type TrendRange,
} from '../data/trendPresentation';
import type { Player } from '../data/types';
import {
  formatCompactMoney,
  formatCompactSignedMoney,
  formatMoney,
  formatSignedMoney,
} from '../format';
import { useChartSurface } from '../hooks/useChartSurface';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { usePortfolio } from '../state/PortfolioContext';
import { useWatchlist } from '../state/watchlist';
import { colors, fonts, labelStyle, numeric, radius, space, type, weight } from '../theme';
import { rowMarker } from '../ui/domMarkers';
import { SectionHeader, Segmented } from '../ui/primitives';
import { MAX_ROW_FONT_SCALE, marketActionWidth, marketRowHeight } from './marketRowHeight';


/**
 * Windows the trending sort can rank over. The hints double as the segmented
 * control's accessibility labels; `games: null` means the whole settled season.
 */
export const TRENDING_WINDOWS: {
  key: TrendRange;
  label: string;
  hint: string;
  games: number | null;
}[] = [
  { key: 'L5', label: 'L5', hint: 'Payout rate over the last five settled games', games: 5 },
  { key: 'L15', label: 'L15', hint: 'Payout rate over the last fifteen settled games', games: 15 },
  { key: 'L30', label: 'L30', hint: 'Payout rate over the last thirty settled games', games: 30 },
  { key: 'Season', label: 'Season', hint: 'Payout rate across the settled season', games: null },
];

/**
 * The profile chart plots either metric. Price is flat in the demo — prices
 * move on trading, never on performance, and the demo has no volume — but the
 * toggle ships now so the surface already exists when price dispersion does.
 */
type ChartMetric = 'dividends' | 'price';

const CHART_METRICS: readonly { key: ChartMetric; label: string; hint: string }[] = [
  { key: 'dividends', label: 'DIVIDENDS', hint: 'Cumulative dividends over the window' },
  { key: 'price', label: 'PRICE', hint: 'Share price over the window' },
];

/** Broadcast convention: quiet given name, loud surname. */
function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(' ');
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function DetailChart({
  points,
  metric,
  currentPrice,
}: {
  points: TrendPoint[];
  metric: ChartMetric;
  currentPrice: number;
}) {
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  // The scrub callbacks are stable (empty deps) so they read the freshest
  // geometry through a ref instead of closing over a stale coordinate array.
  const geometry = useRef<{ coordinates: { x: number; y: number }[]; width: number }>({
    coordinates: [],
    width: 0,
  });
  const handleScrub = useCallback((x: number) => {
    const index = nearestPointIndex(geometry.current.coordinates, x, geometry.current.width);
    setScrubIndex((previous) => (previous === index ? previous : index));
  }, []);
  const clearScrub = useCallback(() => setScrubIndex(null), []);
  const { width, ref, onLayout } = useChartSurface({
    onScrub: handleScrub,
    onScrubEnd: clearScrub,
  });

  const { values, coordinates, linePath, areaPath, color, extrema, flat } = useMemo(() => {
    // Price has no per-night history in the demo world, so it plots the
    // current quote across the same settled dates — honestly flat.
    const values = metric === 'price'
      ? points.map(() => currentPrice)
      : cumulativeValues(points.map((point) => point.dividend_per_holder));
    const maximum = Math.max(...values);
    const minimum = Math.min(...values);
    const span = maximum - minimum;
    // 168px surface: 26px of headroom for the HIGH label, 22px of footroom for
    // the LOW label, 10px horizontal insets so end dots are not clipped. A
    // flat series draws the midline instead of hugging the ceiling.
    const coordinates = values.map((value, index) => ({
      x: 10 + (index / Math.max(values.length - 1, 1)) * Math.max(width - 20, 0),
      y: span === 0 ? 86 : 26 + ((maximum - value) / span) * 120,
    }));
    const linePath = smoothLinePath(coordinates);
    return {
      values,
      coordinates,
      linePath,
      areaPath: coordinates.length > 0
        ? `${linePath} L ${coordinates.at(-1)!.x} 146 L ${coordinates[0].x} 146 Z`
        : '',
      // Price is neither a gain nor a loss, so it draws in gold rather than
      // borrowing the up/down colours.
      color: metric === 'price'
        ? colors.gold
        : (values.at(-1) ?? 0) >= 0 ? colors.green : colors.red,
      extrema: selectHighLowPoints(values),
      flat: span === 0,
    };
  }, [currentPrice, metric, points, width]);
  geometry.current = { coordinates, width };

  // Hover arrives through the DOM pointer events wired up by useChartSurface;
  // the PanResponder covers touch drags, where hover never fires.
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => handleScrub(event.nativeEvent.locationX),
        onPanResponderMove: (event) => handleScrub(event.nativeEvent.locationX),
        onPanResponderRelease: clearScrub,
        onPanResponderTerminate: clearScrub,
      }),
    [clearScrub, handleScrub],
  );

  const scrubbedPoint = scrubIndex === null ? null : points[scrubIndex] ?? null;
  const scrubbedCoordinate = scrubIndex === null ? null : coordinates[scrubIndex] ?? null;
  // With fewer than five points the HIGH/LOW callouts label almost every dot,
  // which is noise rather than orientation; on a flat line they label nothing.
  const showHighLow = points.length >= 5 && !flat;

  return (
    <View
      accessible
      accessibilityLabel={
        metric === 'price'
          ? `${points.length} game price chart, ${formatCompactMoney(currentPrice)} throughout`
          : `${points.length} game cumulative dividend chart, high ${formatCompactSignedMoney(extrema.high?.value ?? 0)}, low ${formatCompactSignedMoney(extrema.low?.value ?? 0)}`
      }
      nativeID="scrub-plot-detail"
      onLayout={onLayout}
      ref={ref}
      style={styles.chart}
      {...responder.panHandlers}
    >
      {/* The readout keeps a fixed height so the chart does not jump when a
          scrub begins or ends. */}
      <View style={styles.detailReadout}>
        {scrubbedPoint ? (
          <>
            <Text style={styles.detailReadoutValue}>
              {metric === 'price'
                ? `${formatCompactMoney(values[scrubIndex!] ?? currentPrice)} price`
                : `${formatCompactSignedMoney(values[scrubIndex!] ?? 0)} cumulative`}
            </Text>
            <Text numberOfLines={1} style={styles.detailReadoutMeta}>
              {metric === 'price'
                ? `${scrubbedPoint.date} · ${scrubbedPoint.np.toFixed(1)} NP vs ${scrubbedPoint.expected_np.toFixed(1)} projected · price unmoved by performance`
                : `${scrubbedPoint.date} · ${scrubbedPoint.np.toFixed(1)} NP vs ${scrubbedPoint.expected_np.toFixed(1)} projected · ${formatCompactSignedMoney(scrubbedPoint.dividend_per_holder)} that night`}
            </Text>
          </>
        ) : (
          <Text style={styles.detailReadoutMeta}>
            {metric === 'price'
              ? 'Prices move on trading, never on performance — flat until volume exists.'
              : `${formatCompactSignedMoney(values.at(-1) ?? 0)} across ${points.length} ${points.length === 1 ? 'game' : 'games'} — hover to read a night.`}
          </Text>
        )}
      </View>
      {width > 0 ? (
        <Svg height={168} width={width}>
          <Defs>
            <LinearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity="0.22" />
              <Stop offset="1" stopColor={color} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Path d={areaPath} fill="url(#chartFill)" />
          <Path d={linePath} fill="none" stroke={color} strokeLinecap="round" strokeWidth={2.5} />
          {scrubbedCoordinate ? (
            <G>
              <Line
                stroke={colors.borderStrong}
                strokeDasharray="3 4"
                strokeWidth={1}
                x1={scrubbedCoordinate.x}
                x2={scrubbedCoordinate.x}
                y1={0}
                y2={168}
              />
              <Circle
                cx={scrubbedCoordinate.x}
                cy={scrubbedCoordinate.y}
                fill={color}
                fillOpacity={0.2}
                r={11}
              />
              <Circle cx={scrubbedCoordinate.x} cy={scrubbedCoordinate.y} fill={color} r={5} />
            </G>
          ) : null}
          {/* HIGH/LOW callouts step aside while a scrub is active — they would
              collide with the marker and its readout. */}
          {(scrubbedCoordinate || !showHighLow
            ? []
            : ([['HIGH', extrema.high], ['LOW', extrema.low]] as const)
          ).map(([label, point]) => {
            if (!point) return null;
            const coordinate = coordinates[point.index];
            const isHigh = label === 'HIGH';
            return (
              <G key={label}>
                <Circle
                  cx={coordinate.x}
                  cy={coordinate.y}
                  fill={colors.background}
                  r={4.5}
                  stroke={color}
                  strokeWidth={2.5}
                />
                <SvgText
                  fill={colors.muted}
                  fontFamily={fonts.display}
                  fontSize={11}
                  fontWeight="700"
                  textAnchor={coordinate.x < 56 ? 'start' : coordinate.x > width - 56 ? 'end' : 'middle'}
                  x={coordinate.x}
                  y={Math.max(18, Math.min(162, coordinate.y + (isHigh ? -12 : 20)))}
                >
                  {label} {formatCompactSignedMoney(point.value)}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}

function Stat({ label, value, exact }: { label: string; value: string; exact?: string }) {
  return (
    // `exact` restores the unabbreviated figure for screen readers whenever the
    // visible value is compacted to something like $34.6M.
    <View accessible accessibilityLabel={exact ? `${label}, ${exact}` : undefined} style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      {/* Wraps rather than ellipsizing: a truncated statistic is worthless. */}
      <Text numberOfLines={2} style={styles.statValue}>{value}</Text>
    </View>
  );
}

export function PlayerDetail({
  player,
  currentPrice = player.listing_price,
  latestSettledDate,
  trendPoints,
  onClose,
  backLabel = 'Market',
  averageRate = null,
}: {
  player: Player;
  currentPrice?: number;
  latestSettledDate: string | null;
  trendPoints: TrendPoint[];
  onClose: () => void;
  backLabel?: string;
  /** League-average per-night payout — the named baseline the stream reads against. */
  averageRate?: number | null;
}) {
  const [range, setRange] = useState<TrendRange>('L15');
  const [metric, setMetric] = useState<ChartMetric>('dividends');
  const points = selectSettledTrendPoints(trendPoints, latestSettledDate);
  const visiblePoints = selectTrendRange(points, range);
  // The chain: rate × exposure = total, then the total against its baselines.
  const season = summarizeDividends(points);
  const seasonYield = season.gamesPlayed === 0 ? null : dividendYield(season.total, currentPrice);
  const vsAverage = season.perGame === null || averageRate === null
    ? null
    : season.perGame - averageRate;
  const bestPoint = points.reduce<TrendPoint | null>(
    (best, point) =>
      best === null || point.dividend_per_holder > best.dividend_per_holder ? point : best,
    null,
  );
  const bestPayout = bestPoint?.dividend_per_holder ?? 0;
  const watchlist = useWatchlist();
  const watching = watchlist.isWatched(player.id);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.detailContent}>
      <Pressable
        accessibilityLabel={`Close ${player.name} details`}
        accessibilityRole="button"
        onPress={onClose}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
      >
        <Text style={styles.backText}>‹  {backLabel}</Text>
      </Pressable>

      <Pressable
        accessibilityLabel={watching ? `Stop watching ${player.name}` : `Watch ${player.name}`}
        accessibilityRole="button"
        accessibilityState={{ selected: watching }}
        onPress={() => watchlist.toggle(player.id)}
        style={({ pressed }) => [
          styles.watchButton,
          watching && styles.watchButtonOn,
          pressed && styles.pressed,
        ]}
        {...rowMarker}
      >
        <Text style={[styles.watchText, watching && styles.watchTextOn]}>
          {watching ? 'WATCHING' : 'WATCH'}
        </Text>
      </Pressable>

      <View style={styles.detailHeader}>
        <PlayerAvatar player={player} size={56} />
        <View style={styles.detailIdentity}>
          <Text accessibilityRole="header" numberOfLines={2} style={styles.detailName}>{player.name}</Text>
          <Text numberOfLines={1} style={styles.detailMeta}>
            {player.tier.toUpperCase()}
            {season.gamesPlayed > 0 ? ` · ${season.gamesPlayed} SETTLED ${season.gamesPlayed === 1 ? 'GAME' : 'GAMES'}` : ''}
          </Text>
        </View>
      </View>
      {/* The quote leads with the stream, because that is what a share buys
          here; the price is what the stream costs. */}
      <View style={styles.detailQuote}>
        {season.gamesPlayed > 0 ? (
          <>
            <Text
              accessibilityLabel={`Dividends ${formatSignedMoney(season.total)} per holder across the settled season`}
              numberOfLines={1}
              style={[styles.detailPaid, season.total >= 0 ? styles.positive : styles.negative]}
            >
              {formatCompactSignedMoney(season.total)}
              <Text style={styles.detailPaidLabel}>  DIVIDENDS · SEASON</Text>
            </Text>
            <Text
              accessibilityLabel={`${formatSignedMoney(season.perGame ?? 0)} per night across ${season.gamesPlayed} games`}
              numberOfLines={1}
              style={styles.detailRateLine}
            >
              {`${formatCompactSignedMoney(season.perGame ?? 0)} a night, over ${season.gamesPlayed} ${season.gamesPlayed === 1 ? 'game' : 'games'}`}
            </Text>
          </>
        ) : (
          <Text style={styles.detailPaid}>No settled games yet</Text>
        )}
        <Text
          accessibilityLabel={`Price ${formatMoney(currentPrice)}${seasonYield === null ? '' : `, season yield ${(seasonYield * 100).toFixed(1)} percent of price`}`}
          numberOfLines={1}
          style={styles.detailPriceLine}
        >
          {`price ${formatCompactMoney(currentPrice)}`}
          {seasonYield === null ? '' : ` · ${(seasonYield * 100).toFixed(1)}% paid back`}
        </Text>
      </View>

      <View style={styles.chartHeading}>
        {/* The metric toggle replaces the static section title: the selected
            tab names the chart, and the window toggle keeps the right edge. */}
        <Segmented groupLabel="Chart metric" onChange={setMetric} options={CHART_METRICS} value={metric} />
        <View accessibilityRole="tablist" style={styles.rangeToggle}>
          {(['L5', 'L15', 'L30', 'Season'] as const).map((option) => {
            const selected = range === option;
            return (
              <Pressable
                accessibilityLabel={option === 'Season' ? 'Full season' : `Last ${option.slice(1)} games`}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                aria-selected={selected}
                key={option}
                onPress={() => setRange(option)}
                style={({ pressed }) => [
                  styles.rangeButton,
                  selected && styles.rangeButtonSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.rangeText, selected && styles.rangeTextSelected]}>{option}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {visiblePoints.length > 0 ? (
        <DetailChart currentPrice={currentPrice} metric={metric} points={visiblePoints} />
      ) : (
        <Text style={styles.emptyChart}>No game data</Text>
      )}

      {/* The chain, in reading order: the stream (rate × exposure = total),
          the total against its named baselines, then what the share itself is. */}
      <SectionHeader label="THE STREAM" meta="RATE · GAMES · TOTAL" />
      <View style={styles.statsGrid}>
        <Stat
          exact={season.perGame === null ? 'No settled games' : `${formatSignedMoney(season.perGame)} per night he plays`}
          label="Per night"
          value={season.perGame === null ? '—' : formatCompactSignedMoney(season.perGame)}
        />
        <Stat label="Games settled" value={String(season.gamesPlayed)} />
        <Stat
          exact={`${formatSignedMoney(season.total)} across the settled season`}
          label="Season dividends"
          value={formatCompactSignedMoney(season.total)}
        />
        <Stat
          exact={vsAverage === null
            ? 'Needs a settled game and a market average'
            : `${formatSignedMoney(vsAverage)} per night versus the average payer`}
          label="Vs the average payer"
          value={vsAverage === null ? '—' : formatCompactSignedMoney(vsAverage)}
        />
        <Stat
          exact={seasonYield === null
            ? 'Needs a settled game'
            : `The season has paid back ${(seasonYield * 100).toFixed(1)} percent of his price`}
          label="Yield on price"
          value={seasonYield === null ? '—' : `${(seasonYield * 100).toFixed(1)}%`}
        />
        <Stat
          exact={bestPoint ? `${formatSignedMoney(bestPayout)} on ${bestPoint.date}` : formatSignedMoney(bestPayout)}
          label="Best settled payout"
          value={bestPoint ? `${formatCompactSignedMoney(bestPayout)} · ${bestPoint.date}` : formatCompactSignedMoney(bestPayout)}
        />
      </View>

      <SectionHeader label="THE SHARE" />
      <View style={styles.statsGrid}>
        <Stat exact={formatMoney(currentPrice)} label="Current price" value={formatCompactMoney(currentPrice)} />
        <Stat exact={formatMoney(player.listing_price)} label="Opening price" value={formatCompactMoney(player.listing_price)} />
        <Stat exact={formatMoney(player.actual_salary)} label="Actual salary" value={formatCompactMoney(player.actual_salary)} />
        <Stat label="Market ownership" value={formatOwnership(player.ownership_bps)} />
        <Stat
          label="Shares available"
          value={Number.isFinite(player.available_shares) ? String(player.available_shares) : 'Unavailable'}
        />
        <Stat label="30-day activity" value={formatTradeVolume(player.volume_30d)} />
      </View>

      <SectionHeader
        label="SEASON TO DATE"
        meta={points.length > 0 ? `${points.length} GAMES` : undefined}
      />
      <PlayerStats points={points} />
    </ScrollView>
  );
}

/** Watchlist star: gold when watching, an outline when not. */
function WatchStar({ on }: { on: boolean }) {
  return (
    <Svg height={18} width={18} viewBox="0 0 18 18">
      <Polygon
        fill={on ? colors.gold : 'none'}
        points="9,1.6 11.2,6.6 16.6,7.2 12.6,10.9 13.7,16.2 9,13.5 4.3,16.2 5.4,10.9 1.4,7.2 6.8,6.6"
        stroke={on ? colors.gold : colors.borderStrong}
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </Svg>
  );
}

/** A market list entry: a player row, or the average-payer anchor rule. */
type MarketListItem = MarketRowModel | { anchor: true; rate: number };

interface MarketRowProps {
  row: MarketRowModel;
  freeCash: number;
  actionWidth: number;
  rowHeight: number;
  showSparkline: boolean;
  showOwnership: boolean;
  trendPoints: TrendPoint[];
  shorted: boolean;
  boosted: boolean;
  pending: boolean;
  locked: boolean;
  onOpen: (player: Player) => void;
  onTrade: (player: Player, side: 'buy' | 'sell') => Promise<boolean>;
  watching: boolean;
  onToggleWatch: (playerId: string) => void;
}

function MarketRow({
  row,
  freeCash,
  actionWidth,
  rowHeight,
  showSparkline,
  showOwnership,
  trendPoints,
  shorted,
  boosted,
  pending,
  locked,
  onOpen,
  onTrade,
  watching,
  onToggleWatch,
}: MarketRowProps) {
  const { player, currentPrice, held, windowRate, windowGames } = row;
  const { first, last } = splitName(player.name);
  const buyTotal = currentPrice + (player.buy_fee ?? 0);
  const shortfall = held ? 0 : Math.max(0, buyTotal - freeCash);
  const soldOut = !held && player.available_shares === 0;
  const unaffordable = !held && !soldOut && shortfall > 0;
  const disabled = shorted || boosted || soldOut || unaffordable || locked;
  const chartPoints = selectTrendRange(trendPoints, 'L15');
  const rowAccessibilityLabel = [
    `View ${player.name} details`,
    windowRate === null
      ? 'No settled games in this window'
      : `Pays ${formatSignedMoney(windowRate)} per night across ${windowGames} settled ${windowGames === 1 ? 'game' : 'games'}`,
    `Price ${formatMoney(currentPrice)}`,
    held ? 'You own this player' : null,
    // An explicit label replaces the descendant text, so anything the row shows
    // visibly has to be repeated here or assistive tech simply loses it.
    player.tier.toUpperCase(),
    showOwnership ? formatOwnership(player.ownership_bps) : null,
  ].filter((label): label is string => label !== null).join('. ');

  const handleTrade = () => {
    if (pending) return;
    void onTrade(player, held ? 'sell' : 'buy');
  };

  const tradeLabel = boosted
    ? 'BOOSTED'
    : shorted
      ? 'SHORTED'
      : pending
        ? 'WAIT'
        : locked
          ? 'BUSY'
          : soldOut
            ? 'SOLD OUT'
            : unaffordable
              ? 'NO CASH'
              : held
                ? 'SELL'
                : 'BUY';

  return (
    <View style={[styles.playerRow, { height: rowHeight }, held && styles.playerRowHeld]}>
      <Pressable
        accessibilityLabel={rowAccessibilityLabel}
        accessibilityRole="button"
        {...rowMarker}
        onPress={() => onOpen(player)}
        style={({ pressed }) => [styles.playerDetails, pressed && styles.pressed]}
      >
        <PlayerAvatar player={player} size={36} />
        <View style={styles.playerCopy}>
          {/* Broadcast lower-third: quiet given-name kicker over the loud
              surname on its own full-width line, so 'Antetokounmpo' and
              'Cunningham' stop truncating behind their own first names. Tier
              lives in the profile and the row's accessibility label. */}
          <Text maxFontSizeMultiplier={MAX_ROW_FONT_SCALE} numberOfLines={1} style={styles.playerKicker}>
            {first ? first.toUpperCase() : player.tier.toUpperCase()}
          </Text>
          <Text maxFontSizeMultiplier={MAX_ROW_FONT_SCALE} numberOfLines={1} style={styles.playerName}>
            {last}
          </Text>
        </View>
        {showOwnership ? (
          <Text numberOfLines={1} style={styles.ownership}>
            {formatOwnershipShort(player.ownership_bps)}
          </Text>
        ) : null}
        {showSparkline && chartPoints.length > 0 ? <Sparkline points={chartPoints} /> : null}
        <View style={styles.quote}>
          {/* Money leads: what he pays per night. The price is real but inert
              in this world, so it rides underneath as the cost of the stream. */}
          {windowRate === null ? (
            <Text maxFontSizeMultiplier={MAX_ROW_FONT_SCALE} numberOfLines={1} style={styles.quoteIdle}>
              no games
            </Text>
          ) : (
            <Text
              maxFontSizeMultiplier={MAX_ROW_FONT_SCALE}
              numberOfLines={1}
              style={[styles.quoteRate, windowRate >= 0 ? styles.positive : styles.negative]}
            >
              {formatCompactSignedMoney(windowRate)}
            </Text>
          )}
          {/* The unit and the quiet price ride the caption, so the figure
              stays narrow and the name keeps its room. The full chain
              (yield, baselines, box score) lives one tap in. */}
          <Text maxFontSizeMultiplier={MAX_ROW_FONT_SCALE} numberOfLines={1} style={styles.quoteCaption}>
            {windowRate === null
              ? formatCompactMoney(currentPrice)
              : `a night · ${formatCompactMoney(currentPrice)}`}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={held
          ? `Sell ${player.name}`
          : soldOut
            ? `${player.name} is sold out`
            : `Buy ${player.name} for ${formatMoney(buyTotal)} including fee`}
        accessibilityHint={
          boosted
            ? 'Settle the active boost before selling this player'
            : shorted
            ? 'Close the active weekly short before buying this player'
            : soldOut
              ? 'No shares are currently available'
            : unaffordable
              ? `Needs ${formatMoney(shortfall)} more`
              : undefined
        }
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={handleTrade}
        style={({ pressed }) => [
          styles.tradeButton,
          { width: actionWidth },
          held ? styles.sellButton : styles.buyButton,
          (shorted || boosted || soldOut || unaffordable) && styles.unaffordableButton,
          locked && styles.tradeLockedButton,
          pressed && styles.pressed,
        ]}
      >
        <Text
          maxFontSizeMultiplier={MAX_ROW_FONT_SCALE}
          // The row grows to 136px at 2x text, so a long status like SOLD OUT
          // wraps onto a second line rather than truncating on a narrow phone.
          numberOfLines={2}
          style={[
            styles.tradeText,
            disabled ? styles.unaffordableText : held ? styles.sellText : styles.buyText,
            (pending || locked) && styles.tradeLockedText,
          ]}
        >
          {tradeLabel}
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel={watching ? `Stop watching ${player.name}` : `Watch ${player.name}`}
        accessibilityRole="button"
        accessibilityState={{ selected: watching }}
        onPress={() => onToggleWatch(player.id)}
        style={({ pressed }) => [styles.watchDot, pressed && styles.pressed]}
      >
        <WatchStar on={watching} />
      </Pressable>
    </View>
  );
}

export function MarketScreen() {
  const {
    latestSettledDate,
    owns,
    pendingActions,
    players,
    playerTrends,
    state,
    summary,
    trade,
  } = usePortfolio();
  const { fontScale, height, width } = useWindowDimensions();
  // Landscape phones have almost no vertical room, so the header sheds the
  // title (the active tab already says MARKET) and tightens its padding.
  const shortViewport = height < 520;
  const rowHeight = marketRowHeight(fontScale);
  const actionWidth = marketActionWidth(fontScale, width);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Money-first default: the market opens ranked by what players pay, not by
  // prices that never move in this world.
  const [sort, setSort] = useState<MarketSort>('pays');
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [filter, setFilter] = useState<MarketFilter>('all');
  const [trendingWindow, setTrendingWindow] = useState<TrendRange>('L15');
  const reducedMotion = useReducedMotion();
  const watchlist = useWatchlist();

  const compact = width < 420;
  // Only surface the ownership column once the table is wide enough that it
  // fills dead space instead of squeezing the player name.
  // Secondary columns are dropped once text is large, so the player name and
  // price keep their room instead of being squeezed off the row.
  const largeText = fontScale > 1.3;
  const roomy = width >= 900 && !largeText;
  const prices = state?.prices;
  const freeCash = summary?.freeCash ?? 0;
  const weeklyShorts = state?.weeklyShorts;
  const boosts = state?.boosts;

  const settledTrends = useMemo(() => {
    const resolved: Record<string, TrendPoint[]> = {};
    for (const player of players) {
      resolved[player.id] = selectSettledTrendPoints(
        playerTrends[player.id] ?? [],
        latestSettledDate,
      );
    }
    return resolved;
  }, [players, playerTrends, latestSettledDate]);

  const activeShortPlayerIds = useMemo(
    () => new Set(
      (weeklyShorts ?? [])
        .filter((position) => position.status === 'active')
        .map((position) => position.playerId),
    ),
    [weeklyShorts],
  );
  const activeBoostPlayerIds = useMemo(
    () => new Set(
      (boosts ?? [])
        .filter((boost) => boost.status === 'armed')
        .map((boost) => boost.playerId),
    ),
    [boosts],
  );
  const accountMutationPending = pendingActions.has('account-mutation');

  const rows = useMemo(() => {
    if (!prices) return [];
    return buildMarketRows({
      players,
      prices,
      trends: settledTrends,
      freeCash,
      isHeld: owns,
      isBlocked: (playerId) =>
        activeShortPlayerIds.has(playerId) || activeBoostPlayerIds.has(playerId),
      query,
      sort,
      filter,
      trendingGames: TRENDING_WINDOWS.find((window) => window.key === trendingWindow)?.games ?? null,
    });
  }, [
    activeBoostPlayerIds,
    activeShortPlayerIds,
    filter,
    freeCash,
    owns,
    players,
    prices,
    query,
    settledTrends,
    sort,
  ]);

  // The anchor teaches the scale (an average payer is X a night, "by
  // construction"): a rule pinned at the whole market's average rate for the
  // active window, so every figure above and below it can be felt. Whole-
  // market, not filtered — the label says market, so the math must too.
  const marketWindowAverage = useMemo(() => {
    const games = TRENDING_WINDOWS.find((window) => window.key === trendingWindow)?.games ?? null;
    return marketAverageRate(players.map((player) => {
      const settled = settledTrends[player.id] ?? [];
      return games === null ? settled : settled.slice(-games);
    }));
  }, [players, settledTrends, trendingWindow]);

  const listData: MarketListItem[] = useMemo(() => {
    if (sort !== 'pays' || marketWindowAverage === null || rows.length < 3) return rows;
    const index = rows.findIndex(
      (row) => (row.windowRate ?? Number.NEGATIVE_INFINITY) < marketWindowAverage,
    );
    // The rule only reads between rows: nothing above or below it says nothing.
    if (index <= 0 || index >= rows.length) return rows;
    const withAnchor: MarketListItem[] = [...rows];
    withAnchor.splice(index, 0, { anchor: true, rate: marketWindowAverage });
    return withAnchor;
  }, [marketWindowAverage, rows, sort]);

  const renderItem = useCallback(
    ({ item }: { item: MarketListItem }) => (
      'anchor' in item ? (
        <View
          accessible
          accessibilityLabel={`Market average: pays ${formatSignedMoney(item.rate)} a night over this window`}
          style={styles.anchorRow}
        >
          <View style={styles.anchorRule} />
          <Text maxFontSizeMultiplier={MAX_ROW_FONT_SCALE} style={styles.anchorText}>
            {`MARKET AVERAGE · ${formatCompactSignedMoney(item.rate)} A NIGHT`}
          </Text>
          <View style={styles.anchorRule} />
        </View>
      ) : (
      <MarketRow
        actionWidth={actionWidth}
        boosted={activeBoostPlayerIds.has(item.player.id)}
        freeCash={freeCash}
        locked={accountMutationPending}
        onOpen={(player) => setSelectedPlayerId(player.id)}
        onToggleWatch={watchlist.toggle}
        onTrade={trade}
        pending={pendingActions.has(`trade:${item.player.id}`)}
        row={item}
        rowHeight={rowHeight}
        shorted={activeShortPlayerIds.has(item.player.id)}
        showOwnership={roomy}
        showSparkline={!compact && !largeText}
        trendPoints={settledTrends[item.player.id] ?? []}
        watching={watchlist.isWatched(item.player.id)}
      />
      )
    ),
    [
      accountMutationPending,
      actionWidth,
      activeBoostPlayerIds,
      activeShortPlayerIds,
      compact,
      freeCash,
      largeText,
      watchlist,
      pendingActions,
      roomy,
      rowHeight,
      settledTrends,
      trade,
    ],
  );

  if (!state || !summary) return null;

  const selectedPlayer = selectedPlayerId
    ? players.find((player) => player.id === selectedPlayerId) ?? null
    : null;

  if (selectedPlayer) {
    return (
      <PlayerDetail
        averageRate={marketAverageRate(Object.values(settledTrends))}
        currentPrice={state.prices[selectedPlayer.id] ?? selectedPlayer.listing_price}
        latestSettledDate={latestSettledDate}
        onClose={() => setSelectedPlayerId(null)}
        player={selectedPlayer}
        trendPoints={playerTrends[selectedPlayer.id] ?? []}
      />
    );
  }

  /**
   * The controls ride inside the list rather than sitting above it. Pinned, they
   * consumed ~165px and left a landscape phone (844x390) with zero reachable
   * rows; as a list header the whole market scrolls and every row stays usable.
   */
  const listHeader = (
    <View style={styles.controls}>
      {/* Cash is the constraint on every buy, so it reads as the headline. */}
      <View style={[styles.controlsTop, shortViewport && styles.controlsTopShort]}>
        {/* The heading always renders — the active tab is not a substitute for
            an in-content header — but shrinks to a label in short viewports. */}
        <Text
          accessibilityRole="header"
          style={shortViewport ? styles.titleShort : styles.title}
        >
          MARKET
        </Text>
        <View style={[styles.cashBlock, shortViewport && styles.cashBlockShort]}>
          <Text style={styles.cashLabel}>BUYING POWER</Text>
          <Text
            accessibilityLabel={`Free cash ${formatMoney(freeCash)}`}
            maxFontSizeMultiplier={1.6}
            numberOfLines={1}
            style={styles.cashValue}
          >
            {formatCompactMoney(freeCash)}
          </Text>
        </View>
      </View>

      <TextInput
        accessibilityLabel="Search players"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        onChangeText={setQuery}
        placeholder="Search players"
        placeholderTextColor={colors.faint}
        returnKeyType="search"
        style={styles.search}
        value={query}
      />

      {/* One visible choice (Hick's law): the active sort as a disclosure
          chip; the full sort list and its window picker live in the sheet.
          Filters stay visible — they gate the task itself. */}
      <View style={styles.chipBar}>
        <Pressable
          accessibilityHint="Opens the sort options"
          accessibilityLabel={`Sorted by ${MARKET_SORTS.find((option) => option.key === sort)?.label ?? sort}. Change sort`}
          accessibilityRole="button"
          onPress={() => setSortSheetOpen(true)}
          style={({ pressed }) => [styles.sortChip, pressed && styles.pressed]}
        >
          <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={styles.sortChipText}>
            {`${(MARKET_SORTS.find((option) => option.key === sort)?.label ?? sort).toUpperCase()}${sort === 'pays' ? ` · ${trendingWindow.toUpperCase()}` : ''}  ▾`}
          </Text>
        </Pressable>
        <Segmented groupLabel="Filter players" onChange={setFilter} options={MARKET_FILTERS} value={filter} />
      </View>
    </View>
  );

  // A search can come back empty because the name is unknown OR because the
  // active filter removed a real match. Saying "no players match" in the second
  // case is simply untrue, so the two are distinguished.
  const trimmedQuery = query.trim();
  const marketHasQueryMatch = trimmedQuery !== ''
    && players.some((player) =>
      player.name.toLocaleLowerCase().includes(trimmedQuery.toLocaleLowerCase()));
  const filterHidesAMatch = marketHasQueryMatch && filter !== 'all';
  // A query that matches nobody anywhere is the blocker, so search guidance wins
  // over filter guidance — clearing the filter would not surface a result.
  const searchIsTheBlocker = trimmedQuery !== '' && !marketHasQueryMatch;

  const emptyState = (
    <View style={styles.emptyCard}>
      <Text accessibilityRole="header" style={styles.emptyTitle}>
        {filterHidesAMatch
          ? `No “${trimmedQuery}” result in this filter.`
          : trimmedQuery
            ? `No players match “${trimmedQuery}”.`
            : 'No players match this filter.'}
      </Text>
      <Text style={styles.subtle}>
        {searchIsTheBlocker
          ? 'Try a first name, last name, or clear the search.'
          : filter === 'held'
            ? 'Buy a player in the All tab, or clear the Owned filter.'
            : filter === 'affordable'
              ? 'Sell a player or clear the filter to see the full market.'
              : 'Try a first name, last name, or clear the search.'}
      </Text>
    </View>
  );

  return (
    <View style={styles.marketScreen}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={listData}
        initialNumToRender={14}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => ('anchor' in item ? 'market-average-anchor' : item.player.id)}
        ListEmptyComponent={emptyState}
        ListHeaderComponent={listHeader}
        maxToRenderPerBatch={12}
        renderItem={renderItem}
        style={styles.list}
        windowSize={9}
      />
      {sortSheetOpen ? (
        <Modal
          animationType={reducedMotion ? 'none' : 'fade'}
          onRequestClose={() => setSortSheetOpen(false)}
          transparent
          visible
        >
          <Pressable
            accessibilityLabel="Close the sort options"
            onPress={() => setSortSheetOpen(false)}
            style={styles.sheetBackdrop}
          >
            <Pressable accessibilityViewIsModal onPress={() => {}} style={styles.sheet}>
              <Text accessibilityRole="header" style={styles.sheetTitle}>SORT THE MARKET</Text>
              {MARKET_SORTS.map((option) => {
                const selected = option.key === sort;
                return (
                  <Pressable
                    accessibilityLabel={option.hint}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    key={option.key}
                    onPress={() => {
                      setSort(option.key);
                      // Pays keeps the sheet open so its window can be picked
                      // in the same visit; every other sort is a single choice.
                      if (option.key !== 'pays') setSortSheetOpen(false);
                    }}
                    style={({ pressed }) => [styles.sheetOption, pressed && styles.pressed]}
                  >
                    <Text style={[styles.sheetOptionLabel, selected && styles.sheetOptionLabelActive]}>
                      {option.label.toUpperCase()}
                    </Text>
                    <Text numberOfLines={1} style={styles.sheetOptionHint}>{option.hint}</Text>
                  </Pressable>
                );
              })}
              {sort === 'pays' ? (
                <View style={styles.sheetWindowRow}>
                  <Segmented
                    groupLabel="Payout window"
                    onChange={(next) => {
                      setTrendingWindow(next);
                      setSortSheetOpen(false);
                    }}
                    options={TRENDING_WINDOWS}
                    value={trendingWindow}
                  />
                </View>
              ) : null}
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  marketScreen: { flex: 1, minHeight: 0 },

  controls: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
    gap: space.sm,
    backgroundColor: colors.background,
  },
  controlsTopShort: { paddingTop: 0 },
  titleShort: { ...labelStyle, color: colors.muted },
  cashBlockShort: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  controlsTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md },
  title: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: weight.black,
    },
  titleMeta: { ...labelStyle, marginTop: 2 },
  cashBlock: { alignItems: 'flex-end', flexShrink: 0, minWidth: 84 },
  cashLabel: { ...labelStyle, color: colors.goldInk },
  cashValue: { ...numeric, color: colors.text, fontSize: 20, fontWeight: weight.black, marginTop: 1 },

  search: {
    minHeight: 44,
    color: colors.text,
    fontFamily: fonts.body,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: 15,
  },

  chipBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingBottom: space.sm,
  },
  sortChip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  sortChipText: { ...labelStyle, color: colors.goldInk },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopColor: colors.borderStrong,
    borderTopWidth: 1,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xl,
  },
  sheetTitle: { ...labelStyle, color: colors.muted, marginBottom: space.sm },
  sheetOption: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  sheetOptionLabel: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.bold,
  },
  sheetOptionLabelActive: { color: colors.goldInk },
  sheetOptionHint: {
    flex: 1,
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.label,
    textAlign: 'right',
  },
  sheetWindowRow: { marginTop: space.lg, alignItems: 'flex-start', gap: space.sm },

  list: { flex: 1 },
  listContent: { paddingBottom: space.xxl },

  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    borderLeftColor: 'transparent',
    borderLeftWidth: 2,
  },
  // Owned listings get the gold edge; it is the one place gold marks a row.
  playerRowHeld: { borderLeftColor: colors.gold, backgroundColor: colors.surface },
  playerDetails: { flex: 1, minWidth: 0, height: '100%', flexDirection: 'row', alignItems: 'center', gap: space.sm },

  playerCopy: { flex: 1, minWidth: 0 },
  playerKicker: {
    ...labelStyle,
    color: colors.faint,
    letterSpacing: 0.8,
  },
  playerName: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 15,
    fontWeight: weight.heavy,
    marginTop: 1,
  },

  ownership: {
    ...labelStyle,
    width: 46,
    textAlign: 'right',
    flexShrink: 0,
    letterSpacing: 0.3,
  },
  sparkline: { width: 52, height: 26, flexShrink: 0 },

  anchorRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    backgroundColor: colors.chromeSoft,
  },
  anchorRule: { flex: 1, height: 1, backgroundColor: colors.borderStrong },
  anchorText: { ...labelStyle, color: colors.muted },
  quote: { alignItems: 'flex-end', minWidth: 84, flexShrink: 0, gap: 2 },
  quoteRate: { ...numeric, fontSize: 16, fontWeight: weight.heavy },
  quoteIdle: { ...numeric, color: colors.faint, fontSize: type.body, fontWeight: weight.medium },
  quoteCaption: { ...numeric, color: colors.faint, fontSize: type.label, fontWeight: weight.medium },
  watchDot: {
    width: 34,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  tradeButton: {
    minHeight: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: space.xs,
    borderWidth: 1,
  },
  // Gold is the action colour; green stays reserved for money movement.
  buyButton: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
  sellButton: { borderColor: colors.red, backgroundColor: colors.redSoft },
  unaffordableButton: { borderColor: colors.border, backgroundColor: 'transparent' },
  tradeLockedButton: { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  tradeText: {
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.7,
    textAlign: 'center',
  },
  buyText: { color: colors.goldInk },
  sellText: { color: colors.red },
  unaffordableText: { color: colors.faint },
  tradeLockedText: { color: colors.faint },

  positive: { color: colors.green },
  negative: { color: colors.red },
  neutral: { color: colors.faint },
  pressed: { opacity: 0.62 },

  emptyCard: {
    marginTop: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.lg,
    gap: space.xs,
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderBottomColor: colors.border,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  emptyTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
  },
  subtle: { color: colors.muted, fontFamily: fonts.body, fontSize: type.label, lineHeight: 18 },

  /* ---------------- player detail ---------------- */
  detailContent: { paddingBottom: space.xxl },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  watchButton: {
    alignSelf: 'flex-start',
    minHeight: 34,
    justifyContent: 'center',
    marginHorizontal: space.md,
    marginBottom: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderColor: colors.goldLine,
    borderWidth: 1,
  },
  watchButtonOn: { backgroundColor: colors.goldSoft },
  watchText: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.9,
  },
  watchTextOn: { color: colors.goldInk },
  backText: {
    ...labelStyle,
    color: colors.goldInk,
    fontSize: type.body,
    letterSpacing: 0.6,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingBottom: space.md,
  },
  detailIdentity: { flex: 1, minWidth: 0, gap: 3 },
  detailName: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: weight.black,
    },
  detailMeta: { ...labelStyle, color: colors.faint, letterSpacing: 0.5 },
  // The quote stacks: stream headline, its rate line, then what it costs.
  detailQuote: {
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingBottom: space.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  detailPaid: { ...numeric, color: colors.text, fontSize: 32, fontWeight: weight.black, letterSpacing: 0 },
  detailPaidLabel: { ...labelStyle, color: colors.faint, letterSpacing: 1.1 },
  detailRateLine: { ...numeric, color: colors.muted, fontSize: type.body, fontWeight: weight.heavy },
  detailPriceLine: { ...numeric, color: colors.faint, fontSize: type.body, fontWeight: weight.medium },

  chartHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  rangeToggle: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  rangeButton: { minWidth: 46, minHeight: 44, paddingHorizontal: space.sm, alignItems: 'center', justifyContent: 'center' },
  rangeButtonSelected: { backgroundColor: colors.surfaceRaised },
  rangeText: { ...labelStyle, color: colors.faint },
  rangeTextSelected: { color: colors.goldInk },
  detailReadout: {
    height: 46,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    paddingBottom: space.xs,
  },
  detailReadoutValue: { ...numeric, color: colors.text, fontSize: type.value, fontWeight: weight.heavy },
  detailReadoutMeta: {
    ...numeric,
    color: colors.faint,
    fontSize: type.body,
    fontWeight: weight.medium,
    marginTop: 1,
  },
  // No fixed height here — the readout (46) plus the Svg (168) set it.
  chart: { marginHorizontal: space.md },
  emptyChart: {
    color: colors.faint,
    fontFamily: fonts.body,
    height: 168,
    textAlign: 'center',
    textAlignVertical: 'center',
  },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  stat: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 132,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderBottomColor: colors.border,
    borderRightColor: colors.border,
    borderBottomWidth: 1,
    borderRightWidth: 1,
  },
  statLabel: { ...labelStyle, letterSpacing: 0.5 },
  statValue: {
    ...numeric,
    color: colors.text,
    fontSize: type.value,
    fontWeight: weight.heavy,
    marginTop: 5,
  },
});
