import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { STEP_INDEX } from '../../sim/flow';
import type { Grid } from '../../sim/grid';
import { CUT_Y, LAYOUT } from '../../sim/layout';
import { predictContacts } from '../../sim/metrology';
import { engine, useSimState, useStep } from '../../state/sim';
import { sectionLabels } from '../../ui/CrossSection';
import { Labels, type Label3D } from '../labels';
import { buildDeviceGeometry, type Group } from './mesher';
import { useFinalInput, useOverlay, useRunChoices } from '../../state/presentation';
import type { Choices } from '../../sim/types';

export const DEV = { s: 0.05, zs: 1.3, zMin: -13 };

const mats = {
  semi: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0.02 }),
  diel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.0 }),
  dielGhost: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, transparent: true, opacity: 0.12, depthWrite: false }),
  metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.62 }),
  resist: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.22, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
  glow: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: '#1fcf85', emissiveIntensity: 0.6 }),
};

export const toWorld = (g: Grid, xg: number, yg: number, zg: number): [number, number, number] => [
  (xg - (g.nx * g.dx) / 2) * DEV.s,
  zg * DEV.zs * DEV.s,
  -(yg - (g.ny * g.dy) / 2) * DEV.s,
];

function DeviceMesh({ grid, xray, yMin, glow }: { grid: Grid; xray: boolean; yMin: number; glow?: Set<number> }) {
  const geos = useMemo(
    () =>
      buildDeviceGeometry(grid, {
        yMin,
        xray,
        s: DEV.s,
        zs: DEV.zs,
        zMin: DEV.zMin,
        glow,
      }),
    [grid, xray, yMin, glow],
  );
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);
  useFrame(({ clock }) => {
    mats.glow.emissiveIntensity = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 3));
  });
  const order: Group[] = ['semi', 'metal', 'resist', 'glow', 'diel'];
  return (
    <group>
      {order.map((k) => (
        <mesh
          key={k}
          geometry={geos[k]}
          material={k === 'diel' ? (xray ? mats.dielGhost : mats.diel) : mats[k]}
          castShadow={k !== 'diel' || !xray}
          receiveShadow
          renderOrder={k === 'diel' && xray ? 2 : 0}
        />
      ))}
    </group>
  );
}

/** Translucent pillars showing where contact holes would land for the chosen offset. */
function ContactPreview({ grid, dx, choices }: { grid: Grid; dx: number; choices: Choices }) {
  const land = predictContacts(dx);
  const truth = engine.contactTouches(choices);
  return (
    <group>
      {land.map((c) => {
        const r = LAYOUT.contacts[c.name];
        const bad = c.touchesGate || truth.includes(c.name);
        const x0 = r[0] + dx;
        const x1 = r[2] + dx;
        const [ax, , az] = toWorld(grid, (x0 + x1) / 2, (r[1] + r[3]) / 2, 0);
        const w = (x1 - x0) * DEV.s;
        const d = (r[3] - r[1]) * DEV.s;
        const y0 = 0 * DEV.zs * DEV.s;
        const y1 = 16 * DEV.zs * DEV.s;
        return (
          <mesh key={c.name} position={[ax, (y0 + y1) / 2, az]} renderOrder={4}>
            <boxGeometry args={[w, y1 - y0, d]} />
            <meshBasicMaterial color={bad ? '#ff4d3d' : '#6a5af9'} transparent opacity={0.38} depthWrite={false} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Where the pin tags float (gu): over the visible part of each top-metal shape. */
const TAG_POS: Record<'IN' | 'OUT' | 'VDD', [number, number]> = { IN: [48, 46], OUT: [48, 31], VDD: [80, 59] };

export function DeviceScene() {
  const state = useSimState();
  const { id, index } = useStep();
  const xray = useOverlay('xray');
  const cutaway = useOverlay('cutaway');
  const choices = useRunChoices();
  const [finalInput] = useFinalInput();
  const grid = state.grid;
  const yMin = cutaway ? CUT_Y : 0;
  const isFinal = id === 'final';
  const wired = index >= STEP_INDEX.metal2;
  const elec = useMemo(() => (isFinal ? engine.electrical(choices) : null), [isFinal, choices]);
  const labels = useMemo(() => sectionLabels(grid, CUT_Y).slice(0, 12), [grid]);
  const autoXray = xray || isFinal;
  const glow = useMemo(() => (isFinal && elec ? new Set(finalInput === 0 ? elec.path.in0 : elec.path.in1) : undefined), [isFinal, elec, finalInput]);
  const tags = useMemo(() => {
    const out: Label3D[] = [];
    if (cutaway)
      labels.forEach((l, i) =>
        out.push({ key: 'x' + i, pos: toWorld(grid, l.x, CUT_Y - 0.01, l.z), text: l.text, tone: l.light ? 'dark' : 'light' }),
      );
    if (wired)
      (['IN', 'OUT', 'VDD'] as const).forEach((p) => {
        const pos = TAG_POS[p];
        const lvl = isFinal && elec ? (p === 'IN' ? finalInput : p === 'VDD' ? 1 : finalInput === 0 ? elec.out.in0 : elec.out.in1) : null;
        const text = p + (lvl !== null ? ` = ${lvl === 'X' ? 'short' : lvl === 'Z' ? 'float' : lvl}` : '');
        out.push({ key: p, pos: toWorld(grid, pos[0], pos[1], 28.5), text, tone: 'accent', priority: 2 });
      });
    return out;
  }, [cutaway, labels, wired, isFinal, elec, finalInput, grid]);
  return (
    <group>
      <DeviceMesh grid={grid} xray={autoXray} yMin={yMin} glow={glow} />
      {id === 'contact-align' && <ContactPreview grid={grid} dx={choices.overlay} choices={choices} />}
      <Labels items={tags} />
    </group>
  );
}
