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

type Mat2 = [C, C, C, C]; // characteristic matrix [m11, m12, m21, m22]
const IDENTITY: Mat2 = [
  [1, 0],
  [0, 0],
  [0, 0],
  [1, 0],
];
/** a × b */
const mmul = (a: Mat2, b: Mat2): Mat2 => [
  cadd(cmul(a[0], b[0]), cmul(a[1], b[2])),
  cadd(cmul(a[0], b[1]), cmul(a[1], b[3])),
  cadd(cmul(a[2], b[0]), cmul(a[3], b[2])),
  cadd(cmul(a[2], b[1]), cmul(a[3], b[3])),
];
/** Characteristic matrix of one layer at one wavelength. */
function layerMatrix(mat: number, nm: number, lambda: number): Mat2 {
  const n = indexOf(mat, lambda);
  const delta = cmul([(2 * Math.PI * nm) / lambda, 0], n);
  const cd = ccos(delta);
  const sd = csin(delta);
  return [cd, cdiv(cmul([0, 1], sd), n), cmul(cmul([0, 1], n), sd), cd];
}
/** The layers light passes through (bottom → top) and what lies under them: opaque metal films
 * hide what is underneath, so the stack starts above the topmost thick metal. */
function visibleStack(films: { mat: number; nm: number }[]): { substrate: number; layers: { mat: number; nm: number }[] } {
  let start = 0;
  let substrate: number = M.SI;
  for (let i = films.length - 1; i >= 0; i--) {
    if ((films[i].mat === M.CU || films[i].mat === M.W) && films[i].nm > 60) {
      start = i + 1;
      substrate = films[i].mat;
      break;
    }
  }
  return { substrate, layers: films.slice(start).filter((f) => f.nm > 0.2) };
}
/** Characteristic matrix of layers (bottom → top), applied from the top down. */
function stackMatrix(layers: { mat: number; nm: number }[], lambda: number): Mat2 {
  let m = IDENTITY;
  for (let i = layers.length - 1; i >= 0; i--) m = mmul(m, layerMatrix(layers[i].mat, layers[i].nm, lambda));
  return m;
}
/** Reflectance of a stack with characteristic matrix m on a substrate of index ns, from air. */
function reflectanceOf(m: Mat2, ns: C): number {
  const n0: C = [1, 0];
  const b = cadd(m[0], cmul(m[1], ns));
  const c = cadd(m[2], cmul(m[3], ns));
  const r = cdiv(csub(cmul(n0, b), c), cadd(cmul(n0, b), c));
  return r[0] * r[0] + r[1] * r[1];
}

