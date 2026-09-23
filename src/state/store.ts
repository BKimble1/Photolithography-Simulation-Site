/**
 * App state: one explicit mode, the learning run, and viewer preferences.
 *
 *   mode      home | learn | explore | watch   (what the viewer is doing)
 *   step      the lesson in the learning run    (changes only by explicit lesson navigation)
 *   scale     never stored as navigation: the director picks it from the step's shots; the
 *             learner may only override it for the current step ("Inspect layers" / "Back to
 *             equipment"), which never changes step, choices, checks or the simulation.
 *   machine   the machine focused in Explore (separate from the lesson)
 *
 * Entering Explore or Watch from a lesson takes a snapshot of the lesson (step, clock,
 * camera, overlays); returning restores it exactly and offers Resume instead of auto-playing.
 * Watch runs its own canonical film and never writes to the learning run.
 */

import { create } from 'zustand';
import { TEST_HOOKS } from '../three/stage/time';
import { STEPS, type ViewLevel } from '../content/steps';
import { FLOW, STEP_INDEX, type StepId } from '../sim/flow';
import { DEFAULT_CHOICES, type Choices } from '../sim/types';
import { searchFor, targetFromSearch, writeUrl, type MachineId, type Mode, type NavTarget } from './nav';
import { DEFAULT_PREFS, loadSaved, readSession, writeSaved, writeSession, type CheckAnswer, type SavedPrefs } from './persist';

export type { CheckAnswer } from './persist';
export type { MachineId, Mode, NavTarget } from './nav';

export type ScaleId = ViewLevel; // 'fab' | 'tool' | 'wafer' | 'device'

export type Panel = null | 'chapters' | 'closer' | 'compare' | 'recap' | 'euv' | 'legend' | 'equipment' | 'offline';

export type V3 = [number, number, number];
export interface CamPose {
  space: 'world' | 'device';
  pos: V3;
  target: V3;
}

export interface LearnSnapshot {
  step: number;
  progress: number;
  playing: boolean;
  scaleOverride: ScaleId | null;
  panel: Panel;
  camera: CamPose | null;
  lightPath: boolean;
  xray: boolean;
  cutaway: boolean;
  finalInput: 0 | 1;
}

export interface AppState {
  mode: Mode;
  /** Where Explore / Watch return to when closed. */
  cameFrom: Mode;

  // ── learning run (saved) ──
  step: number;
  maxStep: number;
  visited: number[];
  choices: Choices;
  checks: Partial<Record<string, CheckAnswer>>;

  // ── lesson session ──
  panel: Panel;
  scaleOverride: ScaleId | null;
  lightPath: boolean;
  xray: boolean;
  cutaway: boolean;
  finalInput: 0 | 1;
  /** A step the learner jumped back from (to offer "return"). */
  returnTo: number | null;
  banner: string | null;
  /** Set after returning from Explore/Watch to a lesson that was playing: offer Resume. */
  resumeFrom: 'explore' | 'watch' | null;
  learnSnapshot: LearnSnapshot | null;

  // ── explore ──
  machine: MachineId | null;
  demo: boolean;

  // ── viewer ──
  prefs: SavedPrefs;
  reducedMotion: boolean;
  fast: boolean;

  navigate: (t: NavTarget, how?: 'push' | 'replace' | 'none') => void;
  goTo: (step: number, opts?: { keepReturn?: boolean; banner?: string | null; history?: 'push' | 'replace' | 'none' }) => void;
  next: () => void;
  prev: () => void;
  setScaleOverride: (s: ScaleId | null) => void;
  setChoice: <K extends keyof Choices>(k: K, v: Choices[K]) => void;
  resetChoice: (k: keyof Choices) => void;
  answer: (id: string, a: CheckAnswer) => void;
  setPanel: (p: Panel) => void;
  toggle: (k: 'lightPath' | 'xray' | 'cutaway') => void;
  setFinalInput: (v: 0 | 1) => void;
  rework: (layer: 'gate' | 'contact') => void;
  dismissBanner: () => void;
  dismissResume: () => void;
  setPrefs: (p: Partial<SavedPrefs>) => void;
}

