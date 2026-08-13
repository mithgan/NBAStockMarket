import { useEffect, useRef, useState } from 'react';

import { useReducedMotion } from './useReducedMotion';

/**
 * Eases a displayed number toward `target` with an ease-out cubic over
 * `durationMs`. Values only animate on *change* — the first paint shows the
 * real number immediately, so a screen never opens mid-count.
 *
 * When the viewer prefers reduced motion, when the caller disables it, or when
 * rAF is unavailable (SSR), the hook is a pass-through: it returns `target`
 * directly so there is not even a one-frame stale render.
 */
export function useCountUp(target: number, disabled = false, durationMs = 620): number {
  const reducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(target);
  // The value the animation last settled on — the start point of the next run.
  const settled = useRef(target);
  const frame = useRef<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const idle = useRef(true);

  useEffect(() => {
    const cancel = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      startedAt.current = null;
    };

    if (reducedMotion || disabled || typeof requestAnimationFrame !== 'function') {
      cancel();
      settled.current = target;
      setDisplay(target);
      return;
    }
    // Nothing changed since the last completed run: skip, so mounting (or an
    // unrelated dep change) never replays the count.
    if (idle.current && settled.current === target) return;

    const from = settled.current;
    const delta = target - from;
    if (delta === 0) {
      cancel();
      setDisplay(target);
      return;
    }

    idle.current = false;
    const step = (now: number) => {
      if (startedAt.current === null) startedAt.current = now;
      const elapsed = now - startedAt.current;
      const progress = Math.min(1, elapsed / durationMs);
      const value = from + delta * (1 - (1 - progress) ** 3);
      setDisplay(progress === 1 ? target : value);
      if (progress < 1) {
        frame.current = requestAnimationFrame(step);
      } else {
        settled.current = target;
        idle.current = true;
        cancel();
      }
    };
    cancel();
    frame.current = requestAnimationFrame(step);

    // Failsafe: background tabs throttle rAF, and a count-up that never lands
    // would leave a wrong number on screen. Snap to the target shortly after
    // the animation should have finished no matter what.
    const failsafe = setTimeout(() => {
      cancel();
      settled.current = target;
      idle.current = true;
      setDisplay(target);
    }, durationMs + 150);

    return () => {
      clearTimeout(failsafe);
      cancel();
    };
  }, [durationMs, disabled, reducedMotion, target]);

  return disabled || reducedMotion ? target : display;
}