/** Normal-incidence reflectance of films (bottom → top) on a silicon substrate. */
export function reflectance(films: { mat: number; nm: number }[], lambda: number): number {
  const { substrate, layers } = visibleStack(films);
  return reflectanceOf(stackMatrix(layers, lambda), indexOf(substrate, lambda));
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

/** Linear-sRGB colour (0..1) of light reflected with reflectance R[i] at each of LAMBDAS. */
function colourOf(R: ArrayLike<number>): [number, number, number] {
  let X = 0,
    Y = 0,
    Z = 0;
  for (let i = 0; i < LAMBDAS.length; i++) {
    const r = R[i];
    X += r * WEIGHTS[i][0];
    Y += r * WEIGHTS[i][1];
    Z += r * WEIGHTS[i][2];
  }
  X /= NORM;
  Y /= NORM;
  Z /= NORM;
  // XYZ (D65-ish white) → linear sRGB
  const r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  const gg = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const b = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  return [clamp01(r), clamp01(gg), clamp01(b)];
}

/** Linear-sRGB colour (0..1) of light reflected from the stack. */
export function stackColor(films: { mat: number; nm: number }[]): [number, number, number] {
  return colourOf(LAMBDAS.map((l) => reflectance(films, l)));
}

/**
 * Colours of the stack `under` with a film of `top` on it at each thickness in `nms`: the same
 * as stackColor([...under, { mat: top, nm }]) for each, worked out as a lookup table should be.
 * Only the top film changes, so the layers underneath are multiplied out once per wavelength,
 * and the top film's matrix and the reflectance are computed in plain numbers, without a
 * complex number allocated per operation: a table of 256 thicknesses costs about 2 ms rather
 * than 20–90 ms and a garbage collection (it is built on the main thread whenever the film
 * stack under a live film changes, which is at an operation boundary).
 */
export function colorsWithTop(under: { mat: number; nm: number }[], top: number, nms: number[]): [number, number, number][] {
  const L = LAMBDAS.length;
  const { substrate, layers } = visibleStack(under);
  // per wavelength: the matrix of the stack underneath [m11, m12, m21, m22], the substrate's
  // index and the top film's (real and imaginary parts interleaved)
  const B = new Float64Array(L * 8);
  const S = new Float64Array(L * 2);
  const N = new Float64Array(L * 2);
  for (let i = 0; i < L; i++) {
    const m = stackMatrix(layers, LAMBDAS[i]);
    for (let j = 0; j < 4; j++) {
      B[i * 8 + 2 * j] = m[j][0];
      B[i * 8 + 2 * j + 1] = m[j][1];
    }
    const s = indexOf(substrate, LAMBDAS[i]);
    S[2 * i] = s[0];
    S[2 * i + 1] = s[1];
    const n = indexOf(top, LAMBDAS[i]);
    N[2 * i] = n[0];
    N[2 * i + 1] = n[1];
  }
  const metal = top === M.CU || top === M.W;
  let bulk: [number, number, number] | null = null;
  const R = new Float64Array(L);
  const out: [number, number, number][] = [];
  // (plain loops rather than a callback per thickness: the engine then optimises this after the
  // first table of a session rather than after the second or third)
  for (let t = 0; t < nms.length; t++) {
    const nm = nms[t];
    // a thick metal film hides everything under it (as visibleStack decides)
    if (metal && nm > 60) {
      out.push((bulk ??= stackColor([{ mat: top, nm }])));
      continue;
    }
    for (let i = 0; i < L; i++) {
      const o = i * 8;
      let m11r = B[o],
        m11i = B[o + 1],
        m12r = B[o + 2],
        m12i = B[o + 3],
        m21r = B[o + 4],
        m21i = B[o + 5],
        m22r = B[o + 6],
        m22i = B[o + 7];
      if (nm > 0.2) {
        // the top film: A = [[cos δ, i sin δ / n], [i n sin δ, cos δ]], δ = 2π n d / λ, and M = A × B
        const nr = N[2 * i];
        const ni = N[2 * i + 1];
        const k = (2 * Math.PI * nm) / LAMBDAS[i];
        const dr = k * nr;
        const di = k * ni;
        const ep = Math.exp(di);
        const em = Math.exp(-di);
        const ch = (ep + em) / 2;
        const sh = (ep - em) / 2;
        const c = Math.cos(dr);
        const s = Math.sin(dr);
        const cr = c * ch; // cos δ
        const ci = -s * sh;
        const sr = s * ch; // sin δ
        const si = c * sh;
        const d = nr * nr + ni * ni;
        const a12r = (-si * nr + sr * ni) / d; // i sin δ / n
        const a12i = (sr * nr + si * ni) / d;
        const a21r = -(nr * si + ni * sr); // i n sin δ
        const a21i = nr * sr - ni * si;
        const t11r = cr * m11r - ci * m11i + a12r * m21r - a12i * m21i;
        const t11i = cr * m11i + ci * m11r + a12r * m21i + a12i * m21r;
        const t12r = cr * m12r - ci * m12i + a12r * m22r - a12i * m22i;
        const t12i = cr * m12i + ci * m12r + a12r * m22i + a12i * m22r;
        const t21r = a21r * m11r - a21i * m11i + cr * m21r - ci * m21i;
        const t21i = a21r * m11i + a21i * m11r + cr * m21i + ci * m21r;
        const t22r = a21r * m12r - a21i * m12i + cr * m22r - ci * m22i;
        const t22i = a21r * m12i + a21i * m12r + cr * m22i + ci * m22r;
        m11r = t11r;
        m11i = t11i;
        m12r = t12r;
        m12i = t12i;
        m21r = t21r;
        m21i = t21i;
        m22r = t22r;
        m22i = t22i;
      }
      // r = (b − c) / (b + c) with b = m11 + m12 ns, c = m21 + m22 ns (from air)
      const sr = S[2 * i];
      const si = S[2 * i + 1];
      const br = m11r + m12r * sr - m12i * si;
      const bi = m11i + m12r * si + m12i * sr;
      const cr = m21r + m22r * sr - m22i * si;
      const ci = m21i + m22r * si + m22i * sr;
      const ur = br - cr;
      const ui = bi - ci;
      const vr = br + cr;
      const vi = bi + ci;
      R[i] = (ur * ur + ui * ui) / (vr * vr + vi * vi);
    }
    out.push(colourOf(R));
  }
  return out;
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
