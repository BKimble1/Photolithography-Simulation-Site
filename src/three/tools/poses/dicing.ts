import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the Dicing scene (metres). The chuck table is at the origin under the
 * spindle; the scene stands in its cabinet (the bay model) with no offset.
 */
export const POSE: ToolPose = {
  pos: [0.3, 1.95, 1.0],
  target: [0.02, 0.93, 0.02],
  // The cabinet opens above the drain pan, in front of the chamber's back wall.
  cutaway: { z: -0.47, y: 0.83 },
};
