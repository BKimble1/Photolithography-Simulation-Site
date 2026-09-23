/**
 * Illustrative 300 mm cleanroom bay (not any real fab): a raised perforated floor, a ceiling
 * of fan-filter units with linear lights, a central aisle and two rows of tools whose fronts
 * (load ports) face the aisle — stocker, inspection, wet clean, vertical furnaces, etch and
 * deposition clusters, CMP, a long implanter, metrology, the prober, a coater/developer track
 * joined to a large lithography scanner in a yellow-lit bay — and an overhead transport
 * loop whose vehicles carry FOUPs between them. Dicing, packaging and final test stand in a
 * separate room behind a glass wall at the west end.
 *
 * Built for many tools at little cost: every static panel is merged into one mesh per
 * material; FFU panels, status lenses, contact shadows and vehicles are instanced (a few
 * dozen draw calls in all). The station of the current step gets a violet floor outline
 * and a violet status lens; the others show green. Vehicles move on wall-clock time (idle
 * motion) and stop under reduced motion.
 */
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SceneId } from '../../content/steps';
import { useApp } from '../../state/store';
import { BACKEND, BACKEND_WALL_X, BAY, STATIONS, facing } from './poses/fab';

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
  rail: { color: '#d5d9de' },
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
  rail: frameMat,
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
    this.feet.push({ x: this.ox + x * c + z * s, z: this.oz - x * s + z * c, w, d, rot: this.rot });
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

function stocker(K: Kit, w = 2.6, h = 3.8, d = 1.8) {
  const zf = d / 2;
  // frame around a glazed recess that shows the shelves
  K.box('gray', w - 0.05, 0.1, d - 0.05, 0, 0.05, 0);
  K.box('white', w, h - 0.1, d - 0.5, 0, 0.1 + (h - 0.1) / 2, -0.25, 0.035);
  K.box('white', 0.25, h - 0.1, 0.5, -w / 2 + 0.125, 0.1 + (h - 0.1) / 2, zf - 0.25, 0.03);
  K.box('white', 0.25, h - 0.1, 0.5, w / 2 - 0.125, 0.1 + (h - 0.1) / 2, zf - 0.25, 0.03);
  K.box('white', w - 0.5, 1.15, 0.5, 0, 0.1 + 0.575, zf - 0.25, 0.03);
  K.box('white', w - 0.5, 0.35, 0.5, 0, h - 0.175, zf - 0.25, 0.03);
  K.box('recess', w - 0.5, h - 1.6, 0.02, 0, 1.25 + (h - 1.6) / 2, zf - 0.49);
  for (let r = 0; r < 4; r++) {
    const y = 1.32 + r * 0.52;
    K.box('satin', w - 0.52, 0.025, 0.46, 0, y, zf - 0.26);
    for (let c = 0; c < 5; c++) if ((r * 5 + c) % 7 !== 3) foup(K, -w / 2 + 0.52 + c * 0.39, y + 0.013, zf - 0.27);
  }
  K.box('glass', w - 0.5, h - 1.6, 0.012, 0, 1.25 + (h - 1.6) / 2, zf - 0.02);
  reveal(K, w - 0.5, 1.2, zf);
  loadPorts(K, [-0.55, 0.55], zf, [0]);
  K.tower(w / 2 - 0.2, h, -d / 2 + 0.2);
  K.foot(w, d);
}

function inspection(K: Kit) {
  const w = 2.0;
  const d = 2.4;
  body(K, w, 2.1, d - 0.8, 0, -0.4);
  body(K, w, 2.0, 0.8, 0, d / 2 - 0.4, 'warm');
  K.box('window', 1.2, 0.34, 0.012, -0.2, 1.62, d / 2 + 0.004);
  reveal(K, w, 1.35, d / 2);
  loadPorts(K, [-0.5, 0.35], d / 2, [1]);
  seams(K, -w / 2, w / 2, 0.12, 1.3, d / 2, 1.0);
  screenArm(K, 0.78, 1.45, d / 2);
  K.box('window', 0.012, 0.5, 1.0, w / 2 + 0.004, 1.5, -0.5);
  K.cyl('satin', 0.12, 0.35, 0.5, 2.27, -0.8, 16);
  K.tower(w / 2 - 0.15, 2.1, -d / 2 + 0.2);
  K.foot(w, d);
}

