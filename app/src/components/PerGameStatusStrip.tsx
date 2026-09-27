import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PerGameRuleset } from '../api/contracts';
import { isMockActive, mockSeasonStart } from '../api/mockPerGameClient';
import { exactMoney, humanDate, PRACTICE_LABEL, rosterReopensLine } from '../copy/terms';
import { pastSeasonCount } from '../web/practiceSession';
import {
  cancelPlace,
  rulesContentsPinned,
  rulesInFoldedRow,
  CHROME_FOLDED_FACTS_MIN_WIDTH,
  FOLDED_LOCK_WORDS_MIN_WIDTH,
  FOLDED_LOCK_WORDS_MIN_WIDTH_NOBODY,
  CHROME_FOLDED_ONE_LINE_MIN_WIDTH,
  moreBesideSettings,
  chromeFolded,
  chromeLayout,
  chromeTiny,
  dividendText,
  frameLocked,
  keepTogether,
  lastNightFigure,
  LOCK_REASON,
  lockBesideDay,
  lockIconName,
  lockLine,
  lockShortText,
  nextGamesText,
  PHONE_SLOT_MIN_WIDTH,
  noGamesWords,
  playedBetween,
  practiceDateDay,
  practiceDayShort,
  CHROME_TINY_DAY_ONE_LINE_MIN_WIDTH,
  practiceDayText,
  seasonTagged,
  CHROME_FOLDED_SETTINGS_WORD_MIN_WIDTH,
  practiceProgress,
  type PracticeProgress,
  resultSpan,
  seasonPlayedLabel,
  sheetFloats,
  sheetNarrow,
  shortTermText,
  spokenLabel,
  statusRowResult,
  statusSummary,
} from '../data/chromeView';
import { earningsBetween } from '../data/perGameMetrics';
import { EXAMPLE_LEAD, KEYBOARD_KEYS, KEYBOARD_SHORTCUTS_LABEL, perGameRulesPresentation, positionSlotHint, RULES_CONTENTS, rulesFoldKeyboard, rulesSections, TOUCH_TIPS, type ScoringParts } from '../data/perGameRules';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { usePerGame } from '../state/PerGameContext';
import { openSettings, registerRulesOpener } from '../state/uiActions';
import { colors, control, fonts, labelStyle, radius, space, type, weight } from '../theme';
import { Button, headingLevel, moneyColor, repeatSafe, Tag, visuallyHidden } from '../ui/kit';
import { useSheetHistory, useSheetShown } from '../web/appHistory';
import { ChromeButton, type ChromeButtonPlacement } from './chrome/ChromeButton';
import { LockIcon, PracticeIcon, RefreshIcon, RulesIcon, SettingsIcon } from './chrome/ChromeIcons';
import { measuredFloatTop, measuredSheetTop } from './chrome/sheetTop';
import { PRACTICE_HINT_ID, PracticeControls, usePracticeHint, useQueuedCancelShows, useQueuedThrough, usePracticeRulesContext, useReaderSpacing, useRecentAdvances, useScreenName, useSpacingFold } from './SimBar';
import { unlessSettling } from '../web/tapSettle';

/**
 * How the facts sit beside the controls.
 *  - wide: one line (clock with the day, the latest night, next games or the lock).
 *  - pair: practice on a phone. "Practice · Nov 5 games +$322.5K" over
 *    "Day 16 of 174 · Next Thu, Nov 6"; on a locked night the lock and when it
 *    lifts take a line of their own.
 * The latest night is always named by its date ("Nov 5 games"), never "last
 * night" (walk 2 T1-07, T1-14, T4-09).
 *  - stack: one short fact per tight line. Signed in on a phone (three
 *    controls share the row), practice at high zoom (no room for pairs), and
 *    practice while Reconcile needs the room.
 */
type FactsArrangement = 'wide' | 'pair' | 'stack';

/**
 * The status row above every screen: where the season stands, how last night
 * went, when the next games are, and the few controls that belong to the whole
 * game rather than one screen (rules, refresh, practice).
 *
 * It is part of the frame, not a card, so it stays one row: short lines of
 * facts beside 44px icon-first controls. In practice mode the practice bar
 * (SimBar) sits directly under it and carries the clock controls; the two share
 * one background and never repeat a date. The rules open as a sheet over the
 * screen instead of pushing the content down.
 */
