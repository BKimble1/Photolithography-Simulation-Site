/**
 * Reticle rasterisation and a deliberately simple aerial-image model.
 *
 * The projection lens is modelled as a Gaussian point-spread function: the intensity that
 * reaches the resist is the mask transmission blurred by a Gaussian. This captures the
 * qualitative facts the simulation relies on — edges are soft, small openings receive less
 * light than large ones, and more dose moves the printed edge — without claiming to be a
 * partially coherent imaging calculation. The 4× reduction of the scanner is implicit: the
 * mask is described directly in wafer coordinates.
 */

import { GRID } from './grid';
import { MASKS, type MaskId, type Rect } from './layout';

/** Blur (sigma, in gu) of the schematic projection optics. */
export const PSF_SIGMA = 1.35;

export interface Raster {
  nx: number;
  ny: number;
  data: Float32Array;
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** Area coverage (0..1) of drawn rectangles on each grid cell. */
export function rasterizeRects(rects: readonly Rect[], bias = 0, dx = 0, dy = 0): Raster {
  const nx = GRID.NX;
  const ny = GRID.NY;
  const data = new Float32Array(nx * ny);
  const cw = GRID.DX;
  const ch = GRID.DY;
  for (const r of rects) {
    const x0 = r[0] - bias + dx;
    const y0 = r[1] - bias + dy;
    const x1 = r[2] + bias + dx;
    const y1 = r[3] + bias + dy;
    const i0 = Math.max(0, Math.floor(x0 / cw));
    const i1 = Math.min(nx - 1, Math.ceil(x1 / cw));
    const j0 = Math.max(0, Math.floor(y0 / ch));
    const j1 = Math.min(ny - 1, Math.ceil(y1 / ch));
    for (let j = j0; j <= j1; j++) {
      const oy = overlap(j * ch, (j + 1) * ch, y0, y1) / ch;
      if (oy <= 0) continue;
      for (let i = i0; i <= i1; i++) {
        const ox = overlap(i * cw, (i + 1) * cw, x0, x1) / cw;
        if (ox <= 0) continue;
        const k = j * nx + i;
        // Shapes on one mask are merged: coverage saturates at 1.
        data[k] = Math.min(1, data[k] + ox * oy);
      }
    }
  }
  return { nx, ny, data };
}

/**
 * Transmission of a reticle layer (1 = clear quartz, 0 = chrome), placed with an overlay
 * offset (dx, dy) in gu relative to the ideal position.
 */
export function maskTransmission(id: MaskId, dx = 0, dy = 0): Raster {
  const m = MASKS[id];
  const cover = rasterizeRects(m.rects, m.bias, dx, dy);
  if (m.tone === 'clear') return cover;
  const out = new Float32Array(cover.data.length);
  for (let k = 0; k < out.length; k++) out[k] = 1 - cover.data[k];
  return { nx: cover.nx, ny: cover.ny, data: out };
}

function kernel(sigmaCells: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigmaCells * 3));
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigmaCells * sigmaCells));
    k[i + r] = v;
    s += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return k;
}

/** Separable Gaussian blur with clamp-to-edge boundaries. sigma in gu. */
export function blur(src: Raster, sigma: number): Raster {
  const { nx, ny } = src;
  const kx = kernel(sigma / GRID.DX);
  const ky = kernel(sigma / GRID.DY);
  const rx = (kx.length - 1) / 2;
  const ry = (ky.length - 1) / 2;
  const tmp = new Float32Array(nx * ny);
  const out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const row = j * nx;
    for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let t = -rx; t <= rx; t++) {
        const ii = Math.min(nx - 1, Math.max(0, i + t));
        s += src.data[row + ii] * kx[t + rx];
      }
      tmp[row + i] = s;
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let t = -ry; t <= ry; t++) {
        const jj = Math.min(ny - 1, Math.max(0, j + t));
        s += tmp[jj * nx + i] * ky[t + ry];
      }
      out[j * nx + i] = s;
    }
  }
  return { nx, ny, data: out };
}

/** Normalised aerial image (0..1) for a reticle layer at a given overlay offset. */
export function aerialImage(id: MaskId, dx = 0, dy = 0): Raster {
  return blur(maskTransmission(id, dx, dy), PSF_SIGMA);
}

/** 1D intensity profile along x at row y (gu), for the exposure explainer chart. */
export function profileAt(r: Raster, yGu: number): number[] {
  const j = Math.min(r.ny - 1, Math.max(0, Math.floor(yGu / GRID.DY)));
  const out: number[] = [];
  for (let i = 0; i < r.nx; i++) out.push(r.data[j * r.nx + i]);
  return out;
}
