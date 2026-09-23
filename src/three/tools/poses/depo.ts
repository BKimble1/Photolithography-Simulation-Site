import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the Depo scene (metres). The hexagonal transfer chamber is at the origin;
 * the cutaway process chamber sits on its front-right face, the load locks and EFEM behind.
 */
export const POSE: ToolPose = { pos: [1.81, 2.14, 2.43], target: [0.3, 1.0, 0.5] };
