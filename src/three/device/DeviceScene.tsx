import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { STEP_INDEX } from '../../sim/flow';
import type { Grid } from '../../sim/grid';
import { CUT_Y, LAYOUT, PINS } from '../../sim/layout';
import { predictContacts } from '../../sim/metrology';
import { engine, useSimState, useStep } from '../../state/sim';
import { useApp } from '../../state/store';
import { sectionLabels } from '../../ui/CrossSection';
import { buildDeviceGeometry, buildHighlight, type Group } from './mesher';

export const DEV = { s: 0.05, zs: 1.3, zMin: -13 };

const mats = {
  semi: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.04 }),
  diel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.0 }),
  dielGhost: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, transparent: true, opacity: 0.13, depthWrite: false }),
  metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.26, metalness: 0.92 }),
  resist: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.2, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
  path: new THREE.MeshBasicMaterial({ color: '#48e0a0', transparent: true, opacity: 0.55, depthWrite: false }),
};

export const toWorld = (g: Grid, xg: number, yg: number, zg: number): [number, number, number] => [
  (xg - (g.nx * g.dx) / 2) * DEV.s,
  zg * DEV.zs * DEV.s,
  -(yg - (g.ny * g.dy) / 2) * DEV.s,
];

function DeviceMesh({ grid, xray, yMin, hideDiel }: { grid: Grid; xray: boolean; yMin: number; hideDiel?: boolean }) {
  const geos = useMemo(
    () =>
      buildDeviceGeometry(grid, {
        yMin,
        xray,
        s: DEV.s,
        zs: DEV.zs,
        zMin: DEV.zMin,
        hide: hideDiel ? { diel: true } : undefined,
      }),
    [grid, xray, yMin, hideDiel],
  );
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);
  const order: Group[] = ['semi', 'metal', 'resist', 'diel'];
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

function PathGlow({ grid, nodes, yMin }: { grid: Grid; nodes: number[]; yMin: number }) {
  const geo = useMemo(() => buildHighlight(grid, nodes, { yMin, xray: true, s: DEV.s, zs: DEV.zs }), [grid, nodes, yMin]);
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current?.material as THREE.MeshBasicMaterial | undefined;
    if (m) m.opacity = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 3));
  });
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh ref={ref} geometry={geo} material={mats.path} renderOrder={3} />;
}

/** Translucent pillars showing where contact holes would land for the chosen offset. */
function ContactPreview({ grid, dx }: { grid: Grid; dx: number }) {
  const land = predictContacts(dx);
  const truth = engine.contactTouches(useApp.getState().choices);
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

function Tag({ position, children, tone = 'dark' }: { position: [number, number, number]; children: React.ReactNode; tone?: 'dark' | 'light' | 'accent' }) {
  const bg = tone === 'accent' ? '#6a5af9' : tone === 'light' ? 'rgba(255,255,255,0.92)' : 'rgba(14,15,18,0.82)';
  const fg = tone === 'light' ? '#0e0f12' : '#fff';
  return (
    <Html position={position} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
      <div
        style={{
          background: bg,
          color: fg,
          fontSize: 11.5,
          padding: '3px 7px',
          borderRadius: 6,
          whiteSpace: 'nowrap',
          fontFamily: 'var(--font)',
          letterSpacing: '0.01em',
          boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        }}
      >
        {children}
      </div>
    </Html>
  );
}

export function DeviceScene() {
  const state = useSimState();
  const { id, index } = useStep();
  const xray = useApp((s) => s.xray);
  const cutaway = useApp((s) => s.cutaway);
  const choices = useApp((s) => s.choices);
  const finalInput = useApp((s) => s.finalInput);
  const grid = state.grid;
  const yMin = cutaway ? CUT_Y : 0;
  const isFinal = id === 'final';
  const wired = index >= STEP_INDEX.metal2;
  const elec = useMemo(() => (isFinal ? engine.electrical(choices) : null), [isFinal, choices]);
  const labels = useMemo(() => sectionLabels(grid, CUT_Y).slice(0, 9), [grid]);
  const autoXray = xray || isFinal;
  return (
    <group>
      <DeviceMesh grid={grid} xray={autoXray} yMin={yMin} />
      {isFinal && elec && <PathGlow grid={grid} nodes={finalInput === 0 ? elec.path.in0 : elec.path.in1} yMin={yMin} />}
      {id === 'contact-align' && <ContactPreview grid={grid} dx={choices.overlay} />}
      {cutaway &&
        labels.map((l, i) => (
          <Tag key={i} position={toWorld(grid, l.x, CUT_Y - 0.01, l.z)} tone={l.light ? 'dark' : 'light'}>
            {l.text}
          </Tag>
        ))}
      {wired &&
        (['IN', 'OUT', 'VDD'] as const).map((p) => {
          const pin = PINS[p];
          if (cutaway && pin.y < CUT_Y) return null;
          const lvl = isFinal && elec ? (p === 'IN' ? finalInput : p === 'VDD' ? 1 : finalInput === 0 ? elec.out.in0 : elec.out.in1) : null;
          return (
            <Tag key={p} position={toWorld(grid, pin.x + (p === 'VDD' ? 30 : 0), pin.y, 29)} tone="accent">
              {p}
              {lvl !== null ? ` = ${lvl === 'X' ? 'short' : lvl === 'Z' ? 'float' : lvl}` : ''}
            </Tag>
          );
        })}
    </group>
  );
}
