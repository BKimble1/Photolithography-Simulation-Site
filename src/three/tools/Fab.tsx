/**
 * Illustrative 300 mm cleanroom bay (not any real fab): a raised perforated floor, a ceiling
 * of fan-filter units with linear lights, a central aisle and two rows of tools whose fronts
 * (load ports) face the aisle — stocker, inspection, wet clean, vertical furnaces, etch and
 * deposition clusters, CMP, a long implanter, metrology, the prober, a coater/developer track
 * joined to a large lithography scanner in a yellow-lit bay — and an overhead transport
 * loop whose vehicles carry FOUPs between them. Dicing, packaging and final test stand in a
 * separate room behind a glass wall at the west end.
 *
 * Built to be cheap per pixel, because the bay fills the screen and software renderers
 * (headless test browsers) are fill-rate bound: the static bay is indexed geometry merged
 * per material; the matte parts have their diffuse lighting baked into vertex colours and
 * are drawn as one unlit mesh; floor, ceiling (fan-filter units and light lines in one
 * texture) and walls are single unlit layers; only the scanner's steel cladding and dark
 * glass use the physically based shader. Status lenses, contact shadows and vehicles are
 * instanced (about 40 draw calls in all), and very slow renderers get paced frames (see
 * usePacedRender). The station of the current step gets a violet floor outline and a
 * violet status lens; the others show green. Vehicles move on wall-clock time (idle
 * motion) and stop under reduced motion.
 */
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SceneId } from '../../content/steps';
import { BACKEND, BACKEND_WALL_X, BAY, STATIONS, facing } from './poses/fab';
import { useReducedMotion } from '../../state/presentation';
import { MACHINE_INFO } from '../../content/machines';
import type { MachineId } from '../../state/nav';
import { Label } from '../labels';
import { stationBoxes, stationMatrix } from '../stage/anchors';
import { stageTime } from '../stage/time';
import { TOOL_POSES } from '../poses';

// ───────────────────────────── materials ─────────────────────────────
//
// Performance: the bay fills the whole screen, so the per-pixel cost of its materials sets
// the frame time (software renderers are fill-rate bound). Matte surfaces (powder-coat,
// plastics, floor, walls) use Lambert shading with a small emissive "fill" standing in for
// the image-based ambient light; only metals and dark glass keep the physically based
// shader. Glass partitions are unlit and single-pass.

/** Matte material: Lambert with a fill term (fraction of its own colour) as baked ambient. */
function matte(color: string, fill = 0.4, extra: THREE.MeshLambertMaterialParameters = {}) {
  const c = new THREE.Color(color);
  return new THREE.MeshLambertMaterial({ color: c, emissive: c.clone().multiplyScalar(fill), ...extra });
}
function glassPane(color: string, opacity: number) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  m.forceSinglePass = true;
  return m;
}

const windowMat = new THREE.MeshStandardMaterial({ color: '#2b3239', metalness: 0.4, roughness: 0.14, envMapIntensity: 1.2 });
// brushed stainless that stays light in both the studio (tool) and the bright (home) lighting
const cladMat = new THREE.MeshStandardMaterial({ color: '#cdd2d8', metalness: 0.62, roughness: 0.3 });
// fab-scale steels: less mirror-like than the tool-scale ones, so they stay light at a distance
const fabSteel = new THREE.MeshStandardMaterial({ color: '#d3d7dc', metalness: 0.7, roughness: 0.26 });
const fabSatin = new THREE.MeshStandardMaterial({ color: '#c4c9cf', metalness: 0.55, roughness: 0.38 });
const fabSteelDark = new THREE.MeshStandardMaterial({ color: '#8a9098', metalness: 0.7, roughness: 0.34 });
const fabAlu = new THREE.MeshStandardMaterial({ color: '#d5d8dc', metalness: 0.6, roughness: 0.45 });
const foupMat = matte('#b4bcc5', 0.34);
const whiteMat = matte('#eef0f2', 0.42);
const warmMat = matte('#f1f0ec', 0.42);
const grayMat = matte('#d4d7db', 0.36);
const darkMat = matte('#3a3e45', 0.3);
const blackMat = matte('#1f2125', 0.25);
const platenMat = matte('#8b9097', 0.3);
const recessMat = matte('#2a2e34', 0.3);
const frameMat = matte('#d5d9de', 0.4); // painted aluminium: rails, partition frames

/**
 * The overhead rail runs above the aisle-side load ports, so a camera framing a machine from
 * across the aisle can have it right in front of the lens. The stretch within a few metres of
 * the camera fades out (dithered), like a cutaway of the ceiling; the rest of the loop stays.
 */
