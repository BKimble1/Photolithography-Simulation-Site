/**
 * Stage time. Normally wall-clock; with ?virt=1 (test and recording harness only) every
 * rendered frame advances time by exactly 1/30 s and frames are rendered on request, so
 * transitions can be captured frame by frame even on a slow software renderer.
 */
export const VIRTUAL_TIME = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('virt') === '1';

/** Test hooks (window.__fab*): in development, with ?virt=1, or with ?hooks=1 — never otherwise. */
export const TEST_HOOKS =
  typeof window !== 'undefined' && (import.meta.env.DEV || VIRTUAL_TIME || new URLSearchParams(window.location.search).get('hooks') === '1');

export const stageTime = {
  virtual: VIRTUAL_TIME,
  /** Virtual seconds elapsed. */
  t: 0,
  dt: 1 / 30,
  /** Milliseconds, like performance.now(). */
  now(): number {
    return this.virtual ? this.t * 1000 : performance.now();
  },
  /** Called before each harness frame (the film clock ticks here in virtual time). */
  beforeFrame: null as null | (() => void),
};

// Test harness: advance virtual time without rendering (the film clock and its captions only).
if (VIRTUAL_TIME)
  (window as unknown as { __fabTick: (n?: number) => number }).__fabTick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      stageTime.t += stageTime.dt;
      stageTime.beforeFrame?.();
    }
    return stageTime.t;
  };
