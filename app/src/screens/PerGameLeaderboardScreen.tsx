import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { PerGameLeaderboardRow } from '../api/contracts';
import { exactMoney, exactSignedMoney } from '../copy/terms';
import { NetMoney } from '../components/results/NetMoney';
import {
  boardPlaces,
  leaderStanding,
  sortBoard,
  standingLines,
  standingPlace,
  type BoardPlace,
  type Standing,
} from '../data/leadersView';
import { usePerGame } from '../state/PerGameContext';
import { colors, fonts, headingStyle, labelStyle, space, type, weight } from '../theme';
import { EmptyState, Label, Tag } from '../ui/kit';

/** At this width the board becomes a centred column, not a stretched phone. */
const DESKTOP_MIN_WIDTH = 1024;
const BOARD_MAX_WIDTH = 720;
const RANK_WIDTH = 52;

/** "$0" for exactly nothing, otherwise the signed exact amount. */
function scoreWords(value: number): string {
  return Math.round(value) === 0 ? exactMoney(0) : exactSignedMoney(value);
}

/** Your rank and how far you are from the next place up and from #1. */
function StandingBlock({
  accountScore,
  compact,
  standing,
}: {
  accountScore: number;
  compact: boolean;
  standing: Standing;
}) {
  if (standing.kind === 'empty') return null;
  const lines = standingLines(standing);
  if (standing.kind === 'absent') {
    return (
      <View style={styles.standing}>
        <Label>Your standing</Label>
        <Text style={styles.absent}>{lines[0]}</Text>
        <Text style={styles.absentScore}>
          Your score is <NetMoney size="body" value={accountScore} />.
        </Text>
      </View>
    );
  }
  const place = standingPlace(standing);
  const tied = standing.tiedWith.length > 0;
  return (
    <View
      accessibilityLabel={`Your standing: ${place} of ${standing.of}, score ${scoreWords(standing.score)}. ${lines.join('. ')}.`}
      accessible
      style={styles.standing}
    >
      <Label>Your standing</Label>
      <View style={[styles.standingTop, compact && styles.standingTopCompact]}>
        <View style={styles.placeLine}>
          {tied ? <Text style={styles.tiedWord}>Tied for</Text> : null}
          <Text style={styles.place}>#{standing.rank}</Text>
          <Text style={styles.of}>of {standing.of}</Text>
        </View>
        <View style={[styles.scoreBlock, compact && styles.scoreBlockCompact]}>
          <NetMoney size="title" value={standing.score} />
          <Text style={styles.scoreLabel}>your score</Text>
        </View>
      </View>
      {lines.length > 0 ? (
        <View style={styles.gaps}>
          {lines.map((line) => (
            <Text key={line} style={styles.gap}>{line}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function BoardRow({
  compact,
  place,
  row,
}: {
  compact: boolean;
  place: BoardPlace;
  row: PerGameLeaderboardRow;
}) {
  return (
    <View
      accessibilityLabel={`${place.tied ? 'Tied for ' : ''}#${place.place}, ${row.displayName}${row.isCurrentUser ? ', you' : ''}, score ${scoreWords(row.cumulativePnl)}`}
      accessible
      style={[styles.row, compact && styles.rowCompact, row.isCurrentUser && styles.currentRow]}
    >
      <Text style={[styles.rank, compact && styles.rankCompact]}>#{place.place}</Text>
      <View style={[styles.nameCell, compact && styles.nameCompact]}>
        <Text style={styles.name}>{row.displayName}</Text>
        {row.isCurrentUser ? <Tag tone="gold">You</Tag> : null}
      </View>
      <View style={[styles.scoreCell, compact && styles.scoreCompact]}>
        <NetMoney value={row.cumulativePnl} />
      </View>
    </View>
  );
}

export function PerGameLeaderboardScreen() {
  const { bootstrap } = usePerGame();
  const { fontScale, width } = useWindowDimensions();
  if (!bootstrap) return null;
  // Rows wrap only for large text; a narrow phone still reads one row per line.
  const compact = fontScale > 1.2;
  const wide = width >= DESKTOP_MIN_WIDTH;
  // Ranked on each row's cumulativePnl: the total score since the season began at $0.
  const rows = sortBoard(bootstrap.leaderboard);
  const standing = leaderStanding(rows);
  const places = boardPlaces(rows);

  return (
    <ScrollView
      contentContainerStyle={[styles.content, wide && styles.contentWide]}
      style={styles.scroll}
    >
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>Leaders</Text>
        <Text style={styles.subtitle}>Ranked by total score. Everyone started the season at $0.</Text>
      </View>
      <StandingBlock
        accountScore={bootstrap.account.cumulativePnl}
        compact={compact}
        standing={standing}
      />
      {rows.length === 0 ? (
        <EmptyState
          copy="The board fills in once the first games settle."
          style={styles.empty}
          title="No one is on the board yet"
        />
      ) : (
        <>
          {!compact ? (
            <View style={styles.tableHead}>
              <Text style={[styles.headLabel, styles.headRank]}>Rank</Text>
              <Text style={[styles.headLabel, styles.headName]}>Name</Text>
              <Text style={[styles.headLabel, styles.headScore]}>Score</Text>
            </View>
          ) : null}
          {rows.map((row) => (
            <BoardRow
              compact={compact}
              key={row.entryId}
              place={places.get(row.entryId) ?? { place: row.rank, tied: false }}
              row={row}
            />
          ))}
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
    paddingBottom: 110,
  },
  contentWide: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: BOARD_MAX_WIDTH,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
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
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
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
});
