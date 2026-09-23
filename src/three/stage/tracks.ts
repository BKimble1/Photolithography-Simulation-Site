/**
 * Resolving framings to camera poses and evaluating tracks at a progress value.
 *
 * World framings are in metres (fab, tools, wafer); device framings are in the schematic
 * device space. A segment between the two is an anchored, matched transition: the world
 * camera closes in on your die while the device camera starts far out along the same
 * direction relative to the wafer's axes, and the two views cross-fade — so the magnified
 * cell appears exactly where, and oriented as, the die was.
 */

import * as THREE from 'three';
import type { CamRef, Key } from '../../content/shots';
import type { MachineId } from '../../state/nav';
import { DEVICE_POSE, type Pose } from '../poses';
import { fabPoseFor, POSE as FAB_POSE } from '../tools/poses/fab';
import { facing } from '../tools/poses/fab';
import type { ScaleId } from '../../state/store';
import { anchorsOf, stationBoxes, toolMatrix, waferFrame } from './anchors';

export type Space = 'world' | 'device';

export interface CamPose {
  space: Space;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  /** What the framing shows (for the scale label); unset for free camera positions. */
  scale?: ScaleId;
}

export const makePose = (space: Space = 'world'): CamPose => ({ space, pos: new THREE.Vector3(), target: new THREE.Vector3() });

export function copyPose(dst: CamPose, src: CamPose): CamPose {
  dst.space = src.space;
  dst.pos.copy(src.pos);
  dst.target.copy(src.target);
  dst.scale = src.scale;
  return dst;
}

/** One frame's camera: a single pose, or a cross-fade from `a` to `b` (b weighted by mix). */
export interface CamSample {
  a: CamPose;
  b: CamPose;
  mix: number;
}

export const makeSample = (): CamSample => ({ a: makePose(), b: makePose(), mix: 0 });

export interface ResolveCtx {
  station: MachineId | null;
  variant?: string;
}

const DEVICE_FRAMINGS: Record<'section' | 'top' | 'wide', Pose> = {
  section: DEVICE_POSE,
  top: { pos: [-1.2, 6.8, 3.4], target: [0, 0.4, -0.2] },
  wide: { pos: [-6.2, 4.6, 10.2], target: [0, 0.2, -0.3] },
};

const tmpM = new THREE.Matrix4();
const wf = { centre: new THREE.Vector3(), up: new THREE.Vector3(), die: new THREE.Vector3(), x: new THREE.Vector3() };
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

function setPose(out: CamPose, space: Space, pose: Pose, m?: THREE.Matrix4): CamPose {
  out.space = space;
  out.scale = space === 'device' ? 'device' : 'tool';
  out.pos.set(pose.pos[0], pose.pos[1], pose.pos[2]);
  out.target.set(pose.target[0], pose.target[1], pose.target[2]);
  if (m) {
    out.pos.applyMatrix4(m);
    out.target.applyMatrix4(m);
  }
  return out;
}

/** The machine's own framing: variant or named shot, else establish. */
function toolShot(id: MachineId, name: string, out: CamPose): CamPose {
  const a = anchorsOf(id);
  const pose = a.shots[name] ?? a.shots.establish;
  return setPose(out, 'world', pose, toolMatrix(id, tmpM));
}

const MACHINE_ELEV = 0.42; // ~24° above horizontal
const MACHINE_YAW = 0.52; // ~30° off the machine's front axis, toward the east
const HALF_FOV = (32 / 2) * (Math.PI / 180);
const mc = new THREE.Vector3();
const ms = new THREE.Vector3();

/** The whole machine from the aisle side, at a three-quarter angle, sized to its footprint. */
export function machinePose(id: MachineId, out: CamPose): CamPose {
  const box = stationBoxes.get(id);
  if (!box) return toolShot(id, 'establish', out);
  box.getCenter(mc);
  box.getSize(ms);
  const r = 0.5 * Math.hypot(ms.x, ms.y * 0.8, ms.z);
  const dist = Math.max(3.6, Math.min(8.5, (r / Math.sin(HALF_FOV)) * 0.92));
  const f = facing(id);
  out.space = 'world';
  out.scale = 'tool';
  out.target.set(mc.x, Math.min(1.05, mc.y), mc.z);
  const ce = Math.cos(MACHINE_ELEV);
  out.pos.set(Math.sin(MACHINE_YAW) * ce, Math.sin(MACHINE_ELEV), f * Math.cos(MACHINE_YAW) * ce).multiplyScalar(dist).add(out.target);
  return out;
}

