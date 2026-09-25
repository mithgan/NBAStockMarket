import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import type { PerGamePositionSide } from '../api/contracts';
import { isMockActive, mockPlayerTrends, mockSeasonStart } from '../api/mockPerGameClient';
import { LockIcon } from '../components/market/icons';
import { ControlsToggle, MarketColumnHeader, MarketSearch, WatchingToggle } from '../components/market/MarketControls';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { PlayerProfileSheet } from '../components/PlayerProfileSheet';
import {
  SHORT_EXPLAINER,
  confirmCloseLine,
  confirmCloseName,
  money,
  moneyFine,
  perGameShort,
  rosterReopensLine,
  signedMoney,
  signedMoneyFine,
  unbrokenName,
} from '../copy/terms';
import { practiceProgress } from '../data/chromeView';
import {
  accountValueByPlayer,
  actionableFirst,
  actionName,
  actionWord,
  CONFIRM_WINDOW_MS,
  collapseControls,
  confirmAnnouncement,
  filterMarketRows,
  headerStatus,
  heldDetail,
  isSeasonOver,
  keepNamesWhole,
  MARKET_SORT_OPTIONS,
  marketColumns,
  marketLayout,
  netTone,
  rowActions,
  rowKicker,
  rowProfileLabel,
  slotSummary,
  sortMarketRows,
  valueByPosition,
  valueSignal,
  type MarketColumnSet,
  type MarketLayout,
  type MarketSort,
  type SignalTone,
} from '../data/marketView';
import type { ValueSummary } from '../data/perGameMetrics';
import { positionSlotHint } from '../data/perGameRules';
import { splitPlayerName } from '../data/playerName';
import { usePerGame } from '../state/PerGameContext';
import { buildPerGameMarketRows, type PerGameMarketRow } from '../state/perGameState';
import { useWatchlist } from '../state/watchlist';
import { colors, control, fonts, labelStyle, space, type, weight } from '../theme';
import { rowMarker } from '../ui/domMarkers';
import { Button, EmptyState, headingLevel, Segmented, Tag, visuallyHidden } from '../ui/kit';

const PHONE_ACTION_WIDTH = 76;
const PHONE_AVATAR = 34;
/** Phone row padding: 44px band + one value line keeps six rows above the fold. */
const ROW_PAD = 6;

/** The tag a player carries when he is held on a side. */
function sideTag(side: PerGamePositionSide): 'On your roster' | 'Shorted' {
  return side === 'long' ? 'On your roster' : 'Shorted';
}

