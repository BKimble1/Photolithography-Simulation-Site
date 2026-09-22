import type { SceneId, ViewLevel } from '../content/steps';
import { POSE as cmp } from './tools/poses/cmp';
import { POSE as depo } from './tools/poses/depo';
import { POSE as dicing } from './tools/poses/dicing';
import { POSE as etch } from './tools/poses/etch';
import { fabPoseFor, POSE as fab } from './tools/poses/fab';
import { POSE as foup } from './tools/poses/foup';
import { POSE as furnace } from './tools/poses/furnace';
import { POSE as implant } from './tools/poses/implant';
import { POSE as inspect } from './tools/poses/inspect';
import { POSE as metrology } from './tools/poses/metrology';
import { POSE as pkg } from './tools/poses/package';
import { POSE as prober } from './tools/poses/prober';
import { POSE as scanner } from './tools/poses/scanner';
import { POSE as testbench } from './tools/poses/testbench';
import { POSE as track } from './tools/poses/track';
import { POSE as wetclean } from './tools/poses/wetclean';

export type V3 = [number, number, number];

export interface Pose {
  pos: V3;
  target: V3;
  /** Orbit distance limits. */
  min?: number;
  max?: number;
}

export type ToolPose = Pose & { variants?: Record<string, Pose> };

export const WAFER_POSE: Pose = { pos: [0, 0.5, 0.4], target: [0, -0.02, 0.0], min: 0.15, max: 1.4 };
export const DEVICE_POSE: Pose = { pos: [-3.9, 3.4, 7.1], target: [0, 0.35, -0.3], min: 2, max: 16 };

/** Tool-level camera poses; each tool scene owns its pose file in tools/poses/. */
export const TOOL_POSES: Record<SceneId, ToolPose> = {
  fab,
  foup,
  inspect,
  wetclean,
  wafer: { ...WAFER_POSE },
  furnace,
  etch,
  cmp,
  implant,
  depo,
  track,
  scanner,
  metrology,
  prober,
  dicing,
  package: pkg,
  testbench,
};

export function poseFor(view: ViewLevel, scene: SceneId, variant?: string): Pose {
  if (view === 'wafer') return WAFER_POSE;
  if (view === 'device') return DEVICE_POSE;
  if (view === 'fab') return fabPoseFor(scene);
  const p = TOOL_POSES[scene];
  const v = variant && p.variants?.[variant];
  return { min: 0.25, max: 8, ...p, ...(v || {}) };
}

export const SCALE_TEXT: Record<ViewLevel, [string, string]> = {
  fab: ['Fab bay', 'tens of metres across'],
  tool: ['Tool', 'a few metres, illustrative equipment'],
  wafer: ['Wafer', '300 mm across; particles and dies drawn larger'],
  device: ['One inverter cell', 'a few micrometres across · greatly magnified, schematic'],
};
