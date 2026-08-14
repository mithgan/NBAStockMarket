import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { HoldingCard } from '../components/HoldingCard';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { PortfolioHistoryChart } from '../components/PortfolioHistoryChart';
import { SettlementSummary, nightContributions } from '../components/SettlementSummary';
import { selectTrendRange } from '../data/trendPresentation';
import { formatCompactMoney, formatCompactSignedMoney, formatMoney, formatSignedMoney } from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { STARTING_CASH, type ActivityEvent } from '../state/game';
import { useDesignVariant } from '../theme/ThemeProvider';
import { colors, fonts, headingStyle, numeric, radius, space, type, weight } from '../theme';
import { PlayerDetail } from './MarketScreen';

/**
 * Activity entries grouped into settlement nights. Consecutive entries that
 * share a date fold into one group with a net figure; dateless entries (your
 * own trades) group under their own heading.
 */
type ActivityNight = {
  key: string;
  label: string;
  net: number;
  items: ActivityEvent[];
};

function groupActivity(entries: ActivityEvent[]): ActivityNight[] {
  const nights: ActivityNight[] = [];
  for (const entry of entries) {
    const key = entry.date ?? 'portfolio-action';
    const last = nights.at(-1);
    if (last && last.key === key) {
      last.items.push(entry);
      last.net += entry.cashDelta;
    } else {
      nights.push({ key, label: entry.date ?? 'Your trades', net: entry.cashDelta, items: [entry] });
    }
  }
  return nights;
}