function wetClean(K: Kit) {
  const w = 4.6;
  const d = 2.6;
  const h = 2.6;
  body(K, w, h, d);
  // process chambers behind a row of windows, EFEM with load ports at the left end
  for (let i = 0; i < 4; i++) K.box('window', 0.62, 0.42, 0.012, -0.55 + i * 0.78, 1.72, d / 2 + 0.004, 0.004);
  reveal(K, w, 1.38, d / 2);
  reveal(K, w, 2.1, d / 2);
  for (let i = 0; i < 5; i++) K.box('warm', 0.84, 1.0, 0.012, -1.84 + i * 0.92, 0.72, d / 2 + 0.004, 0.006);
  loadPorts(K, [-1.9, -1.35], d / 2, [0]);
  K.cyl('satin', 0.16, w - 0.4, 0, h + 0.2, -0.6, 20, 'x');
  K.box('satin', 0.3, 0.2, 0.3, 1.6, h + 0.1, -0.6, 0.02);
  K.box('gray', 0.9, 0.5, d - 0.3, w / 2 - 0.55, h + 0.25, 0.0, 0.03);
  screenArm(K, 1.9, 1.5, d / 2);
  seams(K, -w / 2, w / 2, 1.4, 2.08, d / 2, 0.78);
  K.tower(-w / 2 + 0.2, h, -d / 2 + 0.2);
  K.foot(w, d);
}

function furnaces(K: Kit) {
  const n = 3;
  const uw = 1.25;
  const d = 3.0;
  for (let i = 0; i < n; i++) {
    const x = (i - 1) * (uw + 0.06);
    // heater tower at the back, lower loading module at the front
    K.box('gray', uw - 0.05, 0.1, 1.5, x, 0.05, -0.75);
    K.box('white', uw, 3.95, 1.5, x, 0.1 + 3.95 / 2, -0.75, 0.035);
    K.box('satin', uw - 0.3, 0.3, 1.0, x, 4.2, -0.75, 0.03);
    K.box('window', 0.14, 2.3, 0.012, x - uw / 2 + 0.2, 2.35, 0.004, 0.003);
    reveal(K, uw, 3.3, 0, x);
    body(K, uw, 2.25, 1.5, x, 0.75, 'white');
    K.cyl('satin', 0.09, 0.3, x + 0.3, 4.5, -1.0, 12);
    K.box('window', 0.7, 0.3, 0.012, x - 0.15, 1.75, 1.504, 0.004);
    reveal(K, uw, 1.45, 1.5, x);
    loadPorts(K, [x + 0.28], 1.5, i === 1 ? [0] : []);
    K.tower(x + uw / 2 - 0.16, 4.05, -1.3);
  }
  K.foot(n * uw + 0.12, d);
}

