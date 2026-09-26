import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { isMockActive, mockSeasonStart } from '../api/mockPerGameClient';
import { signedMoney } from '../copy/terms';
import { NetMoney } from '../components/results/NetMoney';
import { FineMoney } from '../components/roster/FineMoney';
import { formatAt } from '../data/rosterView';
import { practiceProgress } from '../data/chromeView';
import {
  boardLag,
  boardList,
  leaderStanding,
  sortBoard,
  standingLines,
  type BoardEntry,
  type Standing,
} from '../data/leadersView';
import { isSeasonOver } from '../data/marketView';
import { usePerGame } from '../state/PerGameContext';
import { colors, fonts, headingStyle, labelStyle, space, type, weight } from '../theme';
import { EmptyState, headingLevel, Tag, visuallyHidden } from '../ui/kit';

/**
 * At this width Leaders fills the frame like every other tab: your standing
 * in a side column (as wide as the Results one) beside the board.
 */
const DESKTOP_MIN_WIDTH = 1024;
const SIDE_WIDTH = 280;
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

/** "Rank 2 of 5" or "Tied for 2 of 5". */
function placeWords(standing: Extract<Standing, { kind: 'ranked' }>): string {
  return `${standing.tiedWith.length > 0 ? 'Tied for' : 'Rank'} ${standing.rank} of ${standing.of}`;
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
  final,
  standing,
}: {
  accountScore: number;
  compact: boolean;
  final: boolean;
  standing: Standing;
}) {
  if (standing.kind === 'empty') return null;
  const lines = standingLines(standing);
  const heading = (
    <Text accessibilityRole="header" {...headingLevel(2)} style={styles.standingLabel}>
      {final ? 'Your final standing' : 'Your standing'}
    </Text>
  );
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
  const lag = boardLag(standing);
  const lagLine = lag === null
    ? null
    : `The board still has you at ${signedMoney(standing.boardScore)} until the next games settle.`;
  const spoken = [
    placeWords(standing),
    `${final ? 'final score' : 'your score'} ${scoreWords(standing.score)}`,
    ...(lagLine ? [lagLine.replace(/\.$/, '')] : []),
    ...lines,
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
 * One row of the board, read as one list item: "Rank 2, Deep Threes,
 * +$245K". On a level board (before the first games) no one has a rank yet.
 */
function BoardRow({ compact, entry, level }: { compact: boolean; entry: BoardEntry; level: boolean }) {
  const { row, place, tied, score, boardScore, precision } = entry;
  // A score that would read like a different one on the board gets its digits.
  const scoreText = precision === 'fine' ? scoreWords(score) : formatAt(score, precision, true);
  const you = row.isCurrentUser;
  // Practice names your row "You"; a YOU tag beside it would say it twice.
  const tagged = you && row.displayName.trim().toLowerCase() !== 'you';
  const who = `${row.displayName}${tagged ? ', you' : ''}`;
  const spoken = level
    ? `${who}, level at $0`
    : `${tied ? 'Tied for' : 'Rank'} ${place}, ${who}, ${scoreText}${boardScore === null ? '' : `. The board still has you at ${scoreWords(boardScore)}`}`;
  return (
    <View role="listitem" style={[styles.item, you && styles.currentRow]}>
      <Spoken>{spoken}</Spoken>
      <Seen style={[styles.row, compact && styles.rowCompact]}>
        <Text style={[styles.rank, compact && styles.rankCompact]}>{level ? '–' : `#${place}`}</Text>
        <View style={[styles.nameCell, compact && styles.nameCompact]}>
          <Text style={styles.name}>{row.displayName}</Text>
          {tagged ? <Tag tone="gold">You</Tag> : null}
        </View>
        <View style={[styles.scoreCell, compact && styles.scoreCompact]}>
          {precision === 'fine' ? <NetMoney value={score} /> : <FineMoney precision={precision} value={score} />}
          {boardScore === null ? null : (
            <Text style={[styles.boardNote, compact && styles.boardNoteCompact]}>board {signedMoney(boardScore)}</Text>
          )}
        </View>
      </Seen>
    </View>
  );
}

export function PerGameLeaderboardScreen() {
  const { bootstrap } = usePerGame();
  const { fontScale, width } = useWindowDimensions();
  if (!bootstrap) return null;
  // Rows stack for large text and on very narrow screens; a phone reads one row per line.
  const compact = fontScale > 1.2 || width < STACK_MAX_WIDTH;
  const wide = width >= DESKTOP_MIN_WIDTH;
  // Ranked on each row's cumulativePnl: the total score since the season began at $0.
  const rows = sortBoard(bootstrap.leaderboard);
  // You are placed by your account score, the figure shown; the others by their rows.
  const standing = leaderStanding(rows, bootstrap.account.cumulativePnl);
  const level = standing.kind === 'level';
  // The list places you by the same score, with the board's figure as a note while it lags.
  const list = boardList(rows, bootstrap.account.cumulativePnl);
  // The Roster's rule: practice ends on its last day, a live season when no games are left.
  const final = isSeasonOver({
    practiceComplete: isMockActive() && practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).complete,
    lastSettledDate: bootstrap.game.lastSettledDate,
    nextGameDate: bootstrap.game.nextGameDate,
  });

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
    </View>
  );
  const standingBlock = (
    <StandingBlock
      accountScore={bootstrap.account.cumulativePnl}
      compact={compact || wide}
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
      {!compact ? (
        <Seen style={styles.tableHead}>
          <Text style={[styles.headLabel, styles.headRank]}>Rank</Text>
          <Text style={[styles.headLabel, styles.headName]}>Name</Text>
          <Text style={[styles.headLabel, styles.headScore]}>Score</Text>
        </Seen>
      ) : null}
      <View accessibilityLabel="The board" role="list">
        {list.map((entry) => (
          <BoardRow compact={compact} entry={entry} key={entry.row.entryId} level={level} />
        ))}
      </View>
    </>
  );

  return (
    <ScrollView contentContainerStyle={[styles.content, wide && styles.contentWide]} style={styles.scroll}>
      {wide ? (
        <View style={styles.split}>
          <View style={styles.side}>
            {header}
            {standingBlock}
          </View>
          <View style={styles.main}>{board}</View>
        </View>
      ) : (
        <>
          {header}
          {standingBlock}
          {board}
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
  currentRow: {
    backgroundColor: colors.surfaceRaised,
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
});
