/**
 * Shared anchors: where every machine stands in the fab, how its detailed model is mounted
 * there, the camera framings it offers, and — at run time — where the wafer is.
 *
 * Frames (all metres, y up):
 *   world    the fab bay (see tools/poses/fab.ts)
 *   station  origin at a station's footprint centre on the floor, +z toward the aisle
 *   tool     a tool scene's own authoring frame; ANCHORS.mount places it in its station
 *
 * The overview (low-detail bay) and the close-up (detailed tool) share these frames, so the
 * camera can fly from one to the other with no orientation jump.
 */

import * as THREE from 'three';
import type { SceneId } from '../../content/steps';
import { YOUR_DIE, DIES } from '../../sim/dies';
import type { MachineId } from '../../state/nav';
import { TOOL_POSES, type Pose, type ToolPose } from '../poses';
import { STATIONS, facing } from '../tools/poses/fab';

export interface ToolMount {
  /** Rotation of the tool frame about +y inside the station frame (radians). */
  yaw: number;
  /** Offset of the tool frame origin inside the station frame (x, z; metres). */
  offset: [number, number];
}

export interface ToolAnchors {
  mount: ToolMount;
  /** Named camera framings in the tool frame. `establish` shows the whole machine. */
  shots: Record<string, Pose>;
}

/** Mount calibrations, per tool (defaults: identity — the tool's front faces its aisle). */
const MOUNTS: Partial<Record<MachineId, ToolMount>> = {};

export function setMount(id: MachineId, m: ToolMount) {
  MOUNTS[id] = m;
}

export function anchorsOf(id: MachineId): ToolAnchors {
  const pose: ToolPose = TOOL_POSES[id];
  const shots: Record<string, Pose> = { establish: { pos: pose.pos, target: pose.target, min: pose.min, max: pose.max } };
  for (const [k, v] of Object.entries(pose.variants ?? {})) shots[k] = v;
  for (const [k, v] of Object.entries(pose.shots ?? {})) shots[k] = v;
  return { mount: MOUNTS[id] ?? pose.mount ?? { yaw: 0, offset: [0, 0] }, shots };
}

/** The station a scene is shown at (the wafer view lives in the inspection tool). */
export function stationOf(scene: SceneId): MachineId | null {
  if (scene === 'fab') return null;
  if (scene === 'wafer') return 'inspect';
  return scene as MachineId;
}

export function stationMatrix(id: MachineId, out = new THREE.Matrix4()): THREE.Matrix4 {
  const st = STATIONS[id] ?? [0, 0];
  const yaw = facing(id) > 0 ? 0 : Math.PI;
  return out.makeRotationY(yaw).setPosition(st[0], 0, st[1]);
}

const _m = new THREE.Matrix4();
/** Tool frame → world. */
export function toolMatrix(id: MachineId, out = new THREE.Matrix4()): THREE.Matrix4 {
  const a = anchorsOf(id).mount;
  stationMatrix(id, out);
  _m.makeRotationY(a.yaw).setPosition(a.offset[0], 0, a.offset[1]);
  return out.multiply(_m);
}

/** Each machine's footprint in the bay (world space), from its low-detail model. */
export const stationBoxes = new Map<MachineId, THREE.Box3>();

/**
 * Stations whose detailed model is mounted, drawn once and prepared for the GPU (shader
 * programs compiled, textures uploaded): the director may hand over to it.
 */
export const readyStations = new Set<MachineId>();

/** Stations whose detailed model failed to load (the director frames the exterior instead). */
export const failedStations = new Set<MachineId>();

/** The mounted detailed model of each station (the director shows it instead of the proxy). */
export const stationGroups = new Map<MachineId, THREE.Object3D>();

export function stationCentre(id: MachineId, out = new THREE.Vector3()): THREE.Vector3 {
  const st = STATIONS[id] ?? [0, 0];
  return out.set(st[0], 0, st[1]);
}

// ───────────────────────────── wafer registry (run time) ─────────────────────────────

/**
 * The learner's wafer mesh inside each mounted tool registers itself here (Wafer `anchor`),
 * so shots can frame "the wafer" and "your die" wherever the tool has moved it.
 */
export const waferRegistry = new Map<MachineId, THREE.Object3D>();

/** Your die's centre in the wafer mesh's local frame (top face). */
export function yourDieLocal(out = new THREE.Vector3()): THREE.Vector3 {
  const d = DIES[YOUR_DIE];
  return out.set(d.x / 1000, 0.0016, -d.y / 1000);
}

/**
 * Whether the machine is showing the learner's wafer right now (some tools hide it while it is
 * in another machine: the polisher before the wafer arrives, for example). Neither the
 * station's own level-of-detail switch nor the wafer's hand-over between machines (the mesh's
 * own visibility, see handover.ts) counts: this asks where the tool holds the wafer.
 */
export function waferShown(id: MachineId | null): boolean {
  if (!id) return false;
  const station = stationGroups.get(id);
  const mesh = waferRegistry.get(id);
  if (!mesh) return false;
  for (let o = mesh.parent; o && o !== station; o = o.parent) if (!o.visible) return false;
  return true;
}

/**
 * Where shots frame the learner's wafer when its machine moves it in ways the camera should
 * not follow: flipping it over, spinning it, stepping and scanning it under optics. Such a
 * machine registers a steadier stand-in here, in the wafer mesh's own frame, where the wafer
 * rests, right side up (Wafer.tsx, WaferFraming); the camera frames the stand-in and the
 * wafer moves within the view instead of the view chasing the wafer.
 */
export const framingRegistry = new Map<MachineId, THREE.Object3D>();

/**
 * Wafer centre, up normal and your-die centre in world space, as shots frame them (the
 * machine's stand-in, if it has one); false if the machine holds no learner wafer.
 */
export function waferFrame(id: MachineId | null, out: { centre: THREE.Vector3; up: THREE.Vector3; die: THREE.Vector3; x: THREE.Vector3; span?: number }): boolean {
  if (!id) return false;
  const mesh = waferRegistry.get(id);
  if (!mesh || !mesh.parent) return false;
  const stand = framingRegistry.get(id);
  const w = stand && stand.parent ? stand : mesh;
  w.updateWorldMatrix(true, false);
  out.centre.set(0, 0.0016, 0).applyMatrix4(w.matrixWorld);
  out.die.copy(yourDieLocal(out.die)).applyMatrix4(w.matrixWorld);
  out.up.set(0, 1, 0).transformDirection(w.matrixWorld);
  out.x.set(1, 0, 0).transformDirection(w.matrixWorld);
  out.span = (w.userData.span as number | undefined) ?? 1;
  return true;
}
