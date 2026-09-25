import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import type { PerGamePositionSide } from '../api/contracts';
import { isMockActive, mockPlayerTrends } from '../api/mockPerGameClient';
import { MARKET_COLUMNS, MarketColumnHeader, MarketSearch, WatchingToggle } from '../components/market/MarketControls';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { PlayerProfileSheet } from '../components/PlayerProfileSheet';
import { SHORT_EXPLAINER, humanDate, money, perGameShort, signedMoney } from '../copy/terms';
import {
  accountValueByPlayer,
  actionableFirst,
  actionName,
  filterMarketRows,
  heldDetail,
  MARKET_SORT_OPTIONS,
  netTone,
  rowProfileLabel,
  slotSummary,
  sortMarketRows,
  valueSignal,
  type MarketSort,
  type SignalTone,
} from '../data/marketView';
import type { ValueSummary } from '../data/perGameMetrics';
import { positionSlotHint } from '../data/perGameRules';
import { splitPlayerName } from '../data/playerName';
import { usePerGame } from '../state/PerGameContext';
import { buildPerGameMarketRows, type PerGameMarketRow } from '../state/perGameState';
import { useWatchlist } from '../state/watchlist';
import { colors, fonts, labelStyle, space, type, weight } from '../theme';
import { rowMarker } from '../ui/domMarkers';
import { Button, EmptyState, Segmented, Tag } from '../ui/kit';

/**
 * phone: name and price side by side · stacked: a narrow phone, price under the
 * name · large: big text or a zoomed browser, the action drops below the
 * player so nothing is squeezed · table: desktop columns.
 */
type RowLayout = 'phone' | 'stacked' | 'large' | 'table';

const PHONE_ACTION_WIDTH = 76;

/** The tag a player carries when he is held on a side. */
function sideTag(side: PerGamePositionSide): 'On your roster' | 'Shorted' {
  return side === 'long' ? 'On your roster' : 'Shorted';
}

function rosterLockMessage(gameDate: string | null): string {
  if (!gameDate) return 'Roster changes are locked while the current game is in progress.';
  return `Roster changes are locked for the ${humanDate(gameDate)} game.`;
}

const TONE_COLOR: Record<SignalTone, string> = {
  gain: colors.green,
  loss: colors.red,
  even: colors.muted,
  none: colors.faint,
};

