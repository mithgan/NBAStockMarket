import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
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
import {
  formatOwnership,
  formatOwnershipShort,
  formatSignedMetric,
  formatSignedPercent,
  formatTradeVolume,
  metricDirection,
  priceChangePercent,
  recentForm,
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
  { key: 'L5', label: 'L5', hint: 'Trending over the last five settled games', games: 5 },
  { key: 'L15', label: 'L15', hint: 'Trending over the last fifteen settled games', games: 15 },
  { key: 'L30', label: 'L30', hint: 'Trending over the last thirty settled games', games: 30 },
  { key: 'Season', label: 'Season', hint: 'Trending across the settled season', games: null },
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

function average(points: TrendPoint[], key: 'np' | 'expected_np') {
  if (points.length === 0) return 0;
  return points.reduce((sum, point) => sum + point[key], 0) / points.length;
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
              : 'Hover the chart to read a night exactly.'}
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
}: {
  player: Player;
  currentPrice?: number;
  latestSettledDate: string | null;
  trendPoints: TrendPoint[];
  onClose: () => void;
  backLabel?: string;
}) {
  const [range, setRange] = useState<TrendRange>('L15');
  const [metric, setMetric] = useState<ChartMetric>('dividends');
  const points = selectSettledTrendPoints(trendPoints, latestSettledDate);
  const visiblePoints = selectTrendRange(points, range);
  const rangeTotal = visiblePoints.reduce((sum, point) => sum + point.dividend_per_holder, 0);
  const bestPoint = points.reduce<TrendPoint | null>(
    (best, point) =>
      best === null || point.dividend_per_holder > best.dividend_per_holder ? point : best,
    null,
  );
  const bestPayout = bestPoint?.dividend_per_holder ?? 0;
  const form = recentForm(points);
  const change = priceChangePercent(currentPrice, player.listing_price);
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
            {change === null ? '' : ` · ${formatSignedPercent(change)} since listing`}
          </Text>
        </View>
      </View>
      <View style={styles.detailQuote}>
        <Text
          accessibilityLabel={`Current price ${formatMoney(currentPrice)}`}
          numberOfLines={1}
          style={styles.detailPrice}
        >
          {formatCompactMoney(currentPrice)}
        </Text>
        {points.length > 0 ? (
          <Text
            accessibilityLabel={`${formatSignedMoney(rangeTotal)} ${range === 'Season' ? 'settled season' : `last ${visiblePoints.length} games`}`}
            numberOfLines={1}
            style={[styles.detailDividend, rangeTotal >= 0 ? styles.positive : styles.negative]}
          >
            {formatCompactSignedMoney(rangeTotal)} {range === 'Season' ? 'Settled season' : `Last ${visiblePoints.length} games`}
          </Text>
        ) : (
          <Text style={styles.detailDividend}>No settled games yet</Text>
        )}
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

      <SectionHeader label="SEASON SNAPSHOT" />
      <View style={styles.statsGrid}>
        <Stat exact={formatMoney(currentPrice)} label="Current price" value={formatCompactMoney(currentPrice)} />
        <Stat exact={formatMoney(player.listing_price)} label="Opening price" value={formatCompactMoney(player.listing_price)} />
        <Stat exact={formatMoney(player.actual_salary)} label="Actual salary" value={formatCompactMoney(player.actual_salary)} />
        <Stat label="Settled games" value={String(points.length)} />
        <Stat label="Avg NP / expected" value={`${average(points, 'np').toFixed(1)} / ${average(points, 'expected_np').toFixed(1)}`} />
        <Stat
          exact={bestPoint ? `${formatSignedMoney(bestPayout)} on ${bestPoint.date}` : formatSignedMoney(bestPayout)}
          label="Best settled payout"
          value={bestPoint ? `${formatCompactSignedMoney(bestPayout)} · ${bestPoint.date}` : formatCompactSignedMoney(bestPayout)}
        />
        <Stat label="Market ownership" value={formatOwnership(player.ownership_bps)} />
        <Stat
          label="Shares available"
          value={Number.isFinite(player.available_shares) ? String(player.available_shares) : 'Unavailable'}
        />
        <Stat label="30-day activity" value={formatTradeVolume(player.volume_30d)} />
        <Stat
          label="Recent form vs expected"
          value={form ? `L${form.games} ${formatSignedMetric(form.averageSurprise)} NP` : 'No settled games'}
        />
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
  const { player, currentPrice, changePercent, held } = row;
  const { first, last } = splitName(player.name);
  const buyTotal = currentPrice + (player.buy_fee ?? 0);
  const shortfall = held ? 0 : Math.max(0, buyTotal - freeCash);
  const soldOut = !held && player.available_shares === 0;
  const unaffordable = !held && !soldOut && shortfall > 0;
  const disabled = shorted || boosted || soldOut || unaffordable || locked;
  const form = recentForm(trendPoints);
  const changeDirection = changePercent === null ? 0 : metricDirection(changePercent);
  const formDirection = form ? metricDirection(form.averageSurprise) : 0;
  const chartPoints = selectTrendRange(trendPoints, 'L15');
  const cumulativeDividend = chartPoints.reduce(
    (sum, point) => sum + point.dividend_per_holder,
    0,
  );
  const rowAccessibilityLabel = [
    `View ${player.name} details`,
    `Current price ${formatMoney(currentPrice)}`,
    changePercent === null ? null : `${formatSignedPercent(changePercent)} since listing`,
    held ? 'You own this player' : null,
    // An explicit label replaces the descendant text, so anything the row shows
    // visibly has to be repeated here or assistive tech simply loses it.
    player.tier.toUpperCase(),
    showOwnership ? formatOwnership(player.ownership_bps) : null,
    form
      ? `Recent form, last ${form.games} games ${formatSignedMetric(form.averageSurprise)} net points versus expected`
      : null,
    chartPoints.length > 0
      ? `Last ${chartPoints.length} settled games cumulative dividends ${formatCompactSignedMoney(cumulativeDividend)}`
      : null,
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
          <Text maxFontSizeMultiplier={MAX_ROW_FONT_SCALE} numberOfLines={1} style={styles.playerName}>
            {first ? <Text style={styles.playerFirst}>{first} </Text> : null}
            {last}
          </Text>
          <Text maxFontSizeMultiplier={MAX_ROW_FONT_SCALE} numberOfLines={1} style={styles.playerMeta}>
            {player.tier.toUpperCase()}
            {form ? '  ' : ''}
            {form ? (
              <Text
                style={
                  formDirection > 0
                    ? styles.positive
                    : formDirection < 0
                      ? styles.negative
                      : styles.neutral
                }
              >
                L{form.games} {formatSignedMetric(form.averageSurprise)} NP
              </Text>
            ) : null}
          </Text>
        </View>
        {showOwnership ? (
          <Text numberOfLines={1} style={styles.ownership}>
            {formatOwnershipShort(player.ownership_bps)}
          </Text>
        ) : null}
        {showSparkline && chartPoints.length > 0 ? <Sparkline points={chartPoints} /> : null}
        <View style={styles.quote}>
          <Text maxFontSizeMultiplier={MAX_ROW_FONT_SCALE} numberOfLines={1} style={styles.price}>{formatCompactMoney(currentPrice)}</Text>
          {changePercent === null ? null : (
            <View
              style={[
                styles.changeChip,
                changeDirection > 0
                  ? styles.chipUp
                  : changeDirection < 0
                    ? styles.chipDown
                    : styles.chipFlat,
              ]}
            >
              <Text
                maxFontSizeMultiplier={MAX_ROW_FONT_SCALE}
                numberOfLines={1}
                style={[
                  styles.changeChipText,
                  changeDirection > 0
                    ? styles.positive
                    : changeDirection < 0
                      ? styles.negative
                      : styles.neutral,
                ]}
              >
                {formatSignedPercent(changePercent)}
              </Text>
            </View>
          )}
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
  const [sort, setSort] = useState<MarketSort>('value');
  const [filter, setFilter] = useState<MarketFilter>('all');
  const [trendingWindow, setTrendingWindow] = useState<TrendRange>('L15');
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

  const renderItem = useCallback(
    ({ item }: { item: MarketRowModel }) => (
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

      <ScrollView
        contentContainerStyle={styles.chipBar}
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
      >
        <Segmented groupLabel="Sort players" onChange={setSort} options={MARKET_SORTS} value={sort} />
        <Segmented groupLabel="Filter players" onChange={setFilter} options={MARKET_FILTERS} value={filter} />
        {/* The window picker only earns its row space while trending is the
            active sort — it has no effect on any other ordering. */}
        {sort === 'trending' ? (
          <Segmented
            groupLabel="Trending window"
            onChange={setTrendingWindow}
            options={TRENDING_WINDOWS}
            value={trendingWindow}
          />
        ) : null}
      </ScrollView>

      {/* Column strip doubles as the live result count. */}
      <View style={styles.columnHeader}>
        <Text accessibilityLiveRegion="polite" style={styles.columnHeaderText}>
          {rows.length === players.length
            ? `${players.length} PLAYERS`
            : `${rows.length} OF ${players.length}`}
        </Text>
        <View style={styles.columnHeaderRule} />
        <Text style={styles.columnHeaderText}>
          {roomy ? 'OWNED · ' : ''}PRICE · MOVE
        </Text>
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
        data={rows}
        initialNumToRender={14}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.player.id}
        ListEmptyComponent={emptyState}
        ListHeaderComponent={listHeader}
        maxToRenderPerBatch={12}
        renderItem={renderItem}
        style={styles.list}
        windowSize={9}
      />
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

  chipScroll: { flexGrow: 0, flexShrink: 0, marginHorizontal: -space.md },
  chipBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
  },

  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingBottom: space.sm,
  },
  columnHeaderText: { ...labelStyle, flexShrink: 0 },
  columnHeaderRule: { flex: 1, height: 1, backgroundColor: colors.border, minWidth: space.sm },

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
  playerName: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 15,
    fontWeight: weight.heavy,
    },
  playerFirst: { color: colors.muted, fontWeight: weight.medium },
  playerMeta: {
    ...numeric,
    color: colors.faint,
    fontSize: type.body,
    fontWeight: weight.medium,
    marginTop: 2,
  },

  ownership: {
    ...labelStyle,
    width: 46,
    textAlign: 'right',
    flexShrink: 0,
    letterSpacing: 0.3,
  },
  sparkline: { width: 52, height: 26, flexShrink: 0 },

  quote: { alignItems: 'flex-end', minWidth: 72, flexShrink: 0, gap: 4 },
  price: { ...numeric, color: colors.text, fontSize: 16, fontWeight: weight.heavy },
  changeChip: {
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 54,
    alignItems: 'center',
  },
  chipUp: { backgroundColor: colors.greenSoft },
  chipDown: { backgroundColor: colors.redSoft },
  chipFlat: { backgroundColor: colors.surfaceRaised },
  changeChipText: { ...numeric, fontSize: type.label, fontWeight: weight.heavy },
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
  buyButton: { borderColor: colors.green, backgroundColor: colors.greenSoft },
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
  buyText: { color: colors.green },
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
  detailQuote: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingBottom: space.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  detailPrice: { ...numeric, color: colors.text, fontSize: 32, fontWeight: weight.black, letterSpacing: 0 },
  detailDividend: { ...numeric, color: colors.muted, fontSize: type.body, fontWeight: weight.heavy },

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
