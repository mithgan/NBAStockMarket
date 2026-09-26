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
  nightIndexAt,
  nightReadout,
  profileChartModel,
  readoutCaption,
  sideWords,
  steppedIndex,
  type ChartInsets,
  type ProfileMetric,
  type ProfileNight,
} from '../../data/profileView';
import { colors, fonts, radius, space, type, weight } from '../../theme';

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
}: {
  nights: ProfileNight[];
  metric: ProfileMetric;
  side: PerGamePositionSide;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  // A tap, click or key pins a game; a moving mouse previews one. Showing:
  // preview, then pin, then his latest game.
  const [pinned, setPinned] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const scaled = metric === 'price' && width >= SCALE_MIN_WIDTH;
  const insets = metric === 'price' ? (scaled ? PRICE_INSETS : PRICE_INSETS_BARE) : INSETS;
  const model = useMemo(
    () => profileChartModel(nights, metric, width, height, insets),
    [height, insets, metric, nights, width],
  );
  const words = sideWords(side);
  const legend = chartLegend(nights, metric, side);

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
    const down = (event: PointerEvent) => {
      dragged = false;
      if (event.pointerType === 'mouse') toggle(at(event));
    };
    const up = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && !dragged) toggle(at(event));
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
  const labelAnchor = (x: number) => (x < 60 ? 'start' : x > width - 60 ? 'end' : 'middle');
  // The dividends view names its tallest and lowest bar in the plot; the
  // price view has its scale in the gutter instead.
  const labels = ([['HIGH', model.high], ['LOW', model.low]] as const).filter(
    (entry): entry is readonly ['HIGH' | 'LOW', number] => entry[1] !== null && active === null && metric === 'dividends',
  );
  const marks = scaled ? model.priceMarks : [];
  const dates = chartDateLabels(model.anchors.map((point) => point.x), width, DATE_BOX);
  const zeroY = model.zeroY;

  return (
    <View>
      <View style={styles.readout}>
        <Text maxFontSizeMultiplier={1.4} style={styles.readoutDate}>{caption}</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.readoutValue}>{reading}</Text>
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
        style={[styles.plot, { height }]}
        tabIndex={0}
        {...responder.panHandlers}
      >
        {width > 0 ? (
          <Svg height={height} width={width}>
            {metric === 'dividends' && zeroY !== null ? (
              <Line stroke={colors.borderStrong} strokeWidth={1} x1={0} x2={width} y1={zeroY} y2={zeroY} />
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
                y2={height - 4}
              />
            ) : null}
            {metric === 'dividends'
              ? model.bars.map((bar, index) => {
                // A miss is a hollow bar, a beat a solid one: the shape says it
                // too, not only red against green (walk-1 T3-19). The outline
                // sits inside the bar so both keep the same size.
                const missed = nights[index].net < 0 && bar.width >= 4 && bar.height >= 4;
                const inset = missed ? MISS_STROKE / 2 : 0;
                return (
                  <Rect
                    fill={missed ? 'none' : barColor(nights[index])}
                    height={bar.height - inset * 2}
                    key={nights[index].date}
                    opacity={active === null || active === index ? 1 : 0.4}
                    rx={Math.min(2, bar.width / 3)}
                    stroke={missed ? barColor(nights[index]) : undefined}
                    strokeWidth={missed ? MISS_STROKE : 0}
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
            {metric === 'price' && anchor ? (
              <Circle cx={anchor.x} cy={anchor.y} fill={colors.goldInk} r={active === null ? 3.5 : 5} />
            ) : null}
            {labels.map(([label, index]) => {
              const point = model.anchors[index];
              const value = metric === 'price' ? nights[index].market ?? nights[index].price : nights[index].dividend;
              const base = metric === 'dividends' && zeroY !== null
                ? (label === 'HIGH' ? Math.min(point.y, zeroY) : Math.max(point.y, zeroY))
                : point.y;
              const y = label === 'HIGH' ? base - 7 : base + 15;
              return (
                <G key={label}>
                  <SvgText
                    fill={colors.muted}
                    fontFamily={fonts.display}
                    fontSize={11}
                    fontWeight="700"
                    textAnchor={labelAnchor(point.x)}
                    x={point.x}
                    y={Math.max(12, Math.min(height - 3, y))}
                  >
                    {`${label} ${money(value)}`}
                  </SvgText>
                </G>
              );
            })}
          </Svg>
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
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.axis}>
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
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.legend}>
        {metric === 'dividends' ? (
          <>
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: colors.green }]} />
              <Text style={styles.legendText}>{words.legendGood}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.swatch, styles.swatchHollow]} />
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
