/**
 * The per-game player profile: "is he worth his price, game by game?"
 *
 * Every number compares what he paid on a night (his dividend) with what a
 * game of him cost that night (his price). The range (L5 / L15 / L30 /
 * Season) drives the verdict, the stat grid and the chart together, so the
 * three always describe the same games.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type {
  PerGameMarketPlayer,
  PerGamePosition,
  PerGameSettledResult,
} from '../api/contracts';
import { gamesCount, humanDate, money, perGame, signedMoney } from '../copy/terms';
import { playerValue } from '../data/perGameMetrics';
import {
  formVerdict,
  gameLog,
  holdingStatus,
  isRecentRange,
  lastSeasonFacts,
  nightsFromResults,
  nightsFromTrends,
  priceStory,
  RANGE_OPTIONS,
  rangeNights,
  summarizeNights,
  type ProfileMetric,
} from '../data/profileView';
import type { TrendPoint, TrendRange } from '../data/trendPresentation';
import { colors, control, fonts, radius, space, type, weight } from '../theme';
import { Button, Label, Money, SectionHeader, Segmented, Stat, Tag } from '../ui/kit';
import { CloseIcon, StarIcon } from './market/icons';
import { PlayerAvatar } from './PlayerAvatar';
import { ProfileChart } from './profile/ProfileChart';

const METRIC_OPTIONS: { key: ProfileMetric; label: string; hint: string }[] = [
  { key: 'dividends', label: 'Dividends', hint: 'What he paid each game, against his price' },
  { key: 'price', label: 'Price', hint: 'His price a game, game by game' },
];

/** Games the log shows before "Show all"; a list only a couple longer just shows in full. */
const LOG_PREVIEW = 10;
const LOG_SLACK = 2;

export interface PerGamePlayerProfileProps {
  player: PerGameMarketPlayer;
  position: PerGamePosition | null;
  results: PerGameSettledResult[];
  dividendRate: number;
  latestSettledDate: string | null;
  /** Practice mode's league-wide nightly history; otherwise this account's settled nights are used. */
  trends?: TrendPoint[];
  watching: boolean;
  onToggleWatch: () => void;
  onClose: () => void;
  /** Desktop width: roomier chart and a single controls row. */
  wide?: boolean;
}

