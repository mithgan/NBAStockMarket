import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, type LayoutChangeEvent } from 'react-native';

export interface ChartSurfaceHandlers {
  /** Pointer x offset in surface-local pixels, ready for nearestPointIndex. */
  onScrub: (offsetX: number) => void;
  onScrubEnd: () => void;
}

export interface ChartSurface {
  /** Live rendered width of the surface, rounded to whole pixels. */
  width: number;
  /** Callback ref for the chart's wrapping View. */
  ref: (instance: unknown) => void;
  /** Native measurement path; a no-op on web where the DOM is measured directly. */
  onLayout: (event: LayoutChangeEvent) => void;
}

/**
 * Wires a chart's wrapping View for hover scrubbing and keeps its rendered
 * width live.
 *
 * react-native-web's synthetic events never expose offsetX, and its Pressable
 * swallows pointer moves, so the surface listens on the real DOM node instead:
 * a callback ref grabs the element, attaches pointermove/pointerleave/
 * pointercancel, and measures it. The width is re-measured on the next frame
 * (the ref can fire before layout settles) and tracked by a ResizeObserver so
 * rotations and split-screen resizes keep the plot honest.
 *
 * The scrub handlers live in refs so the DOM listeners bind exactly once per
 * node; callers can pass fresh closures every render without the listeners
 * being torn down and re-attached.
 */
export function useChartSurface({ onScrub, onScrubEnd }: ChartSurfaceHandlers): ChartSurface {
  const [width, setWidth] = useState(0);
  const scrubRef = useRef(onScrub);
  const scrubEndRef = useRef(onScrubEnd);
  useEffect(() => {
    scrubRef.current = onScrub;
    scrubEndRef.current = onScrubEnd;
  }, [onScrub, onScrubEnd]);

  const cleanupRef = useRef<(() => void) | null>(null);

  const ref = useCallback((instance: unknown) => {
    cleanupRef.current?.();
    cleanupRef.current = null;

    const node = instance as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;

    const measure = () => {
      const next = Math.round(node.getBoundingClientRect().width);
      setWidth((previous) => (previous === next ? previous : next));
    };
    measure();
    const frame = requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);

    const handleMove = (event: PointerEvent) => scrubRef.current(event.offsetX);
    const handleLeave = () => scrubEndRef.current();
    node.addEventListener('pointermove', handleMove);
    node.addEventListener('pointerleave', handleLeave);
    node.addEventListener('pointercancel', handleLeave);

    cleanupRef.current = () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      node.removeEventListener('pointermove', handleMove);
      node.removeEventListener('pointerleave', handleLeave);
      node.removeEventListener('pointercancel', handleLeave);
    };
  }, []);

  useEffect(() => () => cleanupRef.current?.(), []);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    // Web already measures the DOM node directly; onLayout is the path that
    // keeps width honest on native, where there is no ResizeObserver.
    if (Platform.OS === 'web') return;
    setWidth(Math.round(event.nativeEvent.layout.width));
  }, []);

  return { width, ref, onLayout };
}
