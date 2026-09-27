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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Platform,
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
  gamesCount,
  humanDate,
  moneyFine,
  signedMoneyFine,
  unbrokenName,
} from '../copy/terms';
import { isMockActive, mockSeasonStart } from '../api/mockPerGameClient';
import { practiceProgress } from '../data/chromeView';
import { isSeasonOver, tierLabel } from '../data/marketView';
import { currentResults, playerValue, positionValue } from '../data/perGameMetrics';
import { splitPlayerName } from '../data/playerName';
import {
  buildProfileNights,
  firstGamePreview,
  figureSpoken,
  formVerdict,
  heldStints,
  headerPrice,
  holdingStatus,
  defaultRange,
  isRecentRange,
  lastSeasonValue,
  logPriceHeader,
  logCaption,
  logRows,
  logStatusNights,
  mixNote,
  breakEvenLine,
  pastStintLead,
  pastStints,
  positionOpenedDay,
  priceCompare,
  priceDriftCaption,
  priceMovesNote,
  priceMoveLine,
  priceSourceCaption,
  priceStory,
  profileSide,
  rangeNights,
  rangeOptions,
  sideWords,
  stakeLine,
  statusNights,
  summarizeNights,
  unsettledNote,
  valueMeaning,
  type ProfileMetric,
  type ProfileRange,
  type StakeTone,
} from '../data/profileView';
import type { TrendPoint } from '../data/trendPresentation';
import { usePerGame } from '../state/PerGameContext';
import { openTab } from '../state/uiActions';
import { sheetIsOpen } from '../web/appHistory';
import { colors, control, fonts, radius, space, type, weight } from '../theme';
import { Button, headingLevel, Label, Money, moneyColor, repeatSafe, SectionHeader, Segmented, Tag, visuallyHidden } from '../ui/kit';
import { CloseIcon, StarIcon } from './market/icons';
import { PlayerAvatar } from './PlayerAvatar';
import { ProfileActionBar } from './profile/ProfileActionBar';
import { showPlayerGames, tabUnderSheet } from './results/playerGames';
import { ProfileChart } from './profile/ProfileChart';
import { ProfileGameLog } from './profile/ProfileGameLog';
import { unlessSettling } from '../web/tapSettle';

const METRIC_OPTIONS: { key: ProfileMetric; label: string; hint: string }[] = [
  { key: 'dividends', label: 'Dividends', hint: 'His dividend each game, against his price' },
  { key: 'price', label: 'Price', hint: 'His price a game, game by game' },
];

/** Games the log shows before "Show all"; a list only a couple longer just shows in full. */
const LOG_PREVIEW = 10;
const LOG_SLACK = 2;

/** Below this window height the action bar scrolls away with his name. */
const PIN_BAR_MIN_HEIGHT = 500;

/**
 * Web: the details region's focus ring is drawn on a layer above the scroll
 * area (walk 17 T2-07). Chrome paints a scroll container's own outline under
 * its scrolling contents, so the pinned Add / Short band cut the inset ring
 * where it sat; the region keeps no outline of its own and the ring after it
 * shows while it has keyboard focus.
 */
const DETAILS_RING_ID = 'profile-details-ring';
function useDetailsRing() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || document.getElementById(DETAILS_RING_ID)) return;
    const style = document.createElement('style');
    style.id = DETAILS_RING_ID;
    style.textContent = [
      '[data-profile-details][tabindex]:focus-visible { outline: none !important; }',
      '[data-profile-ring] { display: none !important; }',
      '[data-profile-details]:focus-visible + [data-profile-ring] { display: flex !important; }',
    ].join('\n');
    document.head.appendChild(style);
  }, []);
}

/**
 * Below this window width the game log's four columns would break figures and
 * header words ("$327." / "6K" at 200% zoom, walk 5 T3-04): each game is a
 * stacked row instead. Measured: the table reads whole from 320px up.
 */
