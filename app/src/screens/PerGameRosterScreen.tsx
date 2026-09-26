import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import type { PerGamePosition } from '../api/contracts';
import { isMockActive, mockPlayerTrends, mockSeasonStart } from '../api/mockPerGameClient';
import { PerGamePnlChart } from '../components/PerGamePnlChart';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { PlayerProfileSheet } from '../components/PlayerProfileSheet';
import { ClosedSection, FeesLine } from '../components/roster/ClosedSection';
import {
  FigureLegend,
  ListFigures,
  StackedFigures,
  TableFigures,
  TableHeader,
} from '../components/roster/RowFigures';
import { ScoreHeader } from '../components/roster/ScoreHeader';
import { SeasonCompleteCard, SeasonSoFar, WelcomeCard } from '../components/roster/SeasonCards';
import { SectionHead } from '../components/roster/SectionHead';
import {
  closeActionName,
  closeVerb,
  confirmCloseButton,
  confirmCloseMessage,
  exactMoney,
  exactSignedMoney,
  perGame,
  ROSTER_EXPLAINER,
  rosterReopensLine,
  SHORT_EXPLAINER,
  sideHeading,
  unbrokenName,
} from '../copy/terms';
import { keepTogether, practiceProgress } from '../data/chromeView';
import { isSeasonOver } from '../data/marketView';
import { recentEarnings, scoreBreakdown, seasonSummary } from '../data/perGameMetrics';
import {
  breakdownParts,
  breakdownPrecision,
  closedRows,
  feeMoves,
  rankLine,
  rosterRowView,
  rowLayout,
  shortEndsNext,
  slotLine,
  type ClosedRow,
  type RowLayout,
} from '../data/rosterView';
import { usePerGame } from '../state/PerGameContext';
import { openRules } from '../state/uiActions';
import { colors, control, fonts, radius, space, type, weight } from '../theme';
import { Button, ConfirmStrip, EmptyState, headingLevel, Tag, useAriaDisabled, visuallyHidden } from '../ui/kit';
import { restartPractice } from '../web/practiceSession';

/** Desktop: score and chart beside the lists. */
const WIDE_MIN_WIDTH = 1024;
/** The score column; narrower on small laptops so the table keeps room for names. */
const summaryWidth = (width: number) => (width >= 1200 ? 360 : 320);
const ACTION_WIDTH = 72;
/** A second press on Drop this soon after it opened the confirm is a double tap: ignored. */
const DOUBLE_TAP_MS = 400;
/** Phone lists narrower than this leave out Profit a game (see `StackedFigures`). */
const NARROW_LIST_MAX_WIDTH = 380;

/**
 * The welcome stays hidden for the rest of this practice season once the
 * player closes it. Practice itself lives in memory and starts over on
 * reload, and so does this.
 */
let welcomeHidden = false;

type FocusTarget = {
  focus?: (options?: { preventScroll?: boolean }) => void;
  setAttribute?: (name: string, value: string) => void;
  hasAttribute?: (name: string) => boolean;
};

/**
 * Move keyboard focus to a rendered element (web). A heading gets
 * tabindex="-1" first, so it can hold focus without becoming a Tab stop.
 */
function focusElement(node: unknown, options?: { preventScroll?: boolean }) {
  const element = node as FocusTarget | null | undefined;
  if (!element?.focus) return;
  if (element.hasAttribute && element.setAttribute && !element.hasAttribute('tabindex')) {
    element.setAttribute('tabindex', '-1');
  }
  element.focus(options);
}

type ConfirmOutcome = 'kept' | 'closed';

