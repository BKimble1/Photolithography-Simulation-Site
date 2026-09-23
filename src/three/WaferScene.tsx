import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { DIES, FIELDS, WAFER, YOUR_DIE } from '../sim/dies';
import { STEP_INDEX } from '../sim/flow';
import { useSimState, useStep, useWaferMap } from '../state/sim';
import { useProgressBucket, useProgressFrame } from './anim';
import { Cyl, ShadowBlob } from './kit/parts';
import { Wafer } from './wafer/Wafer';
import { Label } from './labels';
import { useRunChoices } from '../state/presentation';

/** The wafer on a neutral chuck: the "wafer" zoom level for every step. */
export function WaferScene() {
  const state = useSimState();
  const { id, index } = useStep();
  const choices = useRunChoices();
  const b = useProgressBucket(40);
  const scanning = id === 'scan';
  const probing = id === 'probe';
  const showMap = index >= STEP_INDEX.probe;
  const map = useWaferMap(choices, showMap);
  const R = WAFER.radius;
  // particles are only known after the scan; during the scan they appear as the line passes
  const sweepY = scanning ? R - 2 * R * Math.min(1, b / 0.85) : -Infinity;
  const summary = useMemo(() => {
    if (index < STEP_INDEX.scan) return { ...state.wafer, particles: [] };
    if (scanning) return { ...state.wafer, particles: state.wafer.particles.filter((p) => p.y > sweepY) };
    return state.wafer;
  }, [state.wafer, index, scanning, sweepY]);
  const exposing = id === 'expose';
  const look = {
    summary,
    showParticles: true,
    highlightDie: true,
    map: showMap ? map : undefined,
    mapReveal: probing ? Math.min(1, b / 0.8) : 1,
    exposedFields: exposing ? Math.floor(Math.min(1, b / 0.8) * FIELDS.length) : state.wafer.resist?.phase === 'exposed' || state.wafer.resist?.phase === 'peb' ? FIELDS.length : 0,
    fields: FIELDS,
    planGrid: id === 'diemap',
  };
  const line = useRef<THREE.Mesh>(null);
  useProgressFrame((p) => {
    if (!line.current) return;
    const y = R - 2 * R * Math.min(1, p / 0.85);
    line.current.position.z = -y / 1000;
    line.current.visible = scanning && p < 0.87;
  });
  return (
    <group>
      <Cyl r={0.145} h={0.02} position={[0, -0.011, 0]} m="black" seg={96} />
      <Cyl r={0.11} h={0.12} position={[0, -0.08, 0]} m="steelDark" seg={64} />
      <Wafer look={look} metalness={0.82} roughness={0.12} />
      <mesh ref={line} position={[0, 0.003, 0]} visible={false}>
        <boxGeometry args={[0.31, 0.0015, 0.0025]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} />
      </mesh>
      <ShadowBlob position={[0, -0.14, 0]} scale={[0.6, 0.6]} opacity={0.2} />
      {id === 'diemap' && <DiePicker />}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.14, 0]} receiveShadow>
        <circleGeometry args={[3, 64]} />
        <meshStandardMaterial color="#e3e2de" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** Tap a die to see where it is; your die is outlined in violet. */
function DiePicker() {
  const [hover, setHover] = useState<number | null>(null);
  const toMm = (p: THREE.Vector3) => ({ x: p.x * 1000, y: -p.z * 1000 });
  const pick = (e: { point: THREE.Vector3; stopPropagation: () => void }) => {
    e.stopPropagation();
    const { x, y } = toMm(e.point);
    const d = DIES.find((dd) => Math.abs(dd.x - x) <= WAFER.dieW / 2 && Math.abs(dd.y - y) <= WAFER.dieH / 2);
    setHover(d ? d.id : null);
  };
  const d = hover !== null ? DIES[hover] : null;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0022, 0]} onPointerMove={pick} onClick={pick} onPointerOut={() => setHover(null)}>
        <circleGeometry args={[WAFER.radius, 64]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {d && (
        <Label pos={[d.x / 1000, 0.01, -d.y / 1000]} tone="chip" priority={3}>
          <b>{d.id === YOUR_DIE ? 'Your die' : `Die ${d.col}, ${d.row}`}</b> · {d.full ? 'complete' : 'partial edge die (not tested)'}
        </Label>
      )}
    </group>
  );
}
