/**
 * The few glyphs the market and the player profile draw. SVG rather than
 * font characters so they render the same on every platform and pick up the
 * theme's colour tokens.
 */
import { View } from 'react-native';
import Svg, { Circle, Line, Path, Polygon, Rect } from 'react-native-svg';

import { colors } from '../../theme';

/** Watchlist star: filled gold when watching, an outline when not. */
export function StarIcon({ filled, size = 18 }: { filled: boolean; size?: number }) {
  return (
    <Svg height={size} viewBox="0 0 18 18" width={size}>
      <Polygon
        fill={filled ? colors.gold : 'none'}
        points="9,1.6 11.2,6.6 16.6,7.2 12.6,10.9 13.7,16.2 9,13.5 4.3,16.2 5.4,10.9 1.4,7.2 6.8,6.6"
        stroke={filled ? colors.gold : colors.muted}
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </Svg>
  );
}

/** A plain cross for close and clear controls. */
export function CloseIcon({ size = 16, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg height={size} viewBox="0 0 16 16" width={size}>
      <Line stroke={color} strokeLinecap="round" strokeWidth={1.8} x1={3} x2={13} y1={3} y2={13} />
      <Line stroke={color} strokeLinecap="round" strokeWidth={1.8} x1={13} x2={3} y1={3} y2={13} />
    </Svg>
  );
}

/** A padlock for the roster-lock warning. Decorative: the words beside it say it. */
export function LockIcon({ color = colors.goldInk }: { color?: string }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg height={11} viewBox="0 0 10 12" width={9}>
        <Path d="M2.6 5.2V3.6a2.4 2.4 0 0 1 4.8 0v1.6" fill="none" stroke={color} strokeWidth={1.5} />
        <Rect fill={color} height={6.6} rx={1.3} width={8.4} x={0.8} y={5} />
      </Svg>
    </View>
  );
}

/** Magnifier shown inside the search field. Decorative. */
export function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg height={size} viewBox="0 0 16 16" width={size}>
      <Circle cx={7} cy={7} fill="none" r={4.8} stroke={colors.faint} strokeWidth={1.6} />
      <Line stroke={colors.faint} strokeLinecap="round" strokeWidth={1.6} x1={10.6} x2={14} y1={10.6} y2={14} />
    </Svg>
  );
}
