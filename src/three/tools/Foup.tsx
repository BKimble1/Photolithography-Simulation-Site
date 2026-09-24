/**
 * FOUP arrival and wafer hand-off at an equipment front-end module (illustrative, no
 * manufacturer's design).
 *  - 'dock': an overhead hoist lowers a sealed 300 mm FOUP onto a load port (kinematic pins,
 *    ~900 mm high); the port slides it against the EFEM wall, unlatches the pod door and
 *    carries it back and down inside the clean enclosure, exposing the 25 wafers.
 *  - 'robot': inside the EFEM (fan-filter unit above) an R-θ wafer robot slides its thin blade
 *    under the wafer, lifts it, swings it to a pre-aligner, which spins it past an edge sensor
 *    to find the notch and stops with the notch toward +z.
 * Every motion is a pure function of the step progress p.
 *
 * In the fab this is the inside of the wafer sorter at the load-port station (`sorter` in
 * Fab.tsx): the bay model is its enclosure (walls, roof, fan-filter unit, controller cabinet),
 * so when placed the scene keeps only what is inside it and the port band it docks against,
 * and the hoist hangs from the bay's overhead rail.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode, type Ref, type RefObject } from 'react';
import * as THREE from 'three';
import { useSimState } from '../../state/sim';
import { lerp, smooth, useProgressFrame } from '../anim';
import { MAT } from '../materials';
import { Box, CleanFloor, Cyl, LightTower } from '../kit/parts';
import { useStationEnv } from '../stage/context';
import { StationLight } from '../stage/StationLight';
import { Wafer } from '../wafer/Wafer';
import type { ToolProps } from './index';

// ───────────────────────────── layout (metres) ─────────────────────────────

const STAGE_Y = 0.9; // top of the fixed load-port stage
const PLATE_T = 0.012; // sliding dock plate carrying the kinematic pins
const FOUP_Y = STAGE_Y + PLATE_T; // pod base when seated
const PORT_X = 0.3; // our load port; a second port stands at −PORT_X
const DOCK_Z = 0.212; // pod origin (wafer centre) when docked against the port
const UNDOCK_Z = DOCK_Z + 0.065; // where the hoist sets it down
const FRONT = -0.2; // pod door plane in pod coordinates (door faces the tool, −z)
const SLOT0 = 0.046; // slot 1 above the pod base
const PITCH = 0.01; // 10 mm slot pitch
const N_SLOTS = 25;
const OUR_SLOT = 24; // slot 25 (top) holds the wafer we follow
const PSI0 = 2.4; // our wafer's notch angle as it sits in the pod (arbitrary until aligned)
const SLOT_Y = FOUP_Y + SLOT0 + OUR_SLOT * PITCH; // bottom face of our wafer in the docked pod

const EF = { x0: -0.72, x1: 0.6, z0: -0.98, z1: 0, top: 2.02, deck: 0.5 };
const WIN_Y0 = 1.4; // lower edge of the front window band
const WIN_Y1 = 1.92;
/** In the bay, the sorter's roof and filter stay on behind this plane (poses/foup.ts cutaway). */
const ROOF_CUT = -0.62;

// R-θ robot: two equal links keep the blade radial; the wafer rides BLADE_OFF past the wrist.
const RB = { x: 0, z: -0.45 };
const LINK = 0.3;
const BLADE_OFF = 0.2;
const BLADE_DY = 0.118; // blade top above the shoulder joint
const R_MIN = 0.045;
const COLUMN_TOP = 0.86;

// Pre-aligner (chuck top = AL.y); edge sensor on its +x side.
const AL = { x: 0.37, y: 1.02, z: -0.74 };
/** Direction (rotation.y) from the robot to the aligner; the edge sensor sits on the far side. */
const SENSOR_ROT = Math.atan2(-(AL.z - -0.45), AL.x - 0);

// Port-door motion (dock variant): unlatch, pull back, lower.
const DOOR_BACK = 0.075;
const DOOR_DOWN = 0.37;
const HOIST_DROP = 0.42; // how far above the port the hoist starts lowering the pod

type V3 = [number, number, number];

// ───────────────────────────── materials (shared) ─────────────────────────────

const PM = {
  shell: new THREE.MeshPhysicalMaterial({
    color: '#cbd5de',
    metalness: 0,
    roughness: 0.14,
    transparent: true,
    opacity: 0.26,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    depthWrite: false,
  }),
  frame: new THREE.MeshStandardMaterial({ color: '#aab3bc', metalness: 0.05, roughness: 0.42 }),
  door: new THREE.MeshStandardMaterial({ color: '#8f99a3', metalness: 0.05, roughness: 0.46 }),
  base: new THREE.MeshStandardMaterial({ color: '#4a5058', metalness: 0.1, roughness: 0.55 }),
  combDark: new THREE.MeshStandardMaterial({ color: '#5f666e', metalness: 0.05, roughness: 0.5 }),
  si: new THREE.MeshStandardMaterial({ color: '#9aa1ad', metalness: 0.72, roughness: 0.13, envMapIntensity: 1.1 }),
  belt: new THREE.MeshStandardMaterial({ color: '#25272b', metalness: 0.2, roughness: 0.6 }),
};

// ───────────────────────────── geometry helpers ─────────────────────────────

/** Top-view outline of the pod (x, z): straight sides, rounded back corners, open front. */
function podOutline(hw: number, front: number, back: number, rb: number): [number, number][] {
  const pts: [number, number][] = [];
  pts.push([-hw, front]);
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * (Math.PI / 2); // left-back corner
    pts.push([-hw + rb + Math.cos(a) * rb, back - rb - Math.sin(a) * rb]);
  }
  for (let i = 0; i <= n; i++) {
    const a = Math.PI * 1.5 + (i / n) * (Math.PI / 2); // right-back corner
    pts.push([hw - rb + Math.cos(a) * rb, back - rb - Math.sin(a) * rb]);
  }
  pts.push([hw, front]);
  return pts;
}

