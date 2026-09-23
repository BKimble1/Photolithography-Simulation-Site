import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the CMP scene (metres). The platen is at the origin; the load cup and
 * the clean/dry module are to its left (−x), the carrier-head swing arm behind them. Mounted
 * in the polisher cell of the CMP tool's housing (`cmp` in Fab.tsx), the cell's window 0.9 m
 * in front of the platen; the cutaway removes only that window (station z > 1.412, y > 1.25),
 * so views look down over its sill.
 */
export const POSE: ToolPose = {
  pos: [0.85, 2.75, 2.3],
  target: [-0.3, 0.95, 0.1],
  mount: { yaw: 0, offset: [0.35, 0.5] },
  cutaway: { z: 1.412, y: 1.25 },
};
