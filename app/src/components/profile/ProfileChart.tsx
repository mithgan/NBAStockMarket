/**
 * Game-by-game chart for the player profile.
 *
 * Dividends view: one bar per game for his dividend, rising from $0, with the
 * price a game as a dashed gold step line (the theme's text-grade gold, `goldInk`). Bars are green when that game was a
 * gain for the side you look from (he beat his price on a roster, stayed
 * under it for a short) and a hollow red outline when it was a loss.
 * Price view: his market price game by game (solid gold), against your locked
 * price (dashed) on the nights you held him, each labelled with its value.
 *
 * Reading a game: tap or click a bar and the read-out above the chart names
 * that game's date, where its price came from, and the money. A mouse also
 * reads the game under the pointer while it moves. From the keyboard the
 * chart is a slider: arrow keys step through the games, Home and End jump to
 * the first and latest. With nothing picked the read-out shows his latest game.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import type { PerGamePositionSide } from '../../api/contracts';
import { humanDate, money, moneyFine } from '../../copy/terms';
import {
  chartDateLabels,
  chartLegend,
  chartSummary,
  drawsHollow,
  EXTREME_LABEL_LINE,
  extremeLabels,
  missStroke,
  missSwatchHollow,
  nightIndexAt,
  nightReadout,
  priceChartHeight,
  nowLabel,
  profileChartModel,
  readoutCaption,
  sideWords,
  steppedIndex,
  type ChartInsets,
  type ProfileMetric,
  type ProfileNight,
} from '../../data/profileView';
import { colors, fonts, radius, space, type, weight } from '../../theme';
import { repeatSafe } from '../../ui/kit';

const INSETS: ChartInsets = { top: 22, right: 6, bottom: 20, left: 6 };
/**
 * Price view: a gutter at the left for the scale's marks, his high and low
 * price beside their guide lines, as on the Score by night chart (walk 5
 * T2-08). A chart too narrow for a gutter (400% zoom) keeps the plot whole;
 * the read-out above it names the price.
 */
const GUTTER = 52;
const PRICE_INSETS: ChartInsets = { top: 12, right: 6, bottom: 12, left: GUTTER };
const PRICE_INSETS_BARE: ChartInsets = { top: 12, right: 6, bottom: 12, left: 6 };
/**
 * Dividends view: the same gutter, where the $0 line is named, as on the
 * Score by night chart, so a game below zero reads as below zero, not as a
 * small one (walk 7 T1-08). Bars and dates keep their places when you switch
 * between Dividends and Price.
 */
const DIVIDEND_INSETS: ChartInsets = { top: 22, right: 6, bottom: 20, left: GUTTER };
const SCALE_MIN_WIDTH = 160;
/** Half a mark's height: its words are about 14px tall. */
const MARK_HALF = 7;
/** A date label's box, centred under its game. */
const DATE_BOX = 64;
/** Outline width of a missed game's hollow bar. */
const MISS_STROKE = 1.5;

/** Green for a game that gained for the reader's side, red for a loss. */
function barColor(night: ProfileNight): string {
  if (night.net > 0) return colors.green;
  if (night.net < 0) return colors.red;
  return colors.muted;
}

