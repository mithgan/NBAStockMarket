import { useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MarketApiClient } from './src/api/client';
import { resolvePublicAppConfig, type PublicAppConfig } from './src/api/config';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { AuthScreen } from './src/auth/AuthScreen';
import { SeasonControl } from './src/components/SeasonControl';
import { useReducedMotion } from './src/hooks/useReducedMotion';
import { LeaderboardScreen } from './src/screens/LeaderboardScreen';
import { MarketScreen } from './src/screens/MarketScreen';
import { PlaysScreen } from './src/screens/PlaysScreen';
import { PortfolioScreen } from './src/screens/PortfolioScreen';
import { PortfolioProvider, usePortfolio } from './src/state/PortfolioContext';
import { colors, fonts, labelStyle, radius, space, type } from './src/theme';
import { installGlobalWebStyles } from './src/web/globalStyles';

installGlobalWebStyles();

/** Circular databallr mark; radius is derived so it is never a card corner. */
const BRAND_MARK_SIZE = 24;

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
  // A spinner is the only moving element in the app, so it is the one thing the
  // reduced-motion setting has to silence.
  const reducedMotion = useReducedMotion();
  return (
    <View accessibilityRole="alert" style={styles.centeredState}>
      {busy ? (
        reducedMotion
          ? <Text style={styles.stateBusy}>WORKING…</Text>
          : <ActivityIndicator color={colors.gold} size="large" />
      ) : null}
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
    isLoading,
    isTransitioning,
    legacySavePresent,
    message,
    refreshData,
    serverError,
    state,
    transitionError,
    transitionRequired,
  } = usePortfolio();
  const hasVisibleSnapshot = Boolean(
    state
    && !isLoading
    && !serverError
    && !transitionRequired
    && !isTransitioning,
  );

  const body = (() => {
    if (isLoading) {
      return <CenteredState busy copy="Loading market, portfolio, and game state from the server." title="Loading your account" />;
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
      {/* Databallr brand bar: gold wordmark, a rule, then the product name. */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.mark}><Text maxFontSizeMultiplier={1.2} style={styles.markText}>d</Text></View>
        {/* Branding is decorative: it shrinks and truncates before the sign-out
            action is allowed to leave the viewport. */}
        <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.brand}>databallr</Text>
        <View style={styles.brandDivider} />
        <View style={styles.brandCopy}>
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.product}>STOCK MARKET</Text>
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

      {hasVisibleSnapshot ? <SeasonControl /> : null}
      {authError ? (
        <NoticeBanner message={authError} onDismiss={clearAuthMessage} />
      ) : message ? (
        <NoticeBanner message={message} onDismiss={dismissNotice} />
      ) : null}

      <View style={styles.screen}>{body}</View>

      {hasVisibleSnapshot ? (
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
                style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
              >
                {/* Gold top rule marks the active tab, matching the underline
                    treatment on the databallr.com nav. */}
                <View style={[styles.tabMarker, active && styles.tabMarkerActive]} />
                <Text
                  maxFontSizeMultiplier={1.5}
                  numberOfLines={1}
                  style={[styles.tabText, active && styles.activeTabText]}
                >
                  {tab.label}
                </Text>
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
    // Wider than a phone frame so the ~300-row market table can breathe on a
    // desktop instead of leaving half the viewport empty.
    maxWidth: 1040,
    backgroundColor: colors.background,
    borderLeftColor: colors.border,
    borderRightColor: colors.border,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  mark: {
    width: BRAND_MARK_SIZE,
    height: BRAND_MARK_SIZE,
    borderRadius: BRAND_MARK_SIZE / 2,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: {
    color: colors.background,
    fontFamily: fonts.display,
    fontSize: 15,
    fontWeight: '900',
    marginTop: -1,
  },
  brand: {
    flexShrink: 1,
    minWidth: 0,
    color: colors.gold,
    fontFamily: fonts.display,
    fontSize: 17,
    fontWeight: '800',
    },
  brandDivider: { width: 1, height: 18, backgroundColor: colors.borderStrong, marginHorizontal: space.xs },
  brandCopy: { flex: 1, flexShrink: 1, minWidth: 0 },
  product: { ...labelStyle, color: colors.muted },
  signOut: { minHeight: 44, flexShrink: 0, justifyContent: 'center', paddingHorizontal: space.sm },
  signOutText: { ...labelStyle },
  // brandDivider is decorative and collapses with the wordmark.
  notice: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: colors.goldSoft,
    borderBottomColor: colors.gold,
    borderBottomWidth: 1,
  },
  noticeText: { flex: 1, color: colors.text, fontSize: type.label, lineHeight: 17, fontWeight: '700' },
  noticeClose: { color: colors.gold, fontSize: type.label, fontWeight: '900' },
  screen: { flex: 1, minHeight: 0 },
  centeredState: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', width: '100%', maxWidth: 500, padding: space.xl, backgroundColor: colors.background },
  stateBusy: { color: colors.gold, fontSize: type.label, fontWeight: '900', letterSpacing: 1 },
  stateTitle: { color: colors.text, fontSize: 20, fontWeight: '900', textAlign: 'center', marginTop: space.md },
  stateCopy: { color: colors.muted, fontSize: type.body, lineHeight: 20, textAlign: 'center', marginTop: space.sm },
  stateButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gold, borderRadius: radius.md, paddingHorizontal: space.lg, marginTop: space.lg },
  stateButtonText: { color: colors.background, fontSize: type.label, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 0,
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  tabMarker: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'transparent',
  },
  tabMarkerActive: { backgroundColor: colors.gold },
  tabText: {
    ...labelStyle,
    color: colors.faint,
    letterSpacing: 0.9,
  },
  activeTabText: { color: colors.gold },
  pressed: { opacity: 0.65 },
});