/**
 * Resolve a framing. Wafer framings look at the wafer where the tool holds it right now,
 * from the side the machine is normally seen from; if no wafer is present, they fall back to
 * the machine's establishing shot.
 */
export function resolve(ref: CamRef, ctx: ResolveCtx, out: CamPose): CamPose {
  switch (ref.kind) {
    case 'machine': {
      const st = ref.station ?? ctx.station;
      if (!st) return setPose(out, 'world', FAB_POSE);
      return machinePose(st, out);
    }
    case 'device':
      return setPose(out, 'device', DEVICE_FRAMINGS[ref.framing]);
    case 'fab': {
      const st = ref.station ?? ctx.station;
      setPose(out, 'world', !st || st === 'overview' ? FAB_POSE : fabPoseFor(st));
      out.scale = 'fab';
      return out;
    }
    case 'shot': {
      const st = ref.station ?? ctx.station;
      if (!st) return setPose(out, 'world', FAB_POSE);
      return toolShot(st, ref.name === 'establish' && ctx.variant ? ctx.variant : ref.name, out);
    }
    case 'wafer': {
      const st = ref.station ?? ctx.station;
      if (!st) return setPose(out, 'world', FAB_POSE);
      if (!waferFrame(st, wf)) return toolShot(st, ctx.variant ?? 'establish', out);
      // Horizontal direction toward the machine's usual viewpoint, then tilt up.
      toolShot(st, ctx.variant ?? 'establish', out);
      v1.copy(out.pos).sub(wf.centre);
      v1.addScaledVector(wf.up, -v1.dot(wf.up));
      if (v1.lengthSq() < 1e-6) v1.set(0, 0, 1);
      v1.normalize();
      const top = ref.framing === 'top';
      const elev = top ? 0.95 : 1.15; // radians above the wafer plane
      const dist = top ? 0.56 : 0.13; // 'die': your die and its neighbours fill the view
      const centre = top ? wf.centre : wf.die;
      v2.copy(v1).multiplyScalar(Math.cos(elev)).addScaledVector(wf.up, Math.sin(elev)).multiplyScalar(dist);
      out.space = 'world';
      out.scale = 'wafer';
      out.target.copy(centre);
      out.pos.copy(centre).add(v2);
      return out;
    }
  }
}

// ───────────────────────────── track evaluation ─────────────────────────────

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const seg = (p: number, a: number, b: number) => (b > a ? clamp01((p - a) / (b - a)) : p >= b ? 1 : 0);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const smoothstep = (t: number) => t * t * (3 - 2 * t);

const A = makePose();
const B = makePose();
const SWAP = makePose();
const dir = new THREE.Vector3();

/**
 * Direction (unit, in device-space axes) matching the world camera's view of your die. The
 * device block's axes follow the wafer's: grid x along the wafer's x, up along its normal.
 */
export function matchedDeviceDir(worldPose: CamPose, station: MachineId | null, out: THREE.Vector3): THREE.Vector3 {
  out.copy(worldPose.pos).sub(worldPose.target);
  if (station && waferFrame(station, wf)) {
    const z = v1.crossVectors(wf.x, wf.up).normalize();
    const lx = out.dot(wf.x);
    const ly = out.dot(wf.up);
    const lz = out.dot(z);
    out.set(lx, ly, lz);
  }
  if (out.lengthSq() < 1e-9) out.set(0, 1, 1);
  return out.normalize();
}

