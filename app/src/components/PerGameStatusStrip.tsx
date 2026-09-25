import { useMemo, useState } from 'react';
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
import { exactMoney, humanDate, PRACTICE_LABEL, SHORT_EXPLAINER } from '../copy/terms';
import {
  chromeLayout,
  dividendText,
  explanationParagraphs,
  keepTogether,
  nextGamesText,
  PRACTICE_OVER_TEXT,
  practiceDayText,
  practiceProgress,
  shortTermText,
  statusSummary,
} from '../data/chromeView';
import { recentEarnings } from '../data/perGameMetrics';
import { perGameRulesPresentation, positionSlotHint } from '../data/perGameRules';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { usePerGame } from '../state/PerGameContext';
import { colors, control, fonts, labelStyle, radius, space, type, weight } from '../theme';
import { Money, Tag } from '../ui/kit';
import { ChromeButton, type ChromeButtonPlacement } from './chrome/ChromeButton';
import { PracticeIcon, RefreshIcon, RulesIcon } from './chrome/ChromeIcons';
import { PracticeControls } from './SimBar';

/**
 * The status row above every screen: where the season stands, how last night
 * went, when the next games are, and the few controls that belong to the whole
 * game rather than one screen (rules, refresh, practice).
 *
 * It is part of the frame, not a card, so it stays one row: two short lines of
 * facts beside 44px icon-first controls. In practice mode the practice bar
 * (SimBar) sits directly under it and carries the clock controls; the two share
 * one background and never repeat a date. The rules open as a sheet over the
 * screen instead of pushing the content down.
 */
export function PerGameStatusStrip() {
  const { fontScale, width } = useWindowDimensions();
  const {
    bootstrap,
    isGameplayReady,
    isRefreshing,
    pendingActions,
    reconciliationRequired,
    refreshData,
  } = usePerGame();
  const [rulesOpen, setRulesOpen] = useState(false);
  const lastSettled = bootstrap?.game.lastSettledDate ?? null;
  const ledgerItems = bootstrap?.ledger.items;
  const earnings = useMemo(() => recentEarnings(ledgerItems, lastSettled), [lastSettled, ledgerItems]);
  if (!bootstrap) return null;

  const practice = isMockActive();
  const layout = chromeLayout(width, fontScale);
  const rules = bootstrap.ruleset;
  const nextGameDate = bootstrap.game.nextGameDate;
  const progress = practice ? practiceProgress(mockSeasonStart(), lastSettled) : null;
  // Before the first night there is no "last night" to report.
  const lastNight = progress?.day === 0 ? null : earnings?.night ?? null;
  const next = nextGamesText(nextGameDate);

  const pendingBeyondReconciliation = [...pendingActions]
    .some((key) => key !== 'account-mutation');
  const disabled = (
    !isGameplayReady
    || isRefreshing
    || (reconciliationRequired ? pendingBeyondReconciliation : pendingActions.size > 0)
  );

  const lockDate = rules.rosterLockGameDate;
  const lockSentence = rules.rosterMutationsLocked
    ? (rules.rosterLockGameDate
      ? `Roster changes are locked for the ${humanDate(rules.rosterLockGameDate)} game.`
      : 'Roster changes are locked while the current game is in progress.')
    : null;
  const summary = statusSummary({
    mode: practice ? 'practice' : 'live',
    lastSettledDate: lastSettled,
    nextGameDate,
    lastNight,
    progress: progress ?? undefined,
    lockSentence,
  });

  // Only the signed-in row has three controls to squeeze; practice's single
  // Rules control is 44px wide with its name, so it always keeps it.
  const placement: ChromeButtonPlacement = layout.wide
    ? 'inline'
    : layout.iconOnly && !practice ? 'icon' : 'stacked';
  const canEnterPractice = !practice && Platform.OS === 'web' && typeof window !== 'undefined';
  // Signed in, a phone row carries three controls, so each fact takes its own
  // short line (three tight lines fit the 52px row). Practice has one control
  // and fits its facts on two, except on the narrowest phones when the lock
  // tag or Reconcile needs the room.
  const tight = !layout.wide && !layout.largeText && (
    !practice || (layout.iconOnly && (rules.rosterMutationsLocked || reconciliationRequired))
  );

  // ---- facts ---------------------------------------------------------------
  const clock = practice && progress ? (
    <Text key="clock" maxFontSizeMultiplier={1.5} style={[styles.lead, tight && styles.tight]}>
      <Text style={styles.practiceWord}>{PRACTICE_LABEL}</Text>
      {lastSettled ? <Text>{`  ·  ${keepTogether(humanDate(lastSettled))}`}</Text> : null}
      <Text style={styles.leadMuted}>{`  ·  ${keepTogether(practiceDayText(progress))}`}</Text>
    </Text>
  ) : (
    <Text key="clock" maxFontSizeMultiplier={1.5} style={[styles.lead, tight && styles.tight]}>
      {lastSettled ? `Games through ${keepTogether(humanDate(lastSettled))}` : 'No games settled yet'}
    </Text>
  );
  const night = lastNight === null ? null : (
    <Text key="night" maxFontSizeMultiplier={1.5} style={[styles.fact, tight && styles.tight]}>
      <Text style={styles.factLabel}>Last night </Text>
      <Money size="body" style={tight ? styles.moneyTight : undefined} value={lastNight} />
    </Text>
  );
  const upcoming = rules.rosterMutationsLocked ? (
    <View
      key="lock"
      accessibilityLabel={lockSentence ?? undefined}
      style={styles.lock}
    >
      <Tag style={tight ? styles.tagTight : undefined} tone="gold">ROSTER LOCKED</Tag>
      {lockDate ? (
        <Text maxFontSizeMultiplier={1.5} style={[styles.fact, tight && styles.tight]}>
          <Text style={styles.factLabel}>for </Text>
          {keepTogether(humanDate(lockDate))}
        </Text>
      ) : null}
    </View>
  ) : progress?.complete ? (
    <Text key="over" maxFontSizeMultiplier={1.5} style={[styles.fact, styles.factLabel, tight && styles.tight]}>
      {PRACTICE_OVER_TEXT}
    </Text>
  ) : (
    <Text key="next" maxFontSizeMultiplier={1.5} style={[styles.fact, tight && styles.tight]}>
      <Text style={styles.factLabel}>{progress?.day === 0 ? 'Season opens ' : 'Next '}</Text>
      {next ? keepTogether(next) : 'not scheduled yet'}
    </Text>
  );

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

  return (
    <View
      nativeID="status-strip"
      style={[
        styles.strip,
        !practice && styles.stripLive,
        practice && layout.merged && styles.stripMerged,
      ]}
    >
      <View style={[styles.row, layout.largeText && styles.rowLarge]}>
        <View
          accessibilityLabel={summary}
          accessible
          style={[
            styles.facts,
            practice ? styles.factsPractice : styles.factsLive,
            tight && styles.factsTight,
            // Enlarged text signed in: three controls would squeeze the facts
            // into a sliver, so the facts take the row and the controls wrap.
            layout.largeText && !practice && styles.factsFull,
          ]}
        >
          {layout.wide ? (
            <View style={[styles.line, styles.lineWide]}>
              {clock}
              {night}
              {upcoming}
            </View>
          ) : tight ? (
            <>
              {clock}
              {night}
              {upcoming}
            </>
          ) : (
            <>
              {clock}
              <View style={styles.line}>
                {night}
                {upcoming}
              </View>
            </>
          )}
        </View>
        <View style={styles.actions}>
          {practice && layout.merged ? <PracticeControls inline /> : null}
          {canEnterPractice ? (
            <ChromeButton
              accessibilityLabel="Play a practice season in this browser. Your account is untouched."
              icon={(color) => <PracticeIcon color={color} />}
              label={PRACTICE_LABEL}
              onPress={() => {
                window.location.search = '?mock';
              }}
              placement={placement}
            />
          ) : null}
          {refreshControl}
          <ChromeButton
            accessibilityLabel="Show the game rules"
            icon={(color) => <RulesIcon color={color} />}
            label="Rules"
            onPress={() => setRulesOpen(true)}
            placement={placement}
          />
        </View>
      </View>
      <RulesSheet onClose={() => setRulesOpen(false)} rules={rules} visible={rulesOpen} />
    </View>
  );
}

