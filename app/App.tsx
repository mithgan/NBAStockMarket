import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { PerGameApiClient as MarketApiClient } from './src/api/perGameClient';
import { isMockActive, mockPerGameClient, mockSeasonStart } from './src/api/mockPerGameClient';
import type { PerGamePositionSide } from './src/api/contracts';
import { resolvePublicAppConfig, type PublicAppConfig } from './src/api/config';
import { AuthProvider, useAuth, useOptionalAuth } from './src/auth/AuthContext';
import { AuthScreen } from './src/auth/AuthScreen';
import { seasonLabelFor } from './src/data/calendar';
import { PerGameStatusStrip as SeasonControl } from './src/components/PerGameStatusStrip';
import { SimBar } from './src/components/SimBar';
import { SettingsButton, SettingsSheet } from './src/components/SettingsSheet';
import { useReducedMotion } from './src/hooks/useReducedMotion';
import { PerGameLeaderboardScreen as LeaderboardScreen } from './src/screens/PerGameLeaderboardScreen';
import { PerGameMarketScreen as MarketScreen } from './src/screens/PerGameMarketScreen';
import { PerGameResultsScreen as PlaysScreen, scrollResultsToNewest } from './src/screens/PerGameResultsScreen';
import { DesignPreviewScreen } from './src/screens/DesignPreviewScreen';
import { PerGameRosterScreen as PortfolioScreen } from './src/screens/PerGameRosterScreen';
import { humanDateWithYear, spoken } from './src/copy/terms';
import { Button, visuallyHidden } from './src/ui/kit';
import { registerSettingsOpener, registerTabOpener, settingsReturnStep } from './src/state/uiActions';
import { sheetIsOpen, subscribeSheets } from './src/web/appHistory';
import { consumePracticeRestarted, setPracticeProgress } from './src/web/practiceSession';
import {
  PerGameProvider as PortfolioProvider,
  usePerGame as usePortfolio,
  type NoticeTone,
} from './src/state/PerGameContext';
import { ThemeProvider, useDesignVariant } from './src/theme/ThemeProvider';
import { colors, fonts, labelStyle, radius, space, type } from './src/theme';
import { installGlobalWebStyles } from './src/web/globalStyles';
import { treatmentNavigation } from './src/web/treatmentNavigation';

installGlobalWebStyles();

/** Circular databallr mark; radius is derived so it is never a card corner. */
const BRAND_MARK_SIZE = 24;

type Tab = 'portfolio' | 'market' | 'plays' | 'leaderboard';

const tabs: { key: Tab; label: string }[] = [
  { key: 'portfolio', label: 'Roster' },
  { key: 'market', label: 'Market' },
  { key: 'plays', label: 'Results' },
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
    <View style={styles.ambient}>
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
  return <View nativeID={`variant-texture-${variant.texture}`} style={styles.texture} />;
}

