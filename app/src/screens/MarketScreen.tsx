import { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
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

import { players } from '../data/snapshot';
import {
  cumulativeValues,
  selectHighLowPoints,
  selectTrendRange,
  sparklineHeights,
  trendDirection,
  type TrendRange,
} from '../data/trendPresentation';
import { playerTrends, type TrendPoint } from '../data/trends';
import type { Player } from '../data/types';
import { formatMoney, formatSignedMoney } from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { getPurchaseShortfall } from '../state/portfolio';
import { clipTrends } from '../state/sim';
import { colors } from '../theme';

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
}

function PlayerAvatar({ player, size = 46 }: { player: Player; size?: number }) {
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

function compactSignedMoney(value: number) {
  const absolute = Math.abs(value);
  const sign = value >= 0 ? '+' : '−';
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  if (absolute >= 1_000) return `${sign}$${Math.round(absolute / 1_000)}K`;
  return `${sign}$${Math.round(absolute)}`;
}

function smoothPath(coordinates: { x: number; y: number }[]) {
  if (coordinates.length === 0) return '';
  return coordinates.slice(1).reduce((path, point, index) => {
    const previous = coordinates[index];
    const middleX = (previous.x + point.x) / 2;
    return `${path} C ${middleX} ${previous.y}, ${middleX} ${point.y}, ${point.x} ${point.y}`;
  }, `M ${coordinates[0].x} ${coordinates[0].y}`);
}

function DetailChart({ points }: { points: TrendPoint[] }) {
  const [width, setWidth] = useState(0);
  const values = cumulativeValues(points.map((point) => point.dividend_per_holder));
  const extrema = selectHighLowPoints(values);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  const chartHeight = 180;
  const horizontalInset = 10;
  const topInset = 30;
  const bottomInset = 24;
  const coordinates = values.map((value, index) => ({
    x: horizontalInset + (index / Math.max(values.length - 1, 1)) * Math.max(width - horizontalInset * 2, 0),
    y: topInset + ((maximum - value) / span) * (chartHeight - topInset - bottomInset),
  }));
  const linePath = smoothPath(coordinates);
  const color = values.at(-1)! >= 0 ? colors.green : colors.red;
  const areaPath = coordinates.length > 0
    ? `${linePath} L ${coordinates.at(-1)!.x} ${chartHeight - bottomInset} L ${coordinates[0].x} ${chartHeight - bottomInset} Z`
    : '';

  return (
    <View
      accessible
      accessibilityLabel={`${points.length} game cumulative dividend chart, high ${compactSignedMoney(extrema.high?.value ?? 0)}, low ${compactSignedMoney(extrema.low?.value ?? 0)}`}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={styles.chart}
    >
      {width > 0 ? (
        <Svg height={chartHeight} width={width}>
          <Defs>
            <LinearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity="0.25" />
              <Stop offset="1" stopColor={color} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Path d={areaPath} fill="url(#chartFill)" />
          <Path d={linePath} fill="none" stroke={color} strokeLinecap="round" strokeWidth={3} />
          {([['HIGH', extrema.high], ['LOW', extrema.low]] as const).map(([label, point]) => {
            if (!point) return null;
            const coordinate = coordinates[point.index];
            const isHigh = label === 'HIGH';
            return (
              <G key={label}>
                <Circle cx={coordinate.x} cy={coordinate.y} fill={colors.background} r={5} stroke={color} strokeWidth={3} />
                <SvgText
                  fill={colors.text}
                  fontSize={9}
                  fontWeight="800"
                  textAnchor={coordinate.x < 52 ? 'start' : coordinate.x > width - 52 ? 'end' : 'middle'}
                  x={coordinate.x}
                  y={Math.max(11, Math.min(chartHeight - 3, coordinate.y + (isHigh ? -10 : 18)))}
                >
                  {label} {compactSignedMoney(point.value)}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

export function PlayerDetail({
  player,
  onClose,
  backLabel = 'Market',
}: {
  player: Player;
  onClose: () => void;
  backLabel?: string;
}) {
  const [range, setRange] = useState<TrendRange>('L15');
  const { simDate } = usePortfolio();
  const points = clipTrends(playerTrends[player.id] ?? [], simDate);
  const visiblePoints = selectTrendRange(points, range);
  const rangeTotal = visiblePoints.reduce((sum, point) => sum + point.dividend_per_holder, 0);
  const bestPayout = points.length > 0
    ? Math.max(...points.map((point) => point.dividend_per_holder))
    : 0;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.detailContent}>
      <Pressable
        accessibilityLabel={`Close ${player.name} details`}
        accessibilityRole="button"
        hitSlop={8}
        onPress={onClose}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
      >
        <Text style={styles.backText}>‹  {backLabel}</Text>
      </Pressable>

      <View style={styles.detailHeader}>
        <PlayerAvatar player={player} size={104} />
        <View style={styles.detailIdentity}>
          <Text style={styles.detailName}>{player.name}</Text>
          <Text style={[styles.tier, player.tier === 'star' ? styles.star : styles.mid]}>
            {player.tier.toUpperCase()}
          </Text>
        </View>
      </View>
      <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={styles.detailPrice}>{formatMoney(player.listing_price)}</Text>
      <Text style={[styles.seasonChange, rangeTotal >= 0 ? styles.positive : styles.negative]}>
        {formatSignedMoney(rangeTotal)} {range === 'Season' ? 'This season' : `Last ${visiblePoints.length} games`}
      </Text>

      <View style={styles.chartCard}>
        <View style={styles.chartHeading}>
          <View>
            <Text style={styles.sectionEyebrow}>DIVIDEND PERFORMANCE</Text>
            <Text style={styles.chartTitle}>Cumulative</Text>
          </View>
          <View accessibilityRole="tablist" style={styles.rangeToggle}>
            {(['L5', 'L15', 'Season'] as const).map((option) => {
              const selected = range === option;
              return (
                <Pressable
                  accessibilityLabel={option === 'Season' ? 'Full season' : `Last ${option.slice(1)} games`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  hitSlop={4}
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
        {visiblePoints.length > 0 ? <DetailChart points={visiblePoints} /> : <Text style={styles.emptyChart}>No games played yet — advance the season</Text>}
      </View>

      <Text style={styles.statsTitle}>Season snapshot</Text>
      <View style={styles.statsGrid}>
        <Stat label="Listing price" value={formatMoney(player.listing_price)} />
        <Stat label="Actual salary" value={formatMoney(player.actual_salary)} />
        <Stat label="Tier" value={player.tier.toUpperCase()} />
        <Stat label="Games" value={String(points.length)} />
        <Stat label="Avg NP / expected" value={`${average(points, 'np').toFixed(1)} / ${average(points, 'expected_np').toFixed(1)}`} />
        <Stat label="Best game payout" value={formatSignedMoney(bestPayout)} />
      </View>
    </ScrollView>
  );
}

function Sparkline({ points }: { points: TrendPoint[] }) {
  const dividends = points.map((point) => point.dividend_per_holder);
  const direction = trendDirection(dividends);
  const color = direction === 'up' ? colors.green : colors.red;
  const heights = sparklineHeights(dividends);

  return (
    <View
      accessible
      accessibilityLabel={`Last ${points.length} game dividend trend, trending ${direction}`}
      style={styles.sparkline}
    >
      {heights.map((height, index) => (
        <View
          // Dates are unique within each player's series.
          key={points[index].date}
          style={[styles.sparkBar, { backgroundColor: color, height }]}
        />
      ))}
    </View>
  );
}

interface MarketRowProps {
  cash: number;
  player: Player;
  held: boolean;
  isLast: boolean;
  simDate: string;
  onOpen: (player: Player) => void;
  onTrade: (player: Player, side: 'buy' | 'sell') => void;
}

function MarketRow({ cash, player, held, isLast, simDate, onOpen, onTrade }: MarketRowProps) {
  const shortfall = held ? 0 : getPurchaseShortfall(cash, player.listing_price);
  const unaffordable = !held && shortfall > 0;
  const handleTrade = (event: GestureResponderEvent) => {
    event.stopPropagation();
    onTrade(player, held ? 'sell' : 'buy');
  };

  return (
    <Pressable
      accessibilityLabel={`View ${player.name} details`}
      accessibilityRole="button"
      onPress={() => onOpen(player)}
      style={({ pressed }) => [
        styles.playerRow,
        !isLast && styles.playerRowBorder,
        pressed && styles.rowPressed,
      ]}
    >
      <PlayerAvatar player={player} />
      <View style={styles.playerCopy}>
        <Text style={styles.playerName} numberOfLines={1}>{player.name}</Text>
        <View style={styles.quoteRow}>
          <Text style={[styles.tier, player.tier === 'star' ? styles.star : styles.mid]}>
            {player.tier.toUpperCase()}
          </Text>
          <Text style={styles.price}>{formatMoney(player.listing_price)}</Text>
        </View>
      </View>
      <Sparkline points={selectTrendRange(clipTrends(playerTrends[player.id] ?? [], simDate), 'L15')} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={held ? `Sell ${player.name}` : `Buy ${player.name} for ${formatMoney(player.listing_price)}`}
        accessibilityHint={unaffordable ? `Needs ${formatMoney(shortfall)} more` : undefined}
        accessibilityState={{ disabled: unaffordable }}
        disabled={unaffordable}
        hitSlop={6}
        onPress={handleTrade}
        style={({ pressed }) => [
          styles.tradeButton,
          held ? styles.sellButton : styles.buyButton,
          unaffordable && styles.unaffordableButton,
          pressed && styles.pressed,
        ]}
      >
        {unaffordable ? (
          <>
            <Text style={[styles.tradeText, styles.unaffordableText]}>NEEDS</Text>
            <Text style={styles.shortfallText}>{formatMoney(shortfall)}</Text>
          </>
        ) : (
          <Text style={[styles.tradeText, held ? styles.sellText : styles.buyText]}>
            {held ? 'SELL' : 'BUY'}
          </Text>
        )}
      </Pressable>
    </Pressable>
  );
}

export function MarketScreen() {
  const { message, owns, simDate, summary, trade } = usePortfolio();
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  if (selectedPlayer) {
    return <PlayerDetail onClose={() => setSelectedPlayer(null)} player={selectedPlayer} />;
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>PLAYER MARKET</Text>
          <Text style={styles.title}>Build your roster</Text>
        </View>
        <View style={styles.cashPill}>
          <Text style={styles.cashLabel}>CASH</Text>
          <Text adjustsFontSizeToFit minimumFontScale={0.8} numberOfLines={1} style={styles.cashValue}>{formatMoney(summary.cash)}</Text>
        </View>
      </View>
      <Text style={styles.subtle}>Tap a player for details, or use Buy/Sell. One share maximum per player.</Text>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <View style={styles.marketList}>
        {players.map((player, index) => (
          <MarketRow
            cash={summary.cash}
            held={owns(player.id)}
            isLast={index === players.length - 1}
            key={player.id}
            onOpen={setSelectedPlayer}
            onTrade={trade}
            player={player}
            simDate={simDate}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { flexGrow: 1, padding: 20, paddingBottom: 36, gap: 10 },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  headingCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.gold, fontSize: 12, fontWeight: '800', letterSpacing: 1.8 },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', marginTop: 4, letterSpacing: -0.6 },
  subtle: { color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 4 },
  cashPill: { alignItems: 'flex-end', alignSelf: 'flex-start', flexShrink: 0, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 9 },
  cashLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
  cashValue: { color: colors.text, fontSize: 12, fontWeight: '800', marginTop: 2 },
  message: { color: colors.gold, backgroundColor: colors.goldSoft, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 12, fontWeight: '700' },
  marketList: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 72, paddingHorizontal: 11, paddingVertical: 10 },
  playerRowBorder: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  rowPressed: { backgroundColor: colors.surfaceRaised },
  avatar: { width: 46, height: 46, borderRadius: 23, overflow: 'hidden', backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  headshot: { width: 46, height: 46 },
  avatarInitials: { color: colors.text, fontSize: 13, fontWeight: '900', letterSpacing: 0.4 },
  playerCopy: { flex: 1, minWidth: 0 },
  playerName: { color: colors.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  quoteRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  tier: { borderRadius: 999, overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 3, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  star: { color: colors.gold, backgroundColor: colors.goldSoft },
  mid: { color: '#9fbccc', backgroundColor: colors.surfaceRaised },
  price: { color: colors.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
  sparkline: { width: 52, height: 32, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  sparkBar: { width: 2, borderRadius: 2, opacity: 0.9 },
  tradeButton: { minWidth: 56, alignItems: 'center', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 9, borderWidth: 1 },
  buyButton: { borderColor: colors.green, backgroundColor: '#123b2b' },
  unaffordableButton: { borderColor: colors.muted, backgroundColor: colors.surfaceRaised, opacity: 0.48 },
  sellButton: { borderColor: colors.red, backgroundColor: '#402027' },
  tradeText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  buyText: { color: colors.green },
  sellText: { color: colors.red },
  unaffordableText: { color: colors.muted, fontSize: 8 },
  shortfallText: { color: colors.muted, fontSize: 8, fontWeight: '800', marginTop: 1 },
  pressed: { opacity: 0.65 },
  detailContent: { padding: 20, paddingBottom: 40 },
  backButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingRight: 16 },
  backText: { color: colors.gold, fontSize: 16, fontWeight: '800' },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 10 },
  detailIdentity: { flex: 1, alignItems: 'flex-start', gap: 8 },
  detailName: { color: colors.text, fontSize: 30, lineHeight: 34, fontWeight: '900', letterSpacing: -0.8 },
  detailPrice: { color: colors.text, fontSize: 42, lineHeight: 48, fontWeight: '800', letterSpacing: -1.4, marginTop: 22, fontVariant: ['tabular-nums'] },
  seasonChange: { fontSize: 16, fontWeight: '800', marginTop: 3, fontVariant: ['tabular-nums'] },
  positive: { color: colors.green },
  negative: { color: colors.red },
  chartCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 16, marginTop: 26 },
  chartHeading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  sectionEyebrow: { color: colors.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  chartTitle: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 3 },
  rangeToggle: { flexDirection: 'row', alignSelf: 'flex-end', backgroundColor: colors.background, borderRadius: 10, padding: 3 },
  rangeButton: { minWidth: 44, minHeight: 44, paddingHorizontal: 7, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rangeButtonSelected: { backgroundColor: colors.surfaceRaised },
  rangeText: { color: colors.muted, fontSize: 11, fontWeight: '900' },
  rangeTextSelected: { color: colors.gold },
  chart: { height: 180, marginTop: 16, borderBottomColor: colors.border, borderBottomWidth: 1 },
  emptyChart: { color: colors.muted, height: 180, textAlign: 'center', textAlignVertical: 'center' },
  statsTitle: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 26, marginBottom: 12 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { width: '48%', minHeight: 86, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 13, justifyContent: 'space-between' },
  statLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  statValue: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 10, fontVariant: ['tabular-nums'] },
});
