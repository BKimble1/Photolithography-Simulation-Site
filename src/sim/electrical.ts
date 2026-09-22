/**
 * Electrical test by connectivity extraction.
 *
 * Every conductive segment in the die grid (copper, tungsten, doped polysilicon, n+ and p+
 * silicon) is a node. Nodes that touch — vertically in a column, or sideways between
 * neighbouring columns with overlapping height ranges — are joined, subject to simple
 * rules (n+ and p+ silicon form a junction and do not join). The silicon surface under a
 * gate is a channel: it conducts only when the gate's net is at the level that turns that
 * transistor on (high for NMOS, low for PMOS). Very short channels punch through and
 * conduct regardless.
 *
 * The inverter is then tested like a tester would: drive IN low and high, and see whether
 * OUT connects to VDD, GND, both (contention) or neither (floating). A leakage (IDDQ) check
 * flags gates that are too short. The result follows only from the geometry the process
 * produced — nothing is looked up from the learner's settings.
 */

import { Grid } from './grid';
import { PINS, type PinName } from './layout';
import { DOP, M } from './materials';

type Cls = 0 | 1 | 2 | 3 | 4 | 5 | 6; // none, metal, poly, n+, p+, nChannel, pChannel
const NONE = 0,
  METAL = 1,
  POLY = 2,
  NP = 3,
  PP = 4,
  CHN = 5,
  CHP = 6;

/** Channel length (gu) below which a transistor cannot be turned off. */
export const L_PUNCH = 2.6;
/** Channel length (gu) below which standby leakage fails the IDDQ limit. */
export const L_IDDQ = 4.1;
/** Channel length (gu) below which the transistor is noticeably leakier than designed. */
export const L_SHORTISH = 5.1;
/** Designed gate length (gu). */
export const L_DRAWN = 6;

class DSU {
  p: Int32Array;
  constructor(n: number) {
    this.p = new Int32Array(n);
    for (let i = 0; i < n; i++) this.p[i] = i;
  }
  find(a: number): number {
    const p = this.p;
    while (p[a] !== a) {
      p[a] = p[p[a]];
      a = p[a];
    }
    return a;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p[ra] = rb;
  }
  clone(): DSU {
    const d = new DSU(0);
    d.p = this.p.slice();
    return d;
  }
}

function classify(g: Grid): { cls: Uint8Array; gateOf: Int32Array } {
  const K = g.K;
  const cls = new Uint8Array(g.columns * K);
  const gateOf = new Int32Array(g.columns * K).fill(-1);
  for (let c = 0; c < g.columns; c++) {
    const n = g.n[c];
    const base = c * K;
    for (let k = 0; k < n; k++) {
      const idx = base + k;
      const m = g.mat[idx];
      let v: Cls = NONE;
      if (m === M.W || m === M.CU) v = METAL;
      else if (m === M.POLY) v = POLY;
      else if (m === M.SI) {
        const t = g.tag[idx];
        if (t === DOP.NPLUS) v = NP;
        else if (t === DOP.PPLUS) v = PP;
      }
      cls[idx] = v;
    }
    // Channel: the topmost silicon segment, lightly doped, with a thin oxide and then a
    // polysilicon gate directly above it.
    const si = g.siTopIndex(c);
    if (si >= 0 && si + 2 < n) {
      const sidx = base + si;
      const t = g.tag[sidx];
      const ox = base + si + 1;
      const po = base + si + 2;
      if (
        (t === DOP.PWELL || t === DOP.PSUB || t === DOP.NWELL) &&
        g.mat[ox] === M.OX &&
        g.thickness(c, si + 1) < 1.2 &&
        g.mat[po] === M.POLY
      ) {
        cls[sidx] = t === DOP.NWELL ? CHP : CHN;
        gateOf[sidx] = po;
      }
    }
  }
  return { cls, gateOf };
}

function canJoin(a: number, b: number): boolean {
  if (a === NONE || b === NONE) return false;
  if (a === METAL || b === METAL) {
    const o = a === METAL ? b : a;
    return o === METAL || o === POLY || o === NP || o === PP;
  }
  if (a === POLY || b === POLY) {
    const o = a === POLY ? b : a;
    return o === POLY || o === NP || o === PP;
  }
  if (a === NP && b === NP) return true;
  if (a === PP && b === PP) return true;
  return false;
}

/** Can a channel node of class ch join a neighbour of class o (when the channel is on)? */
function channelJoins(ch: number, o: number): boolean {
  if (ch === CHN) return o === NP || o === CHN;
  if (ch === CHP) return o === PP || o === CHP;
  return false;
}

