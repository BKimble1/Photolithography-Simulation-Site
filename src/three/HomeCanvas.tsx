import { Environment, Lightformer } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense } from 'react';
import * as THREE from 'three';
import { useApp } from '../state/store';
import { FabScene } from './tools/Fab';

function Drift() {
  const { camera } = useThree();
  const reduced = useApp((s) => s.reducedMotion);
  useFrame(({ clock }) => {
    const t = reduced ? 0 : clock.elapsedTime;
    const a = -0.62 + Math.sin(t * 0.05) * 0.08;
    const r = 13.5;
    camera.position.set(Math.sin(a) * r + 2.5, 3.1 + Math.sin(t * 0.07) * 0.15, Math.cos(a) * r);
    camera.lookAt(2.2, 1.4, -1.5);
  });
  return null;
}

/** Full-bleed fab overview behind the home page headline. */
export default function HomeCanvas() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping, preserveDrawingBuffer: true }}
      camera={{ fov: 30, near: 0.05, far: 200, position: [8, 3, 12] }}
      aria-hidden
    >
      <color attach="background" args={['#f1f2f3']} />
      <fog attach="fog" args={['#f1f2f3', 16, 48]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 9, 6]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} />
      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#e4e7ea']} />
        <Lightformer form="rect" intensity={2.8} position={[0, 6, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[14, 14, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[-6, 2, 2]} rotation={[0, Math.PI / 2, 0]} scale={[4, 8, 1]} />
        <Lightformer form="rect" intensity={1.0} position={[6, 2, -2]} rotation={[0, -Math.PI / 2, 0]} scale={[4, 8, 1]} />
      </Environment>
      <Suspense fallback={null}>
        <FabScene hero />
      </Suspense>
      <Drift />
    </Canvas>
  );
}
