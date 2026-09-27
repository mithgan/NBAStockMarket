import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { isMockActive, mockSeasonStart } from '../api/mockPerGameClient';
import { signedMoney } from '../copy/terms';
import { NetMoney } from '../components/results/NetMoney';
import { practiceProgress } from '../data/chromeView';
import {
  boardList,
  lagLine as boardLagLine,
  leaderStanding,
  pastSeasonLines,
  readPastSeasons,
  sortBoard,
  spokenLagLine,
  spokenPlace,
  spokenRanks,
  standingLines,
  type BoardEntry,
  type PastSeasonLine,
  type Standing,
} from '../data/leadersView';
import { isSeasonOver } from '../data/marketView';
import { rankLine } from '../data/rosterView';
import { usePerGame } from '../state/PerGameContext';
import { colors, fonts, headingStyle, labelStyle, space, type, weight } from '../theme';
import { EmptyState, headingLevel, Tag, visuallyHidden } from '../ui/kit';
// Read through `readPastSeasons`, which checks what `pastSeasonResults()` gives.
import * as practiceSession from '../web/practiceSession';
import { setScrollPaneStop } from '../web/scrollPane';

/**
 * At this width Leaders fills the frame like every other tab: your standing
 * in a side column (as wide as the Results one) beside the board.
 */
const DESKTOP_MIN_WIDTH = 1024;
const SIDE_WIDTH = 280;
/**
 * A short window at least this wide (a phone in landscape, 844x390) sets
 * your standing beside the board too, so the rivals show without scrolling
 * (walk 5 T1-22): stacked, the title and standing filled the screen.
 */
const SHORT_SPLIT_MIN_WIDTH = 600;
const SHORT_MAX_HEIGHT = 520;
/** Below this width (a phone at 200% zoom) a row stacks: rank and name, then score. */
const STACK_MAX_WIDTH = 330;
const RANK_WIDTH = 52;

/** Screen-reader money, read the way the screen writes it: "$0" for nothing. */
function scoreWords(value: number): string {
  return Math.round(value) === 0 ? '$0' : signedMoney(value);
}

/** One label for screen readers where the eye sees several pieces. */
function Spoken({ children }: { children: string }) {
  return (
    <View style={visuallyHidden}>
      <Text>{children}</Text>
    </View>
  );
}

/** The seen pieces a `Spoken` label already says, kept out of the reading order. */
function Seen({ children, style }: { children: ReactNode; style?: object | object[] }) {
  return (
    <View
      accessibilityElementsHidden
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      style={style}
    >
      {children}
    </View>
  );
}

/** "First of 5" or "Tied for second of 5": the drawn "#1 of 5", said in words. */
function placeWords(standing: Extract<Standing, { kind: 'ranked' }>): string {
  return spokenPlace(standing.rank, standing.of, standing.tiedWith.length > 0);
}

/**
 * A heading drawn in capitals is named in sentence case: Chrome hands the
 * capitals on, and some readers spell out or shout them (walk 6 T3-09).
 */
function SmallCapsHeading({ children }: { children: string }) {
  return (
    <Text accessibilityLabel={children} accessibilityRole="header" {...headingLevel(2)} style={styles.standingLabel}>
      {children}
    </Text>
  );
}

/**
 * Your rank, your score and how far you are from the next place up and from
 * #1. The score is your account's, shown exactly as the Roster shows it, and
 * the rank, ties and gaps are all worked out from that same score against the
 * other rows; a caption says when the board's own row for you has not caught
 * up. Before the first games nobody has a place: everyone is level at $0, and
 * your fees so far are a note. Screen readers hear the block as one sentence.
 */