interface Adjacency {
  /** Static conductive links [a, b]. */
  links: Int32Array;
  /** Links that involve a channel node [channelNode, other]. */
  chLinks: Int32Array;
}

function adjacency(g: Grid, cls: Uint8Array): Adjacency {
  const K = g.K;
  const links: number[] = [];
  const ch: number[] = [];
  const add = (a: number, b: number) => {
    const ca = cls[a];
    const cb = cls[b];
    if (ca === CHN || ca === CHP) {
      if (channelJoins(ca, cb)) ch.push(a, b);
      return;
    }
    if (cb === CHN || cb === CHP) {
      if (channelJoins(cb, ca)) ch.push(b, a);
      return;
    }
    if (canJoin(ca, cb)) links.push(a, b);
  };
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const c = j * g.nx + i;
      const n = g.n[c];
      const base = c * K;
      // vertical neighbours
      for (let k = 0; k + 1 < n; k++) if (cls[base + k] && cls[base + k + 1]) add(base + k, base + k + 1);
      // lateral neighbours (+x, +y)
      const nbrs: number[] = [];
      if (i + 1 < g.nx) nbrs.push(c + 1);
      if (j + 1 < g.ny) nbrs.push(c + g.nx);
      for (const d of nbrs) {
        const nd = g.n[d];
        const dbase = d * K;
        for (let k = 0; k < n; k++) {
          const a = base + k;
          if (!cls[a]) continue;
          const a0 = g.base(c, k);
          const a1 = g.top[a];
          for (let m = 0; m < nd; m++) {
            const b = dbase + m;
            if (!cls[b]) continue;
            const b0 = g.base(d, m);
            const b1 = g.top[b];
            if (Math.min(a1, b1) - Math.max(a0, b0) > 0.05) add(a, b);
          }
        }
      }
    }
  }
  return { links: Int32Array.from(links), chLinks: Int32Array.from(ch) };
}

function pinNode(g: Grid, pin: PinName): number {
  const p = PINS[pin];
  const i = Math.floor(p.x / g.dx);
  const j = Math.floor(p.y / g.dy);
  const c = g.col(i, j);
  const base = c * g.K;
  for (let k = g.n[c] - 1; k >= 0; k--) {
    const m = g.mat[base + k];
    if (m === M.CU || m === M.W) return base + k;
    if (m === M.PASS || m === M.CAP || m === M.ILD || m === M.OX) continue;
    break;
  }
  return -1;
}

export type Level = 0 | 1 | 'X' | 'Z';

export interface TransistorInfo {
  type: 'nmos' | 'pmos';
  /** Shortest channel length found between source and drain, gu (NaN if none). */
  length: number;
  /** Channel width (gu) along the gate. */
  width: number;
  /** Nets the channel connects, if any. */
  terminals: number;
  punchThrough: boolean;
  gateNet: PinName | 'floating' | 'none';
}

export interface ElectricalResult {
  /** Wiring exists (metal-2 reaches all four pins) — false before the back end is built. */
  wired: boolean;
  out: { in0: Level; in1: Level };
  functional: boolean;
  iddqOk: boolean;
  pass: boolean;
  /** Static shorts between pins, e.g. ['IN', 'OUT']. */
  shorts: [PinName, PinName][];
  openPins: PinName[];
  transistors: TransistorInfo[];
  /** Plain-language diagnosis for the learner, ordered by importance. */
  reasons: string[];
  /** Nodes that carry current for each input state (for highlighting the current path). */
  path: { in0: number[]; in1: number[] };
}

const PIN_NAMES: PinName[] = ['VDD', 'GND', 'IN', 'OUT'];