export function PortfolioScreen() {
  const { variant } = useDesignVariant();
  const {
    latestSettledDate,
    players,
    playerTrends,
    state,
    summary,
  } = usePortfolio();
  const [detailPlayerId, setDetailPlayerId] = useState<string | null>(null);
  const { fontScale, width } = useWindowDimensions();
  const bigType = fontScale > 1.3;
  const showCardTrends = width >= 420 && !bigType;
  // The card grid owns its own column math: available width inside the roster
  // panel, then 5/4/3/2 columns by breakpoint — or as many 220px columns as
  // fit when the reader has scaled their type up.
  const gridWidth = Math.min(width, 1040) - 2 * space.lg - 2 * space.md;
  const columns = bigType
    ? Math.max(2, Math.floor(gridWidth / 220))
    : gridWidth >= 880 ? 5 : gridWidth >= 660 ? 4 : gridWidth >= 460 ? 3 : 2;
  const cardWidth = Math.floor((gridWidth - space.sm * (columns - 1)) / columns);

  if (!state || !summary) return null;

  const playerById = new Map(players.map((player) => [player.id, player]));
  const detailPlayer = detailPlayerId ? playerById.get(detailPlayerId) ?? null : null;
  const latestPoint = state.portfolioHistory.at(-1) ?? null;
  const recentActivity = [...state.activity].reverse().slice(0, 10);
  const largestSettledDelta = recentActivity.reduce(
    (largest, entry) => (entry.date === null ? largest : Math.max(largest, Math.abs(entry.cashDelta))),
    0,
  );
  const rosterPnl = summary.holdings.reduce((total, holding) => total + holding.unrealizedPnl, 0);
  const allTimePercent = ((summary.totalValue - STARTING_CASH) / STARTING_CASH) * 100;

  if (detailPlayer) {
    return (
      <PlayerDetail
        backLabel="Portfolio"
        currentPrice={state.prices[detailPlayer.id] ?? detailPlayer.listing_price}
        latestSettledDate={latestSettledDate}
        onClose={() => setDetailPlayerId(null)}
        player={detailPlayer}
        trendPoints={playerTrends[detailPlayer.id] ?? []}
      />
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <PortfolioHistoryChart
        footnote={
          latestPoint
            ? `Settled ${latestPoint.date}. Includes cash payouts and player-price movement.`
            : 'No server settlement has reached this account yet.'
        }
        height={variant.chartHeight}
        points={state.portfolioHistory}
        totalValue={summary.totalValue}
      />
      {latestSettledDate ? (
        <SettlementSummary
          contributions={nightContributions(state.holdings, playerById, playerTrends, latestSettledDate)}
          settledDate={latestSettledDate}
        />
      ) : null}
      <View style={styles.cashStrip}>
        <View style={styles.cashCell}>
          <Text style={styles.cashLabel}>Free cash</Text>
          <Text
            accessibilityLabel={`Free cash ${formatMoney(summary.freeCash)}, available to spend`}
            maxFontSizeMultiplier={1.4}
            numberOfLines={1}
            style={styles.cashValue}
          >
            {formatCompactMoney(summary.freeCash)}
          </Text>
        </View>
        <View style={styles.cashCell}>
          <Text style={styles.cashLabel}>Holdings</Text>
          <Text
            accessibilityLabel={`Holdings ${formatMoney(summary.marketValue)}, ${summary.holdings.length} of ${players.length} listed players`}
            maxFontSizeMultiplier={1.4}
            numberOfLines={1}
            style={styles.cashValue}
          >
            {formatCompactMoney(summary.marketValue)}
          </Text>
        </View>
        <View style={styles.cashCell}>
          <Text style={styles.cashLabel}>All time</Text>
          <Text
            accessibilityLabel={`${allTimePercent >= 0 ? 'Up' : 'Down'} ${Math.abs(allTimePercent).toFixed(2)} percent from the ${formatMoney(STARTING_CASH)} opening bankroll`}
            maxFontSizeMultiplier={1.4}
            numberOfLines={1}
            style={[styles.cashValue, allTimePercent >= 0 ? styles.positive : styles.negative]}
          >
            {`${allTimePercent >= 0 ? '+' : ''}${allTimePercent.toFixed(2)}%`}
          </Text>
        </View>
        {summary.reservedCollateral > 0 ? (
          <View style={styles.cashCell}>
            <Text style={styles.cashLabel}>Reserved</Text>
            <Text
              accessibilityLabel={`Reserved ${formatMoney(summary.reservedCollateral)}, short collateral held from your ${formatMoney(summary.cash)} cash balance`}
              maxFontSizeMultiplier={1.4}
              numberOfLines={1}
              style={styles.cashValue}
            >
              {formatCompactMoney(summary.reservedCollateral)}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.rosterPanel}>
        <View style={styles.rosterHead}>
          <Text accessibilityRole="header" style={styles.rosterTitle}>
            {state.holdings.length > 0 ? `Your players (${state.holdings.length})` : 'Your players'}
          </Text>
          {state.holdings.length > 0 ? (
            <Text
              accessibilityLabel={`Roster worth ${formatMoney(summary.marketValue)}, ${rosterPnl >= 0 ? 'up' : 'down'} ${formatMoney(Math.abs(rosterPnl))} against what you paid`}
              numberOfLines={1}
              style={styles.rosterMeta}
            >
              {formatCompactMoney(summary.marketValue)}
              <Text style={rosterPnl >= 0 ? styles.positive : styles.negative}>
                {`  ${formatCompactSignedMoney(rosterPnl)}`}
              </Text>
            </Text>
          ) : null}
        </View>
        {state.holdings.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Your cap sheet is clean.</Text>
            <Text style={styles.subtle}>
              Open Market to buy one whole-player share. Fees are included at checkout.
            </Text>
          </View>
        ) : (
          <View style={styles.cardGrid}>
            {summary.holdings.map((holding) => {
              const player = playerById.get(holding.player_id);
              return player ? (
                <HoldingCard
                  key={holding.player_id}
                  holding={{
                    player,
                    currentPrice: holding.currentPrice,
                    costBasis: holding.costBasis,
                    unrealizedPnl: holding.unrealizedPnl,
                  }}
                  onPress={() => setDetailPlayerId(player.id)}
                  trend={showCardTrends ? selectTrendRange(playerTrends[player.id] ?? [], 'L15') : undefined}
                  width={cardWidth}
                />
              ) : null;
            })}
          </View>
        )}
      </View>
      <Text accessibilityRole="header" style={styles.sectionHeading}>Recent activity</Text>
      {recentActivity.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.subtle}>Trades and settlements will appear here.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {groupActivity(recentActivity).map((night) => (
            <View key={night.key}>
              <View style={styles.nightHead}>
                <Text style={styles.nightDate}>{night.label}</Text>
                {night.items.length > 1 ? (
                  <Text
                    accessibilityLabel={`${night.label} settled ${formatSignedMoney(night.net)} across ${night.items.length} entries`}
                    style={[styles.nightNet, night.net >= 0 ? styles.positive : styles.negative]}
                  >
                    {formatCompactSignedMoney(night.net)}
                  </Text>
                ) : null}
              </View>
              {night.items.map((entry) => {
                const up = entry.cashDelta >= 0;
                const point = entry.date
                  ? (playerTrends[entry.playerId] ?? []).find((trendPoint) => trendPoint.date === entry.date)
                  : undefined;
                // Meter scale is per-batch: the biggest settled payout in view
                // is the full bar and everything else reads against it.
                const meter =
                  entry.date === null || largestSettledDelta === 0
                    ? 0
                    : Math.abs(entry.cashDelta) / largestSettledDelta;
                const player = playerById.get(entry.playerId);
                return (
                  <View key={entry.id} style={styles.activityRow}>
                    {player ? (
                      <PlayerAvatar player={player} size={30} />
                    ) : (
                      <View style={[styles.activityTick, up ? styles.tickUp : styles.tickDown]} />
                    )}
                    <View style={styles.rowCopy}>
                      <Text numberOfLines={1} style={styles.activityName}>
                        {entry.message.replace(/ daily dividend$/, '')}
                      </Text>
                      {point ? (
                        <Text numberOfLines={1} style={styles.activityWhy}>
                          {`${point.np.toFixed(1)} NP vs ${point.expected_np.toFixed(1)} projected`}
                        </Text>
                      ) : null}
                      {meter > 0 ? (
                        <View style={styles.meterTrack}>
                          <View
                            style={[
                              styles.meterFill,
                              up ? styles.meterUp : styles.meterDown,
                              { width: `${Math.max(3, Math.round(100 * meter))}%` },
                            ]}
                          />
                        </View>
                      ) : null}
                    </View>
                    <Text
                      accessibilityLabel={formatSignedMoney(entry.cashDelta)}
                      maxFontSizeMultiplier={1.6}
                      numberOfLines={1}
                      style={[styles.activityValue, up ? styles.positive : styles.negative]}
                    >
                      {formatCompactSignedMoney(entry.cashDelta)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingBottom: space.xxl,
  },
  cashStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    marginTop: space.sm,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  cashCell: {
    minWidth: 92,
  },
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
  footnote: {
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.label,
    lineHeight: 16,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
  },
  subtle: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.label,
    lineHeight: 17,
  },
  empty: {
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
  list: {},
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    padding: space.md,
    paddingTop: space.sm,
  },
  rosterPanel: {
    marginHorizontal: space.lg,
    marginTop: space.lg,
    borderRadius: radius.lg,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  rosterHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.xs,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  rosterTitle: {
    ...headingStyle,
  },
  rosterMeta: {
    ...numeric,
    color: colors.muted,
    fontSize: type.body,
    fontWeight: weight.heavy,
    flexShrink: 0,
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
  rowPressed: {
    backgroundColor: colors.surface,
  },
  rowGrid: {
    minHeight: 48,
    paddingVertical: space.xs,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    borderBottomWidth: 0,
  },
  rowNameGrid: {
    fontSize: type.body,
    letterSpacing: 0.4,
  },
  rowValueFilled: {
    overflow: 'hidden',
    borderRadius: radius.md,
    paddingHorizontal: 7,
    paddingVertical: 3,
    minWidth: 76,
    textAlign: 'right',
  },
  fillUp: {
    backgroundColor: colors.greenSoft,
  },
  fillDown: {
    backgroundColor: colors.redSoft,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
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
  activityRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  activityValue: {
    ...numeric,
    fontSize: type.value,
    fontWeight: weight.heavy,
    flexShrink: 0,
  },
  nightHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xs,
  },
  nightDate: {
    ...numeric,
    color: colors.faint,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  nightNet: {
    ...numeric,
    fontSize: type.value,
    fontWeight: weight.black,
  },
  activityTick: {
    width: 3,
    height: 16,
    borderRadius: 2,
    flexShrink: 0,
  },
  tickUp: {
    backgroundColor: colors.green,
  },
  tickDown: {
    backgroundColor: colors.red,
  },
  activityWhy: {
    ...numeric,
    color: colors.faint,
    fontSize: type.label,
    fontWeight: weight.medium,
    marginTop: 1,
  },
  meterTrack: {
    height: 3,
    marginTop: 5,
    borderRadius: radius.xs,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  meterFill: {
    height: 3,
    borderRadius: radius.xs,
  },
  meterUp: {
    backgroundColor: colors.green,
  },
  meterDown: {
    backgroundColor: colors.red,
  },
  activityName: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  positive: {
    color: colors.green,
  },
  negative: {
    color: colors.red,
  },
});
