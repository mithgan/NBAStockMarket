import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { Player } from '../data/types';
import { colors, fonts, radius, weight } from '../theme';

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
}

/**
 * Rectangular tinted headshot tile rather than a circular avatar — this is the
 * player-card shape used across databallr.com's draft boards, and the flat crop
 * keeps a column of 300 faces aligned. Falls back to initials when the ESPN
 * headshot 404s.
 */
export function PlayerAvatar({ player, size = 38 }: { player: Player; size?: number }) {
  const [failed, setFailed] = useState(false);

  return (
    // Every caller renders the player's name in text right next to the tile,
    // so the whole subtree is hidden from assistive tech to avoid announcing
    // each face twice.
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.avatar, { width: size, height: size }]}
    >
      {failed ? (
        <Text
          maxFontSizeMultiplier={1.2}
          style={[styles.avatarInitials, { fontSize: Math.max(11, Math.round(size * 0.34)) }]}
        >
          {initials(player.name)}
        </Text>
      ) : (
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel={`${player.name} headshot`}
          onError={() => setFailed(true)}
          resizeMode="cover"
          source={{ uri: `https://a.espncdn.com/i/headshots/nba/players/full/${player.id}.png` }}
          style={{ width: size, height: size * 1.16, marginTop: size * 0.1 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
  },
  avatarInitials: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontWeight: weight.heavy,
  },
});
