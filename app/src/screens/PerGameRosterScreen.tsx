import { useEffect, useMemo, useState } from 'react';
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
import { SectionHead } from '../components/roster/SectionHead';
import {
  closeVerb,
  exactMoney,
  exactSignedMoney,
  humanDate,
  ROSTER_EXPLAINER,
  SHORT_EXPLAINER,
  sideHeading,
  signedMoneyFine,
  unbrokenName,
} from '../copy/terms';
import { keepTogether, practiceProgress } from '../data/chromeView';
import { recentEarnings, scoreBreakdown } from '../data/perGameMetrics';
import {
  breakdownParts,
  closedRows,
  feeMoves,
  rankLine,
  rosterRowView,
  rowLayout,
  slotLine,
  type RowLayout,
} from '../data/rosterView';
import { usePerGame } from '../state/PerGameContext';
import { colors, control, fonts, radius, space, type, weight } from '../theme';
import { Button, EmptyState, Tag, visuallyHidden } from '../ui/kit';

/** Desktop: score and chart beside the lists. */
const WIDE_MIN_WIDTH = 1024;
/** The score column; narrower on small laptops so the table keeps room for names. */
const summaryWidth = (width: number) => (width >= 1200 ? 360 : 320);
const ACTION_WIDTH = 72;
/** How long Drop and Close wait for the confirming second tap (as Restart does). */
const CONFIRM_MS = 4000;

