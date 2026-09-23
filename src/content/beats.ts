/**
 * Beats: the short caption shown beside the animation, one idea at a time, timed to the
 * step's progress. Each beat starts shortly before the change it describes (the `at` times in
 * content/steps.ts), so the words and the action coincide. 12–24 words each; details stay in
 * the step panel and the "Look closer" drawer.
 *
 * A caption may depend on the run (a skipped clean, a failed inverter): it is then a function
 * of the run context. Watch always plays the canonical successful run.
 *
 * Labels are optional and restrained: at most one or two, anchored to the learner's wafer or to
 * a point in the machine's own frame.
 */
import type { StepId } from '../sim/flow';
import type { Choices } from '../sim/types';

export interface RunContext {
  choices: Choices;
  /** Does this run's inverter work at the end? */
  pass: boolean;
}

export type LabelAnchor = { kind: 'wafer'; lift?: number } | { kind: 'tool'; at: [number, number, number] };

export interface BeatLabel {
  text: string;
  anchor: LabelAnchor;
}

export interface Beat {
  /** Step progress (0..1) at which this caption appears. */
  p: number;
  text: string | ((run: RunContext) => string);
  labels?: BeatLabel[];
}

const onWafer = (text: string, lift = 0.03): BeatLabel => ({ text, anchor: { kind: 'wafer', lift } });

