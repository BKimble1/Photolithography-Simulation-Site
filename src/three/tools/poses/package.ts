import type { ToolPose } from '../../poses';

/** Camera pose(s) for the Package scene (metres). Variant poses override the default. */
export const POSE: ToolPose = { pos: [0.34, 1.2, 0.42], target: [0, 1.02, 0], variants: { bond: { pos: [0.24, 1.16, 0.3], target: [0, 1.03, 0] } } };