/** Below this width the rules sheet rises from the bottom; above it, it is a centred panel. */
const RULES_SHEET_DOCKED_MAX_WIDTH = 640;

/**
 * The rules, over the screen. Plain English first (the shared rules copy),
 * then the numbers a player checks before a move.
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
  const { width } = useWindowDimensions();
  const docked = width < RULES_SHEET_DOCKED_MAX_WIDTH;
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
      <Pressable
        accessibilityLabel="Close the game rules"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.scrim}
      />
      <View
        style={[
          styles.sheet,
          docked ? styles.sheetDocked : styles.sheetCentered,
          docked && { paddingBottom: insets.bottom },
        ]}
      >
        <View style={styles.sheetHead}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>Game rules</Text>
          <Pressable
            accessibilityLabel="Close the game rules"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.done, pressed && styles.pressed]}
          >
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetContent} style={styles.sheetBody}>
          <View style={styles.explanation}>
            {explanationParagraphs(presentation.explanation, SHORT_EXPLAINER).map((paragraph) => (
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
  row: {
    minHeight: control.height,
    flexDirection: 'row',
    alignItems: 'center',
    // Enlarged text wraps the controls under the facts instead of truncating.
    flexWrap: 'wrap',
    columnGap: space.sm,
    paddingHorizontal: space.lg,
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
  factsLive: {
    flexBasis: 140,
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
    gap: 6,
  },
  tagTight: {
    paddingVertical: 0,
  },
  // One size per line keeps the three tight lines at exactly their height.
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
  sheet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 560,
    maxHeight: '88%',
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sheetDocked: {
    marginTop: 'auto',
    borderBottomWidth: 0,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  sheetCentered: {
    marginVertical: 'auto',
    borderRadius: radius.lg,
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
    flexGrow: 0,
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