export function PerGamePlayerProfile({
  player,
  position,
  results,
  dividendRate,
  latestSettledDate,
  trends,
  watching,
  onToggleWatch,
  onClose,
  wide = false,
}: PerGamePlayerProfileProps) {
  const [range, setRange] = useState<TrendRange>('L15');
  const [metric, setMetric] = useState<ProfileMetric>('dividends');
  const [showAllGames, setShowAllGames] = useState(false);
  // A zoomed browser (200% on a phone) leaves under 240px: trim the side
  // gutters so four range tabs still get 44px each.
  const { width: windowWidth } = useWindowDimensions();
  const inset = !wide && windowWidth < 240 ? styles.insetTight : null;

  const nights = useMemo(
    () => (trends && trends.length > 0
      ? nightsFromTrends(trends, dividendRate, latestSettledDate)
      : nightsFromResults(results, latestSettledDate)),
    [dividendRate, latestSettledDate, results, trends],
  );
  const shown = useMemo(() => rangeNights(nights, range), [nights, range]);
  const summary = useMemo(() => summarizeNights(shown), [shown]);
  const recent = isRecentRange(range, shown.length, nights.length);
  const status = holdingStatus(position);
  const lastSeason = lastSeasonFacts(player, position?.side ?? 'long');
  const mine = useMemo(() => playerValue(results, player.playerId), [player.playerId, results]);
  const hasOwnGames = mine.games + mine.dnp + mine.pending > 0;
  const logCapped = nights.length > LOG_PREVIEW + LOG_SLACK;
  const log = gameLog(nights, showAllGames || !logCapped ? undefined : LOG_PREVIEW);

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="Close player profile"
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <CloseIcon size={18} />
        </Pressable>
        <Pressable
          accessibilityLabel={watching ? `Stop watching ${player.name}` : `Watch ${player.name}`}
          accessibilityRole="button"
          onPress={onToggleWatch}
          style={({ pressed }) => [styles.watch, watching && styles.watchOn, pressed && styles.pressed]}
        >
          <StarIcon filled={watching} />
          <Text maxFontSizeMultiplier={1.3} style={[styles.watchText, watching && styles.watchTextOn]}>
            {watching ? 'Watching' : 'Watch'}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} style={styles.scroll}>
        <View style={[styles.identity, inset]}>
          <PlayerAvatar player={{ id: player.playerId, name: player.name }} size={56} />
          <View style={styles.identityCopy}>
            <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={styles.name}>{player.name}</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.meta}>
              <Text style={styles.tier}>{player.tier.toUpperCase()}</Text>
              {'   '}
              <Text style={styles.priceNow}>{perGame(player.currentGameCost)}</Text>
            </Text>
          </View>
        </View>
        <View style={[styles.status, inset]}>
          {status.tag ? <Tag tone="gold">{status.tag}</Tag> : null}
          <Text maxFontSizeMultiplier={1.4} style={styles.statusText}>{status.text}</Text>
        </View>

        <SectionHeader
          meta={nights.length > 0 ? gamesCount(nights.length) : undefined}
          style={[styles.sectionHeader, inset]}
          title="Game by game"
        />
        <View style={[styles.section, inset]}>
          {nights.length > 0 ? (
            <>
              <Segmented
                accessibilityLabel="Games shown"
                onChange={setRange}
                options={RANGE_OPTIONS}
                style={wide ? styles.rangeWide : undefined}
                value={range}
              />
              <Text maxFontSizeMultiplier={1.4} style={styles.verdict}>{formVerdict(summary, recent)}</Text>
              <View style={styles.grid}>
                <Stat
                  caption="his dividend"
                  label="Paid a game"
                  style={styles.cell}
                  value={<Money signed={false} size="title" value={summary.avgPaid ?? 0} />}
                />
                <Stat
                  caption={`now ${money(player.currentGameCost)}`}
                  label="Price a game"
                  style={styles.cell}
                  value={<Money signed={false} size="title" value={summary.avgPrice ?? 0} />}
                />
                <Stat
                  caption="one roster spot"
                  label="Net a game"
                  style={styles.cell}
                  value={<Money size="title" value={summary.avgNet ?? 0} />}
                />
                <Stat
                  caption={summary.games - summary.beat === 0 ? 'every game' : `${gamesCount(summary.games - summary.beat)} short`}
                  label="Beat his price"
                  style={styles.cell}
                  value={(
                    <Text maxFontSizeMultiplier={1.4} style={styles.statText}>
                      {`${summary.beat} of ${summary.games}`}
                    </Text>
                  )}
                />
                <Stat
                  caption={summary.best ? `${humanDate(summary.best.date)} · paid ${money(summary.best.dividend)}` : undefined}
                  label="Best game"
                  style={styles.cell}
                  value={<Money value={summary.best?.net ?? 0} />}
                />
                <Stat
                  caption={summary.worst ? `${humanDate(summary.worst.date)} · paid ${money(summary.worst.dividend)}` : undefined}
                  label="Worst game"
                  style={styles.cell}
                  value={<Money value={summary.worst?.net ?? 0} />}
                />
              </View>
              <Segmented
                accessibilityLabel="Chart shows"
                onChange={setMetric}
                options={METRIC_OPTIONS}
                style={[styles.metric, wide && styles.metricWide]}
                value={metric}
              />
              {metric === 'price' ? (
                <Text maxFontSizeMultiplier={1.4} style={styles.note}>{priceStory(shown)}</Text>
              ) : null}
              <ProfileChart height={wide ? 200 : 176} metric={metric} nights={shown} />
            </>
          ) : (
            <Text maxFontSizeMultiplier={1.4} style={styles.verdict}>
              No games yet this season. His game-by-game numbers start after his first game.
            </Text>
          )}
        </View>

        <SectionHeader style={[styles.sectionHeader, inset]} title="Last season" />
        <View style={[styles.section, inset]}>
          {lastSeason.worth === null || lastSeason.edge === null ? (
            <Text maxFontSizeMultiplier={1.4} style={styles.note}>No last season on record for him.</Text>
          ) : (
            <View style={styles.grid}>
              <Stat
                caption="his dividend a game"
                label="Worth a game"
                style={styles.cellHalf}
                value={<Money signed={false} size="title" value={lastSeason.worth} />}
              />
              <Stat
                caption={lastSeason.edgeCaption}
                label="At today's price"
                style={styles.cellHalf}
                value={<Money size="title" value={lastSeason.edge} />}
              />
            </View>
          )}
        </View>

        {hasOwnGames ? (
          <>
            <SectionHeader style={[styles.sectionHeader, inset]} title="Your games with him" />
            <View style={[styles.section, inset]}>
              {mine.games > 0 && mine.avgNet !== null ? (
                <View style={styles.grid}>
                  <Stat
                    caption={`won ${mine.wins}`}
                    label="Games"
                    style={styles.cell}
                    value={<Text maxFontSizeMultiplier={1.4} style={styles.statText}>{mine.games}</Text>}
                  />
                  <Stat label="Net a game" style={styles.cell} value={<Money value={mine.avgNet} />} />
                  <Stat label="Total" style={styles.cell} value={<Money value={mine.total} />} />
                </View>
              ) : (
                <Text maxFontSizeMultiplier={1.4} style={styles.note}>No settled games with him yet.</Text>
              )}
              {mine.dnp > 0 || mine.pending > 0 ? (
                <Text maxFontSizeMultiplier={1.4} style={styles.note}>
                  {[
                    mine.dnp > 0 ? `${mine.dnp} ${mine.dnp === 1 ? 'night' : 'nights'} he did not play (nothing charged)` : '',
                    mine.pending > 0 ? `${gamesCount(mine.pending)} waiting to settle` : '',
                  ].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
          </>
        ) : null}

        {nights.length > 0 ? (
          <>
            <SectionHeader style={[styles.sectionHeader, inset]} title="Game log" />
            <View style={[styles.log, inset]}>
              <View style={styles.logRow}>
                <Label style={styles.logDate}>Game</Label>
                <Label style={styles.logNumber}>Paid</Label>
                <Label style={styles.logNumber}>Price</Label>
                <Label style={styles.logNumber}>Net</Label>
              </View>
              {log.map((night) => (
                <View
                  accessibilityLabel={`${humanDate(night.date)}: paid ${money(night.dividend)}, price ${money(night.price)}, net ${signedMoney(night.net)}`}
                  accessible
                  key={night.date}
                  style={[styles.logRow, styles.logRowRule]}
                >
                  <Text maxFontSizeMultiplier={1.4} style={[styles.logCell, styles.logDate]}>{humanDate(night.date)}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.logCell, styles.logNumber]}>{money(night.dividend)}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.logCell, styles.logNumber, styles.logQuiet]}>{money(night.price)}</Text>
                  <Money size="body" style={styles.logNumber} value={night.net} />
                </View>
              ))}
              {logCapped ? (
                <Button
                  label={showAllGames ? `Show latest ${LOG_PREVIEW}` : `Show all ${gamesCount(nights.length)}`}
                  onPress={() => setShowAllGames((current) => !current)}
                  style={styles.logMore}
                  variant="quiet"
                />
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  iconButton: {
    width: control.icon,
    height: control.icon,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  watch: {
    minHeight: control.height,
    minWidth: control.height,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
  },
  watchOn: {
    borderColor: colors.goldLine,
    backgroundColor: colors.goldSoft,
  },
  watchText: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  watchTextOn: {
    color: colors.goldInk,
  },
  scroll: {
    flex: 1,
  },
  body: {
    paddingBottom: space.xxl,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: weight.heavy,
    letterSpacing: -0.3,
  },
  meta: {
    marginTop: 3,
    color: colors.muted,
  },
  tier: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
    letterSpacing: 1.1,
  },
  priceNow: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  status: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  statusText: {
    color: colors.muted,
    fontSize: type.body,
    fontVariant: ['tabular-nums'],
  },
  sectionHeader: {
    marginTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  section: {
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  rangeWide: {
    maxWidth: 360,
  },
  verdict: {
    color: colors.text,
    fontSize: type.value,
    lineHeight: 22,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: space.md,
  },
  // Three across on a phone; narrower screens reflow to two or one rather
  // than break a number across lines.
  cell: {
    width: '33.333%',
    minWidth: 104,
    flexGrow: 1,
    paddingRight: space.sm,
  },
  cellHalf: {
    width: '50%',
    minWidth: 140,
    flexGrow: 1,
    paddingRight: space.sm,
  },
  insetTight: {
    // 6px leaves each of the four range tabs 44px inside a 195px sheet.
    paddingHorizontal: 6,
  },
  statText: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  metric: {
    marginTop: space.xs,
  },
  metricWide: {
    maxWidth: 280,
  },
  note: {
    color: colors.muted,
    fontSize: type.body,
    lineHeight: 19,
  },
  log: {
    paddingHorizontal: space.lg,
  },
  logRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  logRowRule: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  logCell: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  logDate: {
    flex: 1.1,
    minWidth: 0,
  },
  logNumber: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
  },
  logQuiet: {
    color: colors.muted,
  },
  logMore: {
    alignSelf: 'flex-start',
    marginTop: space.xs,
    paddingHorizontal: 0,
  },
  pressed: {
    opacity: 0.72,
  },
});
