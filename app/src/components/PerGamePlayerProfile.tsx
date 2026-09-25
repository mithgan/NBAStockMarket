/**
 * The per-game player profile: "is he worth his price, game by game?"
 *
 * Every number compares his dividend on a night with what a game of him cost
 * that night, from the side you look from: your roster (dividend minus price)
 * or your short (credit minus dividend). Nights you held him are your settled
 * results at your locked price, so they match Roster and Results; other nights
 * are his market price and say so. The range (L5 / L15 / L30 / Season) drives
 * the verdict, the stat grid and the chart together, so the three always
 * describe the same games, and the sheet has one "net a game".
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type {
  PerGameMarketPlayer,
  PerGamePosition,
  PerGamePositionSide,
  PerGameSettledResult,
} from '../api/contracts';
import { gamesCount, humanDate, money, perGame, signedMoney, unbrokenName } from '../copy/terms';
import { playerValue, positionValue } from '../data/perGameMetrics';
import { splitPlayerName } from '../data/playerName';
import {
  buildProfileNights,
  formVerdict,
  gameLog,
  holdingStatus,
  isRecentRange,
  lastSeasonFacts,
  logPriceHeader,
  priceSourceCaption,
  priceStory,
  RANGE_OPTIONS,
  rangeNights,
  sideWords,
  stakeLine,
  summarizeNights,
  type ProfileMetric,
  type StakeTone,
} from '../data/profileView';
import type { TrendPoint, TrendRange } from '../data/trendPresentation';
import { colors, control, fonts, radius, space, type, weight } from '../theme';
import { Button, headingLevel, Label, Money, SectionHeader, Segmented, Tag } from '../ui/kit';
import { CloseIcon, StarIcon } from './market/icons';
import { PlayerAvatar } from './PlayerAvatar';
import { ProfileChart } from './profile/ProfileChart';

const METRIC_OPTIONS: { key: ProfileMetric; label: string; hint: string }[] = [
  { key: 'dividends', label: 'Dividends', hint: 'His dividend each game, against his price' },
  { key: 'price', label: 'Price', hint: 'His price a game, game by game' },
];

/** Games the log shows before "Show all"; a list only a couple longer just shows in full. */
const LOG_PREVIEW = 10;
const LOG_SLACK = 2;

/** Once the name block has scrolled away, the top bar shows who this is. */
const TITLE_AFTER_SCROLL = 72;

const TONE_COLOR: Record<StakeTone, string> = {
  gain: colors.green,
  loss: colors.red,
  even: colors.muted,
  none: colors.muted,
};

/**
 * One figure in the profile's grid: label, value, caption. The kit's Stat, with
 * tighter label tracking so "Dividend a game" fits a third of a phone.
 */
function Figure({ label, value, caption, style }: {
  label: string;
  value: ReactNode;
  caption?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.figure, style]}>
      <Label style={styles.figureLabel}>{label}</Label>
      <View style={styles.figureValue}>{value}</View>
      {caption ? <Text maxFontSizeMultiplier={1.4} style={styles.figureCaption}>{caption}</Text> : null}
    </View>
  );
}

export interface PerGamePlayerProfileProps {
  player: PerGameMarketPlayer;
  position: PerGamePosition | null;
  results: PerGameSettledResult[];
  dividendRate: number;
  latestSettledDate: string | null;
  /** Practice mode's league-wide nightly history; undefined outside practice. */
  trends?: TrendPoint[];
  /**
   * The side to read from when you do not hold him: the market tab he was
   * opened from. A held player always reads from the side you hold him on.
   */
  side?: PerGamePositionSide;
  watching: boolean;
  onToggleWatch: () => void;
  onClose: () => void;
  /** Desktop panel: roomier chart and wider controls. */
  wide?: boolean;
}

