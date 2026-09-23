/**
 * What the stage shows while Watch plays: the film's presentations (the canonical successful
 * run, driven by the film clock), the machines it needs mounted, and its camera. All of it is
 * a function of film time, so any seek produces exactly the frame that playing would.
 */
import { create } from 'zustand';
import { STEPS } from '../content/steps';
import { trackForIndex } from '../content/shots';
import { FLOW } from '../sim/flow';
import { DEFAULT_CHOICES } from '../sim/types';
import type { Presentation, ProgressSource } from '../state/presentation';
import { useApp } from '../state/store';
import { failedStations, readyStations, stationBoxes, waferShown } from '../three/stage/anchors';
import { filmBridge } from '../three/stage/filmBridge';
import { evalLegs, handoverAt, planTransition, type Leg } from '../three/stage/flights';
import { heroPose, overviewPose } from '../three/stage/Director';
import type { StationMount } from '../three/stage/context';
import { copyPose, evalTrack, evalTrackStill, makePose, makeSample, type CamSample } from '../three/stage/tracks';
import { filmPlayer, onFilmTick, useFilm } from './film';
import { inputAt, locate, progressOf, progressIn, type Timeline, type TimelineSegment } from './timeline';

export interface FilmStage {
  pres: Presentation | null;
  mounts: StationMount[];
}

export const useFilmStage = create<{ stage: FilmStage | null }>(() => ({ stage: null }));

export function useFilmPresentation(): FilmStage | null {
  return useFilmStage((s) => s.stage);
}

// ───────────────────────────── presentations ─────────────────────────────

interface Clock {
  tl: Timeline;
  t: () => number;
  subscribe: (fn: () => void) => () => void;
}

let clock: Clock | null = null;
const presCache = new Map<string, Presentation>();

function progressSource(stepIndex: number): ProgressSource {
  return {
    get: () => (clock ? progressOf(clock.tl, stepIndex, clock.t()) : 0),
    subscribe: (fn) => (clock ? clock.subscribe(fn) : () => {}),
  };
}

function filmPres(stepIndex: number, lightPath: boolean, input: 0 | 1): Presentation {
  const reducedMotion = useApp.getState().reducedMotion;
  const key = `${stepIndex}:${lightPath}:${input}:${reducedMotion}`;
  let p = presCache.get(key);
  if (!p) {
    p = { kind: 'watch', stepIndex, choices: DEFAULT_CHOICES, progress: progressSource(stepIndex), lightPath, xray: false, cutaway: true, finalInput: input, reducedMotion };
    presCache.set(key, p);
  }
  return p;
}

let lastKey = '';

/** Recompute what is mounted and presented; cheap, and only publishes when it changes. */
export function updateFilmStage(tl: Timeline, t: number): void {
  const loc = locate(tl, t);
  const seg = loc.seg;
  const next = tl.segments[seg.index + 1];
  // In the move after a segment, the next step takes over while the camera is between the
  // two machines (see gapPlan): its machine then holds the learner's wafer.
  const handed = loc.inGap && !!next && loc.u >= gapHandover(tl, seg.index);
  const cur = handed ? next : seg;
  const input = inputAt(tl, t);
  const light = !loc.inGap && !!seg.def.lightPath;
  const key = `${cur.index}:${seg.index}:${handed}:${light}:${input}`;
  if (key === lastKey) return;
  lastKey = key;
  const mounts: StationMount[] = [];
  const add = (s: TimelineSegment | undefined, lp: boolean) => {
    if (!s || s.stepIndex === null || !s.station || mounts.some((m) => m.id === s.station)) return;
    mounts.push({ id: s.station, pres: filmPres(s.stepIndex, lp, input), variant: STEPS[FLOW[s.stepIndex].id].variant });
  };
  add(cur, cur === seg ? light : false);
  add(seg, light);
  add(next, false);
  add(tl.segments[cur.index + 1], false);
  const pres = cur.stepIndex !== null ? filmPres(cur.stepIndex, cur === seg ? light : false, input) : null;
  filmBridge.station = cur.station;
  useFilmStage.setState({ stage: { pres, mounts } });
}

// ───────────────────────────── camera ─────────────────────────────

const A = makeSample();
const B = makeSample();
const noFit = () => {};

function segmentShot(seg: TimelineSegment, p: number, time: number, out: CamSample, reduced: boolean): void {
  if (seg.stepIndex === null) {
    // Opening: the bay as on the home page. Closing: the whole bay from above.
    if (seg.index === 0) return heroPose(time, filmBridge.aspect, reduced, out);
    out.mix = 0;
    overviewPose(filmBridge.aspect, out.a);
    return;
  }
  const content = STEPS[FLOW[seg.stepIndex].id];
  (reduced ? evalTrackStill : evalTrack)(trackForIndex(seg.stepIndex), p, { station: seg.station, variant: content.variant }, out);
}