export const BEATS: Record<StepId, Beat[]> = {
  // ───────────────────────────── 1 · Wafer ─────────────────────────────
  arrive: [
    { p: 0, text: 'The pod locks onto the load port. Its door will open inside the tool, never into the room.' },
    { p: 0.5, text: 'Twenty-five wafers stand in slots inside. Yours is bare, polished silicon, 300 millimetres across, with nothing built on it.' },
  ],
  transfer: [
    { p: 0, text: 'The pod door swings open. The robot’s blade reaches in beneath your wafer and lifts it clear.' },
    { p: 0.45, text: 'On the pre-aligner the wafer turns until a sensor finds the small notch cut into its edge.', labels: [onWafer('Notch sets the orientation')] },
  ],
  scan: [
    { p: 0, text: 'A laser sweeps across the surface. Any speck of dust scatters light back to a detector.' },
    { p: 0.5, text: 'Each flash of scattered light becomes a dot on the defect map, marking where a particle sits.' },
  ],
  clean: [
    {
      p: 0,
      text: ({ choices }) =>
        choices.clean
          ? 'Cleaning chemicals and rinse water spray onto the spinning wafer to lift off particles and residues.'
          : 'You chose to skip the clean, so the wafer passes through this station untouched.',
    },
    {
      p: 0.55,
      text: ({ choices }) =>
        choices.clean
          ? 'The particles are gone. Anything left behind now would be buried under the films to come.'
          : 'The particles stay. Soon they will be buried under the next films, where each one can kill a die.',
    },
  ],
  diemap: [
    { p: 0, text: 'Lines mark out the die grid on the wafer. The outlined die is the one this journey follows.' },
    { p: 0.5, text: 'Dies at the rim are cut off by the wafer’s edge. They are processed too, but never tested.' },
  ],

  // ───────────────────────────── 2 · Transistors ─────────────────────────────
  padox: [
    { p: 0, text: 'The boat of wafers rises into the hot quartz tube, where oxygen reacts with the silicon surface.' },
    { p: 0.35, text: 'The top of the silicon turns into a thin skin of oxide. It grows partly down into the wafer.' },
    { p: 0.75, text: 'Then silicon nitride is deposited over the oxide, from reactive gases fed into the same furnace.' },
  ],
  'sti-etch': [
    { p: 0, text: 'First, lithography: resist is coated, exposed and developed to mark where the transistor islands will be.' },
    { p: 0.45, text: 'Then the plasma etch cuts through the nitride and deep into the silicon wherever the resist is open.' },
    { p: 0.86, text: 'The resist is stripped. Trenches now separate the islands, ready to be filled with insulating oxide.' },
  ],
  'sti-fill': [
    { p: 0, text: 'Oxide is deposited over the whole wafer, filling the trenches to the brim and beyond.' },
    { p: 0.45, text: 'The polisher grinds the surface flat with a rotating pad and slurry, stopping when it reaches the nitride.' },
    { p: 0.86, text: 'A wet etch removes the nitride, leaving silicon islands surrounded by oxide-filled trenches.' },
  ],
  wells: [
    { p: 0, text: 'Thick resist covers the NMOS half. The implanter fires phosphorus ions into the uncovered PMOS side.' },
    { p: 0.44, text: 'Then the masks swap: boron ions go into the NMOS side, while resist shields the new n-type well.' },
    { p: 0.86, text: 'Two wells now sit side by side, n-type and p-type. The change is invisible, but electrical.' },
  ],
  anneal: [
    { p: 0, text: 'The furnace heats the wafers again, this time with no new layer grown or deposited.' },
    { p: 0.6, text: 'The dopants are now electrically active, and the damage the ions did to the crystal has healed.' },
  ],
  gatestack: [
    { p: 0, text: 'The old pad oxide is stripped away to expose clean silicon for the most important layer.' },
    { p: 0.35, text: 'A very thin gate oxide grows: the insulator that every transistor’s gate will switch through.' },
    { p: 0.7, text: 'Polysilicon is deposited over the whole wafer. Once patterned, it will become the transistors’ gates.' },
  ],

  // ───────────────────────────── 3 · Patterning ─────────────────────────────
  prime: [
    { p: 0, text: 'The lithography cycle begins in the track. First the wafer is baked dry on a hot plate.' },
    { p: 0.4, text: 'HMDS vapour primes the surface, making it water-repellent so that the resist will grip.' },
  ],
  coat: [
    { p: 0, text: 'A nozzle dispenses a puddle of liquid resist onto the centre of the slowly turning wafer.', labels: [onWafer('Photoresist')] },
    { p: 0.3, text: 'The wafer spins up to speed. Resist races outward across the surface, and the excess flies off the edge.' },
    { p: 0.72, text: 'A fine solvent jet trims the rim. The wafer now carries a light-sensitive film, ready for exposure.' },
  ],
  softbake: [
    { p: 0, text: 'On a hot plate, most of the solvent evaporates out of the freshly coated resist.' },
    { p: 0.55, text: 'As the solvent leaves, the film settles into a firmer, slightly thinner layer that exposes consistently.' },
  ],
  reticle: [
    { p: 0, text: 'A robot lifts the reticle from its pod and carries it to the stage above the projection lens.' },
    { p: 0.55, text: 'The reticle is four times larger than the pattern it prints. Its chrome lines will cast the gates’ shadows.' },
  ],
  align: [
    { p: 0, text: 'Before exposing, the scanner measures alignment marks that the isolation layer left on the wafer.' },
    { p: 0.5, text: 'Tiny corrections to the stages line the gate pattern up with the islands printed before.' },
  ],
  expose: [
    { p: 0, text: 'Deep-UV light at 193 nanometres shines through the reticle, and the lens shrinks the pattern four times.' },
    { p: 0.4, text: 'The scanner steps from field to field, sweeping a narrow slit of light across each one.' },
    { p: 0.8, text: 'The lit resist now carries acid in the pattern’s shape: an invisible image, not yet carved.', labels: [onWafer('Latent image (invisible)')] },
  ],
  peb: [
    { p: 0, text: 'Back in the track, a hot plate warms the wafer while the acid does its work in the resist.' },
    { p: 0.55, text: 'Where light struck, the resist has become soluble; where the chrome cast its shadow, it is unchanged.' },
  ],
  develop: [
    { p: 0, text: 'Alkaline developer floods the wafer. This is a positive resist: watch what happens to the exposed areas.' },
    { p: 0.5, text: 'Watch the exposed areas wash away. Only the resist that stayed in shadow remains on the wafer.' },
    { p: 0.8, text: 'A rinse and a fast spin dry the wafer, leaving resist lines where the gates will be.' },
  ],
  adi: [
    { p: 0, text: 'A scanning electron microscope measures the width of the resist lines before anything permanent happens.' },
    { p: 0.5, text: 'If a line is out of specification, the resist can still be stripped and the cycle done again.' },
  ],
  'gate-etch': [
    { p: 0, text: 'In the etch chamber, a plasma of reactive gas forms above the wafer.' },
    { p: 0.4, text: 'Ions strike straight down, carving through the polysilicon in the open areas and stopping on the thin oxide.' },
    { p: 0.75, text: 'The resist lines have become polysilicon gate lines. From here on, the pattern is permanent.' },
  ],
  strip: [
    { p: 0, text: 'An oxygen plasma burns off the leftover resist, then a wet clean removes the residue.' },
    { p: 0.6, text: 'What remains are the gates, lying across the silicon islands. One full lithography cycle is done.' },
  ],

  // ───────────────────────────── 4 · Connecting ─────────────────────────────
  sd: [
    { p: 0, text: 'Two more mask-and-implant cycles follow. First, arsenic ions dope the NMOS sources and drains.' },
    { p: 0.45, text: 'Then boron for the PMOS side. Each gate shields its own channel, so the doping lines up with it.' },
    { p: 0.88, text: 'A quick anneal activates the dopants. Both kinds of transistor are now complete.' },
  ],
  pmd: [
    { p: 0, text: 'A thick blanket of insulating oxide is deposited, burying the transistors and their gates.' },
    { p: 0.7, text: 'Polishing leaves it perfectly flat: a level floor for all the wiring still to come.' },
  ],
  'contact-align': [
    { p: 0, text: 'A fresh coat of resist goes on, and the contact reticle is lined up with the gates beneath it.' },
    { p: 0.5, text: 'Your overlay setting shifts the whole contact pattern. The margin is the room it has before trouble starts.' },
  ],
  'contact-print': [
    { p: 0, text: 'The contact pattern is exposed and baked, then developed into small openings in the resist.' },
    { p: 0.72, text: 'Holes are now open where the contacts will go. Overlay is measured before anything is etched.' },
  ],
  'contact-etch': [
    { p: 0, text: 'The plasma cuts deep, narrow holes into the oxide, heading for the transistors below.' },
    { p: 0.72, text: 'With the resist stripped away, the holes stand open, waiting to be filled with metal.' },
  ],
  'contact-fill': [
    { p: 0, text: 'Tungsten is deposited over the whole wafer, filling every contact hole and coating the top.' },
    { p: 0.6, text: 'Polishing removes all the tungsten above the oxide, leaving a metal plug in each hole.' },
  ],
  metal1: [
    { p: 0, text: 'A new insulating layer goes down, and lithography marks where the first wires will run.' },
    { p: 0.45, text: 'Trenches are etched into the insulator. Then copper is deposited over everything, filling them.' },
    { p: 0.8, text: 'Polishing leaves copper only in the trenches: wires that join the drains and bring power and ground.' },
  ],
  metal2: [
    { p: 0, text: 'The loop repeats: via holes are patterned and etched down to the first copper wires.' },
    { p: 0.42, text: 'Then trenches for a second wiring level. Copper fills the vias and the trenches at once.' },
    { p: 0.88, text: 'After polishing, two levels of copper wiring link the inverter to the pads at its edge.' },
  ],
  passivate: [
    { p: 0, text: 'A tough passivation layer seals the whole chip against moisture and scratches.' },
    { p: 0.6, text: 'Windows are left open over the pads: the only places the outside world will touch.' },
  ],

  // ───────────────────────────── 5 · Testing ─────────────────────────────
  inspect: [
    { p: 0, text: 'The finished wafer is scanned once more, and the results of every inspection are reviewed together.' },
    { p: 0.5, text: 'The defect map and overlay summary point engineers to problems before costly testing and packaging.' },
  ],
  probe: [
    { p: 0, text: 'The probe card’s needles land on your die’s pads, and the tester puts the inverter through its paces.' },
    { p: 0.5, text: 'Die by die, each result lands on the wafer map. Failed dies are marked and never packaged.' },
  ],
  dice: [
    { p: 0, text: 'The wafer is mounted on tape in a frame, and a thin blade saws along the scribe streets.' },
    { p: 0.55, text: 'The cuts run through the full wafer, but the tape keeps every die in its place.' },
  ],
  attach: [
    { p: 0, text: 'A known-good die is picked off the tape and bonded to a package base.' },
    { p: 0.5, text: 'Held in its package, the die can shed heat and reach a circuit board through the leads.' },
  ],
  bond: [
    { p: 0, text: 'Fine gold wires link each pad on the die to a package lead, one wire at a time.' },
    { p: 0.75, text: 'Epoxy is moulded over the die and its wires. Only the metal leads stay outside, ready for final test.' },
  ],
  final: [
    {
      p: 0,
      text: ({ pass }) =>
        pass ? 'Try the switch. With the input low, the PMOS transistor turns on and the output rises high.' : 'Flip the input and watch the output. This inverter does not switch as it should; the recap shows why.',
    },
    {
      p: 0.5,
      text: ({ pass }) =>
        pass ? 'Set the input high and the NMOS takes over, pulling the output down: a working inverter.' : 'Every step you took shaped this result. Go back to any step, change a setting and build it again.',
    },
  ],
};

/** Index of the beat on screen at progress p. */
export function beatIndexAt(id: StepId, p: number): number {
  const list = BEATS[id];
  let i = 0;
  for (let k = 0; k < list.length; k++) if (p >= list[k].p) i = k;
  return i;
}

/** The beat on screen at progress p. */
export function beatAt(id: StepId, p: number): Beat | null {
  return BEATS[id][beatIndexAt(id, p)] ?? null;
}

export function beatText(b: Beat, run: RunContext): string {
  return typeof b.text === 'function' ? b.text(run) : b.text;
}
