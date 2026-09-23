import type { SceneId } from '../../../content/steps';
import type { Pose, ToolPose } from '../../poses';

/**
 * Layout of the illustrative 300 mm fab bay (metres). The main bay runs along x with a
 * central aisle (z ∈ [−1.8, 1.8]); tools stand in two rows with their fronts (load ports)
 * facing the aisle. The back-end area (dicing, packaging, final test) is a separate room at
 * the west end, behind a glass wall at x = BACKEND_WALL_X.
 */
export const BAY = { x0: -22, x1: 19.5, z0: -8, z1: 8, ceiling: 4.6, aisle: 1.8 } as const;
export const BACKEND = { x0: -31.5, x1: -22.3 } as const;
export const BACKEND_WALL_X = -22.15;

/** Overview of the fab bay. */
export const POSE: ToolPose = { pos: [14.5, 12.5, 17.5], target: [-3.0, 0.8, -1.0], min: 4, max: 48 };

/** Where each tool type stands in the fab bay (x, z of its footprint centre, metres). */
export const STATIONS: Partial<Record<SceneId, [number, number]>> = {
  // north row (fronts face +z)
  foup: [-19.3, -2.95],
  inspect: [-15.5, -3.15],
  wafer: [-15.5, -3.15],
  wetclean: [-11.1, -3.3],
  furnace: [-5.7, -3.55],
  etch: [-0.7, -3.85],
  track: [4.9, -3.15],
  scanner: [10.9, -3.65],
  // south row (fronts face −z)
  implant: [-16.4, 3.25],
  depo: [-9.9, 3.85],
  cmp: [-4.9, 3.45],
  metrology: [-1.1, 3.05],
  prober: [2.6, 3.1],
  // back-end room
  dicing: [-25.0, -3.2],
  package: [-28.6, -3.0],
  testbench: [-26.8, 3.3],
};

/** +1: the station's front faces +z (north row); −1: it faces −z (south row). */
export function facing(scene: SceneId): 1 | -1 {
  const st = STATIONS[scene];
  return st && st[1] > 0 ? -1 : 1;
}

/** Camera pose for the "Fab" zoom level while a given tool is in use. */
export function fabPoseFor(scene: SceneId): Pose {
  const st = STATIONS[scene];
  if (!st) return POSE;
  const [x, z] = st;
  const f = facing(scene);
  const backend = x < BACKEND_WALL_X;
  if (backend) {
    // smaller room, smaller tools: come in closer, from inside the room (west of the glass)
    return { pos: [x - 2.4, 4.3, z + f * 6.6], target: [x + 0.2, 0.9, z], min: 2, max: 30 };
  }
  // from the aisle side, raised above the overhead rails and to the east, so the
  // neighbouring tools and the bay read around the station
  return { pos: [x + 5.8, 7.7, z + f * 7.9], target: [x - 0.3, 0.9, z + f * 0.9], min: 3, max: 40 };
}
