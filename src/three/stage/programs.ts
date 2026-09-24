/**
 * Where the browser cannot compile shader programs in parallel (the extension three.js waits
 * on), `compileAsync` resolves at once and a program is really compiled when first used, which
 * blocks until the renderer has caught up: at its first draw, perhaps in the middle of a move.
 * The director uses the programs prepared so far (a blocking query of each new one) at moments
 * when the camera is still: when the first picture is revealed (under the veil) and when it
 * leaves for a new destination (before the move's clock starts). A machine prepared but never
 * visited is not waited for. Nothing to do where compilation is parallel, or on the frame-stepped
 * harness's clock.
 */
import type * as THREE from 'three';
import { stageTime } from './time';

/** Use every program not yet used; returns the milliseconds this blocked. */
export function finishPrograms(gl: THREE.WebGLRenderer): number {
  if (stageTime.virtual || gl.extensions.has('KHR_parallel_shader_compile')) return 0;
  const t0 = performance.now();
  for (const p of gl.info.programs ?? []) (p as unknown as { getUniforms(): unknown }).getUniforms();
  return performance.now() - t0;
}