/** Extrude a top-view outline (x, z) upward by `h` (y from 0 to h). */
function extrudeUp(pts: [number, number][], h: number, bevel = 0): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: h - 2 * bevel,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  g.computeVertexNormals();
  return g;
}

/** A plate in the x–y plane with a rectangular hole, extruded along +z. */
function holedPlate(w: number, h: number, hw: number, hh: number, depth: number, holeY = 0, r = 0.012): THREE.ExtrudeGeometry {
  const rr = (s: THREE.Path, x0: number, y0: number, x1: number, y1: number, rad: number) => {
    s.moveTo(x0 + rad, y0);
    s.lineTo(x1 - rad, y0);
    s.quadraticCurveTo(x1, y0, x1, y0 + rad);
    s.lineTo(x1, y1 - rad);
    s.quadraticCurveTo(x1, y1, x1 - rad, y1);
    s.lineTo(x0 + rad, y1);
    s.quadraticCurveTo(x0, y1, x0, y1 - rad);
    s.lineTo(x0, y0 + rad);
    s.quadraticCurveTo(x0, y0, x0 + rad, y0);
  };
  const shape = new THREE.Shape();
  rr(shape, -w / 2, -h / 2, w / 2, h / 2, Math.min(r, 0.02));
  const hole = new THREE.Path();
  rr(hole, -hw / 2, holeY - hh / 2, hw / 2, holeY + hh / 2, r);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 4,
  });
  g.computeVertexNormals();
  return g;
}

/** Fork-shaped end effector lying flat (x along the blade, thickness along +y). */
function bladeGeometry(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  const w0 = 0.036; // half width at the wrist
  const w1 = 0.062; // half width across the fork
  const gap = 0.042; // half width of the fork opening
  s.moveTo(-0.02, -w0);
  s.lineTo(0.1, -w0);
  s.lineTo(0.15, -w1);
  s.lineTo(0.315, -w1);
  s.quadraticCurveTo(0.33, -w1, 0.33, -w1 + 0.012);
  s.lineTo(0.33, -gap);
  s.lineTo(0.17, -gap);
  s.quadraticCurveTo(0.14, -gap, 0.14, -gap + 0.03);
  s.lineTo(0.14, gap - 0.03);
  s.quadraticCurveTo(0.14, gap, 0.17, gap);
  s.lineTo(0.33, gap);
  s.lineTo(0.33, w1 - 0.012);
  s.quadraticCurveTo(0.33, w1, 0.315, w1);
  s.lineTo(0.15, w1);
  s.lineTo(0.1, w0);
  s.lineTo(-0.02, w0);
  s.lineTo(-0.02, -w0);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.003,
    bevelEnabled: false,
    curveSegments: 6,
  });
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

function perforatedTexture(bg: string, dot: string, repeat: [number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = dot;
  for (let y = 8; y < 128; y += 16)
    for (let x = 8; x < 128; x += 16) {
      ctx.beginPath();
      ctx.arc(x + ((y / 16) % 2) * 8, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ───────────────────────────── the pod ─────────────────────────────

/** Thin wafer discs stacked in slots (instanced); `skip` leaves one slot for the live wafer. */
function WaferStack({ skip = -1, count = N_SLOTS }: { skip?: number; count?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.15, 0.15, 0.0008, 72, 1);
    g.translate(0, 0.0004, 0);
    return g;
  }, []);
  useLayoutEffect(() => {
    const im = ref.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    let i = 0;
    for (let k = 0; k < count; k++) {
      if (k === skip) continue;
      m.makeRotationY(k * 1.37);
      m.setPosition(0, SLOT0 + k * PITCH, 0);
      im.setMatrixAt(i++, m);
    }
    im.count = i;
    im.instanceMatrix.needsUpdate = true;
  }, [skip, count]);
  return <instancedMesh ref={ref} args={[geo, PM.si, count]} castShadow receiveShadow frustumCulled={false} />;
}

/** Comb teeth on both inner side walls, one pair per slot (instanced). */
function Combs() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(0.04, 0.0024, 0.13), []);
  useLayoutEffect(() => {
    const im = ref.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    let i = 0;
    for (let k = 0; k < N_SLOTS; k++)
      for (const s of [-1, 1]) {
        m.makeTranslation(s * 0.168, SLOT0 + k * PITCH - 0.0012, 0.02);
        im.setMatrixAt(i++, m);
      }
    im.instanceMatrix.needsUpdate = true;
  }, []);
  return <instancedMesh ref={ref} args={[geo, PM.combDark, N_SLOTS * 2]} frustumCulled={false} />;
}

/** The pod door (faces −z); latch slots on its outer face, wafer retainer inside. */
function PodDoor() {
  return (
    <group>
      <Box size={[0.346, 0.27, 0.016]} m={PM.door} radius={0.006} />
      {[-0.105, 0.105].map((x) => (
        <Box key={x} size={[0.014, 0.046, 0.004]} position={[x, 0, -0.009]} m="black" radius={0.002} castShadow={false} />
      ))}
      {/* registration holes and a stiffening rib */}
      {[-0.14, 0.14].map((x) => (
        <Cyl key={x} r={0.007} h={0.004} position={[x, -0.1, -0.009]} rotation={[Math.PI / 2, 0, 0]} m="black" seg={16} castShadow={false} />
      ))}
      <Box size={[0.3, 0.012, 0.006]} position={[0, 0.112, -0.009]} m={PM.frame} radius={0.002} castShadow={false} />
      {/* wafer retainer (inside face) */}
      <Box size={[0.04, 0.25, 0.008]} position={[0, 0, 0.012]} m={PM.combDark} radius={0.003} castShadow={false} />
    </group>
  );
}

