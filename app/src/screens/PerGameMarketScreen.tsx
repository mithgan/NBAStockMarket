import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewToken,
} from 'react-native';

import type { PerGamePositionSide } from '../api/contracts';
import { isMockActive, mockPlayerTrends, mockSeasonStart } from '../api/mockPerGameClient';
import { FullNote } from '../components/market/FullNote';
import { LockIcon, StarIcon } from '../components/market/icons';
import { listenForActivations, pressedInScreen } from '../components/market/lastActivation';
import { spaceToggles } from '../components/market/switchKeys';
import { useAriaDisabled } from '../components/market/useAriaDisabled';
import { ControlsToggle, MarketColumnHeader, MarketSearch, WatchingToggle } from '../components/market/MarketControls';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { PlayerProfileSheet } from '../components/PlayerProfileSheet';
import {
  ROSTER_EXPLAINER,
  SHORT_EXPLAINER,
  closeActionName,
  confirmCloseButton,
  confirmCloseMessage,
  exactMoney,
  money,
  moneyFine,
  perGameShort,
  rosterReopensLine,
  signedMoney,
  signedMoneyFine,
  unbrokenName,
  moneyCompact,
  signedMoneyCompact,
} from '../copy/terms';
import { practiceProgress } from '../data/chromeView';
import {
  accountValueByPlayer,
  actionableFirst,
  actionName,
  actionWord,
  collapseControls,
  echoQuery,
  feeHint,
  filterMarketRows,
  fullActionName,
  fullNote,
  headerStatus,
  heldDetail,
  isSeasonOver,
  JUST_OPENED_MS,
  keptAnnouncement,
  justClosedName,
  justOpenedName,
  keepNamesWhole,
  KICKER_TIER_MIN_WIDTH,
  listCountLine,
  marketColumns,
  marketLayout,
  marketSortOptions,
  netTone,
  rowActions,
  rowKicker,
  rowProfileLabel,
  ROOMY_MIN_HEIGHT,
  rosterPickReason,
  SHORT_WINDOW_BELOW,
  slotSummary,
  flippedSortNote,
  sortedLine,
  sortMarketRows,
  valueByPosition,
  valueSignal,
  type MarketColumnSet,
  type MarketLayout,
  type MarketSort,
  type SignalTone,
} from '../data/marketView';
import { marketMemory, openingSide, rememberMarket } from '../data/marketViewMemory';
import type { ValueSummary } from '../data/perGameMetrics';
import { positionSlotHint } from '../data/perGameRules';
import { splitPlayerName } from '../data/playerName';
import { shortEndsNext } from '../data/rosterView';
import { usePerGame } from '../state/PerGameContext';
import { buildPerGameMarketRows, type PerGameMarketRow } from '../state/perGameState';
import { requestRosterPick } from '../state/uiActions';
import { useWatchlist } from '../state/watchlist';
import { colors, control, fonts, labelStyle, space, type, weight } from '../theme';
import { rowMarker } from '../ui/domMarkers';
import { Button, ConfirmStrip, EmptyState, headingLevel, Segmented, Tag, tapsSettling, useCooldown, visuallyHidden } from '../ui/kit';

// Start listening at load, so the press that first opens the Market is seen.
listenForActivations();

const PHONE_ACTION_WIDTH = 76;
/**
 * Header spacer for the table rows' watch star: the row puts space.sm + a
 * 44px star + space.sm before the avatar; the header's own inset and gap
 * make up the rest, so the columns stay aligned.
 */
const STAR_LEAD = space.sm + control.height + space.sm - space.lg - 12;
const PHONE_AVATAR = 34;
/** Phone row padding: 44px band + one value line keeps six rows above the fold. */
const ROW_PAD = 6;

/** The tag a player carries when he is held on a side. */
function sideTag(side: PerGamePositionSide): 'On your roster' | 'Shorted' {
  return side === 'long' ? 'On your roster' : 'Shorted';
}