function StandingBlock({
  accountScore,
  compact,
  feeDollars,
  final,
  standing,
}: {
  accountScore: number;
  compact: boolean;
  /** A move's fee: a gap of whole fees is named as today's fee (walk 8 T3-06). */
  feeDollars: number;
  final: boolean;
  standing: Standing;
}) {
  if (standing.kind === 'empty') return null;
  const lines = standingLines(standing);
  const heading = <SmallCapsHeading>{final ? 'Your final standing' : 'Your standing'}</SmallCapsHeading>;
  if (standing.kind === 'absent') {
    return (
      <View style={styles.standing}>
        {heading}
        <Text style={styles.absent}>{lines[0]}</Text>
        <Text style={styles.absentScore}>
          Your score is <NetMoney size="body" value={accountScore} />.
        </Text>
      </View>
    );
  }
  if (standing.kind === 'level') {
    const fees = Math.round(standing.score) === 0
      ? null
      : `Your fees so far: ${signedMoney(standing.score)}. The board counts them after the first games.`;
    return (
      <View style={styles.standing}>
        {heading}
        <Text style={styles.level}>{lines[0]}.</Text>
        {fees ? <Text style={styles.lag}>{fees}</Text> : null}
      </View>
    );
  }
  const tied = standing.tiedWith.length > 0;
  const lagLine = boardLagLine(standing, feeDollars);
  const spoken = [
    placeWords(standing),
    `${final ? 'final score' : 'your score'} ${scoreWords(standing.score)}`,
    ...(lagLine ? [spokenLagLine(lagLine)] : []),
    // "$12K behind #2" is said "$12K behind second place".
    ...lines.map(spokenRanks),
  ].join(', ');
  return (
    <View style={styles.standing}>
      {heading}
      <Spoken>{`${spoken}.`}</Spoken>
      <Seen>
        <View style={[styles.standingTop, compact && styles.standingTopCompact]}>
          <View style={styles.placeLine}>
            {tied ? <Text style={styles.tiedWord}>Tied for</Text> : null}
            <Text style={styles.place}>#{standing.rank}</Text>
            <Text style={styles.of}>of {standing.of}</Text>
          </View>
          <View style={[styles.scoreBlock, compact && styles.scoreBlockCompact]}>
            <NetMoney size="title" value={standing.score} />
            <Text style={styles.scoreLabel}>{final ? 'final score' : 'your score'}</Text>
          </View>
        </View>
        {lagLine ? <Text style={styles.lag}>{lagLine}</Text> : null}
        {lines.length > 0 ? (
          <View style={styles.gaps}>
            {lines.map((line) => (
              <Text key={line} style={styles.gap}>{line}</Text>
            ))}
          </View>
        ) : null}
      </Seen>
    </View>
  );
}

/**
 * "Your seasons this visit" (practice; walk 5 T2 NYI-1): each finished
 * season's final score and place, newest first. Hidden until one has
 * finished; cleared, like the rest of practice, by a reload.
 */
