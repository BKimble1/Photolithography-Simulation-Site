/** Small animation helpers shared by the tool scenes (all deterministic in progress p). */
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { useClock } from '../state/store';

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** 0..1 ramp of p across [a, b]. */
export const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeIn = (t: number) => t * t * t;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (p: number, a: number, b: number) => ease(seg(p, a, b));

/** Current animation progress, read without re-rendering (use inside useFrame). */
export function progressNow(): number {
  return useClock.getState().progress;
}

/**
 * Calls fn(p, t) every frame with the step progress p and the elapsed clock time t.
 * Use it to drive transforms directly on refs.
 */
export function useProgressFrame(fn: (p: number, t: number, dt: number) => void) {
  const cb = useRef(fn);
  cb.current = fn;
  useFrame((state, dt) => cb.current(useClock.getState().progress, state.clock.elapsedTime, dt));
}

/** Coarse React-visible progress bucket, for switching meshes at thresholds. */
export function useProgressBucket(steps = 20): number {
  return useClock((c) => Math.floor(c.progress * steps) / steps);
}
