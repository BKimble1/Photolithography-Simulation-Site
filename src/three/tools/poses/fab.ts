import type { SceneId } from '../../../content/steps';
import type { Pose, ToolPose } from '../../poses';

/** Overview of the fab bay. */
export const POSE: ToolPose = { pos: [10.5, 5.2, 12.5], target: [0, 1.0, -1], min: 4, max: 34 };

/** Where each tool type stands in the fab bay (x, z of its footprint centre, metres). */
export const STATIONS: Partial<Record<SceneId, [number, number]>> = {};

/** Camera pose for the "Fab" zoom level while a given tool is in use. */
export function fabPoseFor(scene: SceneId): Pose {
  const st = STATIONS[scene];
  if (!st) return POSE;
  const [x, z] = st;
  return { pos: [x + 6.5, 4.2, z + 8.5], target: [x, 1.0, z], min: 3, max: 34 };
}