function PastSeasons({ lines }: { lines: readonly PastSeasonLine[] }) {
  if (lines.length === 0) return null;
  return (
    <View style={styles.past}>
      <SmallCapsHeading>Your seasons this visit</SmallCapsHeading>
      <View accessibilityLabel="Your seasons this visit" role="list" style={styles.pastList}>
        {lines.map((line) => (
          <View key={line.key} role="listitem">
            <Spoken>{line.spoken}</Spoken>
            <Seen style={styles.pastRow}>
              <Text style={styles.pastLabel}>{line.label}</Text>
              <View style={styles.pastFigures}>
                <NetMoney size="body" value={line.score} />
                {line.place ? <Text style={styles.pastPlace}>{line.place}</Text> : null}
              </View>
              {line.note ? <Text style={styles.pastNote}>{line.note}</Text> : null}
            </Seen>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * One row of the board, a table row of three cells a screen reader reads
 * with their column (walk 8 T3-09): "2", "Deep Threes", "+$245K". The column
 * says "Rank", so the cell says the place once (walk 13 T3-05: "Rank, Rank
 * 2"). On a level board (before the first games) no one has a rank yet. Every score
 * keeps the app's one format; when two different scores read alike, each
 * says how far apart they are ("$191 ahead of #2").
 */
function BoardRow({ compact, entry, level }: { compact: boolean; entry: BoardEntry; level: boolean }) {
  const { row, place, tied, score, boardScore, closeCalls } = entry;
  const scoreText = scoreWords(score);
  const you = row.isCurrentUser;
  // Practice names your row "You"; a YOU tag beside it would say it twice.
  const tagged = you && row.displayName.trim().toLowerCase() !== 'you';
  const who = `${row.displayName}${tagged ? ', you' : ''}`;
  const rankSpoken = level ? 'None yet' : tied ? `Tied for ${place}` : `${place}`;
  const scoreSpoken = level
    ? 'level at $0'
    : `${scoreText}${closeCalls.map((note) => `, ${spokenRanks(note)}`).join('')}${boardScore === null ? '' : `. The board still has you at ${scoreWords(boardScore)}`}`;
  return (
    <View role="row" style={[styles.item, styles.row, compact && styles.rowCompact, you && styles.currentRow]}>
      <View role="cell" style={compact ? styles.rankCellCompact : null}>
        <Spoken>{rankSpoken}</Spoken>
        <Seen>
          <Text style={[styles.rank, compact && styles.rankCompact]}>{level ? '–' : `#${place}`}</Text>
        </Seen>
      </View>
      {/* The row's header (walk 9 T3-02): moving down the Score column, a
          screen reader names whose score it is. */}
      <View role="rowheader" style={[styles.nameCell, compact && styles.nameCompact]}>
        <Spoken>{who}</Spoken>
        <Seen style={styles.nameSeen}>
          <Text style={[styles.name, you && styles.nameYou]}>{row.displayName}</Text>
          {tagged ? <Tag tone="gold">You</Tag> : null}
        </Seen>
      </View>
      <View role="cell" style={[styles.scoreCell, compact && styles.scoreCompact]}>
        <Spoken>{scoreSpoken}</Spoken>
        <Seen style={[styles.scoreSeen, compact && styles.scoreSeenCompact]}>
          <NetMoney value={score} />
          {level ? null : closeCalls.map((note) => (
            <Text key={note} style={[styles.boardNote, styles.closeCall, compact && styles.boardNoteCompact]}>{note}</Text>
          ))}
          {boardScore === null ? null : (
            <Text style={[styles.boardNote, compact && styles.boardNoteCompact]}>board {signedMoney(boardScore)}</Text>
          )}
        </Seen>
      </View>
    </View>
  );
}

export function PerGameLeaderboardScreen() {
  const { bootstrap } = usePerGame();
  const { fontScale, height, width } = useWindowDimensions();
  // Web: a scrolling area with nothing inside to focus is a Tab stop of the
  // browser's own, unnamed, with a thin ring (walk 13 T3-11, Leaders at 200%
  // and 400%). While the screen scrolls it is a stop on purpose: named, with
  // the app's ring, so the arrow keys scroll it and a reader hears what it is.
  const pane = useRef({ height: 0, content: 0 });
  const [scrolls, setScrolls] = useState(false);
  const measure = useCallback(() => setScrolls(pane.current.content > pane.current.height + 1), []);
  // Set on the pane's element itself: a role prop would change its tag
  // (div <-> section) and redraw the whole board whenever it starts or stops
  // scrolling, taking any focus inside it to the page.
  const scrollRef = useRef<ScrollView>(null);
  const paneName = useRef('Leaders');
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = (scrollRef.current as unknown as { getScrollableNode?: () => HTMLElement | null } | null)?.getScrollableNode?.();
    setScrollPaneStop(node ?? null, scrolls ? `${paneName.current}, scrolls` : null);
  });
  if (!bootstrap) return null;
  // Rows stack for large text and on very narrow screens; a phone reads one row per line.
  const compact = fontScale > 1.2 || width < STACK_MAX_WIDTH;
  // Desktop, and a phone in landscape: your standing in a side column beside the board.
  const wide = width >= DESKTOP_MIN_WIDTH || (width >= SHORT_SPLIT_MIN_WIDTH && height < SHORT_MAX_HEIGHT);
  // Ranked on each row's cumulativePnl: the total score since the season began at $0.
  const rows = sortBoard(bootstrap.leaderboard);
  // You are placed by your account score, the figure shown; the others by their rows.
  const standing = leaderStanding(rows, bootstrap.account.cumulativePnl);
  const level = standing.kind === 'level';
  // The list places you by the same score, with the board's figure as a note while it lags.
  // A gap of whole fees is said once, in the standing, and the row shows one figure.
  const list = boardList(rows, bootstrap.account.cumulativePnl, bootstrap.ruleset.transactionFeeDollars);
  // Practice fills the board with computer rivals: say so once, quietly.
  const practiceRivals = isMockActive() && rows.some((row) => !row.isCurrentUser);
  // The Roster's rule: practice ends on its last day, a live season when no games are left.
  const final = isSeasonOver({
    practiceComplete: isMockActive() && practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).complete,
    lastSettledDate: bootstrap.game.lastSettledDate,
    nextGameDate: bootstrap.game.nextGameDate,
  });
  paneName.current = final ? 'Final standings' : 'Leaders';

  const header = (
    <View style={styles.header}>
      <Text accessibilityRole="header" {...headingLevel(1)} style={styles.title}>
        {final ? 'Final standings' : 'Leaders'}
      </Text>
      <Text style={styles.subtitle}>
        {final
          ? 'The season is over. Ranked by total score; everyone started at $0.'
          : 'Ranked by total score. Everyone started the season at $0.'}
      </Text>
      {practiceRivals ? <Text style={styles.subtitle}>Practice rivals are computer players.</Text> : null}
    </View>
  );
  // Practice only: the seasons finished earlier this visit, and this one as
  // soon as it is over (the place as the season's record will keep it).
  const finishedOn = bootstrap.game.lastSettledDate;
  const finishedNow = final && finishedOn
    ? { score: bootstrap.account.cumulativePnl, rank: rankLine(bootstrap.leaderboard), finishedOn }
    : null;
  const seasons = isMockActive() ? pastSeasonLines(readPastSeasons(practiceSession), finishedNow) : [];
  const standingBlock = (
    <StandingBlock
      accountScore={bootstrap.account.cumulativePnl}
      compact={compact || wide}
      feeDollars={bootstrap.ruleset.transactionFeeDollars}
      final={final}
      standing={standing}
    />
  );
  const board = rows.length === 0 ? (
    <EmptyState
      copy="The board fills in once the first games settle."
      level={2}
      style={styles.empty}
      title="No one is on the board yet"
    />
  ) : (
    <>
      <View style={visuallyHidden}>
        <Text accessibilityRole="header" {...headingLevel(2)}>The board</Text>
      </View>
      {/* A table to a screen reader (walk 8 T3-09): each figure is read with
          its column. Phones stack a row's cells and draw no header row, so
          there the header row is kept for screen readers only. */}
      <View accessibilityLabel="The board" role="table">
        <View role="row" style={compact ? visuallyHidden : styles.tableHead}>
          <Text accessibilityLabel="Rank" role="columnheader" style={[styles.headLabel, styles.headRank]}>Rank</Text>
          <Text accessibilityLabel="Name" role="columnheader" style={[styles.headLabel, styles.headName]}>Name</Text>
          <Text accessibilityLabel="Score" role="columnheader" style={[styles.headLabel, styles.headScore]}>Score</Text>
        </View>
        {list.map((entry) => (
          <BoardRow compact={compact} entry={entry} key={entry.row.entryId} level={level} />
        ))}
      </View>
    </>
  );

  return (
    <ScrollView
      contentContainerStyle={[styles.content, wide && styles.contentWide]}
      onContentSizeChange={(_, contentHeight) => {
        pane.current.content = contentHeight;
        measure();
      }}
      onLayout={(event) => {
        pane.current.height = event.nativeEvent.layout.height;
        measure();
      }}
      ref={scrollRef}
      style={styles.scroll}
    >
      {wide ? (
        <View style={styles.split}>
          <View style={styles.side}>
            {header}
            {standingBlock}
            <PastSeasons lines={seasons} />
          </View>
          <View style={styles.main}>{board}</View>
        </View>
      ) : (
        <>
          {header}
          {standingBlock}
          {board}
          <PastSeasons lines={seasons} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    // Fill the screen even when the board is short, so the desktop side
    // column's rule runs all the way down.
    flexGrow: 1,
    paddingBottom: 110,
  },
  // Desktop: the side column runs to the bottom; the board keeps the room
  // under its last row.
  contentWide: {
    paddingBottom: 0,
  },
  split: {
    flexGrow: 1,
    flexDirection: 'row',
  },
  side: {
    width: SIDE_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    backgroundColor: colors.background,
  },
  main: {
    flex: 1,
    minWidth: 0,
    paddingBottom: 110,
  },
  header: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
    backgroundColor: colors.background,
  },
  empty: {
    backgroundColor: colors.background,
  },
  title: {
    ...headingStyle,
  },
  subtitle: {
    marginTop: 2,
    color: colors.faint,
    fontSize: type.caption,
    lineHeight: 17,
  },
  standing: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  standingLabel: {
    ...labelStyle,
  },
  // Your seasons this visit: flat rows under a label, like the standing.
  past: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  pastList: {
    marginTop: space.sm,
  },
  pastRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: space.md,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pastLabel: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  pastFigures: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'baseline',
    columnGap: space.sm,
  },
  // "This season", on its own line under the season that just finished.
  pastNote: {
    flexBasis: '100%',
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.caption,
  },
  pastPlace: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  standingTop: {
    marginTop: space.xs,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.md,
  },
  standingTopCompact: {
    alignItems: 'flex-start',
  },
  placeLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    columnGap: space.sm,
  },
  tiedWord: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.title,
    fontWeight: weight.heavy,
  },
  place: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.display,
    fontWeight: weight.black,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.8,
  },
  of: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  scoreBlock: {
    alignItems: 'flex-end',
    paddingBottom: 4,
  },
  scoreBlockCompact: {
    alignItems: 'flex-start',
  },
  scoreLabel: {
    marginTop: 1,
    color: colors.faint,
    fontSize: type.caption,
  },
  // Before the first games: one plain sentence instead of a rank.
  level: {
    marginTop: space.sm,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.bold,
    lineHeight: 21,
  },
  lag: {
    marginTop: space.sm,
    color: colors.muted,
    fontSize: type.caption,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
  },
  gaps: {
    marginTop: space.sm,
    gap: 2,
  },
  gap: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
    lineHeight: 21,
  },
  absent: {
    marginTop: space.sm,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.bold,
    lineHeight: 21,
  },
  absentScore: {
    marginTop: 2,
    color: colors.muted,
    fontSize: type.body,
    lineHeight: 20,
  },
  tableHead: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  headLabel: {
    ...labelStyle,
  },
  headRank: {
    width: RANK_WIDTH,
  },
  headName: {
    flex: 1,
  },
  headScore: {
    textAlign: 'right',
  },
  item: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  rowCompact: {
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    rowGap: space.xs,
    paddingVertical: space.md,
  },
  // You: a flat tint and a YOU tag. No coloured side stripe.
  // Your row at a glance (walk 11 T1-03): a gold rule on its left, the
  // active tab's accent, and your name in bold, in every look.
  currentRow: {
    backgroundColor: colors.surfaceRaised,
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    // The rule takes its width from the padding, so the columns stay aligned.
    paddingLeft: space.lg - 3,
  },
  nameYou: {
    fontWeight: '800',
  },
  rank: {
    width: RANK_WIDTH - space.sm,
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  rankCompact: {
    width: 'auto',
    flexShrink: 0,
  },
  nameCell: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  nameCompact: {
    flexBasis: '70%',
    flexGrow: 1,
  },
  // The seen name and its tag, laid out as the cell was before it became one.
  nameSeen: {
    minWidth: 0,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  rankCellCompact: {
    flexShrink: 0,
  },
  scoreSeen: {
    alignItems: 'flex-end',
  },
  scoreSeenCompact: {
    alignItems: 'flex-start',
  },
  name: {
    flexShrink: 1,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  scoreCell: {
    minWidth: 88,
    alignItems: 'flex-end',
  },
  scoreCompact: {
    minWidth: 0,
    flexBasis: '100%',
    alignItems: 'flex-start',
  },
  // Your row while the board lags: the board's own figure, small, under yours.
  boardNote: {
    marginTop: 1,
    color: colors.faint,
    fontSize: type.caption,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  boardNoteCompact: {
    textAlign: 'left',
  },
  // Two different scores that read alike: how far apart they are, in muted ink.
  closeCall: {
    color: colors.muted,
  },
});
