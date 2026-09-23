import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the Prober scene (metres). The probe point (needle tips over the wafer)
 * is at the origin, under the docked test head; the loader is to the left, the manipulator
 * and the tester behind.
 */
export const POSE: ToolPose = {
  pos: [1.22, 1.98, 2.02],
  target: [0.24, 0.98, -0.14],
  // The load port sits at the aisle, the tester at the back of the footprint.
  mount: { yaw: 0, offset: [0, 0.35] },
  // The stage chamber, test head and loader open above the chassis, in front of the tester.
  cutaway: { z: -0.6, y: 0.72 },
};
