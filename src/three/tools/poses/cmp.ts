import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the CMP scene (metres). The platen is at the origin; the load cup and
 * the clean/dry module are to its left (−x), the carrier-head swing arm behind them.
 */
export const POSE: ToolPose = { pos: [0.87, 2.32, 2.66], target: [-0.35, 0.92, 0.05] };
