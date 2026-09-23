/**
 * Context for a tool scene mounted at its fab station. Scenes use it to:
 *  - skip their standalone environment (own floor, backdrop) when placed in the bay;
 *  - register the learner's wafer as the camera anchor (Wafer `anchor`).
 */
import { createContext, useContext } from 'react';
import type { MachineId } from '../../state/nav';
import type { Presentation } from '../../state/presentation';

/** A detailed machine mounted at its station, and what it shows. */
export interface StationMount {
  id: MachineId;
  pres: Presentation;
  variant?: string;
}

export interface StationEnv {
  station: MachineId | null;
  /** True when the scene stands in the shared fab (the bay provides floor and lighting). */
  placed: boolean;
}

export const StationContext = createContext<StationEnv>({ station: null, placed: false });

export function useStationEnv(): StationEnv {
  return useContext(StationContext);
}
