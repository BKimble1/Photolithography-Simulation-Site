/**
 * Rendering quality: one of three tiers, chosen from the device and lowered (or raised again)
 * from measured frame times. A tier changes only how the picture is drawn — pixel ratio,
 * shadow-map size, how often shadow maps are redrawn, antialiasing of the cross-section's
 * soft shadow — never what is shown or when: lesson, demonstration and film timing do not
 * depend on it.
 *
 * Shadow maps are redrawn only when something that casts a shadow may have moved (a machine's
 * presented progress changed, a housing is opening, the lit machine changed, a model was
 * mounted), with a periodic refresh for slow decorative motion. A camera move alone never
 * needs them: shadows do not depend on the viewpoint.
 *
 * ?quality=high|medium|low forces a tier (tests, measurements, comparisons); ?diag=1 shows
 * the developer overlay (tier, frame times, draw calls).
 */
import type * as THREE from 'three';
import { create } from 'zustand';

export type Tier = 'high' | 'medium' | 'low';

export interface TierSpec {
  /** Upper bound of the device pixel ratio. */
  dprMax: number;
  /** Shadow map resolution of the key lights. */
  shadowMap: number;
  /** Redraw shadows at least every this many frames even when nothing is known to move. */
  shadowRefresh: number;
}

export const TIERS: Record<Tier, TierSpec> = {
  high: { dprMax: 2, shadowMap: 2048, shadowRefresh: 4 },
  medium: { dprMax: 1.5, shadowMap: 1024, shadowRefresh: 12 },
  low: { dprMax: 1, shadowMap: 1024, shadowRefresh: 30 },
};

const ORDER: Tier[] = ['low', 'medium', 'high'];

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const forced = ((): Tier | null => {
  const q = params.get('quality');
  return q === 'high' || q === 'medium' || q === 'low' ? q : null;
})();

/** Developer overlay (?diag=1): tier, frame times and renderer counters. */
export const DIAG = params.get('diag') === '1';

/** The starting tier from what the device says about itself. */
export function initialTier(renderer: string, cores: number, memoryGB: number | undefined, touch: boolean, dpr: number): Tier {
  if (forced) return forced;
  const soft = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(renderer);
  if (soft) return 'low';
  if (cores <= 2 || (memoryGB !== undefined && memoryGB <= 2)) return 'low';
  if (touch && dpr >= 2) return 'medium';
  if (cores <= 4 && memoryGB !== undefined && memoryGB <= 4) return 'medium';
  return 'high';
}

interface QualityState {
  tier: Tier;
  /** Why the tier is what it is (the diagnostic overlay shows it). */
  reason: string;
  renderer: string;
}

export const useQuality = create<QualityState>(() => ({ tier: forced ?? 'high', reason: forced ? 'forced by ?quality' : 'default', renderer: '' }));

/** Step the tier down (frame rate too low) or up (headroom); ignored when forced. */
export function stepTier(dir: -1 | 1, reason: string) {
  if (forced) return;
  const cur = useQuality.getState().tier;
  const i = Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(cur) + dir));
  if (ORDER[i] !== cur) useQuality.setState({ tier: ORDER[i], reason });
}

/** Per-frame render bookkeeping shared by the director and the stage. */
export const quality = {
  frame: 0,
  /** Shadow maps that must be redrawn before their scene is next drawn. */
  dirty: { world: true, device: true } as Record<'world' | 'device', boolean>,
  lastShadow: { world: -1e9, device: -1e9 } as Record<'world' | 'device', number>,
  /** Count of shadow-map redraws (the measurement harness reads it). */
  shadowRedraws: 0,
  /** Something that casts shadows may have moved. */
  invalidate(space: 'world' | 'device' | 'both' = 'both') {
    if (space !== 'device') this.dirty.world = true;
    if (space !== 'world') this.dirty.device = true;
  },
  /** Called by the director right before it draws a scene. */
  beforeRender(gl: THREE.WebGLRenderer, space: 'world' | 'device') {
    const spec = TIERS[useQuality.getState().tier];
    gl.shadowMap.autoUpdate = false;
    const due = this.dirty[space] || this.frame - this.lastShadow[space] >= spec.shadowRefresh;
    gl.shadowMap.needsUpdate = due;
    if (due) {
      this.dirty[space] = false;
      this.lastShadow[space] = this.frame;
      this.shadowRedraws++;
    }
  },
};
