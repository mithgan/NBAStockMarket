import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect } from 'react-native-svg';

import type { PerGameLedgerEntry } from '../api/contracts';
import {
  axisLabelIndexes,
  axisMark,
  chartSummary,
  chartValueText,
  nightReadingParts,
  hasNights,
  nearestIndex,
  nightlySeries,
  placeAxisLabels,
  valueTicks,
  type NightPoint,
} from '../data/rosterView';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { buildPnlSeries, pnlChartDomain } from '../state/perGameState';
import { colors, fonts, space, type, weight } from '../theme';
import { headingLevel, Label } from '../ui/kit';
import { FineMoney } from './roster/FineMoney';
import { usePlotPointer, type PlotIntent } from './roster/usePlotPointer';

/**
 * Room at the left of the plot for the value marks: $0, the high and the low.
 * The least room: the gutter grows to the widest mark as drawn, so wider text
 * (a user's text spacing, a large font) never cuts "-$334K" to "-$334"
 * (walk 7 T3-06).
 */
const GUTTER = 52;
/** Clear air between a value mark's words and the plot. */
const GUTTER_GAP = 6;
const INSET_RIGHT = 6;
const INSET_Y = 8;
const AXIS_LABEL_WIDTH = 64;
const GROW_MS = 520;

/**
 * Your score, night by night, from the $0 you start at.
 *
 * One point per game night (see `nightlySeries`): the line is green above the
 * labelled $0 line and red below it, the x-axis names real dates, and tapping
 * (touch), pointing (mouse) or arrow keys read one night's score and what that
 * night's games made. When a new night settles while the chart is on screen
 * the line grows into it, unless the viewer asked for reduced motion.
 */