/** Why a locked button is dimmed, in the app's one lock sentence. */
function rosterLockMessage(gameDate: string | null): string {
  return `Roster changes are locked. ${rosterReopensLine(gameDate)}.`;
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
  columns,
  currentValue,
  pastValue,
  fee,
  wholeNames,
  seasonOver,
  width,
  onOpenProfile,
  onAnnounce,
}: {
  row: PerGameMarketRow;
  layout: MarketLayout;
  columns: MarketColumnSet;
  /** The position you hold on this side now (positionValue: the Roster row's numbers). */
  currentValue: ValueSummary | undefined;
  /** Every earlier stint with him on this side, for a player you do not hold now. */
  pastValue: ValueSummary | undefined;
  fee: number;
  /** Keep hyphenated names whole (there is room for them on this width). */
  wholeNames: boolean;
  /** No games are left: the row carries no button, so nothing can charge a fee. */
  seasonOver: boolean;
  /** The screen width: below 380px the kicker leaves out the tier. */
  width: number;
  onOpenProfile: (playerId: string) => void;
  onAnnounce: (message: string) => void;
}) {
  const { bootstrap, closePosition, openPosition, pendingActions } = usePerGame();
  const { player, position, side } = row;
  const actionKey = `position:${side}:${player.playerId}`;
  const pending = pendingActions.has(actionKey);
  const locked = pendingActions.has('account-mutation');
  const rosterLocked = bootstrap?.ruleset.rosterMutationsLocked ?? true;
  const rosterLockHint = rosterLockMessage(bootstrap?.ruleset.rosterLockGameDate ?? null);
  const disabled = !row.canSubmit || pending || locked || rosterLocked || seasonOver;
  const currentGameCost = player.currentGameCost;
  const priorSeasonValuePerGame = player.priorSeasonValuePerGame;
  const { given, surname } = splitPlayerName(player.name);
  const whole = (text: string) => (wholeNames ? unbrokenName(text) : text);
  const kicker = whole(rowKicker(given, player.tier, width));
  const [priceAmount, priceUnit] = perGameShort(currentGameCost).split('/');

  // Drop and Close take a second tap within the confirm window.
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return undefined;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [confirming]);
  useEffect(() => {
    setConfirming(false);
  }, [position?.positionId, disabled]);

  // One line of meaning under the name: your stake when you hold him on this
  // side, the other side's tag when that blocks this side, otherwise last
  // season against his price today.
  const signal = valueSignal(player, side);
  const held = position ? heldDetail(currentValue, position.lockedGameCost) : null;
  const blocked = row.blockedByOpposingPosition && !position;
  const tagText = position ? sideTag(side) : blocked ? sideTag(side === 'long' ? 'short' : 'long') : null;
  const table = layout === 'table';
  const large = layout === 'large';
  const actionWidth = table ? columns.action : PHONE_ACTION_WIDTH;

  // While a Drop or Close is armed, the line says what it costs and what stays,
  // in the words the Roster uses.
  const valueLine = confirming && position ? (
    <View style={styles.detailLine}>
      <Text maxFontSizeMultiplier={1.6} style={[styles.detailText, styles.confirmText]}>
        {confirmCloseLine(side, fee, position.cumulativePnl)}
      </Text>
    </View>
  ) : position && held ? (
    <View style={styles.detailLine}>
      <Text maxFontSizeMultiplier={1.6} style={[styles.detailText, styles.heldText]}>{`${tagText} ·`}</Text>
      <Text maxFontSizeMultiplier={1.6} style={[styles.detailText, { color: TONE_COLOR[held.tone] }]}>{held.text}</Text>
    </View>
  ) : blocked ? (
    <View style={styles.detailLine}>
      <Tag>{tagText}</Tag>
    </View>
  ) : (
    <View style={styles.detailLine}>
      {signal.lead ? <Text maxFontSizeMultiplier={1.6} style={[styles.detailText, styles.leadText]}>{signal.lead}</Text> : null}
      <Text maxFontSizeMultiplier={1.6} style={[styles.detailText, { color: TONE_COLOR[signal.tone] }]}>
        {priorSeasonValuePerGame === null ? 'No last season' : signal.text}
      </Text>
    </View>
  );

  const priceBox = (
    <View style={styles.priceBox}>
      <Text maxFontSizeMultiplier={1.6} style={styles.price}>{priceAmount}</Text>
      <Text maxFontSizeMultiplier={1.6} style={styles.priceUnit}>{`/${priceUnit}`}</Text>
    </View>
  );

  const label = rowProfileLabel({
    name: player.name,
    tier: player.tier,
    price: currentGameCost,
    // A blocked row says why in the reason sentence instead.
    detail: blocked
      ? ''
      : position && held
        ? `${tagText}, ${held.text}`
        : [signal.lead?.replace(/ ·$/, ''), signal.text].filter(Boolean).join(', '),
    reason: blocked ? row.unavailableReason : null,
  });

  const openProfile = () => onOpenProfile(player.playerId);
  // At season end the row is quiet: no button at all, and the header's one
  // line says the season is over.
  const action = !rowActions(seasonOver) ? null : (
    <View
      accessibilityState={{ disabled }}
      style={[
        styles.actionCell,
        table ? { width: actionWidth } : large ? styles.actionCellLarge : [styles.actionFloat, { width: actionWidth }],
      ]}
    >
      {blocked ? (table ? <Tag style={styles.cellTag}>{tagText}</Tag> : null) : (
        <Button
          accessibilityHint={rosterLocked ? rosterLockHint : row.unavailableReason ?? undefined}
          accessibilityLabel={confirming && position
            ? confirmCloseName(side, player.name)
            : actionName(position ? 'close' : 'open', side, player.name, currentGameCost)}
          disabled={disabled}
          label={actionWord({
            side,
            held: position !== null,
            pending,
            confirming,
            rosterLocked,
            full: row.isFull,
          })}
          onPress={() => {
            if (disabled) return;
            if (position) {
              if (!confirming) {
                setConfirming(true);
                onAnnounce(confirmAnnouncement(side, player.name, fee, position.cumulativePnl));
                return;
              }
              setConfirming(false);
              closePosition(position);
            } else {
              openPosition({
                playerId: player.playerId,
                playerName: player.name,
                side,
                expectedQuoteVersion: player.quoteVersion,
              });
            }
          }}
          style={[!table && styles.phoneButton, confirming && styles.confirmButton]}
          textStyle={[styles.buttonText, confirming && styles.confirmButtonText]}
          width={large ? undefined : actionWidth}
        />
      )}
    </View>
  );

  if (table) {
    return (
      <View style={[styles.row, styles.rowTable]} {...rowMarker}>
        <Pressable
          accessibilityLabel={label}
          accessibilityRole="button"
          onPress={openProfile}
          style={({ pressed }) => [styles.profileArea, styles.profileAreaTable, { gap: columns.gap, paddingRight: columns.gap }, pressed && styles.pressed]}
        >
          <PlayerAvatar player={{ id: player.playerId, name: player.name }} size={columns.avatar} />
          <View style={styles.identity}>
            <View style={styles.kickerLine}>
              <Text maxFontSizeMultiplier={1.4} style={styles.kicker}>{kicker}</Text>
              {position ? <Text maxFontSizeMultiplier={1.4} style={[styles.kicker, styles.kickerHeld]}>{`· ${tagText}`}</Text> : null}
            </View>
            <Text maxFontSizeMultiplier={1.4} style={styles.surname}>{whole(surname)}</Text>
            {columns.yours === 0 && position && held ? (
              <Text maxFontSizeMultiplier={1.4} style={[styles.detailText, { color: TONE_COLOR[held.tone] }]}>{held.text}</Text>
            ) : null}
          </View>
          <View style={[styles.cell, { width: columns.price }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.cellValue}>{money(currentGameCost)}</Text>
          </View>
          <View style={[styles.cell, { width: columns.lastSeason }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, priorSeasonValuePerGame === null && styles.cellQuiet]}>
              {priorSeasonValuePerGame === null ? 'None' : money(priorSeasonValuePerGame)}
            </Text>
          </View>
          <View style={[styles.cell, { width: columns.edge }]}>
            <Text
              maxFontSizeMultiplier={1.4}
              style={[styles.cellValue, signal.edge === null && styles.cellQuiet, { color: TONE_COLOR[signal.tone] }]}
            >
              {signal.edge === null ? 'No last season' : signal.tone === 'even' ? 'Even' : signedMoney(signal.edge)}
            </Text>
          </View>
          {columns.yours > 0 ? (
            <View style={[styles.cell, { width: columns.yours }]}>
              {position && currentValue && currentValue.avgNet !== null && currentValue.games > 0 ? (
                <>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, { color: TONE_COLOR[netTone(currentValue.avgNet)] }]}>
                    {signedMoneyFine(currentValue.avgNet)}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.cellCaption}>
                    {currentValue.games === 1 ? '1 game' : `${currentValue.games} games`}
                  </Text>
                </>
              ) : position ? (
                <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, styles.cellQuiet]}>
                  {`Locked at ${moneyFine(position.lockedGameCost)}`}
                </Text>
              ) : pastValue && pastValue.avgNet !== null && pastValue.games > 0 ? (
                <>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, { color: TONE_COLOR[netTone(pastValue.avgNet)] }]}>
                    {signedMoneyFine(pastValue.avgNet)}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.cellCaption}>
                    {pastValue.games === 1 ? '1 past game' : `${pastValue.games} past games`}
                  </Text>
                </>
              ) : (
                <Text accessibilityLabel="none yet" maxFontSizeMultiplier={1.4} style={[styles.cellValue, styles.cellQuiet]}>—</Text>
              )}
            </View>
          ) : null}
        </Pressable>
        {action}
      </View>
    );
  }

  return (
    <View style={[styles.row, large && styles.rowLarge]} {...rowMarker}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={openProfile}
        style={({ pressed }) => [styles.profileArea, large && styles.profileAreaLarge, pressed && styles.pressed]}
      >
        <View style={[styles.avatarBox, large && styles.avatarBoxLarge]}>
          <PlayerAvatar player={{ id: player.playerId, name: player.name }} size={PHONE_AVATAR} />
        </View>
        <View style={styles.rowContent}>
          {large ? (
            <>
              <Text maxFontSizeMultiplier={1.6} style={styles.kicker}>{kicker}</Text>
              <Text maxFontSizeMultiplier={1.6} style={styles.surname}>{whole(surname)}</Text>
              {priceBox}
            </>
          ) : (
            // The action floats over the top band's right edge, so the band
            // leaves it room (none at season end); the value line below runs
            // the full width. The price shares the top line with the kicker,
            // so a long surname ("Gilgeous-Alexander") keeps the whole second
            // line; if a very long given name leaves no room on a very narrow
            // phone, the price wraps under it rather than overlapping it.
            <View style={[styles.topBand, { paddingRight: action ? actionWidth + space.sm : 0 }]}>
              <View style={styles.kickerPriceLine}>
                <Text maxFontSizeMultiplier={1.6} style={[styles.kicker, styles.kickerShrink]}>{kicker}</Text>
                <View style={styles.priceEnd}>{priceBox}</View>
              </View>
              <Text maxFontSizeMultiplier={1.6} style={styles.surname}>{whole(surname)}</Text>
            </View>
          )}
          {valueLine}
        </View>
      </Pressable>
      {action}
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
  const [announcement, setAnnouncement] = useState('');
  const [controlsOpen, setControlsOpen] = useState(false);
  const layout = marketLayout(width, fontScale);
  const folded = collapseControls(width);
  const columns = useMemo(() => marketColumns(width), [width]);
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
  const positionValues = useMemo(
    () => valueByPosition(bootstrap?.settledResults ?? []),
    [bootstrap?.settledResults],
  );
  const pastValues = useMemo(
    () => accountValueByPlayer(bootstrap?.settledResults ?? [], side),
    [bootstrap?.settledResults, side],
  );
  const openProfile = useCallback((playerId: string) => setProfileId(playerId), []);
  const clearFilters = useCallback(() => {
    setQuery('');
    setWatchedOnly(false);
  }, []);
  // One always-mounted live region; clearing it first makes a repeat announce again.
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((message: string) => {
    setAnnouncement('');
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setAnnouncement(message), 60);
  }, []);
  useEffect(() => () => {
    if (announceTimer.current) clearTimeout(announceTimer.current);
  }, []);

  if (!bootstrap) return null;
  const slots = side === 'long' ? bootstrap.account.longSlots : bootstrap.account.shortSlots;
  const rosterLocked = bootstrap.ruleset.rosterMutationsLocked;
  const lockDate = bootstrap.ruleset.rosterLockGameDate;
  const fee = bootstrap.ruleset.transactionFeeDollars;
  // The Roster's rule: practice ends on its last day, a live season when no
  // games are left. Then nothing can be added, dropped or shorted.
  const seasonOver = isSeasonOver({
    practiceComplete: isMockActive() && practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).complete,
    lastSettledDate: bootstrap.game.lastSettledDate,
    nextGameDate: bootstrap.game.nextGameDate,
  });
  const status = headerStatus({
    side,
    seasonOver,
    rosterLocked,
    lockGameDate: lockDate,
    full: slots.remaining === 0,
  });
  const filtersOn = query.trim() !== '' || sort !== 'price' || watchedOnly;
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
      // In the folded column a flex basis would become a height, so it only sizes rows.
      style={wide ? styles.sideToggleWide : folded ? undefined : styles.sideToggle}
      value={side}
    />
  );
  // The slot count, then at most one line: the season is over, or when the
  // roster reopens, or that this side is full. A locked roster never shows
  // "drop one to add", because drops are locked too.
  const slotStatus = (
    <View style={[styles.slotStatus, wide && styles.slotStatusWide, folded && styles.slotStatusFolded]}>
      <Text maxFontSizeMultiplier={1.4} style={styles.slotText}>{slotSummary(side, slots)}</Text>
      {status.kind === 'lock' ? (
        <View style={styles.lockLine}>
          <LockIcon />
          <Text maxFontSizeMultiplier={1.4} style={styles.lockText}>{status.text}</Text>
        </View>
      ) : status.text ? (
        <Text maxFontSizeMultiplier={1.4} style={styles.fullText}>{status.text}</Text>
      ) : null}
    </View>
  );
  const sortToggle = (
    <Segmented
      accessibilityLabel="Sort players"
      onChange={setSort}
      options={MARKET_SORT_OPTIONS}
      style={wide ? styles.sortToggleWide : folded ? undefined : styles.sortToggle}
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
      <View style={visuallyHidden}>
        <Text accessibilityRole="header" {...headingLevel(1)}>Market</Text>
      </View>
      {wide ? (
        <View style={styles.controlsWide}>
          {sideToggle}
          {slotStatus}
          <MarketSearch onChange={setQuery} style={styles.searchWide} value={query} />
          {sortToggle}
          {watchingToggle}
        </View>
      ) : folded ? (
        // A phone at 200% zoom: the side toggle and the slot count stay; search,
        // sort and Watching fold behind one toggle so a player shows at once.
        <View style={[styles.controls, styles.controlsFolded]}>
          {sideToggle}
          <View style={styles.foldedRow}>
            {slotStatus}
            <ControlsToggle active={filtersOn} onToggle={() => setControlsOpen((open) => !open)} open={controlsOpen} />
          </View>
          {shortExplainer}
          {controlsOpen ? (
            <>
              <MarketSearch onChange={setQuery} value={query} />
              {sortToggle}
              {watchingToggle}
            </>
          ) : null}
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
      {wide ? (
        <MarketColumnHeader
          // No button column at season end, so the labels line up with quiet rows.
          columns={rowActions(seasonOver) ? columns : { ...columns, action: 0 }}
          edgeLabel={side === 'long' ? 'Edge a game' : 'Edge as a short'}
        />
      ) : null}
    </View>
  );

  const trimmed = query.trim();
  const emptyState = watchedOnly && watchlist.watched.length === 0 ? (
    <EmptyState
      action={<Button label="Show everyone" onPress={() => setWatchedOnly(false)} />}
      copy="Open a player and tap Watch to keep him here."
      level={2}
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
      level={2}
      title={`No players match "${trimmed}"`}
    />
  ) : watchedOnly ? (
    <EmptyState
      action={<Button label="Show everyone" onPress={() => setWatchedOnly(false)} />}
      copy="The players you watch are not listed right now."
      level={2}
      title="No watched players listed"
    />
  ) : (
    <EmptyState copy="Players appear here once prices are posted." level={2} title="The market is empty" />
  );

  return (
    <>
      <FlatList
        contentContainerStyle={styles.content}
        data={rows}
        extraData={[layout, columns, positionValues, pastValues, fee, width, seasonOver]}
        initialNumToRender={18}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(row) => row.player.playerId}
        ListEmptyComponent={emptyState}
        ListHeaderComponent={listHeader}
        renderItem={({ item }) => (
          <MarketRow
            columns={columns}
            currentValue={item.position ? positionValues.get(item.position.positionId) : undefined}
            fee={fee}
            layout={layout}
            seasonOver={seasonOver}
            wholeNames={keepNamesWhole(width)}
            width={width}
            onAnnounce={announce}
            onOpenProfile={openProfile}
            pastValue={item.position ? undefined : pastValues.get(item.player.playerId)}
            row={item}
          />
        )}
        style={styles.list}
        windowSize={9}
      />
      <View style={visuallyHidden}>
        <Text accessibilityLiveRegion="polite">{announcement}</Text>
      </View>
      <PlayerProfileSheet
        dividendRate={bootstrap.ruleset.dividendDollarsPerNetPoint}
        latestSettledDate={bootstrap.game.lastSettledDate}
        onClose={() => setProfileId(null)}
        onToggleWatch={profileId ? () => watchlist.toggle(profileId) : undefined}
        player={profilePlayer}
        position={profilePosition}
        results={profileResults}
        side={side}
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
    paddingTop: 10,
    paddingBottom: 10,
  },
  controlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  controlsFolded: {
    paddingHorizontal: space.sm,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  foldedRow: {
    flexDirection: 'row',
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
  slotStatusFolded: {
    flexBasis: 0,
    alignItems: 'flex-start',
    minWidth: 0,
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
  fullText: {
    color: colors.text,
    fontSize: type.label,
    fontWeight: weight.bold,
    lineHeight: 15,
  },
  lockLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  lockText: {
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
    flexBasis: 160,
    minWidth: 144,
  },
  sortToggleWide: {
    width: 216,
  },
  row: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  rowTable: {
    paddingRight: space.lg,
  },
  rowLarge: {
    flexDirection: 'column',
  },
  profileArea: {
    minWidth: 0,
    minHeight: control.height,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingLeft: space.md,
    paddingRight: space.md,
    paddingTop: ROW_PAD,
    paddingBottom: ROW_PAD + 1,
  },
  profileAreaTable: {
    minHeight: 60,
    alignItems: 'center',
    paddingLeft: space.lg,
  },
  profileAreaLarge: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
  },
  avatarBox: {
    // Centres the avatar on the 44px top band that holds the name and price.
    paddingTop: (control.height - PHONE_AVATAR) / 2,
  },
  avatarBoxLarge: {
    paddingTop: 2,
  },
  rowContent: {
    minWidth: 0,
    flex: 1,
  },
  topBand: {
    minHeight: control.height,
    justifyContent: 'center',
  },
  kickerPriceLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.sm,
  },
  priceEnd: {
    // Right-aligned on the kicker's line, or on its own line when it wraps.
    marginLeft: 'auto',
  },
  kickerShrink: {
    flexShrink: 1,
    minWidth: 0,
  },
  identity: {
    minWidth: 0,
    flex: 1,
  },
  kickerLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 4,
  },
  kicker: {
    ...labelStyle,
    letterSpacing: 0.6,
  },
  kickerHeld: {
    color: colors.text,
  },
  surname: {
    flexShrink: 1,
    minWidth: 0,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    lineHeight: 20,
  },
  priceBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexShrink: 0,
  },
  price: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  priceUnit: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  detailLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 4,
    rowGap: 2,
  },
  detailText: {
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
    lineHeight: 17,
  },
  leadText: {
    color: colors.muted,
  },
  heldText: {
    color: colors.text,
  },
  confirmText: {
    color: colors.goldInk,
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
  },
  actionFloat: {
    position: 'absolute',
    top: ROW_PAD,
    right: space.md,
    height: control.height,
  },
  actionCellLarge: {
    alignItems: 'flex-start',
    // Lines the button up with the name above it: row inset + avatar + gap.
    paddingLeft: space.md + PHONE_AVATAR + 10,
    paddingBottom: space.md,
  },
  phoneButton: {
    // "CONFIRM" and "SEASON OVER" fit a 76px button on one and two lines.
    paddingHorizontal: 6,
  },
  buttonText: {
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  confirmButton: {
    borderColor: colors.goldLine,
    backgroundColor: colors.goldSoft,
  },
  confirmButtonText: {
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
