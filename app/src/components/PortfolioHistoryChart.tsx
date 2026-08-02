import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { chartCoordinates, portfolioPeriodChange } from '../data/chartGeometry';
import { formatCompactSignedMoney, formatMoney, formatSignedMoney } from '../format';
import { STARTING_CASH, type PortfolioPoint } from '../state/game';
import { colors, radius, space, type } from '../theme';

export function PortfolioHistoryChart({ points }: { points: PortfolioPoint[] }) {
  const [width, setWidth] = useState(0);
  const visibleStartIndex = Math.max(0, points.length - 30);
  const visible = points.slice(visibleStartIndex);
  const baselineTotalValue = visibleStartIndex > 0
    ? points[visibleStartIndex - 1].totalValue
    : STARTING_CASH;
  const values = visible.map((point) => point.totalValue);
  const height = 124;
  const coordinates = chartCoordinates(values, width, height);
  const path = coordinates
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const lastCoordinate = coordinates.at(-1) ?? null;
  const change = portfolioPeriodChange(visible, baselineTotalValue);
  const color = change >= 0 ? colors.green : colors.red;

  if (visible.length === 0) {
    return (
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={styles.empty}
      >
        <Text style={styles.emptyTitle}>Your chart starts after the first replay day.</Text>
        <Text style={styles.emptyText}>Buy a player, then settle the next date to see your portfolio move.</Text>
      </View>
    );
  }

  return (
    <View
      accessible
      accessibilityLabel={`Portfolio history, ${visible.length} dates, ending at ${formatMoney(visible.at(-1)!.totalValue)}, change ${formatSignedMoney(change)}`}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={styles.chart}
    >
      {width > 0 ? (
        <Svg height={height} width={width}>
          <Path d={path} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} />
          {lastCoordinate ? (
            <Circle
              cx={lastCoordinate.x}
              cy={lastCoordinate.y}
              fill={colors.surface}
              r={5}
              stroke={color}
              strokeWidth={3}
            />
          ) : null}
        </Svg>
      ) : null}
      <View style={styles.captionRow}>
        <Text style={styles.caption}>{visible[0].date}</Text>
        <Text style={[styles.change, { color }]}>{formatCompactSignedMoney(change)}</Text>
        <Text style={styles.caption}>{visible.at(-1)!.date}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { minHeight: 152 },
  captionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  caption: { color: colors.muted, fontSize: type.label },
  change: { fontSize: type.label, fontWeight: '800', fontVariant: ['tabular-nums'] },
  empty: { minHeight: 124, justifyContent: 'center', padding: space.lg, backgroundColor: colors.background, borderRadius: radius.md },
  emptyTitle: { color: colors.text, fontSize: type.body, fontWeight: '800' },
  emptyText: { color: colors.muted, fontSize: type.label, lineHeight: 17, marginTop: 5 },
});
