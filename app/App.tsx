import { useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MarketApiClient } from './src/api/client';
import { resolvePublicAppConfig } from './src/api/config';
import { useOptionalAuth } from './src/auth/AuthContext';
import './src/auth/AuthScreen';
import { seasonLabelFor } from './src/data/calendar';
import { SeasonControl } from './src/components/SeasonControl';
import { SettingsButton, SettingsSheet } from './src/components/SettingsSheet';
import { useReducedMotion } from './src/hooks/useReducedMotion';
import { LeaderboardScreen } from './src/screens/LeaderboardScreen';
import { MarketScreen } from './src/screens/MarketScreen';
import { PlaysScreen } from './src/screens/PlaysScreen';
import { DesignPreviewScreen } from './src/screens/DesignPreviewScreen';
import { PortfolioScreen } from './src/screens/PortfolioScreen';
import { WatchlistScreen } from './src/screens/WatchlistScreen';
import { LocalMarketClient } from './src/api/localClient';
import { PortfolioProvider, usePortfolio } from './src/state/PortfolioContext';
import { ThemeProvider, useDesignVariant } from './src/theme/ThemeProvider';
import { colors, fonts, labelStyle, radius, space, type } from './src/theme';
import { installGlobalWebStyles } from './src/web/globalStyles';

installGlobalWebStyles();

type Tab = 'portfolio' | 'market' | 'watchlist' | 'plays' | 'leaderboard';

const tabs: { key: Tab; label: string }[] = [
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'market', label: 'Market' },
  { key: 'watchlist', label: 'Watch' },
  { key: 'plays', label: 'Plays' },
  { key: 'leaderboard', label: 'Leaders' },
];

/**
 * Ambient variants put two blurred colour fields behind the content. The blur
 * itself is CSS (web/globalStyles.ts) addressed via nativeID; everything the
 * variant controls — colour, opacity, size — is inline here.
 */
function AmbientFields() {
  const { variant } = useDesignVariant();
  const glow = variant.glow;
  if (!glow) return null;
  return (
    <View pointerEvents="none" style={styles.ambient}>
      <View
        nativeID="ambient-field-up"
        style={[
          styles.ambientBlob,
          {
            backgroundColor: variant.palette.green,
            opacity: glow.up,
            width: glow.size,
            height: glow.size,
            top: -glow.size / 3,
            right: -glow.size / 4,
          },
        ]}
      />
      <View
        nativeID="ambient-field-accent"
        style={[
          styles.ambientBlob,
          {
            backgroundColor: glow.accentColor ?? variant.palette.gold,
            opacity: glow.accent,
            width: glow.size * 0.88,
            height: glow.size * 0.88,
            top: glow.size,
            left: -glow.size / 3,
          },
        ]}
      />
    </View>
  );
}

/** Full-screen texture layer; the actual gradient lives in the global CSS. */
function VariantTexture() {
  const { variant } = useDesignVariant();
  if (!variant.texture) return null;
  return <View nativeID={`variant-texture-${variant.texture}`} pointerEvents="none" style={styles.texture} />;
}

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

/**
 * Wide screens read as a desktop product, and a desktop product keeps its
 * navigation at the top; the thumb-reach argument for a bottom bar only exists
 * on a phone.
 */
const WIDE_LAYOUT_MIN_WIDTH = 900;

function AppBody() {
  const [activeTab, setActiveTab] = useState<Tab>('portfolio');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_LAYOUT_MIN_WIDTH;
  const auth = useOptionalAuth();
  const authError = auth?.error ?? null;
  const authSubmitting = auth?.isSubmitting ?? false;
  const clearAuthMessage = auth?.clearMessage;
  const signOut = auth?.signOut;
  const {
    confirmLocalTransition,
    dismissNotice,
    isLoading,
    isTransitioning,
    displayName,
    latestSettledDate,
    legacySavePresent,
    message,
    nextGameDate,
    players,
    refreshData,
    serverError,
    state,
    transitionError,
    transitionRequired,
  } = usePortfolio();
  const seasonLabel = seasonLabelFor(latestSettledDate ?? nextGameDate);
  const ready = Boolean(state && !isLoading && !serverError && !transitionRequired && !isTransitioning);

  const body = (() => {
    if (isLoading) {
      return (
        <CenteredState
          busy
          copy="Loading market, portfolio, and game state from the server."
          title="Loading your account"
        />
      );
    }
    if (transitionRequired) {
      const failed = Boolean(transitionError) && !legacySavePresent;
      return (
        <CenteredState
          actionDisabled={isTransitioning}
          actionLabel={isTransitioning ? 'WORKING...' : failed ? 'TRY AGAIN' : 'USE SERVER ACCOUNT'}
          copy={
            transitionError ??
            'This device has prototype progress that cannot be safely imported. Your server account will remain authoritative, then the old device save will be removed.'
          }
          onAction={() => {
            failed ? refreshData() : confirmLocalTransition();
          }}
          title={failed ? 'Device storage unavailable' : 'Finish account setup'}
        />
      );
    }
    if (serverError || !state) {
      return (
        <CenteredState
          actionLabel="RETRY"
          copy={serverError ?? 'The server did not return a usable account snapshot.'}
          onAction={() => {
            refreshData();
          }}
          title="Account unavailable"
        />
      );
    }
    return (
      <>
        {activeTab === 'portfolio' && <PortfolioScreen />}
        {activeTab === 'market' && <MarketScreen />}
        {activeTab === 'watchlist' && <WatchlistScreen />}
        {activeTab === 'plays' && <PlaysScreen />}
        {activeTab === 'leaderboard' && <LeaderboardScreen />}
      </>
    );
  })();

  const renderTabBar = (position: 'top' | 'bottom') => (
    <View
      accessibilityRole="tablist"
      style={[styles.tabBar, position === 'top' ? styles.tabBarTop : { paddingBottom: insets.bottom + 9 }]}
    >
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
            {/* Gold rule marks the active tab, matching the underline treatment
                on the databallr.com nav. It sits on the edge nearest the
                content: below the labels when the bar is on top, above when
                the bar is at the bottom. */}
            <View style={[styles.tabMarker, position === 'top' && styles.tabMarkerBottomEdge, active && styles.tabMarkerActive]} />
            <Text maxFontSizeMultiplier={1.5} numberOfLines={1} style={[styles.tabText, active && styles.activeTabText]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      <AmbientFields />
      <VariantTexture />
      {/* Databallr brand bar: gold wordmark, a rule, then the product name. */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.mark}>
          <Text maxFontSizeMultiplier={1.2} style={styles.markText}>d</Text>
        </View>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.brand}>databallr</Text>
        <View style={styles.brandDivider} />
        <View style={styles.brandCopy}>
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.product}>STOCK MARKET</Text>
        </View>
        <SettingsButton onPress={() => setSettingsOpen(true)} />
      </View>
      {ready && wide ? renderTabBar('top') : null}
      {ready ? <SeasonControl /> : null}
      {authError && clearAuthMessage ? (
        <NoticeBanner message={authError} onDismiss={clearAuthMessage} />
      ) : message ? (
        <NoticeBanner message={message} onDismiss={dismissNotice} />
      ) : null}
      <View style={styles.screen}>{body}</View>
      {ready ? (wide ? null : renderTabBar('bottom')) : null}
      <SettingsSheet
        listedPlayers={players.length}
        onClose={() => setSettingsOpen(false)}
        profile={
          auth?.user
            ? {
                displayName: displayName ?? auth.user.email ?? 'Your account',
                email: auth.user.email ?? null,
                provider: auth.user.app_metadata?.provider ?? null,
                memberSince: auth.user.created_at ? auth.user.created_at.slice(0, 10) : null,
              }
            : undefined
        }
        onSignOut={
          signOut && !authSubmitting
            ? () => {
                setSettingsOpen(false);
                signOut();
              }
            : undefined
        }
        seasonLabel={seasonLabel}
        visible={settingsOpen}
      />
    </View>
  );
}

