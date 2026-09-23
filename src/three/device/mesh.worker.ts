/// <reference lib="webworker" />
/**
 * Computes the simulated state after n operations of a run and meshes its cross-section, off
 * the main thread (see deviceGeometry.ts). Only arrays go back, transferred, not copied.
 */
import { Engine } from '../../sim/engine';
import type { Choices } from '../../sim/types';
import { buildDeviceArrays, DEV } from './mesher';

const engine = new Engine(48);

self.onmessage = (e: MessageEvent<{ id: number; choices: Choices; n: number; opts: { yMin: number; xray: boolean; glow?: number[] } }>) => {
  const { id, choices, n, opts } = e.data;
  const plan = engine.plan(choices);
  const grid = engine.replayer.stateAt(plan, n).grid;
  const arrays = buildDeviceArrays(grid, { yMin: opts.yMin, xray: opts.xray, s: DEV.s, zs: DEV.zs, zMin: DEV.zMin, glow: opts.glow ? new Set(opts.glow) : undefined });
  const transfer: ArrayBuffer[] = [];
  for (const m of Object.values(arrays)) transfer.push(m.pos.buffer as ArrayBuffer, m.nor.buffer as ArrayBuffer, m.col.buffer as ArrayBuffer, m.idx.buffer as ArrayBuffer);
  (self as unknown as Worker).postMessage({ id, arrays }, transfer);
};