const shown = (s: CamSample) => (s.mix >= 0.5 ? s.b : s.a);

/**
 * The silent move after a segment, planned once and reused for every frame of the gap (the
 * same legs the director flies in a lesson). The plan depends only on the two framings it
 * joins, so it is kept until one of its inputs changes: the viewport's aspect, reduced
 * motion, which machines are loaded (their wafers anchor the framings) and whether each end's
 * wafer is where the framing looks. A seek into the gap gets exactly the plan playing would.
 */
interface GapPlan {
  key: string;
  legs: Leg[];
  total: number;
  /** Fraction of the gap at which the next machine takes the wafer. */
  hand: number;
}
const gapPlans = new Map<number, GapPlan>();
/** Planned (not reused) moves, for the measurement harness. */
export const gapStats = { planned: 0, reused: 0 };

function gapKey(tl: Timeline, i: number, reduced: boolean): string {
  const a = tl.segments[i];
  const b = tl.segments[i + 1];
  const st = (id: TimelineSegment['station']) => (id ? `${id}:${readyStations.has(id) ? 1 : 0}${failedStations.has(id) ? 'x' : ''}${waferShown(id) ? 'w' : ''}` : '-');
  return `${filmBridge.aspect.toFixed(3)}:${reduced}:${st(a.station)}:${st(b?.station ?? null)}:${stationBoxes.size}`;
}

function gapPlan(tl: Timeline, i: number, reduced: boolean): GapPlan {
  const key = gapKey(tl, i, reduced);
  const hit = gapPlans.get(i);
  if (hit && hit.key === key) {
    gapStats.reused++;
    return hit;
  }
  const seg = tl.segments[i];
  const next = tl.segments[i + 1];
  segmentShot(seg, 1, seg.start + seg.dur, A, reduced);
  segmentShot(next, 0, next.start, B, reduced);
  const to = copyPose(makePose(), shown(B));
  const legs = planTransition(shown(A), () => to, {
    from: seg.station,
    to: next.station,
    establish: !!next.station && next.station !== seg.station,
    reduced,
    fit: noFit,
  });
  const total = legs.reduce((s, l) => s + l.dur, 0);
  const plan = { key, legs, total, hand: total > 0 ? handoverAt(legs) / total : 0.5 };
  gapPlans.set(i, plan);
  gapStats.planned++;
  return plan;
}

/** Fraction of the gap after segment i at which the next machine takes over. */
function gapHandover(tl: Timeline, i: number): number {
  const hit = gapPlans.get(i);
  return hit ? hit.hand : tl.segments[i + 1]?.station !== tl.segments[i].station ? 0.35 : 0.5;
}

/** The film's camera at the clock's current time (set as filmBridge.sample while watching). */
function sample(out: CamSample): boolean {
  if (!clock) return false;
  const tl = clock.tl;
  const t = clock.t();
  const reduced = useApp.getState().reducedMotion;
  const loc = locate(tl, t);
  const seg = loc.seg;
  if (!loc.inGap) {
    segmentShot(seg, progressIn(seg, t), t, out, reduced);
    return true;
  }
  // The silent move to the next segment's first framing, stretched to fill the gap.
  const plan = gapPlan(tl, seg.index, reduced);
  evalLegs(plan.legs, loc.u * plan.total, out);
  return true;
}

/** Connect the stage to a film clock (null to disconnect). */
export function attachFilm(c: Clock | null): void {
  clock = c;
  lastKey = '';
  presCache.clear();
  gapPlans.clear();
  filmBridge.sample = c ? sample : null;
  if (!c) {
    filmBridge.station = null;
    useFilmStage.setState({ stage: null });
  }
}

// Follow the film controller: attach when a film is loaded, follow every tick, detach on close.
function follow(tl: Timeline | null) {
  if (!tl) {
    attachFilm(null);
    return;
  }
  attachFilm({ tl, t: () => filmPlayer()?.now() ?? 0, subscribe: onFilmTick });
  updateFilmStage(tl, filmPlayer()?.t ?? 0);
}
useFilm.subscribe((s, prev) => {
  if (s.tl !== prev.tl) follow(s.tl);
});
follow(useFilm.getState().tl);
onFilmTick(() => {
  const p = filmPlayer();
  if (p && clock) updateFilmStage(clock.tl, p.t);
});