// ───────────────────────────── animation clock (high frequency) ─────────────────────────────

export interface ClockState {
  progress: number;
  playing: boolean;
  /** Start playing once the camera has arrived at the step (set on lesson change). */
  pendingPlay: boolean;
  /** Bumped when the learner scrubbed or the step changed; scenes may snap instead of easing. */
  epoch: number;
  set: (p: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  restart: () => void;
}

export const useClock = create<ClockState>((set, get) => ({
  progress: 0,
  playing: false,
  pendingPlay: false,
  epoch: 0,
  set: (p) => set({ progress: Math.max(0, Math.min(1, p)), pendingPlay: false, epoch: get().epoch + 1 }),
  play: () => {
    set({ playing: true, pendingPlay: false, progress: get().progress >= 1 ? 0 : get().progress });
    useApp.setState({ resumeFrom: null });
  },
  pause: () => set({ playing: false, pendingPlay: false }),
  toggle: () => (get().playing ? get().pause() : get().play()),
  restart: () => {
    set({ progress: 0, playing: true, pendingPlay: false, epoch: get().epoch + 1 });
    useApp.setState({ scaleOverride: null, resumeFrom: null });
  },
}));

// ───────────────────────────── camera bridge (set by the director) ─────────────────────────────

/** The director registers how to read and restore the live camera pose. */
export const cameraBridge: { get: () => CamPose | null; restore: (p: CamPose) => void } = {
  get: () => null,
  restore: () => {},
};

// ───────────────────────────── start-up ─────────────────────────────

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function params(): URLSearchParams {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
}

const clamp = (v: number, lo: number, hi: number, d: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

interface SessionState {
  learnSnapshot: LearnSnapshot | null;
  cameFrom: Mode;
}

function initial() {
  const p = params();
  const saved = loadSaved();
  const target = targetFromSearch(typeof window === 'undefined' ? '' : window.location.search);
  const learn = saved?.learn ?? { step: 0, maxStep: 0, visited: [0], choices: { ...DEFAULT_CHOICES }, checks: {} };
  let step = learn.step;
  if (target.mode === 'learn' && target.step !== undefined) step = target.step;
  const choices: Choices = { ...learn.choices };
  // Review / sharing overrides: ?clean=0&spin=0.2&dose=4&overlay=5
  if (p.has('clean')) choices.clean = p.get('clean') !== '0';
  if (p.has('spin')) choices.spin = clamp(Number(p.get('spin')), 0, 1, DEFAULT_CHOICES.spin);
  if (p.has('dose')) choices.dose = Math.round(clamp(Number(p.get('dose')), 0, 4, DEFAULT_CHOICES.dose));
  if (p.has('overlay')) choices.overlay = Math.round(clamp(Number(p.get('overlay')), -7, 7, 0));
  // Round-one `view` deep links become a scale override for that lesson.
  const v = p.get('view');
  const scaleOverride: ScaleId | null = v === 'fab' || v === 'tool' || v === 'wafer' || v === 'device' ? v : null;
  const session = readSession<SessionState>();
  const visited = learn.visited.includes(step) ? learn.visited : [...learn.visited, step].sort((a, b) => a - b);
  return {
    mode: target.mode,
    cameFrom: session?.cameFrom ?? ('home' as Mode),
    step,
    maxStep: Math.max(learn.maxStep, step),
    visited,
    choices,
    checks: learn.checks,
    scaleOverride,
    machine: target.mode === 'explore' ? (target.machine ?? null) : null,
    demo: target.mode === 'explore' ? !!target.demo : false,
    learnSnapshot: target.mode === 'explore' || target.mode === 'watch' ? (session?.learnSnapshot ?? null) : null,
    prefs: saved?.prefs ?? { ...DEFAULT_PREFS },
    reducedMotion: prefersReducedMotion() || p.get('motion') === 'reduce',
    fast: p.get('fast') === '1',
    hadSave: !!saved,
  };
}

const init = initial();

/** True when the viewer arrived with saved progress (Home offers "Resume learning"). */
export const HAD_SAVE = init.hadSave;

function persist(s: AppState) {
  writeSaved({
    v: 2,
    learn: { step: s.step, maxStep: s.maxStep, visited: s.visited, choices: s.choices, checks: s.checks },
    prefs: s.prefs,
  });
}

function persistSession(s: AppState) {
  writeSession({ learnSnapshot: s.learnSnapshot, cameFrom: s.cameFrom } satisfies SessionState);
}

function snapshotOf(s: AppState): LearnSnapshot {
  const c = useClock.getState();
  return {
    step: s.step,
    progress: c.progress,
    playing: c.playing || c.pendingPlay,
    scaleOverride: s.scaleOverride,
    panel: s.panel === 'chapters' || s.panel === 'equipment' ? null : s.panel,
    camera: cameraBridge.get(),
    lightPath: s.lightPath,
    xray: s.xray,
    cutaway: s.cutaway,
    finalInput: s.finalInput,
  };
}

// ───────────────────────────── store ─────────────────────────────

export const useApp = create<AppState>((set, get) => {
  /** Change lesson: resets the lesson session and parks the clock until the camera arrives. */
  const enterLesson = (step: number, opts?: { keepReturn?: boolean; banner?: string | null }) => {
    const s = get();
    const i = Math.max(0, Math.min(FLOW.length - 1, step));
    const content = STEPS[FLOW[i].id];
    const visited = s.visited.includes(i) ? s.visited : [...s.visited, i].sort((a, b) => a - b);
    set({
      step: i,
      maxStep: Math.max(s.maxStep, i),
      visited,
      panel: null,
      scaleOverride: null,
      resumeFrom: null,
      returnTo: opts?.keepReturn ? s.returnTo : null,
      banner: opts?.banner ?? null,
      lightPath: content.variant === 'expose' || content.variant === 'reticle' ? s.lightPath : false,
    });
    const clock = useClock.getState();
    const waitForCheck = content.check === 'develop' && !get().checks.develop;
    // The step waits at p = 0 for its camera move; the director starts it on arrival. (With
    // reduced motion the step still plays, so its captions and process keep their timing; the
    // camera holds still compositions and cross-fades between them instead of travelling.)
    useClock.setState({ progress: 0, playing: false, pendingPlay: !waitForCheck, epoch: clock.epoch + 1 });
    persist(get());
  };

  return {
    ...init,
    panel: null,
    lightPath: false,
    xray: false,
    cutaway: true,
    finalInput: 0,
    returnTo: null,
    banner: null,
    resumeFrom: null,

    navigate: (t, how = 'push') => {
      const s = get();
      const from = s.mode;
      // Leaving a lesson for Explore or Watch: remember it exactly and pause it.
      if (from === 'learn' && (t.mode === 'explore' || t.mode === 'watch')) {
        set({ learnSnapshot: snapshotOf(s), cameFrom: 'learn' });
        useClock.getState().pause();
      } else if (from === 'home' && (t.mode === 'explore' || t.mode === 'watch')) {
        set({ cameFrom: 'home' });
      } else if (from === 'learn' && t.mode === 'home') {
        useClock.getState().pause();
      }
      switch (t.mode) {
        case 'home':
          set({ mode: 'home', panel: null, machine: null, demo: false });
          break;
        case 'learn': {
          const target = t.step ?? get().step;
          const snap = get().learnSnapshot;
          if ((from === 'explore' || from === 'watch') && snap && snap.step === target) {
            // Return to the lesson exactly as it was left; never surprise-play.
            set({
              mode: 'learn',
              step: snap.step,
              scaleOverride: snap.scaleOverride,
              panel: snap.panel,
              lightPath: snap.lightPath,
              xray: snap.xray,
              cutaway: snap.cutaway,
              finalInput: snap.finalInput,
              resumeFrom: snap.playing ? from : null,
              machine: null,
              demo: false,
            });
            useClock.setState({ progress: snap.progress, playing: false, pendingPlay: false, epoch: useClock.getState().epoch + 1 });
            if (snap.camera) cameraBridge.restore(snap.camera);
          } else if (from === 'learn' && target === get().step) {
            // same lesson: nothing to do
          } else {
            set({ mode: 'learn', machine: null, demo: false });
            enterLesson(target);
          }
          set({ learnSnapshot: null });
          break;
        }
        case 'explore':
          set({ mode: 'explore', machine: t.machine ?? null, demo: !!t.demo && !!t.machine, panel: null });
          break;
        case 'watch':
          set({ mode: 'watch', panel: null, machine: null, demo: false });
          break;
      }
      persistSession(get());
      if (how !== 'none') writeUrl(searchFor(t, get().step), how);
    },

    goTo: (step, opts) => {
      const s = get();
      if (s.mode !== 'learn') set({ mode: 'learn', learnSnapshot: null, machine: null, demo: false });
      enterLesson(step, opts);
      const how = opts?.history ?? 'push';
      if (how !== 'none') writeUrl(searchFor({ mode: 'learn', step: get().step }, get().step), how);
    },
    next: () => {
      const s = get();
      if (s.step < FLOW.length - 1) s.goTo(s.step + 1, { keepReturn: s.returnTo !== null && s.step + 1 < s.returnTo });
      else set({ panel: 'recap' });
    },
    prev: () => {
      const s = get();
      if (s.step > 0) s.goTo(s.step - 1);
    },
    setScaleOverride: (v) => set({ scaleOverride: v }),
    setChoice: (k, v) => {
      set({ choices: { ...get().choices, [k]: v } });
      persist(get());
    },
    resetChoice: (k) => {
      set({ choices: { ...get().choices, [k]: DEFAULT_CHOICES[k] } });
      persist(get());
    },
    answer: (id, a) => {
      set({ checks: { ...get().checks, [id]: a } });
      persist(get());
    },
    setPanel: (p) => set({ panel: p }),
    toggle: (k) => set({ [k]: !get()[k] } as Partial<AppState>),
    setFinalInput: (v) => set({ finalInput: v }),
    rework: (layer) => {
      const s = get();
      const c = s.choices;
      if (layer === 'gate') {
        set({ choices: { ...c, gateReworks: c.gateReworks + 1 } });
        const target = c.dose !== DEFAULT_CHOICES.dose ? 'expose' : 'coat';
        s.goTo(STEP_INDEX[target as StepId], {
          banner: 'Reworked: the resist was stripped, the wafer cleaned and recoated. Adjust the setting and continue.',
        });
      } else {
        set({ choices: { ...c, contactReworks: c.contactReworks + 1 } });
        s.goTo(STEP_INDEX['contact-align'], {
          banner: 'Reworked: the contact resist was stripped and recoated. Re-align and continue.',
        });
      }
      persist(get());
    },
    dismissBanner: () => set({ banner: null }),
    dismissResume: () => set({ resumeFrom: null }),
    setPrefs: (p) => {
      set({ prefs: { ...get().prefs, ...p } });
      persist(get());
    },
  };
});

export function currentStepId(): StepId {
  return FLOW[useApp.getState().step].id;
}

/** Browser Back/Forward: the URL is the source of truth for where the viewer is. */
export function installHistorySync(): () => void {
  const on = () => useApp.getState().navigate(targetFromSearch(window.location.search), 'none');
  window.addEventListener('popstate', on);
  return () => window.removeEventListener('popstate', on);
}

// Test harness: expose the stores in development builds and with ?virt=1 (e2e specs and
// capture scripts), never otherwise.
if (TEST_HOOKS) {
  (window as unknown as { __fabStores: unknown }).__fabStores = { useApp, useClock, HAD_SAVE };
}