const LOG_TABLE_MIN_WIDTH = 320;

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
function Figure({ label, value, caption, spoken, style }: {
  label: string;
  value: ReactNode;
  caption?: string;
  /**
   * The figure as one sentence, in the words and the figure shown
   * (figureSpoken; walk 17 T3-04): heard instead of its drawn parts, from a
   * clear layer over the figure, so touch finds it too.
   */
  spoken?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const drawn = spoken ? { 'aria-hidden': true } : {};
  return (
    <View style={[styles.figure, style]}>
      <View {...drawn}>
        <Label style={styles.figureLabel}>{label}</Label>
      </View>
      <View style={styles.figureValue} {...drawn}>{value}</View>
      {caption ? <Text maxFontSizeMultiplier={1.4} style={styles.figureCaption} {...drawn}>{caption}</Text> : null}
      {spoken ? <Text style={styles.figureSpoken}>{spoken}</Text> : null}
    </View>
  );
}

/** A figure at the Roster's precision, as drawn and as heard. */
function fineText(value: number, signed = true): string {
  return signed ? signedMoneyFine(value) : moneyFine(value);
}

/**
 * Money at the Roster's precision ("$112.5K", "+$1.63M"), so a figure reads
 * the same on the profile as on the row it came from. Signed amounts are
 * coloured gain or loss. Heard as shown, like the kit's Money (walk 17 T3-04:
 * "$335,950" was read for a drawn "$336K").
 */
function FineMoney({ value, signed = true, size = type.value, style }: {
  value: number;
  signed?: boolean;
  size?: number;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      maxFontSizeMultiplier={1.4}
      style={[styles.fineMoney, { fontSize: size, color: signed ? moneyColor(value) : colors.text }, style]}
    >
      {fineText(value, signed)}
    </Text>
  );
}

/** A best, worst or only game as heard: "Best game +$123.8K, Oct 24, dividend $612K". */
function gameSpoken(label: string, game: { date: string; net: number; dividend: number } | null | undefined): string {
  return figureSpoken(label, fineText(game?.net ?? 0), game ? { date: game.date, caption: `dividend ${moneyFine(game.dividend)}` } : {});
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
  /** Opens in this chart view and range (Results' "Back to <player>"; walk 9 T1-17). */
  initialView?: { metric: ProfileMetric; range: ProfileRange | null };
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
  initialView,
}: PerGamePlayerProfileProps) {
  // The range you picked; until then, the default for his games (see defaultRange).
  // Reopened from Results ("Back to <player>"; walk 9 T1-17): in the view it was in.
  const [picked, setPicked] = useState<ProfileRange | null>(initialView?.range ?? null);
  const [metric, setMetric] = useState<ProfileMetric>(initialView?.metric ?? 'dividends');
  const [showAllGames, setShowAllGames] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // Where the details region starts under the top bar: its ring's top edge.
  const [detailsTop, setDetailsTop] = useState(0);
  useDetailsRing();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // A short window (a phone at 200% zoom, a phone on its side) keeps the
  // action bar with his name instead of pinning it: pinned under the top bar
  // it would leave the chart and log about half the screen.
  const pinBar = windowHeight >= PIN_BAR_MIN_HEIGHT;
  // A zoomed browser (200% on a phone) leaves under 240px: trim the side
  // gutters so four range tabs still get 44px each, and shrink Watch to its star.
  const inset = !wide && windowWidth < 240 ? styles.insetTight : null;
  const narrow = !wide && windowWidth < 300;
  // 400% zoom (under 160px): the headshot gives way so his name has the whole
  // line, and every figure takes a line of its own, so nothing is cut off at
  // the sheet's edge or broken inside a word.
  const tiny = !wide && windowWidth < 160;
  const cell = [styles.cell, tiny && styles.cellFull];
  const half = [styles.cellHalf, tiny && styles.cellFull];

  // "Short instead" / "Add instead" switch the action bar to the other side,
  // and the whole profile reads from the side the bar is on (walk 4 T1-03).
  // Kept for this player opened from this tab, so a new one starts over.
  const openedKey = `${player.playerId}:${side ?? 'long'}`;
  const [instead, setInstead] = useState<{ key: string; side: PerGamePositionSide } | null>(null);
  const viewSide = profileSide(position, side, instead?.key === openedKey ? instead.side : null);
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
  // A range the player picks: the verdict for it is heard once it is drawn.
  const rangeNow = useRef(range);
  rangeNow.current = range;
  const rangePicked = useRef(false);
  const pickRange = useCallback((next: ProfileRange) => {
    if (next !== rangeNow.current) rangePicked.current = true;
    setPicked(next);
  }, []);
  const shown = useMemo(() => rangeNights(nights, range), [nights, range]);
  const summary = useMemo(() => summarizeNights(shown), [shown]);
  const recent = isRecentRange(range, shown.length, nights.length);
  // Your money with him: the current position when you hold him (the same
  // numbers as its Roster row), otherwise every stint you had.
  const stakeSummary = useMemo(
    () => (position ? positionValue(results, position.positionId) : playerValue(results, player.playerId)),
    [player.playerId, position, results],
  );
  // No games yet: say since when ("No games since you added him (Oct 20)");
  // "at this price" only when he already played for you at another price.
  const { bootstrap } = usePerGame();
  // While his move saves, the action bar says so once ("Adding…" and "Saving
  // your add of Luka Doncic…"); the header keeps saying where you stand until
  // it lands (walk 10 T4-09: three lines said one thing).
  // Held: the header leads with your price and this line names the market's (walk 9 T1-01).
  // After the last night the header speaks of the season past, as the
  // Market does, and Watch steps aside with the market closed (walk 12 T1-09).
  const seasonOver = bootstrap ? isSeasonOver({
    practiceComplete: isMockActive() && practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).complete,
    lastSettledDate: bootstrap.game.lastSettledDate,
    nextGameDate: bootstrap.game.nextGameDate,
  }) : false;
  const status = holdingStatus(position, viewSide, false, player.currentGameCost, seasonOver);
  // His price in net points, the box-score figure that beats it (walk 16
  // T1-N2), while games are still to come: your price when you hold him,
  // today's otherwise.
  const breakEven = seasonOver || !bootstrap
    ? null
    : breakEvenLine(position ? position.lockedGameCost : player.currentGameCost, dividendRate, bootstrap.ruleset.dividendBasis, viewSide);
  const ledger = bootstrap?.ledger.items;
  const positions = bootstrap?.positions;
  const opened = useMemo(() => (position ? {
    since: positionOpenedDay(ledger ?? [], position.positionId),
    readd: results.some((row) => row.playerId === player.playerId && row.side === position.side
      && row.positionId !== position.positionId && row.status === 'settled'),
    // Re-added: the header counts every stint on this side, as the Roster does (walk 17 T4-10).
    stints: heldStints(results, position, pastStints(positions ?? [], ledger ?? [], player.playerId)),
  } : {
    // Not held: name the side and dates of your past stints with him, counted as the Roster counts them.
    past: pastStintLead(
      currentResults(results).filter((row) => row.playerId === player.playerId),
      pastStints(positions ?? [], ledger ?? [], player.playerId),
    ),
  }), [ledger, player.playerId, position, positions, results]);
  const stake = stakeLine(stakeSummary, held, viewSide, opened, seasonOver);
  // One game shown, and it was yours with the header saying its result: the
  // verdict says how it went without the figure, and the averages and the
  // best/only tiles wait for his second game (walk 7 T1-05: one figure said
  // six times pushed the chart below the fold).
  const oneGame = summary.games === 1;
  const headerSaysIt = held && oneGame && summary.yours === 1 && Boolean(stake?.total);
  // Nights with no money to show: he did not play, or the game has not settled.
  const quietNote = unsettledNote(stakeSummary);
  const quiet = useMemo(() => statusNights(results, viewSide), [results, viewSide]);
  const mix = mixNote(shown, viewSide);
  // Held: against the price you locked, like the Roster; otherwise today's price.
  const lastSeason = lastSeasonValue(player, viewSide, position);
  // The log lists the range's games (the chart's games), plus your no-money nights in that window.
  const logQuiet = logStatusNights(quiet, range, shown);
  const logTotal = shown.length + logQuiet.length;
  const logCapped = logTotal > LOG_PREVIEW + LOG_SLACK;
  const log = logRows(shown, logQuiet, showAllGames || !logCapped ? undefined : LOG_PREVIEW);
  const priceHeader = logPriceHeader(shown, viewSide);
  const mixedLog = priceHeader === 'Price';
  const title = narrow ? splitPlayerName(player.name).surname : player.name;
  // Results lists your games with him (any side): offer them there, his alone.
  const inResults = results.some((row) => row.playerId === player.playerId);
  const seeGames = () => {
    // Read before the sheet closes: the screen under it, for Back (walk 16 T2-05).
    const fromTab = tabUnderSheet();
    showPlayerGames({ playerId: player.playerId, playerName: player.name, from: { metric, range: picked, side: viewSide }, fromTab });
    closeThen(onClose, () => openTab('plays'));
  };
  const preview = firstGamePreview(viewSide, live ? 'yours' : 'season');
  const verdict = formVerdict(summary, {
    recent,
    side: viewSide,
    // "for your short" only when every game shown was yours.
    held: held && summary.yours === summary.games,
    scope: live || range === 'Yours' ? 'yours' : 'season',
    figure: !headerSaysIt,
  });
  // What the verdict region says: only a verdict the player asked for by
  // picking a range, never one that games landing changed (walk 16 T4-14).
  const [verdictSaid, setVerdictSaid] = useState('');
  useEffect(() => {
    if (!rangePicked.current) return;
    rangePicked.current = false;
    setVerdictSaid(verdict);
    // Keyed on the range: the verdict drawn for the range just picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);
  // The Price view (walk 9 T1-08, T2-03): held, one comparison leads and the
  // move since his first game shown is the chart's caption, with a word on a
  // flat-looking chart.
  const firstWithYou = nights.find((night) => night.source === 'yours')?.date ?? null;
  const compare = position ? priceCompare(position.side, player.currentGameCost, position.lockedGameCost) : null;
  const priceCaption = [
    compare ? priceMoveLine(shown, player.currentGameCost, firstWithYou) : null,
    priceDriftCaption(shown),
  ].filter(Boolean).join(' ');

  // Space toggles a switch (the WAI-ARIA pattern screen readers teach), but
  // react-native-web only presses buttons on Space; without this the sheet
  // scrolls a screen instead. Enter already presses it. A held key toggles once.
  const onWatchKey = (event: { key: string; repeat?: boolean; preventDefault: () => void }) => {
    if (event.key !== ' ' && event.key !== 'Spacebar') return;
    event.preventDefault();
    if (!event.repeat) onToggleWatch();
  };
  // A double tap on Watch (or on "Show all") acts once: its second tap used to
  // switch it straight back off (walk 6 T4-11). A key press always acts.
  const toggleWatch = useMemo(() => repeatSafe(onToggleWatch), [onToggleWatch]);
  const toggleAllGames = useMemo(() => repeatSafe(() => setShowAllGames((current) => !current)), []);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = event.nativeEvent.contentOffset.y > TITLE_AFTER_SCROLL;
    if (next !== scrolled) setScrolled(next);
  };

  return (
    <View style={styles.root}>
      {/* At 400% zoom Close and the Watch star take the whole bar (44px each). */}
      <View style={[styles.topBar, tiny && styles.topBarTight]}>
        <Pressable
          accessibilityLabel="Close player profile"
          accessibilityRole="button"
          onPress={unlessSettling(onClose)}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <CloseIcon size={18} />
        </Pressable>
        <View style={styles.titleSlot}>
          {scrolled && !tiny ? (
            <Text accessibilityElementsHidden aria-hidden importantForAccessibility="no" maxFontSizeMultiplier={1.3} style={styles.title}>
              {title}
            </Text>
          ) : null}
        </View>
        {/* A switch, like the Market's star: its state on or off (the star
            fills, the chip turns gold), and Space or Enter toggles it. The
            word says the state too, "Watch" or "Watching" (walk 5 T1-10), and
            the spoken name starts with the word shown ("Watching Nikola
            Jokic"), so a voice command naming the button still finds it. */}
        {seasonOver ? null : (
          <Pressable
            accessibilityLabel={`${watching ? 'Watching' : 'Watch'} ${player.name}`}
            accessibilityRole="switch"
            accessibilityState={{ checked: watching }}
            aria-checked={watching}
            onPress={toggleWatch}
            style={({ pressed }) => [styles.watch, narrow && styles.watchIcon, watching && styles.watchOn, pressed && styles.pressed]}
            {...({ onKeyDown: onWatchKey } as object)}
          >
            <StarIcon filled={watching} />
            {narrow ? null : (
              <Text maxFontSizeMultiplier={1.3} style={[styles.watchText, watching && styles.watchTextOn]}>
                {watching ? 'Watching' : 'Watch'}
              </Text>
            )}
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        onLayout={(event) => setDetailsTop(event.nativeEvent.layout.y)}
        onScroll={onScroll}
        scrollEventThrottle={32}
        // The action bar (child 1) sits under his name and your status, then
        // stays pinned to the top while the rest of the profile scrolls
        // (in a tall enough window; see pinBar).
        stickyHeaderIndices={pinBar ? [1] : undefined}
        style={styles.scroll}
        // A named, focusable scroll region, so a keyboard can reach and scroll
        // the last season and game log below the chart (walk 3 T3-10).
        {...({ tabIndex: 0, role: 'region', 'aria-label': `${player.name}: profile details`, dataSet: { profileDetails: '' } } as object)}
      >
        <View>
        <View style={[styles.identity, inset]}>
          {/* His name is the heading beside it: the headshot is not read too
              (walk 3 T3-32). */}
          {tiny ? null : (
            <View aria-hidden>
              <PlayerAvatar player={{ id: player.playerId, name: player.name }} size={56} />
            </View>
          )}
          <View style={styles.identityCopy}>
            <Text accessibilityRole="header" {...headingLevel(2)} maxFontSizeMultiplier={1.4} style={styles.name}>
              {windowWidth >= 320 ? unbrokenName(player.name) : player.name}
            </Text>
            <View style={styles.metaLine}>
              {/* The Market's words for the tier ("Role player", never a bare
                  "ROLE"; walk 5 T4-07), drawn in capitals like the row's. */}
              {player.tier ? <Text maxFontSizeMultiplier={1.4} style={styles.tier}>{tierLabel(player.tier)}</Text> : null}
              <Text maxFontSizeMultiplier={1.4} style={styles.priceNow}>{headerPrice(position, player.currentGameCost)}</Text>
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
              {stake.all ? (
                <Text maxFontSizeMultiplier={1.4} style={[styles.stakeHeadTotal, { color: TONE_COLOR[stake.all.tone] }]}>
                  <Text aria-hidden style={styles.stakeHeadJoin}>{'· '}</Text>
                  {stake.all.text}
                </Text>
              ) : null}
            </View>
          ) : null}
          <View style={styles.statusLine}>
            {/* At 400% zoom the tag is wider than the sheet: its words lead the sentence instead. */}
            {status.tag && !tiny ? <Tag>{status.tag}</Tag> : null}
            <Text maxFontSizeMultiplier={1.4} style={styles.statusText}>
              {status.tag && tiny ? `${status.tag}. ${status.text}` : status.text}
            </Text>
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
          {breakEven ? <Text maxFontSizeMultiplier={1.4} style={styles.stakeLead}>{breakEven}</Text> : null}
        </View>
        </View>
        <ProfileActionBar
          onLeave={onClose}
          onSwitchSide={(next) => setInstead({ key: openedKey, side: next })}
          player={player}
          position={position}
          side={viewSide}
        />

        <SectionHeader
          level={3}
          right={nights.length > 0 && !tiny ? <Text style={styles.sectionCount}>{gamesCount(nights.length)}</Text> : undefined}
          // The action bar's own rule sits right above: one rule, not two (walk 8 T1-06).
          style={[styles.sectionHeader, styles.sectionAfterBar, inset]}
          title="Game by game"
        />
        <View style={[styles.section, inset]}>
          {nights.length > 0 ? (
            <>
              {/* One choice is no choice: with a handful of games the tabs go. */}
              {ranges.length > 1 ? (
                <Segmented
                  accessibilityLabel="Games shown"
                  onChange={pickRange}
                  options={ranges}
                  style={wide ? styles.rangeWide : undefined}
                  value={range}
                />
              ) : null}
              {/* Drawn, not a live region: games landing change it silently
                  (walk 16 T4-14: it spoke after every week of a run, which
                  the run's notice says once). A range the player picks is
                  heard (walk-2 T3-N5), through the region below. */}
              <Text maxFontSizeMultiplier={1.4} style={styles.verdict}>{verdict}</Text>
              <View style={visuallyHidden}>
                <Text accessibilityLiveRegion="polite">{verdictSaid}</Text>
              </View>
              {mix ? <Text maxFontSizeMultiplier={1.4} style={styles.note}>{mix}</Text> : null}
              {oneGame ? null : (
              <>
              {/* The first three figures are averages over the games shown, so
                  his average price never reads as his price now. One-word
                  labels keep the three values on one line at 360px. */}
              {/* Each figure below is heard with "Average" and its label (figureSpoken). */}
              <Text aria-hidden maxFontSizeMultiplier={1.4} style={styles.gridCaption}>Average a game</Text>
              <View style={[styles.grid, styles.gridTight]}>
                <Figure
                  label="Dividend"
                  spoken={figureSpoken('Dividend', fineText(summary.avgDividend ?? 0, false), { average: true })}
                  style={cell}
                  value={<FineMoney signed={false} size={type.title} value={summary.avgDividend ?? 0} />}
                />
                <Figure
                  caption={priceSourceCaption(summary, viewSide)}
                  label={words.price}
                  spoken={figureSpoken(words.price, fineText(summary.avgPrice ?? 0, false), { average: true, caption: priceSourceCaption(summary, viewSide) })}
                  style={cell}
                  value={<FineMoney signed={false} size={type.title} value={summary.avgPrice ?? 0} />}
                />
                <Figure
                  caption={words.netCaption}
                  label="Profit"
                  spoken={figureSpoken('Profit', fineText(summary.avgNet ?? 0), { average: true, caption: words.netCaption })}
                  style={cell}
                  value={<FineMoney size={type.title} value={summary.avgNet ?? 0} />}
                />
              </View>
              <View style={styles.grid}>
                <Figure
                  caption={words.missedCaption(summary.games - summary.beat)}
                  label={words.beat}
                  style={cell}
                  value={(
                    <Text maxFontSizeMultiplier={1.4} style={styles.statText}>
                      {`${summary.beat} of ${gamesCount(summary.games)}`}
                    </Text>
                  )}
                />
                {/* One game is both his best and his worst: say it once
                    (walk 5 T2-15), never a "best game" of -$315K. */}
                {summary.games === 1 ? (
                  <Figure
                    caption={summary.best ? `${humanDate(summary.best.date)}\ndividend ${moneyFine(summary.best.dividend)}` : undefined}
                    label="Only game"
                    spoken={gameSpoken('Only game', summary.best)}
                    style={cell}
                    value={<FineMoney value={summary.best?.net ?? 0} />}
                  />
                ) : (
                  <>
                    <Figure
                      caption={summary.best ? `${humanDate(summary.best.date)}\ndividend ${moneyFine(summary.best.dividend)}` : undefined}
                      label="Best game"
                      spoken={gameSpoken('Best game', summary.best)}
                      style={cell}
                      value={<FineMoney value={summary.best?.net ?? 0} />}
                    />
                    <Figure
                      caption={summary.worst ? `${humanDate(summary.worst.date)}\ndividend ${moneyFine(summary.worst.dividend)}` : undefined}
                      label="Worst game"
                      spoken={gameSpoken('Worst game', summary.worst)}
                      style={cell}
                      value={<FineMoney value={summary.worst?.net ?? 0} />}
                    />
                  </>
                )}
              </View>
              </>
              )}
              <Segmented
                accessibilityLabel="Chart shows"
                onChange={setMetric}
                options={METRIC_OPTIONS}
                style={[styles.metric, wide && styles.metricWide]}
                value={metric}
              />
              {metric === 'price' && compare ? (
                // One comparison in two cells, then one plain line (walk 9 T1-08).
                <View style={styles.compare}>
                  <View style={styles.grid}>
                    {compare.cells.map((item) => (
                      <Figure
                        caption="a game"
                        key={item.label}
                        label={item.label}
                        style={half}
                        value={<Text maxFontSizeMultiplier={1.4} style={styles.compareValue}>{item.value}</Text>}
                      />
                    ))}
                  </View>
                  <Text maxFontSizeMultiplier={1.4} style={styles.note}>{compare.line}</Text>
                </View>
              ) : metric === 'price' ? (
                <Text maxFontSizeMultiplier={1.4} style={styles.note}>
                  {priceStory(shown, viewSide, player.currentGameCost, firstWithYou, position?.lockedGameCost ?? null)}
                </Text>
              ) : null}
              <ProfileChart height={wide ? 200 : 176} metric={metric} nights={shown} now={player.currentGameCost} side={viewSide} />
              {metric === 'price' && priceCaption ? (
                <Text maxFontSizeMultiplier={1.4} style={styles.chartCaption}>{priceCaption}</Text>
              ) : null}
              {/* What moves a price, in the Rules' words (walk 11 T2-01). */}
              {metric === 'price' ? (
                <Text maxFontSizeMultiplier={1.4} style={styles.chartCaption}>{priceMovesNote()}</Text>
              ) : null}
            </>
          ) : (
            // Say plainly what will fill this once he plays (walk 7 T1-04).
            <View style={styles.preview}>
              <Text maxFontSizeMultiplier={1.4} style={styles.verdict}>{preview.lead}</Text>
              <View role="list" style={styles.previewList}>
                {preview.items.map((item) => (
                  <View key={item} role="listitem" style={styles.previewItem}>
                    <Text aria-hidden maxFontSizeMultiplier={1.4} style={styles.previewDot}>•</Text>
                    <Text maxFontSizeMultiplier={1.4} style={styles.previewText}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
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
                style={half}
                value={<Money signed={false} size="title" value={lastSeason.worth} />}
              />
              <Figure
                caption={lastSeason.caption}
                label={lastSeason.label}
                style={half}
                value={<Money size="title" value={lastSeason.edge} />}
              />
            </View>
          )}
          {/* Before his first game the Market's "Value" is his whole story,
              so say what it means (walk 7 T1-04). */}
          {nights.length === 0 && lastSeason.edge !== null ? (
            <Text maxFontSizeMultiplier={1.4} style={styles.note}>{valueMeaning(viewSide, held && position?.side === viewSide)}</Text>
          ) : null}
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
              onToggle={toggleAllGames}
              preview={LOG_PREVIEW}
              priceHeader={priceHeader}
              rows={log}
              showingAll={showAllGames}
              stacked={!wide && windowWidth < LOG_TABLE_MIN_WIDTH}
              style={inset}
              total={logTotal}
            />
            {/* The nights' math for him alone, in Results (walk 8 T2-I4). */}
            {inResults ? (
              <View style={[styles.seeGames, inset]}>
                <Button
                  accessibilityLabel={`See ${player.name}'s games in Results`}
                  label="See his games in Results"
                  onPress={seeGames}
                  variant="secondary"
                />
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      {/* The details region's focus ring, above the pinned band (see useDetailsRing). */}
      {Platform.OS === 'web' ? (
        <View aria-hidden style={[styles.detailsRing, { top: detailsTop + 1 }]} {...({ dataSet: { profileRing: '' } } as object)} />
      ) : null}
    </View>
  );
}

/**
 * Close the profile, then go on once its Back step has landed (the sheet has
 * its own history entry), so one Back from the next screen returns here.
 */
function closeThen(close: () => void, next: () => void) {
  if (typeof window === 'undefined' || !sheetIsOpen()) {
    close();
    next();
    return;
  }
  let gone = false;
  const go = () => {
    if (gone) return;
    gone = true;
    window.removeEventListener('popstate', go);
    next();
  };
  window.addEventListener('popstate', go);
  close();
  // No Back step came (the sheet's entry was not on top): go anyway.
  setTimeout(go, 400);
}

const styles = StyleSheet.create({
  seeGames: {
    alignItems: 'flex-start',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  root: {
    flex: 1,
    minHeight: 0,
  },
  // The Watch pill ends on the body's 16px gutter, and the close X's glyph
  // starts on it (walk 9 T1-12: the pill jutted 8px past the buttons below).
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.xs,
    paddingRight: space.lg,
    paddingVertical: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  // Sides named, so they win over topBar's own sides (a shorthand would not).
  topBarTight: {
    gap: 2,
    paddingLeft: 2,
    paddingRight: 2,
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
  // Drawn where the kit's inset ring sat (2px, 1px in from the region's edges).
  detailsRing: {
    position: 'absolute',
    left: 1,
    right: 1,
    bottom: 1,
    borderWidth: 2,
    borderColor: colors.focus,
    borderRadius: 4,
    pointerEvents: 'none',
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
    textTransform: 'uppercase',
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
  // The dot between this stint's figure and every stint's: drawn, not read.
  stakeHeadJoin: {
    color: colors.muted,
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
  sectionAfterBar: {
    marginTop: 0,
    borderTopWidth: 0,
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
  preview: {
    gap: space.sm,
  },
  previewList: {
    gap: space.xs,
  },
  previewItem: {
    flexDirection: 'row',
    gap: space.sm,
  },
  previewDot: {
    color: colors.goldInk,
    fontSize: type.body,
    lineHeight: 20,
  },
  previewText: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: type.body,
    lineHeight: 20,
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
  compare: {
    gap: space.sm,
    marginBottom: space.sm,
  },
  compareValue: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  chartCaption: {
    marginTop: space.sm,
    color: colors.muted,
    fontSize: type.label,
    lineHeight: 16,
  },
  figureLabel: {
    letterSpacing: 0.5,
  },
  figureValue: {
    marginTop: 3,
  },
  // A clear layer over the whole figure: its sentence, for screen readers and touch.
  figureSpoken: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    opacity: 0,
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
  cellFull: {
    width: '100%',
    minWidth: 0,
    paddingRight: 0,
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
