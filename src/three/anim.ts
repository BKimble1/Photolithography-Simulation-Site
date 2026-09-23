/**
 * Small animation helpers shared by the tool scenes. Everything that tells the process story
 * is a pure function of the presented step progress p, so scrubbing, seeking and Watch's media
 * clock all reconstruct the same frame. Wall-clock time is only for decorative motion, and it
 * stops under reduced motion.
 */
import { useFrame } from '@react-three/fiber';
import { useRef, useSyncExternalStore } from 'react';
import { useClock } from '../state/store';
import { useProgressSource, useReducedMotion } from '../state/presentation';

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** 0..1 ramp of p across [a, b]. */
export const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeIn = (t: number) => t * t * t;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (p: number, a: number, b: number) => ease(seg(p, a, b));

/** Lesson progress, read without re-rendering (legacy helper; scenes use useProgressFrame). */
export function progressNow(): number {
  return useClock.getState().progress;
}

/**
 * Calls fn(p, t, dt) every frame with the presented step progress p and a decorative clock t
 * (seconds; frozen under reduced motion). Use it to drive transforms directly on refs.
 */
export function useProgressFrame(fn: (p: number, t: number, dt: number) => void) {
  const src = useProgressSource();
  const reduced = useReducedMotion();
  const cb = useRef(fn);
  cb.current = fn;
  useFrame((state, dt) => cb.current(src.get(), reduced ? 0 : state.clock.elapsedTime, reduced ? 0 : dt));
}

/** Coarse React-visible progress bucket, for switching meshes at thresholds. */
export function useProgressBucket(steps = 20): number {
  const src = useProgressSource();
  const get = () => Math.floor(src.get() * steps) / steps;
  return useSyncExternalStore(src.subscribe, get, get);
}
