import { StyleSheet, Text, View } from 'react-native';

import type { PerGamePositionSide } from '../../api/contracts';
import { exactMoney, exactSignedMoney, ROSTER_EXPLAINER, SHORT_EXPLAINER } from '../../copy/terms';
import type { EffectLine } from '../../data/resultsView';
import { colors, fonts, space, type, weight } from '../../theme';
import { NetMoney } from './NetMoney';

/** "+$112,500", "-$137,500", and "$0" for nothing. */
function effect(amount: number): string {
  return Math.round(amount) === 0 ? exactMoney(0) : exactSignedMoney(amount);
}

/**
 * The full settlement of one game, opened from its row. Each line says what it
 * was and what it did to YOUR score, signed, so the lines simply add up to the
 * net: no minus sign in front of a negative number, and "paid" never names a
 * dividend (it ran backwards for shorts). The wording is built by
 * `settlementLines` (data/resultsView.ts).
 */
export function SettlementBreakdown({
  basis,
  lines,
  net,
  side,
  wide,
}: {
  /** Where his dividend came from: "7.4 net points × $40,000 = $296,000". */
  basis?: string | null;
  lines: readonly EffectLine[];
  net: number;
  side: PerGamePositionSide;
  /** Desktop: a receipt-width column aligned to the right, under the numbers. */
  wide: boolean;
}) {
  // Whose math this is, in the app's own words (walk 12 T1-01: "Your roster
  // spot" was a third term for holding him): "On your roster" or "Your short".
  const heading = side === 'short' ? 'Your short' : 'On your roster';
  const spoken = [
    heading,
    ...(basis ? [`His dividend: ${basis}`] : []),
    ...lines.map((line) => `${line.label}: ${effect(line.amount)}`),
    `Profit: ${effect(net)}`,
  ].join('. ');
  return (
    <View style={[styles.box, wide && styles.boxWide]}>
      <View accessibilityLabel={`${spoken}.`} accessible>
        <Text style={styles.heading}>{heading}</Text>
        {basis ? (
          <Text style={styles.basis}>His dividend: {basis}</Text>
        ) : null}
        {lines.map((line) => (
          <View key={line.label} style={styles.line}>
            <Text style={styles.lineLabel}>{line.label}</Text>
            <Text style={styles.lineValue}>{effect(line.amount)}</Text>
          </View>
        ))}
        <View style={[styles.line, styles.total]}>
          <Text style={[styles.lineLabel, styles.totalLabel]}>Profit</Text>
          <NetMoney compact={false} size="body" style={styles.lineMoney} value={net} />
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
    maxWidth: 440,
  },
  heading: {
    marginBottom: 2,
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  basis: {
    marginBottom: 2,
    color: colors.muted,
    fontSize: type.caption,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
  },
  line: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    columnGap: space.md,
    paddingVertical: 1,
  },
  lineLabel: {
    flex: 1,
    minWidth: 0,
    color: colors.muted,
    fontSize: type.body,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
  },
  lineValue: {
    flexShrink: 0,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
    lineHeight: 20,
    textAlign: 'right',
  },
  lineMoney: {
    flexShrink: 0,
    lineHeight: 20,
    textAlign: 'right',
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