/** Cross-fade between a world pose and a device pose over t in [0, 1] (world → device). */
export function worldToDevice(worldFrom: CamPose, deviceTo: CamPose, t: number, station: MachineId | null, out: CamSample): CamSample {
  const w = 0.28;
  const mid = 0.5;
  // world side: close in on the target
  const tw = easeIn(seg(t, 0, mid + w));
  copyPose(out.a, worldFrom);
  out.a.pos.lerp(v2.copy(worldFrom.target).addScaledVector(dir.copy(worldFrom.pos).sub(worldFrom.target), 0.22), tw);
  // device side: come in from far out along the matched direction
  matchedDeviceDir(worldFrom, station, dir);
  const d = deviceTo.pos.distanceTo(deviceTo.target);
  const td = easeOut(seg(t, mid - w, 1));
  copyPose(out.b, deviceTo);
  v2.copy(deviceTo.target).addScaledVector(dir, d * 3.4);
  out.b.pos.copy(v2).lerp(deviceTo.pos, td);
  out.mix = smoothstep(seg(t, mid - w, mid + w));
  return out;
}

/** The reverse: pull out of the cross-section and back onto the wafer. */
export function deviceToWorld(deviceFrom: CamPose, worldTo: CamPose, t: number, station: MachineId | null, out: CamSample): CamSample {
  worldToDevice(worldTo, deviceFrom, 1 - t, station, out);
  // worldToDevice put the world pose in a and the device pose in b; flip for a device→world fade
  copyPose(SWAP, out.a);
  copyPose(out.a, out.b);
  copyPose(out.b, SWAP);
  out.mix = 1 - out.mix;
  return out;
}

/** Plain move within one space. */
export function lerpPose(a: CamPose, b: CamPose, t: number, out: CamPose): CamPose {
  out.space = b.space;
  out.scale = t < 0.5 ? a.scale : b.scale;
  out.pos.lerpVectors(a.pos, b.pos, t);
  out.target.lerpVectors(a.target, b.target, t);
  return out;
}

/** Evaluate a track at progress p. */
export function evalTrack(track: Key[], p: number, ctx: ResolveCtx, out: CamSample): CamSample {
  out.mix = 0;
  if (!track.length) {
    setPose(out.a, 'world', FAB_POSE);
    return out;
  }
  if (p <= track[0].p || track.length === 1) {
    resolve(track[0].cam, ctx, out.a);
    return out;
  }
  let i = track.length - 1;
  for (let k = 0; k < track.length - 1; k++) {
    if (p < track[k + 1].p) {
      i = k;
      break;
    }
  }
  if (i === track.length - 1) {
    resolve(track[i].cam, ctx, out.a);
    return out;
  }
  const ka = track[i];
  const kb = track[i + 1];
  resolve(ka.cam, ctx, A);
  resolve(kb.cam, ctx, B);
  const t = seg(p, ka.p, kb.p);
  if (A.space === B.space) {
    lerpPose(A, B, easeInOut(t), out.a);
    return out;
  }
  if (A.space === 'world') return worldToDevice(A, B, t, ctx.station, out);
  return deviceToWorld(A, B, t, ctx.station, out);
}

/**
 * Reduced motion: hold each framing still and cross-fade to the next one just before its key,
 * instead of moving the camera. The fade is short in progress terms (under a second).
 */
export function evalTrackStill(track: Key[], p: number, ctx: ResolveCtx, out: CamSample): CamSample {
  out.mix = 0;
  if (!track.length) {
    setPose(out.a, 'world', FAB_POSE);
    return out;
  }
  let i = 0;
  for (let k = 0; k < track.length; k++) if (p >= track[k].p) i = k;
  resolve(track[i].cam, ctx, out.a);
  const next = track[i + 1];
  if (!next) return out;
  const fade = Math.min(0.05, (next.p - track[i].p) / 2);
  const t = (p - (next.p - fade)) / fade;
  if (t <= 0) return out;
  resolve(next.cam, ctx, out.b);
  out.mix = Math.min(1, t);
  return out;
}

/** Which space a track is in at p (the cut happens halfway through a space change). */
export function spaceAt(track: Key[], p: number, ctx: ResolveCtx): Space {
  const s = makeSample();
  evalTrack(track, p, ctx, s);
  return s.mix >= 0.5 ? s.b.space : s.a.space;
}
