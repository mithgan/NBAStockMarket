/**
 * Tab icons for the narrowest windows (a phone at 400% zoom), where the tab
 * labels would be cut to "Ro… M… Re… Le…" (walk 3 T3-06). Same 24-unit grid
 * and round-capped 2px stroke as the chrome icons; colours come from the
 * caller. The tab keeps its full name for screen readers.
 */
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

type IconProps = { color: string; size?: number };

const STROKE = 2;

/** A player: your roster. */
export function RosterTabIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Circle cx={12} cy={8} fill="none" r={3.5} stroke={color} strokeWidth={STROKE} />
      <Path d="M5 20 C5 15.5 8.2 13.5 12 13.5 C15.8 13.5 19 15.5 19 20" fill="none" stroke={color} strokeLinecap="round" strokeWidth={STROKE} />
    </Svg>
  );
}

/** Bars of different heights: the market's prices. */
export function MarketTabIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Line stroke={color} strokeLinecap="round" strokeWidth={STROKE} x1={6} x2={6} y1={19} y2={12} />
      <Line stroke={color} strokeLinecap="round" strokeWidth={STROKE} x1={12} x2={12} y1={19} y2={6} />
      <Line stroke={color} strokeLinecap="round" strokeWidth={STROKE} x1={18} x2={18} y1={19} y2={9} />
    </Svg>
  );
}

/** A list of nights: the results. */
export function ResultsTabIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Circle cx={6} cy={7} fill={color} r={1.5} />
      <Circle cx={6} cy={12} fill={color} r={1.5} />
      <Circle cx={6} cy={17} fill={color} r={1.5} />
      <Line stroke={color} strokeLinecap="round" strokeWidth={STROKE} x1={10} x2={19} y1={7} y2={7} />
      <Line stroke={color} strokeLinecap="round" strokeWidth={STROKE} x1={10} x2={19} y1={12} y2={12} />
      <Line stroke={color} strokeLinecap="round" strokeWidth={STROKE} x1={10} x2={16} y1={17} y2={17} />
    </Svg>
  );
}

/** A podium: the leaders. */
export function LeadersTabIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Rect fill="none" height={10} stroke={color} strokeLinejoin="round" strokeWidth={STROKE} width={6} x={9} y={9} />
      <Rect fill="none" height={6} stroke={color} strokeLinejoin="round" strokeWidth={STROKE} width={5} x={3.5} y={13} />
      <Rect fill="none" height={4} stroke={color} strokeLinejoin="round" strokeWidth={STROKE} width={5} x={15.5} y={15} />
    </Svg>
  );
}
