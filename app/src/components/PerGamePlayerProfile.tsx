/**
 * The per-game player profile: "is he worth his price, game by game?"
 *
 * Every number compares his dividend on a night with what a game of him cost
 * that night, from the side you look from: your roster (dividend minus price)
 * or your short (credit minus dividend). Nights you held him are your settled
 * results at your locked price, so they match Roster and Results; other nights
 * are his market price and say so. The range (With you / Last 5 / Last 15 / Last 30 / Season) drives
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
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type {
  PerGameMarketPlayer,
  PerGamePosition,
  PerGamePositionSide,
  PerGameSettledResult,
} from '../api/contracts';
import {
  exactMoney,
  exactSignedMoney,
  gamesCount,
  humanDate,
  moneyFine,
  perGame,
  signedMoneyFine,
  unbrokenName,
} from '../copy/terms';
import { currentResults, playerValue, positionValue } from '../data/perGameMetrics';
import { splitPlayerName } from '../data/playerName';
import {
  buildProfileNights,
  formVerdict,
  holdingStatus,
  defaultRange,
  isRecentRange,
  lastSeasonFacts,
  logPriceHeader,
  logCaption,
  logRows,
  logStatusNights,
  mixNote,
  pastStintLead,
  positionOpenedDay,
  priceSourceCaption,
  priceStory,
  rangeNights,
  rangeOptions,
  sideWords,
  stakeLine,
  statusNights,
  summarizeNights,
  unsettledNote,
  type ProfileMetric,
  type ProfileRange,
  type StakeTone,
} from '../data/profileView';
import type { TrendPoint } from '../data/trendPresentation';
import { usePerGame } from '../state/PerGameContext';
import { colors, control, fonts, radius, space, type, weight } from '../theme';
import { Button, headingLevel, Label, Money, moneyColor, SectionHeader, Segmented, Tag } from '../ui/kit';
import { CloseIcon, StarIcon } from './market/icons';
import { PlayerAvatar } from './PlayerAvatar';
import { ProfileActionBar } from './profile/ProfileActionBar';
import { ProfileChart } from './profile/ProfileChart';
import { ProfileGameLog } from './profile/ProfileGameLog';

const METRIC_OPTIONS: { key: ProfileMetric; label: string; hint: string }[] = [
  { key: 'dividends', label: 'Dividends', hint: 'His dividend each game, against his price' },
  { key: 'price', label: 'Price', hint: 'His price a game, game by game' },
];

/** Games the log shows before "Show all"; a list only a couple longer just shows in full. */
const LOG_PREVIEW = 10;
const LOG_SLACK = 2;

/** Below this window height the action bar scrolls away with his name. */
const PIN_BAR_MIN_HEIGHT = 500;

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

/**
 * Money at the Roster's precision ("$112.5K", "+$1.63M"), so a figure reads
 * the same on the profile as on the row it came from. Signed amounts are
 * coloured gain or loss; the screen-reader label is the exact amount.
 */