/** A 300 mm FOUP in pod coordinates: origin on the base under the wafer centre, door toward −z. */
function Pod({ withDoor = true, skip = -1, children }: { withDoor?: boolean; skip?: number; children?: ReactNode }) {
  const geo = useMemo(() => {
    const hw = 0.195;
    const back = 0.205;
    const rb = 0.13;
    const outer = podOutline(hw, FRONT, back, rb);
    const inner = podOutline(hw - 0.004, FRONT, back - 0.004, rb - 0.004);
    const wallPts = [...outer, ...inner.reverse()];
    const walls = extrudeUp(wallPts, 0.3);
    walls.translate(0, 0.018, 0);
    const lid = extrudeUp(outer, 0.014, 0.004);
    lid.translate(0, 0.316, 0);
    const base = extrudeUp(outer, 0.02, 0.004);
    const frame = holedPlate(0.414, 0.33, 0.352, 0.274, 0.018, 0.001, 0.014);
    frame.translate(0, 0.165, FRONT - 0.009);
    return { walls, lid, base, frame };
  }, []);
  return (
    <group>
      <mesh geometry={geo.base} material={PM.base} castShadow receiveShadow />
      <mesh geometry={geo.walls} material={PM.shell} renderOrder={2} />
      <mesh geometry={geo.lid} material={PM.shell} renderOrder={2} />
      <mesh geometry={geo.frame} material={PM.frame} castShadow receiveShadow />
      {/* top flange for the overhead hoist gripper */}
      <Box size={[0.09, 0.03, 0.09]} position={[0, 0.345, 0.01]} m={PM.frame} radius={0.008} />
      <Box size={[0.2, 0.013, 0.17]} position={[0, 0.366, 0.01]} m={PM.frame} radius={0.006} />
      {/* side handles */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.206, 0.19, 0.03]}>
          <Box size={[0.02, 0.024, 0.17]} position={[s * 0.016, 0, 0]} m={PM.frame} radius={0.008} />
          <Box size={[0.03, 0.02, 0.022]} position={[0, 0, -0.07]} m={PM.frame} radius={0.004} />
          <Box size={[0.03, 0.02, 0.022]} position={[0, 0, 0.07]} m={PM.frame} radius={0.004} />
        </group>
      ))}
      {/* comb spines and teeth */}
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.006, 0.26, 0.11]} position={[s * 0.187, 0.17, 0.02]} m={PM.combDark} radius={0.002} castShadow={false} />
      ))}
      <Combs />
      <WaferStack skip={skip} />
      {withDoor && (
        <group position={[0, 0.166, FRONT]}>
          <PodDoor />
        </group>
      )}
      {children}
    </group>
  );
}

// ───────────────────────────── load port ─────────────────────────────

function LoadPort({ x, plateRef, closed = true }: { x: number; plateRef?: Ref<THREE.Group>; closed?: boolean }) {
  const pinPos: V3[] = [
    [0, PLATE_T, 0.12],
    [-0.11, PLATE_T, -0.075],
    [0.11, PLATE_T, -0.075],
  ];
  return (
    <group position={[x, 0, 0]}>
      {/* lower cover and stage housing */}
      <Box size={[0.46, 0.6, 0.1]} position={[0, 0.3, 0.05]} m="panel" radius={0.012} />
      <Box size={[0.46, 0.3, 0.3]} position={[0, 0.735, 0.15]} m="panel" radius={0.02} />
      <Box size={[0.4, 0.06, 0.004]} position={[0, 0.8, 0.301]} m="panelGray" radius={0.002} castShadow={false} />
      {/* operator buttons */}
      {[-0.03, 0.03].map((bx) => (
        <Cyl
          key={bx}
          r={0.008}
          h={0.006}
          position={[0.15 + bx, 0.8, 0.303]}
          rotation={[Math.PI / 2, 0, 0]}
          m={bx < 0 ? 'screen' : 'black'}
          seg={16}
          castShadow={false}
        />
      ))}
      {/* fixed stage */}
      <Box size={[0.44, 0.03, 0.47]} position={[0, STAGE_Y - 0.015, 0.25]} m="panelGray" radius={0.008} />
      {/* sliding dock plate with three kinematic pins */}
      <group ref={plateRef} position={[0, STAGE_Y, closed ? DOCK_Z : UNDOCK_Z]}>
        <Box size={[0.36, PLATE_T, 0.36]} position={[0, PLATE_T / 2, 0.02]} m="steelSatin" radius={0.004} />
        {pinPos.map((pp, i) => (
          <Cyl key={i} r={0.009} rTop={0.004} h={0.012} position={[pp[0], pp[1] + 0.006, pp[2]]} m="chrome" seg={16} />
        ))}
      </group>
    </group>
  );
}

