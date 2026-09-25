import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect } from 'react-native-svg';

import type { PerGameLedgerEntry } from '../api/contracts';
import { humanDay, signedMoney } from '../copy/terms';
import {
  axisLabelIndexes,
  chartSummary,
  hasNights,
  nearestIndex,
  nightlySeries,
  type NightPoint,
} from '../data/rosterView';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { buildPnlSeries, pnlChartDomain } from '../state/perGameState';
import { colors, fonts, space, type, weight } from '../theme';
import { Label, Money } from '../ui/kit';
import { usePlotPointer, type PlotIntent } from './roster/usePlotPointer';

/** Room at the left of the plot for the "$0" label that names the zero line. */
const ZERO_GUTTER = 24;
const INSET_RIGHT = 6;
const INSET_Y = 8;
const AXIS_LABEL_WIDTH = 64;
const GROW_MS = 520;

/** True where the main pointer is a mouse or trackpad, so the hint says "point" rather than "tap". */
function canPoint(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(pointer: fine)').matches;
}

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
  plotHeight: fixedHeight = 80,
  fill = false,
}: {
  entries: readonly PerGameLedgerEntry[];
  /** Plot height when the chart does not fill its column. */
  plotHeight?: number;
  /** Grow to fill the rest of a column (desktop), never below `plotHeight`. */
  fill?: boolean;
}) {
  const points = useMemo(() => buildPnlSeries(entries), [entries]);
  const series = useMemo(() => nightlySeries(points, entries), [entries, points]);
  const domain = useMemo(() => pnlChartDomain(series), [series]);
  const [width, setWidth] = useState(0);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const plotHeight = fill ? Math.max(measuredHeight, fixedHeight) : fixedHeight;
  const [selected, setSelected] = useState<number | null>(null);
  const reducedMotion = useReducedMotion();
  const pointable = useMemo(canPoint, []);
  const clipId = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const span = Math.max(width - ZERO_GUTTER - INSET_RIGHT, 0);
  const xs = useMemo(() => series.map((_, index) => (
    ZERO_GUTTER + (index / Math.max(series.length - 1, 1)) * span
  )), [series, span]);
  const yOf = useCallback((value: number) => (
    INSET_Y + ((domain.maximum - value) / (domain.maximum - domain.minimum)) * (plotHeight - INSET_Y * 2)
  ), [domain.maximum, domain.minimum, plotHeight]);
  const zeroY = INSET_Y + domain.zeroRatio * (plotHeight - INSET_Y * 2);
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
  const onLayout = (event: LayoutChangeEvent) => {
    setWidth(Math.round(event.nativeEvent.layout.width));
    setMeasuredHeight(Math.round(event.nativeEvent.layout.height));
  };

  if (!hasNights(series)) {
    return (
      <View style={styles.container}>
        <View style={styles.heading}>
          <Label>Score by night</Label>
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
            Your chart starts at $0 and fills in after your first game night.
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
  const zeroLabelTop = Math.min(Math.max(zeroY - 7, 0), plotHeight - 14);
  const labelIndexes = axisLabelIndexes(series, width);
  const revealX = ZERO_GUTTER + revealed * span + 4;

  return (
    <View style={[styles.container, fill && styles.fill]}>
      <View style={styles.heading}>
        {point ? <Reading point={point} previous={series[shownIndex - 1]} /> : (
          <>
            <Label>Score by night</Label>
            <Text style={styles.hint}>{pointable ? 'Point at a night to read it' : 'Tap a night to read it'}</Text>
          </>
        )}
      </View>
      <View
        key="plot"
        accessible
        // Native screen readers step nights with their adjust gesture; the web
        // slider takes arrow keys (see usePlotPointer).
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityLabel={chartSummary(series)}
        accessibilityRole="adjustable"
        aria-valuemax={last}
        aria-valuemin={0}
        aria-valuenow={shownIndex}
        aria-valuetext={readingText(series[shownIndex], series[shownIndex - 1])}
        onAccessibilityAction={(event) => {
          onKey(event.nativeEvent.actionName === 'increment' ? 'ArrowRight' : 'ArrowLeft');
        }}
        onLayout={onLayout}
        ref={ref}
        style={[styles.plot, fill ? [styles.fill, { minHeight: fixedHeight }] : { height: fixedHeight }]}
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
            <Line
              stroke={colors.borderStrong}
              strokeDasharray="4 4"
              strokeWidth={1}
              x1={ZERO_GUTTER - 2}
              x2={width}
              y1={zeroY}
              y2={zeroY}
            />
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
        <Text maxFontSizeMultiplier={1.3} style={[styles.zeroLabel, { top: zeroLabelTop }]}>$0</Text>
      </View>
      <View style={styles.axis}>
        {width > 0 ? labelIndexes.map((index) => {
          const left = Math.min(Math.max(xs[index] - AXIS_LABEL_WIDTH / 2, 0), Math.max(width - AXIS_LABEL_WIDTH, 0));
          const align = left <= 0 ? 'left' : left >= width - AXIS_LABEL_WIDTH ? 'right' : 'center';
          return (
            <Text key={index} maxFontSizeMultiplier={1.3} style={[styles.axisLabel, { left, textAlign: align }]}>
              {series[index].label}
            </Text>
          );
        }) : null}
      </View>
    </View>
  );
}

/** "Wed, Oct 29: score +$40K, that night +$12K", for the slider value. */
function readingText(point: NightPoint, previous: NightPoint | undefined): string {
  if (point.kind === 'start') return 'Start: you begin at $0';
  const when = point.kind === 'night' ? humanDay(point.date) : 'Now';
  const change = point.kind === 'night'
    ? `that night ${signedMoney(point.change)}`
    : `fees since ${previous?.label ?? 'the last night'} ${signedMoney(point.change)}`;
  return `${when}: score ${signedMoney(point.cumulativePnl)}, ${change}`;
}

/** The heading while a night is being read: its date, the score then, and the night's result. */
function Reading({ point, previous }: { point: NightPoint; previous: NightPoint | undefined }) {
  if (point.kind === 'start') {
    return (
      <View style={styles.reading}>
        <Text style={styles.readingDate}>Start</Text>
        <Text style={styles.readingCaption}>Everyone starts at $0</Text>
      </View>
    );
  }
  return (
    <View style={styles.reading}>
      <Text style={styles.readingDate}>{point.kind === 'night' ? humanDay(point.date) : 'Now'}</Text>
      <View style={styles.readingFigures}>
        <Money size="body" value={point.cumulativePnl} />
        <Text style={styles.readingCaption}>score</Text>
        <Money size="body" value={point.change} />
        <Text style={styles.readingCaption}>
          {point.kind === 'night' ? 'that night' : `since ${previous?.label ?? 'last night'}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm + 2,
    paddingBottom: space.sm,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  heading: {
    minHeight: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space.md,
    marginBottom: space.xs,
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
    alignItems: 'baseline',
    gap: 4,
  },
  readingCaption: {
    marginRight: space.xs,
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  fill: {
    flexGrow: 1,
  },
  plot: {
    position: 'relative',
    overflow: 'hidden',
  },
  /** Out of flow, so a filled plot can shrink again when the window does. */
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  zeroLabel: {
    position: 'absolute',
    left: 0,
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
    marginTop: 2,
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
    width: ZERO_GUTTER,
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