export function PerGamePnlChart({
  entries,
  plotHeight = 80,
  seasonOver = false,
}: {
  entries: readonly PerGameLedgerEntry[];
  plotHeight?: number;
  /** A finished season with no nights says so instead of promising a first one. */
  seasonOver?: boolean;
}) {
  const points = useMemo(() => buildPnlSeries(entries), [entries]);
  // Every point, fees since the last night included: the spoken summary's
  // "now" is your score as the block above says it.
  const nights = useMemo(() => nightlySeries(points, entries), [entries, points]);
  // Drawn: played nights only. A move between nights added a flat, undated
  // point that read as a night and pushed the last date to the middle (walk 8
  // T2-02); its fees fold into the next night's reading ("Fees -$250").
  const series = useMemo(() => nights.filter((point) => point.kind !== 'now'), [nights]);
  const domain = useMemo(() => pnlChartDomain(series), [series]);
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  // The value marks' drawn widths, by kind: the gutter fits the widest.
  const [markWidths, setMarkWidths] = useState<Record<string, number>>({});
  const onMarkLayout = useCallback((kind: string, room: number) => {
    setMarkWidths((current) => (Math.abs((current[kind] ?? 0) - room) < 0.5 ? current : { ...current, [kind]: room }));
  }, []);
  const reducedMotion = useReducedMotion();
  const clipId = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const yOf = useCallback((value: number) => (
    INSET_Y + ((domain.maximum - value) / (domain.maximum - domain.minimum)) * (plotHeight - INSET_Y * 2)
  ), [domain.maximum, domain.minimum, plotHeight]);
  const zeroY = INSET_Y + domain.zeroRatio * (plotHeight - INSET_Y * 2);
  const ticks = useMemo(
    () => valueTicks(series.map((night) => night.cumulativePnl), yOf, { height: plotHeight }),
    [plotHeight, series, yOf],
  );
  // Only the marks drawn now count: a low that is gone no longer widens it.
  const gutter = Math.max(GUTTER, ...ticks.map((tick) => (
    markWidths[tick.kind] ? Math.ceil(markWidths[tick.kind]) + GUTTER_GAP : 0
  )));
  const span = Math.max(width - gutter - INSET_RIGHT, 0);
  const xs = useMemo(() => series.map((_, index) => (
    gutter + (index / Math.max(series.length - 1, 1)) * span
  )), [gutter, series, span]);
  const linePath = series.map((point, index) => (
    `${index === 0 ? 'M' : 'L'} ${xs[index].toFixed(1)} ${yOf(point.cumulativePnl).toFixed(1)}`
  )).join(' ');
  const areaPath = series.length > 1
    ? `${linePath} L ${xs.at(-1)!.toFixed(1)} ${zeroY.toFixed(1)} L ${xs[0].toFixed(1)} ${zeroY.toFixed(1)} Z`
    : '';

  // A new reading of the data means old indexes point at other nights.
  useEffect(() => {
    setSelected(null);
  }, [series.length]);

  // Grow into newly settled nights (never on first paint, never with reduced motion).
  const [revealed, setRevealed] = useState(1);
  const shownCount = useRef(series.length);
  useEffect(() => {
    const before = shownCount.current;
    shownCount.current = series.length;
    if (reducedMotion || before < 2 || series.length <= before || typeof requestAnimationFrame !== 'function') {
      setRevealed(1);
      return undefined;
    }
    const from = (before - 1) / (series.length - 1);
    let frame = 0;
    let startedAt: number | null = null;
    const step = (now: number) => {
      startedAt ??= now;
      const progress = Math.min(1, (now - startedAt) / GROW_MS);
      setRevealed(from + (1 - from) * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    setRevealed(from);
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion, series.length]);

  const last = series.length - 1;
  const read = useCallback((x: number, intent: PlotIntent) => {
    const index = nearestIndex(xs, x);
    if (index === null) return;
    setSelected((current) => (intent === 'tap' && current === index ? null : index));
  }, [xs]);
  const onKey = useCallback((key: string) => {
    if (key === 'Escape') {
      if (selected === null) return false;
      setSelected(null);
      return true;
    }
    const current = Math.min(selected ?? last, last);
    const next = key === 'ArrowLeft' ? Math.max(0, current - 1)
      : key === 'ArrowRight' ? Math.min(last, current + 1)
        : key === 'Home' ? 0
          : key === 'End' ? last
            : null;
    if (next === null) return false;
    setSelected(next);
    return true;
  }, [last, selected]);
  const { ref, responderProps } = usePlotPointer({ onRead: read, onLeave: () => setSelected(null), onKey });
  const onLayout = (event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width));

  if (!hasNights(series)) {
    return (
      <View style={styles.container}>
        <View style={styles.heading}>
          <Text accessibilityLabel="Score by night" accessibilityRole="header" {...headingLevel(2)}><Label>Score by night</Label></Text>
        </View>
        {/* Keyed apart from the plot: react-native-web only starts observing
            onLayout when a view mounts, so the plot must mount fresh when the
            first night arrives instead of reusing this view. */}
        <View key="empty" accessible accessibilityLabel={chartSummary(series)}>
          <View style={styles.emptyZero}>
            <Text maxFontSizeMultiplier={1.3} style={styles.emptyZeroLabel}>$0</Text>
            <View style={styles.emptyRule} />
          </View>
          <Text style={styles.emptyText}>
            {seasonOver
              ? 'None of your players played this season, so there is nothing to chart.'
              : 'Your chart starts at $0 and fills in after your first game night.'}
          </Text>
        </View>
      </View>
    );
  }

  // Never trust a stale index for a render: the series can shrink under it.
  const readIndex = selected !== null && selected <= last ? selected : null;
  const point = readIndex === null ? null : series[readIndex];
  const shownIndex = readIndex ?? last;
  const end = series[last];
  const endUp = end.cumulativePnl >= 0;
  const axisLabels = placeAxisLabels(xs, axisLabelIndexes(series, width), width, AXIS_LABEL_WIDTH);
  const revealX = gutter + revealed * span + 4;

  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        {point ? <Reading point={point} previous={series[shownIndex - 1]} /> : (
          <>
            <Text accessibilityLabel="Score by night" accessibilityRole="header" {...headingLevel(2)}><Label>Score by night</Label></Text>
            {/* Tap, click or arrow keys: one word for all of them. */}
            <Text style={styles.hint}>Select a night to read it</Text>
          </>
        )}
      </View>
      <View
        key="plot"
        accessible
        // Native screen readers step nights with their adjust gesture; the web
        // slider takes arrow keys (see usePlotPointer).
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityLabel={chartSummary(nights)}
        accessibilityRole="adjustable"
        aria-valuemax={last}
        aria-valuemin={0}
        aria-valuenow={shownIndex}
        // Always a reading, the selected night's or the last's (walk 8 T3-03).
        aria-valuetext={chartValueText(series, readIndex)}
        onAccessibilityAction={(event) => {
          onKey(event.nativeEvent.actionName === 'increment' ? 'ArrowRight' : 'ArrowLeft');
        }}
        onLayout={onLayout}
        ref={ref}
        style={[styles.plot, { height: plotHeight }]}
        tabIndex={0}
        {...responderProps}
      >
        {width > 0 ? (
          <Svg height={plotHeight} style={styles.svg} width={width}>
            <Defs>
              <ClipPath id={`${clipId}-up`}>
                <Rect height={Math.max(zeroY, 0)} width={width} x={0} y={0} />
              </ClipPath>
              <ClipPath id={`${clipId}-down`}>
                <Rect height={Math.max(plotHeight - zeroY, 0)} width={width} x={0} y={zeroY} />
              </ClipPath>
              <ClipPath id={`${clipId}-reveal`}>
                <Rect height={plotHeight} width={Math.max(revealX, 0)} x={0} y={0} />
              </ClipPath>
            </Defs>
            <G clipPath={`url(#${clipId}-reveal)`}>
              <G clipPath={`url(#${clipId}-up)`}>
                <Path d={areaPath} fill={colors.greenSoft} />
                <Path d={linePath} fill="none" stroke={colors.green} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} />
              </G>
              <G clipPath={`url(#${clipId}-down)`}>
                <Path d={areaPath} fill={colors.redSoft} />
                <Path d={linePath} fill="none" stroke={colors.red} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} />
              </G>
            </G>
            {ticks.map((tick) => (
              <Line
                key={tick.kind}
                stroke={tick.kind === 'zero' ? colors.borderStrong : colors.border}
                strokeDasharray={tick.kind === 'zero' ? '4 4' : '1 4'}
                strokeWidth={1}
                x1={gutter - 2}
                x2={width}
                y1={tick.y}
                y2={tick.y}
              />
            ))}
            {point ? (
              <>
                <Line
                  stroke={colors.muted}
                  strokeDasharray="2 3"
                  strokeWidth={1}
                  x1={xs[shownIndex]}
                  x2={xs[shownIndex]}
                  y1={0}
                  y2={plotHeight}
                />
                <Circle
                  cx={xs[shownIndex]}
                  cy={yOf(point.cumulativePnl)}
                  fill={point.cumulativePnl >= 0 ? colors.green : colors.red}
                  fillOpacity={0.25}
                  r={9}
                />
                <Circle
                  cx={xs[shownIndex]}
                  cy={yOf(point.cumulativePnl)}
                  fill={point.cumulativePnl >= 0 ? colors.green : colors.red}
                  r={4.5}
                />
              </>
            ) : revealed >= 1 ? (
              <Circle cx={xs[last]} cy={yOf(end.cumulativePnl)} fill={endUp ? colors.green : colors.red} r={3.5} />
            ) : null}
          </Svg>
        ) : null}
        {/* The value marks name the lines: $0, and the season's high and low,
            each beside its line or stepped just clear of a close one. */}
        {ticks.map((tick) => (
          <Text
            key={tick.kind}
            maxFontSizeMultiplier={1.3}
            onLayout={(event) => onMarkLayout(tick.kind, event.nativeEvent.layout.width)}
            style={[styles.tickLabel, { top: Math.min(Math.max(tick.labelY - 7, 0), plotHeight - 14) }]}
          >
            {tick.kind === 'zero' ? '$0' : axisMark(tick.value)}
          </Text>
        ))}
      </View>
      <View style={styles.axis}>
        {width > 0 ? axisLabels.map(({ index, left, align }) => (
          // The end labels hang from their edge and grow inward, so wider text
          // (text-spacing overrides) never cuts "Oct 26" to "Oct" (walk 4 T3-13).
          <Text
            key={index}
            maxFontSizeMultiplier={1.3}
            style={[
              styles.axisLabel,
              align === 'right'
                ? { right: 0, width: undefined, textAlign: 'right' }
                : align === 'left'
                  ? { left: 0, width: undefined, textAlign: 'left' }
                  : { left, textAlign: 'center' },
            ]}
          >
            {series[index].label}
          </Text>
        )) : null}
      </View>
    </View>
  );
}