/** Port door and its lift mechanism, inside the EFEM behind the port opening. */
function PortDoorMech({
  x,
  open = false,
  bare = false,
  doorRef,
  carriageRef,
  keysRef,
  mapRef,
}: {
  x: number;
  open?: boolean;
  /** Only the closed door panel (the idle port's drive is left out to keep the view clear). */
  bare?: boolean;
  doorRef?: Ref<THREE.Group>;
  carriageRef?: Ref<THREE.Group>;
  keysRef?: Ref<THREE.Group>;
  mapRef?: Ref<THREE.Group>;
}) {
  const doorY = FOUP_Y + 0.166 - (open ? DOOR_DOWN : 0);
  const doorZ = open ? -DOOR_BACK : 0;
  return (
    <group position={[x, 0, 0]}>
      {!bare && (
        <>
          {/* vertical guide with its drive housing below */}
          <Box size={[0.03, 0.84, 0.026]} position={[0, 0.72, -0.2]} m="steelDark" radius={0.006} />
          <Box size={[0.012, 0.8, 0.006]} position={[0, 0.72, -0.183]} m="chrome" radius={0.002} castShadow={false} />
          <Box size={[0.12, 0.16, 0.1]} position={[0, 0.35, -0.2]} m="panelGray" radius={0.012} />
          <group ref={carriageRef} position={[0, doorY, 0]}>
            <Box size={[0.09, 0.12, 0.04]} position={[0, -0.02, -0.165]} m="steelDark" radius={0.008} />
          </group>
        </>
      )}
      <group ref={doorRef} position={[0, doorY, doorZ]}>
        <Box size={[0.34, 0.266, 0.026]} position={[0, 0, -0.018]} m="aluminum" radius={0.006} />
        {!bare && <Box size={[0.05, 0.05, 0.13]} position={[0, -0.02, -0.095]} m="steelSatin" radius={0.008} />}
        {/* vacuum cups */}
        {[-0.14, 0.14].map((cx) => (
          <Cyl key={cx} r={0.012} h={0.006} position={[cx, 0.09, -0.003]} rotation={[Math.PI / 2, 0, 0]} m="rubber" seg={16} castShadow={false} />
        ))}
        {/* wafer-mapping fingers: swing toward the pod and scan the slots as the door lowers */}
        {!bare && (
          <group ref={mapRef}>
            {[-0.15, 0.15].map((fx) => (
              <group key={fx} position={[fx, 0.138, -0.012]}>
                <Box size={[0.012, 0.12, 0.01]} position={[0, 0.06, 0]} m="black" radius={0.003} castShadow={false} />
                <Box size={[0.016, 0.016, 0.014]} position={[0, 0.118, 0]} m="steelDark" radius={0.003} castShadow={false} />
              </group>
            ))}
          </group>
        )}
        {/* latch keys */}
        <group ref={keysRef}>
          {[-0.105, 0.105].map((kx) => (
            <group key={kx} position={[kx, 0, -0.003]} name="key">
              <Box size={[0.01, 0.04, 0.008]} m="chrome" radius={0.002} castShadow={false} />
            </group>
          ))}
        </group>
      </group>
    </group>
  );
}

// ───────────────────────────── EFEM enclosure ─────────────────────────────

