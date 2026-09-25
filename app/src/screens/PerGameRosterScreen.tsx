import { useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import type { PerGamePosition } from '../api/contracts';
import { isMockActive, mockPlayerTrends } from '../api/mockPerGameClient';
import { PerGamePnlChart } from '../components/PerGamePnlChart';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { PlayerProfileSheet } from '../components/PlayerProfileSheet';
import { StackedFigures, TableFigures, TableHeader } from '../components/roster/RowFigures';
import { ScoreHeader } from '../components/roster/ScoreHeader';
import {
  closeVerb,
  exactMoney,
  exactSignedMoney,
  humanDate,
  ROSTER_EXPLAINER,
  SHORT_EXPLAINER,
  sideHeading,
} from '../copy/terms';
import { recentEarnings } from '../data/perGameMetrics';
import { rankLine, rosterRowView, slotLine } from '../data/rosterView';
import { usePerGame } from '../state/PerGameContext';
import { scoreComponents } from '../state/perGameScoreComponents';
import { colors, control, fonts, radius, space, type, weight } from '../theme';
import { Button, EmptyState, SectionHeader, Tag } from '../ui/kit';

/** Desktop: score and chart beside the lists. */
const WIDE_MIN_WIDTH = 1024;
/** Lists at least this wide read as a table with a header row. */
const TABLE_MIN_WIDTH = 700;
const SUMMARY_WIDTH = 340;
const ACTION_WIDTH = 72;

function PositionRow({ position, table, largeText, onOpenProfile }: {
  position: PerGamePosition;
  table: boolean;
  largeText: boolean;
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
  const disabled = pending || locked || rosterLocked;
  const settled = bootstrap?.settledResults;
  const view = useMemo(() => rosterRowView(position, settled ?? []), [position, settled]);
  const short = position.side === 'short';
  const verb = closeVerb(position.side);
  const target = short ? `short on ${position.playerName}` : position.playerName;

  // Screen readers hear the whole row in one breath, lifetime totals included.
  const profileLabel = [
    position.playerName,
    view.tag.label,
    `${short ? 'credited' : 'price'} ${exactMoney(position.lockedGameCost)} a game, locked`,
    view.games || 'no games yet',
    view.summary.avgDividend === null ? null : `dividend ${exactMoney(view.summary.avgDividend)} a game`,
    view.summary.avgNet === null ? null : `net ${exactSignedMoney(view.summary.avgNet)} a game`,
    `total ${exactSignedMoney(position.cumulativePnl)}`,
    short
      ? `${exactMoney(position.cumulativeGameCost)} credited and ${exactMoney(position.cumulativeDividend)} paid out`
      : `${exactMoney(position.cumulativeDividend)} in dividends against ${exactMoney(position.cumulativeGameCost)} in prices`,
    view.expiry,
    'View profile',
  ].filter(Boolean).join(', ');

  const identity = (
    <View style={styles.identity}>
      <Text style={styles.name}>{position.playerName}</Text>
      <View style={styles.meta}>
        <Tag tone={view.tag.tone}>{view.tag.label}</Tag>
        {view.games ? <Text style={styles.metaText}>{view.games}</Text> : null}
        {view.expiry ? <Text style={styles.metaText}>{view.expiry}</Text> : null}
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
        : pending ? `${verb === 'Drop' ? 'Dropping' : 'Closing'} ${target}` : `${verb} ${target}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        if (!disabled) closePosition(position);
      }}
      style={({ pressed }) => [
        styles.action,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {pending && !rosterLocked ? (
        <ActivityIndicator color={colors.muted} size="small" />
      ) : (
        <Text style={styles.actionText}>{rosterLocked ? 'LOCKED' : verb.toUpperCase()}</Text>
      )}
    </Pressable>
  );

  if (table) {
    return (
      <View style={styles.tableRow}>
        <Pressable
          accessibilityLabel={profileLabel}
          accessibilityRole="button"
          onPress={() => onOpenProfile(position.playerId)}
          style={({ pressed }) => [styles.tableProfile, pressed && styles.pressed]}
        >
          <PlayerAvatar player={{ id: position.playerId, name: position.playerName }} size={36} />
          {identity}
          <TableFigures {...figures} />
        </Pressable>
        {action}
      </View>
    );
  }

  return (
    <View style={styles.stackRow}>
      <Pressable
        accessibilityLabel={profileLabel}
        accessibilityRole="button"
        onPress={() => onOpenProfile(position.playerId)}
        style={({ pressed }) => [styles.stackProfile, pressed && styles.pressed]}
      >
        <View style={styles.stackTop}>
          <PlayerAvatar player={{ id: position.playerId, name: position.playerName }} size={36} />
          {identity}
        </View>
        <View style={styles.stackFigures}>
          <StackedFigures {...figures} twoByTwo={largeText} />
        </View>
      </Pressable>
      <View style={styles.stackAction}>{action}</View>
    </View>
  );
}

function Section({ title, meta, caption, header, children }: {
  title: string;
  meta: string;
  caption?: string;
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <SectionHeader caption={caption} meta={meta} style={styles.sectionHeader} title={title} />
      {header}
      {children}
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
  const components = useMemo(
    () => scoreComponents(bootstrap?.ledger.items ?? []),
    [bootstrap?.ledger.items],
  );
  const recent = useMemo(
    () => recentEarnings(bootstrap?.ledger.items, bootstrap?.game.lastSettledDate),
    [bootstrap?.game.lastSettledDate, bootstrap?.ledger.items],
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
  const wide = width >= WIDE_MIN_WIDTH;
  // Very large text needs the stacked rows' room; fixed table columns would collide.
  const largeText = fontScale > 1.3;
  const table = width >= TABLE_MIN_WIDTH && !largeText;
  const hadLongs = bootstrap.positions.some((position) => position.side === 'long' && position.status === 'closed');
  const hadShorts = bootstrap.positions.some((position) => position.side === 'short' && position.status === 'closed');
  const { longSlots, shortSlots } = bootstrap.account;
  // The lock stops adds as well as drops, so it shows even on an empty roster.
  const slotMeta = (used: number, limit: number) => (
    rosterLocked ? `Locked · ${used} of ${limit}` : `${used} of ${limit}`
  );
  const rows = (positions: PerGamePosition[]) => positions.map((position) => (
    <PositionRow
      key={position.positionId}
      largeText={largeText}
      onOpenProfile={setProfileId}
      position={position}
      table={table}
    />
  ));

  const summary = (
    <>
      <ScoreHeader
        breakdown={bootstrap.ledger.items.length > 0 ? components : null}
        nextGameDate={bootstrap.game.nextGameDate}
        rank={rankLine(bootstrap.leaderboard)}
        recent={recent}
        score={score}
        slots={wide ? slotLine(bootstrap.account) : null}
        started={started}
        title="Your score"
        variant={wide ? 'panel' : 'compact'}
      />
      <PerGamePnlChart
        entries={bootstrap.ledger.items}
        fill={wide}
        // Phones keep the plot short so roster rows start high; tablets can afford more.
        plotHeight={wide ? 168 : table ? 120 : 76}
      />
    </>
  );
  const lists = (
    <>
      <Section
        header={table && longs.length > 0 ? <TableHeader actionWidth={ACTION_WIDTH} side="long" /> : null}
        meta={slotMeta(longSlots.used, longSlots.limit)}
        title={sideHeading('long')}
      >
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
      </Section>
      <Section
        caption={shorts.length > 0 ? SHORT_EXPLAINER : undefined}
        header={table && shorts.length > 0 ? <TableHeader actionWidth={ACTION_WIDTH} side="short" /> : null}
        meta={slotMeta(shortSlots.used, shortSlots.limit)}
        title={sideHeading('short')}
      >
        {shorts.length > 0 ? rows(shorts) : (
          <EmptyState
            action={(
              <Button
                accessibilityLabel="Open the player market to short a player"
                label="Open market"
                onPress={() => onOpenMarket('short')}
              />
            )}
            copy={SHORT_EXPLAINER}
            style={styles.empty}
            title={hadShorts ? 'No open shorts' : 'No shorts yet'}
          />
        )}
      </Section>
    </>
  );

  return (
    <View style={styles.screen}>
      {wide ? (
        <View style={styles.columns}>
          <ScrollView contentContainerStyle={styles.summaryContent} style={styles.summaryColumn}>
            {summary}
          </ScrollView>
          <ScrollView contentContainerStyle={styles.columnContent} style={styles.listColumn}>
            {lists}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.columnContent} style={styles.scroll}>
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
    width: SUMMARY_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.borderStrong,
  },
  listColumn: {
    flex: 1,
  },
  columnContent: {
    paddingBottom: space.xxl,
  },
  summaryContent: {
    // The chart grows into whatever height the score block leaves.
    flexGrow: 1,
  },
  section: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  sectionHeader: {
    minHeight: 40,
    paddingVertical: space.sm - 2,
    backgroundColor: colors.surface,
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
  actionText: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.8,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.72,
  },
});