/**
 * The public build is a self-contained demo: a local market client seeded from
 * the committed season data, no server account required.
 */
function LocalDemoApp() {
  const client = useMemo(() => new LocalMarketClient(), []);
  return (
    <PortfolioProvider apiClient={client as unknown as MarketApiClient} userId="local-demo">
      <AppBody />
    </PortfolioProvider>
  );
}

/**
 * /treatments (or any URL carrying ?design) renders the design gallery instead
 * of the app, so every variant can be reviewed side by side at a stable URL.
 */
function isDesignPreviewRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path === '/treatments' || path.startsWith('/treatments/')) return true;
  return new URLSearchParams(window.location.search).has('design');
}

export default function App() {
  resolvePublicAppConfig();
  if (isDesignPreviewRoute()) {
    return (
      <ThemeProvider>
        <SafeAreaProvider style={styles.provider}>
          <StatusBar style="light" />
          <View style={styles.app}>
            <AmbientFields />
            <VariantTexture />
            <DesignPreviewScreen />
          </View>
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }
  return (
    <ThemeProvider>
      <SafeAreaProvider style={styles.provider}>
        <StatusBar style="light" />
        <LocalDemoApp />
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  provider: {
    flex: 1,
    backgroundColor: colors.background,
  },
  ambient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  texture: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  ambientBlob: {
    position: 'absolute',
  },
  app: {
    flex: 1,
    minHeight: 0,
    alignSelf: 'center',
    width: '100%',
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
    backgroundColor: colors.chrome,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  mark: {
    width: 24,
    height: 24,
    borderRadius: 12,
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
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: 17,
    fontWeight: '800',
  },
  brandDivider: {
    width: 1,
    height: 18,
    backgroundColor: colors.borderStrong,
    marginHorizontal: space.xs,
  },
  brandCopy: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  product: {
    ...labelStyle,
    color: colors.muted,
  },
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
  noticeText: {
    flex: 1,
    color: colors.text,
    fontSize: type.label,
    lineHeight: 17,
    fontWeight: '700',
  },
  noticeClose: {
    color: colors.goldInk,
    fontSize: type.label,
    fontWeight: '900',
  },
  screen: {
    flex: 1,
    minHeight: 0,
  },
  centeredState: {
    flex: 1,
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 500,
    padding: space.xl,
    backgroundColor: colors.background,
  },
  stateBusy: {
    color: colors.goldInk,
    fontSize: type.label,
    fontWeight: '900',
    letterSpacing: 1,
  },
  stateTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: space.md,
  },
  stateCopy: {
    color: colors.muted,
    fontSize: type.body,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: space.sm,
  },
  stateButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    marginTop: space.lg,
  },
  stateButtonText: {
    color: colors.background,
    fontSize: type.label,
    fontWeight: '900',
  },
  disabled: {
    opacity: 0.45,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 0,
    backgroundColor: colors.chromeMid,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  tabBarTop: {
    borderTopWidth: 0,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    backgroundColor: colors.chromeMid,
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
  tabMarkerBottomEdge: {
    top: 'auto',
    bottom: 0,
  },
  tabMarkerActive: {
    backgroundColor: colors.gold,
  },
  tabText: {
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: '700',
    color: colors.faint,
  },
  activeTabText: {
    color: colors.goldInk,
  },
  pressed: {
    opacity: 0.65,
  },
});
