import { create } from 'zustand';
import { STEPS, type ViewLevel } from '../content/steps';
import { FLOW, STEP_INDEX, type StepId } from '../sim/flow';
import { DEFAULT_CHOICES, type Choices } from '../sim/types';

export type Panel = null | 'stages' | 'closer' | 'compare' | 'recap' | 'euv' | 'legend';

export interface CheckAnswer {
  choice: number;
  correct: boolean;
  /** For the contact check: the overlay the answer was given for. */
  overlay?: number;
}

export interface AppState {
  route: 'home' | 'journey';
  step: number;
  maxStep: number;
  view: ViewLevel;
  choices: Choices;
  checks: Partial<Record<string, CheckAnswer>>;
  panel: Panel;
  lightPath: boolean;
  xray: boolean;
  cutaway: boolean;
  section2d: boolean;
  finalInput: 0 | 1;
  /** A step the learner jumped back from (to offer "return"). */
  returnTo: number | null;
  banner: string | null;
  reducedMotion: boolean;
  fast: boolean;

  start: () => void;
  goHome: () => void;
  goTo: (step: number, opts?: { keepReturn?: boolean; view?: ViewLevel; banner?: string | null }) => void;
  next: () => void;
  prev: () => void;
  setView: (v: ViewLevel) => void;
  setChoice: <K extends keyof Choices>(k: K, v: Choices[K]) => void;
  resetChoice: (k: keyof Choices) => void;
  answer: (id: string, a: CheckAnswer) => void;
  setPanel: (p: Panel) => void;
  toggle: (k: 'lightPath' | 'xray' | 'cutaway' | 'section2d') => void;
  setFinalInput: (v: 0 | 1) => void;
  rework: (layer: 'gate' | 'contact') => void;
  dismissBanner: () => void;
}

// ───────────────────────────── animation clock (high frequency) ─────────────────────────────

export interface ClockState {
  progress: number;
  playing: boolean;
  /** Set when the learner scrubbed or the step changed; scenes may snap instead of easing. */
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
  epoch: 0,
  set: (p) => set({ progress: Math.max(0, Math.min(1, p)), epoch: get().epoch + 1 }),
  play: () => set({ playing: true, progress: get().progress >= 1 ? 0 : get().progress }),
  pause: () => set({ playing: false }),
  toggle: () => (get().playing ? get().pause() : get().play()),
  restart: () => set({ progress: 0, playing: true, epoch: get().epoch + 1 }),
}));

// ───────────────────────────── persistence helpers ─────────────────────────────

const LS_KEY = 'fab-one:v1';

function load(): Partial<Pick<AppState, 'step' | 'maxStep' | 'choices' | 'checks'>> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    if (typeof v !== 'object' || !v) return {};
    return v;
  } catch {
    return {};
  }
}

function save(s: AppState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ step: s.step, maxStep: s.maxStep, choices: s.choices, checks: s.checks }));
  } catch {
    /* storage may be unavailable */
  }
}

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

function initial(): Pick<AppState, 'route' | 'step' | 'maxStep' | 'choices' | 'checks' | 'view' | 'reducedMotion' | 'fast'> {
  const p = params();
  const saved = load();
  let step = typeof saved.step === 'number' ? saved.step : 0;
  let route: AppState['route'] = 'home';
  const qs = p.get('step');
  if (qs && qs in STEP_INDEX) {
    step = STEP_INDEX[qs as StepId];
    route = 'journey';
  }
  step = Math.max(0, Math.min(FLOW.length - 1, step));
  const choices: Choices = { ...DEFAULT_CHOICES, ...(saved.choices ?? {}) };
  // URL overrides for testing / sharing: ?clean=0&spin=0.2&dose=4&overlay=5
  if (p.has('clean')) choices.clean = p.get('clean') !== '0';
  if (p.has('spin')) choices.spin = clamp(Number(p.get('spin')), 0, 1, DEFAULT_CHOICES.spin);
  if (p.has('dose')) choices.dose = Math.round(clamp(Number(p.get('dose')), 0, 4, DEFAULT_CHOICES.dose));
  if (p.has('overlay')) choices.overlay = Math.round(clamp(Number(p.get('overlay')), -7, 7, 0));
  const view = (p.get('view') as ViewLevel) || STEPS[FLOW[step].id].view;
  return {
    route,
    step,
    maxStep: Math.max(step, typeof saved.maxStep === 'number' ? saved.maxStep : 0),
    choices,
    checks: saved.checks ?? {},
    view,
    reducedMotion: prefersReducedMotion() || p.get('motion') === 'reduce',
    fast: p.get('fast') === '1',
  };
}

