import { useEffect, useMemo, useState } from 'react';
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
import { exactMoney, humanDate, PRACTICE_LABEL } from '../copy/terms';
import {
  CHROME_FOLDED_FACTS_MIN_WIDTH,
  CHROME_FOLDED_ONE_LINE_MIN_WIDTH,
  chromeFolded,
  chromeLayout,
  dividendText,
  EMPTY_ROSTER_HINT,
  keepTogether,
  lastNightFigure,
  lockLine,
  nextGamesText,
  NO_GAMES_TEXT,
  playedOn,
  PRACTICE_OVER_TEXT,
  practiceDayShort,
  practiceDayText,
  practiceProgress,
  type PracticeProgress,
  shortTermText,
  statusSummary,
} from '../data/chromeView';
import { recentEarnings } from '../data/perGameMetrics';
import { perGameRulesPresentation, positionSlotHint, rulesParagraphs } from '../data/perGameRules';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { usePerGame } from '../state/PerGameContext';
import { openSettings, registerRulesOpener } from '../state/uiActions';
import { colors, control, fonts, labelStyle, radius, space, type, weight } from '../theme';
import { headingLevel, moneyColor, Tag } from '../ui/kit';
import { useSheetHistory } from '../web/appHistory';
import { ChromeButton, type ChromeButtonPlacement } from './chrome/ChromeButton';
import { LockIcon, PracticeIcon, RefreshIcon, RulesIcon, SettingsIcon } from './chrome/ChromeIcons';
import { PracticeControls } from './SimBar';

