import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { advanceMockNight } from '../api/mockPerGameClient';
import { formatCompactMoney, formatCompactSignedMoney, formatSignedMoney } from '../format';
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

function addDays(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * The season strip is part of the frame, not a card: one quiet line of clock
 * facts, the standing earnings line (a recurring number deserves a fixed
 * address), and the ruleset facts folded behind a disclosure — always-on
 * instructions are noise after the first read.
 */
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
  const [rulesOpen, setRulesOpen] = useState(false);
  const lastSettled = bootstrap?.game.lastSettledDate ?? null;
  const ledgerItems = bootstrap?.ledger.items;
  const earnings = useMemo(() => {
    if (!ledgerItems || !lastSettled) return null;
    const weekStart = addDays(lastSettled, -6);
    let night = 0;
    let week = 0;
    for (const entry of ledgerItems) {
      if (!entry.gameDate) continue;
      if (entry.gameDate === lastSettled) night += entry.amountDollars;
      if (entry.gameDate >= weekStart && entry.gameDate <= lastSettled) {
        week += entry.amountDollars;
      }
    }
    return { night, week };
  }, [lastSettled, ledgerItems]);
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

  return (
    <View style={styles.container}>
      <View style={[styles.summary, reflow && styles.summaryReflow]}>
        <View style={[styles.item, reflow && styles.itemReflow]}>
          <Text style={styles.label}>{reflow ? 'LAST' : 'LAST SETTLED'}</Text>
          <Text style={styles.value}>{dateLabel(bootstrap.game.lastSettledDate)}</Text>
        </View>
        <View style={[styles.item, reflow && styles.itemReflow]}>
          <Text style={styles.label}>NEXT</Text>
          <Text style={styles.value}>{dateLabel(bootstrap.game.nextGameDate)}</Text>
        </View>
        <View style={[styles.item, reflow && styles.itemReflow]}>
          <Text style={styles.label}>ROSTER</Text>
          <Text style={styles.value}>
            {bootstrap.account.longSlots.used} / {bootstrap.account.longSlots.limit}
          </Text>
        </View>
        {bootstrap.capabilities.canAdvanceReplay ? (
          <View style={[styles.item, reflow && styles.itemReflow]}>
            <Text style={styles.label}>MODE</Text>
            <Text style={[styles.value, styles.sandbox]}>SANDBOX</Text>
          </View>
        ) : null}
        {rules.rosterMutationsLocked ? (
          <View
            accessible
            accessibilityLabel={rules.rosterLockGameDate
              ? `Roster changes are locked for the ${dateLabel(rules.rosterLockGameDate)} game.`
              : 'Roster changes are locked while the current game is in progress.'}
            style={styles.lockChip}
          >
            <Text style={styles.lockTitle}>ROSTER LOCKED</Text>
            <Text style={styles.lockDate}>
              {rules.rosterLockGameDate
                ? dateLabel(rules.rosterLockGameDate).toUpperCase()
                : 'IN PLAY'}
            </Text>
          </View>
        ) : null}
        {/* The two controls travel as one unit so a narrow wrap never strands
            a lone button on its own line. */}
        <View style={styles.actions}>
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
              reconciliationRequired && styles.reconcile,
              disabled && styles.disabledControl,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.refreshText}>
              {isRefreshing ? 'WAIT' : reconciliationRequired ? 'RECONCILE' : 'REFRESH'}
            </Text>
          </Pressable>
          {bootstrap.capabilities.canAdvanceReplay ? (
            <Pressable
              accessibilityLabel="Advance one night in the sandbox replay"
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => {
                advanceMockNight();
                refreshData();
              }}
              style={({ pressed }) => [
                styles.advance,
                disabled && styles.disabledControl,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.advanceText}>+1 NIGHT</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={styles.earnings}>
        {earnings ? (
          <View
            accessible
            accessibilityLabel={`Last night ${formatSignedMoney(earnings.night)}, last seven nights ${formatSignedMoney(earnings.week)}`}
            style={styles.earningsNumbers}
          >
            <Text style={styles.earningsLabel}>LAST NIGHT</Text>
            <Text style={[styles.earningsValue, earnings.night >= 0 ? styles.up : styles.down]}>
              {formatCompactSignedMoney(earnings.night)}
            </Text>
            <Text style={styles.earningsDot}>·</Text>
            <Text style={styles.earningsLabel}>7 NIGHTS</Text>
            <Text style={[styles.earningsValue, earnings.week >= 0 ? styles.up : styles.down]}>
              {formatCompactSignedMoney(earnings.week)}
            </Text>
          </View>
        ) : null}
        <Pressable
          accessibilityLabel={rulesOpen ? 'Hide the game rules' : 'Show the game rules'}
          accessibilityRole="button"
          aria-expanded={rulesOpen}
          onPress={() => setRulesOpen((open) => !open)}
          style={({ pressed }) => [styles.rulesToggle, pressed && styles.pressed]}
        >
          <Text style={styles.rulesToggleText}>RULES {rulesOpen ? '▾' : '▸'}</Text>
        </Pressable>
      </View>
      {rulesOpen ? (
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
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
    backgroundColor: colors.chromeSoft,
  },
  summary: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  summaryReflow: {
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
  },
  item: {
    minWidth: 0,
    flexShrink: 1,
  },
  itemReflow: {
    minWidth: 72,
  },
  label: {
    ...labelStyle,
    marginBottom: 2,
  },
  value: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  lockChip: {
    alignItems: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.goldLine,
    backgroundColor: colors.goldSoft,
  },
  lockTitle: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.6,
  },
  lockDate: {
    marginTop: 1,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  refresh: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  reconcile: {
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
  },
  advance: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    backgroundColor: colors.gold,
  },
  advanceText: {
    color: colors.background,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
  },
  refreshText: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
  },
  earnings: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  earningsNumbers: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  earningsLabel: {
    ...labelStyle,
  },
  earningsValue: {
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  earningsDot: {
    color: colors.faint,
    fontSize: type.body,
  },
  rulesToggle: {
    minHeight: 32,
    marginLeft: 'auto',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  rulesToggleText: {
    ...labelStyle,
    color: colors.goldInk,
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
  sandbox: {
    color: colors.goldInk,
  },
  up: {
    color: colors.green,
  },
  down: {
    color: colors.red,
  },
  disabledControl: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.72,
  },
});
