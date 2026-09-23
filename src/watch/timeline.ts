/**
 * The film timeline: pure functions from film time (seconds) to what is on screen.
 *
 * Segments play back to back, each one narration audio file (measured durations from the
 * manifest), separated by silent moves ("gaps") whose lengths depend only on where the two
 * steps happen: a short reframe within the same machine, a longer trip along the aisle to a
 * different machine, plus time to come out of the cross-section first. Everything here is a
 * function of the manifest and the film definition, so seeking to any time gives the same
 * frame as playing up to it.
 */
import { FILM, FILM_CHAPTERS, type FilmSegment } from '../content/film';
import { machineOfStep } from '../content/machines';
import { trackForIndex } from '../content/shots';
import { STEP_INDEX } from '../sim/flow';
import type { MachineId } from '../state/nav';
import { STATIONS } from '../three/tools/poses/fab';

export interface ManifestCue {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface ManifestSegment {
  id: string;
  file: string;
  durationMs: number;
  bytes?: number;
  sha256?: string;
  cues: ManifestCue[];
}

export interface FilmManifest {
  version: string;
  voice: string;
  segments: ManifestSegment[];
}

export interface TimelineCue {
  id: string;
  text: string;
  start: number;
  end: number;
}

export interface TimelineSegment {
  index: number;
  def: FilmSegment;
  stepIndex: number | null;
  station: MachineId | null;
  /** Film time the segment's audio starts. */
  start: number;
  /** Audio duration. */
  dur: number;
  /** Silent move after this segment (0 after the last). */
  gapAfter: number;
  file: string;
  bytes: number;
  cues: TimelineCue[];
  /** (film time, step progress) keyframes, increasing in both. */
  keys: [number, number][];
}

export interface Timeline {
  version: string;
  segments: TimelineSegment[];
  duration: number;
  chapters: { title: string; start: number }[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Does a step's shot track end inside the magnified cross-section? */
function endsInDevice(stepIndex: number | null): boolean {
  if (stepIndex === null) return false;
  const t = trackForIndex(stepIndex);
  return t.length > 0 && t[t.length - 1].cam.kind === 'device';
}

/** Seconds of silent camera movement between two segments. */
export function gapBetween(a: FilmSegment, b: FilmSegment): number {
  const sa = a.step ? STEP_INDEX[a.step] : null;
  const sb = b.step ? STEP_INDEX[b.step] : null;
  const retrace = endsInDevice(sa) ? 1.1 : 0;
  if (sa === null) return 3.2; // opening view of the bay → the first machine
  if (sb === null) return 2.4 + retrace; // last machine → closing view
  const ma = machineOfStep(sa);
  const mb = machineOfStep(sb);
  if (ma === mb) return 0.9 + retrace;
  const pa = ma ? STATIONS[ma] : undefined;
  const pb = mb ? STATIONS[mb] : undefined;
  const dx = pa && pb ? Math.abs(pa[0] - pb[0]) : 10;
  // travel along the aisle, a beat on the whole new machine, then in to the process
  return clamp(1.6 + dx / 14, 1.8, 3.0) + 0.35 + 0.9 + retrace;
}

export function buildTimeline(manifest: FilmManifest, film: FilmSegment[] = FILM): Timeline {
  const byId = new Map(manifest.segments.map((s) => [s.id, s]));
  const segments: TimelineSegment[] = [];
  let t = 0;
  film.forEach((def, index) => {
    const m = byId.get(def.id);
    if (!m) throw new Error(`narration manifest has no segment "${def.id}"`);
    const dur = m.durationMs / 1000;
    const start = t;
    const cues = m.cues.map((c) => ({ id: c.id, text: c.text, start: start + c.startMs / 1000, end: start + c.endMs / 1000 }));
    const keys: [number, number][] = [[start, 0]];
    const sync = Object.entries(def.sync ?? {})
      .map(([id, p]) => [cues.find((c) => c.id === id)?.start, p] as const)
      .filter((k): k is readonly [number, number] => k[0] !== undefined)
      .sort((x, y) => x[0] - y[0]);
    for (const [ct, p] of sync) {
      const last = keys[keys.length - 1];
      if (ct > last[0] && p > last[1]) keys.push([ct, p]);
    }
    keys.push([start + dur, 1]);
    const stepIndex = def.step ? STEP_INDEX[def.step] : null;
    const next = film[index + 1];
    const gapAfter = next ? gapBetween(def, next) : 0;
    segments.push({ index, def, stepIndex, station: stepIndex === null ? null : machineOfStep(stepIndex), start, dur, gapAfter, file: m.file, bytes: m.bytes ?? 0, cues, keys });
    t = start + dur + gapAfter;
  });
  const chapters = FILM_CHAPTERS.map((c) => ({ title: c.title, start: segments.find((s) => s.def.id === c.segment)?.start ?? 0 }));
  return { version: manifest.version, segments, duration: t, chapters };
}

export interface Located {
  seg: TimelineSegment;
  /** In the silent move after `seg`. */
  inGap: boolean;
  /** Progress through that move (0..1). */
  u: number;
}

/** Which segment (or the move after it) film time t falls in. */
export function locate(tl: Timeline, t: number): Located {
  const segs = tl.segments;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  const seg = segs[lo];
  const end = seg.start + seg.dur;
  if (t < end || seg.gapAfter <= 0) return { seg, inGap: false, u: 0 };
  return { seg, inGap: true, u: clamp((t - end) / seg.gapAfter, 0, 1) };
}

/** Step progress at film time t through a segment's keyframes. */
export function progressIn(seg: TimelineSegment, t: number): number {
  const k = seg.keys;
  if (t <= k[0][0]) return 0;
  for (let i = 1; i < k.length; i++) {
    if (t < k[i][0]) {
      const [t0, p0] = k[i - 1];
      const [t1, p1] = k[i];
      return p0 + ((p1 - p0) * (t - t0)) / (t1 - t0);
    }
  }
  return 1;
}

/** Progress of a step at film time t: 0 before its segment, 1 after it. */
export function progressOf(tl: Timeline, stepIndex: number, t: number): number {
  const seg = tl.segments.find((s) => s.stepIndex === stepIndex);
  if (!seg) return 0;
  return progressIn(seg, t);
}

/** The caption on screen at t: the cue being spoken, held briefly into the pause after it. */
export function cueAt(tl: Timeline, t: number): TimelineCue | null {
  const { seg, inGap } = locate(tl, t);
  if (inGap) return null;
  let cur: TimelineCue | null = null;
  for (const c of seg.cues) if (t >= c.start - 0.05) cur = c;
  if (cur && t > cur.end + 1.2) return null;
  return cur;
}

/** The final-test input switch position at t (the film flips it on cue). */
export function inputAt(tl: Timeline, t: number): 0 | 1 {
  const seg = tl.segments.find((s) => s.def.input);
  if (!seg || !seg.def.input) return 0;
  let v: 0 | 1 = 0;
  for (const c of seg.cues) if (t >= c.start && seg.def.input[c.id] !== undefined) v = seg.def.input[c.id];
  return v;
}

/** Film time at which a segment starts (for chapter jumps and "watch from this step"). */
export function startOf(tl: Timeline, id: string): number {
  return tl.segments.find((s) => s.def.id === id)?.start ?? 0;
}
