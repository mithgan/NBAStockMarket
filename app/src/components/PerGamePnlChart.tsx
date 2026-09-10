import { useMemo, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import type { PerGameLedgerEntry } from '../api/contracts';
import { formatCompactSignedMoney, formatSignedMoney } from '../format';
import { buildPnlSeries, pnlChartDomain } from '../state/perGameState';
import { colors, fonts, labelStyle, space, type, weight } from '../theme';

const CHART_HEIGHT = 132;
const CHART_INSET = 10;

export function PerGamePnlChart({ entries }: { entries: readonly PerGameLedgerEntry[] }) {
  const [width, setWidth] = useState(0);
  const points = useMemo(() => buildPnlSeries(entries), [entries]);
  const domain = useMemo(() => pnlChartDomain(points), [points]);
  const coordinates = useMemo(() => points.map((point, index) => ({
    x: CHART_INSET + (index / Math.max(points.length - 1, 1)) * Math.max(width - CHART_INSET * 2, 0),
    y: CHART_INSET + ((domain.maximum - point.cumulativePnl)
      / (domain.maximum - domain.minimum)) * (CHART_HEIGHT - CHART_INSET * 2),
  })), [domain.maximum, domain.minimum, points, width]);
  const path = coordinates.map((point, index) => (
    `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
  )).join(' ');
  const zeroY = CHART_INSET + domain.zeroRatio * (CHART_HEIGHT - CHART_INSET * 2);
  const current = points.at(-1)?.cumulativePnl ?? 0;
  const color = current >= 0 ? colors.green : colors.red;
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  return (
    <View
      accessible
      accessibilityLabel={`Cumulative profit and loss chart from zero to ${formatSignedMoney(current)}`}
      style={styles.container}
    >
      <View style={styles.heading}>
        <Text style={styles.label}>CUMULATIVE P&amp;L</Text>
        <Text style={[styles.value, current >= 0 ? styles.positive : styles.negative]}>
          {formatCompactSignedMoney(current)}
        </Text>
      </View>
      <View onLayout={onLayout}>
        {entries.length === 0 ? (
          <View style={styles.emptyChart}>
            <View style={styles.zeroLine} />
            <Text style={styles.emptyText}>Your chart starts at $0. Fees and settled games will appear here.</Text>
          </View>
        ) : width > 0 ? (
          <Svg height={CHART_HEIGHT} width={width}>
            <Line
              stroke={colors.borderStrong}
              strokeDasharray="4 4"
              strokeWidth={1}
              x1={CHART_INSET}
              x2={width - CHART_INSET}
              y1={zeroY}
              y2={zeroY}
            />
            <Path d={path} fill="none" stroke={color} strokeLinecap="round" strokeWidth={3} />
          </Svg>
        ) : (
          <View style={styles.emptyChart} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 190,
    padding: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
    backgroundColor: colors.background,
  },
  heading: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
  },
  label: {
    ...labelStyle,
  },
  value: {
    fontFamily: fonts.display,
    fontSize: type.title,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  positive: {
    color: colors.green,
  },
  negative: {
    color: colors.red,
  },
  emptyChart: {
    height: CHART_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zeroLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: CHART_HEIGHT / 2,
    height: 1,
    backgroundColor: colors.borderStrong,
  },
  emptyText: {
    maxWidth: 320,
    paddingHorizontal: space.md,
    color: colors.muted,
    backgroundColor: colors.background,
    fontSize: type.body,
    textAlign: 'center',
  },
});