function MarketRow({
  row,
  layout,
  accountValue,
  onOpenProfile,
}: {
  row: PerGameMarketRow;
  layout: RowLayout;
  /** This account's settled games with him on this side, if any. */
  accountValue: ValueSummary | undefined;
  onOpenProfile: (playerId: string) => void;
}) {
  const { bootstrap, closePosition, openPosition, pendingActions } = usePerGame();
  const { player, position, side } = row;
  const actionKey = `position:${side}:${player.playerId}`;
  const pending = pendingActions.has(actionKey);
  const locked = pendingActions.has('account-mutation');
  const rosterLocked = bootstrap?.ruleset.rosterMutationsLocked ?? true;
  const rosterLockHint = rosterLockMessage(bootstrap?.ruleset.rosterLockGameDate ?? null);
  const disabled = !row.canSubmit || pending || locked || rosterLocked;
  const currentGameCost = player.currentGameCost;
  const priorSeasonValuePerGame = player.priorSeasonValuePerGame;
  const { given, surname } = splitPlayerName(player.name);
  const kicker = [given, player.tier].filter(Boolean).join(' · ');
  const [priceAmount, priceUnit] = perGameShort(currentGameCost).split('/');

  // One line of meaning under the name: your stake when you hold him on this
  // side, the opposite side's tag when that blocks this side, otherwise what
  // one game at today's price would have made last season.
  const signal = valueSignal(player, side);
  const held = position ? heldDetail(accountValue, position.lockedGameCost) : null;
  const blocked = row.blockedByOpposingPosition;
  const tagText = position ? sideTag(side) : blocked ? sideTag(side === 'long' ? 'short' : 'long') : null;
  const detailText = held ? held.text : blocked ? '' : signal.text;
  const detailTone: SignalTone = held ? held.tone : signal.tone;

  const verb = position ? (side === 'long' ? 'Drop' : 'Close') : side === 'long' ? 'Add' : 'Short';
  const visibleActionLabel = pending ? 'Wait' : verb;
  const table = layout === 'table';
  const large = layout === 'large';
  const showAction = !(blocked && !position) || table;

  const priceText = (
    <Text maxFontSizeMultiplier={1.6} style={styles.price}>
      {priceAmount}
      <Text style={styles.priceUnit}>/{priceUnit}</Text>
    </Text>
  );
  // Held on this side: one quiet line, "On your roster · +$32K a game so far".
  // Held on the other side: one compact tag instead of an action.
  const detailLine = position ? (
    <Text maxFontSizeMultiplier={1.6} style={styles.detailText}>
      <Text style={styles.heldText}>{tagText}</Text>
      <Text style={styles.detailDot}>{'  ·  '}</Text>
      <Text style={{ color: TONE_COLOR[detailTone] }}>{detailText}</Text>
    </Text>
  ) : blocked ? (
    <View style={styles.detailLine}>
      <Tag>{tagText}</Tag>
    </View>
  ) : (
    <Text maxFontSizeMultiplier={1.6} style={[styles.detailText, { color: TONE_COLOR[detailTone] }]}>
      {detailText}
    </Text>
  );

  return (
    <View style={[styles.row, table && styles.rowTable, large && styles.rowLarge]} {...rowMarker}>
      <Pressable
        accessibilityLabel={rowProfileLabel({
          name: player.name,
          tier: player.tier,
          price: currentGameCost,
          // A blocked row says why in the reason sentence instead.
          detail: blocked && !position ? '' : [tagText, detailText].filter(Boolean).join(', '),
          reason: blocked && !position ? row.unavailableReason : null,
        })}
        accessibilityRole="button"
        onPress={() => onOpenProfile(player.playerId)}
        style={({ pressed }) => [
          styles.profileArea,
          table && styles.profileAreaTable,
          large && styles.profileAreaLarge,
          pressed && styles.pressed,
        ]}
      >
        <PlayerAvatar player={{ id: player.playerId, name: player.name }} size={table ? MARKET_COLUMNS.avatar : 34} />
        {table ? (
          <>
            <View style={styles.identity}>
              <Text maxFontSizeMultiplier={1.4} style={styles.kicker}>
                {kicker}
                {position ? <Text style={styles.heldText}>{`  ·  ${tagText}`}</Text> : null}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.surname}>{surname}</Text>
            </View>
            <View style={[styles.cell, { width: MARKET_COLUMNS.price }]}>
              <Text maxFontSizeMultiplier={1.4} style={styles.cellValue}>{money(currentGameCost)}</Text>
            </View>
            <View style={[styles.cell, { width: MARKET_COLUMNS.lastSeason }]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, priorSeasonValuePerGame === null && styles.cellQuiet]}>
                {priorSeasonValuePerGame === null ? 'None' : money(priorSeasonValuePerGame)}
              </Text>
            </View>
            <View style={[styles.cell, { width: MARKET_COLUMNS.edge }]}>
              <Text
                maxFontSizeMultiplier={1.4}
                style={[styles.cellValue, signal.edge === null && styles.cellQuiet, { color: TONE_COLOR[signal.tone] }]}
              >
                {signal.edge === null ? 'No last season' : signal.tone === 'even' ? 'Even' : signedMoney(signal.edge)}
              </Text>
            </View>
            <View style={[styles.cell, { width: MARKET_COLUMNS.yours }]}>
              {accountValue && accountValue.avgNet !== null ? (
                <>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, { color: TONE_COLOR[netTone(accountValue.avgNet)] }]}>
                    {signedMoney(accountValue.avgNet)}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.cellCaption}>
                    {accountValue.games === 1 ? '1 game' : `${accountValue.games} games`}
                  </Text>
                </>
              ) : position ? (
                <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, styles.cellQuiet]}>
                  {`Locked at ${money(position.lockedGameCost)}`}
                </Text>
              ) : (
                <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, styles.cellQuiet]}>—</Text>
              )}
            </View>
          </>
        ) : (
          <View style={styles.rowContent}>
            {layout === 'stacked' || large ? (
              <>
                <Text maxFontSizeMultiplier={1.6} style={styles.kicker}>{kicker}</Text>
                <Text maxFontSizeMultiplier={1.6} style={styles.surname}>{surname}</Text>
                {priceText}
              </>
            ) : (
              <View style={styles.topLine}>
                <View style={styles.identity}>
                  <Text maxFontSizeMultiplier={1.6} style={styles.kicker}>{kicker}</Text>
                  <Text maxFontSizeMultiplier={1.6} style={styles.surname}>{surname}</Text>
                </View>
                {priceText}
              </View>
            )}
            {detailLine}
          </View>
        )}
      </Pressable>
      <View
        accessibilityState={{ disabled }}
        style={[
          styles.actionCell,
          large ? styles.actionCellLarge : { width: table ? MARKET_COLUMNS.action : PHONE_ACTION_WIDTH },
          !showAction && large && styles.actionCellEmpty,
        ]}
      >
        {blocked && !position ? (table ? <Tag style={styles.cellTag}>{tagText}</Tag> : null) : (
          <Button
            accessibilityHint={rosterLocked ? rosterLockHint : row.unavailableReason ?? undefined}
            accessibilityLabel={actionName(position ? 'close' : 'open', side, player.name, currentGameCost)}
            disabled={disabled}
            label={visibleActionLabel}
            onPress={() => {
              if (disabled) return;
              if (position) closePosition(position);
              else {
                openPosition({
                  playerId: player.playerId,
                  playerName: player.name,
                  side,
                  expectedQuoteVersion: player.quoteVersion,
                });
              }
            }}
            textStyle={position ? undefined : styles.openText}
            width={table ? MARKET_COLUMNS.action : PHONE_ACTION_WIDTH}
          />
        )}
      </View>
    </View>
  );
}

