/**
 * Stage time. Normally wall-clock; with ?virt=1 (test and recording harness only) every
 * rendered frame advances time by exactly 1/30 s and frames are rendered on request, so
 * transitions can be captured frame by frame even on a slow software renderer.
 *
 * Three clocks, all derived from the same source:
 *   now()    the page clock (ms). The film's silent moves run on it; it keeps going in a
 *            background tab, like the film's sound does.
 *   clock()  the stage clock (ms): stops while the page is hidden, so a camera move, a lesson
 *            or a demonstration resumes where it was when the viewer comes back. Everything
 *            the director and the lesson clocks time is measured on it.
 *   decor    decorative time (s) for motion that tells no process story (fans, flicker, the
 *            overhead vehicles): the stage clock, or the film's own time while the film is on
 *            screen, so a seek in Watch shows exactly the frame that playing would. Set once
 *            per frame; scenes read it instead of three.js' clock.
 */
export const VIRTUAL_TIME = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('virt') === '1';

/** Test hooks (window.__fab*): in development, with ?virt=1, or with ?hooks=1 — never otherwise. */
export const TEST_HOOKS =
  typeof window !== 'undefined' && (import.meta.env.DEV || VIRTUAL_TIME || new URLSearchParams(window.location.search).get('hooks') === '1');

let hiddenAt: number | null = null;
let hiddenTotal = 0;
if (typeof document !== 'undefined') {
  const onVisibility = () => {
    const t = performance.now();
    if (document.hidden) {
      if (hiddenAt === null) hiddenAt = t;
    } else if (hiddenAt !== null) {
      hiddenTotal += t - hiddenAt;
      hiddenAt = null;
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  onVisibility();
}

export const stageTime = {
  virtual: VIRTUAL_TIME,
  /** Virtual seconds elapsed. */
  t: 0,
  dt: 1 / 30,
  /** The page clock, milliseconds, like performance.now(). */
  now(): number {
    return this.virtual ? this.t * 1000 : performance.now();
  },
  /** The stage clock, milliseconds: the page clock minus the time the page spent hidden. */
  clock(): number {
    if (this.virtual) return this.t * 1000;
    return (hiddenAt ?? performance.now()) - hiddenTotal;
  },
  /** Decorative time in seconds (see above); updated at the start of every frame. */
  decor: 0,
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
