import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { drawWafer, lookKey, makeCanvasTexture, type WaferLook } from './waferTexture';

/**
 * A 300 mm wafer (radius 0.15 m) with a notch. The top face shows the simulated surface;
 * the edge is polished silicon. Thickness is exaggerated ×2 so it reads at tool scale.
 */
export function useWaferGeometry(radius = 0.15, thickness = 0.0016) {
  return useMemo(() => {
    // Unit shape in [0,1]² so the cap UVs map straight onto the texture.
    const shape = new THREE.Shape();
    const n = 160;
    const notch = 0.012; // half-width of the notch in unit coords
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const da = Math.abs(((a + Math.PI / 2 + Math.PI) % (Math.PI * 2)) - Math.PI);
      let r = 0.5;
      if (da < notch / 0.5) r = 0.5 - (notch - da * 0.5) * 0.9;
      const x = 0.5 + Math.cos(a) * r;
      const y = 0.5 + Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: thickness / (2 * radius), bevelEnabled: false, curveSegments: 4 });
    g.translate(-0.5, -0.5, 0);
    g.rotateX(-Math.PI / 2);
    g.scale(2 * radius, 2 * radius, 2 * radius);
    g.computeVertexNormals();
    return g;
  }, [radius, thickness]);
}

const edgeMat = new THREE.MeshStandardMaterial({ color: '#8f949c', metalness: 0.9, roughness: 0.25 });

export function Wafer({
  look,
  radius = 0.15,
  size = 1024,
  position,
  rotation,
  roughness = 0.16,
  metalness = 0.55,
}: {
  look: WaferLook;
  radius?: number;
  size?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  roughness?: number;
  metalness?: number;
}) {
  const geo = useWaferGeometry(radius);
  const { canvas, tex } = useMemo(() => makeCanvasTexture(size), [size]);
  const topMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: tex, roughness, metalness, envMapIntensity: 1.1 }),
    [tex, roughness, metalness],
  );
  const key = lookKey(look, size);
  const last = useRef('');
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawWafer(ctx, size, look);
    tex.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(
    () => () => {
      tex.dispose();
      topMat.dispose();
    },
    [tex, topMat],
  );
  return <mesh geometry={geo} material={[topMat, edgeMat]} position={position} rotation={rotation} castShadow receiveShadow />;
}
