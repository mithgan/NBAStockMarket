import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { LeaderboardScreen } from './src/screens/LeaderboardScreen';
import { MarketScreen } from './src/screens/MarketScreen';
import { PortfolioScreen } from './src/screens/PortfolioScreen';
import { PortfolioProvider } from './src/state/PortfolioContext';
import { colors } from './src/theme';

type Tab = 'portfolio' | 'market' | 'leaderboard';

const tabs: { key: Tab; label: string }[] = [
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'market', label: 'Market' },
  { key: 'leaderboard', label: 'Leaders' },
];

function AppContent() {
  const [activeTab, setActiveTab] = useState<Tab>('portfolio');
  const insets = useSafeAreaInsets();

  return (
    <PortfolioProvider>
      <View style={styles.app}>
        <StatusBar style="light" />
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <View style={styles.mark}><Text style={styles.markText}>DB</Text></View>
          <View>
            <Text style={styles.brand}>NBA STOCK MARKET</Text>
            <Text style={styles.season}>DATABALLR · 2026–27</Text>
          </View>
        </View>

        <View style={styles.screen}>
          {activeTab === 'portfolio' && <PortfolioScreen />}
          {activeTab === 'market' && <MarketScreen />}
          {activeTab === 'leaderboard' && <LeaderboardScreen />}
        </View>

        <View style={[styles.tabBar, { paddingBottom: insets.bottom + 12 }]}>
          {tabs.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <Pressable
                key={tab.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setActiveTab(tab.key)}
                style={({ pressed }) => [styles.tab, active && styles.activeTab, pressed && styles.pressed]}
              >
                <Text style={[styles.tabText, active && styles.activeTabText]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </PortfolioProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider style={styles.provider}>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  provider: {
    flex: 1,
    backgroundColor: colors.background,
  },
  app: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.background,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 760,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  mark: {
    width: 35,
    height: 35,
    borderRadius: 11,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: { color: colors.background, fontSize: 12, fontWeight: '900' },
  brand: { color: colors.text, fontSize: 13, fontWeight: '900', letterSpacing: 1.3 },
  season: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.1, marginTop: 2 },
  screen: { flex: 1, minHeight: 0 },
  tabBar: {
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  tab: { flex: 1, alignItems: 'center', borderRadius: 10, paddingVertical: 11 },
  activeTab: { backgroundColor: colors.surfaceRaised },
  tabText: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  activeTabText: { color: colors.gold },
  pressed: { opacity: 0.65 },
});
