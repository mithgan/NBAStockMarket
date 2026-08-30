import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { formatCompactMoney } from '../format';
import { usePerGame } from '../state/PerGameContext';
import { colors, fonts, labelStyle, space, type, weight } from '../theme';

function dateLabel(value: string | null): string {
  if (!value) return 'Waiting';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

export function PerGameStatusStrip() {
  const { fontScale, width } = useWindowDimensions();
  const {
    bootstrap,
    isGameplayReady,
    isRefreshing,
    pendingActions,
    reconciliationRequired,
    refreshData,
  } = usePerGame();
  if (!bootstrap) return null;
  const pendingBeyondReconciliation = [...pendingActions]
    .some((key) => key !== 'account-mutation');
  const disabled = (
    !isGameplayReady
    || isRefreshing
    || (reconciliationRequired ? pendingBeyondReconciliation : pendingActions.size > 0)
  );
  const reflow = width < 540 || fontScale > 1.2;
  const rules = bootstrap.ruleset;
  const dividendBasis = rules.dividendBasis === 'raw_net_points'
    ? 'RAW NET POINTS'
    : 'SURPRISE VS PROJECTION';
  const rosterLockDate = rules.rosterLockGameDate
    ? `GAME ${dateLabel(rules.rosterLockGameDate).toUpperCase()}`
    : 'GAME IN PROGRESS';

  return (
    <View style={styles.container}>
      <View style={[styles.summary, reflow && styles.summaryReflow]}>
        <View style={[styles.item, reflow && styles.itemReflow]}>
          <Text style={styles.label}>{reflow ? 'LAST' : 'LAST SETTLED'}</Text>
          <Text style={styles.value}>{dateLabel(bootstrap.game.lastSettledDate)}</Text>
        </View>
        <View style={[styles.divider, reflow && styles.dividerReflow]} />
        <View style={[styles.item, reflow && styles.itemReflow]}>
          <Text style={styles.label}>NEXT</Text>
          <Text style={styles.value}>{dateLabel(bootstrap.game.nextGameDate)}</Text>
        </View>
        <View style={[styles.divider, reflow && styles.dividerReflow]} />
        <View style={[styles.item, reflow && styles.itemReflow]}>
          <Text style={styles.label}>ROSTER</Text>
          <Text style={styles.value}>
            {bootstrap.account.longSlots.used} / {bootstrap.account.longSlots.limit}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={reconciliationRequired
            ? 'Reconcile account after uncertain roster action'
            : 'Refresh per-game market data'}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => {
            refreshData();
          }}
          style={({ pressed }) => [
            styles.refresh,
            reflow && styles.refreshReflow,
            reconciliationRequired && styles.reconcile,
            disabled && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.refreshText}>
            {isRefreshing ? 'WAIT' : reconciliationRequired ? 'RECONCILE' : 'REFRESH'}
          </Text>
        </Pressable>
      </View>
      {rules.rosterMutationsLocked ? (
        <View
          accessible
          accessibilityLabel={rules.rosterLockGameDate
            ? `Roster changes are locked for the ${dateLabel(rules.rosterLockGameDate)} game.`
            : 'Roster changes are locked while the current game is in progress.'}
          style={[styles.lockNotice, reflow && styles.lockNoticeReflow]}
        >
          <Text style={styles.lockTitle}>ROSTER LOCKED</Text>
          <Text style={styles.lockDate}>{rosterLockDate}</Text>
        </View>
      ) : null}
      <View style={styles.rules}>
        <View style={[styles.ruleItem, reflow && styles.ruleItemReflow]}>
          <Text style={styles.ruleLabel}>DIVIDEND</Text>
          <Text style={styles.ruleValue}>
            {dividendBasis} / {formatCompactMoney(rules.dividendDollarsPerNetPoint)} PER POINT
          </Text>
        </View>
        <View style={[styles.ruleItem, reflow && styles.ruleItemReflow]}>
          <Text style={styles.ruleLabel}>OPEN FEE</Text>
          <Text style={styles.ruleValue}>{formatCompactMoney(rules.transactionFeeDollars)}</Text>
        </View>
        <View style={[styles.ruleItem, reflow && styles.ruleItemReflow]}>
          <Text style={styles.ruleLabel}>DROP FEE</Text>
          <Text style={styles.ruleValue}>{formatCompactMoney(rules.transactionFeeDollars)}</Text>
        </View>
        <View style={[styles.ruleItem, reflow && styles.ruleItemReflow]}>
          <Text style={styles.ruleLabel}>SHORT TERM</Text>
          <Text style={styles.ruleValue}>
            {rules.shortTermDays === null ? 'NO EXPIRY' : `${rules.shortTermDays} DAYS`}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 70,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
    backgroundColor: colors.chromeSoft,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  summaryReflow: {
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: space.sm,
  },
  item: {
    minWidth: 0,
    flex: 1,
    flexShrink: 1,
  },
  itemReflow: {
    minWidth: 80,
    flexBasis: '27%',
  },
  divider: {
    width: 1,
    height: 34,
    marginHorizontal: space.md,
    backgroundColor: colors.borderStrong,
  },
  dividerReflow: {
    display: 'none',
  },
  label: {
    ...labelStyle,
    marginBottom: 3,
  },
  value: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  refresh: {
    minHeight: 44,
    minWidth: 82,
    marginLeft: 'auto',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  refreshReflow: {
    minWidth: 0,
    marginLeft: 0,
    flexBasis: '100%',
  },
  reconcile: {
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
  },
  refreshText: {
    color: colors.gold,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
  },
  lockNotice: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gold,
    backgroundColor: colors.goldSoft,
  },
  lockNoticeReflow: {
    flexWrap: 'wrap',
  },
  lockTitle: {
    color: colors.gold,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
  },
  lockDate: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  rules: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  ruleItem: {
    minWidth: 140,
    flex: 1,
    flexBasis: '22%',
  },
  ruleItemReflow: {
    minWidth: 120,
    flexBasis: '45%',
  },
  ruleLabel: {
    ...labelStyle,
    marginBottom: 3,
  },
  ruleValue: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    lineHeight: 17,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.72,
  },
});
