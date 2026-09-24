/**
 * Cross-section geometry, built off the main thread and kept in a small cache.
 *
 * Meshing the die grid takes tens to hundreds of milliseconds (it is a large grid), which as
 * a main-thread task stalls the picture exactly when a process operation completes. So a
 * worker computes the simulated state for an operation count and meshes it (mesh.worker.ts);
 * the page keeps showing the previous geometry until the new one arrives, and while a lesson
 * plays, the rest of the step's operations are prepared in advance so each change is ready
 * before it is due. The frame-stepped harness builds synchronously, so its frames are exact.
 */
import * as THREE from 'three';
import type { Choices } from '../../sim/types';
import type { Grid } from '../../sim/grid';
import { buildDeviceArrays, DEV, type DeviceArrays, type Group, type MeshOptions } from './mesher';

export { DEV };

export const GROUPS: Group[] = ['semi', 'diel', 'metal', 'resist', 'glow'];

export type DeviceGeos = Record<Group, THREE.BufferGeometry>;

/** What a mesh request needs besides the process state. */
export interface MeshRequestOpts {
  yMin: number;
  xray: boolean;
  /** Segment indices in the glowing current path (final test), if any. */
  glow?: number[];
}

export function meshOptions(o: MeshRequestOpts): MeshOptions {
  return { yMin: o.yMin, xray: o.xray, s: DEV.s, zs: DEV.zs, zMin: DEV.zMin, glow: o.glow ? new Set(o.glow) : undefined };
}

export function toGeometry(a: DeviceArrays): DeviceGeos {
  const out = {} as DeviceGeos;
  for (const k of GROUPS) {
    const m = a[k];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(m.col, 3));
    g.setIndex(new THREE.BufferAttribute(m.idx, 1));
    g.computeBoundingSphere();
    out[k] = g;
  }
  return out;
}

/** Main-thread build (the harness, and browsers without workers). */
export function buildDeviceGeometry(g: Grid, o: MeshOptions): DeviceGeos {
  return toGeometry(buildDeviceArrays(g, o));
}

interface Job {
  key: string;
  choices: Choices;
  n: number;
  opts: MeshRequestOpts;
}

const CAPACITY = 12;

class DeviceMeshes {
  private cache = new Map<string, DeviceGeos>();
  /** Geometry on screen right now is never evicted. */
  private inUse = new Map<string, number>();
  private listeners = new Set<() => void>();
  private worker: Worker | null | undefined;
  private nextId = 1;
  private busy: { id: number; job: Job } | null = null;
  /** Needed now (the step's current operation), then prepared in advance (the rest of it). */
  private urgent: Job[] = [];
  private later: Job[] = [];
  /** Builds done off the main thread / on it, for the measurement harness. */
  stats = { worker: 0, main: 0, hits: 0 };

  get(key: string): DeviceGeos | undefined {
    const g = this.cache.get(key);
    if (g) {
      this.cache.delete(key);
      this.cache.set(key, g);
      this.stats.hits++;
    }
    return g;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  put(key: string, g: DeviceGeos) {
    this.cache.set(key, g);
    for (const [k, geos] of this.cache) {
      if (this.cache.size <= CAPACITY) break;
      if (this.inUse.has(k)) continue;
      this.cache.delete(k);
      for (const grp of GROUPS) geos[grp].dispose();
    }
    this.listeners.forEach((f) => f());
  }

  hold(key: string) {
    this.inUse.set(key, (this.inUse.get(key) ?? 0) + 1);
  }

  release(key: string) {
    const n = (this.inUse.get(key) ?? 1) - 1;
    if (n > 0) this.inUse.set(key, n);
    else this.inUse.delete(key);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Build now on this thread (frame-exact harness). */
  buildNow(key: string, grid: Grid, opts: MeshRequestOpts): DeviceGeos {
    const hit = this.get(key);
    if (hit) return hit;
    const g = buildDeviceGeometry(grid, meshOptions(opts));
    this.stats.main++;
    this.put(key, g);
    return g;
  }

  /** Ask for a geometry: `now` for the one to show, otherwise prepared when the worker is free. */
  request(job: Job, now: boolean) {
    if (this.cache.has(job.key) || this.busy?.job.key === job.key) return;
    const q = now ? this.urgent : this.later;
    if (q.some((j) => j.key === job.key)) return;
    if (now) {
      this.later = this.later.filter((j) => j.key !== job.key);
      this.urgent = [job];
    } else q.push(job);
    this.pump();
  }

  /** Forget prepared-in-advance work that no longer applies (another step or run). */
  clearLater() {
    this.later = [];
  }

  private ensureWorker(): Worker | null {
    if (this.worker !== undefined) return this.worker;
    this.worker = null;
    if (typeof Worker === 'undefined') return null;
    try {
      const w = new Worker(new URL('./mesh.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; arrays: DeviceArrays }>) => {
        const b = this.busy;
        this.busy = null;
        if (b && b.id === e.data.id) {
          this.stats.worker++;
          this.put(b.job.key, toGeometry(e.data.arrays));
        }
        this.pump();
      };
      w.onerror = () => {
        this.worker = null;
        const b = this.busy;
        this.busy = null;
        if (b) this.urgent.unshift(b.job);
        this.pump();
      };
      this.worker = w;
    } catch {
      this.worker = null;
    }
    return this.worker;
  }

  private pump(): void {
    if (this.busy) return;
    let job = this.urgent.shift() ?? this.later.shift();
    while (job && this.cache.has(job.key)) job = this.urgent.shift() ?? this.later.shift();
    if (!job) return;
    const w = this.ensureWorker();
    const id = this.nextId++;
    this.busy = { id, job };
    if (w) {
      w.postMessage({ id, choices: job.choices, n: job.n, opts: job.opts });
      return;
    }
    // no worker: build on this thread, outside the frame that asked
    setTimeout(async () => {
      const { engine } = await import('../../state/sim');
      const plan = engine.plan(job.choices);
      const grid = engine.replayer.stateAt(plan, job.n).grid;
      this.busy = null;
      this.stats.main++;
      this.put(job.key, buildDeviceGeometry(grid, meshOptions(job.opts)));
      this.pump();
    }, 0);
  }
}

export const deviceMeshes = new DeviceMeshes();

/**
 * Whether the cross-section is mounted, and drawn with the geometry it asks for (not an earlier
 * one kept on screen while it is built, or none yet): after a seek the director holds the film's
 * picture until it is.
 */
export const deviceShown = { mounted: false, exact: false };
