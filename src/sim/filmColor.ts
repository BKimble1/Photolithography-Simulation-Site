/**
 * Thin-film interference colours of a wafer, computed rather than painted.
 *
 * Normal-incidence reflectance of a stack of films on silicon (transfer-matrix method),
 * integrated against the CIE 1931 colour-matching functions under a 6500 K illuminant and
 * converted to linear sRGB. This is why an oxide- or resist-coated wafer shows strong
 * colours that change with thickness. Optical constants are rounded, wavelength-coarse
 * values — good enough for a qualitative colour, not for metrology.
 */

import { M } from './materials';
import type { Film } from './types';

type C = [number, number]; // complex [re, im]
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cadd = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const csub = (a: C, b: C): C => [a[0] - b[0], a[1] - b[1]];
const cdiv = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const cexp = (a: C): C => {
  const e = Math.exp(a[0]);
  return [e * Math.cos(a[1]), e * Math.sin(a[1])];
};
const ccos = (a: C): C => {
  // cos(a) = (e^{ia} + e^{-ia}) / 2
  const ia: C = [-a[1], a[0]];
  const nia: C = [a[1], -a[0]];
  const s = cadd(cexp(ia), cexp(nia));
  return [s[0] / 2, s[1] / 2];
};
const csin = (a: C): C => {
  // sin(a) = (e^{ia} - e^{-ia}) / 2i
  const ia: C = [-a[1], a[0]];
  const nia: C = [a[1], -a[0]];
  const s = csub(cexp(ia), cexp(nia));
  return cdiv(s, [0, 2]);
};

/** Refractive index n − ik at wavelength λ (nm), rounded literature values. */
function indexOf(mat: number, lambda: number): C {
  const lerp = (tbl: [number, number, number][]): C => {
    for (let i = 0; i < tbl.length - 1; i++) {
      const [l0, n0, k0] = tbl[i];
      const [l1, n1, k1] = tbl[i + 1];
      if (lambda >= l0 && lambda <= l1) {
        const t = (lambda - l0) / (l1 - l0);
        return [n0 + (n1 - n0) * t, -(k0 + (k1 - k0) * t)];
      }
    }
    const last = lambda < tbl[0][0] ? tbl[0] : tbl[tbl.length - 1];
    return [last[1], -last[2]];
  };
  switch (mat) {
    case M.SI:
      return lerp([
        [380, 6.0, 0.9],
        [400, 5.6, 0.39],
        [450, 4.67, 0.14],
        [500, 4.3, 0.07],
        [550, 4.08, 0.04],
        [600, 3.94, 0.02],
        [700, 3.78, 0.01],
        [780, 3.7, 0.006],
      ]);
    case M.POLY:
      return lerp([
        [380, 4.5, 1.4],
        [450, 4.4, 0.9],
        [550, 4.1, 0.25],
        [650, 3.9, 0.08],
        [780, 3.8, 0.03],
      ]);
    case M.CU:
      return lerp([
        [380, 1.2, 2.1],
        [450, 1.2, 2.45],
        [500, 1.1, 2.6],
        [550, 0.9, 2.6],
        [580, 0.33, 2.9],
        [620, 0.25, 3.4],
        [700, 0.21, 4.2],
        [780, 0.24, 4.8],
      ]);
    case M.W:
      return lerp([
        [380, 3.4, 2.7],
        [550, 3.5, 2.7],
        [780, 3.4, 3.2],
      ]);
    case M.NIT:
    case M.PASS:
      return [2.02, 0];
    case M.RES:
      return [1.68, 0];
    case M.ILD:
      return [1.42, 0];
    case M.CAP:
      return [1.9, 0];
    case M.OX:
    default:
      return [1.46, 0];
  }
}

