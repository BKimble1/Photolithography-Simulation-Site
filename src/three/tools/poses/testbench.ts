import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the TestBench scene (metres): the load board with the chip in its socket
 * at the origin on the bench; the tester cabinet at x = −1.4.
 */
export const POSE: ToolPose = {
  pos: [0.14, 1.17, 0.3],
  target: [0.01, 0.925, -0.01],
  min: 0.08,
  max: 3,
  // The bench centre stands where the bay model has it; no enclosure to open (the detailed
  // scene, cabinet included, replaces the model close up).
  mount: { yaw: 0, offset: [0.8, 0] },
};