function clamp(v: number, lo: number, hi: number, dflt: number) {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
}

function syncUrl(step: number, route: AppState['route']) {
  try {
    const url = new URL(window.location.href);
    if (route === 'journey') url.searchParams.set('step', FLOW[step].id);
    else url.searchParams.delete('step');
    url.searchParams.delete('view');
    window.history.replaceState(null, '', url.toString());
  } catch {
    /* ignore */
  }
}

const init = initial();

export const useApp = create<AppState>((set, get) => ({
  ...init,
  panel: null,
  lightPath: false,
  xray: false,
  cutaway: true,
  section2d: false,
  finalInput: 0,
  returnTo: null,
  banner: null,

  start: () => {
    const s = get();
    set({ route: 'journey', panel: null });
    s.goTo(s.step);
  },
  goHome: () => {
    set({ route: 'home', panel: null });
    useClock.getState().pause();
    syncUrl(get().step, 'home');
  },
  goTo: (step, opts) => {
    const s = get();
    const i = Math.max(0, Math.min(FLOW.length - 1, step));
    const content = STEPS[FLOW[i].id];
    set({
      route: 'journey',
      step: i,
      maxStep: Math.max(s.maxStep, i),
      view: opts?.view ?? content.view,
      panel: null,
      returnTo: opts?.keepReturn ? s.returnTo : null,
      banner: opts?.banner ?? null,
      lightPath: content.variant === 'expose' ? s.lightPath : false,
    });
    const clock = useClock.getState();
    const waitForCheck = content.check === 'develop' && !get().checks.develop;
    if (get().reducedMotion || waitForCheck) {
      useClock.setState({ progress: waitForCheck ? 0 : 1, playing: false, epoch: clock.epoch + 1 });
    } else {
      useClock.setState({ progress: 0, playing: true, epoch: clock.epoch + 1 });
    }
    syncUrl(i, 'journey');
    save(get());
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
  setView: (v) => set({ view: v }),
  setChoice: (k, v) => {
    set({ choices: { ...get().choices, [k]: v } });
    save(get());
  },
  resetChoice: (k) => {
    set({ choices: { ...get().choices, [k]: DEFAULT_CHOICES[k] } });
    save(get());
  },
  answer: (id, a) => {
    set({ checks: { ...get().checks, [id]: a } });
    save(get());
  },
  setPanel: (p) => set({ panel: p }),
  toggle: (k) => set({ [k]: !get()[k] } as Partial<AppState>),
  setFinalInput: (v) => set({ finalInput: v }),
  rework: (layer) => {
    const s = get();
    const c = s.choices;
    if (layer === 'gate') {
      set({ choices: { ...c, gateReworks: c.gateReworks + 1 } });
      const target = c.dose !== DEFAULT_CHOICES.dose ? 'expose' : Math.abs(c.spin - 0.5) > 0.02 ? 'coat' : 'coat';
      s.goTo(STEP_INDEX[target], {
        banner: 'Reworked: the resist was stripped, the wafer cleaned and recoated. Adjust the setting and continue.',
      });
    } else {
      set({ choices: { ...c, contactReworks: c.contactReworks + 1 } });
      s.goTo(STEP_INDEX['contact-align'], {
        banner: 'Reworked: the contact resist was stripped and recoated. Re-align and continue.',
      });
    }
    save(get());
  },
  dismissBanner: () => set({ banner: null }),
}));

export function currentStepId(): StepId {
  return FLOW[useApp.getState().step].id;
}
