import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import * as THREE from 'three';
import { STEP_INDEX } from '../../sim/flow';
import type { Grid } from '../../sim/grid';
import { CUT_Y, LAYOUT } from '../../sim/layout';
import { predictContacts } from '../../sim/metrology';
import { engine, useOpCount, usePlan, useSimState, useStep } from '../../state/sim';
import { sectionLabels } from '../../ui/CrossSection';
import { Labels, type Label3D } from '../labels';
import { type Group } from './mesher';
import { DEV, deviceMeshes, type DeviceGeos, type MeshRequestOpts } from './deviceGeometry';
import { useFinalInput, useOverlay, useReducedMotion, useRunChoices } from '../../state/presentation';
import { stageTime } from '../stage/time';
import { quality } from '../stage/quality';
import type { Choices } from '../../sim/types';

export { DEV };

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

const meshKey = (stateKey: string, o: MeshRequestOpts) => `${stateKey}|${o.xray ? 1 : 0}|${o.yMin}|${o.glow ? o.glow.join('.') : ''}`;

/**
 * The cross-section's geometry for the presented operation count: built off the main thread
 * (the previous geometry stays on screen until it arrives), the rest of the step's operations
 * prepared in advance. The frame-stepped harness builds synchronously.
 */
function useDeviceGeometry(grid: Grid, opts: MeshRequestOpts): DeviceGeos | null {
  const plan = usePlan();
  const n = useOpCount();
  const choices = useRunChoices();
  const { index } = useStep();
  const key = meshKey(plan.prefix[n], opts);
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => deviceMeshes.subscribe(force), []);
  let geos = deviceMeshes.get(key) ?? null;
  if (!geos && stageTime.virtual) geos = deviceMeshes.buildNow(key, grid, opts);
  const shown = useRef<{ key: string; geos: DeviceGeos } | null>(null);
  if (geos) shown.current = { key, geos };
  const shownKey = shown.current?.key ?? null;
  useEffect(() => {
    if (!shownKey) return;
    deviceMeshes.hold(shownKey);
    return () => deviceMeshes.release(shownKey);
  }, [shownKey]);
  useEffect(() => {
    if (stageTime.virtual) return;
    deviceMeshes.request({ key, choices, n, opts }, true);
    // the rest of this step's operations, ready before they are due
    deviceMeshes.clearLater();
    const st = plan.steps[index];
    for (let m = n + 1; m <= st.end; m++)
      if (plan.prefix[m] !== plan.prefix[m - 1]) deviceMeshes.request({ key: meshKey(plan.prefix[m], opts), choices, n: m, opts }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return shown.current?.geos ?? null;
}

function DeviceMesh({ grid, xray, yMin, glow }: { grid: Grid; xray: boolean; yMin: number; glow?: number[] }) {
  const opts = useMemo(() => ({ xray, yMin, glow }), [xray, yMin, glow]);
  const geos = useDeviceGeometry(grid, opts);
  useEffect(() => quality.invalidate('device'), [geos]);
  const reduced = useReducedMotion();
  useFrame(() => {
    // the live signal path pulses (decorative time; still under reduced motion)
    const t = reduced ? 0 : stageTime.decor;
    mats.glow.emissiveIntensity = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3));
  });
  if (!geos) return null;
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

/**
 * Stand-ins drawn with the cross-section's materials under its lighting, for preparing their
 * programs before the layers are first shown (Stage.tsx, prewarmShared); preparing them also
 * prefilters the lighting's environment map, which is otherwise made when the layers are first
 * drawn. Made once and kept, so that the programs stay cached.
 *
 * (The block had a contact shadow, drei's ContactShadows, drawn once per step from below. It
 * never drew the block: the mesher emits only faces seen from above and from the sides, so from
 * below there is nothing to see; only contact align's translucent preview pillars, boxes, left a
 * faint mark on the floor. It cost three programs compiled in the middle of a move, 4–5 s on the
 * software renderer; two 512² render targets for every step, never released; and a 12 m
 * transparent plane drawn in every frame of the layers. It was removed.)
 */
let standIns: THREE.Group | null = null;
export function deviceProgramStandIns(): THREE.Group {
  if (!standIns) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9), 3));
    standIns = new THREE.Group();
    for (const m of Object.values(mats)) {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = mesh.receiveShadow = true;
      standIns.add(mesh);
    }
  }
  return standIns;
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
  const glow = useMemo(() => (isFinal && elec ? [...(finalInput === 0 ? elec.path.in0 : elec.path.in1)] : undefined), [isFinal, elec, finalInput]);
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
