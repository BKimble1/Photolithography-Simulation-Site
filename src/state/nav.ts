/**
 * URL ⇄ navigation target. The URL always describes where the viewer is, so refresh, deep
 * links and browser Back/Forward all go through the same parser:
 *
 *   /                         home
 *   ?step=<id>                Learn, at a lesson (round-one deep links keep working)
 *   ?explore[=<machine>]      Explore fab, optionally focused on a machine (&demo=1: its demonstration)
 *   ?watch[&t=<seconds>]      Watch, at a film position
 *
 * Review/test parameters from round one (p, lp, xray, in, panel, clean, spin, dose, overlay,
 * motion, fast, flat, view) are read once at start-up by the store.
 */

import type { SceneId } from '../content/steps';
import { FLOW, STEP_INDEX, type StepId } from '../sim/flow';

export type Mode = 'home' | 'learn' | 'explore' | 'watch';

/** Machines the fab explorer can focus on (every tool scene; not the bay or the wafer view). */
export const MACHINES = [
  'foup',
  'inspect',
  'wetclean',
  'furnace',
  'implant',
  'depo',
  'track',
  'scanner',
  'etch',
  'cmp',
  'metrology',
  'prober',
  'dicing',
  'package',
  'testbench',
] as const satisfies readonly SceneId[];
export type MachineId = (typeof MACHINES)[number];
export const isMachine = (v: unknown): v is MachineId => typeof v === 'string' && (MACHINES as readonly string[]).includes(v);

export type NavTarget =
  | { mode: 'home' }
  | { mode: 'learn'; step?: number }
  | { mode: 'explore'; machine?: MachineId | null; demo?: boolean }
  | { mode: 'watch'; t?: number };

export function targetFromSearch(search: string): NavTarget {
  const q = new URLSearchParams(search);
  if (q.has('watch')) {
    const t = Number(q.get('t'));
    return { mode: 'watch', t: Number.isFinite(t) && t > 0 ? t : 0 };
  }
  if (q.has('explore')) {
    const m = q.get('explore');
    return { mode: 'explore', machine: isMachine(m) ? m : null, demo: q.get('demo') === '1' && isMachine(m) };
  }
  const s = q.get('step');
  if (s && s in STEP_INDEX) return { mode: 'learn', step: STEP_INDEX[s as StepId] };
  return { mode: 'home' };
}

export function searchFor(t: NavTarget, currentStep: number): string {
  switch (t.mode) {
    case 'home':
      return '';
    case 'learn':
      return `?step=${FLOW[t.step ?? currentStep].id}`;
    case 'explore':
      return t.machine ? `?explore=${t.machine}${t.demo ? '&demo=1' : ''}` : '?explore';
    case 'watch':
      return t.t && t.t > 0.5 ? `?watch&t=${Math.round(t.t)}` : '?watch';
  }
}

/** Only these parameters describe navigation; review parameters are dropped once applied. */
export function writeUrl(search: string, how: 'push' | 'replace'): void {
  try {
    const url = new URL(window.location.href);
    url.search = search;
    const next = url.pathname + url.search + url.hash;
    if (next === window.location.pathname + window.location.search + window.location.hash) return;
    if (how === 'push') window.history.pushState({ fab: 1 }, '', next);
    else window.history.replaceState({ fab: 1 }, '', next);
  } catch {
    /* ignore (sandboxed iframes) */
  }
}
