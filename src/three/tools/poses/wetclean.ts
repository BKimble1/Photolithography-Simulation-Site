import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the WetClean scene (metres): the spin chamber at the origin, its deck at
 * 1.3 m. Mounted in the middle upper-tier cell of the wet-clean tool (`wetClean` in Fab.tsx),
 * the chamber's open front flush with the tool's front. The cutaway removes only this
 * chamber's front panel (it stands proud of the housing: station z > 1.312, y > 1.3).
 */
export const POSE: ToolPose = {
  pos: [0.66, 2.62, 1.3],
  target: [0, 1.4, -0.08],
  mount: { yaw: 0, offset: [0.6, 0.83] },
  cutaway: { z: 1.312, y: 1.3 },
};