function FineMoney({ value, signed = true, size = type.value, style }: {
  value: number;
  signed?: boolean;
  size?: number;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      accessibilityLabel={signed ? exactSignedMoney(value) : exactMoney(value)}
      maxFontSizeMultiplier={1.4}
      style={[styles.fineMoney, { fontSize: size, color: signed ? moneyColor(value) : colors.text }, style]}
    >
      {signed ? signedMoneyFine(value) : moneyFine(value)}
    </Text>
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
  // The range you picked; until then, the default for his games (see defaultRange).
  const [picked, setPicked] = useState<ProfileRange | null>(null);
  const [metric, setMetric] = useState<ProfileMetric>('dividends');
  const [showAllGames, setShowAllGames] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // A short window (a phone at 200% zoom, a phone on its side) keeps the
  // action bar with his name instead of pinning it: pinned under the top bar
  // it would leave the chart and log about half the screen.
  const pinBar = windowHeight >= PIN_BAR_MIN_HEIGHT;
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
  const yourNights = useMemo(() => nights.filter((night) => night.source === 'yours').length, [nights]);
  const ranges = rangeOptions({ total: nights.length, yours: yourNights, room: wide ? 'wide' : windowWidth < 240 ? 'narrow' : 'phone' });
  const range = picked && ranges.some((option) => option.key === picked) ? picked : defaultRange(ranges, held);
  const shown = useMemo(() => rangeNights(nights, range), [nights, range]);
  const summary = useMemo(() => summarizeNights(shown), [shown]);
  const recent = isRecentRange(range, shown.length, nights.length);
  const status = holdingStatus(position);
  // Your money with him: the current position when you hold him (the same
  // numbers as its Roster row), otherwise every stint you had.
  const stakeSummary = useMemo(
    () => (position ? positionValue(results, position.positionId) : playerValue(results, player.playerId)),
    [player.playerId, position, results],
  );
  // No games yet: say since when ("No games since you added him (Oct 20)");
  // "at this price" only when he already played for you at another price.
  const { bootstrap } = usePerGame();
  const ledger = bootstrap?.ledger.items;
  const opened = useMemo(() => (position ? {
    since: positionOpenedDay(ledger ?? [], position.positionId),
    readd: results.some((row) => row.playerId === player.playerId && row.side === position.side
      && row.positionId !== position.positionId && row.status === 'settled'),
  } : {
    // Not held: name the side and dates of your past games with him.
    past: pastStintLead(currentResults(results).filter((row) => row.playerId === player.playerId)),
  }), [ledger, player.playerId, position, results]);
  const stake = stakeLine(stakeSummary, held, viewSide, opened);
  // Nights with no money to show: he did not play, or the game has not settled.
  const quietNote = unsettledNote(stakeSummary);
  const quiet = useMemo(() => statusNights(results, viewSide), [results, viewSide]);
  const mix = mixNote(shown, viewSide);
  const lastSeason = lastSeasonFacts(player, viewSide);
  // The log lists the range's games (the chart's games), plus your no-money nights in that window.
  const logQuiet = logStatusNights(quiet, range, shown);
  const logTotal = shown.length + logQuiet.length;
  const logCapped = logTotal > LOG_PREVIEW + LOG_SLACK;
  const log = logRows(shown, logQuiet, showAllGames || !logCapped ? undefined : LOG_PREVIEW);
  const priceHeader = logPriceHeader(shown, viewSide);
  const mixedLog = priceHeader === 'Price' || priceHeader === 'Credit';
  const title = narrow ? splitPlayerName(player.name).surname : player.name;

  // Space toggles a switch (the WAI-ARIA pattern screen readers teach), but
  // react-native-web only presses buttons on Space; without this the sheet
  // scrolls a screen instead. Enter already presses it. A held key toggles once.
  const onWatchKey = (event: { key: string; repeat?: boolean; preventDefault: () => void }) => {
    if (event.key !== ' ' && event.key !== 'Spacebar') return;
    event.preventDefault();
    if (!event.repeat) onToggleWatch();
  };

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
        {/* A switch, like the Market's star: one name ("Watch Nikola Jokic"),
            its state on or off (the star fills, the chip turns gold), and Space
            or Enter toggles it. The visible word stays "Watch" so the spoken
            name always contains it. */}
        <Pressable
          accessibilityLabel={`Watch ${player.name}`}
          accessibilityRole="switch"
          accessibilityState={{ checked: watching }}
          aria-checked={watching}
          onPress={onToggleWatch}
          style={({ pressed }) => [styles.watch, narrow && styles.watchIcon, watching && styles.watchOn, pressed && styles.pressed]}
          {...({ onKeyDown: onWatchKey } as object)}
        >
          <StarIcon filled={watching} />
          {narrow ? null : (
            <Text maxFontSizeMultiplier={1.3} style={[styles.watchText, watching && styles.watchTextOn]}>
              Watch
            </Text>
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        onScroll={onScroll}
        scrollEventThrottle={32}
        // The action bar (child 1) sits under his name and your status, then
        // stays pinned to the top while the rest of the profile scrolls
        // (in a tall enough window; see pinBar).
        stickyHeaderIndices={pinBar ? [1] : undefined}
        style={styles.scroll}
      >
        <View>
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
          {/* Your result with him leads ("Your short: -$699.2K over 3 games"),
              then what you hold and at what price. */}
          {stake && held ? (
            <View style={styles.statusLine}>
              <Text maxFontSizeMultiplier={1.4} style={styles.stakeHeadLead}>{stake.lead}</Text>
              {stake.total ? (
                <Text maxFontSizeMultiplier={1.4} style={[styles.stakeHeadTotal, { color: TONE_COLOR[stake.tone] }]}>
                  {stake.total}
                </Text>
              ) : null}
            </View>
          ) : null}
          <View style={styles.statusLine}>
            {status.tag ? <Tag>{status.tag}</Tag> : null}
            <Text maxFontSizeMultiplier={1.4} style={styles.statusText}>{status.text}</Text>
          </View>
          {stake && !held ? (
            <View style={styles.statusLine}>
              <Text maxFontSizeMultiplier={1.4} style={styles.stakeLead}>{stake.lead}</Text>
              {stake.total ? (
                <Text maxFontSizeMultiplier={1.4} style={[styles.stakeTotal, { color: TONE_COLOR[stake.tone] }]}>
                  {stake.total}
                </Text>
              ) : null}
            </View>
          ) : null}
          {quietNote ? <Text maxFontSizeMultiplier={1.4} style={styles.stakeLead}>{quietNote}</Text> : null}
        </View>
        </View>
        <ProfileActionBar onLeave={onClose} player={player} position={position} side={viewSide} />

        <SectionHeader
          level={3}
          right={nights.length > 0 ? <Text style={styles.sectionCount}>{gamesCount(nights.length)}</Text> : undefined}
          style={[styles.sectionHeader, inset]}
          title="Game by game"
        />
        <View style={[styles.section, inset]}>
          {nights.length > 0 ? (
            <>
              {/* One choice is no choice: with a handful of games the tabs go. */}
              {ranges.length > 1 ? (
                <Segmented
                  accessibilityLabel="Games shown"
                  onChange={setPicked}
                  options={ranges}
                  style={wide ? styles.rangeWide : undefined}
                  value={range}
                />
              ) : null}
              {/* Spoken politely when a range tab changes it, not only the
                  tab's name (walk-2 T3-N5). */}
              <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.4} style={styles.verdict}>
                {formVerdict(summary, {
                  recent,
                  side: viewSide,
                  // "for your short" only when every game shown was yours.
                  held: held && summary.yours === summary.games,
                  scope: live || range === 'Yours' ? 'yours' : 'season',
                })}
              </Text>
              {mix ? <Text maxFontSizeMultiplier={1.4} style={styles.note}>{mix}</Text> : null}
              {/* The first three figures are averages over the games shown, so
                  his average price never reads as his price now. One-word
                  labels keep the three values on one line at 360px. */}
              <Text maxFontSizeMultiplier={1.4} style={styles.gridCaption}>Average a game</Text>
              <View style={[styles.grid, styles.gridTight]}>
                <Figure
                  label="Dividend"
                  style={styles.cell}
                  value={<FineMoney signed={false} size={type.title} value={summary.avgDividend ?? 0} />}
                />
                <Figure
                  caption={priceSourceCaption(summary, viewSide)}
                  label={words.price}
                  style={styles.cell}
                  value={<FineMoney signed={false} size={type.title} value={summary.avgPrice ?? 0} />}
                />
                <Figure
                  caption={words.netCaption}
                  label="Profit"
                  style={styles.cell}
                  value={<FineMoney size={type.title} value={summary.avgNet ?? 0} />}
                />
              </View>
              <View style={styles.grid}>
                <Figure
                  caption={words.missedCaption(summary.games - summary.beat)}
                  label={words.beat}
                  style={styles.cell}
                  value={(
                    <Text maxFontSizeMultiplier={1.4} style={styles.statText}>
                      {`${summary.beat} of ${gamesCount(summary.games)}`}
                    </Text>
                  )}
                />
                <Figure
                  caption={summary.best ? `${humanDate(summary.best.date)}\ndividend ${moneyFine(summary.best.dividend)}` : undefined}
                  label="Best game"
                  style={styles.cell}
                  value={<FineMoney value={summary.best?.net ?? 0} />}
                />
                <Figure
                  caption={summary.worst ? `${humanDate(summary.worst.date)}\ndividend ${moneyFine(summary.worst.dividend)}` : undefined}
                  label="Worst game"
                  style={styles.cell}
                  value={<FineMoney value={summary.worst?.net ?? 0} />}
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
                <Text maxFontSizeMultiplier={1.4} style={styles.note}>{priceStory(shown, viewSide, player.currentGameCost)}</Text>
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
            // The Market's names for the same two facts ("Dividend last season
            // $120K a game · $20K over his price"), so a row and its profile agree.
            <View style={styles.grid}>
              <Figure
                caption="a game"
                label="Dividend last season"
                style={styles.cellHalf}
                value={<Money signed={false} size="title" value={lastSeason.worth} />}
              />
              <Figure
                caption={lastSeason.edgeCaption}
                label="Value at today's price"
                style={styles.cellHalf}
                value={<Money size="title" value={lastSeason.edge} />}
              />
            </View>
          )}
        </View>

        {nights.length > 0 ? (
          <>
            <SectionHeader
              caption={logCaption(range, shown.length, live ? 'yours' : 'season')}
              level={3}
              style={[styles.sectionHeader, inset]}
              title="Game log"
            />
            <ProfileGameLog
              capped={logCapped}
              mixed={mixedLog}
              onToggle={() => setShowAllGames((current) => !current)}
              preview={LOG_PREVIEW}
              priceHeader={priceHeader}
              rows={log}
              showingAll={showAllGames}
              side={viewSide}
              style={inset}
              total={logTotal}
            />
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
    borderColor: colors.controlBorder,
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
  stakeHeadLead: {
    color: colors.text,
    fontSize: type.value,
    fontWeight: weight.bold,
  },
  stakeHeadTotal: {
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
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
    maxWidth: 440,
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
  // The "Average a game" line sits close above the figures it describes.
  gridTight: {
    marginTop: -space.sm,
  },
  gridCaption: {
    color: colors.faint,
    fontSize: type.caption,
    lineHeight: 16,
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
  fineMoney: {
    fontFamily: fonts.display,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  pressed: {
    opacity: 0.72,
  },
});