export function PerGamePlayerProfile({
  player,
  position,
  results,
  dividendRate,
  latestSettledDate,
  trends,
  side,
  watching,
  onToggleWatch,
  onClose,
  wide = false,
}: PerGamePlayerProfileProps) {
  const [range, setRange] = useState<TrendRange>('L15');
  const [metric, setMetric] = useState<ProfileMetric>('dividends');
  const [showAllGames, setShowAllGames] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { width: windowWidth } = useWindowDimensions();
  // A zoomed browser (200% on a phone) leaves under 240px: trim the side
  // gutters so four range tabs still get 44px each, and shrink Watch to its star.
  const inset = !wide && windowWidth < 240 ? styles.insetTight : null;
  const narrow = !wide && windowWidth < 300;

  const viewSide: PerGamePositionSide = position?.side ?? side ?? 'long';
  const held = position !== null;
  const live = trends === undefined;
  const words = sideWords(viewSide);

  const nights = useMemo(
    () => buildProfileNights({ results, trends, dividendRate, latestSettledDate, side: viewSide }),
    [dividendRate, latestSettledDate, results, trends, viewSide],
  );
  const shown = useMemo(() => rangeNights(nights, range), [nights, range]);
  const summary = useMemo(() => summarizeNights(shown), [shown]);
  const recent = isRecentRange(range, shown.length, nights.length);
  const status = holdingStatus(position);
  // Your money with him: the current position when you hold him (the same
  // numbers as its Roster row), otherwise every stint you had.
  const stake = useMemo(
    () => stakeLine(
      position ? positionValue(results, position.positionId) : playerValue(results, player.playerId),
      held,
    ),
    [held, player.playerId, position, results],
  );
  const lastSeason = lastSeasonFacts(player, viewSide);
  const logCapped = nights.length > LOG_PREVIEW + LOG_SLACK;
  const log = gameLog(nights, showAllGames || !logCapped ? undefined : LOG_PREVIEW);
  const priceHeader = logPriceHeader(nights, viewSide);
  const mixedLog = priceHeader === 'Price' || priceHeader === 'Credit';
  const title = narrow ? splitPlayerName(player.name).surname : player.name;

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = event.nativeEvent.contentOffset.y > TITLE_AFTER_SCROLL;
    if (next !== scrolled) setScrolled(next);
  };

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
        <View style={styles.titleSlot}>
          {scrolled ? (
            <Text accessibilityElementsHidden importantForAccessibility="no" maxFontSizeMultiplier={1.3} style={styles.title}>
              {title}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel={watching ? `Stop watching ${player.name}` : `Watch ${player.name}`}
          accessibilityRole="button"
          onPress={onToggleWatch}
          style={({ pressed }) => [styles.watch, narrow && styles.watchIcon, watching && styles.watchOn, pressed && styles.pressed]}
        >
          <StarIcon filled={watching} />
          {narrow ? null : (
            <Text maxFontSizeMultiplier={1.3} style={[styles.watchText, watching && styles.watchTextOn]}>
              {watching ? 'Watching' : 'Watch'}
            </Text>
          )}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} onScroll={onScroll} scrollEventThrottle={32} style={styles.scroll}>
        <View style={[styles.identity, inset]}>
          <PlayerAvatar player={{ id: player.playerId, name: player.name }} size={56} />
          <View style={styles.identityCopy}>
            <Text accessibilityRole="header" {...headingLevel(2)} maxFontSizeMultiplier={1.4} style={styles.name}>
              {windowWidth >= 320 ? unbrokenName(player.name) : player.name}
            </Text>
            <View style={styles.metaLine}>
              {player.tier ? <Text maxFontSizeMultiplier={1.4} style={styles.tier}>{player.tier.toUpperCase()}</Text> : null}
              <Text maxFontSizeMultiplier={1.4} style={styles.priceNow}>{perGame(player.currentGameCost)}</Text>
            </View>
          </View>
        </View>
        <View style={[styles.status, inset]}>
          <View style={styles.statusLine}>
            {status.tag ? <Tag>{status.tag}</Tag> : null}
            <Text maxFontSizeMultiplier={1.4} style={styles.statusText}>{status.text}</Text>
          </View>
          {stake ? (
            <View style={styles.statusLine}>
              <Text maxFontSizeMultiplier={1.4} style={styles.stakeLead}>{stake.lead}</Text>
              {stake.total ? (
                <Text maxFontSizeMultiplier={1.4} style={[styles.stakeTotal, { color: TONE_COLOR[stake.tone] }]}>
                  {stake.total}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        <SectionHeader
          level={3}
          right={nights.length > 0 ? <Text style={styles.sectionCount}>{gamesCount(nights.length)}</Text> : undefined}
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
              <Text maxFontSizeMultiplier={1.4} style={styles.verdict}>
                {formVerdict(summary, { recent, side: viewSide, held, scope: live ? 'yours' : 'season' })}
              </Text>
              <View style={styles.grid}>
                <Figure
                  label="Dividend a game"
                  style={styles.cell}
                  value={<Money signed={false} size="title" value={summary.avgDividend ?? 0} />}
                />
                <Figure
                  caption={priceSourceCaption(summary, viewSide)}
                  label={words.price}
                  style={styles.cell}
                  value={<Money signed={false} size="title" value={summary.avgPrice ?? 0} />}
                />
                <Figure
                  caption={words.netCaption}
                  label="Net a game"
                  style={styles.cell}
                  value={<Money size="title" value={summary.avgNet ?? 0} />}
                />
                <Figure
                  caption={words.missedCaption(summary.games - summary.beat)}
                  label={words.beat}
                  style={styles.cell}
                  value={(
                    <Text maxFontSizeMultiplier={1.4} style={styles.statText}>
                      {`${summary.beat} of ${summary.games}`}
                    </Text>
                  )}
                />
                <Figure
                  caption={summary.best ? `${humanDate(summary.best.date)}\ndividend ${money(summary.best.dividend)}` : undefined}
                  label="Best game"
                  style={styles.cell}
                  value={<Money value={summary.best?.net ?? 0} />}
                />
                <Figure
                  caption={summary.worst ? `${humanDate(summary.worst.date)}\ndividend ${money(summary.worst.dividend)}` : undefined}
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
                <Text maxFontSizeMultiplier={1.4} style={styles.note}>{priceStory(shown, viewSide)}</Text>
              ) : null}
              <ProfileChart height={wide ? 200 : 176} metric={metric} nights={shown} side={viewSide} />
            </>
          ) : (
            <Text maxFontSizeMultiplier={1.4} style={styles.verdict}>
              {live
                ? 'No games with you yet. Once he plays for your roster or a short, every game shows here.'
                : 'No games yet this season. His game-by-game numbers start after his first game.'}
            </Text>
          )}
        </View>

        <SectionHeader level={3} style={[styles.sectionHeader, inset]} title="Last season" />
        <View style={[styles.section, inset]}>
          {lastSeason.worth === null || lastSeason.edge === null ? (
            <Text maxFontSizeMultiplier={1.4} style={styles.note}>No last season on record for him.</Text>
          ) : (
            <View style={styles.grid}>
              <Figure
                caption="his dividend a game"
                label="Worth a game"
                style={styles.cellHalf}
                value={<Money signed={false} size="title" value={lastSeason.worth} />}
              />
              <Figure
                caption={lastSeason.edgeCaption}
                label="Edge at today's price"
                style={styles.cellHalf}
                value={<Money size="title" value={lastSeason.edge} />}
              />
            </View>
          )}
        </View>

        {nights.length > 0 ? (
          <>
            <SectionHeader
              caption="The same games as the chart, newest first."
              level={3}
              style={[styles.sectionHeader, inset]}
              title="Game log"
            />
            <View style={[styles.log, inset]}>
              <View style={styles.logRow}>
                <Label style={styles.logDate}>Game</Label>
                <Label style={styles.logNumber}>Dividend</Label>
                <Label style={styles.logNumber}>{priceHeader}</Label>
                <Label style={styles.logNumber}>Net</Label>
              </View>
              {log.map((night) => {
                const market = night.source === 'market';
                return (
                  <View
                    accessibilityLabel={`${humanDate(night.date)}: dividend ${money(night.dividend)}, ${words.priceShort} ${money(night.price)}${market ? ' at his market price' : ''}, net ${signedMoney(night.net)}`}
                    accessible
                    key={night.date}
                    style={[styles.logRow, styles.logRowRule]}
                  >
                    <View style={styles.logDate}>
                      <Text maxFontSizeMultiplier={1.4} style={styles.logCell}>{humanDate(night.date)}</Text>
                      {mixedLog && market ? <Text maxFontSizeMultiplier={1.4} style={styles.logSource}>market price</Text> : null}
                    </View>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.logCell, styles.logNumber]}>{money(night.dividend)}</Text>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.logCell, styles.logNumber, styles.logQuiet]}>{money(night.price)}</Text>
                    <Money size="body" style={styles.logNumber} value={night.net} />
                  </View>
                );
              })}
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
  titleSlot: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  title: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    textAlign: 'center',
  },
  watch: {
    minHeight: control.height,
    minWidth: control.height,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
  },
  watchIcon: {
    width: control.height,
    paddingHorizontal: 0,
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
  metaLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.md,
    rowGap: 2,
    marginTop: 3,
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
    gap: space.xs,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  statusLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.sm,
    rowGap: space.xs,
  },
  statusText: {
    color: colors.muted,
    fontSize: type.body,
    fontVariant: ['tabular-nums'],
  },
  stakeLead: {
    color: colors.muted,
    fontSize: type.body,
    fontVariant: ['tabular-nums'],
  },
  stakeTotal: {
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  sectionHeader: {
    marginTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sectionCount: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontVariant: ['tabular-nums'],
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
  figure: {
    minWidth: 0,
  },
  figureLabel: {
    letterSpacing: 0.5,
  },
  figureValue: {
    marginTop: 3,
  },
  figureCaption: {
    marginTop: 2,
    color: colors.faint,
    fontSize: type.label,
    lineHeight: 15,
    fontVariant: ['tabular-nums'],
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
  logSource: {
    color: colors.faint,
    fontSize: type.label,
  },
  logDate: {
    flex: 1.1,
    minWidth: 0,
    paddingVertical: space.xs,
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