export function ProfileChart({
  nights,
  metric,
  side,
  height = 180,
  now,
}: {
  nights: ProfileNight[];
  metric: ProfileMetric;
  side: PerGamePositionSide;
  height?: number;
  /** His price today: the Price view ends at it, a hollow point named "Now" (walk 16 T2-N3). */
  now?: number;
}) {
  const [width, setWidth] = useState(0);
  // A tap, click or key pins a game; a moving mouse previews one. Showing:
  // preview, then pin, then his latest game.
  const [pinned, setPinned] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  // Wide enough for the gutter of marks (not at 400% zoom).
  const gutter = width >= SCALE_MIN_WIDTH;
  const scaled = metric === 'price' && gutter;
  const insets = metric === 'price'
    ? (scaled ? PRICE_INSETS : PRICE_INSETS_BARE)
    : gutter ? DIVIDEND_INSETS : INSETS;
  // A small price drift draws on a shorter chart at the same scale, centred
  // on your locked line (walk 9 T2-03).
  const plotHeight = metric === 'price' ? priceChartHeight(nights, height, insets) : height;
  const nowPrice = metric === 'price' ? now : undefined;
  const model = useMemo(
    () => profileChartModel(nights, metric, width, plotHeight, insets, height, nowPrice),
    [height, insets, metric, nights, nowPrice, plotHeight, width],
  );
  const nowWords = nowLabel(model, width, plotHeight);
  const lastAnchor = model.anchors[model.anchors.length - 1];
  const words = sideWords(side);
  const legend = chartLegend(nights, metric, side);
  // The "Missed his price" swatch is drawn the way the bars are (walk 6 T1-09).
  const hollowMisses = missSwatchHollow(model.bars);

  // A new range or metric starts clean, on his latest game. Keyed on what the
  // nights are, not the array's identity, so a re-render keeps the pick.
  const signature = `${metric}|${side}|${nights.length}|${nights[0]?.date ?? ''}|${nights[nights.length - 1]?.date ?? ''}`;
  useEffect(() => {
    setPinned(null);
    setPreview(null);
  }, [signature]);

  const latest = useRef({ model, count: nights.length, pinned, left: insets.left });
  latest.current = { model, count: nights.length, pinned, left: insets.left };
  const indexAt = (x: number) => nightIndexAt(x, latest.current.model.slot, latest.current.left, latest.current.count);
  const step = useCallback((key: string): boolean => {
    const { count, pinned: current } = latest.current;
    const next = steppedIndex(key, current ?? count - 1, count);
    if (next === null) return false;
    setPreview(null);
    setPinned(next);
    return true;
  }, []);

  // Web: listen on the real DOM node. react-native-web's synthetic events do
  // not carry pointer type, and a touch must pin the game (it has no hover).
  const cleanup = useRef<(() => void) | null>(null);
  const attach = useCallback((instance: unknown) => {
    cleanup.current?.();
    cleanup.current = null;
    const node = instance as HTMLElement | null;
    if (Platform.OS !== 'web' || !node || typeof node.addEventListener !== 'function') return;
    // Vertical swipes still scroll the sheet; sideways drags read games.
    node.style.touchAction = 'pan-y';
    const at = (event: PointerEvent) => indexAt(event.clientX - node.getBoundingClientRect().left);
    // A click or a tap pins the game, and the same game again unpins it. A tap
    // acts on lift, so a swipe that turns into a scroll (pointercancel) never
    // changes the read-out; a sideways drag reads games as it goes.
    let dragged = false;
    const toggle = (index: number | null) => setPinned((current) => (current === index ? null : index));
    // A double tap on a bar pins it once instead of pinning and unpinning
    // (the Watch rule; walk 6 T4-11). Drags still read game by game.
    const tapToggle = repeatSafe(toggle);
    const down = (event: PointerEvent) => {
      dragged = false;
      if (event.pointerType === 'mouse') toggle(at(event));
    };
    const up = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && !dragged) tapToggle(at(event));
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') setPreview(at(event));
      else if (event.buttons > 0) {
        dragged = true;
        setPinned(at(event));
      }
    };
    const leave = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') setPreview(null);
    };
    const key = (event: KeyboardEvent) => {
      if (step(event.key)) event.preventDefault();
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerleave', leave);
    node.addEventListener('keydown', key);
    cleanup.current = () => {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', leave);
      node.removeEventListener('keydown', key);
    };
    // indexAt and step read refs, so the listeners bind once per node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => cleanup.current?.(), []);

  // Native: a touch or drag pins the game under the finger.
  const responder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => Platform.OS !== 'web',
      onMoveShouldSetPanResponder: (_event, gesture) => Platform.OS !== 'web' && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderGrant: (event) => setPinned(indexAt(event.nativeEvent.locationX)),
      onPanResponderMove: (event) => setPinned(indexAt(event.nativeEvent.locationX)),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setWidth((previous) => (previous === next ? previous : next));
  }, []);

  if (nights.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>No games yet. His chart starts after his first game.</Text>
      </View>
    );
  }

  const active = preview ?? pinned;
  const shownIndex = active ?? nights.length - 1;
  const shown = nights[shownIndex];
  const anchor = model.anchors[shownIndex];
  const reading = nightReadout(shown, metric, side);
  // "Latest game, Oct 27, against your price": a sentence, not three labels.
  const caption = readoutCaption(shown, metric, side, active === null);
  // The Price view's words above already set today against your price, so a
  // game night's price shows only for a game you pick (walk 8 T1-07: three
  // prices for one day). The slider still reads his latest game, never empty.
  const idlePrice = metric === 'price' && active === null;
  // The dividends view names its tallest and lowest bar, each just above its
  // own bar (walk 9 T2-02); the price view has its scale in the gutter instead.
  const labels = metric === 'dividends' && active === null
    ? extremeLabels(model, nights.map((night) => night.dividend), width, plotHeight, money)
    : [];
  const marks = scaled ? model.priceMarks : [];
  const dates = chartDateLabels(model.anchors.map((point) => point.x), width, DATE_BOX);
  const zeroY = model.zeroY;

  return (
    <View>
      <View style={styles.readout}>
        <Text maxFontSizeMultiplier={1.4} style={styles.readoutDate}>{idlePrice ? 'His price on a game night' : caption}</Text>
        <Text maxFontSizeMultiplier={1.4} style={[styles.readoutValue, idlePrice && styles.readoutIdle]}>
          {idlePrice ? 'Pick a game on the chart' : reading}
        </Text>
      </View>
      <View
        accessible
        // Native screen readers step games with their adjust gesture; on the
        // web the slider takes arrow keys, Home and End.
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityLabel={chartSummary(nights, metric, side)}
        accessibilityRole="adjustable"
        aria-valuemax={nights.length - 1}
        aria-valuemin={0}
        aria-valuenow={shownIndex}
        aria-valuetext={`${caption}. ${reading}`}
        onAccessibilityAction={(event) => {
          step(event.nativeEvent.actionName === 'increment' ? 'ArrowRight' : 'ArrowLeft');
        }}
        onLayout={onLayout}
        ref={attach}
        style={[styles.plot, { height: plotHeight }]}
        tabIndex={0}
        {...responder.panHandlers}
      >
        {width > 0 ? (
          <Svg height={plotHeight} width={width}>
            {metric === 'dividends' && zeroY !== null ? (
              <Line stroke={colors.borderStrong} strokeWidth={1} x1={gutter ? insets.left - 4 : 0} x2={width} y1={zeroY} y2={zeroY} />
            ) : null}
            {marks.map((mark) => (
              <Line
                key={mark.kind}
                stroke={colors.borderStrong}
                strokeDasharray="1 4"
                strokeWidth={1}
                x1={insets.left}
                x2={width - insets.right}
                y1={mark.y}
                y2={mark.y}
              />
            ))}
            {active !== null && anchor ? (
              <Line
                stroke={colors.faint}
                strokeDasharray="2 4"
                strokeWidth={1}
                x1={anchor.x}
                x2={anchor.x}
                y1={4}
                y2={plotHeight - 4}
              />
            ) : null}
            {metric === 'dividends'
              ? model.bars.map((bar, index) => {
                // A miss is a hollow bar, a beat a solid one: the shape says it
                // too, not only red against green (walk-1 T3-19). The outline
                // sits inside the bar so both keep the same size.
                // Too narrow for an outline, a miss is solid, and so is the
                // legend's swatch (missSwatchHollow; walk 6 T1-09).
                const missed = nights[index].net < 0 && drawsHollow(bar);
                const stroke = missStroke(bar.width);
                const inset = missed ? stroke / 2 : 0;
                return (
                  <Rect
                    fill={missed ? 'none' : barColor(nights[index])}
                    height={bar.height - inset * 2}
                    key={nights[index].date}
                    opacity={active === null || active === index ? 1 : 0.4}
                    rx={Math.min(2, bar.width / 3)}
                    stroke={missed ? barColor(nights[index]) : undefined}
                    strokeWidth={missed ? stroke : 0}
                    width={bar.width - inset * 2}
                    x={bar.x + inset}
                    y={bar.y + inset}
                  />
                );
              })
              : null}
            {/* His price line in the theme's text-grade gold (walk 5 T3-08):
                the same gold on every dark theme, and in Light the darker ink
                that reads on cream (the fill gold there was 1.95:1). */}
            <Path
              d={metric === 'dividends' ? model.priceStepPath : model.priceLinePath}
              fill="none"
              stroke={colors.goldInk}
              strokeDasharray={metric === 'dividends' ? '5 4' : undefined}
              strokeLinejoin="round"
              strokeWidth={metric === 'dividends' ? 2 : 2.5}
            />
            {/* Price view: your locked price, dashed, against his market line. */}
            {metric === 'price' && model.yourPricePath ? (
              <Path d={model.yourPricePath} fill="none" stroke={colors.text} strokeDasharray="5 4" strokeWidth={1.5} />
            ) : null}
            {/* Today's price after his last game: a dotted step to a hollow
                point, named "Now $424.8K", the figure the header quotes
                (walk 16 T2-N3). */}
            {model.nowPoint && lastAnchor ? (
              <Line
                stroke={colors.goldInk}
                strokeDasharray="2 3"
                strokeWidth={1.5}
                x1={lastAnchor.x}
                x2={model.nowPoint.x}
                y1={lastAnchor.y}
                y2={model.nowPoint.y}
              />
            ) : null}
            {metric === 'price' && anchor ? (
              <Circle cx={anchor.x} cy={anchor.y} fill={colors.goldInk} r={active === null ? 3.5 : 5} />
            ) : null}
            {model.nowPoint ? (
              <Circle cx={model.nowPoint.x} cy={model.nowPoint.y} fill={colors.background} r={4} stroke={colors.goldInk} strokeWidth={2} />
            ) : null}
            {nowWords ? (
              <SvgText
                fill={colors.goldInk}
                fontFamily={fonts.display}
                fontSize={11}
                fontWeight="700"
                textAnchor="end"
                x={nowWords.x}
                y={nowWords.y}
              >
                {nowWords.text}
              </SvgText>
            ) : null}
            {/* HIGH and LOW never sit on the price line or run into a bar
                (walk 14 T2-08, walk 15 T2-13): in a narrow gap the word
                stacks over the figure; with no room under the line a label
                rises over it with a thin line down to its bar. */}
            {labels.map((label) => (
              <G key={label.kind}>
                {label.leader ? (
                  <Line stroke={colors.faint} strokeWidth={1} x1={label.leader.x} x2={label.leader.x} y1={label.leader.y1} y2={label.leader.y2} />
                ) : null}
                {label.chip ? (
                  <Rect
                    fill={colors.background}
                    height={label.chip.height}
                    rx={3}
                    width={label.chip.width}
                    x={label.chip.x}
                    y={label.chip.y}
                  />
                ) : null}
                {label.lines.map((line, row) => (
                  <SvgText
                    fill={colors.muted}
                    fontFamily={fonts.display}
                    fontSize={11}
                    fontWeight="700"
                    key={line}
                    textAnchor={label.anchor}
                    x={label.x}
                    y={label.y - (label.lines.length - 1 - row) * EXTREME_LABEL_LINE}
                  >
                    {line}
                  </SvgText>
                ))}
              </G>
            ))}
          </Svg>
        ) : null}
        {/* Dividends: the $0 line named beside it (walk 7 T1-08). */}
        {metric === 'dividends' && gutter && zeroY !== null ? (
          <Text
            maxFontSizeMultiplier={1.3}
            style={[styles.mark, styles.zeroMark, { top: Math.min(Math.max(zeroY - MARK_HALF, 0), plotHeight - MARK_HALF * 2) }]}
          >
            $0
          </Text>
        ) : null}
        {/* The scale: his high and low price beside their guide lines. */}
        {marks.map((mark) => (
          <Text
            key={mark.kind}
            maxFontSizeMultiplier={1.3}
            style={[styles.mark, { top: mark.labelY - MARK_HALF }]}
          >
            {moneyFine(mark.value)}
          </Text>
        ))}
      </View>
      <View accessibilityElementsHidden aria-hidden importantForAccessibility="no-hide-descendants" style={styles.axis}>
        {/* Each date sits under its game; the end ones hang from their edge. */}
        {dates.map(({ index, left, align }) => (
          <Text
            key={index}
            maxFontSizeMultiplier={1.3}
            style={[
              styles.axisText,
              align === 'right'
                ? { right: 0, textAlign: 'right' }
                : align === 'left'
                  ? { left: 0, textAlign: 'left' }
                  : { left, width: DATE_BOX, textAlign: 'center' },
            ]}
          >
            {humanDate(nights[index].date)}
          </Text>
        ))}
      </View>
      <View accessibilityElementsHidden aria-hidden importantForAccessibility="no-hide-descendants" style={styles.legend}>
        {metric === 'dividends' ? (
          <>
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: colors.green }]} />
              <Text style={styles.legendText}>{words.legendGood}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.swatch, hollowMisses ? styles.swatchHollow : styles.swatchMiss]} />
              <Text style={styles.legendText}>{words.legendBad}</Text>
            </View>
          </>
        ) : null}
        <View style={styles.legendItem}>
          <View style={[styles.dash, metric === 'price' && styles.dashSolid]} />
          <Text style={styles.legendText}>{legend.line}</Text>
        </View>
        {metric === 'price' && legend.yours && model.yourPricePath ? (
          <View style={styles.legendItem}>
            <View style={[styles.dash, styles.dashYours]} />
            <Text style={styles.legendText}>{legend.yours}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: {
    minHeight: 40,
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  // Sentence case: in capitals the parts read as separate headings.
  readoutDate: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
  },
  readoutValue: {
    marginTop: 2,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  readoutIdle: {
    color: colors.muted,
  },
  plot: {
    width: '100%',
    cursor: 'pointer',
    borderRadius: radius.sm,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    paddingHorizontal: space.lg,
  },
  emptyText: {
    color: colors.muted,
    fontSize: type.body,
    textAlign: 'center',
  },
  axis: {
    position: 'relative',
    height: 16,
    marginTop: 2,
  },
  axisText: {
    position: 'absolute',
    top: 0,
    lineHeight: 16,
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  mark: {
    position: 'absolute',
    left: 0,
    width: GUTTER - 6,
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
    lineHeight: MARK_HALF * 2,
  },
  // The $0 mark reads at text grade: it is what tells a game below zero apart.
  zeroMark: {
    color: colors.muted,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.lg,
    rowGap: space.xs,
    marginTop: space.sm,
  },
  // An item never runs past the chart's edge (400% zoom): its words wrap.
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
  },
  swatchHollow: {
    borderWidth: MISS_STROKE,
    borderColor: colors.red,
    backgroundColor: 'transparent',
  },
  // Bars too narrow for an outline draw a miss solid: so does its swatch.
  swatchMiss: {
    backgroundColor: colors.red,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: radius.xs,
  },
  dash: {
    width: 16,
    height: 0,
    borderTopWidth: 2,
    borderTopColor: colors.goldInk,
    borderStyle: 'dashed',
  },
  dashYours: {
    borderTopColor: colors.text,
  },
  dashSolid: {
    borderStyle: 'solid',
  },
  legendText: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: type.label,
  },
});