/**
 * How the facts sit beside the controls.
 *  - wide: one line (clock with the day, last night, next games or the lock).
 *  - pair: practice on a phone. "Practice · Nov 5 · Last night +$322.5K" over
 *    "Day 16 of 174 · Next Thu, Nov 6"; on a locked night the lock and when it
 *    lifts take the whole second line.
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
  // Any screen can open the rules (the Roster welcome card does).
  useEffect(() => registerRulesOpener(() => setRulesOpen(true)), []);
  const lastSettled = bootstrap?.game.lastSettledDate ?? null;
  const ledgerItems = bootstrap?.ledger.items;
  const earnings = useMemo(() => recentEarnings(ledgerItems, lastSettled), [lastSettled, ledgerItems]);
  const noGames = useMemo(() => !playedOn(ledgerItems, lastSettled), [lastSettled, ledgerItems]);
  if (!bootstrap) return null;

  const practice = isMockActive();
  const layout = chromeLayout(width, fontScale);
  // A short window hides the brand bar (App), so this row carries Settings;
  // in practice it also folds the practice bar into this one row.
  const short = chromeFolded(height);
  const folded = practice && short && !layout.merged;
  const foldedFacts = folded && width >= CHROME_FOLDED_FACTS_MIN_WIDTH;
  const rules = bootstrap.ruleset;
  const nextGameDate = bootstrap.game.nextGameDate;
  const progress = practice ? practiceProgress(mockSeasonStart(), lastSettled) : null;
  // Before the first night there is no "last night" to report; a day with no
  // games for your players says so rather than "$0".
  const lastNight = progress?.day === 0 ? null : earnings?.night ?? null;
  const next = nextGamesText(nextGameDate);
  // Desktop has no line under +1 night / +1 week, so the empty-roster hint
  // rides at the end of the facts.
  const emptyRoster = practice && !progress?.complete
    && !bootstrap.positions.some((position) => position.status === 'active');

  const pendingBeyondReconciliation = [...pendingActions]
    .some((key) => key !== 'account-mutation');
  const disabled = (
    !isGameplayReady
    || isRefreshing
    || (reconciliationRequired ? pendingBeyondReconciliation : pendingActions.size > 0)
  );

  // A lock covers one game date and lifts once that date's games are
  // settled, so the copy promises "after", and says it.
  const locked = rules.rosterMutationsLocked;
  const lockDate = rules.rosterLockGameDate;
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
    progress: progress ?? undefined,
    lockSentence,
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
  // The narrowest rows (a phone at high zoom, a folded row) keep a short day
  // count, "Day 16/174"; the bar after it is the season's progress.
  const shortDay = layout.compact || (folded && !foldedFacts);
  const dayText = progress
    ? keepTogether(shortDay ? practiceDayShort(progress) : practiceDayText(progress))
    : null;
  const meter = progress ? <ProgressMeter progress={progress} /> : null;
  const money = lastNight === null || noGames ? null : <LastNightMoney tight={tight} value={lastNight} />;
  // The narrowest phones single-space the dots, so the first line keeps to
  // one row even with last night at its finer precision.
  const dot = layout.tightDots ? ' · ' : '  ·  ';

  // First line. Practice: the mode and its date, plus the day on a wide screen
  // or last night on a phone. Signed in: how far the results go.
  const lead = practice ? (
    <Text key="lead" maxFontSizeMultiplier={1.5} style={[styles.lead, tight && styles.tight]}>
      <Text style={styles.practiceWord}>{PRACTICE_LABEL}</Text>
      {settledDate ? `${dot}${settledDate}` : null}
      {arrangement === 'wide' && dayText ? <Text style={styles.leadMuted}>{`${dot}${dayText}`}</Text> : null}
      {arrangement === 'pair' && lastNight !== null ? (
        <Text style={styles.leadMuted}>
          {noGames ? `${dot}${NO_GAMES_TEXT}` : `${dot}Last night `}
          {money}
        </Text>
      ) : null}
    </Text>
  ) : (
    <Text key="lead" maxFontSizeMultiplier={1.5} style={[styles.lead, tight && styles.tight]}>
      {settledDate ? `Games through ${settledDate}` : 'No games settled yet'}
    </Text>
  );
  const night = lastNight === null || arrangement === 'pair' ? null : (
    <Text key="night" maxFontSizeMultiplier={1.5} style={[styles.fact, tight && styles.tight]}>
      <Text style={styles.factLabel}>{noGames ? NO_GAMES_TEXT : 'Last night '}</Text>
      {money}
    </Text>
  );
  const day = dayText && arrangement !== 'wide' ? (
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
  const lockTag = arrangement === 'wide' && !folded;
  const lock = locked && folded && !foldedFacts ? (
    // The narrowest folded row has room for the padlock only; the sentence is
    // in the row's spoken summary and on Market's and Roster's buttons.
    <View key="lock" style={styles.lock}>
      <LockIcon color={colors.goldInk} size={14} />
    </View>
  ) : locked ? (
    <View key="lock" style={styles.lock}>
      {lockTag ? <Tag tone="gold">ROSTER LOCKED</Tag> : <LockIcon color={colors.goldInk} />}
      <Text
        maxFontSizeMultiplier={1.5}
        style={[styles.fact, lockTag ? styles.factLabel : styles.lockLine, tight && styles.tight]}
      >
        {lockLine(lockDate)}
      </Text>
    </View>
  ) : null;
  const upcoming = progress?.complete ? (
    // Compact has no room for both, so it states the fact; its Restart button
    // sits right underneath. Wider rows pair "Season complete" with the way on.
    <Text key="over" maxFontSizeMultiplier={1.5} style={[styles.fact, styles.factLabel, tight && styles.tight]}>
      {layout.compact ? practiceDayText(progress) : PRACTICE_OVER_TEXT}
    </Text>
  ) : (
    <Text key="next" maxFontSizeMultiplier={1.5} style={[styles.fact, tight && styles.tight]}>
      <Text style={styles.factLabel}>{progress?.day === 0 ? 'Season opens ' : 'Next '}</Text>
      {next ? keepTogether(next) : 'not scheduled yet'}
    </Text>
  );

  let facts;
  if (folded && !foldedFacts) {
    // Folded and narrow: the day and its progress, and a padlock when locked.
    facts = (
      <View style={[styles.line, styles.lineFolded]}>
        {day}
        {lock}
      </View>
    );
  } else if (arrangement === 'wide') {
    facts = (
      <View style={[styles.line, styles.lineWide]}>
        <View style={styles.dayFact}>
          {lead}
          {meter}
        </View>
        {night}
        {upcoming}
        {lock}
        {emptyRoster && layout.merged ? (
          <Text key="hint" maxFontSizeMultiplier={1.5} style={[styles.fact, styles.factLabel]}>
            {EMPTY_ROSTER_HINT}
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
  // when folded, where the row is tight; its name stays "Settings").
  const settingsControl = short ? (
    <ChromeButton
      accessibilityLabel="Settings"
      icon={(color) => <SettingsIcon color={color} />}
      key="settings"
      label="Settings"
      onPress={() => {
        openSettings();
      }}
      placement={folded ? 'icon' : placement}
    />
  ) : null;
  // Folded below ~340px the row takes two lines: the day beside Settings,
  // then +1 night, +1 week and More edge to edge.
  const foldTwoLines = folded && width < CHROME_FOLDED_ONE_LINE_MIN_WIDTH;

  return (
    <View
      nativeID="status-strip"
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
          layout.largeText && styles.rowLarge,
        ]}
      >
        <View
          accessibilityLabel={summary}
          accessible
          style={[
            styles.facts,
            practice ? (layout.compact ? styles.factsCompact : styles.factsPractice) : styles.factsLive,
            // A locked night adds a line; the lines sit flush so the frame
            // keeps its height budget.
            (tight || locked) && styles.factsTight,
            folded && !foldedFacts && styles.factsFolded,
            // Enlarged text signed in: three controls would squeeze the facts
            // into a sliver, so the facts take the row and the controls wrap.
            layout.largeText && !practice && styles.factsFull,
          ]}
        >
          {facts}
        </View>
        {foldTwoLines ? settingsControl : null}
        <View style={[styles.actions, foldTwoLines && styles.actionsFull]}>
          {practice && layout.merged ? <PracticeControls inline /> : null}
          {folded ? <PracticeControls folded onRules={() => setRulesOpen(true)} /> : null}
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
          {folded ? null : (
            <ChromeButton
              accessibilityLabel="Rules: show the game rules"
              icon={(color) => <RulesIcon color={color} />}
              label="Rules"
              onPress={() => setRulesOpen(true)}
              placement={placement}
            />
          )}
          {foldTwoLines ? null : settingsControl}
        </View>
      </View>
      <RulesSheet onClose={() => setRulesOpen(false)} rules={rules} visible={rulesOpen} />
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
 * The season's progress, right after the day count that labels it: an
 * outlined track, gold as far as the season has gone. Long enough and edged
 * so it reads as a progress bar, not as a stray dash beside the words (walk 2
 * T1-03); empty on the opening eve.
 */
