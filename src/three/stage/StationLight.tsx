/**
 * Lights inside machines (the load port's fan-filter unit, the implanter's chamber), drawn by a
 * fixed pool of point lights in the world rather than by lights of their own.
 *
 * Every lit shader program is compiled for the number of lights in the scene. A machine that
 * brought its own light changed that number whenever it came into view or went out of it, and
 * every lit material on screen then needed another program, compiled on the spot (1–3 s each on
 * the software renderer); and since a machine is prepared for the GPU while it is still hidden,
 * it was prepared without its own light. The pool keeps the number fixed: while a machine is
 * drawn, its light takes a pool light (the same colour, intensity, range and falloff, at the same
 * place), and a pool light nobody has taken has no intensity.
 */
import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';

/** Pool lights: enough for every machine with a light to be drawn at once. */
export const STATION_LIGHT_POOL = 2;

interface Source {
  color: THREE.Color;
  intensity: number;
  distance: number;
  decay: number;
}
const sources = new Map<THREE.Object3D, Source>();

/** A point light belonging to a machine (in place of a <pointLight>). */
export function StationLight({ position, color, intensity, distance, decay }: { position: [number, number, number]; color: string; intensity: number; distance: number; decay: number }) {
  const anchor = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const o = anchor.current;
    if (!o) return;
    sources.set(o, { color: new THREE.Color(color), intensity, distance, decay });
    return () => {
      sources.delete(o);
    };
  }, [color, intensity, distance, decay]);
  return <group ref={anchor} position={position} />;
}

/** Drawn: the object and each of its ancestors visible, up to the scene. */
function drawn(o: THREE.Object3D, scene: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    if (!p.visible) return false;
    if (p === scene) return true;
  }
  return false;
}

/**
 * Give the pool lights to the machines' lights that are drawn (called as the world scene is
 * rendered, after the director has decided what is visible, before the lights are gathered).
 * The pool lights sit at the scene's root, so their positions are world positions.
 */
export function applyStationLights(pool: THREE.PointLight[], scene: THREE.Object3D) {
  let k = 0;
  for (const [anchor, s] of sources) {
    if (k >= pool.length) break;
    if (!drawn(anchor, scene)) continue;
    const l = pool[k++];
    anchor.getWorldPosition(l.position);
    l.color.copy(s.color);
    l.intensity = s.intensity;
    l.distance = s.distance;
    l.decay = s.decay;
    l.updateMatrixWorld();
  }
  for (; k < pool.length; k++) pool[k].intensity = 0;
}
