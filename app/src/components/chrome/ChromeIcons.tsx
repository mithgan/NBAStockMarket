/**
 * Line icons for the chrome's controls, drawn on a 24-unit grid with the same
 * round-capped stroke as the Settings icon so the frame reads as one set.
 * Colours are passed in from `colors.*`; nothing here hard-codes a colour.
 */
import { View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

type IconProps = { color: string; size?: number };

const STROKE = 2;

/** A page of rules: the game rules sheet. */
export function RulesIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Rect fill="none" height={17} rx={2} stroke={color} strokeWidth={STROKE} width={14} x={5} y={3.5} />
      <Line stroke={color} strokeLinecap="round" strokeWidth={STROKE} x1={8.5} x2={15.5} y1={8.5} y2={8.5} />
      <Line stroke={color} strokeLinecap="round" strokeWidth={STROKE} x1={8.5} x2={15.5} y1={12} y2={12} />
      <Line stroke={color} strokeLinecap="round" strokeWidth={STROKE} x1={8.5} x2={12.5} y1={15.5} y2={15.5} />
    </Svg>
  );
}

/** A clockwise arrow closing on itself: fetch the latest games and prices. */
export function RefreshIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Path
        d="M18.06 8.5 A7 7 0 1 1 13.22 5.11"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeWidth={STROKE}
      />
      <Path d="M16.6 5.7 L12.7 7.9 L13.5 3.1 Z" fill={color} stroke={color} strokeLinejoin="round" strokeWidth={1} />
    </Svg>
  );
}

/** Play: start a practice season. */
export function PracticeIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Path d="M8 5.5 L18.5 12 L8 18.5 Z" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={STROKE} />
    </Svg>
  );
}

/** Three dots: more controls behind this one. */
export function MoreIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Circle cx={5.5} cy={12} fill={color} r={2} />
      <Circle cx={12} cy={12} fill={color} r={2} />
      <Circle cx={18.5} cy={12} fill={color} r={2} />
    </Svg>
  );
}

/** Two sliders: Settings, in the folded frame where the brand bar is hidden. */
export function SettingsIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Line stroke={color} strokeLinecap="round" strokeWidth={STROKE} x1={3.5} x2={20.5} y1={7.5} y2={7.5} />
      <Line stroke={color} strokeLinecap="round" strokeWidth={STROKE} x1={3.5} x2={20.5} y1={16.5} y2={16.5} />
      <Circle cx={15} cy={7.5} fill="none" r={3} stroke={color} strokeWidth={STROKE} />
      <Circle cx={9} cy={16.5} fill="none" r={3} stroke={color} strokeWidth={STROKE} />
    </Svg>
  );
}

/**
 * A padlock: roster moves are paused for the next games. Standing alone it
 * is an image named by `label` ("Roster locked until after Nov 1"); beside
 * words that already say it, it is hidden from screen readers rather than
 * read as an unnamed "image" (walk 3 T3-29).
 */
export function LockIcon({ color, size = 12, label }: IconProps & { label?: string }) {
  const icon = (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Rect fill="none" height={10} rx={2} stroke={color} strokeWidth={2.5} width={15} x={4.5} y={10.5} />
      <Path d="M8 10.5 V7.5 a4 4 0 0 1 8 0 V10.5" fill="none" stroke={color} strokeLinecap="round" strokeWidth={2.5} />
    </Svg>
  );
  return label ? <View aria-label={label} role="img">{icon}</View> : <View aria-hidden>{icon}</View>;
}
