import { Environment, Lightformer } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useMemo } from 'react';
import * as THREE from 'three';
import { useApp } from '../state/store';
import { FabScene } from './tools/Fab';

/**
 * Hero framing: standing in the aisle at the east end of the bay, looking west into its
 * depth. The lithography scanner fills the right third; the left third (behind the
 * headline) stays calm — floor, wall and the far, fogged end of the bay. On portrait
 * screens the view widens and lifts so the bay sits above the headline.
 */
const WIDE = { pos: new THREE.Vector3(18.8, 1.9, 1.4), target: new THREE.Vector3(-4, 1.55, -1.9), fov: 30 };
const TALL = { pos: new THREE.Vector3(19.4, 3.4, 2.2), target: new THREE.Vector3(0, -3.4, -1.2), fov: 60 };

function Drift() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const reduced = useApp((s) => s.reducedMotion);
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), t: new THREE.Vector3() }), []);
  useFrame(({ clock }) => {
    const aspect = size.width / Math.max(1, size.height);
    // blend between the landscape and portrait framings
    const k = THREE.MathUtils.clamp((1.25 - aspect) / 0.75, 0, 1);
    const fov = THREE.MathUtils.lerp(WIDE.fov, TALL.fov, k);
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    tmp.p.lerpVectors(WIDE.pos, TALL.pos, k);
    tmp.t.lerpVectors(WIDE.target, TALL.target, k);
    // a slow, small drift (still under reduced motion)
    const t = reduced ? 0 : clock.elapsedTime;
    tmp.p.x += Math.sin(t * 0.045) * 0.35;
    tmp.p.z += Math.sin(t * 0.031 + 1.2) * 0.3;
    tmp.p.y += Math.sin(t * 0.06) * 0.05;
    tmp.t.z += Math.sin(t * 0.038 + 0.4) * 0.25;
    camera.position.copy(tmp.p);
    camera.lookAt(tmp.t);
  });
  return null;
}

/** Full-bleed fab overview behind the home page headline. */
export default function HomeCanvas() {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping, preserveDrawingBuffer: true }}
      camera={{ fov: 30, near: 0.1, far: 120, position: [18.8, 1.9, 1.4] }}
      aria-hidden
    >
      <color attach="background" args={['#f1f2f3']} />
      <fog attach="fog" args={['#f1f2f3', 14, 44]} />
      {/* cleanroom light: bright, diffuse, from the ceiling */}
      <hemisphereLight args={['#ffffff', '#c3c8ce', 1.15]} />
      <ambientLight intensity={0.18} />
      <directionalLight position={[-4, 10, 5]} intensity={1.1} />
      <directionalLight position={[10, 6, -8]} intensity={0.35} color="#eef2ff" />
      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#dfe3e7']} />
        <Lightformer form="rect" intensity={2.6} position={[0, 6, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[16, 16, 1]} />
        <Lightformer form="rect" intensity={1.1} position={[-6, 2, 2]} rotation={[0, Math.PI / 2, 0]} scale={[4, 8, 1]} />
        <Lightformer form="rect" intensity={0.9} position={[6, 2, -2]} rotation={[0, -Math.PI / 2, 0]} scale={[4, 8, 1]} />
        <Lightformer form="rect" intensity={0.6} color="#d9d4ff" position={[0, 1.5, -6]} scale={[6, 1.2, 1]} />
        {/* long, thin panels for crisp linear highlights on brushed steel */}
        <Lightformer form="rect" intensity={2.2} position={[0, 3.2, 6]} rotation={[0, Math.PI, 0]} scale={[14, 0.35, 1]} />
        <Lightformer form="rect" intensity={1.4} position={[0, 1.1, 6]} rotation={[0, Math.PI, 0]} scale={[14, 0.2, 1]} />
      </Environment>
      <Suspense fallback={null}>
        <FabScene hero />
      </Suspense>
      <Drift />
    </Canvas>
  );
}