function ProgressMeter({ progress }: { progress: PracticeProgress }) {
  return (
    <View
      accessibilityLabel={progress.accessibilityLabel}
      accessibilityRole="progressbar"
      aria-valuemax={progress.total}
      aria-valuemin={0}
      aria-valuenow={progress.day}
      style={styles.meter}
    >
      <View style={[styles.meterFill, { width: progress.day === 0 ? 0 : `${Math.max(progress.fraction * 100, 4)}%` }]} />
    </View>
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
}: {
  visible: boolean;
  onClose: () => void;
  rules: PerGameRuleset;
}) {
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // Back closes the sheet; the app behind it is inert while it is open.
  useSheetHistory(visible, onClose);
  const presentation = perGameRulesPresentation(rules);
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
        onResponderRelease={onClose}
        onStartShouldSetResponder={() => true}
        style={styles.scrim}
      />
      {/* Framed like Settings: a sheet from the bottom, 64px below the top
          (less in a short window), scrolling inside. */}
      <View style={[styles.sheet, chromeFolded(height) && styles.sheetShort]}>
        <View style={styles.sheetHead}>
          <Text accessibilityRole="header" {...headingLevel(2)} style={styles.sheetTitle}>Game rules</Text>
          <Pressable
            accessibilityLabel="Done, close the game rules"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.done, pressed && styles.pressed]}
          >
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={[styles.sheetContent, { paddingBottom: space.xl + insets.bottom }]}
          style={styles.sheetBody}
        >
          <View style={styles.explanation}>
            {rulesParagraphs(presentation.explanation).map((paragraph) => (
              <Text key={paragraph} style={styles.paragraph}>{paragraph}</Text>
            ))}
          </View>
          <View style={styles.factList}>
            {facts.map((fact) => (
              <View key={fact.label} style={styles.factRow}>
                <Text style={styles.factName}>{fact.label}</Text>
                <Text style={styles.factValue}>{fact.value}</Text>
              </View>
            ))}
          </View>
          <View style={styles.glossary}>
            <Text accessibilityRole="header" {...headingLevel(3)} style={styles.glossaryTitle}>
              Words in the game
            </Text>
            {presentation.glossary.map((entry) => (
              <View key={entry.term} style={styles.glossaryRow}>
                <Text style={styles.glossaryTerm}>{entry.term}</Text>
                <Text style={styles.glossaryMeaning}>{entry.meaning}</Text>
              </View>
            ))}
          </View>
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
  meter: {
    width: 44,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    backgroundColor: colors.gold,
  },
  // Folded and narrow: the facts are just the day, sized to it.
  factsFolded: {
    flexBasis: 'auto',
    flexShrink: 0,
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
  lineFolded: {
    columnGap: 6,
  },
  // One line of mixed sizes (the 13px clock, 12px facts) sits on a baseline.
  lineWide: {
    alignItems: 'baseline',
    columnGap: space.xl,
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
  sheetTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.title,
    fontWeight: weight.heavy,
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
  explanation: {
    gap: space.sm,
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
  glossary: {
    gap: space.sm,
  },
  glossaryTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
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