function PositionRow({ position, layout, seasonOver, onOpenProfile }: {
  position: PerGamePosition;
  layout: RowLayout;
  seasonOver: boolean;
  onOpenProfile: (playerId: string) => void;
}) {
  const { bootstrap, closePosition, pendingActions } = usePerGame();
  const actionKey = `position:${position.side}:${position.playerId}`;
  const pending = pendingActions.has(actionKey);
  const locked = pendingActions.has('account-mutation');
  const rosterLocked = bootstrap?.ruleset.rosterMutationsLocked ?? true;
  const rosterLockDate = bootstrap?.ruleset.rosterLockGameDate ?? null;
  const rosterLockHint = rosterLockDate
    ? `Roster changes are locked for the ${humanDate(rosterLockDate)} games.`
    : 'Roster changes are locked while the current games are in progress.';
  const disabled = pending || locked || rosterLocked || seasonOver;
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return undefined;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);
  useEffect(() => {
    if (disabled) setConfirming(false);
  }, [disabled]);

  const settled = bootstrap?.settledResults;
  const view = useMemo(() => rosterRowView(position, settled ?? []), [position, settled]);
  const short = position.side === 'short';
  const verb = closeVerb(position.side);
  const target = short ? `short on ${position.playerName}` : position.playerName;
  const fee = bootstrap?.ruleset.transactionFeeDollars ?? 0;

  // Screen readers hear the whole row in one breath, lifetime totals included.
  const profileLabel = [
    position.playerName,
    view.tag.label,
    short
      ? `credited ${exactMoney(position.lockedGameCost)} a game, set when you shorted him`
      : `price ${exactMoney(position.lockedGameCost)} a game, set when you added him`,
    view.games || 'no games yet',
    view.summary.avgDividend === null ? null : `dividend ${exactMoney(view.summary.avgDividend)} a game`,
    view.summary.avgNet === null ? null : `net ${exactSignedMoney(view.summary.avgNet)} a game`,
    `total ${exactSignedMoney(position.cumulativePnl)}`,
    short
      ? `${exactMoney(position.cumulativeGameCost)} credited and ${exactMoney(position.cumulativeDividend)} in his dividends`
      : `${exactMoney(position.cumulativeDividend)} in dividends against ${exactMoney(position.cumulativeGameCost)} in prices`,
    view.expiry,
    'View profile',
  ].filter(Boolean).join(', ');

  // The second tap's consequence, shown in place of the verdict while armed
  // and spoken through the row's live region.
  const stays = `${short ? 'its' : 'his'} ${signedMoneyFine(position.cumulativePnl)} stays in your score`;
  const consequence = fee > 0 ? `${exactMoney(fee)} fee · ${stays}` : stays;
  const announcement = confirming
    ? `Tap Confirm to ${verb.toLowerCase()} ${target}. ${fee > 0 ? `A ${exactMoney(fee)} fee applies. ` : ''}`
      + `${short ? 'Its' : 'His'} ${exactSignedMoney(position.cumulativePnl)} so far stays in your score.`
    : '';

  const compact = layout === 'compact';
  const identity = (
    <View style={styles.identity}>
      <Text style={styles.name}>{unbrokenName(position.playerName)}</Text>
      <View style={styles.meta}>
        {confirming ? (
          <Text style={styles.confirmLine}>{consequence}</Text>
        ) : (
          <>
            <Tag tone={view.tag.tone}>{view.tag.label}</Tag>
            {view.games ? <Text style={styles.metaText}>{keepTogether(view.games)}</Text> : null}
            {view.expiry ? <Text style={styles.metaText}>{keepTogether(view.expiry)}</Text> : null}
          </>
        )}
      </View>
    </View>
  );
  const figures = {
    side: position.side,
    price: position.lockedGameCost,
    dividend: view.summary.avgDividend,
    net: view.summary.avgNet,
    total: position.cumulativePnl,
  };
  const action = (
    <Pressable
      accessibilityHint={rosterLocked ? rosterLockHint : undefined}
      accessibilityLabel={rosterLocked
        ? `${verb} ${target} unavailable while roster changes are locked`
        : seasonOver ? `${verb} ${target} unavailable: the season is over`
          : pending ? `${verb === 'Drop' ? 'Dropping' : 'Closing'} ${target}`
            : confirming ? `Confirm: ${verb.toLowerCase()} ${target}` : `${verb} ${target}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        if (disabled) return;
        if (!confirming) {
          setConfirming(true);
          return;
        }
        setConfirming(false);
        closePosition(position);
      }}
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
          {rosterLocked ? 'LOCKED' : confirming ? 'CONFIRM' : verb.toUpperCase()}
        </Text>
      )}
    </Pressable>
  );
  // Always mounted, so a confirm request is a change inside an existing live
  // region (react-native-web has no announceForAccessibility).
  const liveRegion = (
    <View accessibilityLiveRegion="polite" style={visuallyHidden}>
      <Text>{announcement}</Text>
    </View>
  );
  const profileProps = {
    accessibilityLabel: profileLabel,
    accessibilityRole: 'button' as const,
    onPress: () => onOpenProfile(position.playerId),
  };

  if (layout === 'table') {
    return (
      <View style={styles.tableRow}>
        <Pressable {...profileProps} style={({ pressed }) => [styles.tableProfile, pressed && styles.pressed]}>
          <PlayerAvatar player={{ id: position.playerId, name: position.playerName }} size={36} />
          {identity}
          <TableFigures {...figures} />
        </Pressable>
        {action}
        {liveRegion}
      </View>
    );
  }

  if (compact) {
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
        <View style={styles.compactAction}>{action}</View>
        {liveRegion}
      </View>
    );
  }

  return (
    <View style={styles.stackRow}>
      <Pressable {...profileProps} style={({ pressed }) => [styles.stackProfile, pressed && styles.pressed]}>
        <View style={styles.stackTop}>
          <PlayerAvatar player={{ id: position.playerId, name: position.playerName }} size={36} />
          {identity}
        </View>
        <View style={styles.stackFigures}>
          <StackedFigures {...figures} />
        </View>
      </Pressable>
      <View style={styles.stackAction}>{action}</View>
      {liveRegion}
    </View>
  );
}

export function PerGameRosterScreen({
  onOpenMarket,
}: {
  onOpenMarket: (side: PerGamePosition['side']) => void;
}) {
  const { bootstrap } = usePerGame();
  const { width, fontScale } = useWindowDimensions();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [listWidth, setListWidth] = useState<number | null>(null);
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
  // Practice ends on day 174; a live season ends when no games are left.
  const seasonOver = isMockActive()
    ? practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).complete
    : bootstrap.game.lastSettledDate !== null && bootstrap.game.nextGameDate === null;
  const wide = width >= WIDE_MIN_WIDTH;
  const layout = rowLayout(listWidth ?? (wide ? width - summaryWidth(width) : width), width, fontScale);
  const totalInset = layout === 'table' ? ACTION_WIDTH + space.sm : 0;
  const hadLongs = bootstrap.positions.some((position) => position.side === 'long' && position.status === 'closed');
  const hadShorts = bootstrap.positions.some((position) => position.side === 'short' && position.status === 'closed');
  const { longSlots, shortSlots } = bootstrap.account;
  // Why Drop and Close are unavailable, in words on the screen (not only in a
  // hint react-native-web drops).
  const actionNote = seasonOver
    ? 'The season is over. Your roster is final.'
    : rosterLocked
      ? `Locked until the ${rosterLockDate ? `${humanDate(rosterLockDate)} ` : 'current '}games settle.`
      : undefined;
  const legend = (side: PerGamePosition['side']) => (
    layout === 'table' ? <TableHeader actionWidth={ACTION_WIDTH} side={side} />
      : layout === 'stacked' ? <FigureLegend side={side} /> : null
  );
  const rows = (positions: PerGamePosition[]) => positions.map((position) => (
    <PositionRow
      key={position.positionId}
      layout={layout}
      onOpenProfile={setProfileId}
      position={position}
      seasonOver={seasonOver}
    />
  ));
  const onListLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setListWidth((current) => (current === next ? current : next));
  };

  const summary = (
    <>
      <ScoreHeader
        nextGameDate={bootstrap.game.nextGameDate}
        parts={bootstrap.ledger.items.length > 0 ? breakdownParts(breakdown) : null}
        rank={started ? rankLine(bootstrap.leaderboard) : null}
        score={score}
        slots={wide ? slotLine(bootstrap.account) : null}
        started={started}
        title="Your score"
        variant={wide ? 'panel' : layout === 'compact' ? 'narrow' : 'compact'}
        week={recent ? recent.week : null}
      />
      <PerGamePnlChart
        entries={bootstrap.ledger.items}
        // Phones keep the plot short so roster rows start high; wider lists
        // afford more, and desktop is capped so nightly swings stay readable.
        plotHeight={wide ? 208 : layout === 'table' ? 120 : 68}
      />
    </>
  );
  const lists = (
    <>
      <View style={styles.section}>
        <SectionHead
          count={`${longSlots.used} of ${longSlots.limit}`}
          legend={longs.length > 0 ? legend('long') : undefined}
          note={actionNote}
          title={sideHeading('long')}
          total={longs.length > 0 ? breakdown.roster : undefined}
          totalInset={totalInset}
          totalLabel="Roster total"
        />
        {longs.length > 0 ? rows(longs) : (
          <EmptyState
            action={(
              <Button
                accessibilityLabel="Open the player market"
                label="Open market"
                onPress={() => onOpenMarket('long')}
                variant="primary"
              />
            )}
            copy={ROSTER_EXPLAINER}
            style={styles.empty}
            title={hadLongs ? 'Your roster is empty' : 'Add your first player'}
          />
        )}
      </View>
      <View style={styles.section}>
        <SectionHead
          caption={shorts.length > 0 ? SHORT_EXPLAINER : undefined}
          count={`${shortSlots.used} of ${shortSlots.limit}`}
          legend={shorts.length > 0 ? legend('short') : undefined}
          title={sideHeading('short')}
          total={shorts.length > 0 ? breakdown.shorts : undefined}
          totalInset={totalInset}
          totalLabel="Shorts total"
        />
        {shorts.length > 0 ? rows(shorts) : (
          <EmptyState
            action={(
              <Button
                accessibilityLabel="Find a short in the player market"
                label="Find a short"
                onPress={() => onOpenMarket('short')}
              />
            )}
            copy={SHORT_EXPLAINER}
            style={styles.empty}
            title={hadShorts ? 'No open shorts' : 'No shorts yet'}
          />
        )}
      </View>
      <ClosedSection rows={closed} total={breakdown.closed} totalInset={totalInset} />
      <FeesLine fees={breakdown.fees} moves={feeMoves(bootstrap.ledger.items)} totalInset={totalInset} />
    </>
  );

  return (
    <View style={styles.screen}>
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
  stackFigures: {
    marginTop: 6,
  },
  stackAction: {
    position: 'absolute',
    top: space.sm,
    right: space.lg,
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
  tableRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: space.sm,
    paddingRight: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  tableProfile: {
    flex: 1,
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
  confirmLine: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
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