export function PerGameMarketScreen({
  initialSide = 'long',
}: {
  initialSide?: PerGamePositionSide;
}) {
  const { bootstrap } = usePerGame();
  const { fontScale, width } = useWindowDimensions();
  const watchlist = useWatchlist();
  const [query, setQuery] = useState('');
  const [side, setSide] = useState<PerGamePositionSide>(initialSide);
  const [sort, setSort] = useState<MarketSort>('price');
  const [watchedOnly, setWatchedOnly] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const layout: RowLayout = width >= 1024 && fontScale <= 1.3
    ? 'table'
    : fontScale > 1.3 || width < 300
      ? 'large'
      : width < 350
        ? 'stacked'
        : 'phone';
  const wide = layout === 'table';

  const allRows = useMemo(
    () => (bootstrap ? buildPerGameMarketRows(bootstrap, side) : []),
    [bootstrap, side],
  );
  const rows = useMemo(
    () => actionableFirst(sortMarketRows(
      filterMarketRows(allRows, { query, watchedOnly, watched: watchlist.watched }),
      sort,
      side,
    )),
    [allRows, query, side, sort, watchedOnly, watchlist.watched],
  );
  const accountValues = useMemo(
    () => accountValueByPlayer(bootstrap?.settledResults ?? [], side),
    [bootstrap?.settledResults, side],
  );
  const openProfile = useCallback((playerId: string) => setProfileId(playerId), []);
  const clearFilters = useCallback(() => {
    setQuery('');
    setWatchedOnly(false);
  }, []);

  if (!bootstrap) return null;
  const slots = side === 'long' ? bootstrap.account.longSlots : bootstrap.account.shortSlots;
  const rosterLocked = bootstrap.ruleset.rosterMutationsLocked;
  const lockDate = bootstrap.ruleset.rosterLockGameDate;
  const profilePlayer = profileId
    ? bootstrap.market.find((row) => row.playerId === profileId) ?? null
    : null;
  const profilePosition = profileId
    ? bootstrap.positions.find(
      (row) => row.playerId === profileId && row.status === 'active',
    ) ?? null
    : null;
  const profileResults = profileId
    ? bootstrap.settledResults.filter((result) => result.playerId === profileId)
    : [];

  const sideToggle = (
    <Segmented
      accessibilityLabel="Market side"
      onChange={setSide}
      options={[
        { key: 'long', label: 'Roster', hint: positionSlotHint('long', bootstrap.account.longSlots.limit) },
        { key: 'short', label: 'Short', hint: positionSlotHint('short', bootstrap.account.shortSlots.limit) },
      ]}
      style={wide ? styles.sideToggleWide : styles.sideToggle}
      value={side}
    />
  );
  const slotStatus = (
    <View style={[styles.slotStatus, wide && styles.slotStatusWide]}>
      <Text
        maxFontSizeMultiplier={1.4}
        style={[styles.slotText, slots.remaining === 0 && styles.slotTextFull]}
      >
        {slotSummary(side, slots)}
      </Text>
      {rosterLocked ? (
        <Text maxFontSizeMultiplier={1.4} style={styles.lockText}>
          {lockDate ? `Locked for the ${humanDate(lockDate)} game` : 'Locked during the game'}
        </Text>
      ) : null}
    </View>
  );
  const sortToggle = (
    <Segmented
      accessibilityLabel="Sort players"
      onChange={setSort}
      options={MARKET_SORT_OPTIONS}
      style={wide ? styles.sortToggleWide : styles.sortToggle}
      value={sort}
    />
  );
  const watchingToggle = (
    <WatchingToggle count={watchlist.watched.length} on={watchedOnly} onChange={setWatchedOnly} />
  );
  const shortExplainer = side === 'short' ? (
    <Text maxFontSizeMultiplier={1.4} style={styles.explainer}>{SHORT_EXPLAINER}</Text>
  ) : null;

  const listHeader = (
    <View style={styles.header}>
      {wide ? (
        <View style={styles.controlsWide}>
          {sideToggle}
          {slotStatus}
          <MarketSearch onChange={setQuery} style={styles.searchWide} value={query} />
          {sortToggle}
          {watchingToggle}
        </View>
      ) : (
        <View style={styles.controls}>
          <View style={styles.controlRow}>
            {sideToggle}
            {slotStatus}
          </View>
          {shortExplainer}
          <MarketSearch onChange={setQuery} value={query} />
          <View style={styles.controlRow}>
            {sortToggle}
            {watchingToggle}
          </View>
        </View>
      )}
      {wide && shortExplainer ? <View style={styles.explainerWide}>{shortExplainer}</View> : null}
      {wide ? <MarketColumnHeader edgeLabel={side === 'long' ? 'Edge a game' : 'Edge as a short'} /> : null}
    </View>
  );

  const trimmed = query.trim();
  const emptyState = watchedOnly && watchlist.watched.length === 0 ? (
    <EmptyState
      action={<Button label="Show everyone" onPress={() => setWatchedOnly(false)} />}
      copy="Open a player and tap Watch to keep him here."
      title="You're not watching anyone yet"
    />
  ) : trimmed ? (
    <EmptyState
      action={(
        <View style={styles.emptyActions}>
          <Button label="Clear search" onPress={() => setQuery('')} variant="secondary" />
          {watchedOnly ? <Button label="Show everyone" onPress={clearFilters} variant="quiet" /> : null}
        </View>
      )}
      copy={watchedOnly
        ? 'None of the players you watch match that name.'
        : 'Check the spelling, or clear the search to see the whole market.'}
      title={`No players match "${trimmed}"`}
    />
  ) : watchedOnly ? (
    <EmptyState
      action={<Button label="Show everyone" onPress={() => setWatchedOnly(false)} />}
      copy="The players you watch are not listed right now."
      title="No watched players listed"
    />
  ) : (
    <EmptyState copy="Players appear here once prices are posted." title="The market is empty" />
  );

  return (
    <>
      <FlatList
        contentContainerStyle={styles.content}
        data={rows}
        extraData={[layout, accountValues]}
        initialNumToRender={18}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(row) => row.player.playerId}
        ListEmptyComponent={emptyState}
        ListHeaderComponent={listHeader}
        renderItem={({ item }) => (
          <MarketRow
            accountValue={accountValues.get(item.player.playerId)}
            layout={layout}
            onOpenProfile={openProfile}
            row={item}
          />
        )}
        style={styles.list}
        windowSize={9}
      />
      <PlayerProfileSheet
        dividendRate={bootstrap.ruleset.dividendDollarsPerNetPoint}
        latestSettledDate={bootstrap.game.lastSettledDate}
        onClose={() => setProfileId(null)}
        onToggleWatch={profileId ? () => watchlist.toggle(profileId) : undefined}
        player={profilePlayer}
        position={profilePosition}
        results={profileResults}
        trends={profileId !== null && isMockActive() ? mockPlayerTrends(profileId) : undefined}
        visible={profileId !== null && profilePlayer !== null}
        watching={profileId ? watchlist.isWatched(profileId) : undefined}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  content: {
    paddingBottom: 110,
  },
  header: {
    backgroundColor: colors.surface,
  },
  controls: {
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
  },
  controlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  controlsWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
  },
  sideToggle: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
    minWidth: 132,
    maxWidth: 220,
  },
  sideToggleWide: {
    width: 200,
  },
  slotStatus: {
    flexGrow: 1,
    flexBasis: 120,
    alignItems: 'flex-end',
  },
  slotStatusWide: {
    flexGrow: 0,
    flexBasis: 'auto',
    alignItems: 'flex-start',
    minWidth: 150,
  },
  slotText: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
    lineHeight: 16,
  },
  slotTextFull: {
    color: colors.goldInk,
  },
  lockText: {
    marginTop: 1,
    color: colors.goldInk,
    fontSize: type.label,
    fontWeight: weight.bold,
    lineHeight: 15,
  },
  explainer: {
    color: colors.muted,
    fontSize: type.caption,
    lineHeight: 17,
  },
  explainerWide: {
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    marginTop: -space.xs,
  },
  searchWide: {
    flexGrow: 1,
    flexBasis: 200,
  },
  sortToggle: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 200,
    minWidth: 144,
  },
  sortToggleWide: {
    width: 216,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    paddingRight: space.md,
  },
  rowTable: {
    paddingRight: space.lg,
  },
  rowLarge: {
    flexDirection: 'column',
  },
  profileArea: {
    minWidth: 0,
    minHeight: 64,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: space.md,
    paddingRight: space.sm,
    paddingVertical: 10,
  },
  profileAreaLarge: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
  },
  profileAreaTable: {
    minHeight: 60,
    gap: MARKET_COLUMNS.gap,
    paddingLeft: space.lg,
    paddingRight: MARKET_COLUMNS.gap,
    paddingVertical: space.sm,
  },
  rowContent: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  topLine: {
    flexDirection: 'row',
    // The price sits on the surname's line, so name and price read as one line.
    alignItems: 'flex-end',
    gap: space.sm,
  },
  identity: {
    minWidth: 0,
    flex: 1,
  },
  kicker: {
    ...labelStyle,
    letterSpacing: 0.6,
  },
  surname: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    lineHeight: 20,
  },
  price: {
    flexShrink: 0,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  priceUnit: {
    color: colors.faint,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  detailLine: {
    flexDirection: 'row',
    marginTop: 2,
  },
  detailText: {
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
    lineHeight: 17,
  },
  heldText: {
    color: colors.goldInk,
  },
  detailDot: {
    color: colors.faint,
  },
  cell: {
    alignItems: 'flex-end',
  },
  cellValue: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  cellQuiet: {
    color: colors.faint,
    fontSize: type.caption,
    fontWeight: weight.bold,
  },
  cellCaption: {
    marginTop: 1,
    color: colors.faint,
    fontSize: type.label,
    fontVariant: ['tabular-nums'],
  },
  cellTag: {
    alignSelf: 'center',
  },
  actionCell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.sm,
  },
  actionCellLarge: {
    alignItems: 'flex-start',
    // Lines the button up with the name above it: row inset + avatar + gap.
    paddingLeft: space.md + 34 + 10,
    paddingTop: 0,
    paddingBottom: space.md,
  },
  actionCellEmpty: {
    paddingBottom: 0,
  },
  openText: {
    color: colors.goldInk,
  },
  emptyActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  pressed: {
    opacity: 0.72,
  },
});
