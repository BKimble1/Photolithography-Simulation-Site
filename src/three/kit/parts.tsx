/**
 * A small kit of procedural equipment parts shared by the tool scenes: rounded panels,
 * turned (lathed) parts, chucks, nozzle arms, robots, light towers and floors. Units: metres.
 */
import { RoundedBox } from '@react-three/drei';
import { useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { MAT, type MatKey } from '../materials';
import { useStationEnv } from '../stage/context';

type V3 = [number, number, number];

export function mat(k: MatKey | THREE.Material): THREE.Material {
  return typeof k === 'string' ? MAT[k] : k;
}

export function Box({
  size,
  position,
  rotation,
  m = 'panel',
  radius = 0.01,
  castShadow = true,
  receiveShadow = true,
  children,
}: {
  size: V3;
  position?: V3;
  rotation?: V3;
  m?: MatKey | THREE.Material;
  radius?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  children?: ReactNode;
}) {
  const r = Math.min(radius, Math.min(...size) / 2 - 1e-4);
  if (r <= 0.0005) {
    return (
      <mesh position={position} rotation={rotation} material={mat(m)} castShadow={castShadow} receiveShadow={receiveShadow}>
        <boxGeometry args={size} />
        {children}
      </mesh>
    );
  }
  // smoothness 2: a centimetre edge radius reads as rounded at any distance the camera takes,
  // at about half the triangles of 3 (panels are the most numerous part in every tool)
  return (
    <RoundedBox args={size} radius={r} smoothness={2} position={position} rotation={rotation} material={mat(m)} castShadow={castShadow} receiveShadow={receiveShadow}>
      {children}
    </RoundedBox>
  );
}

export function Cyl({
  r,
  h,
  position,
  rotation,
  m = 'steel',
  seg = 48,
  rTop,
  open = false,
  castShadow = true,
}: {
  r: number;
  h: number;
  position?: V3;
  rotation?: V3;
  m?: MatKey | THREE.Material;
  seg?: number;
  rTop?: number;
  open?: boolean;
  castShadow?: boolean;
}) {
  return (
    <mesh position={position} rotation={rotation} material={mat(m)} castShadow={castShadow} receiveShadow>
      <cylinderGeometry args={[rTop ?? r, r, h, seg, 1, open]} />
    </mesh>
  );
}

/** A turned part from a (radius, height) profile — bowls, flanges, lenses, spindles. */
export function Lathe({
  profile,
  position,
  rotation,
  m = 'steel',
  seg = 72,
  scale,
}: {
  profile: [number, number][];
  position?: V3;
  rotation?: V3;
  m?: MatKey | THREE.Material;
  seg?: number;
  scale?: number;
}) {
  const geo = useMemo(() => {
    const g = new THREE.LatheGeometry(
      profile.map(([x, y]) => new THREE.Vector2(x, y)),
      seg,
    );
    g.computeVertexNormals();
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(profile), seg]);
  return <mesh geometry={geo} position={position} rotation={rotation} material={mat(m)} scale={scale} castShadow receiveShadow />;
}

/** A vacuum chuck: a flat disc with concentric grooves on a spindle. */
export function Chuck({ radius = 0.08, position, spin = 0 }: { radius?: number; position?: V3; spin?: number }) {
  return (
    <group position={position}>
      <Cyl r={0.018} h={0.12} position={[0, -0.07, 0]} m="steelDark" />
      <group rotation={[0, spin, 0]}>
        <Cyl r={radius} h={0.012} m="ceramicGray" />
        {[0.3, 0.55, 0.8].map((f) => (
          <mesh key={f} position={[0, 0.0062, 0]} rotation={[-Math.PI / 2, 0, 0]} material={MAT.steelDark}>
            <ringGeometry args={[radius * f, radius * f + 0.0016, 64]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Coater / developer cup: a shallow bowl with an inward catch lip. */
export function Bowl({ r = 0.2, h = 0.11, position }: { r?: number; h?: number; position?: V3 }) {
  const profile: [number, number][] = [
    [0.03, 0],
    [r * 0.98, 0],
    [r, 0.01],
    [r, h * 0.8],
    [r * 0.97, h],
    [r * 0.82, h * 1.06],
    [r * 0.8, h * 1.02],
    [r * 0.93, h * 0.9],
    [r * 0.95, h * 0.2],
    [0.03, h * 0.15],
  ];
  return <Lathe profile={profile} position={position} m="steelSatin" seg={96} />;
}

/** A dispense or rinse arm: vertical post, horizontal arm, downward nozzle. */
export function NozzleArm({
  position,
  length = 0.24,
  angle = 0,
  height = 0.1,
  nozzleM = 'steel',
  tip = 'black',
}: {
  position?: V3;
  length?: number;
  angle?: number;
  height?: number;
  nozzleM?: MatKey;
  tip?: MatKey;
}) {
  return (
    <group position={position}>
      <Cyl r={0.014} h={height} position={[0, height / 2, 0]} m="steelDark" />
      <group rotation={[0, angle, 0]} position={[0, height, 0]}>
        <Box size={[length, 0.018, 0.022]} position={[length / 2, 0, 0]} m="panel" radius={0.006} />
        <Cyl r={0.006} h={0.05} position={[length - 0.01, -0.03, 0]} m={nozzleM} />
        <Cyl r={0.004} h={0.012} position={[length - 0.01, -0.058, 0]} m={tip} />
      </group>
    </group>
  );
}

/** Status light tower with stacked lenses; `on` selects the lit segment. */
export function LightTower({ position, on = 'violet' }: { position?: V3; on?: 'violet' | 'green' | 'amber' | 'none' }) {
  const seg = (k: 'violet' | 'green' | 'amber', y: number) => (
    <Cyl key={k} r={0.022} h={0.04} position={[0, y, 0]} m={on === k ? `${k}Glow` : 'panelGray'} />
  );
  return (
    <group position={position}>
      <Cyl r={0.008} h={0.12} position={[0, 0.06, 0]} m="steelDark" />
      {seg('green', 0.14)}
      {seg('amber', 0.182)}
      {seg('violet', 0.224)}
      <Cyl r={0.022} h={0.008} position={[0, 0.248, 0]} m="panel" />
    </group>
  );
}

/** A two-link SCARA wafer-handling robot with a thin blade end effector. */
export function ScaraRobot({
  position,
  base = 0,
  elbow = 0,
  wrist = 0,
  lift = 0,
  children,
}: {
  position?: V3;
  base?: number;
  elbow?: number;
  wrist?: number;
  lift?: number;
  children?: ReactNode;
}) {
  const l1 = 0.22;
  const l2 = 0.2;
  return (
    <group position={position}>
      <Cyl r={0.07} h={0.16} position={[0, 0.08, 0]} m="panel" />
      <Cyl r={0.05} h={0.04} position={[0, 0.18 + lift, 0]} m="steelSatin" />
      <group position={[0, 0.2 + lift, 0]} rotation={[0, base, 0]}>
        <Box size={[l1, 0.035, 0.06]} position={[l1 / 2, 0, 0]} m="panel" radius={0.015} />
        <group position={[l1, 0.03, 0]} rotation={[0, elbow, 0]}>
          <Cyl r={0.028} h={0.03} m="steelSatin" />
          <Box size={[l2, 0.03, 0.05]} position={[l2 / 2, 0.02, 0]} m="panel" radius={0.012} />
          <group position={[l2, 0.035, 0]} rotation={[0, wrist, 0]}>
            <Cyl r={0.02} h={0.02} m="steelSatin" />
            {/* blade */}
            <Box size={[0.16, 0.004, 0.05]} position={[0.1, 0.006, 0]} m="ceramicGray" radius={0.002} />
            <group position={[0.14, 0.012, 0]}>{children}</group>
          </group>
        </group>
      </group>
    </group>
  );
}

/** Parts of a tool's standalone set (its own floor, backdrop) that the shared bay replaces. */
export function StandaloneOnly({ children }: { children: ReactNode }) {
  const { placed } = useStationEnv();
  return placed ? null : <>{children}</>;
}

/** Raised cleanroom floor with perforated tiles (instanced). */
export function CleanFloor({ size = 12, tile = 0.6, y = 0 }: { size?: number; tile?: number; y?: number }) {
  // In the shared fab the bay's floor is used instead.
  const { placed } = useStationEnv();
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#eceef0';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#d6d9dd';
    for (let yy = 22; yy < 240; yy += 14) for (let xx = 22; xx < 240; xx += 14) {
      ctx.beginPath();
      ctx.arc(xx, yy, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#c9cdd2';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, 253, 253);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(size / tile, size / tile);
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [size, tile]);
  if (placed) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial map={tex} roughness={0.42} metalness={0.05} />
    </mesh>
  );
}

/** A generic process-tool cabinet: plinth, body, window band, screen and light tower. */
export function Cabinet({
  size,
  position,
  rotation,
  window: win = true,
  tower = 'violet',
  screen = true,
  m = 'panel',
}: {
  size: V3;
  position?: V3;
  rotation?: V3;
  window?: boolean;
  tower?: 'violet' | 'green' | 'amber' | 'none';
  screen?: boolean;
  m?: MatKey;
}) {
  const [w, h, d] = size;
  return (
    <group position={position} rotation={rotation}>
      <Box size={[w, 0.08, d]} position={[0, 0.04, 0]} m="panelGray" radius={0.01} />
      <Box size={[w, h - 0.08, d]} position={[0, 0.08 + (h - 0.08) / 2, 0]} m={m} radius={0.02} />
      {win && <Box size={[w * 0.62, h * 0.24, 0.01]} position={[-w * 0.1, h * 0.62, d / 2 + 0.003]} m="glassDark" radius={0.004} castShadow={false} />}
      {screen && <Box size={[w * 0.16, h * 0.13, 0.012]} position={[w * 0.34, h * 0.64, d / 2 + 0.004]} m="screen" radius={0.004} castShadow={false} />}
      <Box size={[w * 0.98, 0.012, 0.01]} position={[0, h * 0.4, d / 2 + 0.003]} m="panelGray" radius={0.002} castShadow={false} />
      {tower !== 'none' && <LightTower position={[w / 2 - 0.08, h, -d / 2 + 0.1]} on={tower} />}
    </group>
  );
}

/** Soft floor shadow blob for grounding small objects cheaply. */
export function ShadowBlob({ position, scale = [1, 1] as [number, number], opacity = 0.18 }: { position?: V3; scale?: [number, number]; opacity?: number }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={position} scale={[scale[0], scale[1], 1]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={tex} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}
