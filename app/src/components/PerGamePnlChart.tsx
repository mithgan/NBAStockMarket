import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect } from 'react-native-svg';

import type { PerGameLedgerEntry } from '../api/contracts';
import {
  axisLabelIndexes,
  chartSummary,
  chartValueText,
  MARK_MIN_GAP,
  nightReadingParts,
  hasNights,
  LOW_INSIDE_ROOM,
  lowInsideIndex,
  lowInsidePlace,
  nearestIndex,
  nightlySeries,
  placeAxisLabels,
  plotXs,
  readingRevealTop,
  valueTicks,
  weekStepIndex,
  widestReading,
  valueMark,
  type NightPoint,
} from '../data/rosterView';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { buildPnlSeries, pnlChartDomain } from '../state/perGameState';
import { colors, fonts, space, type, weight } from '../theme';
import { Button, headingLevel, Label, repeatSafe, visuallyHidden } from '../ui/kit';
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
/** The Low mark drawn inside the plot: its box, wide enough for "Low -$848.3K". */
const LOW_INSIDE_BOX = 96;
const GROW_MS = 520;

/**
 * Your score, night by night, from the $0 you start at.
 *
 * One point per game night (see `nightlySeries`), and a short dashed step for
 * fees paid since the last night, so the line always ends on your score: the
 * line is green above the
 * labelled $0 line and red below it, the x-axis names real dates, and tapping
 * (touch), pointing (mouse) or arrow keys read one night's score and what that
 * night's games made. When a new night settles while the chart is on screen
 * the line grows into it, unless the viewer asked for reduced motion.
 */
