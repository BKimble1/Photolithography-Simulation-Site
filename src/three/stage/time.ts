/**
 * Stage time. Normally wall-clock; with ?virt=1 (test and recording harness only) every
 * rendered frame advances time by exactly 1/30 s and frames are rendered on request, so
 * transitions can be captured frame by frame even on a slow software renderer.
 */
export const VIRTUAL_TIME = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('virt') === '1';

export const stageTime = {
  virtual: VIRTUAL_TIME,
  /** Virtual seconds elapsed. */
  t: 0,
  dt: 1 / 30,
  /** Milliseconds, like performance.now(). */
  now(): number {
    return this.virtual ? this.t * 1000 : performance.now();
  },
};
