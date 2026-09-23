/**
 * Draws the wafer's top surface from the simulated wafer summary: thin-film interference
 * colour of the blanket films (computed), a die grid once layers are patterned, particles
 * (drawn enormously enlarged), wafer-map colours and dicing cuts. The die texture only
 * suggests circuitry at die scale; transistors are never drawn at wafer scale.
 */
import * as THREE from 'three';
import { DIES, WAFER, YOUR_DIE, radialThickness } from '../../sim/dies';
import { filmsColor, toSrgb8 } from '../../sim/filmColor';
import { M } from '../../sim/materials';
import { mulberry32 } from '../../sim/rng';
import type { Film, Particle, WaferSummary } from '../../sim/types';
import type { WaferMapResult } from '../../sim/waferMap';

export interface CoatOverride {
  /** Fraction of the radius covered by liquid resist (0..1). */
  coverage: number;
  /** Film thickness in nm at the centre. */
  nm: number;
  edgeRise: number;
  /** Extra thickness toward the rim while still flowing (0..1). */
  rim: number;
  /** Edge-bead removal has cleared the outer ring. */
  ebr: boolean;
}

export interface WaferLook {
  summary: WaferSummary;
  showParticles?: boolean;
  map?: WaferMapResult;
  mapReveal?: number; // 0..1 fraction of dies revealed (probe animation)
  highlightDie?: boolean;
  coat?: CoatOverride | null;
  exposedFields?: number; // illustrative latent highlight of exposed fields
  fields?: readonly { x: number; y: number; w: number; h: number }[];
  developedPattern?: boolean;
  plain?: boolean;
  /** Draw the planned die grid and exposure fields (die map preview). */
  planGrid?: boolean;
}

const css = (c: [number, number, number]) => `rgb(${toSrgb8(c[0])},${toSrgb8(c[1])},${toSrgb8(c[2])})`;

/** Resist beyond this thickness is a liquid puddle: no interference colours, just its tint. */
export const RESIST_MAX_NM = 1800;
export const PUDDLE: [number, number, number] = [0.55, 0.47, 0.95];
const FILM_LUT_N = 256;

// sRGB 8-bit ⇄ linear light, to tint painted pixels exactly as the shader tints sampled ones
const SRGB_TO_LIN = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});
const LIN_N = 4096;
const LIN_TO_SRGB = new Uint8ClampedArray(LIN_N + 1).map((_, i) => toSrgb8(i / LIN_N));

/**
 * A resist film over everything painted so far: each pixel is tinted by the film's
 * thin-film colour factor at its radius (the colour of the stack with the resist over the
 * colour without it), in linear light — exactly what the wafer's shader does (Wafer.tsx), from
 * the same thickness profile and the same thickness table. The 3D wafer draws its resist in
 * the shader and never comes here (a per-pixel pass costs tens of milliseconds); this is for
 * pictures painted on their own.
 */
function tintByResist(ctx: CanvasRenderingContext2D, size: number, films: Film[], coat: CoatOverride): void {
  const R = WAFER.radius;
  const base = filmsColor(films);
  const ratio = (c: [number, number, number], i: number) => c[i] / Math.max(1e-4, base[i]);
  const lut = new Float32Array(FILM_LUT_N * 3);
  for (let k = 0; k < FILM_LUT_N; k++) {
    const c = filmsColor([...films, { mat: M.RES, nm: (k / (FILM_LUT_N - 1)) * RESIST_MAX_NM }]);
    for (let i = 0; i < 3; i++) lut[k * 3 + i] = ratio(c, i);
  }
  const pud = base.map((b, i) => b + (PUDDLE[i] - b) * 0.55) as [number, number, number];
  // the factor along the radius (bins of 0.15 mm)
  const BINS = 1024;
  const f = new Float32Array((BINS + 1) * 3);
  const rMax = R * coat.coverage;
  for (let b = 0; b <= BINS; b++) {
    const r = (b / BINS) * R;
    const u = r / R;
    let nm = coat.nm * radialThickness(r, coat.edgeRise) * (1 + coat.rim * Math.pow(u, 6) * 2.5);
    if (coat.ebr && r > R - 2.2) nm = 0;
    for (let i = 0; i < 3; i++) {
      if (r > rMax) f[b * 3 + i] = 1;
      else if (nm > RESIST_MAX_NM) f[b * 3 + i] = ratio(pud, i);
      else {
        const x = (nm / RESIST_MAX_NM) * (FILM_LUT_N - 1);
        const k0 = Math.min(FILM_LUT_N - 2, Math.floor(x));
        const t = x - k0;
        f[b * 3 + i] = lut[k0 * 3 + i] * (1 - t) + lut[(k0 + 1) * 3 + i] * t;
      }
    }
  }
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const half = size / 2;
  const mm = (2 * R) / size;
  for (let y = 0; y < size; y++) {
    const dy = (y + 0.5 - half) * mm;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (d[i + 3] === 0) continue;
      const dx = (x + 0.5 - half) * mm;
      const b = Math.min(BINS, Math.round((Math.sqrt(dx * dx + dy * dy) / R) * BINS)) * 3;
      for (let c = 0; c < 3; c++) d[i + c] = LIN_TO_SRGB[Math.min(LIN_N, Math.round(SRGB_TO_LIN[d[i + c]] * f[b + c] * LIN_N))];
    }
  }
  ctx.putImageData(img, 0, 0);
}

