import { StyleSheet, Text, View } from 'react-native';

import type { PerGamePositionSide } from '../../api/contracts';
import { exactMoney, exactSignedMoney, ROSTER_EXPLAINER, SHORT_EXPLAINER } from '../../copy/terms';
import { colors, fonts, space, type, weight } from '../../theme';
import { NetMoney } from './NetMoney';

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

/**
 * The full settlement of one game, opened from its row: what came in, what
 * went out, and the net, as exact dollars in a right-aligned column that sits
 * under the row's own net. Labels come from `settlementEquation` (Dividend −
 * Price paid for a roster spot; Price credited − Dividend paid for a short).
 */
export function SettlementBreakdown({
  firstLabel,
  firstAmount,
  secondLabel,
  secondAmount,
  netPnl,
  side,
  wide,
}: {
  firstLabel: string;
  firstAmount: number;
  secondLabel: string;
  secondAmount: number;
  netPnl: number;
  side: PerGamePositionSide;
  /** Desktop: a receipt-width column aligned to the right, under the numbers. */
  wide: boolean;
}) {
  return (
    <View style={[styles.box, wide && styles.boxWide]}>
      <View
        accessibilityLabel={`${firstLabel} ${exactMoney(firstAmount)} minus ${secondLabel} ${exactMoney(secondAmount)} equals ${exactSignedMoney(netPnl)}`}
        accessible
      >
        <Line label={firstLabel} value={exactMoney(firstAmount)} />
        <Line label={`− ${secondLabel}`} value={exactMoney(secondAmount)} />
        <View style={[styles.line, styles.total]}>
          <Text style={[styles.lineLabel, styles.totalLabel]}>= Net</Text>
          <NetMoney compact={false} size="body" value={netPnl} />
        </View>
      </View>
      <Text style={styles.explainer}>{side === 'short' ? SHORT_EXPLAINER : ROSTER_EXPLAINER}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  boxWide: {
    alignSelf: 'flex-end',
    width: '100%',
    maxWidth: 380,
  },
  line: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: space.md,
  },
  lineLabel: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: type.body,
    lineHeight: 20,
  },
  lineValue: {
    marginLeft: 'auto',
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
    lineHeight: 20,
  },
  total: {
    marginTop: 2,
    paddingTop: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  totalLabel: {
    color: colors.text,
    fontWeight: weight.bold,
  },
  explainer: {
    marginTop: space.sm,
    color: colors.faint,
    fontSize: type.caption,
    lineHeight: 17,
  },
});