export function PerGamePnlChart({
  entries,
  plotHeight = 80,
  seasonOver = false,
  widen,
  pin,
}: {
  entries: readonly PerGameLedgerEntry[];
  plotHeight?: number;
  /** A finished season with no nights says so instead of promising a first one. */
  seasonOver?: boolean;
  /**
   * Desktop (walk 15 T2-02): a toggle beside the heading spans the chart
   * across the whole Roster, so a mouse can pick one night of a season (the
   * score column's plot gave a season's 174 nights about 240px). `focus`
   * moves keyboard focus to the toggle once the chart has moved, then
   * `onFocused` clears it.
   */
  widen?: { wide: boolean; onToggle: () => void; focus: boolean; onFocused: () => void };
  /**
   * The night picked, kept by the screen (walk 16 T2-N4): Full width and
   * Narrow draw the chart in another place, and it opens there on the night
   * picked before, not on "Select a night to read it".
   */
  pin?: { night: number | null; onPin: (night: number | null) => void };
}) {
  const toggleRef = useRef<View | null>(null);
  const widenFocus = widen?.focus ?? false;
  const onWidenFocused = widen?.onFocused;
  useEffect(() => {
    if (!widenFocus) return;
    (toggleRef.current as unknown as { focus?: () => void } | null)?.focus?.();
    onWidenFocused?.();
  }, [onWidenFocused, widenFocus]);
  const points = useMemo(() => buildPnlSeries(entries), [entries]);
  // Every point is drawn, fees since the last night included, so the line
  // ends on your score as the block above says it and the Low mark is the
  // low that is spoken (walk 12 T2-07, T4-03, T3-08). Those fees are a short
  // dashed step after the last night, not a night's width, so the last
  // date stays at the right edge (walk 8 T2-02); once the next night plays
  // they join its point ("Fees -$250"). A night none of your players played
  // leaves them on that step until then.
  const series = useMemo(() => nightlySeries(points, entries), [entries, points]);
  const nightCount = useMemo(() => series.filter((point) => point.kind === 'night').length, [series]);
  const domain = useMemo(() => pnlChartDomain(series), [series]);
  const [width, setWidth] = useState(0);
  // The night being read: one a mouse points at (desktop hover, walk 9
  // T2-N3) wins over the one pinned by a click, a tap, a slide or the keys;
  // leaving the plot goes back to the pinned one.
  const [pinned, setPinned] = useState<number | null>(pin?.night ?? null);
  const onPin = pin?.onPin;
  useEffect(() => {
    onPin?.(pinned);
  }, [onPin, pinned]);
  const [hovered, setHovered] = useState<number | null>(null);
  const selected = hovered ?? pinned;
  // Whether the longest reading needs two lines: the resting words then take
  // two as well, so the heading never changes height (walk 9 T1-03).
  const [tallReading, setTallReading] = useState(true);
  const keysId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-keys`;
  // The value marks' drawn widths, by kind: the gutter fits the widest.
  const [markWidths, setMarkWidths] = useState<Record<string, number>>({});
  const onMarkLayout = useCallback((kind: string, room: number) => {
    setMarkWidths((current) => (Math.abs((current[kind] ?? 0) - room) < 0.5 ? current : { ...current, [kind]: room }));
  }, []);
  const reducedMotion = useReducedMotion();
  const clipId = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const values = useMemo(() => series.map((night) => night.cumulativePnl), [series]);
  // A low whose gutter mark gives way to "$0" is named inside the plot,
  // under its dip, and the plot keeps room there for its words (walk 17, T4
  // idea 6): a season that climbed high never loses "how low did I go".
  const lowCrowds = useMemo(() => {
    const plain = (value: number) => (
      INSET_Y + ((domain.maximum - value) / (domain.maximum - domain.minimum)) * (plotHeight - INSET_Y * 2)
    );
    return lowInsideIndex(values, valueTicks(values, plain, { height: plotHeight, minGap: MARK_MIN_GAP })) !== null;
  }, [domain.maximum, domain.minimum, plotHeight, values]);
  const insetBottom = INSET_Y + (lowCrowds ? LOW_INSIDE_ROOM : 0);
  const yOf = useCallback((value: number) => (
    INSET_Y + ((domain.maximum - value) / (domain.maximum - domain.minimum)) * (plotHeight - INSET_Y - insetBottom)
  ), [domain.maximum, domain.minimum, insetBottom, plotHeight]);
  const zeroY = INSET_Y + domain.zeroRatio * (plotHeight - INSET_Y - insetBottom);
  const ticks = useMemo(
    // A high or low close to "$0" gives way to it (walk 9 T1-11).
    () => valueTicks(values, yOf, { height: plotHeight, minGap: MARK_MIN_GAP }),
    [plotHeight, values, yOf],
  );
  const lowInside = lowCrowds ? lowInsideIndex(values, ticks) : null;
  // Only the marks drawn now count: a low that is gone no longer widens it.
  const gutter = Math.max(GUTTER, ...ticks.map((tick) => (
    markWidths[tick.kind] ? Math.ceil(markWidths[tick.kind]) + GUTTER_GAP : 0
  )));
  const span = Math.max(width - gutter - INSET_RIGHT, 0);
  const xs = useMemo(() => plotXs(series, gutter, span), [gutter, series, span]);
  const spanNow = useRef(span);
  spanNow.current = span;
  const at = (index: number) => `${xs[index].toFixed(1)} ${yOf(series[index].cumulativePnl).toFixed(1)}`;
  const through = (count: number) => series.slice(0, count).map((_, index) => `${index === 0 ? 'M' : 'L'} ${at(index)}`).join(' ');
  // The nights' line is solid; fees since the last night are its dashed step.
  const tailed = series.length > 2 && series[series.length - 1].kind === 'now';
  const solidCount = tailed ? series.length - 1 : series.length;
  const linePath = through(solidCount);
  const tailPath = tailed ? `M ${at(solidCount - 1)} L ${at(series.length - 1)}` : '';
  const areaPath = series.length > 1
    ? `${through(series.length)} L ${xs.at(-1)!.toFixed(1)} ${zeroY.toFixed(1)} L ${xs[0].toFixed(1)} ${zeroY.toFixed(1)} Z`
    : '';

  // A new night means old indexes may point at other nights. Fees since the
  // last night only add a point at the end, so a reading stays put. Only a
  // change lets go: a chart drawn again in its new place (Full width,
  // Narrow) keeps the night picked before (walk 16 T2-N4).
  const pinNights = useRef(nightCount);
  useEffect(() => {
    if (pinNights.current === nightCount) return;
    pinNights.current = nightCount;
    setPinned(null);
    setHovered(null);
  }, [nightCount]);

  // Grow into newly settled nights (never on first paint, never with reduced motion).
  const [revealed, setRevealed] = useState(1);
  const shownNights = useRef(nightCount);
  useEffect(() => {
    const before = shownNights.current;
    shownNights.current = nightCount;
    if (reducedMotion || before < 1 || nightCount <= before || typeof requestAnimationFrame !== 'function') {
      setRevealed(1);
      return undefined;
    }
    // From where the last night drawn before now sits: nights come first
    // after the start, so it is point `before`; a step of fees that followed
    // it has joined the new night.
    const room = spanNow.current;
    const from = room > 0 ? Math.min(1, Math.max(0, plotXs(series, 0, room)[before] / room)) : 0;
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
    // Only a new night grows the line; `series` is read as it is then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, nightCount]);

  // A tap, click or slide asks to see its reading: when the heading that
  // carries it has scrolled under the top of the page, it comes into view
  // (walk 10 T1-07). Pointing (hover) and the keys never move the page.
  const headingRef = useRef<View>(null);
  const revealWanted = useRef(false);
  useEffect(() => {
    const wanted = revealWanted.current;
    revealWanted.current = false;
    if (pinned === null || !wanted) return;
    revealReading(headingRef.current, reducedMotion);
  }, [pinned, reducedMotion]);

  const last = series.length - 1;
  const read = useCallback((x: number, intent: PlotIntent) => {
    const index = nearestIndex(xs, x);
    if (index === null) return;
    if (intent !== 'point') revealWanted.current = true;
    // Pointing reads a night; a click pins it, and a click on the pinned
    // night lets it go, as a second tap does.
    if (intent === 'point') setHovered(index);
    else if (intent === 'slide') setPinned(index);
    else setPinned((current) => (current === index ? null : index));
  }, [xs]);
  const onKey = useCallback((key: string) => {
    // The keys never move the page, even right after a slide asked to.
    revealWanted.current = false;
    if (key === 'Escape') {
      if (selected === null) return false;
      setPinned(null);
      setHovered(null);
      return true;
    }
    const current = Math.min(selected ?? last, last);
    // Arrows move a night, Page keys a week (walk 9 T3-N1), Home and End the ends.
    const next = key === 'ArrowLeft' ? Math.max(0, current - 1)
      : key === 'ArrowRight' ? Math.min(last, current + 1)
        : key === 'PageDown' ? weekStepIndex(series, current, -1)
          : key === 'PageUp' ? weekStepIndex(series, current, 1)
            : key === 'Home' ? 0
              : key === 'End' ? last
                : null;
    if (next === null) return false;
    // The keys own the reading until the mouse moves again.
    setHovered(null);
    setPinned(next);
    return true;
  }, [last, selected, series]);
  const { ref, responderProps } = usePlotPointer({ onRead: read, onLeave: () => setHovered(null), onKey });
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
        <View key="empty">
          {/* The sentence under the drawn $0 line is what a reader hears (it
              says why, at season end too); a name on this role-less view was
              not read everywhere (walk 15 T3-09). */}
          <View aria-hidden style={styles.emptyZero}>
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
  const widest = widestReading(series);
  const restWords = (
    <View style={tallReading ? styles.restStacked : styles.restLine}>
      <Text accessibilityLabel="Score by night" accessibilityRole="header" {...headingLevel(2)}><Label>Score by night</Label></Text>
      {/* Tap, click or arrow keys: one word for all of them. */}
      <Text style={styles.hint}>Select a night to read it</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* The heading holds the height of its longest reading from the start,
          so reading a night never pushes the chart and the rows under it
          (walk 9 T1-03): unseen copies of the resting words and of the
          longest reading share its one cell with what is shown. */}
      <View style={styles.headingRow}>
      <View ref={headingRef} style={[styles.heading, styles.headingFill]}>
        <View style={styles.headingLayer}>
          {point ? <Reading point={point} previous={series[shownIndex - 1]} stacked={tallReading} /> : restWords}
        </View>
        <View aria-hidden style={[styles.headingLayer, styles.headingGhost]}>
          {restWords}
        </View>
        {/* Measured as it would wrap by itself: two lines or more, and every
            reading takes its date line and its figures line. */}
        <View
          aria-hidden
          onLayout={(event) => {
            const tall = event.nativeEvent.layout.height > 26;
            setTallReading((current) => (current === tall ? current : tall));
          }}
          style={[styles.headingLayer, styles.headingGhost]}
        >
          <Reading point={series[widest]} previous={series[widest - 1]} />
        </View>
        {tallReading ? (
          <View aria-hidden style={[styles.headingLayer, styles.headingGhost]}>
            <Reading point={series[widest]} previous={series[widest - 1]} stacked />
          </View>
        ) : null}
      </View>
      {/* Outside the heading's layers, so it stays while a night is read. */}
      {widen ? (
        <Button
          ref={toggleRef}
          accessibilityLabel={widen.wide ? 'Score by night: back beside your score' : 'Score by night: full width, to pick one night'}
          label={widen.wide ? 'Narrow' : 'Full width'}
          onPress={repeatSafe(widen.onToggle)}
          style={styles.widen}
        />
      ) : null}
      </View>
      {/* How the keys move, said once after the slider's name (walk 9 T3-N1). */}
      <Text nativeID={keysId} style={visuallyHidden}>Arrow keys move a night, Page keys a week.</Text>
      <View
        key="plot"
        {...({ 'aria-describedby': keysId } as object)}
        accessible
        // Native screen readers step nights with their adjust gesture; the web
        // slider takes arrow keys (see usePlotPointer).
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityLabel={chartSummary(series)}
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
                // Above or below $0 is the chart's message: its line is drawn
                // at 3:1 in the muted-text colour (walk 9 T3-13), solid, a
                // hairline, so the one dash on the chart is the fee step
                // (walk 16 T2-02); the high and low guides stay faint.
                stroke={tick.kind === 'zero' ? colors.muted : colors.border}
                strokeDasharray={tick.kind === 'zero' ? undefined : '1 4'}
                strokeWidth={1}
                x1={gutter - 2}
                x2={width}
                y1={tick.y}
                y2={tick.y}
              />
            ))}
            {tailPath ? (
              // Fees since the last night: the chart's only dashed stroke,
              // drawn over the $0 line so it stands out where they meet.
              <G clipPath={`url(#${clipId}-reveal)`}>
                <G clipPath={`url(#${clipId}-up)`}>
                  <Path d={tailPath} fill="none" stroke={colors.green} strokeDasharray="3 3" strokeWidth={2} />
                </G>
                <G clipPath={`url(#${clipId}-down)`}>
                  <Path d={tailPath} fill="none" stroke={colors.red} strokeDasharray="3 3" strokeWidth={2} />
                </G>
              </G>
            ) : null}
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
            {valueMark(tick.kind, tick.value)}
          </Text>
        ))}
        {/* The low that gave way to "$0" in the gutter, named under its dip
            once the line has reached it (walk 17, T4 idea 6). */}
        {lowInside !== null && width > 0 && xs[lowInside] !== undefined && xs[lowInside] <= revealX ? (() => {
          const place = lowInsidePlace(xs[lowInside], LOW_INSIDE_BOX, gutter, width - INSET_RIGHT);
          return (
            <Text
              maxFontSizeMultiplier={1.3}
              style={[
                styles.tickLabel,
                styles.lowInside,
                // Clear of the end dot (r 3.5) when the low is the latest point;
                // a box squeezed narrower than its words takes two lines.
                {
                  left: place.left,
                  width: place.width,
                  textAlign: place.align,
                  top: Math.min(yOf(values[lowInside]) + 4, plotHeight - (place.width < LOW_INSIDE_BOX ? 29 : 15)),
                },
              ]}
            >
              {valueMark('low', values[lowInside])}
            </Text>
          );
        })() : null}
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