export function PerGameStatusStrip() {
  const { fontScale, height, width } = useWindowDimensions();
  const {
    bootstrap,
    isGameplayReady,
    isRefreshing,
    pendingActions,
    reconciliationRequired,
    refreshData,
  } = usePerGame();
  const [rulesOpen, setRulesOpen] = useState(false);
  // The heading the rules open at, focused ("Scoring" for the welcome's "How
  // scoring works"; walk 15 T3-03), or null for the top.
  const [rulesSection, setRulesSection] = useState<string | null>(null);
  // Any screen can open the rules (the Roster welcome card does).
  useEffect(() => registerRulesOpener((section) => {
    setRulesSection(section ?? null);
    setRulesOpen(true);
  }), []);
  const lastSettled = bootstrap?.game.lastSettledDate ?? null;
  const ledgerItems = bootstrap?.ledger.items;
  // The games the row reports: the last settled night, or after +1 week the
  // whole week it played, until the next advance lands (walk 3 T1-20), games
  // only, as the notice after the advance counts them.
  const advances = useRecentAdvances();
  // Nobody on the roster or shorts: the row says so, as the notice does
  // ("Oct 21 games: nobody on your roster"; walk 5 T1-17).
  const emptyNow = !(bootstrap?.positions ?? []).some((position) => position.status === 'active');
  const span = useMemo(() => resultSpan(advances, lastSettled, emptyNow), [advances, lastSettled, emptyNow]);
  const spanResult = useMemo(() => (
    span && ledgerItems ? earningsBetween(ledgerItems, span.after, span.through, { gamesOnly: true }) : null
  ), [ledgerItems, span]);
  const noGames = useMemo(() => !span || !playedBetween(ledgerItems, span.after, span.through), [ledgerItems, span]);
  // Desktop has no line under +1 night / +1 week, so the practice hint ("Add
  // a player first…", then "Ready…") rides at the end of the facts; a folded
  // row (landscape, 200% zoom) carries its short form (walk 4 T1-09, T3-11).
  const practiceHint = usePracticeHint();
  const queuedThrough = useQueuedThrough();
  const queuedCancelShows = useQueuedCancelShows();
  // This visit's season number: the finished ones before it, plus this one.
  const seasonNumber = pastSeasonCount() + 1;
  const practiceHintShort = usePracticeHint(true);
  // A reader's text spacing can fold a tall window's frame too (walk 8
  // T3-08); the brand bar then stays, and Settings with it.
  const spacingFolded = useSpacingFold();
  const readerSpacing = useReaderSpacing();
  // The screen on show: at season end the Roster's frame keeps to one line (endBeside).
  const screenName = useScreenName();
  // The tallest the facts have been at this window width (phone rows): the
  // block keeps it, so a week landing never moves the screen under it
  // ("Season opens Tue, Oct 21" took two lines at 320px, "Next Tue, Oct 28"
  // one, and everything below jumped up 8px; walk 10 T4-11).
  const [factsFloor, setFactsFloor] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  if (!bootstrap) return null;

  const practice = isMockActive();
  const layout = chromeLayout(width, fontScale);
  // A short window hides the brand bar (App), so this row carries Settings;
  // in practice it also folds the practice bar into this one row.
  const short = chromeFolded(height, width);
  const folded = practice && (short || spacingFolded) && !layout.merged;
  const foldedFacts = folded && width >= CHROME_FOLDED_FACTS_MIN_WIDTH;
  // Folded, narrow and very short (a phone at 400% zoom): one 44px line, the
  // day count and More, which holds everything else (walk 2 T3-11).
  const tiny = folded && chromeTiny(width, height);
  const rules = bootstrap.ruleset;
  const nextGameDate = bootstrap.game.nextGameDate;
  const progress = practice ? practiceProgress(mockSeasonStart(), lastSettled) : null;
  // Before the first night there is no "last night" to report; a day with no
  // games for your players says so rather than "$0".
  // Once the season is complete the row states the final score alone, not
  // the last run's figure beside it (walk 7 T4-09).
  const lastNight = statusRowResult(progress, spanResult);
  const next = nextGamesText(nextGameDate);

  const pendingBeyondReconciliation = [...pendingActions]
    .some((key) => key !== 'account-mutation');
  const disabled = (
    !isGameplayReady
    || isRefreshing
    || (reconciliationRequired ? pendingBeyondReconciliation : pendingActions.size > 0)
  );

  // A lock covers one game date and lifts once that date's games are
  // settled, so the copy promises "after", and says it. A finished season
  // has no night left to lock: a lock the last night left for the day after
  // ("Moves reopen after Apr 13") is never shown or said (walk 12 T4-12).
  const locked = frameLocked(rules.rosterMutationsLocked, progress);
  const lockDate = rules.rosterLockGameDate;
  // A landscape phone's folded row keeps to its two lines on a locked night:
  // it took three at 844px with nobody held and four at 667px, growing the
  // frame and pressing the first line to its top edge (walk 15 lead). The
  // lock names the night the next games are, and +1 night shows its date, so
  // "Next Tue, Oct 28" gives way to it; "nobody on your roster" already says
  // what the hint would; and a narrow landscape row says the lock in its short
  // words, "Locked · Oct 28", as a portrait phone's slot does, and leaves
  // "games" out of "Oct 21–27: nobody on your roster", as a phone's lead does.
  const foldedLockNight = foldedFacts && locked && !!lockDate && lockDate === nextGameDate && !progress?.complete;
  const lockSentence = locked
    ? (rules.rosterLockGameDate
      ? `Roster changes are locked for the ${humanDate(rules.rosterLockGameDate)} games. They reopen once those games are in.`
      : 'Roster changes are locked while the current game is in progress.')
    : null;
  const summary = statusSummary({
    mode: practice ? 'practice' : 'live',
    lastSettledDate: lastSettled,
    nextGameDate,
    lastNight,
    noGames,
    nobody: span?.nobody ?? false,
    progress: progress ?? undefined,
    lockSentence,
    resultLabel: span?.label ?? null,
    finalScore: progress?.complete ? bootstrap.account.cumulativePnl : null,
    season: seasonNumber,
  });

  const arrangement: FactsArrangement = layout.wide || foldedFacts
    ? 'wide'
    : !practice || layout.compact || folded || reconciliationRequired ? 'stack' : 'pair';
  // Enlarged text keeps its natural line height and simply wraps.
  const tight = (arrangement === 'stack' || folded) && !layout.largeText;
  // Only the signed-in row has three controls to squeeze; practice's Rules
  // control is 44px wide with its name, so it always keeps it.
  const placement: ChromeButtonPlacement = layout.wide
    ? 'inline'
    : layout.iconOnly && !practice ? 'icon' : 'stacked';
  const canEnterPractice = !practice && Platform.OS === 'web' && typeof window !== 'undefined';

  // ---- facts ---------------------------------------------------------------
  const settledDate = lastSettled ? keepTogether(humanDate(lastSettled)) : null;
  // The days a named result covers: "Oct 28", or "Oct 21–27" after +1 week,
  // held together (word joiners keep the dash with its dates).
  const resultDate = span ? keepTogether(span.label).replace('–', '\u2060–\u2060') : settledDate;
  // The narrowest rows (a phone at high zoom, a folded row) keep a short day
  // count, "Day 16/174"; the bar after it is the season's progress.
  // A landscape row with Rules beside More (walk 15 T1-05): the short day
  // and closer gaps leave it room.
  const rulesInRow = folded && rulesInFoldedRow(tiny, width);
  const shortDay = layout.compact || (folded && !foldedFacts) || rulesInRow;
  // A folded narrow row (a phone at 200% or 400% zoom) has no lead line
  // with the date, so the day says it first: "Oct 20 · Day 0" rather than
  // "Day 0/174" (walk 8 T3-05); the bar beside it shows how far.
  const dateFirst = folded && !foldedFacts;
  const plainDayText = progress
    // With a reader's text spacing the narrowest folded row puts the day
    // under the date, so Settings keeps its place beside them (walk 9 T3-05).
    ? (dateFirst ? practiceDateDay(progress, lastSettled, readerSpacing && width < CHROME_FOLDED_ONE_LINE_MIN_WIDTH) : keepTogether(shortDay ? practiceDayShort(progress) : practiceDayText(progress)))
    : null;
  // A folded phone row has no brand bar or lead line: it names the season
  // from the second one ("S2 · Oct 20 · Day 0"; walk 13 T4-04). Narrower than
  // a 320px phone the tag pushed Settings onto a line of its own; the spoken
  // status still names the season there.
  const dayText = plainDayText && practice && folded && !foldedFacts && !tiny && width >= CHROME_FOLDED_SETTINGS_WORD_MIN_WIDTH
    ? seasonTagged(plainDayText, seasonNumber)
    : plainDayText;
  // At season end a full bar only repeats "Season complete", and in the
  // narrowest folded row (a phone at 200% zoom) it pushed Settings onto a
  // line of its own; there the words stand alone and the gear sits beside
  // them (walk 5 T4-15).
  const endFold = folded && !tiny && progress?.complete === true && width < CHROME_FOLDED_ONE_LINE_MIN_WIDTH;
  // The short bar where the date joins the day in a narrow folded row, so
  // Settings keeps its place beside them (at 195px the long bar pushed it
  // onto a line of its own).
  const meter = progress && !endFold
    ? <ProgressMeter progress={progress} tiny={tiny || (dateFirst && width < CHROME_TINY_DAY_ONE_LINE_MIN_WIDTH)} />
    : null;
  const money = lastNight === null || noGames ? null : <LastNightMoney tight={tight} value={lastNight} />;
  // The narrowest phones single-space the dots, so the first line keeps to
  // one row even with last night at its finer precision.
  const dot = layout.tightDots ? ' · ' : '  ·  ';

  // The latest night's result names its night: "Oct 21 games +$35K", or
  // "Oct 22: none of your players played". Wherever it shows, the lead leaves
  // the date to it.
  const named = lastNight !== null;
  // "games" keeps to its date (a no-break space), as the figure's words do.
  const nightWords = noGames ? noGamesWords(span?.nobody ?? false, arrangement === 'pair' || (foldedLockNight && width < FOLDED_LOCK_WORDS_MIN_WIDTH)).replace(/^ /, '\u00a0') : ' games ';

  // First line. Practice: the mode, plus the day on a wide screen or the
  // latest night on a phone. Signed in: how far the results go, until a night
  // has a result to name.
  const lead = practice ? (
    <Text key="lead" maxFontSizeMultiplier={1.5} style={[styles.lead, tight && styles.tight]}>
      <Text style={styles.practiceWord}>{PRACTICE_LABEL}</Text>
      {/* From the second season of a visit the row names it, as Leaders'
          "Your seasons this visit" does ("Practice · Season 2 · Oct 20"):
          always on a wide row, and on a phone while no night's figure shares
          the line (a week's span and figure beside it would wrap it). */}
      {seasonNumber >= 2 && (arrangement === 'wide' || !named) ? `${dot}${keepTogether(`Season ${seasonNumber}`)}` : null}
      {settledDate && (!named || arrangement === 'pair') ? `${dot}${named ? resultDate : settledDate}` : null}
      {/* A wide row has room to say where the season is today, not only which
          nights the figure beside it covers (walk 5 T2-07). */}
      {settledDate && named && arrangement === 'wide' ? `${dot}${settledDate}` : null}
      {arrangement === 'wide' && dayText ? <Text style={styles.leadMuted}>{`${dot}${dayText}`}</Text> : null}
      {arrangement === 'pair' && named ? (
        // The words at the facts' size, so "Oct 22: none of your players
        // played" keeps to one line on a 360px phone.
        <Text style={styles.leadMuted}>
          <Text style={styles.leadNightWords}>{nightWords}</Text>
          {money}
        </Text>
      ) : null}
    </Text>
  ) : named ? null : (
    <Text key="lead" maxFontSizeMultiplier={1.5} style={[styles.lead, tight && styles.tight]}>
      {settledDate ? `Games through ${settledDate}` : 'No games settled yet'}
    </Text>
  );
  // A folded row with its facts beside the controls draws Cancel queued
  // before +1 night for a run; the games figure makes room for it (the
  // notice above the tabs carries the run's result meanwhile; walk 15 T4-01).
  const cancelTakesNight = folded && cancelPlace(folded, tiny, width) === 'night' && queuedCancelShows;
  const night = !named || arrangement === 'pair' || cancelTakesNight ? null : (
    <Text key="night" maxFontSizeMultiplier={1.5} style={[styles.fact, tight && styles.tight]}>
      {resultDate ?? 'Latest'}
      <Text style={styles.factLabel}>{nightWords}</Text>
      {money}
    </Text>
  );
  const day = tiny && progress ? (
    // Two short lines over the progress bar (and the padlock on a locked
    // night), in the width More leaves; from 240px "Day 1 of 174" on one
    // line with the bar beside it (walk 6 T3-05).
    <View key="day" style={width >= CHROME_TINY_DAY_ONE_LINE_MIN_WIDTH ? styles.dayFact : styles.dayTiny}>
      <Text maxFontSizeMultiplier={1.2} style={[styles.fact, styles.factLabel, styles.tight]}>
        {practiceDateDay(progress, lastSettled, width < CHROME_TINY_DAY_ONE_LINE_MIN_WIDTH)}
      </Text>
      <View style={styles.dayTinyMarks}>
        {meter}
        {/* The padlock with the date moves reopen after ("🔒 Oct 28"): a
            lone padlock sent a low-vision player to press LOCKED to learn
            it (walk 11 T3-08); More opens on the lock's words (walk 3 T3-29). */}
        {locked ? (
          <View aria-label={lockIconName(lockDate)} role="img" style={[styles.lock, styles.lockChip]}>
            <LockIcon color={colors.goldInk} size={12} />
            {lockDate ? (
              <Text maxFontSizeMultiplier={1.2} style={[styles.fact, styles.lockLine, styles.tight]}>
                {keepTogether(humanDate(lockDate))}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  ) : dayText && arrangement !== 'wide' ? (
    <View key="day" style={styles.dayFact}>
      <Text maxFontSizeMultiplier={1.5} style={[styles.fact, styles.factLabel, tight && styles.tight]}>
        {dayText}
      </Text>
      {meter}
    </View>
  ) : null;
  // A locked night keeps the day and the next games; the lock adds its own
  // line: the sentence Roster and Market use (terms.rosterReopensLine) plus
  // why moves pause. Wide rows lead it with the ROSTER LOCKED tag.
  // A short laptop window: the lock's short words beside the day (walk 11 T2-09).
  const lockCompact = locked && arrangement === 'wide' && !folded && lockBesideDay(height, true);
  const lockTag = arrangement === 'wide' && !folded && !lockCompact;
  // Nobody held: no "your players still play" (walk 10 T2-13). The line
  // says what to do instead, and the hint beside it, which said the same,
  // gives way to it.
  const lockSaysNobody = locked && lockTag && emptyNow && !progress?.complete;
  // A portrait phone's practice row carries the lock beside +1 week, so a
  // week landing on a lock adds no line here (walk 9 T4-08).
  const lockInControls = practice && !layout.wide && !folded && width >= PHONE_SLOT_MIN_WIDTH && !progress?.complete;
  const lockShortInRow = foldedLockNight && width < (emptyNow ? FOLDED_LOCK_WORDS_MIN_WIDTH_NOBODY : FOLDED_LOCK_WORDS_MIN_WIDTH);
  const lock = tiny || lockInControls ? null : locked && ((folded && !foldedFacts) || lockCompact || lockShortInRow) ? (
    // The narrowest folded rows: "Locked · Nov 1" under the day count, so
    // the row still says it in words and Settings keeps the first line (the
    // padlock alone pushed it down a line, walk 3 T3-29). One image to a
    // screen reader, named in full: "Roster locked until after Nov 1".
    <View aria-label={lockIconName(lockDate)} key="lock" role="img" style={[styles.lock, styles.lockChip]}>
      <LockIcon color={colors.goldInk} size={12} />
      <Text maxFontSizeMultiplier={1.5} style={[styles.fact, styles.lockLine, styles.tight]}>
        {keepTogether(lockShortText(lockDate))}
      </Text>
    </View>
  ) : locked ? (
    // With the padlock (phones) the sentence wraps beside it, never under it,
    // so a two-line sentence costs two lines, not three.
    <View key="lock" style={[styles.lock, !lockTag && styles.lockBeside]}>
      {lockTag ? <Tag tone="gold">ROSTER LOCKED</Tag> : <LockIcon color={colors.goldInk} />}
      <Text
        // Spoken whole everywhere; beside the padlock (phones) the line shows
        // only when moves reopen, so a locked night keeps the frame to one
        // line (the padlock and the Rules say why moves pause).
        accessibilityLabel={lockLine(lockDate, emptyNow)}
        maxFontSizeMultiplier={1.5}
        style={[
          styles.fact,
          lockTag ? styles.factLabel : [styles.lockLine, styles.lockText],
          (tight || (!lockTag && !layout.largeText)) && styles.tight,
        ]}
      >
        {lockTag
          ? (lockSaysNobody ? lockLine(lockDate, true) : lockLine(lockDate).replace(LOCK_REASON, keepTogether(LOCK_REASON)))
          : rosterReopensLine(lockDate)}
      </Text>
    </View>
  ) : null;
  const upcoming = progress?.complete ? (
    // "Season complete · Final score +$209.8K": a finished season states its
    // result, in the score's colour. The way on is the one Play another
    // season button beside or under this row; its name here as grey text
    // read as a second, tappable-looking control (walk 3 T4-04, T2-16).
    // Compact rows have no room for it; the notice and the Roster card carry
    // the final score there.
    // Compact rows (a phone at 200% zoom, 180px) say it shorter, on the line
    // the last run's figure had: it was the only number there (walk 7 T4-09).
    <Text key="over" maxFontSizeMultiplier={1.5} style={[styles.fact, tight && styles.tight]}>
      <Text style={styles.factLabel}>{layout.compact ? 'Final ' : 'Final score '}</Text>
      <LastNightMoney tight={tight} value={bootstrap.account.cumulativePnl} />
    </Text>
  ) : (
    queuedThrough ? (
      // A queued run of weeks says where it ends, where the next games were
      // (walk 11 T4-N2: "+1 WEEK ×12 QUEUED" left the date maths to you).
      <Text key="next" maxFontSizeMultiplier={1.5} style={[styles.fact, tight && styles.tight]}>
        <Text style={styles.factLabel}>Queued through </Text>
        {keepTogether(humanDate(queuedThrough))}
      </Text>
    ) : foldedLockNight ? null : (
      <Text key="next" maxFontSizeMultiplier={1.5} style={[styles.fact, tight && styles.tight]}>
        <Text style={styles.factLabel}>{progress?.day === 0 ? 'Season opens ' : 'Next '}</Text>
        {next ? keepTogether(next) : 'not scheduled yet'}
      </Text>
    )
  );

  let facts;
  if (folded && !foldedFacts) {
    // Folded and narrow: the day and its progress, with "Locked · Nov 1"
    // under them on a locked night, or else the short practice hint ("Add a
    // player first"), two tight lines inside the 44px row. The quiet +1
    // night / +1 week looked disabled for no reason without it (walk 4 T3-11).
    const hintUnderDay = !tiny && !locked && practiceHintShort ? (
      <Text key="hint" maxFontSizeMultiplier={1.5} nativeID={PRACTICE_HINT_ID} style={[styles.fact, styles.factLabel, styles.tight]}>
        {practiceHintShort}
      </Text>
    ) : null;
    facts = (
      <>
        {day}
        {lock}
        {hintUnderDay}
      </>
    );
  } else if (arrangement === 'wide') {
    facts = (
      <View style={[styles.line, styles.lineWide, rulesInRow && styles.lineWideRoomy]}>
        <View style={styles.dayFact}>
          {lead}
          {meter}
        </View>
        {lockCompact ? lock : null}
        {night}
        {upcoming}
        {lockCompact ? null : lock}
        {practiceHint && (layout.merged || foldedFacts) && !lockSaysNobody && !(foldedFacts && noGames && span?.nobody) ? (
          <Text key="hint" maxFontSizeMultiplier={1.5} nativeID={PRACTICE_HINT_ID} style={[styles.fact, styles.factLabel]}>
            {layout.merged ? practiceHint : practiceHintShort}
          </Text>
        ) : null}
      </View>
    );
  } else if (arrangement === 'pair') {
    facts = (
      <>
        {lead}
        <View style={styles.line}>
          {day}
          {upcoming}
        </View>
        {lock}
      </>
    );
  } else {
    facts = (
      <>
        {lead}
        {night}
        {day ? (
          <View style={styles.line}>
            {day}
            {upcoming}
          </View>
        ) : upcoming}
        {lock}
      </>
    );
  }

  // ---- controls ------------------------------------------------------------
  // After an uncertain roster action the refresh control becomes the one gold
  // thing in the row: reconciling is what unlocks roster moves again.
  const refreshControl = reconciliationRequired ? (
    <ChromeButton
      accessibilityLabel="Reconcile account after uncertain roster action"
      busy={isRefreshing}
      disabled={disabled}
      icon={(color) => <RefreshIcon color={color} />}
      key="reconcile"
      label="RECONCILE"
      onPress={() => {
        refreshData();
      }}
      placement={placement === 'icon' ? 'stacked' : placement}
      tone="gold"
    />
  ) : practice ? null : (
    <ChromeButton
      accessibilityLabel="Refresh per-game market data"
      busy={isRefreshing}
      disabled={disabled}
      icon={(color) => <RefreshIcon color={color} />}
      key="refresh"
      label={isRefreshing ? 'Updating' : 'Refresh'}
      onPress={() => {
        refreshData();
      }}
      placement={placement}
    />
  );

  // A short window has no brand bar, so Settings lives in this row (icon only
  // when folded where the row is tight; its name stays "Settings"). A folded
  // row with room for the facts keeps its word under the icon, as More beside
  // it does: a bare sliders icon was a guess in landscape (walk 11 T1-06).
  // The two-line folded row (a 320px phone) has the height for the word too:
  // a bare sliders icon read as "filters" beside the Market's (walk 13
  // T4-08, T1-11).
  const settingsPlacement: ChromeButtonPlacement = folded
    ? (foldedFacts || (!tiny && width >= CHROME_FOLDED_SETTINGS_WORD_MIN_WIDTH && width < CHROME_FOLDED_ONE_LINE_MIN_WIDTH) ? 'stacked' : 'icon')
    : placement;
  const settingsControl = short && !tiny ? (
    <ChromeButton
      accessibilityLabel="Settings"
      icon={(color) => <SettingsIcon color={color} />}
      key="settings"
      label="Settings"
      onPress={() => {
        openSettings();
      }}
      placement={settingsPlacement}
    />
  ) : null;
  // Folded below ~340px the row takes two lines: the day beside Settings,
  // then +1 night, +1 week and More edge to edge.
  const foldTwoLines = folded && !tiny && width < CHROME_FOLDED_ONE_LINE_MIN_WIDTH;
  // At season end the Roster's second line held More alone (walk 16 T4-06):
  // More joins "Season complete" and Settings instead.
  const endBeside = moreBesideSettings(foldTwoLines, progress?.complete === true, screenName);
  const holdFacts = practice && !layout.wide && !folded && !reconciliationRequired;

  return (
    <View
      nativeID="status-strip"
      // The page's banner wraps the frame at every width (App; walk 14
      // T3-03), so this row takes no role of its own.
      style={[
        styles.strip,
        !practice && styles.stripLive,
        practice && layout.merged && styles.stripMerged,
      ]}
    >
      <View
        style={[
          styles.row,
          layout.narrow && styles.rowNarrow,
          folded && styles.rowFolded,
          tiny && styles.rowTiny,
          layout.largeText && styles.rowLarge,
        ]}
      >
        {/* One sentence for screen readers: a name on a plain container was
            ignored and the fragments read piecemeal (walk 4 T3-12). The drawn
            facts below say the same and are hidden from them. */}
        <Text style={visuallyHidden}>{summary}</Text>
        <View
          aria-hidden
          onLayout={holdFacts ? (event) => {
            const next = Math.round(event.nativeEvent.layout.height);
            setFactsFloor((current) => (current.width === width && current.height >= next ? current : { width, height: next }));
          } : undefined}
          style={[
            styles.facts,
            holdFacts && factsFloor.width === width && factsFloor.height > 0 && { minHeight: factsFloor.height },
            practice ? (layout.compact ? styles.factsCompact : styles.factsPractice) : styles.factsLive,
            // A locked night adds a line; the lines sit flush so the frame
            // keeps its height budget.
            (tight || locked) && styles.factsTight,
            folded && !foldedFacts && styles.factsFolded,
            tiny && styles.factsTiny,
            // A reader's text spacing: the facts wrap in the room beside
            // Settings instead of pushing it onto a line of its own.
            foldTwoLines && readerSpacing && styles.factsShrink,
            // Enlarged text signed in: three controls would squeeze the facts
            // into a sliver, so the facts take the row and the controls wrap.
            layout.largeText && !practice && styles.factsFull,
          ]}
        >
          {facts}
        </View>
        {foldTwoLines && !endBeside ? settingsControl : null}
        <View style={[styles.actions, foldTwoLines && !endBeside && styles.actionsFull]}>
          {practice && layout.merged ? <PracticeControls inline /> : null}
          {folded ? (
            <PracticeControls
              endBeside={endBeside}
              folded
              // Rules joins More only where the row has no room for it.
              onRules={rulesInRow ? undefined : () => setRulesOpen(true)}
              onSettings={tiny ? openSettings : undefined}
              tiny={tiny}
            />
          ) : null}
          {canEnterPractice ? (
            <ChromeButton
              accessibilityLabel="Practice: play a practice season in this browser. Your account is untouched."
              icon={(color) => <PracticeIcon color={color} />}
              label={PRACTICE_LABEL}
              onPress={() => {
                window.location.search = '?mock';
              }}
              placement={placement}
            />
          ) : null}
          {refreshControl}
          {folded && !rulesInRow ? null : (
            <ChromeButton
              accessibilityLabel="Rules: show the game rules"
              icon={(color) => <RulesIcon color={color} />}
              label="Rules"
              onPress={() => setRulesOpen(true)}
              placement={folded ? 'stacked' : placement}
            />
          )}
          {foldTwoLines && !endBeside ? null : settingsControl}
        </View>
      </View>
      <RulesSheet
        onClose={() => {
          setRulesOpen(false);
          setRulesSection(null);
        }}
        rules={rules}
        section={rulesSection}
        visible={rulesOpen}
      />
    </View>
  );
}

/**
 * Last night's figure inside a line of facts (green, red, or muted at $0), at
 * the Results night header's precision ("+$322.5K" rather than "+$323K"), so
 * the bar and that night's header read the same (chromeView.lastNightFigure).
 * Styled as kit Money, which has no fine precision.
 */
function LastNightMoney({ tight, value }: { tight: boolean; value: number }) {
  const figure = lastNightFigure(value);
  return (
    <Text
      accessibilityLabel={figure.accessibilityLabel}
      maxFontSizeMultiplier={1.4}
      style={[styles.money, tight ? styles.moneyTight : styles.moneyBody, { color: moneyColor(value) }]}
    >
      {figure.text}
    </Text>
  );
}

/**
 * The season's progress, right after the day count that labels it: a thin
 * filled track, gold as far as the season has gone. Outlined, it read as an
 * empty text box or an off switch at day 0 (walk 8 T1-03); now it is a plain
 * rule until the first night, then fills. Named by how much is played
 * ("Season 9% played"), with the day as its value.
 */
function ProgressMeter({ progress, tiny = false }: { progress: PracticeProgress; tiny?: boolean }) {
  return (
    <View
      accessibilityLabel={seasonPlayedLabel(progress)}
      accessibilityRole="progressbar"
      aria-valuemax={progress.total}
      aria-valuemin={0}
      aria-valuenow={progress.day}
      aria-valuetext={`Day ${progress.day} of ${progress.total}`}
      style={[styles.meter, tiny && styles.meterTiny]}
    >
      <View style={styles.meterTrack} />
      <View style={[styles.meterFill, { width: progress.day === 0 ? 0 : `${Math.max(progress.fraction * 100, 4)}%` }]} />
    </View>
  );
}

/**
 * Scoring in steps a fan can skim: three short lines (pay his price and
 * collect his dividend; what the dividend is; beat the price and you profit),
 * what net points are, then one game worked through, set apart, in K. It was
 * one 11-line paragraph with the example buried at its end (walk 6 T1-03).
 */
function ScoringText({ scoring }: { scoring: ScoringParts }) {
  const example = scoring.example.startsWith(EXAMPLE_LEAD) ? scoring.example.slice(EXAMPLE_LEAD.length) : scoring.example;
  return (
    <>
      <View style={styles.scoringLines}>
        {scoring.lines.map((line) => <Text key={line} style={styles.paragraph}>{line}</Text>)}
      </View>
      <Text style={styles.paragraph}>{scoring.netPoints}</Text>
      <View style={styles.example}>
        <Text style={styles.exampleLabel}>Example</Text>
        <Text style={styles.paragraph}>{example}</Text>
      </View>
      <Text style={styles.paragraph}>{scoring.luck}</Text>
    </>
  );
}

/**
 * The rules, over the screen. Plain English first (the shared rules copy, in
 * short paragraphs: dividends and net points, the roster, shorts, the score,
 * bad games), then the numbers a player checks before a move.
 */
function RulesSheet({
  visible,
  onClose,
  rules,
  section = null,
}: {
  visible: boolean;
  onClose: () => void;
  rules: PerGameRuleset;
  /** A heading to open at, focused (openRules('Scoring')). */
  section?: string | null;
}) {
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  // A phone at 400% zoom (98px wide): Done takes a full-width row under the
  // title (it showed as "Do"), and the gutters narrow (walk 3 T3-31).
  const narrow = sheetNarrow(width);
  // Back closes the sheet; the app behind it is inert while it is open.
  useSheetHistory(visible, onClose);
  // A wide window floats the rules under the frame, edged all round (walk 5
  // T2-05); a phone keeps the sheet from the status row down.
  const floats = sheetFloats(width, height);
  const sheetTop = visible ? (floats ? measuredFloatTop() : measuredSheetTop()) : null;
  const practiceRules = usePracticeRulesContext();
  const shown = useSheetShown(visible);
  // Each heading's node, for the contents line and openRules(section): the
  // sheet scrolls it to the top and focuses it (walk 15 T1-N1, T3-03).
  const headingNodes = useRef(new Map<string, HTMLElement>());
  const doneRef = useRef<View>(null);
  const bodyRef = useRef<ScrollView>(null);
  const headingRef = (heading: string) => (node: unknown) => {
    if (node) headingNodes.current.set(heading, node as HTMLElement);
    else headingNodes.current.delete(heading);
  };
  const jumpTo = (heading: string) => {
    const node = headingNodes.current.get(heading);
    const scroller = (bodyRef.current as unknown as { getScrollableNode?: () => HTMLElement | null } | null)?.getScrollableNode?.();
    if (!node?.getBoundingClientRect) return;
    if (scroller) scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - space.sm;
    node.focus?.({ preventScroll: true });
  };
  // A heading focused by a jump is not a Tab stop of its own; Tab goes on
  // from it to the control after its section, as a reader expects (walk 16
  // T3-02: it went back to Done at the top).
  const jumpable = (heading: string) => ({
    ref: headingRef(heading),
    ...({ tabIndex: -1 } as object),
  });
  useEffect(() => {
    if (!shown || !visible || !section) return undefined;
    // After the sheet's own first focus (Done) has landed.
    const timer = setTimeout(() => jumpTo(section), 120);
    return () => clearTimeout(timer);
  }, [shown, visible, section]);
  // Touch-only devices fold the Keyboard section (walk 15 T1-01).
  const [keysOpen, setKeysOpen] = useState(false);
  useEffect(() => {
    if (!visible) setKeysOpen(false);
  }, [visible]);
  const foldKeys = Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && rulesFoldKeyboard(window.matchMedia('(pointer: coarse)').matches, window.matchMedia('(hover: hover)').matches);
  if (!shown) return null;
  // One line of contents: each jumps to its heading (walk 15 T1-N1). Pinned
  // under the title bar where the sheet has room, so the links stay in view
  // while the rules scroll (walk 16 T2-N2).
  const pinContents = rulesContentsPinned(width, height);
  const contents = (
    <View aria-label="Rules contents" role="navigation" style={[styles.contents, pinContents && styles.contentsPinned]}>
      {RULES_CONTENTS.map((entry, index) => (
        <View key={entry.heading} style={styles.contentsEntry}>
          {index > 0 ? <Text aria-hidden style={styles.contentsDot}>·</Text> : null}
          <Pressable
            accessibilityLabel={`${entry.label}: go to the section`}
            accessibilityRole="button"
            onPress={() => jumpTo(entry.heading)}
            style={({ pressed }) => [styles.contentsLink, pressed && styles.pressed]}
          >
            <Text style={styles.contentsText}>{entry.label}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
  const presentation = perGameRulesPresentation(rules, practiceRules);
  const startingScore = presentation.facts.find((fact) => fact.label === 'Starting score')?.value;
  const fee = exactMoney(rules.transactionFeeDollars);
  const facts = [
    { label: 'ROSTER', value: positionSlotHint('long', rules.longSlotLimit) },
    { label: 'SHORTS', value: positionSlotHint('short', rules.shortSlotLimit) },
    { label: 'DIVIDEND', value: dividendText(rules.dividendBasis, rules.dividendDollarsPerNetPoint) },
    { label: 'OPEN FEE', value: `${fee} to add a player or open a short` },
    { label: 'DROP FEE', value: `${fee} to drop a player or close a short` },
    { label: 'SHORT TERM', value: shortTermText(rules.shortTermDays) },
    ...(startingScore ? [{ label: 'SCORE', value: `Starts at ${startingScore}` }] : []),
  ];
  return (
    <Modal
      accessibilityLabel="Game rules"
      animationType={reducedMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      {/* The scrim closes on a tap but can never take focus. A Pressable, even
          with tabIndex -1, is still focusable by script, and react-native-web's
          modal focus trap focuses the first focusable child it finds, so the
          scrim would be the first stop again. A plain view answering the
          responder system has no tabindex at all; keyboard and screen-reader
          users close with Done or Escape. */}
      <View
        onResponderRelease={unlessSettling(onClose)}
        onStartShouldSetResponder={() => true}
        style={styles.scrim}
      />
      {/* Framed like Settings: a sheet from the bottom, starting where the
          status row starts (under the brand bar; at the top of a short
          window), so no line of the frame is cut in half behind the scrim
          (walk 4 T1-01). Scrolls inside. */}
      <View style={[styles.sheet, floats && styles.sheetFloating, chromeFolded(height, width) && styles.sheetShort, sheetTop !== null && { marginTop: sheetTop }]}>
        <View style={[styles.sheetHead, narrow && styles.sheetHeadNarrow]}>
          <Text accessibilityRole="header" {...headingLevel(2)} style={styles.sheetTitle}>Game rules</Text>
          <Pressable
            accessibilityLabel="Done, close the game rules"
            accessibilityRole="button"
            onPress={unlessSettling(onClose)}
            ref={doneRef}
            style={({ pressed }) => [styles.done, narrow && styles.doneNarrow, pressed && styles.pressed]}
          >
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
        {pinContents ? contents : null}
        {/* The text scrolls on its own, so the keyboard can reach and scroll
            it: a named region with the app's 2px ring (the global
            [tabindex]:focus-visible rule), not an unnamed stop with the
            browser's thin default (walk 2 T3-14). */}
        <ScrollView
          aria-label="Rules text"
          contentContainerStyle={[styles.sheetContent, narrow && styles.sheetContentNarrow, { paddingBottom: space.xl + insets.bottom }]}
          ref={bodyRef}
          role="region"
          style={styles.sheetBody}
          tabIndex={0}
        >
          {pinContents ? null : contents}
          {/* In steps, each under a short heading to jump by: Goal, Scoring,
              Shorts, Fees, Prices, Locks (walk 5 T1-09, T3-13). */}
          <View style={styles.explanation}>
            {rulesSections(presentation.explanation).map((part) => (
              <View key={part.heading} style={styles.rulesSection}>
                <Text accessibilityRole="header" {...headingLevel(3)} {...jumpable(part.heading)} style={styles.sectionTitle}>{part.heading}</Text>
                {part.heading === 'Scoring' ? <ScoringText scoring={presentation.scoring} /> : (
                  <Text style={styles.paragraph}>{part.text}</Text>
                )}
              </View>
            ))}
          </View>
          {/* The numbers a player checks before a move, as terms and their
              values under a heading (they read as one run of loose text). */}
          <View style={styles.glossary}>
            <Text accessibilityRole="header" {...headingLevel(3)} style={styles.glossaryTitle}>At a glance</Text>
            <View aria-label="At a glance" role="list" style={styles.factList}>
              {facts.map((fact) => (
                <View key={fact.label} role="listitem" style={styles.factRow}>
                  {/* Drawn in capitals, spoken in sentence case ("Open fee"):
                      capitals reach a screen reader as capitals, and some
                      spell "SCORE" out (walk 6 T3-09). */}
                  <Text role="term" style={[styles.factName, narrow && styles.factNameNarrow]}>
                    <Text aria-hidden>{fact.label}</Text>
                    <Text style={styles.spokenTerm}>{spokenLabel(fact.label)}</Text>
                  </Text>
                  {/* Narrow, a phrase held together ("$40,000 for each net point")
                      is wider than the sheet, so it may wrap between its words. */}
                  <Text role="definition" style={styles.factValue}>{narrow ? fact.value.replace(/\u00a0/g, ' ') : fact.value}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.glossary}>
            <Text accessibilityRole="header" {...headingLevel(3)} {...jumpable('Words in the game')} style={styles.glossaryTitle}>
              Words in the game
            </Text>
            {/* A list of terms, each with its meaning, so a screen reader
                hears "list, 9 items" and one term at a time. */}
            <View aria-label="Words in the game" role="list" style={styles.glossaryList}>
              {presentation.glossary.map((entry) => (
                <View key={entry.term} role="listitem" style={styles.glossaryRow}>
                  <Text role="term" style={styles.glossaryTerm}>{entry.term}</Text>
                  <Text role="definition" style={styles.glossaryMeaning}>{entry.meaning}</Text>
                </View>
              ))}
            </View>
          </View>
          {/* On a touch screen, its gestures first (walk 13 T1-14). */}
          {Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            && window.matchMedia('(pointer: coarse)').matches ? (
            <View style={styles.glossary}>
              <Text accessibilityRole="header" {...headingLevel(3)} style={styles.glossaryTitle}>Touch</Text>
              <View aria-label="Touch" role="list" style={styles.glossaryList}>
                {TOUCH_TIPS.map((entry) => (
                  <View key={entry.keys} role="listitem" style={styles.glossaryRow}>
                    <Text role="term" style={styles.glossaryTerm}>{entry.keys}</Text>
                    <Text role="definition" style={styles.glossaryMeaning}>{entry.does}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          {/* The keys, for anyone playing without a mouse (walk 12 T3-N1).
              On a touch-only device they fold behind one toggle, so the rules
              end on the touch tips and Got it (walk 15 T1-01). */}
          {Platform.OS === 'web' ? (
            <View style={styles.glossary}>
              {foldKeys ? (
                <Button
                  accessibilityLabel={KEYBOARD_SHORTCUTS_LABEL}
                  expanded={keysOpen}
                  label={`${KEYBOARD_SHORTCUTS_LABEL} ${keysOpen ? '▾' : '›'}`}
                  onPress={repeatSafe(() => setKeysOpen((open) => !open))}
                  style={styles.keysToggle}
                  variant="quiet"
                />
              ) : (
                <Text accessibilityRole="header" {...headingLevel(3)} style={styles.glossaryTitle}>Keyboard</Text>
              )}
              {foldKeys && !keysOpen ? null : (
              <View aria-label="Keyboard" role="list" style={styles.glossaryList}>
                {KEYBOARD_KEYS.map((entry) => (
                  <View key={entry.keys} role="listitem" style={styles.glossaryRow}>
                    <Text role="term" style={styles.glossaryTerm}>{entry.keys}</Text>
                    <Text role="definition" style={styles.glossaryMeaning}>{entry.does}</Text>
                  </View>
                ))}
              </View>
              )}
            </View>
          ) : null}
          {/* Read to the end on a phone, the way out is here, not back at the
              top corner (Done stays there too; walk 5 T1-09). */}
          <Button accessibilityLabel="Got it, close the game rules" label="Got it" onPress={onClose} style={styles.gotIt} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // In practice the practice bar continues the frame directly underneath, and
  // its progress rule is the frame's bottom edge; signed in, this row is the
  // whole frame and draws its own.
  strip: {
    backgroundColor: colors.chromeSoft,
  },
  // Desktop practice: the clock controls share this row, so it gets the
  // breathing room the separate practice bar has on a phone.
  stripMerged: {
    paddingVertical: space.xs,
  },
  stripLive: {
    paddingVertical: 3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  // The day count and its progress bar travel together.
  dayFact: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
  },
  // A thin rule, no visible edge (an outline read as an input; walk 8
  // T1-03). The edge is transparent, which forced-colors mode draws, so the
  // bar still shows there.
  meter: {
    width: 44,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  // The rail: the theme's text at a quarter strength, so it shows in Light
  // (not cream on cream; walk 2 T1-26) and the gold fill stands out from it
  // in every theme (a grey rail matched High contrast's yellow at 1:1).
  meterTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.text,
    opacity: 0.25,
  },
  meterTiny: {
    width: 30,
  },
  // Gold ink: the bright gold on the dark themes, a deep gold in Light,
  // where the bright one barely parts from the track.
  // Drawn as a border, not a fill: forced colours (Windows contrast themes)
  // drop background colours, and the rail read as 0% played (walk 9 T3-08).
  meterFill: {
    height: 0,
    borderTopWidth: 4,
    borderTopColor: colors.goldInk,
  },
  // Folded and narrow: the facts are just the day, sized to it.
  factsFolded: {
    flexBasis: 'auto',
    flexShrink: 0,
  },
  factsShrink: {
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  // Tiny: the day in two lines over its bar, beside More.
  rowTiny: {
    columnGap: 4,
    paddingHorizontal: 2,
  },
  factsTiny: {
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
  },
  dayTiny: {
    gap: 2,
  },
  dayTinyMarks: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
  },
  // Folded below ~340px: the practice controls take their own full line.
  actionsFull: {
    flexBasis: '100%',
    marginLeft: 0,
  },
  row: {
    minHeight: control.height,
    flexDirection: 'row',
    alignItems: 'center',
    // Enlarged text wraps the controls under the facts instead of truncating.
    flexWrap: 'wrap',
    columnGap: space.sm,
    rowGap: 2,
    paddingHorizontal: space.lg,
  },
  rowNarrow: {
    columnGap: 6,
    paddingHorizontal: space.md,
  },
  // Folded: slimmer gutters so day, +1 night, +1 week, More and Settings
  // share one line down to 340px, locked nights included.
  rowFolded: {
    columnGap: 6,
    paddingHorizontal: space.sm,
  },
  rowLarge: {
    paddingVertical: space.xs,
  },
  facts: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    gap: 1,
  },
  // The narrowest the facts get before the controls drop below them.
  factsPractice: {
    flexBasis: 180,
  },
  factsCompact: {
    flexBasis: 100,
  },
  factsLive: {
    flexBasis: 165,
  },
  factsTight: {
    gap: 0,
  },
  factsFull: {
    flexBasis: '100%',
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: space.md,
  },
  // One line of mixed sizes (the 13px clock, 12px facts) sits on a baseline.
  lineWide: {
    alignItems: 'baseline',
    columnGap: space.xl,
  },
  // A landscape row that keeps Rules: the facts sit a little closer.
  lineWideRoomy: {
    columnGap: space.lg,
  },
  lead: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
  },
  practiceWord: {
    color: colors.goldInk,
    fontWeight: weight.heavy,
  },
  leadMuted: {
    color: colors.muted,
    fontWeight: weight.medium,
  },
  leadNightWords: {
    fontSize: type.caption,
  },
  fact: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
  },
  factLabel: {
    color: colors.muted,
    fontWeight: weight.medium,
  },
  tight: {
    lineHeight: 15,
  },
  lock: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 6,
  },
  lockLine: {
    color: colors.goldInk,
    fontWeight: weight.bold,
  },
  lockBeside: {
    flexWrap: 'nowrap',
    alignItems: 'flex-start',
  },
  // "Locked · Nov 1" beside a 12px padlock, one line.
  lockChip: {
    flexWrap: 'nowrap',
    columnGap: 4,
  },
  lockText: {
    flexShrink: 1,
    minWidth: 0,
  },
  money: {
    fontFamily: fonts.display,
    fontVariant: ['tabular-nums'],
    fontWeight: weight.heavy,
  },
  moneyBody: {
    fontSize: type.body,
  },
  // One size per line keeps the tight lines at exactly their height.
  moneyTight: {
    fontSize: type.caption,
  },
  actions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  pressed: {
    opacity: 0.65,
  },
  // ---- rules sheet ----------------------------------------------------------
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  // The same frame as the Settings sheet (SettingsSheet styles.sheet).
  sheet: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    marginTop: 64,
    marginBottom: 0,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  // A wide window: a panel under the frame, edged all round and short of the
  // bottom (it ran into the window's bottom edge; walk 5 T2-05).
  sheetFloating: {
    marginBottom: space.xl,
    borderBottomWidth: 1,
    borderRadius: radius.lg,
  },
  // A short window keeps the rules, not the gap above them.
  sheetShort: {
    marginTop: space.sm,
  },
  sheetHead: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: space.lg,
    paddingRight: space.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  // Narrow (400% zoom): the title, then Done on its own full-width row.
  sheetHeadNarrow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    rowGap: space.xs,
    paddingLeft: space.sm,
    paddingRight: space.sm,
    paddingVertical: space.xs,
  },
  sheetTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.title,
    fontWeight: weight.heavy,
  },
  // Done with a row to itself reads as a button: a 3:1 edge, words centred.
  doneNarrow: {
    borderWidth: 1,
    borderColor: colors.controlBorder,
    borderRadius: radius.sm,
  },
  done: {
    minHeight: control.height,
    minWidth: control.height,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  doneText: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.bold,
  },
  sheetBody: {
    flex: 1,
  },
  sheetContent: {
    padding: space.lg,
    gap: space.lg,
  },
  sheetContentNarrow: {
    paddingHorizontal: space.sm,
  },
  explanation: {
    gap: space.lg,
  },
  // The contents line under the title: 44px targets, dots between.
  contents: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: -space.sm,
    marginBottom: -space.xs,
  },
  // Under the title bar: the links' words line up with the text's edge
  // (each link pads 6px), a rule under them as under the title.
  contentsPinned: {
    marginTop: 0,
    marginBottom: 0,
    paddingHorizontal: space.lg - 6,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  contentsEntry: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  contentsDot: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.body,
  },
  contentsLink: {
    minHeight: 44,
    // "Fees" alone measured 42px wide: every link is at least 44 (audit).
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  contentsText: {
    color: colors.goldInk,
    fontFamily: fonts.body,
    fontSize: type.body,
    fontWeight: weight.bold,
    textDecorationLine: 'underline',
  },
  // "Keyboard shortcuts ›" on a touch-only device: a quiet row, left-aligned.
  keysToggle: {
    alignSelf: 'flex-start',
  },
  rulesSection: {
    gap: space.xs,
  },
  // Scoring's three short lines sit close, one idea a line.
  scoringLines: {
    gap: 2,
  },
  // The worked game, set apart by a gold rule, not a card.
  example: {
    gap: 2,
    marginVertical: space.xs,
    paddingLeft: space.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.goldInk,
  },
  exampleLabel: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  sectionTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  gotIt: {
    alignSelf: 'stretch',
  },
  paragraph: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: type.value,
    lineHeight: 22,
  },
  factList: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  factRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.md,
    rowGap: 2,
    paddingVertical: space.sm + 2,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  factName: {
    ...labelStyle,
    width: 96,
  },
  // Narrow, the name takes its own width and the value wraps under it.
  factNameNarrow: {
    width: 'auto',
  },
  // A term's spoken name: out of sight, and not in capitals.
  spokenTerm: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
    textTransform: 'none',
  },
  glossary: {
    gap: space.sm,
  },
  glossaryTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  glossaryList: {
    gap: space.sm,
  },
  glossaryRow: {
    gap: 2,
  },
  glossaryTerm: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  glossaryMeaning: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 19,
  },
  factValue: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 180,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 19,
    fontVariant: ['tabular-nums'],
  },
});