function CenteredState({
  title,
  heading,
  brand = false,
  copy,
  details,
  actionLabel,
  actionDisabled = false,
  onAction,
  busy = false,
}: {
  /** What this state is (the page title); shown unless a `heading` is given. */
  title: string;
  /** A friendlier visible heading for players, e.g. on the config screen. */
  heading?: string;
  /** Lead with the databallr mark, for a screen a player lands on. */
  brand?: boolean;
  copy: string;
  /** Technical detail for developers, behind a small "Details" toggle. */
  details?: string;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
  busy?: boolean;
}) {
  // A spinner is the only moving element in the app, so it is the one thing the
  // reduced-motion setting has to silence.
  const reducedMotion = useReducedMotion();
  const [showDetails, setShowDetails] = useState(false);
  // A page a player lands on starts with its way forward in focus.
  const actionRef = useRef<View | null>(null);
  useEffect(() => {
    if (!brand) return;
    (actionRef.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [brand]);
  useEffect(() => {
    if (typeof document !== 'undefined') document.title = heading ?? title;
  }, [heading, title]);
  return (
    <View role={brand ? 'main' : undefined} accessibilityRole={brand ? undefined : 'alert'} style={styles.centeredState}>
      {brand ? (
        <View style={styles.stateBrand}>
          <View style={styles.mark}>
            <Text accessibilityElementsHidden aria-hidden importantForAccessibility="no" maxFontSizeMultiplier={1.2} style={styles.markText}>d</Text>
          </View>
          <Text maxFontSizeMultiplier={1.3} style={styles.brand}>databallr</Text>
          <View style={styles.brandDivider} />
          <Text maxFontSizeMultiplier={1.3} style={styles.product}>STOCK MARKET</Text>
        </View>
      ) : null}
      {busy ? (
        reducedMotion
          ? <Text style={styles.stateBusy}>WORKING…</Text>
          : <ActivityIndicator color={colors.gold} size="large" />
      ) : null}
      <Text accessibilityRole="header" style={styles.stateTitle}>{heading ?? title}</Text>
      <Text style={styles.stateCopy}>{copy}</Text>
      {actionLabel && onAction ? (
        // The app's own button, so this screen looks like the rest of it.
        <View style={styles.stateAction}>
          <Button ref={actionRef} disabled={actionDisabled} label={actionLabel} onPress={onAction} variant="primary" />
        </View>
      ) : null}
      {details ? (
        <View style={styles.stateDetailsBox}>
          <Button
            accessibilityLabel={showDetails ? 'Hide details for developers' : 'Show details for developers'}
            label={showDetails ? 'Hide details' : 'Details for developers'}
            onPress={() => setShowDetails((open) => !open)}
            variant="quiet"
          />
          {showDetails ? <Text style={styles.stateDetails}>{details}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A success notice clears itself; a problem waits for the player. Longer
 * notices stay up longer (about 17 characters a second on top of the base),
 * so the money at the end of "…Your short on Shai Gilgeous-Alexander ended:
 * +$378K." can be read before it goes.
 */
const SUCCESS_NOTICE_MS = 5000;
const SUCCESS_NOTICE_MAX_MS = 10000;

/**
 * Where the last tap landed, so a notice can keep clear of it: a notice that
 * slides up over the row you just tapped hides its "Added ✓" (walk 3 T1-01).
 */
let lastTap = { y: -1, at: 0 };
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (event) => {
    lastTap = { y: event.clientY, at: Date.now() };
  }, { capture: true, passive: true });
}

/**
 * Where a success notice goes. On a phone it always sits at the top of the
 * content, clear of the list's buttons: at the bottom it covered the next
 * row's Add, so the next tap only dismissed it and the player was silently
 * not added (walk 3 T1-07). Wider screens keep it at the bottom unless the
 * last tap was down there.
 */
function noticeAtTop(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.innerWidth < 720) return true;
  return Date.now() - lastTap.at < 3000 && lastTap.y > window.innerHeight * 0.5;
}

function successNoticeMs(message: string): number {
  return Math.min(SUCCESS_NOTICE_MAX_MS, SUCCESS_NOTICE_MS + Math.max(0, message.length - 60) * 60);
}

/**
 * Notices float over the bottom of the screen instead of pushing it down, so
 * adding a player never shoves the list the player is tapping through.
 *
 * A success ("added at $105K a game", "games through Nov 5 are in") clears
 * itself and lets taps fall through to the row underneath, so it can never
 * swallow the next Add. A problem stays until the player dismisses it,
 * because it asks them to do something. Screen readers hear every notice
 * through the always-mounted live region in AppBody, not through this view.
 */
function NoticeToast({
  message,
  onDismiss,
  tone,
}: {
  message: string;
  onDismiss: () => void;
  tone: NoticeTone;
}) {
  useEffect(() => {
    if (tone !== 'success') return undefined;
    const timer = setTimeout(onDismiss, successNoticeMs(message));
    return () => clearTimeout(timer);
  }, [message, onDismiss, tone]);
  const noticeRef = useRef<View | null>(null);
  // Chosen once per notice: away from where the player just tapped.
  const atTop = useMemo(() => tone === 'success' && noticeAtTop(), [message, tone]);
  // A notice that has just appeared (often where a confirm button was) lets
  // the second tap of a double tap pass without dismissing it (walk 3 T4-02).
  const shownAt = useMemo(() => Date.now(), [message]);
  const dismissByTap = () => {
    if (Date.now() - shownAt < 500) return;
    onDismiss();
  };
  // A sheet over the app shows its own result (the profile's tick and note);
  // a success notice would only sit dimmed under its scrim.
  const sheetOpen = useSyncExternalStore(subscribeSheets, sheetIsOpen, () => false);
  const problem = tone === 'problem';
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    // Escape dismisses the notice (a sheet or confirm open above it takes
    // Escape first), and a success notice steps aside when keyboard focus
    // lands on something it covers.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !sheetIsOpen()) onDismiss();
    };
    const onFocus = (event: FocusEvent) => {
      if (problem) return;
      const node = noticeRef.current as unknown as HTMLElement | null;
      const target = event.target as HTMLElement | null;
      if (!node?.getBoundingClientRect || !target?.getBoundingClientRect || node.contains(target)) return;
      const a = node.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) onDismiss();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
    };
  }, [onDismiss, problem]);
  if (!problem && sheetOpen) return null;
  if (!problem) {
    // A success reads like a snackbar: tapping it dismisses it, and never
    // presses whatever sits underneath. Screen readers already heard it
    // through the live region, so the visual copy stays out of their way.
    return (
      <View style={[styles.noticeLayer, atTop && styles.noticeLayerTop]}>
        <Pressable
          ref={noticeRef}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={dismissByTap}
          style={styles.notice}
          {...({ tabIndex: -1 } as object)}
        >
          <Text style={styles.noticeText}>{message}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={[styles.noticeLayer, atTop && styles.noticeLayerTop]}>
      <View ref={noticeRef} style={[styles.notice, styles.noticeProblem]}>
        <Text style={styles.noticeText}>{message}</Text>
        <Pressable
          accessibilityLabel={`Dismiss: ${message}`}
          accessibilityRole="button"
          onPress={onDismiss}
          style={({ pressed }) => [styles.noticeDismiss, pressed && styles.pressed]}
        >
          <Text style={styles.noticeClose}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * First stop for the Tab key: jump past the brand bar, tabs and practice
 * controls straight to the screen. Invisible until focused.
 */
function SkipLink() {
  const [focused, setFocused] = useState(false);
  const jump = () => {
    if (typeof document === 'undefined') return;
    (document.getElementById('app-screen') as HTMLElement | null)?.focus?.();
  };
  return (
    <Pressable
      accessibilityLabel="Skip to content"
      accessibilityRole="link"
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      // react-native-web only presses a "link" role on click, so the keys the
      // people who need this link actually use (Enter, Space) are handled here
      // (a web-only prop the native types do not list).
      {...({
        onKeyDown: (event: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
          const key = event.nativeEvent?.key ?? event.key;
          if (key !== 'Enter' && key !== ' ') return;
          event.preventDefault?.();
          jump();
        },
      } as object)}
      onPress={jump}
      // Hidden, it must not keep an invisible tappable box in the corner:
      // the link's minimum height and padding are dropped with it.
      style={[styles.skipLink, !focused && visuallyHidden, !focused && styles.skipLinkHidden]}
    >
      <Text style={styles.skipLinkText}>Skip to content</Text>
    </Pressable>
  );
}

/**
 * Wide screens read as a desktop product, and a desktop product keeps its
 * navigation at the top; the thumb-reach argument for a bottom bar only exists
 * on a phone.
 */
const WIDE_LAYOUT_MIN_WIDTH = 900;
/**
 * Below this height (a phone on its side, a laptop at 400% zoom) the frame
 * folds: the brand bar hides (the status row carries Settings instead) and
 * the tab bar loses its extra padding, so the game keeps most of the screen.
 */
const SHORT_LAYOUT_MAX_HEIGHT = 500;

function treatmentsRequested(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('treatments');
}
const NARROW_LAYOUT_MAX_WIDTH = 300;
/** Below this width the brand bar keeps the wordmark and drops "STOCK MARKET" whole (never "STOCK MAR…"). */
const BRAND_PRODUCT_MIN_WIDTH = 330;

function AppBody() {
  const [activeTab, setActiveTab] = useState<Tab>('portfolio');
  const activeTabRef = useRef<Tab>('portfolio');
  activeTabRef.current = activeTab;
  // The browser tab names the screen, so switching windows says where you are.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const label = tabs.find((entry) => entry.key === activeTab)?.label;
    document.title = label ? `${label} · NBA Stock Market` : 'NBA Stock Market';
  }, [activeTab]);
  const [marketSide, setMarketSide] = useState<PerGamePositionSide>('long');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = width >= WIDE_LAYOUT_MIN_WIDTH;
  const short = height < SHORT_LAYOUT_MAX_HEIGHT;
  const tabRefs = useRef<Array<View | null>>([]);
  const [appNotice, setAppNotice] = useState<string | null>(null);

  // Tabs live in browser history, so Back steps back through the tabs a
  // player visited (after closing any open sheet) before it leaves the app.
  const pushTab = useCallback((tab: Tab) => {
    if (typeof window === 'undefined') return;
    const current = (window.history.state as { tab?: Tab } | null)?.tab;
    if (current !== tab) window.history.pushState({ tab }, '');
  }, []);
  const changeTab = (tab: Tab) => {
    if (tab === activeTab) {
      // Pressing Results again takes a long season back to its newest night.
      if (tab === 'plays') scrollResultsToNewest();
      return;
    }
    pushTab(tab);
    setActiveTab(tab);
  };
  // Screens switch tabs through uiActions (the Market's "Choose who to drop").
  useEffect(() => registerTabOpener((tab) => {
    pushTab(tab);
    setActiveTab(tab);
  }), [pushTab]);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.history.replaceState({ ...(window.history.state ?? {}), tab: 'portfolio' }, '');
    const onPop = (event: PopStateEvent) => {
      // Back with a sheet open closes the sheet (the sheet handles it).
      if (sheetIsOpen()) return;
      const tab = (event.state as { tab?: Tab } | null)?.tab;
      if (!tab) return;
      // A sheet closing by its own button also pops history, back to the
      // same tab: that is not a screen change, and the sheet returns focus
      // to whatever opened it.
      if (tab === activeTabRef.current) return;
      setActiveTab(tab);
      // Back changed the screen: put focus on its tab, so a screen reader
      // says where you are and the keyboard is not left on the old tab.
      setTimeout(() => {
        const index = tabs.findIndex((entry) => entry.key === tab);
        (tabRefs.current[index] as unknown as { focus?: (options?: object) => void } | null)?.focus?.({ preventScroll: true });
      }, 0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => registerSettingsOpener(() => setSettingsOpen(true)), []);
  // Rules opened from Settings hands back to Settings when it closes.
  useEffect(() => subscribeSheets(() => {
    if (settingsReturnStep(sheetIsOpen())) setTimeout(() => setSettingsOpen(true), 80);
  }), []);
  // After Restart, say that a fresh season has begun and put focus on the
  // screen, so nobody is left wondering what just happened.
  useEffect(() => {
    if (!consumePracticeRestarted()) return;
    setAppNotice('New practice season. Build a roster in the Market, then press +1 night to play the first games.');
    if (typeof document !== 'undefined') {
      setTimeout(() => (document.getElementById('app-screen') as HTMLElement | null)?.focus?.(), 300);
    }
  }, []);
  // Under ~300 CSS px (a phone at 200% zoom) the four tab labels and the
  // brand line only fit at the smallest type size, without side padding.
  const narrow = width < NARROW_LAYOUT_MAX_WIDTH;
  const brandOnly = width < BRAND_PRODUCT_MIN_WIDTH;
  const auth = useOptionalAuth();
  const authError = auth?.error ?? null;
  const authSubmitting = auth?.isSubmitting ?? false;
  const clearAuthMessage = auth?.clearMessage;
  const signOut = auth?.signOut;
  const {
    bootstrap,
    confirmLocalTransition,
    dismissNotice,
    isLoading,
    isTransitioning,
    displayName,
    latestSettledDate,
    legacySavePresent,
    message,
    nextGameDate,
    noticeTone,
    players,
    refreshData,
    serverError,
    state,
    transitionError,
    transitionRequired,
  } = usePortfolio();
  const seasonLabel = seasonLabelFor(latestSettledDate ?? nextGameDate);
  const ready = Boolean(state && !isLoading && !serverError && !transitionRequired && !isTransitioning);
  useEffect(() => {
    if (isMockActive()) setPracticeProgress(practiceHasProgress(bootstrap));
  }, [bootstrap]);

  const body = (() => {
    if (isLoading) {
      return (
        <CenteredState
          busy
          copy="Loading your roster, per-game market, and P&L from the server."
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
          copy={serverError ?? 'The server did not return a usable per-game account snapshot.'}
          onAction={() => {
            refreshData();
          }}
          title="Per-game market unavailable"
        />
      );
    }
    return (
      <>
        {activeTab === 'portfolio' && (
          <PortfolioScreen
            onOpenMarket={(side) => {
              setMarketSide(side);
              pushTab('market');
              setActiveTab('market');
            }}
          />
        )}
        {activeTab === 'market' && <MarketScreen initialSide={marketSide} />}
        {activeTab === 'plays' && <PlaysScreen />}
        {activeTab === 'leaderboard' && <LeaderboardScreen />}
      </>
    );
  })();

  const tabIndexOf = (tab: Tab) => tabs.findIndex((item) => item.key === tab);
  const onTabKeyDown = (event: { key: string; preventDefault: () => void }) => {
    const index = tabIndexOf(activeTab);
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    changeTab(tabs[next].key);
    (tabRefs.current[next] as unknown as { focus?: () => void } | null)?.focus?.();
  };

  const renderTabBar = (position: 'top' | 'bottom') => (
    <View role="navigation">
      <View
        accessibilityLabel="Sections"
        accessibilityRole="tablist"
        style={[styles.tabBar, position === 'top' ? styles.tabBarTop : { paddingBottom: insets.bottom + (short ? 0 : 9) }]}
        {...({ onKeyDown: onTabKeyDown } as object)}
      >
        {tabs.map((tab, index) => {
          const active = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              accessibilityLabel={tab.label}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              aria-controls="app-screen"
              aria-selected={active}
              onPress={() => changeTab(tab.key)}
              {...({
                tabIndex: active ? 0 : -1,
                onKeyDown: (event: { key: string; preventDefault: () => void }) => {
                  if (event.key === ' ' || event.key === 'Spacebar') {
                    event.preventDefault();
                    changeTab(tab.key);
                  }
                },
              } as object)}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
            >
              {/* Gold rule marks the active tab, matching the underline treatment
                  on the databallr.com nav. It sits on the edge nearest the
                  content: below the labels when the bar is on top, above when
                  the bar is at the bottom. */}
              <View style={[styles.tabMarker, position === 'top' && styles.tabMarkerBottomEdge, active && styles.tabMarkerActive]} />
              <Text
                maxFontSizeMultiplier={1.5}
                numberOfLines={1}
                style={[styles.tabText, narrow && styles.tabTextNarrow, active && styles.activeTabText]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View nativeID="app-root" style={styles.app}>
      <StatusBar style="light" />
      <AmbientFields />
      <VariantTexture />
      <SkipLink />
      {/* Databallr brand bar: gold wordmark, a rule, then the product name.
          In a short window it folds away; the status row carries Settings. */}
      {short ? null : (
      <View role="banner" style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <View style={styles.mark}>
          <Text accessibilityElementsHidden aria-hidden importantForAccessibility="no" maxFontSizeMultiplier={1.2} style={styles.markText}>d</Text>
        </View>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.brand}>databallr</Text>
        {/* On a very narrow screen the wordmark keeps the room; the product
            name is also the page title, so nothing is lost. */}
        {brandOnly ? <View style={styles.brandCopy} /> : (
          <>
            <View style={styles.brandDivider} />
            <View style={styles.brandCopy}>
              <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.product}>STOCK MARKET</Text>
            </View>
          </>
        )}
        <SettingsButton onPress={() => setSettingsOpen(true)} />
      </View>
      )}
      {ready && wide ? renderTabBar('top') : null}
      <View accessibilityLabel="Season and practice controls" role="region">
        {ready ? <SeasonControl /> : null}
        {ready ? <SimBar /> : null}
      </View>
      <View style={styles.stage}>
        {/* nativeID lets the QA harness measure how much chrome sits above the
            content on each tab (the content-first budget in the design doc).
            It is also the skip link's target. */}
        <View nativeID="app-screen" role="main" style={styles.screen} {...({ tabIndex: -1 } as object)}>{body}</View>
        {authError && clearAuthMessage ? (
          <NoticeToast message={authError} onDismiss={clearAuthMessage} tone="problem" />
        ) : message ? (
          <NoticeToast message={message} onDismiss={dismissNotice} tone={noticeTone} />
        ) : appNotice ? (
          <NoticeToast message={appNotice} onDismiss={() => setAppNotice(null)} tone="success" />
        ) : null}
      </View>
      {/* Mounted for the life of the app so a new notice is a change inside an
          existing live region; many screen readers skip text that arrives
          together with a brand-new region. */}
      <View accessibilityLiveRegion="polite" style={visuallyHidden}>
        <Text>{spoken(authError ?? message ?? appNotice ?? '')}</Text>
      </View>
      {ready ? (wide ? null : renderTabBar('bottom')) : null}
      <SettingsSheet
        listedPlayers={players.length}
        ruleset={bootstrap?.ruleset}
        // The treatments gallery renders design samples from the old share
        // market; it is a design-review tool, so Settings only links to it
        // when the page is opened with ?treatments.
        onOpenTreatments={!treatmentsRequested() ? undefined : () => {
          window.location.assign(treatmentNavigation(window.location.href).galleryUrl);
        }}
        onClose={() => setSettingsOpen(false)}
        profile={
          auth?.user
            ? {
                displayName: displayName ?? auth.user.email ?? 'Your account',
                email: auth.user.email ?? null,
                provider: auth.user.app_metadata?.provider ?? null,
                memberSince: auth.user.created_at ? humanDateWithYear(auth.user.created_at) : null,
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

function AuthenticatedRuntime({ config }: { config: PublicAppConfig }) {
  const { getAccessToken, isLoading, user } = useAuth();
  const client = useMemo(() => new MarketApiClient({
    baseUrl: config.apiUrl,
    apiPrefix: config.apiPrefix,
    expectedUserId: user?.id ?? '',
    getAccessToken,
  }), [config.apiPrefix, config.apiUrl, getAccessToken, user?.id]);

  if (isLoading) {
    return (
      <CenteredState
        busy
        copy="Restoring your saved sign-in securely."
        title="Checking your session"
      />
    );
  }
  if (!user) return <AuthScreen />;
  return (
    <PortfolioProvider apiClient={client} key={user.id} userId={user.id}>
      <AppBody />
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

/**
 * /treatments (or any URL carrying ?design) renders the design gallery instead
 * of the app, so every variant can be reviewed side by side at a stable URL.
 */
function isDesignPreviewRoute(): boolean {
  return typeof window !== 'undefined' && treatmentNavigation(window.location.href).isPreview;
}

/**
 * `?mock` runs the complete app shell against the in-memory sandbox market —
 * the date sim: advance nights, lock costs, collect dividends — with no
 * backend or sign-in. Like `?design`, it is an explicit opt-in URL; the
 * default production route below stays authenticated, fail-closed Flask, and
 * the sandbox labels itself in the season strip.
 */
function isMockPreviewRoute(): boolean {
  if (typeof window === 'undefined') return false;
  // Forgive the ways people type it: ?MOCK, ?mock/, ?mock%20, ?Mock=1.
  return [...new URLSearchParams(window.location.search).keys()]
    .some((key) => key.trim().toLowerCase().replace(/\/+$/, '') === 'mock');
}

/** Whether this practice season has anything a reload would throw away. */
function practiceHasProgress(snapshot: { game: { lastSettledDate: string | null }; positions: unknown[]; ledger: { items: unknown[] } } | null): boolean {
  if (!snapshot) return false;
  const start = mockSeasonStart();
  return snapshot.positions.length > 0
    || snapshot.ledger.items.length > 0
    || (start !== null && snapshot.game.lastSettledDate !== start);
}

function MockPreviewRuntime() {
  const client = mockPerGameClient() as unknown as MarketApiClient;
  return (
    <PortfolioProvider apiClient={client} key="mock-preview" userId="mock-preview">
      <AppBody />
    </PortfolioProvider>
  );
}

export default function App() {
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
  if (isMockPreviewRoute()) {
    return (
      <ThemeProvider>
        <SafeAreaProvider style={styles.provider}>
          <MockPreviewRuntime />
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }
  const configResult = resolvePublicAppConfig();
  return (
    <ThemeProvider>
      <SafeAreaProvider style={styles.provider}>
        <StatusBar style="light" />
        {configResult.config ? (
          <ConfiguredApp config={configResult.config} />
        ) : (
          <CenteredState
            actionLabel="Back to practice"
            brand
            copy="The live market (real NBA games and a saved account) isn't set up on this device yet. Practice works anywhere: it plays a generated season in this browser."
            details={`For developers: ${configResult.error} Set the public API URL, API prefix, and Supabase auth configuration before starting Expo.`}
            onAction={() => {
              window.location.search = '?mock';
            }}
            heading="The live market isn't available here yet"
            title="App configuration missing"
          />
        )}
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
    pointerEvents: 'none',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  texture: {
    pointerEvents: 'none',
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
    // Wide enough for the roster's two columns and the market table to
    // breathe on a laptop; beyond this lines get too long to scan.
    maxWidth: 1200,
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
    paddingBottom: space.xs,
    backgroundColor: colors.chrome,
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
  // The toast floats over the bottom of the screen; the layer itself lets
  // taps through so only the toast catches them.
  noticeLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: space.md,
    alignItems: 'center',
    paddingHorizontal: space.md,
    pointerEvents: 'box-none',
  },
  noticeLayerTop: {
    top: space.md,
    bottom: undefined,
  },
  notice: {
    width: '100%',
    maxWidth: 560,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.md,
    paddingRight: space.xs,
    paddingVertical: space.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
    borderWidth: 1,
  },
  noticeProblem: {
    backgroundColor: colors.goldSoft,
    borderColor: colors.gold,
  },
  skipLink: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    zIndex: 10,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.gold,
  },
  skipLinkHidden: {
    minHeight: 0,
    paddingHorizontal: 0,
  },
  skipLinkText: {
    color: colors.onGold,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: '800',
  },
  stateAction: {
    marginTop: space.lg,
  },
  stateBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.xl,
  },
  stateDetailsBox: {
    marginTop: space.lg,
    alignItems: 'center',
  },
  stateDetails: {
    maxWidth: 420,
    marginTop: space.lg,
    color: colors.faint,
    fontSize: type.caption,
    lineHeight: 17,
    textAlign: 'center',
  },
  // The toast is where "LeBron James added at $105K a game" lands — body size,
  // not fine print: it is the confirmation the player tapped for.
  noticeText: {
    flex: 1,
    color: colors.text,
    fontSize: type.body,
    lineHeight: 18,
    fontWeight: '700',
  },
  noticeDismiss: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeClose: {
    color: colors.goldInk,
    fontSize: type.label,
    fontWeight: '900',
  },
  stage: {
    flex: 1,
    minHeight: 0,
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
    paddingHorizontal: 1,
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
  tabTextNarrow: {
    fontSize: type.label,
  },
  activeTabText: {
    color: colors.goldInk,
  },
  pressed: {
    opacity: 0.65,
  },
});