/**
 * Scrolls the chart's heading into view when it sits above the top of the
 * area that scrolls it (web): the least move that shows the reading, smooth
 * unless the viewer asked for less motion.
 */
function revealReading(node: unknown, reducedMotion: boolean) {
  if (Platform.OS !== 'web') return;
  const heading = node as HTMLElement | null;
  if (!heading || typeof heading.getBoundingClientRect !== 'function') return;
  let area = heading.parentElement;
  while (area && !(area.scrollHeight > area.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(area).overflowY))) {
    area = area.parentElement;
  }
  if (!area) return;
  const top = readingRevealTop(heading.getBoundingClientRect().top - area.getBoundingClientRect().top, area.scrollTop);
  if (top === null) return;
  // The element's own scrollTo: react-native-web gives a ScrollView's node its
  // own `scrollTo({ x, y })`, which reads these options as the top.
  (Element.prototype.scrollTo as (this: Element, options: ScrollToOptions) => void)
    .call(area, { top, behavior: reducedMotion ? 'auto' : 'smooth' });
}

/**
 * The heading while a night is being read: its date, then each figure after
 * its label. `stacked` puts the figures on the line under the date, where a
 * narrow chart would wrap the longest reading anyway, so every night reads in
 * the same two lines.
 */
function Reading({ point, previous, stacked = false }: { point: NightPoint; previous: NightPoint | undefined; stacked?: boolean }) {
  if (point.kind === 'start') {
    return (
      <View style={[styles.reading, stacked && styles.readingStacked]}>
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
    <View style={[styles.reading, stacked && styles.readingStacked]}>
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
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: space.sm,
  },
  headingFill: {
    flex: 1,
    minWidth: 0,
  },
  widen: {
    marginBottom: space.xs,
  },
  // One cell, as tall as the tallest of its layers.
  heading: {
    minHeight: 18,
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 2,
  },
  headingLayer: {
    width: '100%',
    flexShrink: 0,
  },
  // Laid out, never drawn, read, found or selected.
  headingGhost: {
    pointerEvents: 'none',
    marginLeft: '-100%',
    ...({ visibility: 'hidden' } as object),
  },
  restLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space.md,
  },
  restStacked: {
    rowGap: 2,
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
  readingStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  readingDate: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
  },
  // Shrinks to its line and wraps a pair (and a pair its figure under its
  // label) when the letters widen: a reader's text spacing at 320px ran the
  // longest reading's measuring copy to x=360, so the Roster could pan
  // sideways (walk 14 T3-01).
  readingFigures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    flexShrink: 1,
    minWidth: 0,
    alignItems: 'baseline',
    columnGap: space.md,
    rowGap: 2,
  },
  readingPair: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    flexShrink: 1,
    minWidth: 0,
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
  // The Low mark inside the plot: a box its words centre in, under the dip.
  lowInside: {
    width: LOW_INSIDE_BOX,
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
    // The $0 line, at 3:1 and solid as on the drawn chart (walk 9 T3-13,
    // walk 16 T2-02).
    borderTopColor: colors.muted,
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