function mixc(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function drawWafer(ctx: CanvasRenderingContext2D, size: number, look: WaferLook): void {
  const s = look.summary;
  const R = WAFER.radius;
  const px = (mm: number) => ((mm + R) / (2 * R)) * size;
  const py = (mm: number) => ((R - mm) / (2 * R)) * size;
  const k = size / (2 * R);
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  // wafer outline with notch at −y
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, R * k, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  const films: Film[] = s.films;
  const base = filmsColor(films);
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, size, size);

  // resist coat (applied last: a transparent film over everything below it)
  const resist: CoatOverride | null = look.coat
    ? look.coat
    : s.resist && s.resist.phase !== 'developed'
      ? { nm: s.resist.nm, edgeRise: s.resist.edgeRise, coverage: 1, rim: 0, ebr: true }
      : null;

  // die grid (after the first patterning)
  const patterned = s.pattern > 0 || look.developedPattern;
  if (patterned && !look.plain) {
    const street = 0.5;
    const top = s.copperTop;
    const lvl = Math.min(12, s.pattern);
    const dieTint = top ? ([0.9, 0.62, 0.48] as [number, number, number]) : mixc(base, [0.72, 0.74, 0.8], 0.25 + lvl * 0.02);
    const rng = mulberry32(99);
    const blocks = Array.from({ length: 9 }, () => ({
      x: rng() * 0.8,
      y: rng() * 0.8,
      w: 0.12 + rng() * 0.3,
      h: 0.1 + rng() * 0.3,
      t: rng(),
    }));
    for (const d of DIES) {
      const x0 = d.x - WAFER.dieW / 2 + street;
      const y1 = d.y + WAFER.dieH / 2 - street;
      const w = WAFER.dieW - 2 * street;
      const h = WAFER.dieH - 2 * street;
      ctx.fillStyle = css(dieTint);
      const blanket = films.length > 0 && films[films.length - 1].mat === M.POLY;
      ctx.globalAlpha = blanket ? 0.18 : look.developedPattern && s.resist ? 0.55 : 0.62;
      ctx.fillRect(px(x0), py(y1), w * k, h * k);
      ctx.globalAlpha = 1;
      // functional blocks (die scale only)
      for (const b of blocks.slice(0, 3 + Math.floor(lvl / 2))) {
        const shade = mixc(dieTint, b.t > 0.5 ? [1, 1, 1] : [0.2, 0.22, 0.28], 0.12 + b.t * 0.12);
        ctx.fillStyle = css(shade);
        ctx.fillRect(px(x0 + b.x * w), py(y1 - b.y * h), b.w * w * k, b.h * h * k);
      }
      // bond pads along the die edge once metal exists
      if (s.metalLevels > 0 || s.passivated) {
        ctx.fillStyle = s.passivated ? 'rgba(200,190,170,0.9)' : 'rgba(235,190,160,0.9)';
        for (let i = 0; i < 4; i++) {
          ctx.fillRect(px(x0 + 0.6 + i * (w - 1.8) / 3), py(y1 - 0.4), 0.9 * k, 0.9 * k);
        }
      }
    }
  }

  // planned die grid and exposure fields
  if (look.planGrid) {
    ctx.lineWidth = Math.max(1, size / 900);
    for (const d of DIES) {
      const x0 = px(d.x - WAFER.dieW / 2);
      const y0 = py(d.y + WAFER.dieH / 2);
      if (!d.full) {
        ctx.fillStyle = 'rgba(40, 40, 50, 0.10)';
        ctx.fillRect(x0, y0, WAFER.dieW * k, WAFER.dieH * k);
      }
      ctx.strokeStyle = d.full ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)';
      ctx.strokeRect(x0 + 1, y0 + 1, WAFER.dieW * k - 2, WAFER.dieH * k - 2);
    }
    if (look.fields) {
      ctx.strokeStyle = 'rgba(106, 90, 249, 0.55)';
      ctx.lineWidth = Math.max(1.5, size / 420);
      for (const f of look.fields) ctx.strokeRect(px(f.x - f.w / 2), py(f.y + f.h / 2), f.w * k, f.h * k);
    }
  }

  // exposed fields (illustrative latent highlight)
  if (look.exposedFields && look.fields) {
    ctx.fillStyle = 'rgba(214, 206, 255, 0.28)';
    ctx.strokeStyle = 'rgba(106, 90, 249, 0.55)';
    ctx.lineWidth = Math.max(1, size / 700);
    for (let i = 0; i < Math.min(look.exposedFields, look.fields.length); i++) {
      const f = look.fields[i];
      ctx.fillRect(px(f.x - f.w / 2), py(f.y + f.h / 2), f.w * k, f.h * k);
      ctx.strokeRect(px(f.x - f.w / 2), py(f.y + f.h / 2), f.w * k, f.h * k);
    }
  }

  // wafer map
  if (look.map) {
    const n = Math.floor((look.mapReveal ?? 1) * DIES.length);
    const order = [...DIES].sort((a, b) => (a.row - b.row) * 100 + (a.row % 2 ? b.col - a.col : a.col - b.col));
    for (let i = 0; i < n; i++) {
      const d = order[i];
      const r = look.map.dies[d.id];
      if (r.verdict === 'edge') continue;
      ctx.fillStyle = r.verdict === 'pass' ? 'rgba(52, 190, 128, 0.72)' : 'rgba(222, 82, 60, 0.8)';
      ctx.fillRect(px(d.x - WAFER.dieW / 2 + 0.7), py(d.y + WAFER.dieH / 2 - 0.7), (WAFER.dieW - 1.4) * k, (WAFER.dieH - 1.4) * k);
    }
  }

  // particles (drawn huge: real ones are sub-micrometre)
  if (look.showParticles && s.particles.length) {
    for (const p of s.particles as Particle[]) {
      const cx = px(p.x);
      const cy = py(p.y);
      const r = Math.max(3, size * 0.006) * (0.7 + p.sizeUm);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3.2);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#16171a';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // dicing cuts
  if (s.diced) {
    ctx.strokeStyle = 'rgba(30,30,34,0.85)';
    ctx.lineWidth = Math.max(1.5, size / 500);
    for (let c = -12; c <= 12; c++) {
      ctx.beginPath();
      ctx.moveTo(px(c * WAFER.dieW), 0);
      ctx.lineTo(px(c * WAFER.dieW), size);
      ctx.stroke();
    }
    for (let r = -10; r <= 10; r++) {
      ctx.beginPath();
      ctx.moveTo(0, py(r * WAFER.dieH));
      ctx.lineTo(size, py(r * WAFER.dieH));
      ctx.stroke();
    }
  }

  // your die
  if (look.highlightDie) {
    const d = DIES[YOUR_DIE];
    ctx.strokeStyle = '#6a5af9';
    ctx.lineWidth = Math.max(2, size / 220);
    ctx.strokeRect(px(d.x - WAFER.dieW / 2), py(d.y + WAFER.dieH / 2), WAFER.dieW * k, WAFER.dieH * k);
  }

  // edge exclusion ring (subtle)
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = WAFER.edgeExclusion * k;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, (R - WAFER.edgeExclusion / 2) * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  if (resist && resist.coverage > 0) tintByResist(ctx, size, films, resist);
}

export function lookKey(l: WaferLook, size: number): string {
  const s = l.summary;
  return [
    size,
    s.films.map((f) => `${f.mat}:${Math.round(f.nm)}`).join(','),
    s.resist ? `${s.resist.phase}:${s.resist.nm.toFixed(1)}:${s.resist.edgeRise.toFixed(3)}` : '-',
    s.pattern,
    s.copperTop,
    s.metalLevels,
    s.passivated,
    s.diced,
    l.showParticles ? s.particles.length : 0,
    l.map ? `${l.map.passed}/${l.map.tested}/${(l.mapReveal ?? 1).toFixed(2)}` : '-',
    l.highlightDie ? 1 : 0,
    l.coat ? `${l.coat.coverage.toFixed(3)}:${l.coat.nm.toFixed(0)}:${l.coat.rim.toFixed(2)}:${l.coat.ebr}` : '-',
    l.exposedFields ?? 0,
    l.developedPattern ? 1 : 0,
    l.plain ? 1 : 0,
    l.planGrid ? 1 : 0,
  ].join('|');
}

export function makeCanvasTexture(size: number): { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { canvas, tex };
}
