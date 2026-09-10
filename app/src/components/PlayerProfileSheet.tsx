import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type {
  PerGameMarketPlayer,
  PerGamePosition,
  PerGameSettledResult,
} from '../api/contracts';
import type { TrendPoint } from '../data/trendPresentation';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { PlayerDetail } from '../screens/MarketScreen';
import { colors } from '../theme';

/**
 * Per-game trend points derived from the nights the account actually settled:
 * np is what he produced, expected is the locked cost in net points, and the
 * payout is his dividend minus that locked cost (long perspective either way).
 */
export function trendPointsFromResults(
  results: PerGameSettledResult[],
  dividendRate: number,
): TrendPoint[] {
  return results
    .filter((result) => result.status === 'settled' && result.dividendDollars !== null)
    .sort((left, right) => left.gameDate.localeCompare(right.gameDate))
    .map((result) => ({
      date: result.gameDate,
      np: Math.round(((result.dividendDollars ?? 0) / dividendRate) * 10) / 10,
      expected_np: Math.round((result.lockedGameCost / dividendRate) * 10) / 10,
      dividend_per_holder: (result.dividendDollars ?? 0) - result.lockedGameCost,
    }));
}

/**
 * The in-depth player profile from the original stock market — stat tiles,
 * the L5/L15/L30/Season trend chart with HIGH/LOW callouts and scrubbing, and
 * the DIVIDENDS | PRICE metric toggle — mounted over the per-game market.
 * Cost-per-game stands in for the share price; trend points come from the
 * sandbox's full nightly history when it is running, otherwise from the
 * nights this account settled.
 */
export function PlayerProfileSheet({
  visible,
  onClose,
  player,
  position,
  results,
  dividendRate,
  latestSettledDate,
  trends,
}: {
  visible: boolean;
  onClose: () => void;
  player: PerGameMarketPlayer | null;
  position: PerGamePosition | null;
  results: PerGameSettledResult[];
  dividendRate: number;
  latestSettledDate: string | null;
  trends?: TrendPoint[];
}) {
  const reducedMotion = useReducedMotion();
  if (!player) return null;
  const trendPoints = trends && trends.length > 0
    ? trends
    : trendPointsFromResults(results, dividendRate);

  return (
    <Modal
      animationType={reducedMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <Pressable
        accessibilityLabel="Close player profile"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.scrim}
      />
      <View style={styles.sheet}>
        <ScrollView style={styles.sheetBody}>
          <PlayerDetail
            backLabel="Close"
            currentPrice={player.currentGameCost}
            latestSettledDate={latestSettledDate}
            onClose={onClose}
            player={{
              id: player.playerId,
              name: player.name,
              tier: player.tier,
              listing_price: position?.lockedGameCost ?? player.currentGameCost,
              actual_salary: player.priorSeasonValuePerGame ?? player.currentGameCost,
            }}
            trendPoints={trendPoints}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheet: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 560,
    marginTop: 40,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderBottomWidth: 0,
  },
  sheetBody: {
    flex: 1,
  },
});