function Efem() {
  // placed in the bay, the sorter housing is the enclosure: keep the interior and the port band
  const { placed } = useStationEnv();
  const deckTex = useMemo(() => perforatedTexture('#5d636b', '#2c3035', [10, 7]), []);
  const diffTex = useMemo(() => perforatedTexture('#e3e6ea', '#9ea5ad', [14, 10]), []);
  useEffect(
    () => () => {
      deckTex.dispose();
      diffTex.dispose();
    },
    [deckTex, diffTex],
  );
  const plate = useMemo(() => {
    const g = holedPlate(0.5, 0.78, 0.358, 0.282, 0.03, FOUP_Y + 0.166 - 1.01, 0.014);
    g.translate(0, 1.01, -0.03);
    return g;
  }, []);
  const W = EF.x1 - EF.x0;
  const D = EF.z1 - EF.z0;
  const xc = (EF.x0 + EF.x1) / 2;
  const zc = (EF.z0 + EF.z1) / 2;
  const plateEdge = PORT_X + 0.25; // right edge of our port's plate
  if (placed) {
    // the filter face under the roof: only where the housing's roof stays on
    const diff = { z0: EF.z0 + 0.03, z1: ROOF_CUT };
    return (
      <group>
        {/* the port band the pods dock against: port plates with their openings, fillers, sill */}
        {[-PORT_X, PORT_X].map((x) => (
          <mesh key={x} geometry={plate} position={[x, 0, 0]} material={MAT.panelGray} castShadow receiveShadow />
        ))}
        {(
          [
            [EF.x0 + 0.085, 0.17],
            [0, 0.1],
            [(EF.x1 + plateEdge) / 2, EF.x1 - plateEdge],
          ] as const
        ).map(([x, w]) => (
          <Box key={x} size={[w, 0.78, 0.03]} position={[x, 1.01, -0.015]} m="panel" radius={0.006} />
        ))}
        <Box size={[W, 0.05, 0.04]} position={[xc, WIN_Y0 + 0.025, -0.02]} m="panelGray" radius={0.008} />
        <Box size={[0.12, 0.09, 0.01]} position={[EF.x0 + 0.085, 1.22, 0.004]} m="screen" radius={0.005} castShadow={false} />
        {/* back wall fittings: slot valve, cable duct, controller; ionizer bar under the filter */}
        <Box size={[0.46, 0.12, 0.03]} position={[-0.1, 1.12, EF.z0 + 0.04]} m="steelSatin" radius={0.01} />
        <Box size={[0.38, 0.05, 0.012]} position={[-0.1, 1.12, EF.z0 + 0.058]} m="black" radius={0.004} castShadow={false} />
        <Box size={[0.08, 1.3, 0.06]} position={[EF.x0 + 0.075, 1.2, EF.z0 + 0.06]} m="steelSatin" radius={0.01} />
        <Box size={[0.3, 0.2, 0.06]} position={[0.32, 0.72, EF.z0 + 0.06]} m="panel" radius={0.01} />
        <Box size={[W - 0.12, 0.022, 0.03]} position={[xc, EF.top - 0.1, ROOF_CUT - 0.12]} m="black" radius={0.006} castShadow={false} />
        {/* perforated deck (return air) and the filter face */}
        <mesh position={[xc, EF.deck, zc]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[W - 0.06, D - 0.06]} />
          <meshStandardMaterial map={deckTex} metalness={0.5} roughness={0.5} />
        </mesh>
        <mesh position={[xc, EF.top - 0.004, (diff.z0 + diff.z1) / 2]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[W - 0.06, diff.z1 - diff.z0]} />
          <meshStandardMaterial map={diffTex} metalness={0.4} roughness={0.5} side={THREE.DoubleSide} />
        </mesh>
        <StationLight position={[xc, EF.top - 0.25, zc]} intensity={1.6} distance={3} decay={1.6} color="#f4f7ff" />
      </group>
    );
  }
  return (
    <group>
      {/* frame posts (the front-right one is left out: that corner is cut away) */}
      {(
        [
          [EF.x0, EF.z0],
          [EF.x0, EF.z1 - 0.02],
          [EF.x1, EF.z0],
        ] as const
      ).map(([x, z]) => (
        <Box key={`${x},${z}`} size={[0.04, EF.top, 0.04]} position={[x, EF.top / 2, z]} m="steelSatin" radius={0.006} />
      ))}
      {/* lower front panel and the two port plates with their openings */}
      <Box size={[W, 0.62, 0.03]} position={[xc, 0.31, -0.015]} m="panel" radius={0.008} />
      {[-PORT_X, PORT_X].map((x) => (
        <mesh key={x} geometry={plate} position={[x, 0, 0]} material={MAT.panelGray} castShadow receiveShadow />
      ))}
      {(
        [
          [EF.x0 + 0.085, 0.17],
          [0, 0.1],
          [(EF.x1 + plateEdge) / 2, EF.x1 - plateEdge],
        ] as const
      ).map(([x, w]) => (
        <Box key={x} size={[w, 0.78, 0.03]} position={[x, 1.01, -0.015]} m="panel" radius={0.006} />
      ))}
      {/* window band above the ports */}
      <Box size={[W, 0.05, 0.04]} position={[xc, WIN_Y0 + 0.025, -0.02]} m="panelGray" radius={0.008} />
      <Box size={[W, 0.1, 0.04]} position={[xc, EF.top - 0.05, -0.02]} m="panel" radius={0.008} castShadow={false} />
      <Box size={[0.03, WIN_Y1 - WIN_Y0, 0.036]} position={[0, (WIN_Y0 + WIN_Y1) / 2 + 0.025, -0.02]} m="panelGray" radius={0.006} />
      <Box
        size={[W - 0.04, WIN_Y1 - WIN_Y0 - 0.04, 0.008]}
        position={[xc, (WIN_Y0 + WIN_Y1) / 2 + 0.025, -0.02]}
        m="glassClear"
        radius={0.002}
        castShadow={false}
        receiveShadow={false}
      />
      {/* left side wall, back wall (with a slot valve to the process tool) */}
      <Box size={[0.03, EF.top, D]} position={[EF.x0 + 0.015, EF.top / 2, zc]} m="panel" radius={0.008} />
      <Box size={[W, EF.top, 0.03]} position={[xc, EF.top / 2, EF.z0 + 0.015]} m="panelGray" radius={0.008} />
      <Box size={[0.46, 0.12, 0.03]} position={[-0.1, 1.12, EF.z0 + 0.04]} m="steelSatin" radius={0.01} />
      <Box size={[0.38, 0.05, 0.012]} position={[-0.1, 1.12, EF.z0 + 0.058]} m="black" radius={0.004} castShadow={false} />
      {/* ionizer bar under the filter, cable duct and controller on the back wall */}
      <Box size={[W - 0.12, 0.022, 0.03]} position={[xc, EF.top - 0.1, zc + 0.1]} m="black" radius={0.006} castShadow={false} />
      <Box size={[0.08, 1.3, 0.06]} position={[EF.x0 + 0.075, 1.2, EF.z0 + 0.06]} m="steelSatin" radius={0.01} />
      <Box size={[0.3, 0.2, 0.06]} position={[0.32, 0.72, EF.z0 + 0.06]} m="panel" radius={0.01} />
      <Box size={[0.2, 0.012, 0.004]} position={[0.32, 0.78, EF.z0 + 0.092]} m="panelGray" radius={0.002} castShadow={false} />
      {/* right side: only a low panel; the upper side is cut away to show the mechanism */}
      <Box size={[0.03, EF.deck + 0.02, D]} position={[EF.x1 - 0.015, (EF.deck + 0.02) / 2, zc]} m="panel" radius={0.008} />
      <Box size={[0.04, 0.04, D]} position={[EF.x1, EF.top - 0.02, zc]} m="steelSatin" radius={0.006} castShadow={false} />
      {/* perforated deck (return air) */}
      <mesh position={[xc, EF.deck, zc]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W - 0.06, D - 0.06]} />
        <meshStandardMaterial map={deckTex} metalness={0.5} roughness={0.5} />
      </mesh>
      {/* fan-filter unit: housing, diffuser face, fan and controller; its LEDs light the interior */}
      <Box size={[W + 0.02, 0.16, D + 0.02]} position={[xc, EF.top + 0.08, zc]} m="panel" radius={0.012} castShadow={false} />
      <mesh position={[xc, EF.top - 0.002, zc]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W - 0.08, D - 0.08]} />
        <meshStandardMaterial map={diffTex} metalness={0.4} roughness={0.5} side={THREE.DoubleSide} />
      </mesh>
      <StationLight position={[xc, EF.top - 0.25, zc]} intensity={1.6} distance={3} decay={1.6} color="#f4f7ff" />
      <Cyl r={0.22} h={0.05} position={[xc - 0.2, EF.top + 0.185, zc]} m="steelSatin" seg={48} castShadow={false} />
      <Box size={[0.26, 0.07, 0.18]} position={[xc + 0.36, EF.top + 0.195, zc - 0.1]} m="panelGray" radius={0.01} />
      <LightTower position={[EF.x0 + 0.1, EF.top + 0.16, -0.12]} on="violet" />
      {/* small operator screen on the left filler panel */}
      <Box size={[0.12, 0.09, 0.01]} position={[EF.x0 + 0.085, 1.22, 0.004]} m="screen" radius={0.005} castShadow={false} />
    </group>
  );
}

// ───────────────────────────── wafer robot and pre-aligner ─────────────────────────────

interface ArmRefs {
  lift: RefObject<THREE.Mesh | null>;
  shoulder: RefObject<THREE.Group | null>;
  elbow: RefObject<THREE.Group | null>;
  wrist: RefObject<THREE.Group | null>;
}

