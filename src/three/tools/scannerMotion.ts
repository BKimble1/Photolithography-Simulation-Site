/**
 * The scanner's wafer stages, as pure functions of lesson progress (no rendering here, so the
 * continuity of the paths can be tested): the dual-stage exchange, the alignment-mark visits
 * and the exposure's step-and-scan meander. See Scanner.tsx.
 */
import { FIELDS } from '../../sim/dies';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (p: number, a: number, b: number) => ease(seg(p, a, b));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The projection lens and the alignment sensor, along the stage line (tool frame, m). */
export const LENS_X = 0.3;
export const MEAS_X = -0.4;

/** Field positions (m) relative to the wafer centre, in exposure order. */
export const FIELD_M = FIELDS.map((f) => ({ x: f.x / 1000, y: f.y / 1000, h: f.h / 1000 }));

/**
 * After the exchange (p < 0.07) the stage carries the wafer from the home position to the
 * first field's scan start, then the fields are exposed in turn until EXPOSE_TO.
 */
export const APPROACH_FROM = 0.07;
export const EXPOSE_FROM = 0.1;
export const EXPOSE_TO = 0.86;
/** Share of each field's period spent stepping to it; the rest is the scan. */
const STEP_SHARE = 0.3;

/** Alignment marks visited under the sensor (wafer-centre offsets, m). */
const MARKS: [number, number][] = [
  [0.1, 0.08],
  [-0.1, 0.09],
  [-0.09, -0.1],
  [0.11, -0.08],
];

/**
 * The stage offset while marks are measured over p ∈ [a, b]: from the home position (wafer
 * centre under the sensor) to each mark in turn, and back home afterwards (by b + 0.13), so
 * the stage is where the next lesson finds it.
 */
export function markPose(p: number, a: number, b: number): { x: number; z: number; dwell: boolean } {
  const u = seg(p, a, b) * MARKS.length;
  const k = Math.min(MARKS.length - 1, Math.floor(u));
  const [mx, my] = MARKS[k];
  const prev: [number, number] = k === 0 ? [0, 0] : MARKS[k - 1];
  const tt = smooth(u - k, 0, 0.5);
  const home = smooth(p, b + 0.02, b + 0.13);
  return { x: -lerp(prev[0], mx, tt) * (1 - home), z: lerp(prev[1], my, tt) * (1 - home), dwell: p > a && p < b && u - k > 0.55 };
}

/**
 * The dual-stage exchange: the scanner measures a wafer on one chuck while it exposes another
 * on the second, then the two swap places, passing around each other. Our wafer is measured
 * (and waits during the reticle load) on the measure side, and is swapped under the lens at the
 * start of the exposure. Writes the two chucks' positions at progress p of a lesson.
 */
export function stageBases(v: string, p: number, ours: { set(x: number, y: number, z: number): unknown }, other: { set(x: number, y: number, z: number): unknown }) {
  const swap = v === 'expose' ? smooth(p, 0, 0.07) : 0;
  const around = Math.sin(Math.PI * swap) * 0.32;
  ours.set(lerp(MEAS_X, LENS_X, swap), 0, around);
  other.set(lerp(LENS_X, MEAS_X, swap), 0, -around);
}

export interface ExposurePose {
  /** Stage offset from the home position (tool frame, m). */
  x: number;
  z: number;
  /** Where the scan is along the field: offset of the point under the slit from the field centre (m). */
  scan: number;
  /** The slit is on (a field is being scanned). */
  scanning: boolean;
  /** Fields exposed so far, fractional during a scan. */
  done: number;
}

export const makeExposurePose = (): ExposurePose => ({ x: 0, z: 0, scan: 0, scanning: false, done: 0 });

/**
 * Step and scan: the stage steps the wafer to each field in turn and scans it under the slit at
 * constant speed, alternately in one direction and the other (a meander), so each scan starts
 * where the previous one ended; a step only moves the stage across to the next field. The
 * point under the lens is (field centre + scan offset); the path is continuous throughout.
 */
export function exposurePose(p: number, out: ExposurePose): ExposurePose {
  const n = FIELD_M.length;
  const first = FIELD_M[0];
  let cx: number, cy: number;
  if (p < EXPOSE_FROM) {
    // from the home position (the wafer centre under the lens) to the first field
    const t = ease(seg(p, APPROACH_FROM, EXPOSE_FROM));
    cx = first.x * t;
    cy = first.y * t;
    out.scan = -0.5 * first.h * t;
    out.scanning = false;
    out.done = 0;
  } else {
    const f = seg(p, EXPOSE_FROM, EXPOSE_TO) * n;
    const i = Math.min(n - 1, Math.floor(f));
    const within = f - i;
    const fld = FIELD_M[i];
    const dir = i % 2 === 0 ? 1 : -1;
    const start = -0.5 * fld.h * dir;
    if (within < STEP_SHARE) {
      // from where the previous scan ended (the first field is already under the lens)
      const t = ease(within / STEP_SHARE);
      const prev = i > 0 ? FIELD_M[i - 1] : fld;
      const prevEnd = i > 0 ? 0.5 * prev.h * -dir : start;
      cx = lerp(prev.x, fld.x, t);
      cy = lerp(prev.y, fld.y, t);
      out.scan = lerp(prevEnd, start, t);
      out.scanning = false;
      out.done = i;
    } else {
      const u = (within - STEP_SHARE) / (1 - STEP_SHARE);
      cx = fld.x;
      cy = fld.y;
      out.scan = start + u * fld.h * dir;
      out.scanning = p < EXPOSE_TO;
      out.done = p >= EXPOSE_TO ? n : i + u;
    }
  }
  // the stage moves the wafer so that this point of it is under the lens
  out.x = -cx;
  out.z = cy + out.scan;
  return out;
}
