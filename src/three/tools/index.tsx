import { lazy, Suspense, type ComponentType } from 'react';
import type { SceneId } from '../../content/steps';

export interface ToolProps {
  variant?: string;
}

/** One lazily loaded module per tool scene; each owns its own file. */
const TOOLS: Partial<Record<SceneId, ComponentType<ToolProps>>> = {
  foup: lazy(() => import('./Foup')),
  inspect: lazy(() => import('./Inspect')),
  wetclean: lazy(() => import('./WetClean')),
  furnace: lazy(() => import('./Furnace')),
  etch: lazy(() => import('./Etch')),
  cmp: lazy(() => import('./Cmp')),
  implant: lazy(() => import('./Implant')),
  depo: lazy(() => import('./Depo')),
  metrology: lazy(() => import('./Metrology')),
  prober: lazy(() => import('./Prober')),
  dicing: lazy(() => import('./Dicing')),
  package: lazy(() => import('./Package')),
  testbench: lazy(() => import('./TestBench')),
  track: lazy(() => import('./Track')),
  scanner: lazy(() => import('./Scanner')),
};

/**
 * Consecutive lessons at one machine whose animations are designed to join: the first ends
 * exactly where the second begins (the same wafer, where it was; the same parts, as they were).
 * Other same-machine changes (a different chamber opened, a different fixture) are dissolved
 * by the director instead of cut.
 */
export const BRIDGED = new Set(['arrive>transfer', 'prime>coat', 'coat>softbake', 'peb>develop', 'reticle>align', 'align>expose', 'contact-align>contact-print']);

/** The lazily loaded scene component of a tool (suspends while its module loads). */
export function toolComponent(id: SceneId): ComponentType<ToolProps> | null {
  return TOOLS[id] ?? null;
}

export function ToolScene({ id, variant }: { id: SceneId; variant?: string }) {
  const T = TOOLS[id];
  if (!T) return null;
  return (
    <Suspense fallback={null}>
      <T variant={variant} />
    </Suspense>
  );
}