function PositionRow({
  position,
  layout,
  narrow,
  seasonOver,
  onOpenProfile,
  confirming,
  onConfirmOpen,
  onConfirmClose,
  actionRef,
  marketPrice,
}: {
  position: PerGamePosition;
  layout: RowLayout;
  /** A phone list under 380 CSS px: three figures instead of four. */
  narrow: boolean;
  seasonOver: boolean;
  onOpenProfile: (playerId: string) => void;
  /** This row's Drop/Close question is open. */
  confirming: boolean;
  onConfirmOpen: (position: PerGamePosition) => void;
  onConfirmClose: (position: PerGamePosition, outcome: ConfirmOutcome) => void;
  actionRef: (node: View | null) => void;
  /** His price a game in the market today, when he is listed. */
  marketPrice: number | null;
}) {
  const { bootstrap, pendingActions } = usePerGame();
  const actionKey = `position:${position.side}:${position.playerId}`;
  const pending = pendingActions.has(actionKey);
  const locked = pendingActions.has('account-mutation');
  const rosterLocked = bootstrap?.ruleset.rosterMutationsLocked ?? true;
  const rosterLockDate = bootstrap?.ruleset.rosterLockGameDate ?? null;
  const nextGameDate = bootstrap?.game.nextGameDate ?? null;
  const rosterLockHint = `${rosterReopensLine(rosterLockDate)}.`;
  const disabled = pending || locked || rosterLocked;
  // The button stays enabled for the browser, so a tap on LOCKED or on a
  // pending Drop is caught here instead of falling through to the row (which
  // would open the profile); its disabled state is written for assistive tech.
  const ownAction = useRef<View | null>(null);
  useAriaDisabled(ownAction, disabled);
  const setActionRef = useCallback((node: View | null) => {
    ownAction.current = node;
    actionRef(node);
  }, [actionRef]);
  const openedAt = useRef(0);
  useEffect(() => {
    if (confirming) openedAt.current = Date.now();
  }, [confirming]);
  // A lock that begins while the question is open would refuse its answer.
  useEffect(() => {
    if (confirming && rosterLocked) onConfirmClose(position, 'kept');
  }, [confirming, onConfirmClose, position, rosterLocked]);

  const settled = bootstrap?.settledResults;
  const view = useMemo(
    () => rosterRowView(position, settled ?? [], nextGameDate),
    [nextGameDate, position, settled],
  );
  const short = position.side === 'short';
  const verb = closeVerb(position.side);
  const fee = bootstrap?.ruleset.transactionFeeDollars ?? 0;
  const actionName = closeActionName(position.side, position.playerName);
  const endsNext = shortEndsNext(position, nextGameDate);
  const priceMoved = marketPrice !== null && Math.round(marketPrice) !== Math.round(position.lockedGameCost);

  // Screen readers hear the whole row in one breath, lifetime totals included.
  const profileLabel = [
    position.playerName,
    view.tag.label,
    short
      ? `credited ${exactMoney(position.lockedGameCost)} a game, set when you shorted him`
      : `price ${exactMoney(position.lockedGameCost)} a game, set when you added him`,
    priceMoved ? `market price now ${exactMoney(marketPrice as number)} a game` : null,
    view.games || 'no games yet',
    view.summary.avgDividend === null ? null : `dividend ${exactMoney(view.summary.avgDividend)} a game`,
    view.summary.avgNet === null ? null : `profit ${exactSignedMoney(view.summary.avgNet)} a game`,
    `total ${exactSignedMoney(position.cumulativePnl)}`,
    short
      ? `${exactMoney(position.cumulativeGameCost)} credited and ${exactMoney(position.cumulativeDividend)} in his dividends`
      : `${exactMoney(position.cumulativeDividend)} in dividends against ${exactMoney(position.cumulativeGameCost)} in prices`,
    view.expiry ? view.expiry.replace(/ · /g, ', ') : null,
    'View profile',
  ].filter(Boolean).join(', ');

  const identity = (
    <View style={styles.identity}>
      {/* A table row keeps one line; a long name ends in an ellipsis (its
          full name is in the row's spoken label). */}
      <Text numberOfLines={layout === 'table' ? 1 : undefined} style={styles.name}>
        {unbrokenName(position.playerName)}
      </Text>
      <View style={styles.meta}>
        <Tag tone={view.tag.tone}>{view.tag.label}</Tag>
        {view.games ? <Text style={styles.metaText}>{keepTogether(view.games)}</Text> : null}
        {view.expiry ? view.expiry.split(' · ').map((part) => (
          <Text key={part} style={[styles.metaText, endsNext && styles.metaEnds]}>
            {part.length <= 14 ? keepTogether(part) : part}
          </Text>
        )) : null}
      </View>
    </View>
  );
  const figures = {
    side: position.side,
    price: position.lockedGameCost,
    dividend: view.summary.avgDividend,
    net: view.summary.avgNet,
    total: position.cumulativePnl,
    now: marketPrice,
  };
  const onActionPress = () => {
    if (disabled) return;
    if (!confirming) {
      onConfirmOpen(position);
      return;
    }
    // A double tap's second press lands here: it must not close the
    // question the first press just opened.
    if (Date.now() - openedAt.current < DOUBLE_TAP_MS) return;
    onConfirmClose(position, 'kept');
  };
  // At season end there is nothing left to do with a row, so no button.
  const action = seasonOver ? null : (
    <Pressable
      ref={setActionRef}
      accessibilityHint={rosterLocked ? rosterLockHint : undefined}
      // react-native-web drops accessibilityHint, so the name carries the reason.
      accessibilityLabel={rosterLocked
        ? `${actionName} unavailable. ${rosterLockHint}`
        : pending ? (short ? `Closing your short on ${position.playerName}` : `Dropping ${position.playerName}`)
          : actionName}
      accessibilityRole="button"
      // A locked button stays in the Tab order (aria-disabled only), so a
      // keyboard or screen-reader user reaches it and hears why.
      accessibilityState={{ disabled }}
      aria-expanded={confirming}
      onPress={onActionPress}
      style={({ pressed }) => [
        styles.action,
        confirming && styles.actionArmed,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {pending && !rosterLocked ? (
        <ActivityIndicator color={colors.muted} size="small" />
      ) : (
        <Text style={[styles.actionText, confirming && styles.actionTextArmed]}>
          {rosterLocked ? 'LOCKED' : verb.toUpperCase()}
        </Text>
      )}
    </Pressable>
  );
  // The question opens under the row, never on the button itself: the
  // costly answer sits away from where Drop was, Keep takes focus, and
  // Escape or Keep backs out. Nothing times out while you read it.
  const strip = confirming ? (
    <ConfirmStrip
      confirmAccessibilityLabel={fee > 0 ? `${actionName} for ${exactMoney(fee)}` : actionName}
      confirmLabel={confirmCloseButton(position.side, fee)}
      message={confirmCloseMessage({
        side: position.side,
        playerName: position.playerName,
        feeDollars: fee,
        total: position.cumulativePnl,
        endsFreeAfter: endsNext ? position.expiresOn : null,
        priceNow: marketPrice,
      })}
      onCancel={() => onConfirmClose(position, 'kept')}
      onConfirm={() => onConfirmClose(position, 'closed')}
      style={styles.strip}
    />
  ) : null;
  const profileProps = {
    accessibilityLabel: profileLabel,
    accessibilityRole: 'button' as const,
    onPress: () => onOpenProfile(position.playerId),
  };

  if (layout === 'table') {
    return (
      <View style={styles.tableItem}>
        <View style={styles.tableRow}>
          <Pressable {...profileProps} style={({ pressed }) => [styles.tableProfile, pressed && styles.pressed]}>
            <PlayerAvatar player={{ id: position.playerId, name: position.playerName }} size={36} />
            {identity}
            <TableFigures {...figures} />
          </Pressable>
          {/* The header reserves the action column; keep the totals under it. */}
          {action ?? <View style={{ width: ACTION_WIDTH }} />}
        </View>
        {strip}
      </View>
    );
  }

  if (layout === 'compact') {
    // Nothing shares a line it cannot fit on: the name takes the full width
    // (no headshot, no space held for the button), the figures list one a
    // line, and Drop sits below them.
    return (
      <View style={styles.compactRow}>
        <Pressable {...profileProps} style={({ pressed }) => [styles.compactProfile, pressed && styles.pressed]}>
          {identity}
          <View style={styles.compactFigures}>
            <ListFigures {...figures} />
          </View>
        </Pressable>
        {action ? <View style={styles.compactAction}>{action}</View> : null}
        {strip}
      </View>
    );
  }

  return (
    <View style={styles.stackRow}>
      <Pressable {...profileProps} style={({ pressed }) => [styles.stackProfile, pressed && styles.pressed]}>
        <View style={[styles.stackTop, action ? null : styles.stackTopFull]}>
          <PlayerAvatar player={{ id: position.playerId, name: position.playerName }} size={36} />
          {identity}
        </View>
        <View style={styles.stackFigures}>
          <StackedFigures {...figures} narrow={narrow} />
        </View>
      </Pressable>
      {action ? <View style={styles.stackAction}>{action}</View> : null}
      {strip}
    </View>
  );
}

/**
 * "Short again" on a short that ran its term: the same player at today's
 * price, one tap, as the market's Short button would. Unavailable (with the
 * reason in its name) while roster moves are locked or the shorts are full.
 */
function ShortAgainButton({ row, price, quoteVersion, reason, onShorted }: {
  row: ClosedRow;
  price: number;
  quoteVersion: number;
  /** Why it cannot be pressed right now, or null. */
  reason: string | null;
  onShorted: (playerId: string) => void;
}) {
  const { bootstrap, openPosition, pendingActions } = usePerGame();
  const pending = pendingActions.has(`position:short:${row.playerId}`);
  const busy = pendingActions.has('account-mutation');
  const fee = bootstrap?.ruleset.transactionFeeDollars ?? 0;
  const name = `Short ${row.name} again at ${perGame(price)}${fee > 0 ? `, ${exactMoney(fee)} fee` : ''}`;
  return (
    <Button
      accessibilityHint={reason ?? undefined}
      accessibilityLabel={pending ? `Shorting ${row.name}` : name}
      disabled={reason !== null || pending || busy}
      focusableWhenDisabled
      label={pending ? 'Shorting…' : 'Short again'}
      onPress={() => {
        void openPosition({
          playerId: row.playerId,
          playerName: row.name,
          side: 'short',
          expectedQuoteVersion: quoteVersion,
        }).then((ok) => {
          if (ok) onShorted(row.playerId);
        });
      }}
    />
  );
}

export function PerGameRosterScreen({
  onOpenMarket,
}: {
  onOpenMarket: (side: PerGamePosition['side']) => void;
}) {
  const { bootstrap, closePosition } = usePerGame();
  const { width, fontScale } = useWindowDimensions();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [listWidth, setListWidth] = useState<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [welcomeClosed, setWelcomeClosed] = useState(welcomeHidden);
  const actionRefs = useRef(new Map<string, View>());
  const rosterHeading = useRef<Text>(null);
  const shortsHeading = useRef<Text>(null);
  const latest = useRef(bootstrap);
  latest.current = bootstrap;

  const recent = useMemo(
    () => recentEarnings(bootstrap?.ledger.items, bootstrap?.game.lastSettledDate),
    [bootstrap?.game.lastSettledDate, bootstrap?.ledger.items],
  );
  const breakdown = useMemo(
    () => scoreBreakdown(
      bootstrap?.account.cumulativePnl ?? 0,
      bootstrap?.positions ?? [],
      bootstrap?.ledger.items ?? [],
    ),
    [bootstrap?.account.cumulativePnl, bootstrap?.ledger.items, bootstrap?.positions],
  );
  const closed = useMemo(
    () => closedRows(bootstrap?.positions ?? [], bootstrap?.ledger.items ?? [], bootstrap?.settledResults ?? []),
    [bootstrap?.ledger.items, bootstrap?.positions, bootstrap?.settledResults],
  );
  const season = useMemo(
    () => seasonSummary({
      score: bootstrap?.account.cumulativePnl ?? 0,
      positions: bootstrap?.positions ?? [],
      ledger: bootstrap?.ledger.items ?? [],
      leaderboard: bootstrap?.leaderboard ?? [],
    }),
    [bootstrap?.account.cumulativePnl, bootstrap?.leaderboard, bootstrap?.ledger.items, bootstrap?.positions],
  );
  const market = useMemo(
    () => new Map((bootstrap?.market ?? []).map((row) => [row.playerId, row])),
    [bootstrap?.market],
  );

  const onConfirmOpen = useCallback((position: PerGamePosition) => {
    setConfirmingId(position.positionId);
  }, []);
  const onConfirmClose = useCallback((position: PerGamePosition, outcome: ConfirmOutcome) => {
    setConfirmingId((current) => (current === position.positionId ? null : current));
    if (outcome === 'kept') {
      focusElement(actionRefs.current.get(position.positionId));
      return;
    }
    // Focus moves on before the row goes: to the next row's button, or to
    // the list's heading when this was the last row.
    const list = (latest.current?.positions ?? []).filter(
      (row) => row.status === 'active' && row.side === position.side,
    );
    const index = list.findIndex((row) => row.positionId === position.positionId);
    const next = index >= 0 ? list[index + 1] : undefined;
    focusElement(next
      ? actionRefs.current.get(next.positionId)
      : (position.side === 'long' ? rosterHeading.current : shortsHeading.current));
    void closePosition(position);
  }, [closePosition]);
  const actionRef = useCallback((positionId: string) => (node: View | null) => {
    if (node) actionRefs.current.set(positionId, node);
    else actionRefs.current.delete(positionId);
  }, []);
  // After "Short again", focus lands on the new short's Close button.
  const onShorted = useCallback((playerId: string) => {
    setTimeout(() => {
      const fresh = (latest.current?.positions ?? []).find(
        (row) => row.status === 'active' && row.side === 'short' && row.playerId === playerId,
      );
      focusElement(fresh ? actionRefs.current.get(fresh.positionId) : shortsHeading.current);
    }, 60);
  }, []);

  if (!bootstrap) return null;
  const profilePosition = profileId
    ? bootstrap.positions.find(
      (row) => row.playerId === profileId && row.status === 'active',
    ) ?? null
    : null;
  const profilePlayer = profileId
    ? bootstrap.market.find((row) => row.playerId === profileId)
      ?? (profilePosition
        ? {
            playerId: profilePosition.playerId,
            name: profilePosition.playerName,
            tier: '',
            quoteVersion: 0,
            currentGameCost: profilePosition.lockedGameCost,
            priorSeasonValuePerGame: null,
          }
        : null)
    : null;
  const profileResults = profileId
    ? bootstrap.settledResults.filter((result) => result.playerId === profileId)
    : [];
  const active = bootstrap.positions.filter((position) => position.status === 'active');
  const longs = active.filter((position) => position.side === 'long');
  const shorts = active.filter((position) => position.side === 'short');
  const score = bootstrap.account.cumulativePnl;
  const started = bootstrap.ledger.items.some((entry) => entry.gameDate !== null);
  const rosterLocked = bootstrap.ruleset.rosterMutationsLocked;
  const rosterLockDate = bootstrap.ruleset.rosterLockGameDate;
  const practice = isMockActive();
  // One rule with the Market: practice ends on its last day, a live season
  // when games have settled and none are left.
  const seasonOver = isSeasonOver({
    practiceComplete: practice && practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).complete,
    lastSettledDate: bootstrap.game.lastSettledDate,
    nextGameDate: bootstrap.game.nextGameDate,
  });
  // The welcome stays until a player of yours has played a game (not just
  // until a night passes): +1 night with an empty roster must not skip it.
  const openingEve = practice && !seasonOver && !started;
  const showWelcome = openingEve && !welcomeClosed;
  const hideWelcome = () => {
    welcomeHidden = true;
    setWelcomeClosed(true);
    focusElement(rosterHeading.current, { preventScroll: true });
  };
  const wide = width >= WIDE_MIN_WIDTH;
  const layout = rowLayout(listWidth ?? (wide ? width - summaryWidth(width) : width), width, fontScale);
  const narrow = layout === 'stacked' && (listWidth ?? width) < NARROW_LIST_MAX_WIDTH;
  const totalInset = layout === 'table' ? ACTION_WIDTH + space.sm : 0;
  const hadLongs = bootstrap.positions.some((position) => position.side === 'long' && position.status === 'closed');
  const hadShorts = bootstrap.positions.some((position) => position.side === 'short' && position.status === 'closed');
  const { longSlots, shortSlots } = bootstrap.account;
  const lockLine = rosterLocked ? `${rosterReopensLine(rosterLockDate)}.` : null;
  // Why Drop and Close are unavailable, in words on the screen (not only in a
  // hint react-native-web drops).
  const actionNote = seasonOver ? 'The season is over. Your roster is final.' : lockLine ?? undefined;
  const parts = bootstrap.ledger.items.length > 0 ? breakdownParts(breakdown) : null;
  // One precision for every figure in the statement, the least at which the
  // parts, as shown, add up to the hero figure.
  const precision = parts ? breakdownPrecision(parts.map((part) => part.value), score) : 'fine';
  const unplayed = closed.filter((row) => row.unplayed).length;
  const sticky = layout === 'stacked';
  const legend = (side: PerGamePosition['side']) => (
    layout === 'table' ? <TableHeader actionWidth={ACTION_WIDTH} side={side} />
      : layout === 'stacked' ? <FigureLegend narrow={narrow} side={side} /> : null
  );
  const rows = (positions: PerGamePosition[]) => positions.map((position) => (
    <PositionRow
      key={position.positionId}
      actionRef={actionRef(position.positionId)}
      confirming={confirmingId === position.positionId}
      layout={layout}
      marketPrice={market.get(position.playerId)?.currentGameCost ?? null}
      narrow={narrow}
      onConfirmClose={onConfirmClose}
      onConfirmOpen={onConfirmOpen}
      onOpenProfile={setProfileId}
      position={position}
      seasonOver={seasonOver}
    />
  ));
  const onListLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setListWidth((current) => (current === next ? current : next));
  };

  // "Short again" goes on the latest closed row for a player whose short ran
  // its term, while he is not on either list again.
  const reshortable = new Set<string>();
  {
    const seen = new Set<string>();
    for (const row of closed) {
      if (seen.has(row.playerId)) continue;
      seen.add(row.playerId);
      if (row.endedByTerm) reshortable.add(row.positionId);
    }
  }
  const heldNow = new Set(active.map((position) => position.playerId));
  const shortReason = lockLine
    ?? (shortSlots.used >= shortSlots.limit ? 'Your shorts are full: close one to short again.' : null);
  const shortAgain = (row: ClosedRow) => {
    const listed = market.get(row.playerId);
    if (seasonOver || !reshortable.has(row.positionId) || heldNow.has(row.playerId) || !listed) return null;
    return (
      <ShortAgainButton
        onShorted={onShorted}
        price={listed.currentGameCost}
        quoteVersion={listed.quoteVersion}
        reason={shortReason}
        row={row}
      />
    );
  };

  const fee = bootstrap.ruleset.transactionFeeDollars;
  const opening = showWelcome ? (
    <WelcomeCard
      feeDollars={fee}
      hasPlayers={active.length > 0}
      nextGameDate={bootstrap.game.nextGameDate}
      onHide={hideWelcome}
      onOpenMarket={() => onOpenMarket('long')}
      onOpenRules={() => {
        openRules();
      }}
    />
  ) : seasonOver ? (
    <SeasonCompleteCard onPlayAgain={practice ? restartPractice : undefined} summary={season} />
  ) : null;

  const summary = (
    <>
      {wide ? null : opening}
      <ScoreHeader
        nextGameDate={bootstrap.game.nextGameDate}
        parts={parts}
        precision={precision}
        rank={started ? rankLine(bootstrap.leaderboard) : null}
        score={score}
        slots={wide ? slotLine(bootstrap.account) : null}
        started={started}
        title="Your score"
        variant={wide ? 'panel' : layout === 'compact' ? 'narrow' : 'compact'}
        week={recent ? recent.week : null}
      />
      {/* On the opening eve the welcome says what the empty chart would. */}
      {showWelcome ? null : (
        <PerGamePnlChart
          entries={bootstrap.ledger.items}
          // Phones keep the plot short so roster rows start high; wider lists
          // afford more, and desktop is capped so nightly swings stay readable.
          plotHeight={wide ? 208 : layout === 'table' ? 120 : 68}
        />
      )}
      {wide && started && !seasonOver ? <SeasonSoFar fees={breakdown.fees} summary={season} /> : null}
    </>
  );
  const lists = (
    <>
      {wide ? opening : null}
      <View style={styles.section}>
        <SectionHead
          count={`${longSlots.used} of ${longSlots.limit}`}
          headingRef={rosterHeading}
          legend={longs.length > 0 ? legend('long') : undefined}
          note={actionNote}
          precision={precision}
          sticky={sticky && longs.length > 0}
          title={sideHeading('long')}
          total={longs.length > 0 ? breakdown.roster : undefined}
          totalInset={totalInset}
          totalLabel="Roster total"
        />
        {longs.length > 0 ? rows(longs) : (
          <EmptyState
            // The welcome above already offers the market on the opening eve.
            action={showWelcome || seasonOver ? undefined : lockLine ? (
              <Button
                accessibilityLabel="Browse the player market"
                label="Browse the market"
                onPress={() => onOpenMarket('long')}
              />
            ) : (
              <Button
                accessibilityLabel="Open the player market"
                label="Open market"
                onPress={() => onOpenMarket('long')}
                variant="primary"
              />
            )}
            copy={seasonOver
              ? 'The season is over. There are no more players to add.'
              : lockLine ? `${lockLine} You can look around the market until then.` : ROSTER_EXPLAINER}
            style={styles.empty}
            title={hadLongs ? 'Your roster is empty' : 'Add your first player'}
          />
        )}
      </View>
      <View style={styles.section}>
        <SectionHead
          caption={shorts.length > 0 ? SHORT_EXPLAINER : undefined}
          count={`${shortSlots.used} of ${shortSlots.limit}`}
          headingRef={shortsHeading}
          legend={shorts.length > 0 ? legend('short') : undefined}
          precision={precision}
          sticky={sticky && shorts.length > 0}
          title={sideHeading('short')}
          total={shorts.length > 0 ? breakdown.shorts : undefined}
          totalInset={totalInset}
          totalLabel="Shorts total"
        />
        {shorts.length > 0 ? rows(shorts) : (
          <EmptyState
            // Once the season is over the market takes no new shorts, so the
            // empty section says so instead of sending you somewhere idle.
            // While moves are locked it says when shorts reopen and offers a
            // look at the market rather than a dead end.
            action={seasonOver ? undefined : (
              <Button
                accessibilityLabel={lockLine ? 'Browse shorts in the player market' : 'Find a short in the player market'}
                label={lockLine ? 'Browse shorts' : 'Find a short'}
                onPress={() => onOpenMarket('short')}
              />
            )}
            copy={seasonOver
              ? 'The season is over, so there are no more shorts to open.'
              : lockLine ? `${lockLine} ${SHORT_EXPLAINER}` : SHORT_EXPLAINER}
            style={styles.empty}
            title={hadShorts ? 'No open shorts' : 'No shorts yet'}
          />
        )}
      </View>
      <ClosedSection
        actionFor={shortAgain}
        precision={precision}
        rows={closed}
        total={breakdown.closed}
        totalInset={totalInset}
      />
      <FeesLine
        fees={breakdown.fees}
        moves={feeMoves(bootstrap.ledger.items)}
        precision={precision}
        totalInset={totalInset}
        unplayed={unplayed}
      />
    </>
  );

  return (
    <View style={styles.screen}>
      {/* The screen's title for screen readers (the tab bar names it on screen). */}
      <View style={visuallyHidden}>
        <Text accessibilityRole="header" {...headingLevel(1)}>Roster</Text>
      </View>
      {wide ? (
        <View style={styles.columns}>
          <ScrollView contentContainerStyle={styles.summaryContent} style={[styles.summaryColumn, { width: summaryWidth(width) }]}>
            {summary}
          </ScrollView>
          <ScrollView contentContainerStyle={styles.listContent} onLayout={onListLayout} style={styles.listColumn}>
            {lists}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent} onLayout={onListLayout} style={styles.scroll}>
          {summary}
          {lists}
        </ScrollView>
      )}
      <PlayerProfileSheet
        dividendRate={bootstrap.ruleset.dividendDollarsPerNetPoint}
        latestSettledDate={bootstrap.game.lastSettledDate}
        onClose={() => setProfileId(null)}
        player={profilePlayer}
        position={profilePosition}
        results={profileResults}
        trends={profileId !== null && isMockActive() ? mockPlayerTrends(profileId) : undefined}
        visible={profileId !== null && profilePlayer !== null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
  },
  scroll: {
    flex: 1,
  },
  columns: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
  },
  summaryColumn: {
    flexGrow: 0,
    flexShrink: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.borderStrong,
  },
  listColumn: {
    flex: 1,
  },
  summaryContent: {
    paddingBottom: space.xl,
  },
  listContent: {
    // Clears a problem notice, which stays over the bottom of the screen
    // until it is dismissed, so the last row is never stuck under it.
    paddingBottom: 110,
  },
  section: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  empty: {
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
  },
  stackRow: {
    position: 'relative',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  stackProfile: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  stackTop: {
    minHeight: control.height,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    // Keeps the name and verdict clear of the Drop button that sits over this corner.
    paddingRight: ACTION_WIDTH + space.sm,
  },
  stackTopFull: {
    paddingRight: 0,
  },
  stackFigures: {
    marginTop: 6,
  },
  stackAction: {
    position: 'absolute',
    top: space.sm,
    right: space.lg,
  },
  strip: {
    marginHorizontal: space.lg,
    marginBottom: space.sm,
  },
  compactRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingBottom: space.sm,
  },
  compactProfile: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  compactFigures: {
    marginTop: space.sm,
  },
  compactAction: {
    alignItems: 'flex-end',
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  tableItem: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: space.sm,
    paddingRight: space.lg,
  },
  tableProfile: {
    flex: 1,
    minWidth: 0,
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.lg,
    paddingVertical: space.sm,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    marginLeft: 4,
  },
  name: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  meta: {
    minHeight: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.sm,
    rowGap: 2,
    marginTop: 3,
  },
  metaText: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  metaEnds: {
    color: colors.goldInk,
  },
  action: {
    alignSelf: 'center',
    width: ACTION_WIDTH,
    minHeight: control.height,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    // Outlined, not filled: dropping is a secondary move on a row whose job
    // is to show how the player is doing.
    backgroundColor: 'transparent',
  },
  actionArmed: {
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
  },
  actionText: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.8,
  },
  actionTextArmed: {
    color: colors.goldInk,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.72,
  },
});
