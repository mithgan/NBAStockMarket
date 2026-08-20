import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { HoldingRow } from '../components/HoldingCard';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { PortfolioHistoryChart } from '../components/PortfolioHistoryChart';
import { SettlementSummary, nightContributions } from '../components/SettlementSummary';
import { earningsWindows, marketAverageRate, summarizeDividends } from '../data/dividendMetrics';
import {
  selectSettledTrendPoints,
  selectTrendRange,
  surpriseLabel,
  type TrendPoint,
} from '../data/trendPresentation';
import type { Player } from '../data/types';
import { formatCompactMoney, formatCompactSignedMoney, formatMoney, formatSignedMoney } from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { STARTING_CASH, type ActivityEvent } from '../state/game';
import { useDesignVariant } from '../theme/ThemeProvider';
import { colors, fonts, headingStyle, labelStyle, numeric, radius, space, type, weight } from '../theme';
import { rowMarker } from '../ui/domMarkers';
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

/** "2026-01-15" → "Jan 15", matching the season strip's date voice. */
function formatUpcomingDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00Z`));
}

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

/**
 * One settlement night: date head with the night's net, then a row per entry —
 * surprise-led box line and a payout meter scaled against `meterScale`
 * (the largest absolute payout in whatever batch the caller is showing).
 */
function ActivityNightGroup({ night, playerById, playerTrends, boxScore = false }: {
  night: ActivityNight;
  playerById: Map<string, Player>;
  playerTrends: Record<string, TrendPoint[]>;
  /** The dedicated night log shows the raw box score; the strips do not. */
  boxScore?: boolean;
}) {
  return (
    <View>
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
                  {surpriseLabel(point, { boxScore })}
                </Text>
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
  );
}

/** Most recent entries the night log will render; keeps a full simulated
    season from producing an unmanageably long scroll. */
const NIGHT_LOG_ENTRY_LIMIT = 365;

/**
 * The dedicated game-log surface: every settled night, newest first, so the
 * boxscore-to-money correlation is readable as one continuous ledger. Reached
 * from the last-night strip or FULL GAME LOG; same drill-in as a player.
 */
function NightLogView({ activity, playerById, playerTrends, onClose }: {
  activity: ActivityEvent[];
  playerById: Map<string, Player>;
  playerTrends: Record<string, TrendPoint[]>;
  onClose: () => void;
}) {
  const settled = activity.filter((entry) => entry.date !== null);
  const truncated = settled.length > NIGHT_LOG_ENTRY_LIMIT;
  const nights = groupActivity(settled.slice(0, NIGHT_LOG_ENTRY_LIMIT));
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Pressable
        accessibilityLabel="Close the game log"
        accessibilityRole="button"
        onPress={onClose}
        style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]}
      >
        <Text style={styles.backText}>‹  Portfolio</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.sectionHeading}>Game log</Text>
      <Text style={styles.logIntro}>
        Every settled night, newest first. Beat the projection and the player pays you; miss it and he costs you.
      </Text>
      {nights.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.subtle}>Settle a night to start the ledger.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {nights.map((night) => (
            <ActivityNightGroup
              boxScore
              key={night.key}
              night={night}
              playerById={playerById}
              playerTrends={playerTrends}
            />
          ))}
          {truncated ? (
            <Text style={styles.logIntro}>Showing the most recent {NIGHT_LOG_ENTRY_LIMIT} entries.</Text>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

export function PortfolioScreen() {
  const { variant } = useDesignVariant();
  const {
    latestSettledDate,
    nextGameDate,
    nextGamePlayerIds,
    nextGameProjections,
    players,
    playerTrends,
    state,
    summary,
  } = usePortfolio();
  const [detailPlayerId, setDetailPlayerId] = useState<string | null>(null);
  const [nightLogOpen, setNightLogOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const { fontScale, width } = useWindowDimensions();
  // The sparkline is the first thing to go when horizontal space gets scarce:
  // a squeezed trace misleads more than no trace.
  const showRowTrends = width >= 420 && fontScale <= 1.3;

  if (!state || !summary) return null;

  const playerById = new Map(players.map((player) => [player.id, player]));
  const detailPlayer = detailPlayerId ? playerById.get(detailPlayerId) ?? null : null;
  const recentActivity = [...state.activity].reverse().slice(0, 10);
  // What each player has actually paid THIS account: dated ledger entries
  // only (settlement payouts), so a mid-season buy never claims payouts from
  // nights the account was not holding him.
  const receivedByPlayer = new Map<string, number>();
  for (const entry of state.activity) {
    if (entry.date === null) continue;
    receivedByPlayer.set(entry.playerId, (receivedByPlayer.get(entry.playerId) ?? 0) + entry.cashDelta);
  }

  // Anticipation from the public schedule, with the stakes attached: the
  // projection each of YOUR players must beat to pay you.
  const heldIds = new Set(state.holdings.map((holding) => holding.player_id));
  const upcomingStakes = nextGamePlayerIds
    .filter((id) => heldIds.has(id))
    .map((id) => {
      const surname = playerById.get(id)?.name.split(' ').at(-1);
      if (!surname) return null;
      const needs = nextGameProjections[id];
      return needs === undefined ? surname : `${surname} needs ${needs.toFixed(1)}`;
    })
    .filter((entry): entry is string => entry !== null);
  const upcomingLine = nextGameDate && upcomingStakes.length > 0
    ? `Next ${formatUpcomingDate(nextGameDate)}: ${upcomingStakes.slice(0, 2).join(' · ')}${upcomingStakes.length > 2 ? ` · +${upcomingStakes.length - 2} more` : ''} to pay you`
    : null;

  if (detailPlayer) {
    return (
      <PlayerDetail
        averageRate={marketAverageRate(
          players.map((entry) => selectSettledTrendPoints(playerTrends[entry.id] ?? [], latestSettledDate)),
        )}
        backLabel="Portfolio"
        currentPrice={state.prices[detailPlayer.id] ?? detailPlayer.listing_price}
        latestSettledDate={latestSettledDate}
        onClose={() => setDetailPlayerId(null)}
        player={detailPlayer}
        trendPoints={playerTrends[detailPlayer.id] ?? []}
      />
    );
  }

  if (nightLogOpen) {
    return (
      <NightLogView
        activity={[...state.activity].reverse()}
        onClose={() => setNightLogOpen(false)}
        playerById={playerById}
        playerTrends={playerTrends}
      />
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <PortfolioHistoryChart
        // The last-night strip outranks the chart: you open the app to learn
        // what the night did to your money, so it renders before the plot —
        // and the plot itself compresses on a phone to keep it above the fold.
        beforePlot={
          latestSettledDate ? (
            <SettlementSummary
              contributions={nightContributions(state.holdings, playerById, playerTrends, latestSettledDate)}
              onOpenLog={() => setNightLogOpen(true)}
              settledDate={latestSettledDate}
              upcoming={upcomingLine}
            />
          ) : null
        }
        earnings={latestSettledDate ? earningsWindows(state.activity, latestSettledDate) : null}
        freeCash={summary.freeCash}
        height={width < 900 ? Math.min(variant.chartHeight, 112) : variant.chartHeight}
        points={state.portfolioHistory}
        totalValue={summary.totalValue}
      />
      <View style={styles.rosterRegion}>
        <View style={styles.rosterHead}>
          <Text accessibilityRole="header" style={styles.sectionHeading}>
            Your players
          </Text>
          {state.holdings.length > 0 ? (
            <Text numberOfLines={1} style={styles.rosterMeta}>SEASON DIVIDENDS</Text>
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
          <View>
            {[...summary.holdings]
              .sort((a, b) => (receivedByPlayer.get(b.player_id) ?? 0) - (receivedByPlayer.get(a.player_id) ?? 0))
              .map((holding) => {
              const player = playerById.get(holding.player_id);
              if (!player) return null;
              const settled = selectSettledTrendPoints(playerTrends[player.id] ?? [], latestSettledDate);
              return (
                <HoldingRow
                  key={holding.player_id}
                  dividends={summarizeDividends(settled)}
                  holding={{
                    player,
                    currentPrice: holding.currentPrice,
                    costBasis: holding.costBasis,
                    unrealizedPnl: holding.unrealizedPnl,
                  }}
                  onPress={() => setDetailPlayerId(player.id)}
                  received={receivedByPlayer.get(holding.player_id) ?? 0}
                  trend={showRowTrends ? selectTrendRange(settled, 'L15') : undefined}
                />
              );
            })}
          </View>
        )}
      </View>
      {/* Progressive disclosure: the ledger waits behind its heading. */}
      <Pressable
        accessibilityLabel={activityOpen ? 'Collapse recent activity' : 'Expand recent activity'}
        accessibilityRole="button"
        accessibilityState={{ expanded: activityOpen }}
        onPress={() => setActivityOpen((current) => !current)}
        style={({ pressed }) => [styles.activityToggle, pressed && styles.backPressed]}
        {...rowMarker}
      >
        {/* The chevron rides the title, not the far edge, so the control
            reads as one object; the right side quietly says what opens. */}
        <View style={styles.activityTitleGroup}>
          <Text accessibilityRole="header" style={styles.sectionHeading}>Recent activity</Text>
          <Text style={styles.activityChevron}>{activityOpen ? '▾' : '▸'}</Text>
        </View>
        {activityOpen ? null : (
          <Text style={styles.activityHint}>
            {recentActivity.length === 0 ? '' : `LAST ${Math.min(recentActivity.length, 10)}`}
          </Text>
        )}
      </Pressable>
      {!activityOpen ? null : recentActivity.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.subtle}>Trades and settlements will appear here.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {groupActivity(recentActivity).map((night) => (
            <ActivityNightGroup
              key={night.key}
              night={night}
              playerById={playerById}
              playerTrends={playerTrends}
            />
          ))}
          <Pressable
            accessibilityLabel="Open the full game log"
            accessibilityRole="button"
            onPress={() => setNightLogOpen(true)}
            style={({ pressed }) => [styles.seeAll, pressed && styles.backPressed]}
            {...rowMarker}
          >
            <Text style={styles.seeAllText}>FULL GAME LOG  ›</Text>
          </Pressable>
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
  cashLine: {
    ...numeric,
    color: colors.faint,
    fontSize: type.body,
    fontWeight: weight.medium,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  cashLineStrong: { color: colors.text, fontWeight: weight.heavy },
  rosterRegion: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingBottom: space.xs,
  },
  activityToggle: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
    paddingRight: space.lg,
  },
  activityTitleGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
  },
  activityChevron: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.black,
  },
  activityHint: {
    ...labelStyle,
    color: colors.faint,
    flexShrink: 0,
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
// No bottom border: each holding row (and the empty state) brings its own
  // top rule, so the head would otherwise double it.
  rosterHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.xs,
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
  // The payout is the reason the row exists; it outranks the name.
  activityValue: {
    ...numeric,
    fontSize: type.title,
    fontWeight: weight.black,
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
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    marginTop: space.sm,
  },
  backPressed: {
    opacity: 0.65,
  },
  backText: {
    ...labelStyle,
    color: colors.goldInk,
    fontSize: type.body,
    letterSpacing: 0.6,
  },
  logIntro: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 19,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  seeAll: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  seeAllText: {
    ...labelStyle,
    color: colors.goldInk,
  },
});
