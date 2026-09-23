import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the Furnace scene (metres; heights as placed in the bay, where the scene
 * stands on a 1 m raised floor inside the middle furnace's back tower: `furnace` in Fab.tsx).
 * Mounted so the cabinet fills the tower (station z −1.45 … −0.05). The cutaway opens the
 * tower front and the FOUP stocker in front of it above the load port (station z > −0.04,
 * y > 1.3); the two neighbouring furnaces are not part of the station and stay closed. Views
 * come from nearly straight ahead: from the side, the neighbours' towers hide the interior.
 * The wafer close-ups look from the same direction, down through the jacket's cut wedge.
 */
export const POSE: ToolPose = {
  pos: [1.28, 3.51, 4.69],
  target: [0, 2.45, -0.1],
  mount: { yaw: 0, offset: [0, -0.7] },
  cutaway: { z: -0.04, y: 1.3 },
};
