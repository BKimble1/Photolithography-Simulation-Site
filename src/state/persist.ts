/**
 * Saved progress: schema, validation and migration.
 *
 * v1 (round one) stored { step, maxStep, choices, checks } under `fab-one:v1`.
 * v2 stores the learning run under `learn` plus viewer preferences, under `fab-one:v2`.
 * Anything that fails validation is dropped field by field rather than trusted, so a
 * corrupted or hand-edited value can never put the app in an impossible state.
 */

import { FLOW } from '../sim/flow';
import { DEFAULT_CHOICES, DOSE_LEVELS, OVERLAY_RANGE, type Choices } from '../sim/types';

export const LS_V1 = 'fab-one:v1';
export const LS_V2 = 'fab-one:v2';

export interface CheckAnswer {
  choice: number;
  correct: boolean;
  /** For the contact check: the overlay the answer was given for. */
  overlay?: number;
}

export interface SavedLearn {
  step: number;
  maxStep: number;
  /** Steps the learner has opened (sorted, unique). */
  visited: number[];
  choices: Choices;
  checks: Partial<Record<string, CheckAnswer>>;
}

export interface SavedPrefs {
  captions: boolean;
  muted: boolean;
  volume: number;
  rate: number;
}

export interface SavedV2 {
  v: 2;
  learn: SavedLearn;
  prefs: SavedPrefs;
}

export const DEFAULT_PREFS: SavedPrefs = { captions: true, muted: false, volume: 1, rate: 1 };

const LAST = FLOW.length - 1;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampInt = (v: unknown, lo: number, hi: number, d: number) => (isNum(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);

export function validChoices(raw: unknown): Choices {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Choices, unknown>>;
  return {
    clean: typeof c.clean === 'boolean' ? c.clean : DEFAULT_CHOICES.clean,
    spin: isNum(c.spin) ? Math.max(0, Math.min(1, c.spin)) : DEFAULT_CHOICES.spin,
    dose: clampInt(c.dose, 0, DOSE_LEVELS.length - 1, DEFAULT_CHOICES.dose),
    overlay: clampInt(c.overlay, -OVERLAY_RANGE, OVERLAY_RANGE, DEFAULT_CHOICES.overlay),
    gateReworks: clampInt(c.gateReworks, 0, 99, 0),
    contactReworks: clampInt(c.contactReworks, 0, 99, 0),
  };
}

export function validChecks(raw: unknown): Partial<Record<string, CheckAnswer>> {
  const out: Partial<Record<string, CheckAnswer>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const id of ['develop', 'contact']) {
    const a = (raw as Record<string, unknown>)[id] as Partial<CheckAnswer> | undefined;
    if (!a || typeof a !== 'object' || !isNum(a.choice) || typeof a.correct !== 'boolean') continue;
    const ans: CheckAnswer = { choice: clampInt(a.choice, 0, 9, 0), correct: a.correct };
    if (isNum(a.overlay)) ans.overlay = clampInt(a.overlay, -OVERLAY_RANGE, OVERLAY_RANGE, 0);
    out[id] = ans;
  }
  return out;
}

export function validLearn(raw: unknown): SavedLearn {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const step = clampInt(r.step, 0, LAST, 0);
  const maxStep = Math.max(step, clampInt(r.maxStep, 0, LAST, 0));
  let visited: number[];
  if (Array.isArray(r.visited)) {
    visited = [...new Set(r.visited.filter(isNum).map((v) => Math.round(v)).filter((v) => v >= 0 && v <= LAST))];
  } else {
    visited = [];
  }
  if (!visited.includes(step)) visited.push(step);
  visited.sort((a, b) => a - b);
  return { step, maxStep, visited, choices: validChoices(r.choices), checks: validChecks(r.checks) };
}

export function validPrefs(raw: unknown): SavedPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    captions: typeof r.captions === 'boolean' ? r.captions : DEFAULT_PREFS.captions,
    muted: typeof r.muted === 'boolean' ? r.muted : DEFAULT_PREFS.muted,
    volume: isNum(r.volume) ? Math.max(0, Math.min(1, r.volume)) : DEFAULT_PREFS.volume,
    rate: [0.75, 1, 1.25, 1.5].includes(r.rate as number) ? (r.rate as number) : DEFAULT_PREFS.rate,
  };
}

/**
 * Migrate a round-one save. v1 did not record which steps were opened, but it did record the
 * furthest step reached (`maxStep`) and steps could only be reached in order or by jumping,
 * so every step up to maxStep is treated as visited. Knowledge checks carry over unchanged:
 * they were only ever recorded when answered.
 */
export function migrateV1(raw: unknown): SavedV2 {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const learn = validLearn({ ...r, visited: undefined });
  learn.visited = Array.from({ length: learn.maxStep + 1 }, (_, i) => i);
  return { v: 2, learn, prefs: { ...DEFAULT_PREFS } };
}

export function validV2(raw: unknown): SavedV2 | null {
  if (!raw || typeof raw !== 'object' || (raw as { v?: unknown }).v !== 2) return null;
  const r = raw as Record<string, unknown>;
  return { v: 2, learn: validLearn(r.learn), prefs: validPrefs(r.prefs) };
}

function read(key: string): unknown {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/** Load saved state (migrating a v1 save once). Returns null for a first visit. */
export function loadSaved(): SavedV2 | null {
  const v2 = validV2(read(LS_V2));
  if (v2) return v2;
  const v1 = read(LS_V1);
  if (v1 && typeof v1 === 'object') {
    const migrated = migrateV1(v1);
    writeSaved(migrated);
    return migrated;
  }
  return null;
}

export function writeSaved(s: SavedV2): void {
  try {
    localStorage.setItem(LS_V2, JSON.stringify(s));
  } catch {
    /* storage may be unavailable (private mode, quota) */
  }
}

// ───────────────────────────── session (per tab) ─────────────────────────────

const SS_KEY = 'fab-one:session';

export function readSession<T>(): T | null {
  try {
    const s = sessionStorage.getItem(SS_KEY);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

export function writeSession(v: unknown): void {
  try {
    sessionStorage.setItem(SS_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
