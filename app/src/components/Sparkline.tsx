import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { cumulativeValues, type TrendPoint } from '../data/trendPresentation';
import { lineChartCoordinates, smoothLinePath } from '../data/marketPresentation';
import { formatCompactSignedMoney } from '../format';
import { colors } from '../theme';

/**
 * The market row's cumulative-dividend trace. The dashed rule marks the zero
 * line (a leading 0 is prepended so the trace always starts on it), and the
 * stroke takes the season's verdict: green when payouts net positive, red when
 * holders are underwater.
 */
export function Sparkline({ points }: { points: TrendPoint[] }) {
  const dividends = points.map((point) => point.dividend_per_holder);
  const values = [0, ...cumulativeValues(dividends)];
  const cumulativeDividend = values.at(-1) ?? 0;
  const color = cumulativeDividend >= 0 ? colors.green : colors.red;
  const width = 52;
  const height = 26;
  const coordinates = lineChartCoordinates(values, width, height);
  const linePath = smoothLinePath(coordinates);
  const zeroY = coordinates[0]?.y ?? height / 2;

  return (
    <View
      accessible
      accessibilityLabel={`Last ${points.length} settled games, cumulative dividends ${formatCompactSignedMoney(cumulativeDividend)}`}
      style={styles.sparkline}
    >
      <Svg height={height} width={width}>
        <Path
          d={`M 2 ${zeroY} L ${width - 2} ${zeroY}`}
          fill="none"
          stroke={colors.border}
          strokeDasharray="2 3"
          strokeWidth={1}
        />
        <Path d={linePath} fill="none" stroke={color} strokeLinecap="round" strokeWidth={2} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  sparkline: { width: 52, flexShrink: 0 },
});
