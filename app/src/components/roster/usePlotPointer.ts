import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform, type GestureResponderEvent, type ViewProps } from 'react-native';

/** How a reading was asked for: a mouse pointing, a finger tapping, or a finger sliding. */
export type PlotIntent = 'point' | 'tap' | 'slide';

export interface PlotPointerHandlers {
  /** x is in plot-local pixels. */
  onRead: (x: number, intent: PlotIntent) => void;
  /** The mouse left the plot: go back to the latest reading. */
  onLeave: () => void;
  /** Arrow keys, Home, End, Escape. Return true when the key was used. */
  onKey: (key: string) => boolean;
}

/** A slide must travel this far sideways before it counts, so a tap stays a tap. */
const SLIDE_THRESHOLD = 6;

/**
 * Pointer, touch and keyboard input for a chart plot.
 *
 * Web listens on the real DOM node: react-native-web's responder events do not
 * give a trustworthy x inside an SVG (it is relative to whichever path was
 * hit), so x is measured from `clientX` against the plot's own rectangle.
 *  - Mouse: moving reads a night; leaving goes back to the latest.
 *  - Touch and pen: a tap reads a night and the reading stays after the finger
 *    lifts; sliding sideways scrubs. `touch-action: pan-y` keeps vertical
 *    swipes scrolling the page.
 *  - Keyboard: the plot is a tab stop and the caller maps the keys.
 * Native uses the responder system, where `locationX` is relative to the plot
 * because the SVG inside ignores touches, and hands the gesture back to the
 * scroll view as soon as it asks.
 */
export function usePlotPointer(handlers: PlotPointerHandlers): {
  ref: (instance: unknown) => void;
  responderProps: Partial<ViewProps>;
} {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  const cleanup = useRef<(() => void) | null>(null);
  const ref = useCallback((instance: unknown) => {
    cleanup.current?.();
    cleanup.current = null;
    const node = instance as HTMLElement | null;
    if (Platform.OS !== 'web' || !node || typeof node.addEventListener !== 'function') return;

    node.style.touchAction = 'pan-y';
    node.style.cursor = 'crosshair';
    let startX: number | null = null;
    let sliding = false;
    const xOf = (event: PointerEvent) => event.clientX - node.getBoundingClientRect().left;

    const down = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;
      startX = xOf(event);
      sliding = false;
      latest.current.onRead(startX, 'tap');
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') {
        latest.current.onRead(xOf(event), 'point');
        return;
      }
      if (startX === null) return;
      const x = xOf(event);
      if (!sliding && Math.abs(x - startX) < SLIDE_THRESHOLD) return;
      sliding = true;
      latest.current.onRead(x, 'slide');
    };
    const up = () => {
      startX = null;
    };
    const leave = (event: PointerEvent) => {
      startX = null;
      if (event.pointerType === 'mouse') latest.current.onLeave();
    };
    const key = (event: KeyboardEvent) => {
      if (latest.current.onKey(event.key)) event.preventDefault();
    };

    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('pointerleave', leave);
    node.addEventListener('keydown', key);
    cleanup.current = () => {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.removeEventListener('pointerleave', leave);
      node.removeEventListener('keydown', key);
    };
  }, []);

  useEffect(() => () => cleanup.current?.(), []);

  const responderProps = useMemo<Partial<ViewProps>>(() => {
    if (Platform.OS === 'web') return {};
    return {
      onStartShouldSetResponder: () => true,
      onResponderTerminationRequest: () => true,
      onResponderGrant: (event: GestureResponderEvent) => {
        latest.current.onRead(event.nativeEvent.locationX, 'tap');
      },
      onResponderMove: (event: GestureResponderEvent) => {
        latest.current.onRead(event.nativeEvent.locationX, 'slide');
      },
    };
  }, []);

  return { ref, responderProps };
}