export function extract(g: Grid): ElectricalResult {
  const { cls, gateOf } = classify(g);
  const size = g.columns * g.K;
  const adj = adjacency(g, cls);
  const base = new DSU(size);
  for (let t = 0; t < adj.links.length; t += 2) base.union(adj.links[t], adj.links[t + 1]);

  const pins: Record<PinName, number> = { VDD: -1, GND: -1, IN: -1, OUT: -1 };
  for (const p of PIN_NAMES) pins[p] = pinNode(g, p);
  const openPins = PIN_NAMES.filter((p) => pins[p] < 0);
  const wired = openPins.length === 0;

  // Static shorts (without any transistor action).
  const shorts: [PinName, PinName][] = [];
  for (let a = 0; a < PIN_NAMES.length; a++)
    for (let b = a + 1; b < PIN_NAMES.length; b++) {
      const pa = pins[PIN_NAMES[a]];
      const pb = pins[PIN_NAMES[b]];
      if (pa >= 0 && pb >= 0 && base.find(pa) === base.find(pb)) shorts.push([PIN_NAMES[a], PIN_NAMES[b]]);
    }

  // ── transistors: group channel nodes into connected channel regions ──
  const chNodes: number[] = [];
  for (let i = 0; i < size; i++) if (cls[i] === CHN || cls[i] === CHP) chNodes.push(i);
  const chDsu = new DSU(size);
  // channel-channel links
  for (let t = 0; t < adj.chLinks.length; t += 2) {
    const a = adj.chLinks[t];
    const b = adj.chLinks[t + 1];
    if (cls[b] === cls[a]) chDsu.union(a, b);
  }
  const regions = new Map<number, number[]>();
  for (const nd of chNodes) {
    const r = chDsu.find(nd);
    if (!regions.has(r)) regions.set(r, []);
    regions.get(r)!.push(nd);
  }
  // neighbours of each channel node that are diffusion
  const diffNbrs = new Map<number, number[]>();
  for (let t = 0; t < adj.chLinks.length; t += 2) {
    const a = adj.chLinks[t];
    const b = adj.chLinks[t + 1];
    if (cls[b] === NP || cls[b] === PP) {
      if (!diffNbrs.has(a)) diffNbrs.set(a, []);
      diffNbrs.get(a)!.push(b);
    }
  }
  // channel neighbour lists
  const chNbrs = new Map<number, number[]>();
  for (let t = 0; t < adj.chLinks.length; t += 2) {
    const a = adj.chLinks[t];
    const b = adj.chLinks[t + 1];
    if (cls[a] === cls[b]) {
      if (!chNbrs.has(a)) chNbrs.set(a, []);
      if (!chNbrs.has(b)) chNbrs.set(b, []);
      chNbrs.get(a)!.push(b);
      chNbrs.get(b)!.push(a);
    }
  }

  const pinOfRoot = (d: DSU, root: number): PinName | null => {
    for (const p of PIN_NAMES) if (pins[p] >= 0 && d.find(pins[p]) === root) return p;
    return null;
  };

  interface Region {
    type: 'nmos' | 'pmos';
    nodes: number[];
    gateRoot: number;
    terminals: number[]; // distinct diffusion roots
    length: number;
    width: number;
    punch: boolean;
  }
  const regionList: Region[] = [];
  for (const nodes of regions.values()) {
    const type = cls[nodes[0]] === CHN ? 'nmos' : 'pmos';
    const gateRoot = base.find(gateOf[nodes[0]]);
    const termSet = new Set<number>();
    for (const nd of nodes) for (const d of diffNbrs.get(nd) ?? []) termSet.add(base.find(d));
    const terminals = [...termSet];
    // channel length: BFS through channel columns between the first two terminals
    let length = NaN;
    if (terminals.length >= 2) {
      const [ta, tb] = terminals;
      const dist = new Map<number, number>();
      const queue: number[] = [];
      for (const nd of nodes) {
        if ((diffNbrs.get(nd) ?? []).some((d) => base.find(d) === ta)) {
          dist.set(nd, 1);
          queue.push(nd);
        }
      }
      let best = Infinity;
      for (let qi = 0; qi < queue.length; qi++) {
        const nd = queue[qi];
        const dd = dist.get(nd)!;
        if ((diffNbrs.get(nd) ?? []).some((d) => base.find(d) === tb)) best = Math.min(best, dd);
        for (const nb of chNbrs.get(nd) ?? []) {
          if (!dist.has(nb)) {
            dist.set(nb, dd + 1);
            queue.push(nb);
          }
        }
      }
      // Distances count columns along x (0.5 gu each); convert to gu.
      length = Number.isFinite(best) ? best * g.dx : NaN;
    }
    // width: distinct rows touched
    const rows = new Set<number>();
    for (const nd of nodes) rows.add(Math.floor(Math.floor(nd / g.K) / g.nx));
    regionList.push({
      type,
      nodes,
      gateRoot,
      terminals,
      length,
      width: rows.size * g.dy,
      punch: Number.isFinite(length) && length < L_PUNCH,
    });
  }

  const transistors: TransistorInfo[] = regionList
    .filter((r) => r.terminals.length >= 2 || r.nodes.length > 20)
    .map((r) => ({
      type: r.type,
      length: r.length,
      width: r.width,
      terminals: r.terminals.length,
      punchThrough: r.punch,
      gateNet: (pinOfRoot(base, r.gateRoot) ?? 'floating') as PinName | 'floating',
    }));

  // ── simulate both input states ──
  const levelOfGate = (root: number, inLevel: 0 | 1): 0 | 1 | null => {
    const p = pinOfRoot(base, root);
    if (p === 'IN') return inLevel;
    if (p === 'VDD') return 1;
    if (p === 'GND') return 0;
    return null;
  };

  const simulate = (inLevel: 0 | 1): { level: Level; path: number[] } => {
    if (!wired) return { level: 'Z', path: [] };
    const d = base.clone();
    for (const r of regionList) {
      const gl = levelOfGate(r.gateRoot, inLevel);
      const on = r.punch || (r.type === 'nmos' ? gl === 1 : gl === 0);
      if (!on) continue;
      for (const nd of r.nodes) {
        for (const nb of diffNbrs.get(nd) ?? []) d.union(nd, nb);
        for (const nb of chNbrs.get(nd) ?? []) d.union(nd, nb);
      }
    }
    // Input driven by the tester: IN is tied to its level. If IN is shorted to a supply, the
    // tester fights it — treat as contention.
    const out = d.find(pins.OUT);
    const vdd = d.find(pins.VDD);
    const gnd = d.find(pins.GND);
    const inn = d.find(pins.IN);
    let toHigh = out === vdd;
    let toLow = out === gnd;
    if (out === inn) {
      if (inLevel === 1) toHigh = true;
      else toLow = true;
    }
    if (vdd === gnd) return { level: 'X', path: collect(d, out, size) };
    const level: Level = toHigh && toLow ? 'X' : toHigh ? 1 : toLow ? 0 : 'Z';
    return { level, path: collect(d, out, size) };
  };

  const r0 = simulate(0);
  const r1 = simulate(1);
  const functional = wired && r0.level === 1 && r1.level === 0 && shorts.length === 0;

  const nT = transistors.filter((t) => t.type === 'nmos');
  const pT = transistors.filter((t) => t.type === 'pmos');
  const minL = Math.min(...transistors.map((t) => (Number.isFinite(t.length) ? t.length : Infinity)));
  const iddqOk = !(Number.isFinite(minL) && minL < L_IDDQ);

  const reasons: string[] = [];
  if (!wired) reasons.push(`Not wired yet: no metal reaches ${openPins.join(', ')}.`);
  for (const [a, b] of shorts) reasons.push(`${a} is shorted to ${b}.`);
  if (nT.length === 0) reasons.push('No working NMOS transistor was formed.');
  if (pT.length === 0) reasons.push('No working PMOS transistor was formed.');
  for (const t of transistors) {
    const name = t.type === 'nmos' ? 'NMOS' : 'PMOS';
    if (t.terminals < 2) reasons.push(`${name} source and drain are not separated by its gate.`);
    else if (t.punchThrough) reasons.push(`${name} gate is too short to switch off (punch-through).`);
    else if (Number.isFinite(t.length) && t.length < L_IDDQ) reasons.push(`${name} gate is short: it leaks too much when idle.`);
    if (t.gateNet === 'floating') reasons.push(`${name} gate is not connected to the input.`);
  }
  if (wired && r0.level !== 1) reasons.push(`With IN = 0, OUT is ${describe(r0.level)} instead of 1.`);
  if (wired && r1.level !== 0) reasons.push(`With IN = 1, OUT is ${describe(r1.level)} instead of 0.`);

  return {
    wired,
    out: { in0: r0.level, in1: r1.level },
    functional,
    iddqOk,
    pass: functional && iddqOk,
    shorts,
    openPins,
    transistors,
    reasons: dedupe(reasons),
    path: { in0: r0.path, in1: r1.path },
  };
}

function describe(l: Level): string {
  if (l === 'X') return 'fought over (shorted to both supplies)';
  if (l === 'Z') return 'floating (connected to nothing)';
  return String(l);
}

function dedupe(a: string[]): string[] {
  return [...new Set(a)];
}

function collect(d: DSU, root: number, size: number): number[] {
  const out: number[] = [];
  if (root < 0) return out;
  const r = d.find(root);
  for (let i = 0; i < size; i++) if (d.p[i] !== i || i === r) if (d.find(i) === r) out.push(i);
  return out;
}
