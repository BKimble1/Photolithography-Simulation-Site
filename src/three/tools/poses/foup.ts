import type { ToolPose } from '../../poses';

/** Camera pose(s) for the Foup scene (metres). Variant poses override the default. */
export const POSE: ToolPose = { pos: [1.35, 1.25, 1.65], target: [0, 0.82, 0], variants: { robot: { pos: [0.1, 1.55, 1.75], target: [0.35, 0.85, -0.2] } } };
