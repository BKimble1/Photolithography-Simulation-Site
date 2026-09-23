import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the Metrology scene (metres): the CD-SEM chamber (front cut away) at the
 * origin with its column above, the load lock and transfer arm to the left, the monitor right.
 */
export const POSE: ToolPose = { pos: [0.95, 2.05, 2.95], target: [0.08, 1.3, 0.0] };