/** The heading while a night is being read: its date, then each figure after its label. */
function Reading({ point, previous }: { point: NightPoint; previous: NightPoint | undefined }) {
  if (point.kind === 'start') {
    return (
      <View style={styles.reading}>
        <Text style={styles.readingDate}>Start</Text>
        <Text style={styles.readingCaption}>Everyone starts at $0</Text>
      </View>
    );
  }
  const { when, fees } = nightReadingParts(point, previous);
  const figure = (caption: string, value: number) => (
    <View key={caption} style={styles.readingPair}>
      <Text style={styles.readingCaption}>{caption}</Text>
      <FineMoney size="body" value={value} />
    </View>
  );
  return (
    <View style={styles.reading}>
      <Text style={styles.readingDate}>{when}</Text>
      <View style={styles.readingFigures}>
        {point.kind === 'night' ? figure('That night', point.change) : figure('Fees', point.change)}
        {fees !== 0 ? figure('Fees', fees) : null}
        {figure('Score', point.cumulativePnl)}
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: 6,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  heading: {
    minHeight: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space.md,
    marginBottom: 2,
  },
  hint: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  reading: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: space.md,
  },
  readingDate: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
  },
  readingFigures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.md,
    rowGap: 2,
  },
  readingPair: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  readingCaption: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  plot: {
    position: 'relative',
    overflow: 'hidden',
  },
  /** Out of flow, so the plot's height is exactly its own. */
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  // Its own width, on one line: the gutter is sized to it, never the reverse.
  tickLabel: {
    position: 'absolute',
    left: 0,
    ...({ whiteSpace: 'nowrap' } as object),
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
    lineHeight: 14,
  },
  axis: {
    position: 'relative',
    height: 16,
  },
  axisLabel: {
    position: 'absolute',
    top: 0,
    width: AXIS_LABEL_WIDTH,
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
    lineHeight: 16,
  },
  emptyZero: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
  },
  emptyZeroLabel: {
    width: GUTTER,
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  emptyRule: {
    flex: 1,
    height: 0,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderTopColor: colors.borderStrong,
  },
  emptyText: {
    marginTop: space.xs,
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
    lineHeight: 17,
  },
});