/** Normal-incidence reflectance of films (bottom → top) on a silicon substrate. */
export function reflectance(films: { mat: number; nm: number }[], lambda: number): number {
  // Opaque metal films hide what is underneath: start from the topmost thick metal.
  let start = 0;
  let substrate: number = M.SI;
  for (let i = films.length - 1; i >= 0; i--) {
    if ((films[i].mat === M.CU || films[i].mat === M.W) && films[i].nm > 60) {
      start = i + 1;
      substrate = films[i].mat;
      break;
    }
  }
  const layers = films.slice(start).filter((f) => f.nm > 0.2);
  // Characteristic matrix, top layer first.
  let m11: C = [1, 0];
  let m12: C = [0, 0];
  let m21: C = [0, 0];
  let m22: C = [1, 0];
  for (let i = layers.length - 1; i >= 0; i--) {
    const n = indexOf(layers[i].mat, lambda);
    const delta = cmul([(2 * Math.PI * layers[i].nm) / lambda, 0], n);
    const cd = ccos(delta);
    const sd = csin(delta);
    const a11 = cd;
    const a12 = cdiv(cmul([0, 1], sd), n);
    const a21 = cmul(cmul([0, 1], n), sd);
    const a22 = cd;
    // M = M × A (layers are applied from the top down)
    const n11 = cadd(cmul(m11, a11), cmul(m12, a21));
    const n12 = cadd(cmul(m11, a12), cmul(m12, a22));
    const n21 = cadd(cmul(m21, a11), cmul(m22, a21));
    const n22 = cadd(cmul(m21, a12), cmul(m22, a22));
    m11 = n11;
    m12 = n12;
    m21 = n21;
    m22 = n22;
  }
  const ns = indexOf(substrate, lambda);
  const n0: C = [1, 0];
  const b = cadd(m11, cmul(m12, ns));
  const c = cadd(m21, cmul(m22, ns));
  const num = csub(cmul(n0, b), c);
  const den = cadd(cmul(n0, b), c);
  const r = cdiv(num, den);
  return r[0] * r[0] + r[1] * r[1];
}

// CIE 1931 2° colour matching functions — multi-lobe Gaussian fit (Wyman, Sloan & Shirley 2013).
function g(x: number, mu: number, s1: number, s2: number): number {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}
function cie(l: number): [number, number, number] {
  const x = 1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2);
  const y = 0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1);
  const z = 1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8);
  return [x, y, z];
}
function planck(lambdaNm: number, T: number): number {
  const l = lambdaNm * 1e-9;
  return 1 / (Math.pow(l, 5) * (Math.exp(1.4388e-2 / (l * T)) - 1));
}

const LAMBDAS: number[] = [];
for (let l = 380; l <= 780; l += 10) LAMBDAS.push(l);
const WEIGHTS = LAMBDAS.map((l) => {
  const s = planck(l, 6500);
  const [x, y, z] = cie(l);
  return [s * x, s * y, s * z] as [number, number, number];
});
const NORM = WEIGHTS.reduce((a, w) => a + w[1], 0);

/** Linear-sRGB colour (0..1) of light reflected from the stack. */
export function stackColor(films: { mat: number; nm: number }[]): [number, number, number] {
  let X = 0,
    Y = 0,
    Z = 0;
  LAMBDAS.forEach((l, i) => {
    const R = reflectance(films, l);
    X += R * WEIGHTS[i][0];
    Y += R * WEIGHTS[i][1];
    Z += R * WEIGHTS[i][2];
  });
  X /= NORM;
  Y /= NORM;
  Z /= NORM;
  // XYZ (D65-ish white) → linear sRGB
  const r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  const gg = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const b = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  return [clamp01(r), clamp01(gg), clamp01(b)];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Linear → sRGB-encoded 0..255. */
export function toSrgb8(v: number): number {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(clamp01(c) * 255);
}

const memo = new Map<string, [number, number, number]>();
export function filmsColor(films: Film[] | { mat: number; nm: number }[]): [number, number, number] {
  const key = films.map((f) => `${f.mat}:${Math.round(f.nm)}`).join(',');
  let v = memo.get(key);
  if (!v) {
    v = stackColor(films);
    memo.set(key, v);
    if (memo.size > 2000) memo.delete(memo.keys().next().value as string);
  }
  return v;
}

/** Colour of `under` films with a top film of each thickness in [0, maxNm] (a lookup table). */
export function topFilmLut(under: { mat: number; nm: number }[], topMat: number, maxNm: number, n = 128) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const nm = (i / (n - 1)) * maxNm;
    const c = stackColor([...under, { mat: topMat, nm }]);
    out[i * 3] = c[0];
    out[i * 3 + 1] = c[1];
    out[i * 3 + 2] = c[2];
  }
  return out;
}
