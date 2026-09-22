import type { Grid } from './grid';
import type { MaskId } from './layout';
import type { MatId } from './materials';

/** The learner's process choices. Defaults are a good recipe. */
export interface Choices {
  /** Run the pre-process particle clean (chapter 1). */
  clean: boolean;
  /** Spin-coat speed for the gate-layer resist, 0..1 (0.5 = recipe nominal). */
  spin: number;
  /** Gate-layer exposure dose setting, index into DOSE_LEVELS (2 = nominal). */
  dose: number;
  /** Contact-layer overlay offset in schematic units along x (0 = perfect). */
  overlay: number;
  /** How many times the gate lithography was reworked. */
  gateReworks: number;
  /** How many times the contact lithography was reworked. */
  contactReworks: number;
}

export const DEFAULT_CHOICES: Choices = {
  clean: true,
  spin: 0.5,
  dose: 2,
  overlay: 0,
  gateReworks: 0,
  contactReworks: 0,
};

/** Discrete exposure-dose settings (relative to the recipe's dose-to-size). */
export const DOSE_LEVELS = [
  { rel: 0.45, label: 'Far under' },
  { rel: 0.7, label: 'Under' },
  { rel: 1.0, label: 'Nominal' },
  { rel: 1.6, label: 'Over' },
  { rel: 2.6, label: 'Far over' },
] as const;

export const OVERLAY_RANGE = 7;

/** Per-die modifiers used when simulating other dies for the wafer map. */
export interface DieContext {
  /** Multiplies the resist thickness (radial coating profile). */
  thicknessMul: number;
  /** Extra overlay (schematic units) from wafer-scale magnification error. */
  overlayExtra: number;
}

export const CENTER_DIE: DieContext = { thicknessMul: 1, overlayExtra: 0 };

export interface Particle {
  id: number;
  /** Position on the wafer in mm (origin at centre, +y towards the notch's opposite side). */
  x: number;
  y: number;
  /** Size in µm (real scale; drawn enlarged). */
  sizeUm: number;
}

export interface Film {
  mat: MatId;
  /** Illustrative thickness in nm, used only for thin-film colour on the wafer view. */
  nm: number;
  label: string;
}

export type ResistPhase = 'coated' | 'baked' | 'exposed' | 'peb' | 'developed';

export interface WaferSummary {
  /** Blanket films across the wafer, bottom → top (substrate excluded). */
  films: Film[];
  resist: null | {
    phase: ResistPhase;
    /** Mean thickness relative to the recipe target. */
    tRel: number;
    /** Relative centre-to-edge thickness increase (0.02 = 2 %). */
    edgeRise: number;
    /** Illustrative nominal thickness in nm (for interference colour). */
    nm: number;
    mask: MaskId | null;
    /** For implant masks the resist is much thicker than for the gate layer. */
    purpose: string;
  };
  /** Reticles used so far, in order (including repeats after rework). */
  masks: MaskId[];
  /** Number of layers patterned into the die (drives die texture detail). */
  pattern: number;
  particles: Particle[];
  particlesBuried: boolean;
  primed: boolean;
  wellsDone: boolean;
  activated: boolean;
  metalLevels: number;
  /** Copper visible at the surface (between Cu CMP and the next film). */
  copperTop: boolean;
  tungstenTop: boolean;
  passivated: boolean;
  probed: boolean;
  diced: boolean;
  packaged: 'none' | 'attached' | 'bonded' | 'molded';
  /** Short present-tense description of the wafer's surface. */
  surface: string;
}

export interface SimState {
  grid: Grid;
  wafer: WaferSummary;
}

/** One logged event (for the recap and the process history list). */
export interface LogEntry {
  op: string;
  label: string;
}