/** Keep the last two words together ("Oct 31", "to add"), so no line ends in a lone word. */
function unbrokenTail(text: string): string {
  return text.replace(/ (\S+)$/, '\u00A0$1');
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
  watched,
  onToggleWatch,
  dimmed = false,
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
  /** On your watchlist; the table row carries a star to change it in place. */
  watched: boolean;
  onToggleWatch: (playerId: string) => void;
  /** Unwatched while the Watching filter is on: kept in place, dimmed, until the filter changes. */
  dimmed?: boolean;
}) {
  const { bootstrap, closePosition, dismissNotice, notify, openPosition, pendingActions } = usePerGame();
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
  // Below 380px the tier leaves the kicker; it follows the surname instead,
  // so every width says the same thing. The chevron says the row opens more.
  const tierAfter = width < KICKER_TIER_MIN_WIDTH && player.tier ? player.tier : null;
  const nameLine = (
    <>
      {whole(surname)}
      {/* One span, kept together, so a wrapped line never splits it. */}
      <Text style={tierAfter ? styles.tierInline : styles.chevron}>
        {tierAfter ? `\u2002${tierAfter.toUpperCase()}\u00A0›` : '\u2002›'}
      </Text>
    </>
  );
  const [priceAmount, priceUnit] = perGameShort(currentGameCost).split('/');

  // After an Add or Short the same spot shows "Added ✓" for a moment and takes
  // no taps, so a double or triple tap never lands on Drop or Close. The
  // cooldown starts on the tap and restarts when the add lands.
  const [cooling, startCooling] = useCooldown(JUST_OPENED_MS);
  const lastAction = useRef<'open' | 'close' | null>(null);
  const justOpened = cooling && lastAction.current === 'open' && position !== null;
  const justClosed = cooling && lastAction.current === 'close' && position === null;

  // Drop and Close ask in a strip under the row (fee, what stays, what coming
  // back costs). It waits for Keep, Escape or the costly button: no timeout.
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    setConfirming(false);
  }, [position?.positionId, disabled]);
  // Keyboard focus stays in the row: the button keeps its focus through
  // "Wait" and "Added ✓" (it stays focusable), and when the strip closes
  // (Keep, Escape or the costly button) focus returns to the row's button.
  const actionRef = useRef<View>(null);
  const refocus = useRef(false);
  const closeStrip = () => {
    refocus.current = true;
    setConfirming(false);
  };
  // FULL answers a tap: a note under the row says why and offers the Roster.
  const fullOffer = row.isFull && !position && !pending && !locked && !rosterLocked && !seasonOver;
  const [noting, setNoting] = useState(false);
  const closeNote = useCallback(() => {
    refocus.current = true;
    setNoting(false);
  }, []);
  useEffect(() => {
    if (!fullOffer) setNoting(false);
  }, [fullOffer]);
  useEffect(() => {
    if (confirming || noting || !refocus.current) return;
    refocus.current = false;
    (actionRef.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [confirming, noting]);
  // The button rests (dimmed, taps ignored, still in the Tab order) while it
  // cannot act, and says so to assistive tech.
  const resting = disabled || justOpened || justClosed || confirming;
  useAriaDisabled(actionRef, resting);
  const word = actionWord({
    side,
    held: position !== null,
    pending,
    rosterLocked,
    full: row.isFull,
    justOpened,
    justClosed,
  });

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

  const valueLine = position && held ? (
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

  const openProfile = () => {
    // The second tap of a double tap on a confirm that just folded away.
    if (tapsSettling()) return;
    onOpenProfile(player.playerId);
  };
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
          ref={actionRef}
          accessibilityHint={rosterLocked ? rosterLockHint : row.unavailableReason ?? undefined}
          // FULL says why, with its own word in the name for voice control.
          accessibilityLabel={justOpened
            ? justOpenedName(side, player.name)
            : justClosed
              ? justClosedName(side, player.name)
              : word === 'Full'
                ? fullActionName(side, player.name)
                : actionName(position ? 'close' : 'open', side, player.name, currentGameCost)}
          // While the confirm strip is open the row's own button rests, so a
          // second tap in the same spot does nothing.
          disabled={resting && !fullOffer}
          focusableWhenDisabled
          // LOCKED answers a tap with why and when, as on the Roster.
          onDisabledPress={rosterLocked
            ? () => notify(`${rosterReopensLine(bootstrap?.ruleset.rosterLockGameDate ?? null)}. Moves pause while those games are played.`)
            : undefined}
          label={word}
          onPress={() => {
            if (fullOffer) {
              // One message at a time: the note replaces the last notice (walk 3 T3-15).
              dismissNotice();
              setNoting((open) => !open);
              return;
            }
            if (disabled) return;
            if (justOpened || justClosed) return;
            if (confirming) return;
            if (position) {
              setConfirming(true);
            } else {
              lastAction.current = 'open';
              startCooling();
              void openPosition({
                playerId: player.playerId,
                playerName: player.name,
                side,
                expectedQuoteVersion: player.quoteVersion,
              }).then((opened) => {
                if (opened) startCooling();
              });
            }
          }}
          style={[!table && styles.phoneButton, fullOffer && styles.fullButton]}
          textStyle={styles.buttonText}
          width={large ? undefined : actionWidth}
        />
      )}
    </View>
  );

  // Keep sits at the right, where the row's button was; the costly button sits
  // to its left. Focus starts on Keep; Escape or Keep closes the strip.
  const strip = confirming && position ? (
    <ConfirmStrip
      confirmAccessibilityLabel={fee > 0 ? `${closeActionName(side, player.name)} for ${exactMoney(fee)}` : closeActionName(side, player.name)}
      confirmLabel={confirmCloseButton(side, fee)}
      // One wording on every screen: the fee, what stays, and what coming
      // back would cost today.
      message={confirmCloseMessage({
        side,
        playerName: player.name,
        feeDollars: fee,
        total: position.cumulativePnl,
        endsFreeAfter: shortEndsNext(position, bootstrap?.game.nextGameDate) ? position.expiresOn : null,
        priceNow: player.currentGameCost,
      })}
      onCancel={() => {
        closeStrip();
        onAnnounce(keptAnnouncement(side, player.name));
      }}
      onConfirm={() => {
        closeStrip();
        lastAction.current = 'close';
        startCooling();
        void closePosition(position).then((closed) => {
          if (closed) startCooling();
        });
      }}
      style={table ? styles.stripTable : undefined}
    />
  ) : null;
  const slotLimit = side === 'long' ? bootstrap?.account.longSlots.limit ?? 0 : bootstrap?.account.shortSlots.limit ?? 0;
  const note = noting && fullOffer ? (() => {
    const { message, action: actionLabel } = fullNote(side, player.name, slotLimit);
    return (
      <FullNote
        actionLabel={actionLabel}
        message={message}
        // The Roster brings the right list forward ("Your roster" or "Your
        // shorts") and says why the player is there.
        onAction={() => requestRosterPick(rosterPickReason(player.name, side), side, { playerId: player.playerId, playerName: player.name })}
        onClose={closeNote}
        style={table ? styles.stripTable : undefined}
      />
    );
  })() : null;

  if (table) {
    return (
      <>
      <View style={[styles.row, styles.rowTable, dimmed && styles.rowDimmed]} {...rowMarker}>
        <Pressable
          accessibilityLabel={`Watch ${player.name}`}
          accessibilityRole="switch"
          accessibilityState={{ checked: watched }}
          aria-checked={watched}
          onPress={() => onToggleWatch(player.playerId)}
          {...spaceToggles(() => onToggleWatch(player.playerId))}
          style={({ pressed }) => [styles.starCell, pressed && styles.pressed]}
        >
          <StarIcon filled={watched} size={18} />
        </Pressable>
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
            <Text maxFontSizeMultiplier={1.4} style={styles.surname}>{nameLine}</Text>
            {columns.yours === 0 && position && held ? (
              <Text maxFontSizeMultiplier={1.4} style={[styles.detailText, { color: TONE_COLOR[held.tone] }]}>{held.text}</Text>
            ) : null}
          </View>
          <View style={[styles.cell, { width: columns.price }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.cellValue}>{money(currentGameCost)}</Text>
            {/* Your own price sits under today's, so the net column holds only net. */}
            {position && position.lockedGameCost !== currentGameCost ? (
              <Text maxFontSizeMultiplier={1.4} style={styles.cellCaption}>{`Yours ${moneyFine(position.lockedGameCost)}`}</Text>
            ) : position ? (
              <Text maxFontSizeMultiplier={1.4} style={styles.cellCaption}>Locked in</Text>
            ) : null}
          </View>
          {/* No last season: one calm dash in both columns (the row's name says it in words). */}
          <View style={[styles.cell, { width: columns.lastSeason }]}>
            {priorSeasonValuePerGame === null ? (
              <Text accessibilityLabel="no last season" maxFontSizeMultiplier={1.4} style={[styles.cellValue, styles.cellQuiet]}>—</Text>
            ) : (
              <Text maxFontSizeMultiplier={1.4} style={styles.cellValue}>{moneyCompact(priorSeasonValuePerGame)}</Text>
            )}
          </View>
          <View style={[styles.cell, { width: columns.edge }]}>
            {signal.edge === null ? (
              <Text accessibilityLabel="no last season" maxFontSizeMultiplier={1.4} style={[styles.cellValue, styles.cellQuiet]}>—</Text>
            ) : (
              <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, { color: TONE_COLOR[signal.tone] }]}>
                {/* One style down the column: "+$8K" beside "+$25.5K" (walk 3 T2-03). */}
                {signal.tone === 'even' ? 'Even' : signedMoneyCompact(signal.edge)}
              </Text>
            )}
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
                <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, styles.cellQuiet]}>No games yet</Text>
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
      {strip}
      {note}
      </>
    );
  }

  return (
    <>
    <View style={[styles.row, large && styles.rowLarge, dimmed && styles.rowDimmed]} {...rowMarker}>
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
              <Text maxFontSizeMultiplier={1.6} style={styles.surname}>{nameLine}</Text>
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
              <Text maxFontSizeMultiplier={1.6} style={styles.surname}>{nameLine}</Text>
            </View>
          )}
          {valueLine}
        </View>
      </Pressable>
      {action}
    </View>
    {strip}
    {note}
    </>
  );
}

