import { useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MarketApiClient } from './src/api/client';
import { resolvePublicAppConfig, type PublicAppConfig } from './src/api/config';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { AuthScreen } from './src/auth/AuthScreen';
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

function CenteredState({
  title,
  copy,
  actionLabel,
  actionDisabled = false,
  onAction,
  busy = false,
}: {
  title: string;
  copy: string;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
  busy?: boolean;
}) {
  return (
    <View accessibilityRole="alert" style={styles.centeredState}>
      {busy ? <ActivityIndicator color={colors.gold} size="large" /> : null}
      <Text accessibilityRole="header" style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateCopy}>{copy}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: actionDisabled }}
          disabled={actionDisabled}
          onPress={onAction}
          style={({ pressed }) => [styles.stateButton, actionDisabled && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.stateButtonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

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
  const {
    clearMessage: clearAuthMessage,
    error: authError,
    isSubmitting,
    signOut,
  } = useAuth();
  const {
    confirmLocalTransition,
    dismissNotice,
    isGameplayReady,
    isLoading,
    isRefreshing,
    isTransitioning,
    legacySavePresent,
    message,
    refreshData,
    serverError,
    state,
    transitionError,
    transitionRequired,
  } = usePortfolio();

  const body = (() => {
    if (isLoading) {
      return <CenteredState busy copy="Loading market, portfolio, and game state from the server." title="Loading your account" />;
    }
    if (isRefreshing) {
      return <CenteredState busy copy="Waiting for a fresh authoritative account snapshot." title="Refreshing your account" />;
    }
    if (transitionRequired) {
      const storageCheckFailed = Boolean(transitionError) && !legacySavePresent;
      return (
        <CenteredState
          actionDisabled={isTransitioning}
          actionLabel={isTransitioning ? 'WORKING...' : storageCheckFailed ? 'TRY AGAIN' : 'USE SERVER ACCOUNT'}
          copy={transitionError ?? 'This device has prototype progress that cannot be safely imported. Your server account will remain authoritative, then the old device save will be removed.'}
          onAction={() => void (storageCheckFailed ? refreshData() : confirmLocalTransition())}
          title={storageCheckFailed ? 'Device storage unavailable' : 'Finish account setup'}
        />
      );
    }
    if (serverError || !state) {
      return (
        <CenteredState
          actionLabel="RETRY"
          copy={serverError ?? 'The server did not return a usable account snapshot.'}
          onAction={() => void refreshData()}
          title="Account unavailable"
        />
      );
    }
    return (
      <>
        {activeTab === 'portfolio' && <PortfolioScreen />}
        {activeTab === 'market' && <MarketScreen />}
        {activeTab === 'plays' && <PlaysScreen />}
        {activeTab === 'leaderboard' && <LeaderboardScreen />}
      </>
    );
  })();

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.mark}><Text style={styles.markText}>DB</Text></View>
        <View style={styles.brandCopy}>
          <Text numberOfLines={1} style={styles.brand}>NBA STOCK MARKET</Text>
          <Text style={styles.season}>SERVER-BACKED HISTORICAL MVP</Text>
        </View>
        <Pressable
          accessibilityLabel="Sign out"
          accessibilityRole="button"
          accessibilityState={{ disabled: isSubmitting }}
          disabled={isSubmitting}
          onPress={() => void signOut()}
          style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
        >
          <Text style={styles.signOutText}>SIGN OUT</Text>
        </Pressable>
      </View>

      {isGameplayReady ? <SeasonControl /> : null}
      {authError ? (
        <NoticeBanner message={authError} onDismiss={clearAuthMessage} />
      ) : message ? (
        <NoticeBanner message={message} onDismiss={dismissNotice} />
      ) : null}

      <View style={styles.screen}>{body}</View>

      {isGameplayReady ? (
        <View accessibilityRole="tablist" style={[styles.tabBar, { paddingBottom: insets.bottom + 9 }]}>
          {tabs.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <Pressable
                key={tab.key}
                accessibilityLabel={tab.label}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                aria-selected={active}
                onPress={() => setActiveTab(tab.key)}
                style={({ pressed }) => [styles.tab, active && styles.activeTab, pressed && styles.pressed]}
              >
                <Text numberOfLines={1} style={[styles.tabText, active && styles.activeTabText]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function AuthenticatedRuntime({ config }: { config: PublicAppConfig }) {
  const { getAccessToken, isLoading, user } = useAuth();
  const apiClient = useMemo(() => new MarketApiClient({
    baseUrl: config.apiUrl,
    expectedUserId: user?.id ?? '',
    getAccessToken,
  }), [config.apiUrl, getAccessToken, user?.id]);

  if (isLoading) {
    return <CenteredState busy copy="Restoring your saved sign-in securely." title="Checking your session" />;
  }
  if (!user) return <AuthScreen />;
  return (
    <PortfolioProvider apiClient={apiClient} key={user.id} userId={user.id}>
      <AppContent />
    </PortfolioProvider>
  );
}

function ConfiguredApp({ config }: { config: PublicAppConfig }) {
  return (
    <AuthProvider config={config}>
      <AuthenticatedRuntime config={config} />
    </AuthProvider>
  );
}

export default function App() {
  const configResult = resolvePublicAppConfig();
  return (
    <SafeAreaProvider style={styles.provider}>
      <StatusBar style="light" />
      {configResult.config ? (
        <ConfiguredApp config={configResult.config} />
      ) : (
        <CenteredState
          copy={`${configResult.error} Set the three EXPO_PUBLIC app variables before starting Expo.`}
          title="App configuration missing"
        />
      )}
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
  signOut: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  signOutText: { color: colors.muted, fontSize: 9, fontWeight: '900' },
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
  centeredState: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', width: '100%', maxWidth: 500, padding: 28, backgroundColor: colors.background },
  stateTitle: { color: colors.text, fontSize: 22, fontWeight: '900', textAlign: 'center', marginTop: 14 },
  stateCopy: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  stateButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gold, borderRadius: 7, paddingHorizontal: 18, marginTop: 20 },
  stateButtonText: { color: colors.background, fontSize: 11, fontWeight: '900' },
  disabled: { opacity: 0.45 },
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