/** Cluster tool: EFEM + transfer chamber + process chambers; `kind` changes the chambers. */
function cluster(K: Kit, kind: 'etch' | 'depo') {
  const w = 3.8;
  const d = 3.6;
  const zf = d / 2;
  // EFEM across the front
  body(K, 3.0, 2.15, 0.9, 0, zf - 0.45);
  K.box('window', 1.8, 0.5, 0.012, 0, 1.72, zf + 0.004, 0.004);
  reveal(K, 3.0, 1.38, zf);
  loadPorts(K, [-0.9, 0, 0.9], zf, kind === 'etch' ? [0, 2] : [1]);
  // frame and transfer chamber
  K.box('gray', 2.6, 0.8, 2.3, 0, 0.4, -0.55, 0.03);
  K.cyl('satin', 0.72, 0.5, 0, 1.08, -0.55, 6);
  K.cyl('steel', 0.62, 0.06, 0, 1.36, -0.55, 6);
  // four process chambers around the back half of the transfer chamber
  const pos: [number, number][] = [
    [-1.28, -0.05],
    [-1.05, -1.4],
    [1.05, -1.4],
    [1.28, -0.05],
  ];
  pos.forEach(([x, z]) => {
    K.box('white', 0.95, 0.9, 0.95, x, 0.45, z, 0.03);
    if (kind === 'etch') {
      K.cyl('satin', 0.42, 0.5, x, 1.15, z, 28);
      K.cyl('steel', 0.36, 0.08, x, 1.44, z, 28);
      K.box('gray', 0.42, 0.34, 0.42, x, 1.65, z, 0.02); // RF match
      K.cyl('steelDark', 0.05, 0.3, x + 0.3, 1.6, z, 8);
    } else {
      K.box('satin', 0.84, 0.46, 0.84, x, 1.13, z, 0.05);
      K.cyl('alu', 0.3, 0.42, x, 1.57, z, 28);
      K.cyl('dark', 0.24, 0.1, x, 1.83, z, 28);
    }
  });
  // gas / RF cabinet at the back
  body(K, 2.4, 2.3, 0.55, 0, -d / 2 + 0.28, 'warm');
  roof(K, 2.4, 2.3, 0.55, 0, -d / 2 + 0.28);
  seams(K, -1.5, 1.5, 0.12, 1.3, zf, 0.75);
  K.tower(1.3, 2.15, zf - 0.8);
  K.foot(w, d);
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

function scanner(K: Kit) {
  const w = 5.4;
  const d = 3.2;
  const h = 2.9;
  const zf = d / 2;
  const mw = w - 1.45; // main (steel) section width
  const mx = 0.22;
  // plinth; white lower band; brushed-steel upper enclosure; white end modules
  K.box('gray', w - 0.06, 0.12, d - 0.06, 0, 0.06, 0);
  K.box('white', mw, 0.9, d, mx, 0.12 + 0.45, 0, 0.035);
  K.box('clad', mw, h - 1.02, d, mx, 1.02 + (h - 1.02) / 2, 0, 0.045);
  K.box('white', 0.9, h - 0.42, d, -w / 2 + 0.45, 0.12 + (h - 0.54) / 2, 0, 0.04);
  K.box('white', 0.55, h - 0.12, d, w / 2 - 0.29, 0.12 + (h - 0.12) / 2, 0, 0.04);
  // raised illuminator / reticle-handling housing on top
  K.box('clad', 2.4, 0.44, d - 0.6, mx + 0.15, h + 0.21, -0.12, 0.05);
  K.box('alu', 1.2, 0.32, 1.2, mx + 0.15, h + 0.58, -0.35, 0.04);
  // front: dark glazing with slim mullions, reveals, a restrained violet status line
  K.box('window', 2.9, 0.86, 0.014, mx - 0.1, 1.86, zf + 0.004, 0.006);
  for (let i = 1; i < 4; i++) K.box('satin', 0.018, 0.86, 0.02, mx - 0.1 - 1.45 + i * 0.725, 1.86, zf + 0.012);
  reveal(K, mw, 1.02, zf, mx);
  reveal(K, mw, 2.46, zf, mx);
  K.box('violet', 1.2, 0.012, 0.01, mx + 0.75, 1.3, zf + 0.012);
  for (let i = 0; i < 5; i++) K.box('satin', 0.012, h - 1.1, 0.012, mx - mw / 2 + 0.4 + i * 0.78, 1.02 + (h - 1.02) / 2, zf + 0.006);
  for (let i = 0; i < 4; i++) K.box('warm', 0.86, 0.72, 0.012, mx - 1.3 + i * 0.95, 0.56, zf + 0.004, 0.006);
  screenArm(K, w / 2 - 0.3, 1.45, zf);
  // excimer laser unit behind, with the beam-delivery duct
  body(K, 3.0, 1.9, 1.1, 0.6, -d / 2 - 1.05, 'warm');
  K.box('window', 1.4, 0.26, 0.012, 0.2, 1.45, -d / 2 - 0.5 + 0.004, 0.004);
  K.box('satin', 0.32, 0.32, 1.0, -0.6, 2.35, -d / 2 - 0.45, 0.04);
  K.box('satin', 0.32, 0.9, 0.32, -0.6, 2.0, -d / 2 - 0.95, 0.04);
  K.tower(w / 2 - 0.25, h, -d / 2 + 0.25);
  K.foot(w, d);
  K.foot(3.0, 1.1, 0.6, -d / 2 - 1.05);
}

function cmp(K: Kit) {
  const w = 3.4;
  const d = 2.8;
  const h = 2.35;
  const zf = d / 2;
  // polisher: glazed recess with three platens; cleaner module to the right
  K.box('gray', w - 0.05, 0.1, d - 0.05, 0, 0.05, 0);
  K.box('white', w, h - 0.1, d - 0.7, 0, 0.1 + (h - 0.1) / 2, -0.35, 0.035);
  K.box('white', w, 0.95, 0.7, 0, 0.575, zf - 0.35, 0.03);
  K.box('white', w, 0.5, 0.7, 0, h - 0.25, zf - 0.35, 0.03);
  K.box('white', 1.1, h - 0.1, 0.7, w / 2 - 0.55, 0.1 + (h - 0.1) / 2, zf - 0.35, 0.03);
  K.box('recess', 2.3, 0.9, 0.02, -0.55, 1.5, zf - 0.69);
  for (let i = 0; i < 3; i++) {
    K.cyl('platen', 0.26, 0.08, -1.25 + i * 0.68, 1.1, zf - 0.38, 32);
    K.cyl('satin', 0.05, 0.4, -1.25 + i * 0.68 + 0.22, 1.36, zf - 0.38, 10);
  }
  K.box('glass', 2.3, 0.9, 0.012, -0.55, 1.5, zf - 0.02);
  K.box('window', 0.6, 0.4, 0.012, w / 2 - 0.55, 1.75, zf + 0.004, 0.004);
  reveal(K, w, 1.02, zf);
  loadPorts(K, [w / 2 - 0.55], zf, [0]);
  K.box('warm', 1.2, 1.9, 0.6, -0.9, 1.05, -d / 2 - 0.35, 0.03);
  roof(K, w, h, d - 0.7, 0, -0.35);
  seams(K, -w / 2, w / 2, 0.12, 0.98, zf, 0.85);
  K.tower(w / 2 - 0.2, h, -d / 2 + 0.9);
  K.foot(w, d);
}

function implanter(K: Kit) {
  const d = 2.4;
  const zf = d / 2;
  // ion source terminal (west), beamline with analyser magnet, end station with load ports
  body(K, 2.1, 2.9, d, -2.2, 0, 'gray');
  for (let i = 0; i < 9; i++) K.box('black', 1.7, 0.012, 0.01, -2.2, 0.7 + i * 0.22, zf + 0.004);
  body(K, 2.3, 1.55, d, 0, 0);
  K.box('dark', 1.0, 0.8, 1.2, -0.45, 1.95, -0.1, 0.06);
  K.cyl('satin', 0.16, 2.5, 0.2, 1.85, 0.3, 20, 'x');
  K.cyl('steel', 0.2, 0.1, -0.9, 1.85, 0.3, 20, 'x');
  K.cyl('steel', 0.2, 0.1, 1.3, 1.85, 0.3, 20, 'x');
  body(K, 2.1, 2.3, d, 2.2, 0);
  roof(K, 2.1, 2.3, d, 2.2, 0);
  seams(K, 1.15, 3.25, 0.12, 1.38, zf, 0.7);
  K.box('window', 1.2, 0.36, 0.012, 2.1, 1.72, zf + 0.004, 0.004);
  reveal(K, 2.1, 1.42, zf, 2.2);
  loadPorts(K, [1.75, 2.55], zf, [1]);
  screenArm(K, 0.9, 1.3, zf);
  K.tower(3.05, 2.3, -zf + 0.25);
  K.foot(6.4, d);
}

function metrology(K: Kit) {
  const w = 2.2;
  const d = 2.0;
  body(K, w, 1.95, d);
  seams(K, -w / 2, w / 2, 0.12, 1.28, d / 2, 1.1);
  // electron column on top (CD-SEM style)
  K.cyl('satin', 0.22, 0.5, -0.3, 2.2, -0.3, 24);
  K.cyl('steel', 0.26, 0.06, -0.3, 1.99, -0.3, 24);
  K.cyl('dark', 0.16, 0.14, -0.3, 2.52, -0.3, 24);
  K.box('window', 1.0, 0.32, 0.012, -0.3, 1.58, d / 2 + 0.004, 0.004);
  reveal(K, w, 1.32, d / 2);
  loadPorts(K, [-0.55, 0.3], d / 2, [0]);
  screenArm(K, 0.85, 1.4, d / 2);
  K.tower(w / 2 - 0.15, 1.95, -d / 2 + 0.2);
  K.foot(w, d);
}

function prober(K: Kit) {
  // prober with a docked test head (dark), manipulator, tester cabinet beside
  body(K, 1.5, 1.05, 1.3, -0.35, 0);
  K.box('window', 0.9, 0.2, 0.012, -0.35, 0.82, 0.654, 0.004);
  K.box('dark', 1.0, 0.36, 0.8, -0.35, 1.3, -0.05, 0.03);
  K.box('steelDark', 0.3, 0.12, 0.3, -0.35, 1.08, 0.1, 0.02);
  K.box('gray', 0.28, 1.6, 0.28, -0.35, 0.8, -0.75, 0.02);
  body(K, 0.85, 1.75, 0.85, 0.95, -0.15, 'white');
  K.box('window', 0.55, 0.8, 0.012, 0.95, 1.0, 0.28, 0.004);
  K.box('black', 0.5, 0.12, 0.3, 0.35, 1.25, -0.4, 0.05);
  loadPorts(K, [-0.75], 0.65, [0]);
  K.tower(1.25, 1.75, -0.45);
  K.foot(2.4, 1.6);
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

function dicingSaw(K: Kit) {
  body(K, 1.3, 1.75, 1.15);
  K.box('window', 0.9, 0.5, 0.012, -0.05, 1.12, 0.579, 0.004);
  reveal(K, 1.3, 0.82, 0.575);
  screenArm(K, 0.45, 1.45, 0.575);
  K.tower(0.5, 1.75, -0.4);
  K.foot(1.3, 1.15);
}

function bondBenches(K: Kit) {
  for (const x of [-0.75, 0.75]) {
    K.box('warm', 1.3, 0.04, 0.8, x, 0.88, 0, 0.01);
    for (const sx of [-0.6, 0.6]) for (const sz of [-0.34, 0.34]) K.box('satin', 0.04, 0.86, 0.04, x + sx, 0.43, sz, 0.008);
  }
  // die bonder and wire bonder on the benches
  K.box('white', 0.8, 0.5, 0.62, -0.75, 1.15, 0, 0.03);
  K.box('window', 0.5, 0.2, 0.012, -0.75, 1.2, 0.314, 0.004);
  K.box('gray', 0.72, 0.42, 0.56, 0.75, 1.11, 0, 0.03);
  K.cyl('satin', 0.05, 0.28, 0.75, 1.46, 0.05, 16);
  K.box('dark', 0.16, 0.1, 0.16, 0.75, 1.63, 0.05, 0.02);
  K.tower(1.3, 0.9, -0.3);
  K.foot(2.9, 0.8);
}

function finalTest(K: Kit) {
  body(K, 1.3, 1.85, 1.1, -0.6, 0);
  K.box('window', 0.8, 0.5, 0.012, -0.6, 1.25, 0.554, 0.004);
  reveal(K, 1.3, 0.95, 0.55, -0.6);
  K.box('warm', 1.2, 0.04, 0.75, 0.8, 0.88, 0, 0.01);
  for (const sx of [-0.55, 0.55]) for (const sz of [-0.32, 0.32]) K.box('satin', 0.04, 0.86, 0.04, 0.8 + sx, 0.43, sz, 0.008);
  K.box('dark', 0.36, 0.14, 0.3, 1.0, 0.97, -0.1, 0.01);
  K.box('screen', 0.14, 0.07, 0.01, 0.95, 0.98, 0.054, 0.003);
  K.box('dark', 0.24, 0.02, 0.18, 0.55, 0.91, 0.1, 0.004);
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

function buildTools(K: Kit) {
  const place = (id: SceneId | undefined, x: number, z: number, faceNorth: boolean, fn: (k: Kit) => void) => {
    K.at(x, z, faceNorth ? 0 : Math.PI, id);
    fn(K);
  };
  const st = (id: SceneId) => STATIONS[id]!;
  const north = (id: SceneId, fn: (k: Kit) => void) => place(id, st(id)[0], st(id)[1], facing(id) > 0, fn);
  north('foup', (k) => stocker(k));
  north('inspect', inspection);
  north('wetclean', wetClean);
  north('furnace', furnaces);
  north('etch', (k) => cluster(k, 'etch'));
  north('track', track);
  north('scanner', scanner);
  north('implant', implanter);
  north('depo', (k) => cluster(k, 'depo'));
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

/**
 * Render pacing for very slow renderers. While the bay is shown it takes over rendering (a
 * positive useFrame priority turns off the automatic render). Normally it renders every
 * frame. If frames average over 120 ms (software rasterisers such as headless test
 * browsers, very weak GPUs), it renders only every ~2.5 frame costs, so the page stays
 * responsive between frames instead of stalling on every one. The frame cost is tracked as
 * the longest animation-tick gap after each render; once it drops, rendering is continuous
 * again.
 */
function usePacedRender() {
  const st = useRef({ paced: false, last: 0, gaps: [] as number[], renderAt: 0, cost: 0, maxGap: 0 });
  useFrame(({ gl, scene, camera }) => {
    const s = st.current;
    const now = performance.now();
    const gap = s.last ? now - s.last : 16;
    s.last = now;
    if (!s.paced) {
      s.gaps.push(gap);
      if (s.gaps.length > 12) s.gaps.shift();
      const avg = s.gaps.reduce((a, b) => a + b, 0) / s.gaps.length;
      if (s.gaps.length === 12 && avg > 120) {
        s.paced = true;
        s.cost = Math.min(avg, 1500);
        s.maxGap = 0;
        s.renderAt = now;
        return;
      }
      gl.render(scene, camera);
      return;
    }
    s.maxGap = Math.max(s.maxGap, gap);
    if (now - s.renderAt < 2.5 * s.cost) return;
    s.cost = Math.min(1500, s.cost * 0.5 + s.maxGap * 0.5);
    s.maxGap = 0;
    if (s.cost < 60) {
      s.paced = false;
      s.gaps = [];
    }
    gl.render(scene, camera);
    s.renderAt = now;
  }, 1);
}

export function FabScene({ highlight, hero }: { highlight?: SceneId; hero?: boolean }) {
  const reduced = useApp((s) => s.reducedMotion);
  usePacedRender();
  const built = useMemo(() => {
    const K = new Kit();
    buildTools(K);
    buildBay(K);
    return { meshes: K.build(), towers: K.towers, feet: K.feet };
  }, []);
  useLayoutEffect(
    () => () => {
      built.meshes.forEach((m) => m.geo.dispose());
    },
    [built],
  );
  const hl: SceneId | undefined = hero ? undefined : highlight === 'wafer' ? 'inspect' : highlight;

  // ── status lenses (instanced, coloured per highlight) ──
  const lenses = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = lenses.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    built.towers.forEach((t, i) => {
      mat.makeTranslation(t.pos.x, t.pos.y, t.pos.z);
      m.setMatrixAt(i, mat);
      m.setColorAt(i, t.id && t.id === hl ? VIOLET : GREEN);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [built, hl]);

  // ── soft contact shadows under every tool ──
  const shadowMaterial = useMemo(() => new THREE.MeshBasicMaterial({ map: softShadowTexture(), color: '#000000', transparent: true, opacity: 0.2, depthWrite: false }), []);
  const shadows = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = shadows.current;
    if (!m) return;
    const q = new THREE.Quaternion();
    const mat = new THREE.Matrix4();
    built.feet.forEach((f, i) => {
      // lie flat (Rx), then turn with the tool (Ry)
      q.setFromEuler(new THREE.Euler(-Math.PI / 2, f.rot, 0, 'YXZ'));
      mat.compose(new THREE.Vector3(f.x, 0.006, f.z), q, new THREE.Vector3(f.w + 0.8, f.d + 0.8, 1));
      m.setMatrixAt(i, mat);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [built]);

  // ── overhead transport vehicles with FOUPs (idle motion on wall-clock time) ──
  const vBody = useRef<THREE.InstancedMesh>(null);
  const vGrip = useRef<THREE.InstancedMesh>(null);
  const vFoup = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(
    () => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4(), s: new THREE.Vector3(1, 1, 1), zero: new THREE.Vector3(1e-4, 1e-4, 1e-4), up: new THREE.Vector3(0, 1, 0), o: new THREE.Vector3() }),
    [],
  );
  useFrame(({ clock }) => {
    const t = reduced ? 0 : clock.elapsedTime;
    for (let i = 0; i < N_VEHICLES; i++) {
      const s = (i / N_VEHICLES) * LOOP_LEN + t * 0.85;
      const head = loopPoint(s, tmp.p);
      tmp.q.setFromAxisAngle(tmp.up, head);
      tmp.m.compose(tmp.o.copy(tmp.p).setY(LOOP.y + 0.08), tmp.q, tmp.s);
      vBody.current?.setMatrixAt(i, tmp.m);
      tmp.m.compose(tmp.o.copy(tmp.p).setY(LOOP.y - 0.2), tmp.q, tmp.s);
      vGrip.current?.setMatrixAt(i, tmp.m);
      // most vehicles carry a FOUP
      tmp.m.compose(tmp.o.copy(tmp.p).setY(LOOP.y - 0.42), tmp.q, i % 3 === 2 ? tmp.zero : tmp.s);
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
