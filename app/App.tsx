import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { SeasonControl } from './src/components/SeasonControl';
import { LeaderboardScreen } from './src/screens/LeaderboardScreen';
import { MarketScreen } from './src/screens/MarketScreen';
import { PlaysScreen } from './src/screens/PlaysScreen';
import { PortfolioScreen } from './src/screens/PortfolioScreen';
import { PortfolioProvider, usePortfolio } from './src/state/PortfolioContext';
import { colors } from './src/theme';

type Tab = 'portfolio' | 'market' | 'plays' | 'leaderboard';

const tabs: { key: Tab; label: string }[] = [
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'market', label: 'Market' },
  { key: 'plays', label: 'Plays' },
  { key: 'leaderboard', label: 'Leaders' },
];

function NoticeBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <Pressable
      accessibilityLabel={`${message}. Dismiss message`}
      accessibilityLiveRegion="polite"
      accessibilityRole="button"
      onPress={onDismiss}
      style={styles.notice}
    >
      <Text style={styles.noticeText}>{message}</Text>
      <Text style={styles.noticeClose}>CLOSE</Text>
    </Pressable>
  );
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<Tab>('portfolio');
  const insets = useSafeAreaInsets();
  const { dismissNotice, isGameplayReady, isHydrated, message, persistenceError } = usePortfolio();

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.mark}><Text style={styles.markText}>DB</Text></View>
        <View style={styles.brandCopy}>
          <Text numberOfLines={1} style={styles.brand}>NBA STOCK MARKET</Text>
          <Text style={styles.season}>DATABALLR HISTORICAL MVP</Text>
        </View>
      </View>

      <SeasonControl />

      {persistenceError ? (
        <NoticeBanner
          message={persistenceError}
          onDismiss={() => dismissNotice('persistence')}
        />
      ) : null}
      {message ? (
        <NoticeBanner message={message} onDismiss={() => dismissNotice('message')} />
      ) : null}

      <View style={styles.screen}>
        {!isHydrated ? (
          <View style={styles.loading}>
            <Text style={styles.loadingTitle}>Loading your portfolio</Text>
            <Text style={styles.loadingCopy}>Checking saved progress on this device.</Text>
          </View>
        ) : (
          <>
            {activeTab === 'portfolio' && <PortfolioScreen />}
            {activeTab === 'market' && <MarketScreen />}
            {activeTab === 'plays' && <PlaysScreen />}
            {activeTab === 'leaderboard' && <LeaderboardScreen />}
          </>
        )}
      </View>

      <View accessibilityRole="tablist" style={[styles.tabBar, { paddingBottom: insets.bottom + 9 }]}>
        {tabs.map((tab) => {
          const active = tab.key === activeTab;
          const disabled = !isHydrated || (!isGameplayReady && tab.key !== 'portfolio');
          return (
            <Pressable
              key={tab.key}
              accessibilityLabel={tab.label}
              accessibilityRole="tab"
              accessibilityState={{ selected: active, disabled }}
              aria-selected={active}
              disabled={disabled}
              onPress={() => setActiveTab(tab.key)}
              style={({ pressed }) => [styles.tab, active && styles.activeTab, pressed && styles.pressed]}
            >
              <Text numberOfLines={1} style={[styles.tabText, active && styles.activeTabText]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider style={styles.provider}>
      <PortfolioProvider>
        <AppContent />
      </PortfolioProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  provider: { flex: 1, backgroundColor: colors.background },
  app: {
    flex: 1,
    minHeight: 0,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 840,
    backgroundColor: colors.background,
    borderLeftColor: colors.border,
    borderRightColor: colors.border,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  mark: { width: 36, height: 36, borderRadius: 6, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  markText: { color: colors.background, fontSize: 12, fontWeight: '900' },
  brandCopy: { flex: 1, minWidth: 0 },
  brand: { color: colors.text, fontSize: 13, fontWeight: '900', letterSpacing: 1.1 },
  season: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 0.9, marginTop: 2 },
  notice: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: colors.goldSoft,
    borderBottomColor: colors.gold,
    borderBottomWidth: 1,
  },
  noticeText: { flex: 1, color: colors.text, fontSize: 11, lineHeight: 16, fontWeight: '700' },
  noticeClose: { color: colors.gold, fontSize: 9, fontWeight: '900' },
  screen: { flex: 1, minHeight: 0 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  loadingCopy: { color: colors.muted, fontSize: 12, marginTop: 6, textAlign: 'center' },
  tabBar: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingTop: 8,
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  tab: { flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 6, paddingHorizontal: 3, paddingVertical: 10 },
  activeTab: { backgroundColor: colors.surfaceRaised },
  tabText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  activeTabText: { color: colors.gold },
  pressed: { opacity: 0.65 },
});
