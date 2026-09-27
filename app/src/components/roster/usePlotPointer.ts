import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform, type GestureResponderEvent, type ViewProps } from 'react-native';

import { chartTouchIsTap, chartTouchMove } from '../../data/rosterView';

/** How a reading was asked for: a mouse pointing or clicking, a finger tapping, or a finger sliding. */
export type PlotIntent = 'point' | 'click' | 'tap' | 'slide';

export interface PlotPointerHandlers {
  /** x is in plot-local pixels. */
  onRead: (x: number, intent: PlotIntent) => void;
  /** The mouse left the plot: go back to the latest reading. */
  onLeave: () => void;
  /** Arrow keys, Home, End, Escape. Return true when the key was used. */
  onKey: (key: string) => boolean;
}

/**
 * Pointer, touch and keyboard input for a chart plot.
 *
 * Web listens on the real DOM node: react-native-web's responder events do not
 * give a trustworthy x inside an SVG (it is relative to whichever path was
 * hit), so x is measured from `clientX` against the plot's own rectangle.
 *  - Mouse: moving reads a night; a click pins it (walk 9 T2-N3); leaving
 *    goes back to the pinned one, or the latest.
 *  - Touch and pen: a tap reads a night when the finger lifts, and the
 *    reading stays; a mostly sideways drag scrubs. A touch that goes up or
 *    down is the page's scroll and never selects a night (walk 5 T1-21):
 *    `touch-action: pan-y` hands it to the browser, which then cancels it.
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
    // Where the finger landed, and what the touch has turned out to be.
    let start: { x: number; y: number } | null = null;
    let mode: 'wait' | 'slide' | 'scroll' = 'wait';
    const xOf = (event: PointerEvent) => event.clientX - node.getBoundingClientRect().left;
    const yOf = (event: PointerEvent) => event.clientY - node.getBoundingClientRect().top;

    const down = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;
      start = { x: xOf(event), y: yOf(event) };
      mode = 'wait';
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') {
        latest.current.onRead(xOf(event), 'point');
        return;
      }
      if (start === null || mode === 'scroll') return;
      const x = xOf(event);
      mode = chartTouchMove(x - start.x, yOf(event) - start.y, mode === 'slide');
      if (mode === 'slide') latest.current.onRead(x, 'slide');
    };
    const up = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') {
        if (event.button === 0) latest.current.onRead(xOf(event), 'click');
        return;
      }
      if (start !== null && event.pointerType !== 'mouse' && mode === 'wait'
        && chartTouchIsTap(xOf(event) - start.x, yOf(event) - start.y)) {
        latest.current.onRead(start.x, 'tap');
      }
      start = null;
    };
    // The browser took the touch for a scroll: nothing is selected.
    const cancel = () => {
      start = null;
    };
    const leave = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') latest.current.onLeave();
    };
    const key = (event: KeyboardEvent) => {
      if (latest.current.onKey(event.key)) event.preventDefault();
    };

    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', cancel);
    node.addEventListener('pointerleave', leave);
    node.addEventListener('keydown', key);
    cleanup.current = () => {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', cancel);
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
