/**
 * Game-by-game chart for the player profile.
 *
 * Dividends view: one bar per game for what he paid, rising from $0, with his
 * price as a dashed gold line. A bar that clears the line is a game he beat
 * his price; bars are green when he did and red when he did not.
 * Price view: his price a game, game by game.
 *
 * Reading a game: tap or click a bar and the read-out above the chart names
 * that game's date and money. A mouse also reads the game under the pointer
 * while it moves. With nothing picked the read-out shows his latest game.
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

import { humanDate, money } from '../../copy/terms';
import {
  chartSummary,
  nightIndexAt,
  nightReadout,
  profileChartModel,
  type ChartInsets,
  type ProfileMetric,
  type ProfileNight,
} from '../../data/profileView';
import { colors, fonts, radius, space, type, weight } from '../../theme';

const INSETS: ChartInsets = { top: 22, right: 6, bottom: 20, left: 6 };

function barColor(night: ProfileNight): string {
  if (night.net > 0) return colors.green;
  if (night.net < 0) return colors.red;
  return colors.muted;
}

export function ProfileChart({
  nights,
  metric,
  height = 180,
}: {
  nights: ProfileNight[];
  metric: ProfileMetric;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  // A tap pins a game; a moving mouse previews one. Showing: preview, then pin, then his latest game.
  const [pinned, setPinned] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const model = useMemo(
    () => profileChartModel(nights, metric, width, height, INSETS),
    [height, metric, nights, width],
  );

  // A new range or metric starts clean, on his latest game. Keyed on what the
  // nights are, not the array's identity, so a re-render keeps the pick.
  const signature = `${metric}|${nights.length}|${nights[0]?.date ?? ''}|${nights[nights.length - 1]?.date ?? ''}`;
  useEffect(() => {
    setPinned(null);
    setPreview(null);
  }, [signature]);

  const indexAt = useRef<(x: number) => number | null>(() => null);
  indexAt.current = (x: number) => nightIndexAt(x, model.slot, INSETS.left, nights.length);

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
    const at = (event: PointerEvent) => indexAt.current(event.clientX - node.getBoundingClientRect().left);
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
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerleave', leave);
    cleanup.current = () => {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', leave);
    };
  }, []);
  useEffect(() => () => cleanup.current?.(), []);

  // Native: a touch or drag pins the game under the finger.
  const responder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => Platform.OS !== 'web',
      onMoveShouldSetPanResponder: (_event, gesture) => Platform.OS !== 'web' && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderGrant: (event) => setPinned(indexAt.current(event.nativeEvent.locationX)),
      onPanResponderMove: (event) => setPinned(indexAt.current(event.nativeEvent.locationX)),
    }),
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
  const labelAnchor = (x: number) => (x < 60 ? 'start' : x > width - 60 ? 'end' : 'middle');
  const labels = ([['HIGH', model.high], ['LOW', model.low]] as const).filter(
    (entry): entry is readonly ['HIGH' | 'LOW', number] => entry[1] !== null && active === null,
  );
  const zeroY = model.zeroY;

  return (
    <View>
      <View accessibilityLiveRegion="polite" style={styles.readout}>
        <Text maxFontSizeMultiplier={1.4} style={styles.readoutDate}>
          {active === null ? `Latest game · ${humanDate(shown.date)}` : humanDate(shown.date)}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.readoutValue}>
          {nightReadout(shown, metric)}
        </Text>
      </View>
      <View
        accessibilityLabel={chartSummary(nights, metric)}
        accessibilityRole="image"
        accessible
        onLayout={onLayout}
        ref={attach}
        style={[styles.plot, { height }]}
        {...responder.panHandlers}
      >
        {width > 0 ? (
          <Svg height={height} width={width}>
            {metric === 'dividends' && zeroY !== null ? (
              <Line stroke={colors.borderStrong} strokeWidth={1} x1={0} x2={width} y1={zeroY} y2={zeroY} />
            ) : null}
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
              ? model.bars.map((bar, index) => (
                <Rect
                  fill={barColor(nights[index])}
                  height={bar.height}
                  key={nights[index].date}
                  opacity={active === null || active === index ? 1 : 0.4}
                  rx={Math.min(2, bar.width / 3)}
                  width={bar.width}
                  x={bar.x}
                  y={bar.y}
                />
              ))
              : null}
            <Path
              d={metric === 'dividends' ? model.priceStepPath : model.priceLinePath}
              fill="none"
              stroke={colors.gold}
              strokeDasharray={metric === 'dividends' ? '5 4' : undefined}
              strokeLinejoin="round"
              strokeWidth={metric === 'dividends' ? 1.5 : 2.5}
            />
            {metric === 'price' && anchor ? (
              <Circle cx={anchor.x} cy={anchor.y} fill={colors.gold} r={active === null ? 3.5 : 5} />
            ) : null}
            {labels.map(([label, index]) => {
              const point = model.anchors[index];
              const value = metric === 'price' ? nights[index].price : nights[index].dividend;
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
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.axis}>
        <Text style={styles.axisText}>{humanDate(nights[0].date)}</Text>
        {nights.length > 1 ? <Text style={styles.axisText}>{humanDate(nights[nights.length - 1].date)}</Text> : null}
      </View>
      <View style={styles.legend}>
        {metric === 'dividends' ? (
          <>
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: colors.green }]} />
              <Text style={styles.legendText}>Beat his price</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: colors.red }]} />
              <Text style={styles.legendText}>Fell short</Text>
            </View>
          </>
        ) : null}
        <View style={styles.legendItem}>
          <View style={[styles.dash, metric === 'price' && styles.dashSolid]} />
          <Text style={styles.legendText}>His price a game</Text>
        </View>
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
  readoutDate: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: INSETS.left,
    marginTop: 2,
  },
  axisText: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.lg,
    rowGap: space.xs,
    marginTop: space.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
    borderTopColor: colors.gold,
    borderStyle: 'dashed',
  },
  dashSolid: {
    borderStyle: 'solid',
  },
  legendText: {
    color: colors.muted,
    fontSize: type.label,
  },
});
