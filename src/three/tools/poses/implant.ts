import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the Implant scene (metres; tool frame: source leg along +x, final leg along
 * −z to the wafer at z = −1.06). Mounted a quarter turn round in the implanter's housing
 * (`implanter` in Fab.tsx): the terminal at the back left, the beamline running east, the load
 * lock pointing at the front end. The cutaway opens everything in front of the terminal cage
 * above the pods (station z > −2.08, y > 1.3). The view comes from the front left (tool +x,
 * +z), looking over the power racks at the beamline and at the wafer's face on the platen.
 */
export const POSE: ToolPose = {
  pos: [2.84, 3.1, 2.1],
  target: [-0.26, 1.15, -0.25],
  mount: { yaw: -Math.PI / 2, offset: [0, -0.84] },
  cutaway: { z: -2.08, y: 1.3 },
};
