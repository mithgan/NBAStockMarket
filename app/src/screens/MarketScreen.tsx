import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
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
  LinearGradient,
  Path,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import {
  cumulativeValues,
  selectHighLowPoints,
  selectSettledTrendPoints,
  selectTrendRange,
  type TrendPoint,
  type TrendRange,
} from '../data/trendPresentation';
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
  formatSignedMetric,
  formatSignedPercent,
  formatTradeVolume,
  lineChartCoordinates,
  metricDirection,
  priceChangePercent,
  recentForm,
  smoothLinePath,
} from '../data/marketPresentation';
import type { Player } from '../data/types';
import {
  formatCompactMoney,
  formatCompactSignedMoney,
  formatMoney,
  formatSignedMoney,
} from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { colors, radius, space, type } from '../theme';
import { MAX_ROW_FONT_SCALE, marketActionWidth, marketRowHeight } from './marketRowHeight';


function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
}

function PlayerAvatar({ player, size = 34 }: { player: Player; size?: number }) {
  const [failed, setFailed] = useState(false);
  const dimensions = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View style={[styles.avatar, dimensions]}>
      {failed ? (
        <Text style={styles.avatarInitials}>{initials(player.name)}</Text>
      ) : (
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel={`${player.name} headshot`}
          onError={() => setFailed(true)}
          source={{ uri: `https://a.espncdn.com/i/headshots/nba/players/full/${player.id}.png` }}
          style={{ width: size, height: size }}
        />
      )}
    </View>
  );
}

function average(points: TrendPoint[], key: 'np' | 'expected_np') {
  if (points.length === 0) return 0;
  return points.reduce((sum, point) => sum + point[key], 0) / points.length;
}

