import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, weight } from '../theme';

/** The minimal identity a headshot needs; the full Player satisfies it. */
interface AvatarPlayer {
  id: string;
  name: string;
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
}

/**
 * The headshot at the size the tile shows it (three times over, for sharp
 * phone screens) through ESPN's resizer: the full image is about 250KB, this
 * is 10 to 30 times smaller, so a market list of faces loads quickly on a
 * phone connection. Same aspect as the original, so nothing is cropped.
 */
function headshotUri(id: string, size: number): string {
  const height = Math.min(760, Math.ceil((size * 1.16 * 3) / 10) * 10);
  const width = Math.round((height * 1040) / 760);
  return `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=${width}&h=${height}&scale=crop`;
}

/**
 * Rectangular tinted headshot tile rather than a circular avatar — this is the
 * player-card shape used across databallr.com's draft boards, and the flat crop
 * keeps a column of 300 faces aligned. Falls back to initials when the ESPN
 * headshot 404s.
 */
export function PlayerAvatar({ player, size = 38 }: { player: AvatarPlayer; size?: number }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  return (
    // Every caller renders the player's name in text right next to the tile,
    // so the whole subtree is hidden from assistive tech to avoid announcing
    // each face twice.
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.avatar, { width: size, height: size }]}
    >
      {/* Initials sit underneath until the photo arrives (and stay if it never
          does), so a slow network shows a name, not an empty square. */}
      {loaded ? null : (
        <Text
          maxFontSizeMultiplier={1.2}
          style={[styles.avatarInitials, { fontSize: Math.max(11, Math.round(size * 0.34)) }]}
        >
          {initials(player.name)}
        </Text>
      )}
      {failed ? null : (
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel={`${player.name} headshot`}
          onError={() => setFailed(true)}
          onLoad={() => setLoaded(true)}
          resizeMode="cover"
          source={{ uri: headshotUri(player.id, size) }}
          style={[
            styles.photo,
            { width: size, height: size * 1.16, top: size * 0.1, opacity: loaded ? 1 : 0 },
          ]}
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
  photo: {
    position: 'absolute',
    left: 0,
  },
  avatarInitials: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontWeight: weight.heavy,
  },
});