function Robot({ refs }: { refs: ArmRefs }) {
  const blade = useMemo(() => bladeGeometry(), []);
  const liftGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.075, 0.075, 1, 40);
    g.translate(0, 0.5, 0);
    return g;
  }, []);
  return (
    <group position={[RB.x, 0, RB.z]}>
      <Cyl r={0.12} h={COLUMN_TOP - EF.deck} position={[0, (COLUMN_TOP + EF.deck) / 2, 0]} m="panel" seg={48} />
      <Cyl r={0.122} h={0.012} position={[0, COLUMN_TOP - 0.004, 0]} m="black" seg={48} />
      <mesh ref={refs.lift} geometry={liftGeo} position={[0, COLUMN_TOP, 0]} material={MAT.steelSatin} castShadow />
      <group ref={refs.shoulder}>
        {/* link 1 */}
        <Cyl r={0.07} h={0.05} position={[0, 0.025, 0]} m="panel" seg={40} />
        <Box size={[LINK, 0.05, 0.12]} position={[LINK / 2, 0.025, 0]} m="panel" radius={0.02} />
        <Cyl r={0.058} h={0.05} position={[LINK, 0.025, 0]} m="panel" seg={40} />
        <group ref={refs.elbow} position={[LINK, 0, 0]}>
          <Cyl r={0.03} h={0.012} position={[0, 0.056, 0]} m="steelSatin" seg={32} />
          <Cyl r={0.046} h={0.04} position={[0, 0.082, 0]} m="panel" seg={40} />
          <Box size={[LINK, 0.04, 0.09]} position={[LINK / 2, 0.082, 0]} m="panel" radius={0.016} />
          <Cyl r={0.04} h={0.04} position={[LINK, 0.082, 0]} m="panel" seg={40} />
          <group ref={refs.wrist} position={[LINK, 0, 0]}>
            <Cyl r={0.03} h={0.014} position={[0, 0.108, 0]} m="black" seg={32} />
            <mesh geometry={blade} position={[0, BLADE_DY - 0.003, 0]} material={MAT.ceramic} castShadow receiveShadow />
            {[
              [0.19, 0.052],
              [0.19, -0.052],
              [0.06, 0],
            ].map(([bx, bz]) => (
              <Cyl key={`${bx},${bz}`} r={0.006} h={0.0012} position={[bx, BLADE_DY + 0.0006, bz]} m="rubber" seg={16} castShadow={false} />
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}

/** Pose the arm: direction phi (rad, three.js rotation.y of the radial axis), wrist radius r, blade top y. */
function poseArm(refs: ArmRefs, phi: number, r: number, bladeTop: number) {
  const a = Math.acos(Math.min(1, r / (2 * LINK)));
  const ys = bladeTop - BLADE_DY;
  if (refs.shoulder.current) {
    refs.shoulder.current.position.y = ys;
    refs.shoulder.current.rotation.y = phi + a;
  }
  if (refs.elbow.current) refs.elbow.current.rotation.y = -2 * a;
  if (refs.wrist.current) refs.wrist.current.rotation.y = a;
  if (refs.lift.current) refs.lift.current.scale.y = Math.max(0.01, ys - COLUMN_TOP);
}

function Aligner({ chuckRef, children }: { chuckRef: Ref<THREE.Group>; children?: ReactNode }) {
  const top = AL.y;
  return (
    <group position={[AL.x, 0, AL.z]}>
      <Box size={[0.12, top - 0.19 - EF.deck, 0.12]} position={[0, (top - 0.19 + EF.deck) / 2, 0]} m="steelDark" radius={0.01} />
      <Box size={[0.25, 0.14, 0.25]} position={[0, top - 0.12, 0]} m="panel" radius={0.016} />
      <Box size={[0.2, 0.004, 0.2]} position={[0, top - 0.049, 0]} m="panelGray" radius={0.002} castShadow={false} />
      <Cyl r={0.013} h={0.04} position={[0, top - 0.03, 0]} m="steel" seg={20} />
      <group ref={chuckRef} position={[0, top, 0]}>
        <Cyl r={0.034} h={0.01} position={[0, -0.005, 0]} m="ceramicGray" seg={40} />
        <mesh position={[0, 0.0002, 0]} rotation={[-Math.PI / 2, 0, 0]} material={MAT.steelDark}>
          <ringGeometry args={[0.018, 0.021, 40]} />
        </mesh>
        {children}
      </group>
      {/* notch / edge sensor: emitter above and line sensor below the wafer edge (far side from the robot) */}
      <group rotation={[0, SENSOR_ROT, 0]}>
        <group position={[0.15, top, 0]}>
          <Box size={[0.08, 0.03, 0.05]} position={[0, -0.03, 0]} m="black" radius={0.006} />
          <Box size={[0.02, 0.1, 0.05]} position={[0.055, -0.005, 0]} m="black" radius={0.006} />
          <Box size={[0.085, 0.018, 0.05]} position={[0.018, 0.03, 0]} m="black" radius={0.006} />
          <Box size={[0.012, 0.003, 0.012]} position={[-0.012, 0.0205, 0]} m="glassDark" radius={0.001} castShadow={false} />
        </group>
      </group>
    </group>
  );
}

// ───────────────────────────── overhead hoist ─────────────────────────────

const RAIL_Y = 3.3;
/** In the bay the vehicle rides the bay's own overhead loop (Fab.tsx LOOP.y = 3.72): same height as its vehicles. */
const RAIL_Y_BAY = 3.73;

function Hoist({
  gripRef,
  jawL,
  jawR,
  beltRef,
  railY,
  rail,
}: {
  gripRef: Ref<THREE.Group>;
  jawL: Ref<THREE.Group>;
  jawR: Ref<THREE.Group>;
  beltRef: Ref<THREE.Group>;
  railY: number;
  rail: boolean;
}) {
  const beltGeo = useMemo(() => {
    const g = new THREE.BoxGeometry(0.022, 1, 0.002);
    g.translate(0, 0.5, 0);
    return g;
  }, []);
  return (
    <group>
      {/* rail (the bay has its own) and vehicle above the port */}
      {rail && <Box size={[4.2, 0.08, 0.14]} position={[PORT_X, railY + 0.28, UNDOCK_Z]} m="steelSatin" radius={0.01} />}
      <Box size={[0.66, 0.34, 0.5]} position={[PORT_X, railY + 0.07, UNDOCK_Z]} m="panel" radius={0.03} />
      <Box size={[0.5, 0.03, 0.4]} position={[PORT_X, railY - 0.1, UNDOCK_Z]} m="panelGray" radius={0.008} />
      <group ref={beltRef} position={[0, 2.5, 0]}>
        {[
          [-0.13, -0.1],
          [0.13, -0.1],
          [-0.13, 0.1],
          [0.13, 0.1],
        ].map(([bx, bz]) => (
          <mesh key={`${bx},${bz}`} geometry={beltGeo} position={[PORT_X + bx, 0, UNDOCK_Z + bz]} material={PM.belt} />
        ))}
      </group>
      <group ref={gripRef} position={[PORT_X, 2, UNDOCK_Z]}>
        <Box size={[0.36, 0.07, 0.3]} position={[0, 0.035, 0]} m="panel" radius={0.014} />
        <Box size={[0.3, 0.012, 0.24]} position={[0, 0.074, 0]} m="panelGray" radius={0.004} />
        <group ref={jawL}>
          <Box size={[0.03, 0.05, 0.16]} position={[-0.115, -0.018, 0.01]} m="black" radius={0.006} />
          <Box size={[0.05, 0.012, 0.16]} position={[-0.098, -0.04, 0.01]} m="black" radius={0.003} />
        </group>
        <group ref={jawR}>
          <Box size={[0.03, 0.05, 0.16]} position={[0.115, -0.018, 0.01]} m="black" radius={0.006} />
          <Box size={[0.05, 0.012, 0.16]} position={[0.098, -0.04, 0.01]} m="black" radius={0.003} />
        </group>
      </group>
    </group>
  );
}

// ───────────────────────────── choreography ─────────────────────────────

const PHI = (tx: number, tz: number) => Math.atan2(-(tz - RB.z), tx - RB.x);
const RW = (tx: number, tz: number) => Math.hypot(tx - RB.x, tz - RB.z);
const PHI_FOUP = PHI(PORT_X, DOCK_Z);
const R_FOUP = RW(PORT_X, DOCK_Z) - BLADE_OFF;
const TWO_PI = Math.PI * 2;
/** The angle equivalent to a (mod 2π) closest to ref, so the arm turns the short way round. */
const near = (a: number, ref: number) => a + TWO_PI * Math.round((ref - a) / TWO_PI);
const PHI_AL = near(PHI(AL.x, AL.z), PHI_FOUP);
const PHI_PARK = near(PHI(-0.5, -0.85), PHI_AL); // idle: blade toward the back-left corner, clear of the ports
const PARK_Y = AL.y - 0.035; // idle blade height (below the aligner's wafer)
const R_AL = RW(AL.x, AL.z) - BLADE_OFF;
/** Notch angle at placement, and the pre-aligner turn that brings the notch to +z after a full scan. */
const PSI_PLACE = PSI0 + (PHI_AL - PHI_FOUP);
const ALIGN_TURN = TWO_PI + (((-PSI_PLACE % TWO_PI) + TWO_PI) % TWO_PI);

/** Robot state for the 'robot' variant at progress p (starts and ends in the parked pose). */
function transferPose(p: number) {
  const inY = SLOT_Y - 0.003; // blade top when sliding in under the wafer
  const upY = SLOT_Y + 0.006; // after the pick lift
  const alHi = AL.y + 0.006;
  const alLo = AL.y - 0.005;
  let r = R_MIN;
  if (p < 0.2) r = lerp(R_MIN, R_FOUP, smooth(p, 0.07, 0.2));
  else if (p < 0.26) r = R_FOUP;
  else if (p < 0.4) r = lerp(R_FOUP, R_MIN, smooth(p, 0.26, 0.38));
  else if (p < 0.5) r = R_MIN;
  else if (p < 0.6) r = lerp(R_MIN, R_AL, smooth(p, 0.5, 0.58));
  else r = lerp(R_AL, R_MIN, smooth(p, 0.62, 0.71));
  // turn from the park direction to the pod (the short way round), then to the aligner, then back to park
  let phi: number;
  if (p < 0.07) phi = lerp(PHI_PARK, near(PHI_FOUP, PHI_PARK), smooth(p, 0, 0.07));
  else if (p < 0.71) phi = lerp(PHI_FOUP, PHI_AL, smooth(p, 0.38, 0.5));
  else phi = lerp(PHI_AL, PHI_PARK, smooth(p, 0.71, 0.84));
  let y: number;
  if (p < 0.07) y = lerp(PARK_Y, inY, smooth(p, 0, 0.07));
  else if (p < 0.26) y = lerp(inY, upY, smooth(p, 0.2, 0.26));
  else if (p < 0.5) y = lerp(upY, alHi, smooth(p, 0.38, 0.5));
  else if (p < 0.71) y = lerp(alHi, alLo, smooth(p, 0.58, 0.62));
  else y = lerp(alLo, PARK_Y, smooth(p, 0.74, 0.86));
  return { phi, r, y };
}

// ───────────────────────────── scene ─────────────────────────────

export default function Foup({ variant }: ToolProps) {
  const state = useSimState();
  const docking = (variant ?? 'dock') !== 'robot';
  const { placed } = useStationEnv();
  const railY = placed ? RAIL_Y_BAY : RAIL_Y;

  const podRef = useRef<THREE.Group>(null);
  const plateRef = useRef<THREE.Group>(null);
  const podDoorRef = useRef<THREE.Group>(null);
  const portDoorRef = useRef<THREE.Group>(null);
  const carriageRef = useRef<THREE.Group>(null);
  const keysRef = useRef<THREE.Group>(null);
  const mapRef = useRef<THREE.Group>(null);
  const gripRef = useRef<THREE.Group>(null);
  const jawL = useRef<THREE.Group>(null);
  const jawR = useRef<THREE.Group>(null);
  const beltRef = useRef<THREE.Group>(null);
  const liveWafer = useRef<THREE.Group>(null);
  const chuck = useRef<THREE.Group>(null);
  const arm: ArmRefs = {
    lift: useRef<THREE.Mesh>(null),
    shoulder: useRef<THREE.Group>(null),
    elbow: useRef<THREE.Group>(null),
    wrist: useRef<THREE.Group>(null),
  };

  useProgressFrame((p) => {
    if (docking) {
      // ── hoist lowers the pod, the port docks it and removes its door ──
      const drop = HOIST_DROP * (1 - smooth(p, 0.02, 0.3));
      const podZ = lerp(UNDOCK_Z, DOCK_Z, smooth(p, 0.36, 0.5));
      if (podRef.current) podRef.current.position.set(PORT_X, FOUP_Y + drop, podZ);
      if (plateRef.current) plateRef.current.position.z = podZ;
      const open = smooth(p, 0.3, 0.34) * 0.034;
      if (jawL.current) jawL.current.position.x = -open;
      if (jawR.current) jawR.current.position.x = open;
      const rise = smooth(p, 0.34, 0.52) * 1.25;
      const gripY = FOUP_Y + drop + 0.373 + rise;
      if (gripRef.current) gripRef.current.position.y = gripY;
      if (beltRef.current) {
        // four hoist belts span from the gripper up to the vehicle
        beltRef.current.position.y = gripY + 0.08;
        beltRef.current.scale.y = Math.max(0.01, railY - 0.1 - (gripY + 0.08));
      }
      const unlatch = smooth(p, 0.5, 0.56);
      const back = DOOR_BACK * smooth(p, 0.56, 0.66);
      const down = DOOR_DOWN * smooth(p, 0.66, 0.8);
      if (keysRef.current) keysRef.current.children.forEach((k) => (k.rotation.z = unlatch * Math.PI * 0.5));
      if (mapRef.current) {
        const reach = smooth(p, 0.62, 0.66) * (1 - smooth(p, 0.8, 0.84));
        mapRef.current.children.forEach((f) => (f.rotation.x = reach * Math.PI * 0.5));
      }
      if (portDoorRef.current) portDoorRef.current.position.set(0, FOUP_Y + 0.166 - down, -back);
      if (carriageRef.current) carriageRef.current.position.y = FOUP_Y + 0.166 - down;
      if (podDoorRef.current) {
        if (p < 0.5) podDoorRef.current.position.set(PORT_X, FOUP_Y + drop + 0.166, podZ + FRONT);
        else podDoorRef.current.position.set(PORT_X, FOUP_Y + 0.166 - down, DOCK_Z + FRONT - back);
      }
      poseArm(arm, PHI_PARK, R_MIN, PARK_Y);
    } else {
      // ── robot: pick from the pod, place on the pre-aligner, find the notch ──
      const { phi, r, y } = transferPose(p);
      poseArm(arm, phi, r, y);
      const g = liveWafer.current;
      if (g) {
        if (p < 0.2) {
          g.position.set(PORT_X, SLOT_Y, DOCK_Z);
          g.rotation.y = PSI0;
        } else if (p < 0.62) {
          const rw = r + BLADE_OFF;
          const wy = p < 0.3 ? Math.max(SLOT_Y, y) : p > 0.5 ? Math.max(AL.y, y) : y;
          g.position.set(RB.x + rw * Math.cos(phi), wy, RB.z - rw * Math.sin(phi));
          g.rotation.y = PSI0 + (phi - PHI_FOUP);
        } else {
          g.position.set(AL.x, AL.y, AL.z);
          g.rotation.y = PSI_PLACE + ALIGN_TURN * smooth(p, 0.64, 0.9);
        }
      }
      if (chuck.current) chuck.current.rotation.y = p < 0.62 ? 0 : ALIGN_TURN * smooth(p, 0.64, 0.9);
    }
  });

  const waferLook = { summary: state.wafer, showParticles: true };
  return (
    <group>
      <CleanFloor size={14} />
      <Efem />
      {/* port A: a second pod waiting, docked and closed */}
      <LoadPort x={-PORT_X} />
      <PortDoorMech x={-PORT_X} bare />
      <group position={[-PORT_X, FOUP_Y, DOCK_Z]}>
        <Pod />
      </group>
      {/* port B: our pod */}
      <LoadPort x={PORT_X} plateRef={plateRef} closed={!docking} />
      <PortDoorMech x={PORT_X} open={!docking} doorRef={portDoorRef} carriageRef={carriageRef} keysRef={keysRef} mapRef={mapRef} />
      {docking ? (
        <>
          <group ref={podRef} position={[PORT_X, FOUP_Y + HOIST_DROP, UNDOCK_Z]}>
            <Pod withDoor={false} skip={OUR_SLOT}>
              <Wafer anchor look={waferLook} position={[0, SLOT0 + OUR_SLOT * PITCH, 0]} rotation={[0, PSI0, 0]} size={768} />
            </Pod>
          </group>
          <group ref={podDoorRef} position={[PORT_X, FOUP_Y + 0.72, UNDOCK_Z + FRONT]}>
            <PodDoor />
          </group>
          <Hoist gripRef={gripRef} jawL={jawL} jawR={jawR} beltRef={beltRef} railY={railY} rail={!placed} />
        </>
      ) : (
        <>
          <group position={[PORT_X, FOUP_Y, DOCK_Z]}>
            <Pod withDoor={false} skip={OUR_SLOT} />
          </group>
          <group position={[PORT_X, FOUP_Y + 0.166 - DOOR_DOWN, DOCK_Z + FRONT - DOOR_BACK]}>
            <PodDoor />
          </group>
          <group ref={liveWafer} position={[PORT_X, SLOT_Y, DOCK_Z]}>
            <Wafer anchor look={waferLook} size={768} />
          </group>
        </>
      )}
      <Robot refs={arm} />
      <Aligner chuckRef={chuck} />
    </group>
  );
}