function DetailChart({ points }: { points: TrendPoint[] }) {
  const [width, setWidth] = useState(0);
  const values = cumulativeValues(points.map((point) => point.dividend_per_holder));
  const extrema = selectHighLowPoints(values);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  const chartHeight = 168;
  const horizontalInset = 10;
  const topInset = 26;
  const bottomInset = 22;
  const coordinates = values.map((value, index) => ({
    x: horizontalInset + (index / Math.max(values.length - 1, 1)) * Math.max(width - horizontalInset * 2, 0),
    y: topInset + ((maximum - value) / span) * (chartHeight - topInset - bottomInset),
  }));
  const linePath = smoothLinePath(coordinates);
  const color = values.at(-1)! >= 0 ? colors.green : colors.red;
  const areaPath = coordinates.length > 0
    ? `${linePath} L ${coordinates.at(-1)!.x} ${chartHeight - bottomInset} L ${coordinates[0].x} ${chartHeight - bottomInset} Z`
    : '';

  return (
    <View
      accessible
      accessibilityLabel={`${points.length} game cumulative dividend chart, high ${formatCompactSignedMoney(extrema.high?.value ?? 0)}, low ${formatCompactSignedMoney(extrema.low?.value ?? 0)}`}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={styles.chart}
    >
      {width > 0 ? (
        <Svg height={chartHeight} width={width}>
          <Defs>
            <LinearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity="0.22" />
              <Stop offset="1" stopColor={color} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Path d={areaPath} fill="url(#chartFill)" />
          <Path d={linePath} fill="none" stroke={color} strokeLinecap="round" strokeWidth={2.5} />
          {([['HIGH', extrema.high], ['LOW', extrema.low]] as const).map(([label, point]) => {
            if (!point) return null;
            const coordinate = coordinates[point.index];
            const isHigh = label === 'HIGH';
            return (
              <G key={label}>
                <Circle cx={coordinate.x} cy={coordinate.y} fill={colors.background} r={4.5} stroke={color} strokeWidth={2.5} />
                <SvgText
                  fill={colors.text}
                  fontSize={11}
                  fontWeight="800"
                  textAnchor={coordinate.x < 56 ? 'start' : coordinate.x > width - 56 ? 'end' : 'middle'}
                  x={coordinate.x}
                  y={Math.max(12, Math.min(chartHeight - 4, coordinate.y + (isHigh ? -10 : 19)))}
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
  const points = selectSettledTrendPoints(trendPoints, latestSettledDate);
  const visiblePoints = selectTrendRange(points, range);
  const rangeTotal = visiblePoints.reduce((sum, point) => sum + point.dividend_per_holder, 0);
  const bestPayout = points.length > 0
    ? Math.max(...points.map((point) => point.dividend_per_holder))
    : 0;
  const l5Form = recentForm(points);
  const change = priceChangePercent(currentPrice, player.listing_price);

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
        <Text accessibilityRole="header" style={styles.sectionTitle}>Cumulative dividends</Text>
        <View accessibilityRole="tablist" style={styles.rangeToggle}>
          {(['L5', 'L15', 'Season'] as const).map((option) => {
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
      {visiblePoints.length > 0 ? <DetailChart points={visiblePoints} /> : <Text style={styles.emptyChart}>No game data</Text>}

      <Text accessibilityRole="header" style={styles.sectionTitle}>Season snapshot</Text>
      <View style={styles.statsGrid}>
        <Stat exact={formatMoney(currentPrice)} label="Current price" value={formatCompactMoney(currentPrice)} />
        <Stat exact={formatMoney(player.listing_price)} label="Opening price" value={formatCompactMoney(player.listing_price)} />
        <Stat exact={formatMoney(player.actual_salary)} label="Actual salary" value={formatCompactMoney(player.actual_salary)} />
        <Stat label="Settled games" value={String(points.length)} />
        <Stat label="Avg NP / expected" value={`${average(points, 'np').toFixed(1)} / ${average(points, 'expected_np').toFixed(1)}`} />
        <Stat exact={formatSignedMoney(bestPayout)} label="Best settled payout" value={formatCompactSignedMoney(bestPayout)} />
        <Stat label="Market ownership" value={formatOwnership(player.ownership_bps)} />
        <Stat
          label="Shares available"
          value={Number.isFinite(player.available_shares) ? String(player.available_shares) : 'Unavailable'}
        />
        <Stat label="30-day activity" value={formatTradeVolume(player.volume_30d)} />
        <Stat
          label="Recent form vs expected"
          value={l5Form ? `L${l5Form.games} ${formatSignedMetric(l5Form.averageSurprise)} NP` : 'No settled games'}
        />
      </View>
    </ScrollView>
  );
}

function Sparkline({ points }: { points: TrendPoint[] }) {
  const dividends = points.map((point) => point.dividend_per_holder);
  const values = [0, ...cumulativeValues(dividends)];
  const cumulativeDividend = values.at(-1) ?? 0;
  const color = cumulativeDividend >= 0 ? colors.green : colors.red;
  const width = 52;
  const height = 26;
  const coordinates = lineChartCoordinates(values, width, height);
  const linePath = smoothLinePath(coordinates);
  const zeroY = coordinates[0]?.y ?? height / 2;

  return (
    <View
      accessible
      accessibilityLabel={`Last ${points.length} settled games, cumulative dividends ${formatCompactSignedMoney(cumulativeDividend)}`}
      style={styles.sparkline}
    >
      <Svg height={height} width={width}>
        <Path
          d={`M 2 ${zeroY} L ${width - 2} ${zeroY}`}
          fill="none"
          stroke={colors.border}
          strokeDasharray="2 3"
          strokeWidth={1}
        />
        <Path d={linePath} fill="none" stroke={color} strokeLinecap="round" strokeWidth={2} />
      </Svg>
    </View>
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
}: MarketRowProps) {
  const { player, currentPrice, changePercent, held } = row;
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
        onPress={() => onOpen(player)}
        style={({ pressed }) => [styles.playerDetails, pressed && styles.pressed]}
      >
        <PlayerAvatar player={player} size={34} />
        <View style={styles.playerCopy}>
          <Text maxFontSizeMultiplier={MAX_ROW_FONT_SCALE} numberOfLines={1} style={styles.playerName}>{player.name}</Text>
          <Text maxFontSizeMultiplier={MAX_ROW_FONT_SCALE} numberOfLines={1} style={styles.playerMeta}>
            {player.tier.toUpperCase()}
            {form ? ' · ' : ''}
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
            {formatOwnership(player.ownership_bps)}
          </Text>
        ) : null}
        {showSparkline && chartPoints.length > 0 ? <Sparkline points={chartPoints} /> : null}
        <View style={styles.quote}>
          <Text maxFontSizeMultiplier={MAX_ROW_FONT_SCALE} numberOfLines={1} style={styles.price}>{formatCompactMoney(currentPrice)}</Text>
          {changePercent === null ? null : (
            <Text
              maxFontSizeMultiplier={MAX_ROW_FONT_SCALE}
              numberOfLines={1}
              style={[
                styles.priceChange,
                changeDirection > 0
                  ? styles.positive
                  : changeDirection < 0
                    ? styles.negative
                    : styles.neutral,
              ]}
            >
              {formatSignedPercent(changePercent)}
            </Text>
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
    </View>
  );
}

function ChipRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { key: T; label: string; hint: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View accessibilityRole="tablist" aria-label={label} style={styles.chipRow}>
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            accessibilityLabel={option.hint}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            aria-selected={selected}
            key={option.key}
            onPress={() => onChange(option.key)}
            style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
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
  const { fontScale, width } = useWindowDimensions();
  const rowHeight = marketRowHeight(fontScale);
  const actionWidth = marketActionWidth(fontScale, width);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<MarketSort>('value');
  const [filter, setFilter] = useState<MarketFilter>('all');

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
        onTrade={trade}
        pending={pendingActions.has(`trade:${item.player.id}`)}
        row={item}
        rowHeight={rowHeight}
        shorted={activeShortPlayerIds.has(item.player.id)}
        showOwnership={roomy}
        showSparkline={!compact && !largeText}
        trendPoints={settledTrends[item.player.id] ?? []}
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
        <View style={styles.controlsTop}>
          <Text accessibilityRole="header" style={styles.title}>Market</Text>
          <View style={styles.cashBlock}>
            <Text style={styles.cashLabel}>CASH</Text>
            <Text
              accessibilityLabel={`Free cash ${formatMoney(freeCash)}`}
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
          placeholderTextColor={colors.muted}
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
          <ChipRow label="Sort players" onChange={setSort} options={MARKET_SORTS} value={sort} />
          <View style={styles.chipDivider} />
          <ChipRow label="Filter players" onChange={setFilter} options={MARKET_FILTERS} value={filter} />
        </ScrollView>
        <View style={styles.columnHeader}>
          <Text accessibilityLiveRegion="polite" style={styles.columnHeaderText}>
            {rows.length === players.length
              ? `${players.length} players`
              : `${rows.length} of ${players.length} players`}
          </Text>
          <Text style={styles.columnHeaderText}>
            {roomy ? 'OWNED · ' : ''}PRICE · SINCE LISTING
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
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  controlsTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  title: { color: colors.text, fontSize: type.heading, fontWeight: '900' },
  search: {
    minHeight: 44,
    color: colors.text,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: 15,
  },
  cashBlock: { alignItems: 'flex-end', flexShrink: 0, minWidth: 72 },
  cashLabel: { color: colors.muted, fontSize: type.micro, fontWeight: '800', letterSpacing: 0.8 },
  cashValue: { color: colors.gold, fontSize: type.value, fontWeight: '900', fontVariant: ['tabular-nums'] },
  chipScroll: { flexGrow: 0, flexShrink: 0 },
  chipBar: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingRight: space.md },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  chipDivider: { width: 1, height: 20, backgroundColor: colors.border, marginHorizontal: space.xs },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipSelected: { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
  chipText: { color: colors.muted, fontSize: type.label, fontWeight: '800' },
  chipTextSelected: { color: colors.gold },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingBottom: space.sm,
  },
  columnHeaderText: { color: colors.muted, fontSize: type.micro, fontWeight: '800', letterSpacing: 0.6 },
  list: { flex: 1 },
  listContent: { paddingBottom: space.xl },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'transparent',
    borderLeftWidth: 2,
  },
  playerRowHeld: { borderLeftColor: colors.gold, backgroundColor: colors.surface },
  playerDetails: { flex: 1, minWidth: 0, height: '100%', flexDirection: 'row', alignItems: 'center', gap: space.sm },
  avatar: { overflow: 'hidden', backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: colors.text, fontSize: type.label, fontWeight: '900' },
  playerCopy: { flex: 1, minWidth: 0 },
  playerName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  playerMeta: { color: colors.muted, fontSize: type.micro, fontWeight: '700', marginTop: 2 },
  ownership: { width: 78, textAlign: 'right', color: colors.muted, fontSize: type.micro, fontWeight: '700', flexShrink: 0, fontVariant: ['tabular-nums'] },
  sparkline: { width: 52, height: 26, flexShrink: 0 },
  quote: { alignItems: 'flex-end', minWidth: 68, flexShrink: 0 },
  price: { color: colors.text, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  priceChange: { fontSize: type.micro, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
  // Fixed width so BUY, SELL, SOLD OUT and BOOSTED all share one right edge —
  // a ragged action column is much harder to scan down 300 rows.
  tradeButton: {
    minHeight: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: space.xs,
    borderWidth: 1,
  },
  buyButton: { borderColor: colors.green, backgroundColor: '#123b2b' },
  sellButton: { borderColor: colors.red, backgroundColor: '#402027' },
  unaffordableButton: { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  tradeLockedButton: { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  tradeText: { fontSize: type.micro, fontWeight: '900', letterSpacing: 0.4, textAlign: 'center' },
  buyText: { color: colors.green },
  sellText: { color: colors.red },
  unaffordableText: { color: colors.muted },
  tradeLockedText: { color: colors.muted },
  positive: { color: colors.green },
  negative: { color: colors.red },
  neutral: { color: colors.muted },
  pressed: { opacity: 0.65 },
  emptyCard: {
    margin: space.md,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.xs,
  },
  emptyTitle: { color: colors.text, fontSize: type.body, fontWeight: '800' },
  subtle: { color: colors.muted, fontSize: type.label, lineHeight: 18 },

  detailContent: { padding: space.lg, paddingBottom: space.xl, gap: space.md },
  backButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingRight: space.lg },
  backText: { color: colors.gold, fontSize: type.value, fontWeight: '800' },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  detailIdentity: { flex: 1, minWidth: 0, gap: 2 },
  detailName: { color: colors.text, fontSize: 20, lineHeight: 24, fontWeight: '900' },
  detailMeta: { color: colors.muted, fontSize: type.label, fontWeight: '700' },
  // Price sits on its own row: sharing one line with the name clipped the
  // "+x% since listing" caption on a 390px phone.
  detailQuote: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: space.sm },
  detailPrice: { color: colors.text, fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'] },
  detailDividend: { color: colors.muted, fontSize: type.label, fontWeight: '800', fontVariant: ['tabular-nums'] },
  chartHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
  },
  sectionTitle: { color: colors.text, fontSize: type.heading, fontWeight: '800' },
  rangeToggle: { flexDirection: 'row', alignSelf: 'flex-end', backgroundColor: colors.surface, borderRadius: radius.md, padding: 2 },
  rangeButton: { minWidth: 48, minHeight: 44, paddingHorizontal: space.sm, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  rangeButtonSelected: { backgroundColor: colors.surfaceRaised },
  rangeText: { color: colors.muted, fontSize: type.label, fontWeight: '900' },
  rangeTextSelected: { color: colors.gold },
  chart: { height: 168, borderBottomColor: colors.border, borderBottomWidth: 1 },
  emptyChart: { color: colors.muted, height: 168, textAlign: 'center', textAlignVertical: 'center' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stat: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 140,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
  },
  statLabel: { color: colors.muted, fontSize: type.micro, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  statValue: { color: colors.text, fontSize: type.value, fontWeight: '800', marginTop: 6, fontVariant: ['tabular-nums'] },
});
