import { Pressable, StyleSheet, Text, View } from 'react-native';

import { usePortfolio } from '../state/PortfolioContext';
import { seasonDayNumber, seasonProgress, SEASON_TOTAL_DAYS, SIM_START } from '../state/sim';
import { colors } from '../theme';

const dateLabel = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatSimDate(isoDate: string) {
  return dateLabel.format(new Date(`${isoDate}T00:00:00Z`));
}

export function SimBar() {
  const { advanceSim, resetSeason, seasonComplete, simDate } = usePortfolio();
  const day = seasonDayNumber(simDate);
  const progress = seasonProgress(simDate);
  const beforeTipoff = simDate === SIM_START;

  return (
    <View style={styles.bar}>
      <View style={styles.readout}>
        <View style={styles.readoutCopy}>
          <Text style={styles.eyebrow}>2025-26 SEASON REPLAY</Text>
          <Text style={styles.date}>
            {beforeTipoff ? 'Opening night eve' : formatSimDate(simDate)}
            <Text style={styles.dayCount}>  ·  Day {day} / {SEASON_TOTAL_DAYS}</Text>
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Restart the season replay"
          accessibilityRole="button"
          onPress={resetSeason}
          style={({ pressed }) => [styles.resetButton, pressed && styles.pressed]}
        >
          <Text style={styles.resetText}>RESET</Text>
        </Pressable>
      </View>

      <View
        accessibilityLabel={`Season progress: day ${day} of ${SEASON_TOTAL_DAYS}`}
        style={styles.track}
      >
        <View style={[styles.fill, { width: `${Math.max(progress * 100, 0.5)}%` }]} />
      </View>

      <View style={styles.controls}>
        {([
          ['+1 DAY', 1],
          ['+1 WEEK', 7],
        ] as const).map(([label, days]) => (
          <Pressable
            accessibilityLabel={`Advance ${days === 1 ? 'one day' : 'one week'}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: seasonComplete }}
            disabled={seasonComplete}
            key={label}
            onPress={() => advanceSim(days)}
            style={({ pressed }) => [
              styles.advanceButton,
              seasonComplete && styles.disabledButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.advanceText, seasonComplete && styles.disabledText]}>
              {label}
            </Text>
          </Pressable>
        ))}
        {seasonComplete ? <Text style={styles.done}>Season complete</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 8,
  },
  readout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  readoutCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.gold, fontSize: 8, fontWeight: '900', letterSpacing: 1.4 },
  date: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 2 },
  dayCount: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  resetButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  resetText: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  track: { height: 5, borderRadius: 999, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999, backgroundColor: colors.gold },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  advanceButton: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
    paddingHorizontal: 16,
  },
  advanceText: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  disabledButton: { borderColor: colors.border, backgroundColor: colors.surfaceRaised, opacity: 0.55 },
  disabledText: { color: colors.muted },
  done: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  pressed: { opacity: 0.65 },
});