function nearCut<T extends THREE.Material>(m: T, from: number, to: number): T {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying float vCamDist;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n\tvCamDist = length(mvPosition.xyz);');
    sh.fragmentShader =
      'varying float vCamDist;\n' +
      sh.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (smoothstep(${from.toFixed(2)}, ${to.toFixed(2)}, vCamDist) < fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;`,
      );
  };
  m.customProgramCacheKey = () => `nearCut:${from}:${to}`;
  return m;
}
const NEAR_CUT: [number, number] = [2.5, 4.5];
const screenMat = new THREE.MeshBasicMaterial({ color: '#1e2c48' });
const violetMat = new THREE.MeshBasicMaterial({ color: '#8a7dff' });
const smokedGlass = new THREE.MeshStandardMaterial({ color: '#20262c', metalness: 0.1, roughness: 0.06, transparent: true, opacity: 0.45 });
const amberGlass = glassPane('#ffd98a', 0.16);
const clearGlass = glassPane('#e6eef4', 0.12);

/**
 * Parts whose lighting is baked into vertex colours at build time (the bay is static and
 * these surfaces are matte, so their shading does not depend on the view). They are all
 * merged into one unlit mesh: the cheapest possible pixels. `metal` uses a harder, more
 * top-lit ramp; `unlit` keeps the colour as is (screens, status line).
 */
type Bake = { color: string; metal?: boolean; unlit?: boolean; own?: boolean };
const BAKE: Partial<Record<string, Bake>> = {
  white: { color: '#eef0f2' },
  warm: { color: '#f1f0ec' },
  gray: { color: '#d4d7db' },
  dark: { color: '#3a3e45' },
  black: { color: '#1f2125' },
  foup: { color: '#b4bcc5' },
  platen: { color: '#8b9097' },
  recess: { color: '#2a2e34' },
  mullion: { color: '#d5d9de' },
  rail: { color: '#d5d9de', own: true },
  steel: { color: '#d3d7dc', metal: true },
  satin: { color: '#c4c9cf', metal: true },
  alu: { color: '#d5d8dc', metal: true },
  steelDark: { color: '#8a9098', metal: true },
  hanger: { color: '#c4c9cf', metal: true, own: true },
  screen: { color: '#1e2c48', unlit: true },
  violet: { color: '#8a7dff', unlit: true },
};

/** Diffuse shading of a unit normal: bright from the ceiling, fronts on both sides alike. */
function shadeOf(nx: number, ny: number, nz: number, metal: boolean): number {
  return metal ? 0.66 + 0.42 * ny + 0.14 * Math.abs(nz) + 0.06 * nx : 0.76 + 0.32 * ny + 0.1 * Math.abs(nz) + 0.05 * nx;
}

function bakeColors(g: THREE.BufferGeometry, b: Bake) {
  const c = new THREE.Color(b.color);
  const n = g.attributes.normal;
  const out = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const k = b.unlit ? 1 : shadeOf(n.getX(i), n.getY(i), n.getZ(i), !!b.metal);
    out[i * 3] = c.r * k;
    out[i * 3 + 1] = c.g * k;
    out[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
}

const bakedMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const railMat = nearCut(new THREE.MeshBasicMaterial({ vertexColors: true }), ...NEAR_CUT);

const MATS = {
  white: whiteMat,
  warm: warmMat,
  gray: grayMat,
  dark: darkMat,
  steel: fabSteel,
  satin: fabSatin,
  steelDark: fabSteelDark,
  alu: fabAlu,
  black: blackMat,
  glass: smokedGlass,
  window: windowMat,
  screen: screenMat,
  foup: foupMat,
  violet: violetMat,
  amber: amberGlass,
  clear: clearGlass,
  platen: platenMat,
  recess: recessMat,
  hanger: bakedMat,
  mullion: frameMat,
  rail: railMat,
  clad: cladMat,
  baked: bakedMat,
} as const;
type FabMat = keyof typeof MATS;

// ───────────────────────────── merged-geometry builder ─────────────────────────────

interface Tower {
  pos: THREE.Vector3;
  id?: SceneId;
}
interface Foot {
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
  id?: SceneId;
}

/** Collects parts per material in a station's local frame (front = +z) and merges them. */
class Kit {
  parts = new Map<FabMat, THREE.BufferGeometry[]>();
  towers: Tower[] = [];
  feet: Foot[] = [];
  private m = new THREE.Matrix4();
  private rot = 0;
  private ox = 0;
  private oz = 0;
  id?: SceneId;

  /** Place the local frame at (x, z), rotated about y; front faces +z locally. */
  at(x: number, z: number, rot = 0, id?: SceneId) {
    this.m.makeRotationY(rot).setPosition(x, 0, z);
    this.rot = rot;
    this.ox = x;
    this.oz = z;
    this.id = id;
    return this;
  }
  add(k: FabMat, geo: THREE.BufferGeometry) {
    // Merged meshes carry positions and normals only (no texture maps), indexed so shared
    // vertices are shaded once: the bay is drawn by software renderers too.
    geo.deleteAttribute('uv');
    const g = geo.index ? geo : mergeVertices(geo, 1e-4);
    g.applyMatrix4(this.m);
    let a = this.parts.get(k);
    if (!a) this.parts.set(k, (a = []));
    a.push(g);
  }
  box(k: FabMat, w: number, h: number, d: number, x: number, y: number, z: number, r = 0) {
    // soft (bevelled) edges only on large bodies, where they read at bay scale
    const rr = Math.min(r, Math.min(w, h, d) / 2 - 1e-4);
    const big = Math.min(w, h, d) > 0.25 && Math.max(w, h, d) > 0.9;
    const g = rr >= 0.02 && big ? new RoundedBoxGeometry(w, h, d, 1, rr) : new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    this.add(k, g);
  }
  cyl(k: FabMat, r: number, h: number, x: number, y: number, z: number, seg = 16, axis: 'x' | 'y' | 'z' = 'y', rTop?: number) {
    const g = new THREE.CylinderGeometry(rTop ?? r, r, h, Math.min(seg, r > 0.3 ? 20 : 12));
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    this.add(k, g);
  }
  /** Status light tower at a local point (pole merged; the lens is instanced). */
  tower(x: number, y: number, z: number) {
    this.cyl('steelDark', 0.014, 0.26, x, y + 0.13, z, 8);
    this.cyl('white', 0.03, 0.02, x, y + 0.34, z, 12);
    const p = new THREE.Vector3(x, y + 0.29, z).applyMatrix4(this.m);
    this.towers.push({ pos: p, id: this.id });
  }
  /** Floor footprint for the soft contact shadow (and the highlight outline). */
  foot(w: number, d: number, x = 0, z = 0) {
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    this.feet.push({ x: this.ox + x * c + z * s, z: this.oz - x * s + z * c, w, d, rot: this.rot, id: this.id });
  }
  build(): { k: FabMat; geo: THREE.BufferGeometry }[] {
    const out: { k: FabMat; geo: THREE.BufferGeometry }[] = [];
    const baked: THREE.BufferGeometry[] = [];
    for (const [k, list] of this.parts) {
      const geo = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      const b = BAKE[k];
      if (!b) {
        out.push({ k, geo });
        continue;
      }
      bakeColors(geo, b);
      if (b.own) out.push({ k, geo });
      else baked.push(geo);
    }
    if (baked.length) {
      out.push({ k: 'baked', geo: mergeGeometries(baked, false) });
      baked.forEach((g) => g.dispose());
    }
    return out;
  }
}

// ───────────────────────────── common tool vocabulary ─────────────────────────────

/** Plinth and powder-coated body of width w, height h, depth d, centred at (x, z). */
function body(K: Kit, w: number, h: number, d: number, x = 0, z = 0, m: FabMat = 'white') {
  K.box('gray', w - 0.05, 0.1, d - 0.05, x, 0.05, z);
  K.box(m, w, h - 0.1, d, x, 0.1 + (h - 0.1) / 2, z, 0.035);
}
/** A thin black reveal line across a front face at height y. */
function reveal(K: Kit, w: number, y: number, zFront: number, x = 0) {
  K.box('black', w, 0.014, 0.012, x, y, zFront + 0.004);
}
/** Vertical panel seams across a front face (x0..x1) between heights y0 and y1. */
function seams(K: Kit, x0: number, x1: number, y0: number, y1: number, zFront: number, pitch = 0.9) {
  const n = Math.max(1, Math.round((x1 - x0) / pitch));
  for (let i = 1; i < n; i++) K.box('gray', 0.01, y1 - y0, 0.01, x0 + ((x1 - x0) * i) / n, (y0 + y1) / 2, zFront + 0.003);
}
/** Roof utilities: an exhaust stack with a flange and a low grille. */
function roof(K: Kit, w: number, h: number, d: number, x = 0, z = 0) {
  K.cyl('satin', 0.11, 0.34, x - w * 0.28, h + 0.17, z - d * 0.22, 16);
  K.cyl('steel', 0.13, 0.03, x - w * 0.28, h + 0.02, z - d * 0.22, 16);
  K.box('gray', Math.min(0.9, w * 0.35), 0.06, Math.min(0.6, d * 0.3), x + w * 0.18, h + 0.03, z - d * 0.18, 0.01);
  for (let i = 0; i < 4; i++) K.box('black', Math.min(0.8, w * 0.32), 0.012, 0.012, x + w * 0.18, h + 0.066, z - d * 0.18 - 0.18 + i * 0.12);
}
function foup(K: Kit, x: number, y: number, z: number) {
  K.box('foup', 0.39, 0.31, 0.42, x, y + 0.155, z, 0.04);
  K.box('gray', 0.22, 0.03, 0.15, x, y + 0.325, z, 0.01);
}
/** Load ports along a front face at zFront; `with` lists which ports hold a FOUP. */
function loadPorts(K: Kit, xs: number[], zFront: number, withFoup: number[] = []) {
  xs.forEach((x, i) => {
    K.box('satin', 0.5, 0.62, 0.035, x, 1.06, zFront + 0.018, 0.012);
    K.box('gray', 0.5, 0.06, 0.44, x, 0.87, zFront + 0.22, 0.012);
    K.box('gray', 0.42, 0.8, 0.06, x, 0.43, zFront + 0.1, 0.012);
    if (withFoup.includes(i)) foup(K, x, 0.9, zFront + 0.24);
  });
}
/** Operator screen on a short arm at the front. */
function screenArm(K: Kit, x: number, y: number, zFront: number) {
  K.box('steelDark', 0.04, 0.04, 0.22, x, y - 0.05, zFront + 0.11, 0.01);
  K.box('dark', 0.42, 0.28, 0.04, x, y + 0.08, zFront + 0.24, 0.012);
  K.box('screen', 0.38, 0.24, 0.01, x, y + 0.08, zFront + 0.265, 0.004);
}

// ───────────────────────────── tools (local frame, front = +z) ─────────────────────────────

/**
 * Wafer sorter (the load-port and wafer-handling station): an equipment front end with two
 * load ports under the overhead rail, a glazed mini-environment under a fan-filter unit, and a
 * controller cabinet behind. It is the enclosure of the detailed scene (Foup.tsx, mounted by
 * poses/foup.ts): walls are separate panels so the cutaway shows the robot and pre-aligner
 * inside, and the port stages match the detailed ones (slightly inset, so they hide inside
 * them below the cut). Port A holds a closed pod; port B waits for ours.
 */
function sorter(K: Kit) {
  // the EFEM box of the detailed scene (Foup.tsx EF), moved by the mount offset
  const [ox, oz] = TOOL_POSES.foup.mount?.offset ?? [0, 0];
  const x0 = ox - 0.72;
  const x1 = ox + 0.6;
  const z0 = oz - 0.98;
  const zf = oz;
  const top = 2.02;
  const w = x1 - x0;
  const d = zf - z0;
  const xc = (x0 + x1) / 2;
  const zc = (z0 + zf) / 2;
  // walls, and the fan-filter unit with its fan housing and controller on the roof
  K.box('white', w, top, 0.03, xc, top / 2, zf - 0.015);
  K.box('white', w, top, 0.03, xc, top / 2, z0 + 0.015);
  K.box('white', 0.03, top, d - 0.06, x0 + 0.015, top / 2, zc);
  K.box('white', 0.03, top, d - 0.06, x1 - 0.015, top / 2, zc);
  // grey interior lining (reads against the white robot when the enclosure is opened)
  K.box('gray', w - 0.07, top - 0.52, 0.006, xc, 0.52 + (top - 0.52) / 2, z0 + 0.033);
  for (const x of [x0 + 0.033, x1 - 0.033]) K.box('gray', 0.006, top - 0.52, d - 0.07, x, 0.52 + (top - 0.52) / 2, zc);
  K.box('white', w + 0.02, 0.16, d + 0.02, xc, top + 0.08, zc);
  K.box('gray', w + 0.03, 0.02, d + 0.03, xc, top + 0.01, zc);
  K.cyl('satin', 0.2, 0.05, xc - 0.2, top + 0.185, z0 + 0.32, 20);
  K.box('gray', 0.26, 0.07, 0.18, xc + 0.32, top + 0.195, z0 + 0.24, 0.01);
  // front: port plates, window band over the robot, sill, a small operator screen
  for (const px of [ox - 0.3, ox + 0.3]) K.box('gray', 0.5, 0.78, 0.012, px, 1.01, zf + 0.004, 0.004);
  K.box('window', w - 0.04, 0.48, 0.012, xc, 1.685, zf + 0.004, 0.004);
  K.box('gray', 0.03, 0.5, 0.02, ox, 1.685, zf + 0.012);
  K.box('gray', w, 0.05, 0.03, xc, 1.425, zf + 0.012);
  K.box('screen', 0.12, 0.09, 0.01, x0 + 0.085, 1.22, zf + 0.006);
  // side window of the mini-environment
  K.box('window', 0.012, 0.48, d - 0.2, x1 + 0.004, 1.685, zc, 0.004);
  // load ports: lower cover, stage housing and stage (as Foup.tsx LoadPort)
  for (const px of [ox - 0.3, ox + 0.3]) {
    K.box('white', 0.45, 0.595, 0.094, px, 0.2975, zf + 0.05);
    K.box('white', 0.45, 0.29, 0.29, px, 0.735, zf + 0.15);
    K.box('gray', 0.43, 0.025, 0.46, px, 0.8825, zf + 0.25);
  }
  foup(K, ox - 0.3, 0.912, zf + 0.212);
  // controller cabinet behind the EFEM
  K.box('gray', w - 0.14, 0.08, 0.44, xc, 0.04, z0 - 0.24);
  K.box('warm', w - 0.1, 1.64, 0.48, xc, 0.9, z0 - 0.24, 0.03);
  for (let i = 0; i < 6; i++) K.box('black', 0.01, 0.012, 0.34, x1 - 0.046, 1.28 + i * 0.05, z0 - 0.24);
  K.tower(x0 + 0.12, top + 0.16, z0 + 0.14);
  K.foot(w + 0.08, zf + 0.485 - (z0 - 0.48), xc, (zf + 0.485 + z0 - 0.48) / 2);
}

/**
 * Optical wafer inspection: a front end with two load ports (and its wafer robot) and, behind a
 * partition, the inspection module (granite stage, optical head) under a higher roof. It is
 * the housing of the detailed scene (Inspect.tsx, mounted by poses/inspect.ts); the cutaway
 * opens both above the pods. The operator screen hangs on an arm rooted below the cut, so the
 * detailed scene can take it over with the live defect map.
 */
function inspection(K: Kit) {
  const w = 2.0;
  const d = 2.4;
  const zf = d / 2;
  body(K, w, 2.1, d - 0.8, 0, -0.4);
  // the front end stops 1 cm short of the module: its back reads as the partition when opened
  body(K, w, 2.0, 0.79, 0, zf - 0.395, 'warm');
  K.box('window', 1.2, 0.34, 0.012, -0.2, 1.62, zf + 0.004);
  reveal(K, w, 1.35, zf);
  loadPorts(K, [-0.5, 0.35], zf, [1]);
  seams(K, -w / 2, w / 2, 0.12, 1.22, zf, 1.0);
  // operator screen (Inspect.tsx BAY_SCREEN)
  K.box('steelDark', 0.05, 0.05, 0.14, 0.72, 1.12, zf + 0.07, 0.01);
  K.box('steelDark', 0.04, 0.34, 0.04, 0.72, 1.27, zf + 0.14);
  K.box('dark', 0.52, 0.35, 0.03, 0.72, 1.55, zf + 0.17, 0.01);
  K.box('screen', 0.48, 0.3, 0.01, 0.72, 1.555, zf + 0.186, 0.004);
  K.box('window', 0.012, 0.5, 1.0, w / 2 + 0.004, 1.5, -0.5);
  K.cyl('satin', 0.12, 0.35, 0.5, 2.27, -0.8, 16);
  K.tower(w / 2 - 0.15, 2.1, -d / 2 + 0.2);
  K.foot(w, d);
}

/**
 * Single-wafer wet clean: a front end with two load ports at the west end and three spin-clean
 * chambers in the upper tier behind windows, chemical cabinets below. The middle chamber is
 * ours: the detailed scene (WetClean.tsx, mounted by poses/wetclean.ts) fills its cell, which
 * the body leaves open behind a front panel standing just proud of the housing. The cutaway
 * takes only that panel (station z > 1.312), so the other chambers and the front end stay shut.
 */
function wetClean(K: Kit) {
  const w = 4.6;
  const d = 2.6;
  const h = 2.6;
  const zf = d / 2;
  // our chamber's cell (WetClean.tsx CH: ±0.52 wide, 0.92 deep, deck 1.3 m, top 2.16 m)
  const cx = TOOL_POSES.wetclean.mount?.offset[0] ?? 0.6;
  const c0 = cx - 0.52;
  const c1 = cx + 0.52;
  const y0 = 1.3;
  const y1 = 2.2;
  const zb = zf - 0.93;
  const block = (xa: number, xb: number, ya: number, yb: number, za: number, zc: number) =>
    K.box('white', xb - xa, yb - ya, zc - za, (xa + xb) / 2, (ya + yb) / 2, (za + zc) / 2, 0.035);
  K.box('gray', w - 0.05, 0.1, d - 0.05, 0, 0.05, 0);
  block(-w / 2, c0, 0.1, h, -zf, zf);
  block(c1, w / 2, 0.1, h, -zf, zf);
  block(c0, c1, 0.1, y0 - 0.02, -zf, zf); // floor of the cell sits inside the chamber deck
  block(c0, c1, y1, h, -zf, zf);
  block(c0, c1, y0, y1, -zf, zb);
  // our chamber's front panel (window and reveals as on the others)
  K.box('white', c1 - c0, y1 - y0, 0.015, cx, (y0 + y1) / 2, zf + 0.0205);
  K.box('window', 0.62, 0.42, 0.012, cx, 1.72, zf + 0.032, 0.004);
  for (const y of [1.38, 2.1]) K.box('black', c1 - c0, 0.014, 0.012, cx, y, zf + 0.03);
  // the other chambers, and the front end, behind windows
  for (const x of [cx - 1.13, cx + 1.13]) K.box('window', 0.62, 0.42, 0.012, x, 1.72, zf + 0.004, 0.004);
  K.box('window', 0.9, 0.42, 0.012, -1.62, 1.72, zf + 0.004, 0.004);
  for (const y of [1.38, 2.1]) {
    reveal(K, c0 + w / 2, y, zf, (c0 - w / 2) / 2);
    reveal(K, w / 2 - c1, y, zf, (c1 + w / 2) / 2);
  }
  for (let i = 0; i < 5; i++) K.box('warm', 0.84, 1.0, 0.012, -1.84 + i * 0.92, 0.72, zf + 0.004, 0.006);
  loadPorts(K, [-1.9, -1.35], zf, [0]);
  K.cyl('satin', 0.16, w - 0.4, 0, h + 0.2, -0.6, 20, 'x');
  K.box('satin', 0.3, 0.2, 0.3, 1.6, h + 0.1, -0.6, 0.02);
  K.box('gray', 0.9, 0.5, d - 0.3, w / 2 - 0.55, h + 0.25, 0.0, 0.03);
  // operator screen below the chamber tier (clear of the cutaway)
  screenArm(K, 1.95, 1.0, zf);
  K.tower(-w / 2 + 0.2, h, -d / 2 + 0.2);
  K.foot(w, d);
}

/**
 * Vertical furnace: a tall back tower (heater above, boat load area below) and a lower FOUP
 * stocker in front with the load port. Three stand in a bank: the middle one is the station's
 * (the detailed Furnace.tsx fills its tower, mounted by poses/furnace.ts), the two beside it
 * are closed neighbours placed outside the station (buildTools), so the cutaway, which opens
 * the tower front and the stocker above the load port, only ever opens ours.
 */
function furnace(K: Kit, withFoup = true) {
  const uw = 1.25;
  K.box('gray', uw - 0.05, 0.1, 1.5, 0, 0.05, -0.75);
  K.box('white', uw, 3.95, 1.5, 0, 0.1 + 3.95 / 2, -0.75, 0.035);
  K.box('satin', uw - 0.3, 0.3, 1.0, 0, 4.2, -0.75, 0.03);
  K.box('window', 0.14, 2.3, 0.012, -uw / 2 + 0.2, 2.35, 0.004, 0.003);
  reveal(K, uw, 3.3, 0);
  // stocker 1 cm clear of the tower; its lid at the cut height closes it when the tower opens
  body(K, uw, 2.25, 1.49, 0, 0.755, 'white');
  K.box('white', uw - 0.08, 0.02, 1.41, 0, 1.28, 0.755);
  K.cyl('satin', 0.09, 0.3, 0.3, 4.5, -1.0, 12);
  K.box('window', 0.7, 0.3, 0.012, -0.15, 1.75, 1.504, 0.004);
  reveal(K, uw, 1.45, 1.5);
  loadPorts(K, [0.28], 1.5, withFoup ? [0] : []);
  K.tower(uw / 2 - 0.16, 4.05, -1.3);
  K.foot(uw, 3.0);
}

/**
 * Plasma etch cluster, laid out like its detailed scene (Etch.tsx) so the cutaway opens onto
 * the same machine: EFEM with three load ports across the front, the load lock behind it, a
 * square vacuum transfer chamber (lid on), process chambers to the right (etch), behind (etch)
 * and to the left (resist strip, with its quartz source), and the gas and RF cabinet at the
 * back. Parts above the cut are drawn just outside the detailed ones (the opening wipe uncovers
 * them); the pumps and legs below it just inside (the detailed ones show once it is open).
 */
function etchCluster(K: Kit) {
  const zf = 1.8;
  const hz = -0.16; // transfer-chamber hub
  const R = 0.912; // hub → chamber axis
  // EFEM across the front, fan-filter unit on top
  body(K, 3.0, 2.15, 0.9, 0, zf - 0.45);
  K.box('gray', 2.9, 0.1, 0.8, 0, 2.2, zf - 0.45, 0.02);
  K.box('window', 1.8, 0.5, 0.012, 0, 1.72, zf + 0.004, 0.004);
  reveal(K, 3.0, 1.38, zf);
  loadPorts(K, [-0.9, 0, 0.9], zf, [0, 2]);
  seams(K, -1.5, 1.5, 0.12, 1.3, zf, 0.75);
  // mainframe plinth, transfer chamber with its lid, load lock
  K.box('gray', 1.16, 0.08, 1.6, 0, 0.04, hz + 0.23);
  K.box('gray', 1.18, 0.85, 1.64, 0, 0.465, hz + 0.23, 0.02);
  K.box('satin', 1.14, 0.2, 1.14, 0, 1.03, hz, 0.012);
  K.box('steel', 1.1, 0.035, 1.1, 0, 1.1475, hz, 0.01);
  K.box('alu', 0.52, 0.185, 0.52, 0, 1.0275, hz + 0.8, 0.012);
  // process chambers: the slit (chamber-local −x) faces the hub
  const slots = [
    { x: R, z: hz, rot: 0, top: 'icp' },
    { x: 0, z: hz - R, rot: 1, top: 'icp' },
    { x: -R, z: hz, rot: 2, top: 'ash' },
  ] as const;
  for (const s of slots) {
    // chamber-local (lx, lz) → station; rot 1 turns a quarter (back), rot 2 mirrors (left)
    const at = (lx: number, lz: number): [number, number] => (s.rot === 1 ? [s.x + lz, s.z - lx] : [s.x + (s.rot === 2 ? -lx : lx), s.z + lz]);
    const box = (k: FabMat, w: number, h: number, d: number, lx: number, y: number, lz: number, r = 0) => {
      const [x, z] = at(lx, lz);
      if (s.rot === 1) K.box(k, d, h, w, x, y, z, r);
      else K.box(k, w, h, d, x, y, z, r);
    };
    const cyl = (k: FabMat, r: number, h: number, lx: number, y: number, lz: number, seg = 24) => {
      const [x, z] = at(lx, lz);
      K.cyl(k, r, h, x, y, z, seg);
    };
    for (const [lx, lz] of [[0.27, 0.27], [-0.27, 0.27], [0.27, -0.27], [-0.27, -0.27]]) box('satin', 0.036, 0.78, 0.036, lx, 0.39, lz);
    cyl('steel', 0.13, 0.36, 0, 0.52, 0);
    box('alu', 0.49, 0.06, 0.35, -0.07, 0.76, -0.02);
    box('alu', 0.1, 0.13, 0.47, -0.31, 1.015, 0);
    // (the kit draws r ≤ 0.3 with 12 sides, larger with 20: radii allow for the flats)
    cyl('alu', 0.305, 0.405, 0, 1.0025, 0, 28);
    if (s.top === 'icp') {
      cyl('alu', 0.302, 0.22, 0, 1.315, 0, 28);
      box('white', 0.31, 0.16, 0.27, 0, 1.495, -0.02, 0.012);
    } else {
      cyl('alu', 0.305, 0.045, 0, 1.2225, 0, 28);
      cyl('gray', 0.125, 0.235, 0, 1.3625, 0, 20);
      for (const a of [0.6, 2.2, 3.8, 5.4]) cyl('satin', 0.011, 0.28, Math.sin(a) * 0.19, 1.385, Math.cos(a) * 0.19, 8);
      cyl('steel', 0.21, 0.017, 0, 1.5225, 0, 28);
      box('white', 0.23, 0.15, 0.19, 0.02, 1.32, -0.3, 0.012);
    }
  }
  // gas and RF cabinet at the back
  body(K, 2.6, 2.3, 0.55, 0, -1.725, 'warm');
  roof(K, 2.6, 2.3, 0.55, 0, -1.725);
  K.tower(1.1, 2.3, -1.9);
  K.foot(3.0, 3.8, 0, -0.1);
}

function track(K: Kit) {
  const w = 6.0;
  const d = 2.2;
  const h = 2.35;
  body(K, w, h, d);
  for (let i = 0; i < 6; i++) K.box('window', 0.62, 0.36, 0.012, -1.55 + i * 0.84, 1.72, d / 2 + 0.004, 0.004);
  reveal(K, w, 1.42, d / 2);
  reveal(K, w, 2.02, d / 2);
  for (let i = 0; i < 6; i++) K.box('warm', 0.8, 1.05, 0.012, -2.15 + i * 0.86, 0.75, d / 2 + 0.004, 0.006);
  // load ports at the west end
  loadPorts(K, [-2.62, -2.1], d / 2, [0, 1]);
  K.cyl('satin', 0.14, w - 0.6, 0.1, h + 0.16, -0.55, 18, 'x');
  K.box('gray', 1.2, 0.36, d - 0.4, 1.9, h + 0.18, 0, 0.03);
  // chemical cabinet doors below, a service rail on top
  for (let i = 0; i < 6; i++) K.box('satin', 0.012, 0.3, 0.02, -2.15 + i * 0.86 + 0.34, 0.75, d / 2 + 0.014);
  K.box('satin', w - 1.8, 0.04, 0.04, -0.5, h + 0.02, d / 2 - 0.1, 0.01);
  screenArm(K, 2.6, 1.5, d / 2);
  K.tower(-w / 2 + 0.2, h, -d / 2 + 0.2);
  K.foot(w, d);
}

/**
 * DUV immersion scanner: white end modules (wafer handling from the track on the left, the
 * reticle library on the right) around a brushed-steel centre section with the projection
 * optics behind dark glazing, the illuminator housing raised on the roof, and the excimer laser
 * behind with its beam-delivery duct. Built as a hollow shell (one body, skins for the colour
 * breaks) so that when its front and top are cut away the detailed interior (Scanner.tsx)
 * stands in an open enclosure, with no inner floors or partitions across it.
 */
function scanner(K: Kit) {
  const w = 5.4;
  const d = 3.2;
  const h = 2.9;
  const zf = d / 2;
  const mw = w - 1.45; // main (steel) section width
  const mx = 0.22;
  const bx = 0.3; // beam delivery, on the lens axis
  // plinth; one white body (the left module is lower), a brushed-steel skin on the centre section
  K.box('gray', w - 0.06, 0.118, d - 0.06, 0, 0.059, 0);
  K.box('white', w, 2.6 - 0.12, d, 0, 0.12 + (2.6 - 0.12) / 2, 0, 0.04);
  K.box('white', w - 0.9, h - 2.6, d, 0.45, 2.6 + (h - 2.6) / 2, 0, 0.03);
  K.box('clad', mw, h - 1.02, 0.012, mx, 1.02 + (h - 1.02) / 2, zf + 0.006);
  K.box('clad', mw, 0.012, d, mx, h + 0.006, 0);
  // raised illuminator housing on the roof; the beam-delivery entry module behind it
  K.box('clad', 2.4, 0.44, d - 0.6, mx + 0.15, h + 0.21, -0.12, 0.05);
  K.box('alu', 1.0, 0.28, 0.55, mx + 0.15, h + 0.57, -1.13, 0.04);
  // front: dark glazing with slim mullions, reveals, a restrained violet status line
  K.box('window', 2.9, 0.86, 0.014, mx - 0.1, 1.86, zf + 0.016, 0.006);
  for (let i = 1; i < 4; i++) K.box('satin', 0.018, 0.86, 0.02, mx - 0.1 - 1.45 + i * 0.725, 1.86, zf + 0.024);
  reveal(K, mw, 1.02, zf, mx);
  reveal(K, mw, 2.46, zf + 0.012, mx);
  K.box('violet', 1.2, 0.012, 0.01, mx + 0.75, 1.3, zf + 0.024);
  for (let i = 0; i < 5; i++) K.box('satin', 0.012, h - 1.1, 0.012, mx - mw / 2 + 0.4 + i * 0.78, 1.02 + (h - 1.02) / 2, zf + 0.018);
  for (let i = 0; i < 4; i++) K.box('warm', 0.86, 0.72, 0.012, mx - 1.3 + i * 0.95, 0.56, zf + 0.004, 0.006);
  screenArm(K, w / 2 - 0.3, 1.45, zf);
  // excimer laser unit behind, with the beam-delivery duct up and into the illuminator housing
  body(K, 3.0, 1.9, 1.1, 0.6, -d / 2 - 1.05, 'warm');
  K.box('window', 1.4, 0.26, 0.012, 0.2, 1.45, -d / 2 - 0.5 + 0.004, 0.004);
  K.box('satin', 0.32, 1.26, 0.32, bx, 2.53, -d / 2 - 0.95, 0.04);
  K.box('satin', 0.32, 0.32, 1.3, bx, 3.0, -d / 2 - 0.47, 0.04);
  K.tower(w / 2 - 0.25, h, -d / 2 + 0.25);
  K.foot(w, d);
  K.foot(3.0, 1.1, 0.6, -d / 2 - 1.05);
}

/**
 * CMP polisher: a cleaner and front-end module with the load port at the west end (station −x),
 * and the polisher cell beside it behind a large window. The detailed scene (Cmp.tsx, mounted
 * by poses/cmp.ts) fills the cell: platen, carrier head on its swing arm, load cup, the
 * clean/dry module's slot in the cell's west wall. The cell is built from panels with the
 * window standing just proud of them, so the cutaway (station z > 1.412, y > 1.25) takes only
 * the window and the cleaner module stays shut.
 */
function cmp(K: Kit) {
  const w = 3.4;
  const d = 2.8;
  const h = 2.35;
  const zf = d / 2;
  const c0 = -0.66; // cleaner | polisher cell
  const cw = w / 2 - c0; // cell width
  const cx = (c0 + w / 2) / 2;
  const y0 = 1.25; // window sill
  const y1 = 2.2;
  K.box('gray', w - 0.05, 0.1, d - 0.05, 0, 0.05, 0);
  // cleaner and front end, load port and window
  K.box('white', c0 + w / 2, h - 0.1, d, (c0 - w / 2) / 2, 0.1 + (h - 0.1) / 2, 0, 0.035);
  K.box('window', 0.6, 0.4, 0.012, -1.18, 1.75, zf + 0.004, 0.004);
  loadPorts(K, [-1.18], zf, [0]);
  // polisher cell: front wall around the window opening, east and back walls, roof
  K.box('white', cw, y0 - 0.1, 0.03, cx, (0.1 + y0) / 2, zf - 0.015);
  K.box('white', cw, h - y1, 0.03, cx, (y1 + h) / 2, zf - 0.015);
  for (const x of [c0 + 0.015, w / 2 - 0.015]) K.box('white', 0.03, y1 - y0, 0.03, x, (y0 + y1) / 2, zf - 0.015);
  K.box('white', 0.03, h - 0.1, d - 0.03, w / 2 - 0.015, 0.1 + (h - 0.1) / 2, -0.015);
  K.box('white', cw - 0.03, h - 0.1, 0.03, cx - 0.015, 0.1 + (h - 0.1) / 2, -zf + 0.015);
  K.box('white', cw, 0.03, d, cx, h - 0.015, 0);
  // the window over the polishing area, on its own panel with slim mullions
  K.box('window', cw - 0.06, y1 - y0, 0.015, cx, (y0 + y1) / 2, zf + 0.0205);
  for (let i = 1; i < 4; i++) K.box('white', 0.03, y1 - y0, 0.012, c0 + 0.03 + ((cw - 0.06) * i) / 4, (y0 + y1) / 2, zf + 0.034);
  reveal(K, w, 1.02, zf);
  seams(K, -w / 2, w / 2, 0.12, 0.98, zf, 0.85);
  screenArm(K, 1.3, 0.92, zf);
  K.box('warm', 1.2, 1.9, 0.6, -0.9, 1.05, -d / 2 - 0.35, 0.03);
  roof(K, w, h, d - 0.7, 0, -0.35);
  K.tower(w / 2 - 0.2, h, -d / 2 + 0.9);
  K.foot(w, d);
}

/**
 * Ion implanter, laid out around its L-shaped beamline (Implant.tsx, mounted by poses/implant.ts
 * a quarter turn round): the high-voltage terminal cage holding the ion source at the back left;
 * one enclosure for the beamline (analyzer magnet, acceleration column, scanner, corrector)
 * running east and for the end station at its east end, whose load lock points at the front
 * end and its load ports; power-supply racks along the rest of the front. The cutaway opens
 * everything above the pods in front of the terminal cage (station z > −2.08), which stays
 * shut. Blocks keep 1 cm apart so their walls read as partitions once opened; the front row
 * has lids at the cut height.
 */
function implanter(K: Kit) {
  const zf = 1.2;
  const x0 = -1.8;
  const x1 = 1.85;
  // terminal cage: viewing window toward the beamline, louvres, exhaust on the roof
  body(K, 1.5, 2.5, 1.35, -1.05, -2.775, 'gray');
  K.box('window', 0.9, 0.6, 0.012, -1.05, 1.85, -2.1 + 0.004, 0.004);
  for (let i = 0; i < 9; i++) K.box('black', 0.01, 0.012, 1.0, x0 - 0.004, 0.7 + i * 0.18, -2.78);
  roof(K, 1.5, 2.5, 1.35, -1.05, -2.775);
  // beamline and end-station enclosure, a window on the magnet side
  body(K, x1 - x0, 2.0, 2.38, (x0 + x1) / 2, -0.9);
  K.box('window', 0.012, 0.4, 1.0, x0 - 0.004, 1.55, -1.3, 0.004);
  K.box('black', 0.012, 0.014, 2.38, x0 - 0.004, 1.35, -0.9);
  // power-supply racks (front left)
  body(K, 2.37, 1.6, 0.9, (x0 + 0.57) / 2, 0.75, 'warm');
  K.box('warm', 2.29, 0.02, 0.82, (x0 + 0.57) / 2, 1.28, 0.75);
  seams(K, x0, 0.57, 0.12, 1.5, zf, 0.8);
  for (let i = 0; i < 4; i++) K.box('black', 2.1, 0.012, 0.01, (x0 + 0.57) / 2, 0.3 + i * 0.09, zf + 0.004);
  screenArm(K, 0.15, 1.02, zf);
  // front end with the load ports (front right) and its filter unit
  body(K, x1 - 0.58, 2.1, 0.9, (0.58 + x1) / 2, 0.75);
  K.box('white', x1 - 0.66, 0.02, 0.82, (0.58 + x1) / 2, 1.28, 0.75);
  K.box('gray', x1 - 0.68, 0.12, 0.8, (0.58 + x1) / 2, 2.16, 0.75, 0.02);
  K.box('window', 1.0, 0.34, 0.012, (0.58 + x1) / 2, 1.72, zf + 0.004, 0.004);
  reveal(K, x1 - 0.58, 1.42, zf, (0.58 + x1) / 2);
  loadPorts(K, [0.9, 1.5], zf, [1]);
  K.tower(1.65, 2.0, -1.9);
  // footprint: the halo takes the first (the beamline block and the front row)
  K.foot(x1 - x0, 3.29, (x0 + x1) / 2, -0.445);
  K.foot(1.5, 1.35, -1.05, -2.775);
}

/**
 * Deposition cluster (CVD), laid out as the detailed scene (Depo.tsx, mounted by poses/depo.ts):
 * a front end with two load ports across the front, two load locks behind it, the hexagonal
 * transfer chamber, four single-wafer chambers on skinned frames (the active one west, the
 * lamp-oxidation chamber east, two behind) and the gas and RF cabinet at the back. The cutaway
 * takes everything above the frames in front of the cabinet (station y > 0.82, z > −1.24); the
 * detailed cluster, which redraws the front end in place, comes up with its chamber cut open.
 */
function depoCluster(K: Kit) {
  const zf = 1.8;
  body(K, 2.4, 2.15, 0.8, 0, zf - 0.4);
  K.box('window', 1.8, 0.5, 0.012, 0, 1.72, zf + 0.004, 0.004);
  reveal(K, 2.4, 1.38, zf);
  loadPorts(K, [-0.55, 0.55], zf, [1]);
  // load locks (60° and 120° from +x), on stands slim enough to hide inside the detailed ones
  for (const deg of [60, 120]) {
    const a = (deg * Math.PI) / 180;
    K.box('gray', 0.2, 0.82, 0.2, Math.cos(a) * 0.85, 0.41, Math.sin(a) * 0.85);
    K.box('alu', 0.42, 0.14, 0.42, Math.cos(a) * 0.85, 0.99, Math.sin(a) * 0.85, 0.01);
  }
  // transfer chamber with its lid
  K.cyl('white', 0.69, 0.8, 0, 0.4, 0, 6);
  K.cyl('alu', 0.72, 0.32, 0, 0.98, 0, 6);
  K.cyl('steel', 0.64, 0.03, 0, 1.155, 0, 6);
  // chambers: skinned frame, body, lid and a gas box toward the hub
  for (const deg of [180, 0, 240, 300]) {
    const a = (deg * Math.PI) / 180;
    const x = Math.cos(a) * 0.94;
    const z = Math.sin(a) * 0.94;
    K.box('white', 0.6, 0.82, 0.6, x, 0.41, z, 0.03);
    K.cyl('satin', 0.31, 0.34, x, 0.99, z, 20);
    K.cyl('alu', 0.3, 0.045, x, 1.1825, z, 20);
    K.box('white', 0.2, 0.09, 0.11, x * 0.82, 1.25, z * 0.82, 0.01);
  }
  // gas and RF cabinet at the back
  body(K, 2.4, 2.3, 0.55, 0, -1.575, 'warm');
  roof(K, 2.4, 2.3, 0.55, 0, -1.575);
  K.tower(1.0, 2.3, -1.6);
  K.foot(2.9, 3.65, 0, -0.025);
}

/**
 * CD-SEM: a cabinet holding the vacuum chamber and its stage, the electron column rising
 * through the roof, a small front end with two load ports, an electronics rack and the
 * operator's monitor on an arm — laid out like the detailed scene (Metrology.tsx), which the
 * cutaway opens onto (the column top and the monitor are drawn just outside the detailed ones).
 */
function metrology(K: Kit) {
  const w = 2.9;
  const d = 2.0;
  const h = 1.95;
  const zf = d / 2;
  const cx = 0.28; // electron column axis
  const cz = -0.17;
  body(K, w, h, d);
  seams(K, -w / 2, w / 2, 0.12, 1.28, zf, 0.97);
  // electron column above the roof: flange, lens section, gun
  K.cyl('steel', 0.13, 0.02, cx, h + 0.01, cz, 24);
  K.cyl('white', 0.115, 0.175, cx, h + 0.1075, cz, 24);
  K.cyl('white', 0.12, 0.095, cx, h + 0.2425, cz, 24, 'y', 0.06);
  K.box('window', 0.9, 0.3, 0.012, 0.25, 1.58, zf + 0.004, 0.004);
  reveal(K, w, 1.32, zf);
  loadPorts(K, [-0.95, -0.35], zf, [0]);
  // operator's monitor on its arm (the live SEM image when the cabinet is opened)
  K.box('steelDark', 0.04, 0.04, 0.23, 1.0, 1.43, zf + 0.115, 0.01);
  K.box('dark', 0.62, 0.4, 0.04, 1.0, 1.53, zf + 0.25, 0.012);
  K.box('screen', 0.58, 0.36, 0.01, 1.0, 1.53, zf + 0.275, 0.004);
  K.tower(w / 2 - 0.15, h, -d / 2 + 0.2);
  K.foot(w, d);
}

/** A box turned about y around (x, z), with a local offset (lx, lz) applied before turning. */
function turnedBox(K: Kit, k: FabMat, w: number, h: number, d: number, x: number, y: number, z: number, ry: number, lx = 0, lz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(lx, 0, lz);
  g.rotateY(ry);
  g.translate(x, y, z);
  K.add(k, g);
}

/**
 * Wafer prober: chassis with the stage chamber under the head plate, the dark test head docked
 * on it and held by its manipulator behind, a loader with a load port on the left, and the
 * tester mainframe behind to the right, turned toward the head — laid out like the detailed
 * scene (Prober.tsx), whose parts sit just inside these.
 */
function prober(K: Kit) {
  const z0 = 0.35; // the probe point (the detailed scene's origin)
  const turned = (k: FabMat, w: number, h: number, d: number, x: number, y: number, z: number, ry: number, lx = 0, lz = 0) => turnedBox(K, k, w, h, d, x, y, z, ry, lx, lz);
  // chassis with its stage chamber, head plate on top
  K.box('gray', 1.2, 0.08, 1.1, 0, 0.04, z0);
  K.box('white', 1.21, 0.92, 1.11, 0, 0.54, z0, 0.02);
  reveal(K, 1.21, 0.69, z0 + 0.555);
  K.box('white', 1.21, 0.04, 0.56, 0, 1.02, z0 - 0.275, 0.01);
  // test head docked on the probe card, cradle arms and beam, manipulator column behind
  K.box('dark', 0.8, 0.33, 0.62, 0.01, 1.265, z0 - 0.22, 0.03);
  for (const s of [-1, 1]) K.box('satin', 0.035, 0.14, 0.47, 0.01 + s * 0.42, 1.27, z0 - 0.36, 0.01);
  K.box('satin', 0.93, 0.13, 0.09, 0.01, 1.27, z0 - 0.6, 0.01);
  K.box('gray', 0.5, 0.08, 0.5, 0, 0.04, z0 - 0.76);
  K.box('white', 0.27, 1.51, 0.27, 0, 0.835, z0 - 0.76, 0.02);
  K.box('satin', 0.21, 0.21, 0.21, 0, 1.27, z0 - 0.66, 0.02);
  // loader with its load port and pod
  K.box('gray', 0.66, 0.08, 1.1, -0.95, 0.04, z0);
  K.box('white', 0.67, 1.21, 1.11, -0.95, 0.685, z0, 0.02);
  K.box('window', 0.5, 0.2, 0.012, -0.95, 1.06, z0 + 0.556, 0.004);
  K.box('gray', 0.49, 0.055, 0.37, -0.95, 0.88, z0 + 0.72, 0.01);
  K.box('gray', 0.53, 0.51, 0.045, -0.95, 1.0, z0 + 0.56, 0.01);
  K.box('foup', 0.4, 0.31, 0.34, -0.95, 1.055, z0 + 0.73, 0.03);
  K.box('gray', 0.21, 0.025, 0.15, -0.95, 1.22, z0 + 0.73, 0.006);
  // tester mainframe
  const tx = 1.4;
  const tz = z0 - 1.5;
  turned('gray', 0.78, 0.08, 0.74, tx, 0.04, tz, -0.45);
  turned('white', 0.79, 1.4, 0.75, tx, 0.78, tz, -0.45);
  turned('window', 0.5, 0.74, 0.012, tx, 0.8, tz, -0.45, -0.04, 0.378);
  turned('black', 0.6, 0.1, 0.012, tx, 1.345, tz, -0.45, 0, 0.378);
  turned('screen', 0.12, 0.08, 0.012, tx, 0.8, tz, -0.45, 0.29, 0.38);
  K.tower(tx + 0.365, 1.48, tz - 0.112);
  K.foot(2.0, 2.0, -0.34, 0.3);
  K.foot(0.9, 0.9, tx, tz);
}

/** A generic single-wafer tool (inspection / metrology style) used to fill out the rows. */
function genericTool(K: Kit, w = 2.2, h = 2.0, d = 2.2, ports = 2) {
  body(K, w, h, d);
  K.box('window', w * 0.5, 0.34, 0.012, -w * 0.12, 1.62, d / 2 + 0.004, 0.004);
  reveal(K, w, 1.34, d / 2);
  seams(K, -w / 2, w / 2, 0.12, 1.3, d / 2, 1.0);
  const xs = Array.from({ length: ports }, (_, i) => -w / 2 + 0.45 + i * 0.6);
  loadPorts(K, xs, d / 2, [0]);
  roof(K, w, h, d);
  K.tower(w / 2 - 0.15, h, -d / 2 + 0.2);
  K.foot(w, d);
}

/** Tape mounter / storage rack for the back-end room. */
function rack(K: Kit, w = 1.6, h = 1.9, d = 0.6) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box('satin', 0.035, h, 0.035, (sx * w) / 2, h / 2, (sz * d) / 2, 0.006);
  for (let i = 0; i < 4; i++) K.box('gray', w, 0.025, d, 0, 0.3 + i * 0.5, 0, 0.004);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) K.box('foup', 0.36, 0.05, 0.36, -w / 2 + 0.3 + j * 0.5, 0.34 + i * 0.5, 0, 0.01);
  K.foot(w, d);
}

/**
 * Dicing saw: a cabinet with the cutting chamber behind its front window and the operator
 * panel on an arm; the detailed saw (Dicing.tsx) stands inside it and is shown when the
 * cabinet opens above the drain pan, in front of the chamber's back wall.
 */
function dicingSaw(K: Kit) {
  const d = 1.17;
  body(K, 1.32, 1.75, d);
  K.box('window', 0.9, 0.5, 0.012, -0.05, 1.12, d / 2 + 0.004, 0.004);
  reveal(K, 1.32, 0.82, d / 2);
  screenArm(K, 0.53, 1.45, d / 2);
  K.tower(0.5, 1.75, -0.53);
  K.foot(1.32, d);
}

/**
 * Die attach and wire bond: a die bonder and a wire bonder on two benches. Their fronts open
 * above the work holders to show the detailed work (Package.tsx), done at millimetre scale.
 */
function bondBenches(K: Kit) {
  for (const x of [-0.75, 0.75]) {
    K.box('warm', 1.3, 0.04, 0.8, x, 0.88, 0, 0.01);
    for (const sx of [-0.6, 0.6]) for (const sz of [-0.34, 0.34]) K.box('satin', 0.04, 0.86, 0.04, x + sx, 0.43, sz, 0.008);
  }
  // die bonder and wire bonder on the benches (clear of the bench tops they stand on)
  K.box('white', 0.8, 0.495, 0.62, -0.75, 1.1525, 0, 0.03);
  K.box('window', 0.5, 0.2, 0.012, -0.75, 1.2, 0.314, 0.004);
  K.box('gray', 0.72, 0.415, 0.56, 0.75, 1.1125, 0, 0.03);
  K.cyl('satin', 0.05, 0.28, 0.75, 1.46, 0.05, 16);
  K.box('dark', 0.16, 0.1, 0.16, 0.75, 1.63, 0.05, 0.02);
  K.tower(1.3, 0.9, -0.3);
  K.foot(2.9, 0.8);
}

/**
 * Final test: a tester cabinet and a test bench with its ESD mat, the load board and a small
 * bench tester — the same pieces and places as the detailed scene (TestBench.tsx, mounted
 * with the bench centre at x = 0.8), which replaces this model close up.
 */
function finalTest(K: Kit) {
  const bx = 0.8;
  body(K, 1.3, 1.85, 1.1, -0.6, 0);
  K.box('window', 0.8, 0.5, 0.012, -0.6, 1.25, 0.554, 0.004);
  reveal(K, 1.3, 0.95, 0.55, -0.6);
  K.box('warm', 1.5, 0.04, 0.8, bx, 0.876, -0.05, 0.01);
  for (const sx of [-0.7, 0.7]) K.box('satin', 0.05, 0.856, 0.7, bx + sx, 0.428, -0.05, 0.01);
  K.box('dark', 1.2, 0.004, 0.66, bx, 0.898, -0.05);
  K.box('dark', 0.22, 0.014, 0.16, bx, 0.907, 0);
  turnedBox(K, 'white', 0.21, 0.085, 0.18, bx + 0.25, 0.9425, -0.29, -0.3);
  turnedBox(K, 'dark', 0.2, 0.076, 0.006, bx + 0.25, 0.943, -0.29, -0.3, 0, 0.09);
  K.tower(-0.1, 1.85, -0.4);
  K.foot(2.8, 1.1);
}

// ───────────────────────────── bay structure ─────────────────────────────

/** Overhead-transport racetrack: two straights above the load ports, joined by half-circles. */
// The loop ends at the track's load ports: the scanner is fed through the track.
const LOOP = { xW: -19.8, xE: 3.2, r: 1.85, y: 3.72 };
const LOOP_LEN = 2 * (LOOP.xE - LOOP.xW) + 2 * Math.PI * LOOP.r;

function loopPoint(s: number, out: THREE.Vector3): number {
  // returns heading (radians about y) and writes the position
  const L1 = LOOP.xE - LOOP.xW;
  const C = Math.PI * LOOP.r;
  let u = ((s % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
  if (u < L1) {
    out.set(LOOP.xW + u, LOOP.y, -LOOP.r); // north straight, heading +x
    return 0;
  }
  u -= L1;
  if (u < C) {
    const a = u / LOOP.r; // east half-circle from north to south
    out.set(LOOP.xE + Math.sin(a) * LOOP.r, LOOP.y, -Math.cos(a) * LOOP.r);
    return -a;
  }
  u -= C;
  if (u < L1) {
    out.set(LOOP.xE - u, LOOP.y, LOOP.r); // south straight, heading −x
    return Math.PI;
  }
  u -= L1;
  const a = u / LOOP.r;
  out.set(LOOP.xW - Math.sin(a) * LOOP.r, LOOP.y, Math.cos(a) * LOOP.r);
  return Math.PI - a;
}

/** The OHT racetrack as a 3D curve (t ∈ [0, 1] around the loop), at rail height. */
class RaceTrack extends THREE.Curve<THREE.Vector3> {
  constructor() {
    super();
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    loopPoint(t * LOOP_LEN, target);
    return target.setY(LOOP.y + 0.36);
  }
}

function buildBay(K: Kit) {
  K.at(0, 0, 0);
  // OHT rail: one continuous box-section swept around the loop; hangers to the ceiling
  const section = new THREE.Shape();
  section.moveTo(-0.06, -0.05);
  section.lineTo(0.06, -0.05);
  section.lineTo(0.06, 0.05);
  section.lineTo(-0.06, 0.05);
  section.closePath();
  const rail = new THREE.ExtrudeGeometry(section, { steps: 420, bevelEnabled: false, extrudePath: new RaceTrack() });
  K.add('rail', rail);
  for (const z of [-LOOP.r, LOOP.r]) {
    for (let x = LOOP.xW; x <= LOOP.xE; x += 2.4) K.cyl('hanger', 0.011, BAY.ceiling - LOOP.y - 0.41, x, (BAY.ceiling + LOOP.y + 0.41) / 2, z, 6);
  }
  // glass wall to the back-end room, with a doorway at the aisle and slim mullions
  const gx = BACKEND_WALL_X;
  const panels: [number, number][] = [];
  for (let z = BAY.z0; z < BAY.z1 - 0.01; z += 1.2) panels.push([z, Math.min(BAY.z1, z + 1.2)]);
  for (const [z0, z1] of panels) {
    const zc = (z0 + z1) / 2;
    if (Math.abs(zc) < 1.0) {
      K.box('clear', 0.02, BAY.ceiling - 2.4, z1 - z0 - 0.04, gx, 2.4 + (BAY.ceiling - 2.4) / 2, zc);
    } else {
      K.box('clear', 0.02, BAY.ceiling, z1 - z0 - 0.04, gx, BAY.ceiling / 2, zc);
    }
    K.box('mullion', 0.05, BAY.ceiling, 0.04, gx, BAY.ceiling / 2, z0);
  }
  K.box('mullion', 0.05, 0.05, BAY.z1 - BAY.z0, gx, 2.4, 0);
  K.box('mullion', 0.07, 0.07, BAY.z1 - BAY.z0, gx, 0.035, 0);
  // litho bay partitions (amber, UV-filtered glass) and a clear partition on the south side
  const partition = (x: number, zA: number, zB: number, k: FabMat) => {
    const n = Math.max(1, Math.round(Math.abs(zB - zA) / 1.2));
    for (let i = 0; i < n; i++) {
      const z0 = zA + ((zB - zA) * i) / n;
      const z1 = zA + ((zB - zA) * (i + 1)) / n;
      K.box(k, 0.02, BAY.ceiling - 0.1, Math.abs(z1 - z0) - 0.04, x, (BAY.ceiling - 0.1) / 2, (z0 + z1) / 2);
      K.box('mullion', 0.04, BAY.ceiling, 0.04, x, BAY.ceiling / 2, z0);
    }
    K.box('mullion', 0.04, BAY.ceiling, 0.04, x, BAY.ceiling / 2, zB);
    K.box('mullion', 0.06, 0.06, Math.abs(zB - zA), x, 0.03, (zA + zB) / 2);
  };
  partition(1.55, -2.35, BAY.z0, 'amber');
  partition(-13.6, -2.35, BAY.z0, 'clear');
}

function buildTools(kitFor: (id?: SceneId) => Kit) {
  const place = (id: SceneId | undefined, x: number, z: number, faceNorth: boolean, fn: (k: Kit) => void) => {
    const K = kitFor(id);
    K.at(x, z, faceNorth ? 0 : Math.PI, id);
    fn(K);
  };
  const st = (id: SceneId) => STATIONS[id]!;
  const north = (id: SceneId, fn: (k: Kit) => void) => place(id, st(id)[0], st(id)[1], facing(id) > 0, fn);
  north('foup', sorter);
  north('inspect', inspection);
  north('wetclean', wetClean);
  north('furnace', (k) => furnace(k));
  // the bank's other two furnaces are closed neighbours outside the station: the cutaway never opens them
  for (const dx of [-1.31, 1.31]) place(undefined, st('furnace')[0] + dx, st('furnace')[1], true, (k) => furnace(k, false));
  north('etch', etchCluster);
  north('track', track);
  north('scanner', scanner);
  north('implant', implanter);
  north('depo', depoCluster);
  north('cmp', cmp);
  north('metrology', metrology);
  north('prober', prober);
  north('dicing', dicingSaw);
  north('package', bondBenches);
  north('testbench', finalTest);
  // tools without a step of their own, to fill out the rows
  place(undefined, 6.8, 3.1, false, (k) => genericTool(k, 2.4, 2.1, 2.2, 2));
  place(undefined, 9.9, 3.0, false, (k) => genericTool(k, 2.2, 2.0, 2.0, 1));
  place(undefined, -13.9, 2.9, false, (k) => genericTool(k, 1.4, 1.9, 1.8, 1));
  place(undefined, -30.2, 3.4, false, (k) => rack(k));
  place(undefined, -23.6, 3.2, false, (k) => genericTool(k, 1.5, 1.7, 1.2, 1));
}

// ───────────────────────────── textures ─────────────────────────────

function softShadowTexture(): THREE.CanvasTexture {
  const n = 64;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const v = (j + 0.5) / n;
      // distance outside the inner rectangle [0.12, 0.88]²
      const dx = Math.max(0.12 - u, 0, u - 0.88);
      const dy = Math.max(0.12 - v, 0, v - 0.88);
      const d = Math.hypot(dx, dy) / 0.12;
      const a = Math.max(0, 1 - d) ** 2;
      const k = (j * n + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 0;
      img.data[k + 3] = Math.round(a * 255);
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function wallTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#eef0f2';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#d8dce0';
  ctx.fillRect(0, 0, 3, 256);
  ctx.fillStyle = '#e3e6e9';
  ctx.fillRect(0, 118, 256, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 1;
  return t;
}

/** Raised-floor tile (0.6 m): perforations and a tile border (same look as the kit floor). */
function floorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#eceef0';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#d6d9dd';
  for (let yy = 22; yy < 240; yy += 14)
    for (let xx = 22; xx < 240; xx += 14) {
      ctx.beginPath();
      ctx.arc(xx, yy, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  ctx.strokeStyle = '#c9cdd2';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, 253, 253);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 2; // software renderers pay per sample; fog hides the far floor
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Ceiling tile of 1.2 m × 1.8 m: three fan-filter units (1.14 × 0.54 m, bright) in a grey
 * grid, and one linear light across the tile. One textured layer replaces separate grid,
 * panel and light meshes (less overdraw).
 */
function ceilingTexture(): THREE.CanvasTexture {
  const W = 128;
  const H = 192; // 1.2 m × 1.8 m at ~107 px/m
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c3c8ce';
  ctx.fillRect(0, 0, W, H);
  const k = W / 1.2;
  for (let r = 0; r < 3; r++) {
    ctx.fillStyle = '#eef1f4';
    ctx.fillRect(0.03 * k, (r * 0.6 + 0.03) * k, 1.14 * k, 0.54 * k);
    ctx.fillStyle = '#e4e8ec';
    ctx.fillRect(0.1 * k, (r * 0.6 + 0.1) * k, 1.0 * k, 0.4 * k);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 1.15 * k, W, 0.1 * k);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 1;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

type Rect = [number, number, number, number]; // x0, x1, z0, z1

/**
 * Horizontal rectangles at height y, merged, facing up (floor) or down (ceiling), with UVs in
 * world units divided by the tile size so a repeating texture lines up across rectangles.
 */
function flatRects(rects: Rect[], y: number, up: boolean, tileX: number, tileZ: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  rects.forEach(([x0, x1, z0, z1], i) => {
    const v = [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ];
    for (const [x, z] of v) {
      pos.push(x, y, z);
      nor.push(0, up ? 1 : -1, 0);
      uv.push(x / tileX, -z / tileZ);
    }
    const b = i * 4;
    // counter-clockwise seen from the side the face points to
    if (up) idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    else idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ───────────────────────────── scene ─────────────────────────────

const LITHO = { x0: 1.55, x1: 14.4, z0: BAY.z0, z1: -BAY.aisle } as const;
const OUT = { x0: BACKEND.x0 - 3, x1: BAY.x1 + 3, z0: BAY.z0 - 4, z1: BAY.z1 + 4 };

const lensMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
const haloLine = new THREE.MeshBasicMaterial({ color: '#6a5af9', transparent: true, opacity: 0.9, depthWrite: false });
const haloFill = new THREE.MeshBasicMaterial({ color: '#7a6cff', transparent: true, opacity: 0.09, depthWrite: false });
const aisleMat = new THREE.MeshBasicMaterial({ color: '#f4f5f6' });
const lineMat = new THREE.MeshBasicMaterial({ color: '#c3c8ce' });
const vehicleMat = whiteMat;
const gripMat = darkMat;

const GREEN = new THREE.Color('#3ddc97');
const VIOLET = new THREE.Color('#7a6cff');
const N_VEHICLES = 7;

/** Stations whose detailed tool is on show: their low-detail proxy is hidden (set by the stage). */
export const proxyHidden = new Set<SceneId>();

/** Housed stations whose enclosure is opened (cut away) to show the detailed interior. */
export const cutOpen = new Set<SceneId>();

/** Housings that should jump to their target state this frame instead of animating. */
export const cutInstant = new Set<SceneId>();

/** How far each housing's cutaway has opened (0 closed … 1 open); animated by the bay. */
const cutT = new Map<SceneId, number>();
export const cutAmount = (id: SceneId) => cutT.get(id) ?? 0;

/** Applies proxyHidden to the bay (registered by the mounted FabScene). */
export const fabLod = { apply: () => {} };

/** Seconds for a housing to open or close. */
const CUT_TIME = 0.8;

interface CutMats {
  planes: [THREE.Plane, THREE.Plane];
  byBase: Map<THREE.Material, THREE.Material>;
}

export interface FabPicking {
  hovered: SceneId | null;
  selected: SceneId | null;
  onHover: (id: SceneId | null) => void;
  onSelect: (id: SceneId) => void;
}

export function FabScene({ highlight, hero, picking }: { highlight?: SceneId; hero?: boolean; picking?: FabPicking }) {
  const reduced = useReducedMotion();
  const built = useMemo(() => {
    const shared = new Kit();
    const kits = new Map<SceneId, Kit>();
    const kitFor = (id?: SceneId) => {
      if (!id) return shared;
      let k = kits.get(id);
      if (!k) kits.set(id, (k = new Kit()));
      return k;
    };
    buildTools(kitFor);
    buildBay(shared);
    const all = [shared, ...kits.values()];
    return {
      meshes: shared.build(),
      stations: [...kits.entries()].map(([id, k]) => ({ id, meshes: k.build() })),
      towers: all.flatMap((k) => k.towers),
      feet: all.flatMap((k) => k.feet),
    };
  }, []);
  useLayoutEffect(
    () => () => {
      built.meshes.forEach((m) => m.geo.dispose());
      built.stations.forEach((st) => st.meshes.forEach((m) => m.geo.dispose()));
    },
    [built],
  );
  // Level of detail: hide a station's proxy (and its lens and floor shadow) while its detailed
  // tool is shown in the same place.
  const stationGroups = useRef(new Map<SceneId, THREE.Group>());
  const lodKey = useRef('');
  const hl: SceneId | undefined = hero ? undefined : highlight === 'wafer' ? 'inspect' : highlight;

  // ── status lenses (instanced, coloured per highlight) ──
  const lenses = useRef<THREE.InstancedMesh>(null);
  const placeLenses = () => {
    const m = lenses.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    built.towers.forEach((t, i) => {
      const hidden = t.id && proxyHidden.has(t.id) && !TOOL_POSES[t.id].cutaway;
      mat.makeTranslation(t.pos.x, t.pos.y, t.pos.z);
      if (hidden) mat.scale(new THREE.Vector3(1e-4, 1e-4, 1e-4));
      m.setMatrixAt(i, mat);
      m.setColorAt(i, t.id && t.id === hl ? VIOLET : GREEN);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };
  useLayoutEffect(placeLenses, [built, hl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── soft contact shadows under every tool ──
  const shadowMaterial = useMemo(() => new THREE.MeshBasicMaterial({ map: softShadowTexture(), color: '#000000', transparent: true, opacity: 0.2, depthWrite: false }), []);
  const shadows = useRef<THREE.InstancedMesh>(null);
  const placeShadows = () => {
    const m = shadows.current;
    if (!m) return;
    const q = new THREE.Quaternion();
    const mat = new THREE.Matrix4();
    built.feet.forEach((f, i) => {
      const k = f.id && proxyHidden.has(f.id) && !TOOL_POSES[f.id].cutaway ? 1e-4 : 1;
      // lie flat (Rx), then turn with the tool (Ry)
      q.setFromEuler(new THREE.Euler(-Math.PI / 2, f.rot, 0, 'YXZ'));
      mat.compose(new THREE.Vector3(f.x, 0.006, f.z), q, new THREE.Vector3((f.w + 0.8) * k, (f.d + 0.8) * k, 1));
      m.setMatrixAt(i, mat);
    });
    m.instanceMatrix.needsUpdate = true;
  };
  useLayoutEffect(placeShadows, [built]); // eslint-disable-line react-hooks/exhaustive-deps
  // The director updates proxyHidden and applies it in the same frame, before it renders.
  const applyLod = () => {
    const key = [...proxyHidden].sort().join(',');
    if (key === lodKey.current) return;
    lodKey.current = key;
    stationGroups.current.forEach((g, id) => (g.visible = !proxyHidden.has(id) || !!TOOL_POSES[id].cutaway));
    placeLenses();
    placeShadows();
  };
  useLayoutEffect(() => {
    fabLod.apply = applyLod;
    return () => {
      if (fabLod.apply === applyLod) fabLod.apply = () => {};
    };
  });

  // ── cutaway housings: the upper front of an opened machine wipes away from the top down ──
  const cuts = useRef(new Map<SceneId, CutMats>());
  const cutTmp = useMemo(() => ({ m: new THREE.Matrix4(), n: new THREE.Vector3(), p: new THREE.Vector3() }), []);
  useFrame((_, raw) => {
    const dt = stageTime.virtual ? stageTime.dt : Math.min(raw, 0.1);
    stationGroups.current.forEach((g, id) => {
      const spec = TOOL_POSES[id].cutaway;
      if (!spec) return;
      const want = cutOpen.has(id) ? 1 : 0;
      const t0 = cutT.get(id) ?? 0;
      const jump = reduced || cutInstant.has(id);
      cutInstant.delete(id);
      const t = jump ? want : want > t0 ? Math.min(1, t0 + dt / CUT_TIME) : Math.max(0, t0 - dt / CUT_TIME);
      if (t === t0 && (t === 0 || cuts.current.has(id))) {
        if (t === 0 && cuts.current.has(id)) restore(g, id);
        return;
      }
      cutT.set(id, t);
      if (t === 0) {
        restore(g, id);
        return;
      }
      let c = cuts.current.get(id);
      if (!c) {
        c = { planes: [new THREE.Plane(), new THREE.Plane()], byBase: new Map() };
        cuts.current.set(id, c);
        const planes = c.planes;
        const byBase = c.byBase;
        g.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const base = (mesh.userData.base as THREE.Material) ?? (mesh.material as THREE.Material);
          mesh.userData.base = base;
          let cm = byBase.get(base);
          if (!cm) {
            cm = base.clone();
            cm.side = THREE.DoubleSide;
            cm.clippingPlanes = planes;
            cm.clipIntersection = true;
            byBase.set(base, cm);
          }
          mesh.material = cm;
        });
      }
      // station-local planes → world: remove z > spec.z (toward the aisle) AND y > wipe height
      const top = stationBoxes.get(id as MachineId)?.max.y ?? 3;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const yCut = top + 0.05 + (spec.y - top - 0.05) * e;
      stationMatrix(id as MachineId, cutTmp.m);
      c.planes[0].setFromNormalAndCoplanarPoint(cutTmp.n.set(0, 0, -1), cutTmp.p.set(0, 0, spec.z)).applyMatrix4(cutTmp.m);
      c.planes[1].setFromNormalAndCoplanarPoint(cutTmp.n.set(0, -1, 0), cutTmp.p.set(0, yCut, 0)).applyMatrix4(cutTmp.m);
    });
  });
  const restore = (g: THREE.Group, id: SceneId) => {
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.userData.base) mesh.material = mesh.userData.base as THREE.Material;
    });
    cuts.current.get(id)?.byBase.forEach((m) => m.dispose());
    cuts.current.delete(id);
    cutT.set(id, 0);
  };

  // ── picking volumes for the fab explorer (one invisible box per station) ──
  const pickBoxes = useMemo(() => {
    return built.stations.map((st) => {
      const box = new THREE.Box3();
      st.meshes.forEach(({ geo }) => {
        if (!geo.boundingBox) geo.computeBoundingBox();
        box.union(geo.boundingBox!);
      });
      const size = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      // the explorer and the flights frame each machine by its footprint
      if (st.id !== 'wafer') stationBoxes.set(st.id as MachineId, box.clone());
      return { id: st.id, size: [size.x + 0.3, size.y + 0.1, size.z + 0.3] as [number, number, number], centre: [c.x, c.y, c.z] as [number, number, number], top: box.max.y };
    });
  }, [built]);

  // ── overhead transport vehicles with FOUPs (idle motion on wall-clock time) ──
  const vBody = useRef<THREE.InstancedMesh>(null);
  const vGrip = useRef<THREE.InstancedMesh>(null);
  const vFoup = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(
    () => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4(), s: new THREE.Vector3(1, 1, 1), zero: new THREE.Vector3(1e-4, 1e-4, 1e-4), up: new THREE.Vector3(0, 1, 0), o: new THREE.Vector3() }),
    [],
  );
  useFrame(({ clock, camera }) => {
    const t = reduced ? 0 : clock.elapsedTime;
    for (let i = 0; i < N_VEHICLES; i++) {
      const s = (i / N_VEHICLES) * LOOP_LEN + t * 0.85;
      const head = loopPoint(s, tmp.p);
      tmp.q.setFromAxisAngle(tmp.up, head);
      // like the rail, vehicles right in front of the camera are left out
      const shown = camera.position.distanceTo(tmp.o.copy(tmp.p).setY(LOOP.y)) > NEAR_CUT[1];
      const scale = shown ? tmp.s : tmp.zero;
      tmp.m.compose(tmp.o.copy(tmp.p).setY(LOOP.y + 0.08), tmp.q, scale);
      vBody.current?.setMatrixAt(i, tmp.m);
      tmp.m.compose(tmp.o.copy(tmp.p).setY(LOOP.y - 0.2), tmp.q, scale);
      vGrip.current?.setMatrixAt(i, tmp.m);
      // most vehicles carry a FOUP
      tmp.m.compose(tmp.o.copy(tmp.p).setY(LOOP.y - 0.42), tmp.q, i % 3 === 2 ? tmp.zero : scale);
      vFoup.current?.setMatrixAt(i, tmp.m);
    }
    for (const r of [vBody, vGrip, vFoup]) if (r.current) r.current.instanceMatrix.needsUpdate = true;
  });

  // ── floor, ceiling and walls: one layer each, cheap unlit/Lambert materials ──
  const surfaces = useMemo(() => {
    const floorTex = floorTexture();
    const ceilTex = ceilingTexture();
    const wallTex = wallTexture();
    // unlit: the floor, ceiling and walls are evenly lit by the filter ceiling
    const floor = new THREE.MeshBasicMaterial({ map: floorTex, color: '#f6f7f8' });
    const floorWarm = new THREE.MeshBasicMaterial({ map: floorTex, color: '#fdf6e8' });
    const ceil = new THREE.MeshBasicMaterial({ map: ceilTex });
    const ceilWarm = new THREE.MeshBasicMaterial({ map: ceilTex, color: '#f8ebce' });
    const wall = new THREE.MeshBasicMaterial({ map: wallTex, color: '#dde1e5' });
    const aisle = BAY.aisle;
    // floor: aisle, two tool rows (the litho bay tinted warm) and a margin outside the walls
    const floorRects: Rect[] = [
      [OUT.x0, LITHO.x0, OUT.z0, -aisle],
      [LITHO.x0, LITHO.x1, OUT.z0, LITHO.z0],
      [LITHO.x1, OUT.x1, OUT.z0, -aisle],
      [OUT.x0, OUT.x1, aisle, OUT.z1],
    ];
    const g = {
      floor: flatRects(floorRects, 0, true, 0.6, 0.6),
      floorWarm: flatRects([[LITHO.x0, LITHO.x1, LITHO.z0, -aisle]], 0, true, 0.6, 0.6),
      aisle: flatRects([[OUT.x0, OUT.x1, -aisle, aisle]], 0.001, true, 1, 1),
      ceil: flatRects(
        [
          [BACKEND.x0, LITHO.x0, BAY.z0, BAY.z1],
          [LITHO.x0, LITHO.x1, -aisle, BAY.z1],
          [LITHO.x1, BAY.x1, BAY.z0, BAY.z1],
        ],
        BAY.ceiling,
        false,
        1.2,
        1.8,
      ),
      ceilWarm: flatRects([[LITHO.x0, LITHO.x1, BAY.z0, -aisle]], BAY.ceiling, false, 1.2, 1.8),
    };
    const wallLen = BAY.x1 - BACKEND.x0;
    const long = new THREE.PlaneGeometry(wallLen, BAY.ceiling);
    const end = new THREE.PlaneGeometry(BAY.z1 - BAY.z0, BAY.ceiling);
    // world-unit UVs for the walls (panel seams every 1.2 m)
    long.attributes.uv.array.forEach((_, i, a) => i % 2 === 0 && ((a as Float32Array)[i] *= wallLen / 1.2));
    end.attributes.uv.array.forEach((_, i, a) => i % 2 === 0 && ((a as Float32Array)[i] *= (BAY.z1 - BAY.z0) / 1.2));
    return { floorTex, ceilTex, wallTex, mats: { floor, floorWarm, ceil, ceilWarm, wall }, g, long, end };
  }, []);
  useLayoutEffect(
    () => () => {
      const { floorTex, ceilTex, wallTex, mats, g, long, end } = surfaces;
      [floorTex, ceilTex, wallTex].forEach((t) => t.dispose());
      Object.values(mats).forEach((m) => m.dispose());
      Object.values(g).forEach((x) => x.dispose());
      long.dispose();
      end.dispose();
      shadowMaterial.map?.dispose();
      shadowMaterial.dispose();
    },
    [surfaces, shadowMaterial],
  );

  const halo = useMemo(() => {
    if (!hl) return null;
    const f = built.feet[hlFootIndex(built, hl)];
    if (!f) return null;
    const w = f.w + 0.7;
    const d = f.d + 0.7;
    const r = 0.25;
    const outer = roundedRect(w, d, r);
    const inner = roundedRect(w - 0.1, d - 0.1, r - 0.05);
    outer.holes.push(inner);
    const line = new THREE.ShapeGeometry(outer, 8);
    const fill = new THREE.ShapeGeometry(roundedRect(w - 0.1, d - 0.1, r - 0.05), 8);
    return { f, line, fill };
  }, [built, hl]);
  useLayoutEffect(
    () => () => {
      halo?.line.dispose();
      halo?.fill.dispose();
    },
    [halo],
  );

  const midX = (BACKEND.x0 + BAY.x1) / 2;
  return (
    <group>
      {/* raised perforated floor (the litho bay tinted by its yellow light), aisle, edge lines */}
      <mesh geometry={surfaces.g.floor} material={surfaces.mats.floor} />
      <mesh geometry={surfaces.g.floorWarm} material={surfaces.mats.floorWarm} />
      <mesh geometry={surfaces.g.aisle} material={aisleMat} />
      {[-BAY.aisle, BAY.aisle].map((z) => (
        <mesh key={z} position={[midX, 0.004, z]} rotation={[-Math.PI / 2, 0, 0]} material={lineMat}>
          <planeGeometry args={[BAY.x1 - BACKEND.x0, 0.05]} />
        </mesh>
      ))}
      {/* walls (face inward only, so the bay opens up when viewed from outside) */}
      <mesh geometry={surfaces.long} position={[midX, BAY.ceiling / 2, BAY.z0]} material={surfaces.mats.wall} />
      <mesh geometry={surfaces.long} position={[midX, BAY.ceiling / 2, BAY.z1]} rotation={[0, Math.PI, 0]} material={surfaces.mats.wall} />
      <mesh geometry={surfaces.end} position={[BACKEND.x0, BAY.ceiling / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={surfaces.mats.wall} />
      <mesh geometry={surfaces.end} position={[BAY.x1, BAY.ceiling / 2, 0]} rotation={[0, -Math.PI / 2, 0]} material={surfaces.mats.wall} />
      {/* ceiling of fan-filter units with linear lights; warm over the lithography bay */}
      <mesh geometry={surfaces.g.ceil} material={surfaces.mats.ceil} />
      <mesh geometry={surfaces.g.ceilWarm} material={surfaces.mats.ceilWarm} />

      {/* all static tool and bay panels, one mesh per material */}
      {built.meshes.map(({ k, geo }) =>
        // rail hangers only read from below (hero); from the raised fab-view cameras they clutter
        k === 'hanger' && !hero ? null : (
          <mesh key={k} geometry={geo} material={MATS[k]} castShadow={false} receiveShadow={false} renderOrder={k === 'amber' || k === 'clear' ? 3 : 0} />
        ),
      )}
      {built.stations.map((st) => (
        <group
          key={st.id}
          ref={(g) => {
            if (g) stationGroups.current.set(st.id, g);
            else stationGroups.current.delete(st.id);
          }}
        >
          {st.meshes.map(({ k, geo }) =>
            k === 'hanger' && !hero ? null : (
              <mesh key={k} geometry={geo} material={MATS[k]} castShadow={false} receiveShadow={false} renderOrder={k === 'amber' || k === 'clear' ? 3 : 0} />
            ),
          )}
        </group>
      ))}
      {picking &&
        pickBoxes.map((b) => (
          <mesh
            key={b.id}
            position={b.centre}
            onPointerOver={(e) => {
              e.stopPropagation();
              picking.onHover(b.id);
            }}
            onPointerOut={() => picking.onHover(null)}
            onClick={(e) => {
              // a drag of the view is not a tap on a machine
              if (e.delta > 6) return;
              e.stopPropagation();
              picking.onSelect(b.id);
            }}
          >
            <boxGeometry args={b.size} />
            <meshBasicMaterial visible={false} />
          </mesh>
        ))}
      <instancedMesh ref={lenses} args={[undefined, lensMat, built.towers.length]} frustumCulled={false}>
        <cylinderGeometry args={[0.034, 0.034, 0.07, 12]} />
      </instancedMesh>
      <instancedMesh ref={shadows} args={[undefined, shadowMaterial, built.feet.length]} frustumCulled={false} renderOrder={1}>
        <planeGeometry args={[1, 1]} />
      </instancedMesh>

      {/* overhead transport vehicles */}
      <instancedMesh ref={vBody} args={[undefined, vehicleMat, N_VEHICLES]} frustumCulled={false}>
        <boxGeometry args={[0.62, 0.36, 0.5]} />
      </instancedMesh>
      <instancedMesh ref={vGrip} args={[undefined, gripMat, N_VEHICLES]} frustumCulled={false}>
        <boxGeometry args={[0.44, 0.08, 0.42]} />
      </instancedMesh>
      <instancedMesh ref={vFoup} args={[undefined, foupMat, N_VEHICLES]} frustumCulled={false}>
        <boxGeometry args={[0.39, 0.31, 0.42]} />
      </instancedMesh>

      {/* explorer: hovered or keyboard-focused machine gets a light outline and its name */}
      {picking && picking.hovered && picking.hovered !== hl && <HoverHalo built={built} id={picking.hovered} />}
      {picking &&
        (() => {
          const id = picking.hovered ?? picking.selected;
          const b = id ? pickBoxes.find((x) => x.id === id) : null;
          return b ? (
            <Label pos={[b.centre[0], b.top + 0.35, b.centre[2]]} tone="chip" priority={5}>
              {MACHINE_INFO[b.id as MachineId]?.name ?? b.id}
            </Label>
          ) : null;
        })()}
      {/* current station: a subtle violet outline on the floor */}
      {halo && (
        <group position={[halo.f.x, 0.012, halo.f.z]} rotation={[-Math.PI / 2, 0, halo.f.rot]}>
          <mesh geometry={halo.line} material={haloLine} renderOrder={4} />
          <mesh geometry={halo.fill} material={haloFill} renderOrder={4} />
        </group>
      )}
    </group>
  );
}

const hoverLine = new THREE.MeshBasicMaterial({ color: '#9d93ff', transparent: true, opacity: 0.85, depthWrite: false });
const hoverFill = new THREE.MeshBasicMaterial({ color: '#9d93ff', transparent: true, opacity: 0.1, depthWrite: false });

function HoverHalo({ built, id }: { built: { feet: Foot[] }; id: SceneId }) {
  const geo = useMemo(() => {
    const f = built.feet[hlFootIndex(built, id)];
    if (!f) return null;
    const w = f.w + 0.7;
    const d = f.d + 0.7;
    const outer = roundedRect(w, d, 0.25);
    outer.holes.push(roundedRect(w - 0.08, d - 0.08, 0.21));
    return { f, line: new THREE.ShapeGeometry(outer, 8), fill: new THREE.ShapeGeometry(roundedRect(w - 0.08, d - 0.08, 0.21), 8) };
  }, [built, id]);
  useLayoutEffect(
    () => () => {
      geo?.line.dispose();
      geo?.fill.dispose();
    },
    [geo],
  );
  if (!geo) return null;
  return (
    <group position={[geo.f.x, 0.014, geo.f.z]} rotation={[-Math.PI / 2, 0, geo.f.rot]}>
      <mesh geometry={geo.line} material={hoverLine} renderOrder={4} />
      <mesh geometry={geo.fill} material={hoverFill} renderOrder={4} />
    </group>
  );
}

function roundedRect(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Index of the first footprint recorded for a station (its main body). */
function hlFootIndex(built: { feet: Foot[] }, id: SceneId): number {
  const st = STATIONS[id];
  if (!st) return -1;
  let best = -1;
  let bd = Infinity;
  built.feet.forEach((f, i) => {
    const d = Math.hypot(f.x - st[0], f.z - st[1]);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return bd < 0.5 ? best : -1;
}
