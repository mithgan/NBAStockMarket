import { useId, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { humanDateWithYear } from '../../copy/terms';
import type { HistoricalGame, HistoricalPlayerSeason } from '../../data/playerHistory';
import { historyGameLabel, historyPointsChart, historySeasonView } from '../../data/profileHistoryView';
import { colors, fonts, space, type, weight } from '../../theme';
import { Button, headingLevel, repeatSafe, SectionHeader, Stat, visuallyHidden } from '../../ui/kit';

const LOG_PREVIEW = 5;
const TABLE_MIN_WIDTH = 380;
const STAT_COLUMNS = [
  { key: 'points', label: 'Points' },
  { key: 'rebounds', label: 'Rebounds' },
  { key: 'assists', label: 'Assists' },
] as const;

export function HistoricalSeason({ history, wide = false }: {
  history: HistoricalPlayerSeason;
  wide?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const chartId = `history-${useId().replace(/:/g, '')}`;
  const [expandedSeason, setExpandedSeason] = useState<string | null>(null);
  const seasonKey = `${history.playerId}:${history.seasonId}`;
  const showingAll = expandedSeason === seasonKey;
  const toggleGames = useMemo(() => repeatSafe(() => {
    setExpandedSeason((current) => current === seasonKey ? null : seasonKey);
  }), [seasonKey]);
  const season = history.seasonId.replace('-', '–');
  const view = useMemo(() => historySeasonView(history.games), [history.games]);
  const height = wide ? 184 : 160;
  const chart = useMemo(() => historyPointsChart(view.games, width, height), [view.games, width, height]);
  const newestFirst = useMemo(() => [...view.games].reverse(), [view.games]);
  const rows = showingAll ? newestFirst : newestFirst.slice(0, LOG_PREVIEW);
  const stacked = width < TABLE_MIN_WIDTH;
  const count = `${view.gameCount} ${view.gameCount === 1 ? 'game' : 'games'} played`;
  const firstGame = view.games[0];
  const lastGame = view.games[view.games.length - 1];

  return (
    <View style={styles.section}>
      <SectionHeader
        caption={`NBA regular season · ${count}`}
        level={3}
        title={`Last season · ${season}`}
      />
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={styles.content}>
        {view.averages ? (
          <>
            <Text style={styles.caption}>Per game</Text>
            <View style={styles.averages}>
              {[...STAT_COLUMNS, { key: 'minutes' as const, label: 'Minutes' }].map(({ key, label }) => (
                <Stat
                  key={key}
                  label={label}
                  style={styles.average}
                  value={<Text style={styles.averageValue}>{view.averages![key].toFixed(1)}</Text>}
                />
              ))}
            </View>

            <View style={styles.chartBlock}>
              <Text accessibilityRole="header" {...headingLevel(4)} style={styles.subheading}>Points by game</Text>
              <View style={styles.legend}>
                <View aria-hidden style={styles.averageSwatch} />
                <Text style={styles.caption}>Season average · {view.averages.points.toFixed(1)}</Text>
              </View>
              <View
                accessible
                accessibilityRole="image"
                accessibilityLabel={`${history.playerName}, ${season} NBA regular season. Points across ${count}, from ${humanDateWithYear(firstGame.date)} to ${humanDateWithYear(lastGame.date)}. Average ${view.averages.points.toFixed(1)}, season high ${view.highPoints}, low ${view.lowPoints}. Games appear from oldest to newest. Exact values are in the game log below.`}
                style={{ height }}
              >
                {chart ? (
                  <View accessibilityElementsHidden aria-hidden importantForAccessibility="no-hide-descendants">
                    <Svg height={height} width={width}>
                      <Defs>
                        <ClipPath id={`${chartId}-above`}>
                          <Rect height={chart.averageY} width={width} x={0} y={0} />
                        </ClipPath>
                        <ClipPath id={`${chartId}-below`}>
                          <Rect height={height - chart.averageY} width={width} x={0} y={chart.averageY} />
                        </ClipPath>
                      </Defs>
                      {[0, chart.maxPoints / 2, chart.maxPoints].map((value) => {
                        const y = chart.bottom - (value / chart.maxPoints) * (chart.bottom - chart.top);
                        return (
                          <Line key={`grid-${value}`} stroke={colors.borderStrong} strokeWidth={1} x1={chart.left} x2={chart.right} y1={y} y2={y} />
                        );
                      })}
                      {[0, chart.maxPoints / 2, chart.maxPoints].map((value) => {
                        const y = chart.bottom - (value / chart.maxPoints) * (chart.bottom - chart.top);
                        return (
                          <SvgText fill={colors.faint} fontFamily={fonts.body} fontSize={type.label} key={`label-${value}`} textAnchor="end" x={chart.left - 6} y={y + 4}>
                            {value}
                          </SvgText>
                        );
                      })}
                      {(['above', 'below'] as const).map((side) => (
                        <Polyline
                          clipPath={`url(#${chartId}-${side})`}
                          fill="none"
                          key={side}
                          points={chart.points.map(({ x, y }) => `${x},${y}`).join(' ')}
                          stroke={side === 'above' ? colors.green : colors.red}
                          strokeLinejoin="round"
                          strokeWidth={1.75}
                        />
                      ))}
                      <Line stroke={colors.goldInk} strokeDasharray="5 4" strokeWidth={1.5} x1={chart.left} x2={chart.right} y1={chart.averageY} y2={chart.averageY} />
                      {chart.points.map(({ game, x, y }) => (
                        <Circle cx={x} cy={y} fill={y < chart.averageY ? colors.green : y > chart.averageY ? colors.red : colors.goldInk} key={game.gameId} r={chart.points.length === 1 ? 3 : 1.5} />
                      ))}
                    </Svg>
                  </View>
                ) : null}
              </View>
              <View aria-hidden style={styles.axis}>
                <Text style={styles.caption}>{humanDateWithYear(firstGame.date)}</Text>
                {view.gameCount > 1 ? <Text style={styles.caption}>{humanDateWithYear(lastGame.date)}</Text> : null}
              </View>
            </View>

            <View style={styles.log}>
              <View style={styles.logHeading}>
                <View style={styles.logCopy}>
                  <Text accessibilityRole="header" {...headingLevel(4)} style={styles.subheading}>Game log</Text>
                  <Text style={styles.caption}>
                    {showingAll || view.gameCount <= LOG_PREVIEW ? `All ${view.gameCount}` : `Latest ${LOG_PREVIEW} of ${view.gameCount}`} · newest first
                  </Text>
                </View>
                {view.gameCount > LOG_PREVIEW ? (
                  <Button
                    expanded={showingAll}
                    label={showingAll ? `Show latest ${LOG_PREVIEW}` : `Show all ${view.gameCount} games`}
                    onPress={toggleGames}
                    style={styles.toggle}
                    variant="quiet"
                  />
                ) : null}
              </View>
              <View aria-label={`${season} NBA regular season game log`} role="table">
                <View role="row" style={stacked ? visuallyHidden : styles.tableRow}>
                  <Text role="columnheader" style={[styles.columnLabel, styles.gameColumn]}>Game</Text>
                  {STAT_COLUMNS.map(({ key, label }) => (
                    <Text key={key} role="columnheader" style={[styles.columnLabel, styles.numberColumn]}>{label}</Text>
                  ))}
                </View>
                {rows.map((game) => <GameRow game={game} key={game.gameId} stacked={stacked} />)}
              </View>
            </View>
          </>
        ) : (
          <Text style={styles.caption}>No NBA regular season games on record for {season}.</Text>
        )}

      </View>
    </View>
  );
}

function GameRow({ game, stacked }: { game: HistoricalGame; stacked: boolean }) {
  return (
    <View role="row" style={[stacked ? styles.stackRow : styles.tableRow, styles.rowRule]}>
      <View role="rowheader" style={stacked ? styles.stackGame : styles.gameColumn}>
        <Text accessibilityLabel={historyGameLabel(game)} style={styles.cell}>
          {stacked ? historyGameLabel(game) : humanDateWithYear(game.date)}
        </Text>
        {!stacked && game.opponent ? <Text aria-hidden style={styles.caption}>
          {game.venue === 'home' ? 'vs ' : game.venue === 'away' ? 'at ' : ''}{game.opponent}
        </Text> : null}
      </View>
      {stacked ? (
        <View style={styles.stackFigures}>
          {STAT_COLUMNS.map(({ key, label }) => (
            <View key={key} role="cell" style={styles.stackFigure}>
              <Text aria-hidden style={styles.caption}>{label}</Text>
              <Text style={styles.cell}>{game[key]}</Text>
            </View>
          ))}
        </View>
      ) : STAT_COLUMNS.map(({ key }) => (
        <Text key={key} role="cell" style={[styles.cell, styles.numberColumn]}>{game[key]}</Text>
      ))}
    </View>
  );
}

export default HistoricalSeason;

const styles = StyleSheet.create({
  section: {
    marginTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    minWidth: 0,
  },
  content: { marginHorizontal: space.lg, gap: space.sm, minWidth: 0 },
  caption: { color: colors.muted, fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  averages: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  average: { flexGrow: 1, flexBasis: 0, minWidth: 110, maxWidth: '100%' },
  averageValue: { color: colors.text, fontFamily: fonts.display, fontSize: 24, fontWeight: weight.bold, fontVariant: ['tabular-nums'] },
  subheading: { color: colors.text, fontFamily: fonts.display, fontSize: type.body, fontWeight: weight.heavy },
  chartBlock: { marginTop: space.md, gap: space.sm, minWidth: 0 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  averageSwatch: { width: 20, borderTopWidth: 1.5, borderTopColor: colors.goldInk, borderStyle: 'dashed' },
  axis: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space.sm },
  log: { marginTop: space.md },
  logHeading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  logCopy: { flexShrink: 1, gap: space.xs },
  toggle: { maxWidth: '100%' },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  columnLabel: { color: colors.muted, fontFamily: fonts.body, fontSize: type.caption, fontWeight: weight.bold },
  gameColumn: { flex: 1.6, minWidth: 0 },
  numberColumn: { flex: 1, minWidth: 0, textAlign: 'right' },
  cell: { color: colors.text, fontFamily: fonts.display, fontSize: type.body, fontWeight: weight.bold, fontVariant: ['tabular-nums'] },
  rowRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  stackRow: { paddingVertical: space.sm, gap: space.xs },
  stackGame: { minWidth: 0 },
  stackFigures: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stackFigure: { flexGrow: 1, flexBasis: 0, minWidth: 70, gap: 2 },
});