export function PerGameMarketScreen({
  initialSide = 'long',
}: {
  initialSide?: PerGamePositionSide;
}) {
  const { bootstrap } = usePerGame();
  const { fontScale, height, width } = useWindowDimensions();
  const watchlist = useWatchlist();
  // Side, sort, search, Watching and your place in the list come back after a
  // tab switch or a rotation (marketViewMemory). A fresh request for a side
  // (the Roster's "Find a short") wins and starts that side at the top.
  const [remembered] = useState(() => {
    const saved = marketMemory();
    const openSide = openingSide({ initialSide, remembered: saved, requestedFromScreen: pressedInScreen() });
    rememberMarket({ lastInitialSide: initialSide });
    return openSide === saved.side ? saved : { ...saved, side: openSide, anchorId: null, offset: 0 };
  });
  const [query, setQuery] = useState(remembered.query);
  const [side, setSide] = useState<PerGamePositionSide>(remembered.side);
  const [sort, setSort] = useState<MarketSort>(remembered.sort);
  const [watchedOnly, setWatchedOnly] = useState(remembered.watchedOnly);
  // Unwatched while Watching is on: his row stays, dimmed, until the filter
  // changes, so one slip never loses him from view (walk 2: T2-06).
  const [kept, setKept] = useState<readonly string[]>([]);
  useEffect(() => {
    setKept((list) => (list.length > 0 ? [] : list));
  }, [watchedOnly]);
  const { isWatched, toggle: toggleWatchlist } = watchlist;
  const toggleWatch = useCallback((playerId: string) => {
    if (watchedOnly && isWatched(playerId)) setKept((list) => (list.includes(playerId) ? list : [...list, playerId]));
    toggleWatchlist(playerId);
  }, [isWatched, toggleWatchlist, watchedOnly]);
  const [reversed, setReversed] = useState(remembered.reversed);
  useEffect(() => {
    rememberMarket({ query, side, sort, reversed, watchedOnly });
  }, [query, side, sort, reversed, watchedOnly]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [controlsOpen, setControlsOpen] = useState(false);
  // A short window (a phone turned sideways) gets the phone rows, which label
  // their own figures, so the table only shows where its labels fit.
  const layout = marketLayout(width, fontScale, height);
  const folded = collapseControls(width);
  const columns = useMemo(() => marketColumns(width), [width]);
  const wide = layout === 'table';
  // On a tablet or desktop the toolbar and column labels stay put while the
  // rows scroll under them, so a row far down is never a column of unlabelled
  // numbers. Below 560px of height (a short laptop window) every row counts:
  // the explainer sentence goes (it is in Rules), the toolbar keeps to one
  // row, and it scrolls away with the list, column labels too (T2-21).
  const roomy = height >= ROOMY_MIN_HEIGHT;
  const pinned = wide && roomy;
  // A phone turned sideways has the width for the table's toolbar rows but
  // not the height for the stacked phone toolbar: two rows, so a third
  // player shows on arrival.
  const rowToolbar = wide || (layout === 'phone' && height < SHORT_WINDOW_BELOW && width >= 600);

  const allRows = useMemo(
    () => (bootstrap ? buildPerGameMarketRows(bootstrap, side) : []),
    [bootstrap, side],
  );
  const rows = useMemo(
    () => actionableFirst(sortMarketRows(
      filterMarketRows(allRows, { query, watchedOnly, watched: kept.length > 0 ? [...watchlist.watched, ...kept] : watchlist.watched }),
      sort,
      side,
      reversed,
    )),
    [allRows, query, side, sort, reversed, watchedOnly, watchlist.watched, kept],
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

  // Your place in the list: the first player you can see, and the offset.
  const listRef = useRef<FlatList<PerGameMarketRow>>(null);
  const place = useRef({ anchorId: remembered.anchorId, offset: remembered.offset });
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const widthRef = useRef(width);
  const retries = useRef(0);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    place.current.offset = event.nativeEvent.contentOffset.y;
  }, []);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((token) => token.isViewable);
    if (first) place.current.anchorId = (first.item as PerGameMarketRow).player.playerId;
  }).current;
  const scrollToPlayer = useCallback((playerId: string | null) => {
    const index = playerId ? rowsRef.current.findIndex((row) => row.player.playerId === playerId) : -1;
    if (index < 0) return;
    retries.current = 0;
    listRef.current?.scrollToIndex({ index, animated: false });
  }, []);
  // Coming back at the same width: the same offset. At a new width: the same
  // first player. Leaving: save both.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (remembered.offset <= 0) return;
      if (remembered.width === widthRef.current) listRef.current?.scrollToOffset({ offset: remembered.offset, animated: false });
      else scrollToPlayer(remembered.anchorId);
    }, 0);
    return () => {
      clearTimeout(timer);
      rememberMarket({ anchorId: place.current.anchorId, offset: place.current.offset, width: widthRef.current });
    };
  }, [remembered, scrollToPlayer]);
  // A rotation reflows every row: keep the same player at the top.
  useEffect(() => {
    if (widthRef.current === width) return undefined;
    widthRef.current = width;
    const anchor = place.current.anchorId;
    if (place.current.offset <= 0) return undefined;
    const timer = setTimeout(() => scrollToPlayer(anchor), 80);
    return () => clearTimeout(timer);
  }, [width, scrollToPlayer]);

  // Screen readers hear what a search, a cleared search or the Watching
  // filter did, once typing pauses; the new line replaces the old one.
  const searchText = query.trim();
  const resultCount = rows.length;
  const totalCount = allRows.length;
  const spokenOnce = useRef(false);
  const lastSearch = useRef(searchText);
  useEffect(() => {
    const cleared = lastSearch.current !== '' && searchText === '';
    lastSearch.current = searchText;
    if (!spokenOnce.current) {
      spokenOnce.current = true;
      return undefined;
    }
    const line = listCountLine({ query: searchText, count: resultCount, total: totalCount, watchedOnly, cleared });
    const timer = setTimeout(() => announce(line), 700);
    return () => clearTimeout(timer);
  }, [searchText, resultCount, totalCount, watchedOnly, announce]);
  // If the list empties under the keyboard (the focused row left and focus
  // fell to the page), focus the empty state's way out ("Show everyone",
  // "Clear search") instead of leaving the user at the top (walk 2: T3-27).
  const emptyAction = useRef<View>(null);
  const hadRows = useRef(resultCount > 0);
  useEffect(() => {
    const had = hadRows.current;
    hadRows.current = resultCount > 0;
    if (!had || resultCount > 0 || typeof document === 'undefined') return undefined;
    const timer = setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      (emptyAction.current as unknown as { focus?: () => void } | null)?.focus?.();
    }, 0);
    return () => clearTimeout(timer);
  }, [resultCount]);
  // Choosing the sort you are on flips its direction.
  const changeSort = useCallback((next: MarketSort) => {
    const flip = next === sort ? !reversed : false;
    setSort(next);
    setReversed(flip);
    announce(sortedLine(next, flip));
  }, [announce, reversed, sort]);

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
  const filtersOn = query.trim() !== '' || sort !== 'price' || reversed || watchedOnly;
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
        // "side" keeps these apart from the app's Roster tab, for ears and eyes.
        { key: 'long', label: 'Roster side', hint: positionSlotHint('long', bootstrap.account.longSlots.limit) },
        { key: 'short', label: 'Short side', hint: positionSlotHint('short', bootstrap.account.shortSlots.limit) },
      ]}
      // In the folded column a flex basis would become a height, so it only sizes rows.
      style={rowToolbar ? styles.sideToggleWide : folded ? undefined : styles.sideToggle}
      value={side}
    />
  );
  // The slot count, then at most one line: the season is over, or when the
  // roster reopens, or that this side is full. A locked roster never shows
  // "drop one to add", because drops are locked too.
  const slotStatus = (
    <View style={[styles.slotStatus, rowToolbar && styles.slotStatusWide, folded && styles.slotStatusFolded]}>
      <Text maxFontSizeMultiplier={1.4} style={styles.slotText}>{unbrokenTail(slotSummary(side, slots))}</Text>
      {status.kind === 'lock' ? (
        <View style={styles.lockLine}>
          <LockIcon />
          <Text maxFontSizeMultiplier={1.4} style={styles.lockText}>{unbrokenTail(status.text ?? '')}</Text>
        </View>
      ) : status.text ? (
        <Text maxFontSizeMultiplier={1.4} style={styles.fullText}>{unbrokenTail(status.text)}</Text>
      ) : null}
      {/* What a move costs, where the side is chosen (none while moves are locked or over). */}
      {status.kind === null || status.kind === 'full' ? (
        feeHint(side, fee) ? <Text maxFontSizeMultiplier={1.4} style={styles.feeText}>{feeHint(side, fee)}</Text> : null
      ) : null}
    </View>
  );
  const sortToggle = (
    <Segmented
      accessibilityLabel="Sort players"
      onChange={changeSort}
      options={marketSortOptions(sort, reversed)}
      style={rowToolbar ? styles.sortToggleWide : folded ? undefined : styles.sortToggle}
      value={sort}
    />
  );
  const watchingToggle = (
    <WatchingToggle count={watchlist.watched.length} on={watchedOnly} onChange={setWatchedOnly} />
  );
  const shortExplainer = side === 'short' && roomy ? (
    <Text maxFontSizeMultiplier={1.4} style={styles.explainer}>{SHORT_EXPLAINER}</Text>
  ) : null;
  // On a tablet or desktop each side explains itself in the same reserved
  // line, so switching sides never moves the table.
  const sideExplainer = (
    <Text maxFontSizeMultiplier={1.4} style={styles.explainer}>{side === 'short' ? SHORT_EXPLAINER : ROSTER_EXPLAINER}</Text>
  );

  const listHeader = (
    <View style={styles.header}>
      <View style={visuallyHidden}>
        <Text accessibilityRole="header" {...headingLevel(1)}>Market</Text>
      </View>
      {rowToolbar ? (
        <View style={[styles.controlsWide, !roomy && styles.controlsShort]}>
          {sideToggle}
          {slotStatus}
          <MarketSearch onChange={setQuery} style={[styles.searchWide, wide && !roomy && styles.searchShort]} value={query} />
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
      {reversed && (!folded || controlsOpen) ? (
        <View style={[styles.flipNote, wide && styles.flipNoteWide]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.flipText}>{flippedSortNote(sort).text}</Text>
          <Button label={flippedSortNote(sort).restore} onPress={() => changeSort(sort)} variant="quiet" />
        </View>
      ) : null}
      {wide && roomy ? <View style={styles.explainerWide}>{sideExplainer}</View> : null}
      {wide ? (
        <MarketColumnHeader
          // No button column at season end, so the labels line up with quiet rows.
          columns={rowActions(seasonOver) ? columns : { ...columns, action: 0 }}
          // One name for this figure everywhere: the toolbar's sort, this
          // header and its accessible name all say "Value".
          valueLabel="Value"
          lead={STAR_LEAD}
          onSort={changeSort}
          reversed={reversed}
          sort={sort}
        />
      ) : null}
    </View>
  );

  const trimmed = query.trim();
  const emptyState = watchedOnly && watchlist.watched.length === 0 ? (
    <EmptyState
      action={<Button ref={emptyAction} label="Show everyone" onPress={() => setWatchedOnly(false)} />}
      // Said for any input (click, tap, keyboard), and where the star is: on
      // each table row, or (phone rows have none) in the player's profile.
      copy={wide
        ? "Star a player with the ☆ on his row, or Watch in his profile, to keep him here."
        : "Open a player and use Watch to keep him here."}
      level={2}
      title="You're not watching anyone yet"
    />
  ) : trimmed ? (
    <EmptyState
      action={(
        <View style={styles.emptyActions}>
          <Button ref={emptyAction} label="Clear search" onPress={() => setQuery('')} variant="secondary" />
          {watchedOnly ? <Button label="Show everyone" onPress={clearFilters} variant="quiet" /> : null}
        </View>
      )}
      copy={watchedOnly
        ? 'None of the players you watch match that name.'
        : isMockActive()
          ? `Practice lists ${allRows.length} players, so some real players are not here. Clear the search to see them all.`
          : 'Check the spelling, or clear the search to see the whole market.'}
      level={2}
      title={isMockActive() && !watchedOnly ? `No listed player matches "${echoQuery(trimmed)}"` : `No players match "${echoQuery(trimmed)}"`}
    />
  ) : watchedOnly ? (
    <EmptyState
      action={<Button ref={emptyAction} label="Show everyone" onPress={() => setWatchedOnly(false)} />}
      copy="The players you watch are not listed right now."
      level={2}
      title="No watched players listed"
    />
  ) : (
    <EmptyState copy="Players appear here once prices are posted." level={2} title="The market is empty" />
  );

  return (
    <>
      {pinned ? listHeader : null}
      <FlatList
        contentContainerStyle={styles.content}
        data={rows}
        extraData={[layout, columns, positionValues, pastValues, fee, width, seasonOver, watchlist.watched, kept, watchedOnly]}
        initialNumToRender={18}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(row) => row.player.playerId}
        ListEmptyComponent={emptyState}
        ListHeaderComponent={pinned ? null : listHeader}
        onScroll={onScroll}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          // Rows further down are not laid out yet: jump near, then settle.
          listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
          if (retries.current < 2) {
            retries.current += 1;
            setTimeout(() => listRef.current?.scrollToIndex({ index, animated: false }), 80);
          }
        }}
        onViewableItemsChanged={onViewableItemsChanged}
        ref={listRef}
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
            onToggleWatch={toggleWatch}
            watched={watchlist.isWatched(item.player.playerId)}
            dimmed={watchedOnly && kept.includes(item.player.playerId) && !watchlist.isWatched(item.player.playerId)}
            onOpenProfile={openProfile}
            pastValue={item.position ? undefined : pastValues.get(item.player.playerId)}
            row={item}
          />
        )}
        scrollEventThrottle={100}
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
        onToggleWatch={profileId ? () => toggleWatch(profileId) : undefined}
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
    // Pinned above the list, it stays over the rows on the web.
    zIndex: 1,
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
  controlsShort: {
    // The phone toolbar's own inset, in a window with little height to spare.
    paddingVertical: 10,
  },
  sideToggle: {
    // Wide enough for "ROSTER SIDE" on one line; the slot count takes the rest.
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 218,
    minWidth: 200,
    maxWidth: 240,
  },
  sideToggleWide: {
    width: 236,
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
  feeText: {
    color: colors.muted,
    fontSize: type.label,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
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
  flipNote: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.sm,
  },
  flipNoteWide: {
    paddingHorizontal: space.lg,
  },
  flipText: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
  },
  explainer: {
    color: colors.muted,
    fontSize: type.caption,
    lineHeight: 17,
  },
  explainerWide: {
    // Two lines' room: the longer (short) sentence wraps once on a tablet.
    minHeight: 34,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    marginTop: -space.xs,
  },
  searchWide: {
    flexGrow: 1,
    flexBasis: 200,
  },
  searchShort: {
    // Gives way first, so the toolbar keeps to one row on a laptop.
    flexBasis: 140,
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
  rowDimmed: {
    opacity: 0.5,
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
    // The watch star sits before the avatar (see STAR_LEAD).
    paddingLeft: space.sm,
  },
  starCell: {
    width: control.height,
    minHeight: control.height,
    marginLeft: space.sm,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
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
  tierInline: {
    ...labelStyle,
    letterSpacing: 0.6,
  },
  chevron: {
    color: colors.faint,
    fontWeight: weight.bold,
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
    // "ADDED ✓" and "SEASON OVER" fit a 76px button on one and two lines.
    paddingHorizontal: 6,
  },
  buttonText: {
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  fullButton: {
    // Tappable (it explains itself) but reads as unavailable.
    opacity: 0.6,
  },
  stripTable: {
    // Under a wide row the strip keeps the row's inset and lines its buttons
    // up with the action column.
    paddingLeft: space.lg,
    paddingRight: space.lg,
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
