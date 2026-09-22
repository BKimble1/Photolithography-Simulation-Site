/**
 * Learner-facing content for every step: the three-part microcopy (doing → changes → why),
 * which scene and view to show, animation timing, the experiment control, checks and the
 * "Look closer" drawer. Inline glossary terms use [[termId|text]].
 */

import type { StepId } from '../sim/flow';
import type { SourceId } from './sources';

export type SceneId =
  | 'fab'
  | 'foup'
  | 'inspect'
  | 'wetclean'
  | 'wafer'
  | 'furnace'
  | 'etch'
  | 'cmp'
  | 'implant'
  | 'depo'
  | 'track'
  | 'scanner'
  | 'metrology'
  | 'prober'
  | 'dicing'
  | 'package'
  | 'testbench';

export type ViewLevel = 'fab' | 'tool' | 'wafer' | 'device';

export type ControlId = 'clean' | 'spin' | 'dose' | 'overlay' | 'input' | 'dies';
export type CheckId = 'develop' | 'contact';

export interface StepContent {
  title: string;
  doing: string;
  changes: string;
  why: string;
  scene: SceneId;
  variant?: string;
  view: ViewLevel;
  /** Animation length in seconds at normal speed. */
  duration: number;
  /** How long this really takes in a fab (qualitative). */
  realTime: string;
  /** Progress (0..1) at which each micro-operation is applied; default evenly spaced. */
  at?: number[];
  control?: ControlId;
  check?: CheckId;
  /** Offer a "What changed?" comparison of the cross-section before vs. after this step. */
  compare?: boolean;
  /** An inspection gate that can recommend rework. */
  inspect?: 'gate-adi' | 'contact-adi';
  /** Label shown when lithography is abbreviated in this step. */
  lithoNote?: string;
  closer: { body: string[]; source: SourceId; extra?: SourceId[] };
  /** Scale note for the device view. */
  schematic?: boolean;
}

const litho6 = (from: number, to: number) => {
  const n = 6;
  return Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 1)) / (n + 1));
};

export const STEPS: Record<StepId, StepContent> = {
  // ───────────────────────────── Chapter 1 · Wafer ─────────────────────────────
  arrive: {
    title: 'Meet the wafer',
    doing: 'A sealed pod called a [[foup|FOUP]] docks at a tool with 25 polished silicon [[wafer|wafers]] inside.',
    changes: 'Nothing yet: your wafer is a bare, mirror-smooth disc of single-crystal silicon.',
    why: 'Wafers are grown, sliced and polished by specialist wafer makers; the fab’s work starts here.',
    scene: 'foup',
    variant: 'dock',
    view: 'tool',
    duration: 9,
    realTime: 'Pods move between tools many times a day',
    at: [0.05],
    closer: {
      body: [
        'Before the fab: silicon is grown into a single-crystal ingot (the Czochralski method), sliced into wafers and polished to a mirror finish by wafer makers. A 300 mm wafer is about 775 µm thick.',
        'Inside the fab, wafers travel sealed in FOUPs carried by overhead vehicles. A pod is normally opened only when docked at a tool’s load port, inside a small enclosure of filtered air.',
      ],
      source: 'sumcoProcess',
      extra: ['svmiWafer', 'entegrisFoup'],
    },
  },
  transfer: {
    title: 'Move it by robot',
    doing: 'A robot slides a thin blade under the wafer and carries it into the tool’s clean enclosure.',
    changes: 'A pre-aligner spins the wafer to find its notch, so every tool knows which way it faces.',
    why: 'People shed particles; sealed pods and robot handling help keep the surface clean.',
    scene: 'foup',
    variant: 'robot',
    view: 'tool',
    duration: 10,
    realTime: 'Seconds',
    closer: {
      body: [
        'The equipment front end is a small [[cleanroom|cleanroom]] of its own: fans push filtered air down over the robot so particles are swept away from the wafer.',
        'The notch is a tiny V cut into the wafer edge. Finding it lets every later pattern land in the same orientation.',
      ],
      source: 'entegrisFoup',
      extra: ['foupMinienv'],
    },
  },
  scan: {
    title: 'Scan for particles',
    doing: 'A laser sweeps the surface; any speck scatters light and lands on a defect map.',
    changes: 'Nine [[particle|particles]] show up — far smaller than a hair, but big enough to damage the features to come.',
    why: 'A particle a fraction of a feature’s size can short or break a circuit and ruin a [[die|die]].',
    scene: 'inspect',
    variant: 'scan',
    view: 'wafer',
    duration: 10,
    realTime: 'About a minute per wafer',
    closer: {
      body: [
        'Scattered-light inspection works like dust in a sunbeam: a smooth wafer reflects the laser away, while a particle scatters some of it into a detector.',
        'The dots on the map are drawn enormously enlarged. Real particles here are a fraction of a micrometre; a human hair is roughly 80–100 µm wide.',
      ],
      source: 'nanoGov',
      extra: ['irdsYield'],
    },
  },
  clean: {
    title: 'Clean the surface',
    doing: 'Choose whether to run a wet clean that lifts particles and residues off the surface.',
    changes: 'With the clean, these particles are gone. Skip it and they stay — soon buried under the next films.',
    why: 'Each particle left behind can kill the die it sits on, and you may not find out until test.',
    scene: 'wetclean',
    view: 'tool',
    duration: 11,
    realTime: 'A few minutes',
    control: 'clean',
    at: [0.55],
    closer: {
      body: [
        'The classic RCA sequence uses an ammonia–peroxide bath (SC-1) for particles and organics, a hydrochloric–peroxide bath (SC-2) for metal ions, and often a dilute hydrofluoric-acid dip to strip the thin native oxide.',
        'Many fabs clean one wafer at a time in a spinning chamber with chemical sprays. In this simulation the clean removes every particle; real cleans remove most, not all.',
      ],
      source: 'kernRca',
      extra: ['irdsYield'],
    },
  },
  diemap: {
    title: 'Map the dies',
    doing: 'Lay out a grid of identical dies across the wafer; you will follow the one outlined in violet.',
    changes: 'Nothing physical yet: this is the plan every reticle will print, one exposure field at a time.',
    why: 'Every die gets the same process, so one wafer can yield hundreds of chips at once.',
    scene: 'wafer',
    variant: 'diemap',
    view: 'wafer',
    duration: 8,
    realTime: 'Fixed by the chip design',
    control: 'dies',
    closer: {
      body: [
        'Each die here holds a two-transistor [[inverter|inverter]] and its bond pads. A scanner prints one field of up to 26 mm × 33 mm at a time; here a field holds 2 × 2 dies.',
        'Dies cut by the wafer edge are partial. They are processed anyway, because every field is exposed the same way, but they are not tested here.',
      ],
      source: 'asmlPrinciples',
      extra: ['semianalysisField'],
    },
  },

  // ───────────────────────────── Chapter 2 · Transistors ─────────────────────────────
  padox: {
    title: 'Grow a thin oxide',
    doing: 'In a furnace, oxygen turns the silicon surface into a thin skin of [[oxide|oxide]]; a [[nitride|nitride]] layer goes on top.',
    changes: 'The oxide grows partly into the silicon — about 44% of its thickness comes from silicon consumed — and the wafer’s colour shifts.',
    why: 'The oxide cushions the stiff nitride, which will serve as a hard mask and a polishing stop.',
    scene: 'furnace',
    variant: 'oxidize',
    view: 'tool',
    duration: 11,
    realTime: 'Hours in a furnace',
    at: [0.45, 0.85],
    schematic: true,
    closer: {
      body: [
        'Thermal oxidation converts silicon into silicon dioxide, so the surface moves: roughly 44% of the final oxide thickness lies below the original surface.',
        'Thin transparent films colour a wafer through light interference; the colour depends on thickness and viewing angle. Here it is computed from film thicknesses, not painted on.',
      ],
      source: 'samsungOxidation',
      extra: ['ualbertaOx', 'byuColor'],
    },
  },
  'sti-etch': {
    title: 'Carve isolation trenches',
    doing: 'Pattern the active areas with [[lithography|lithography]], then plasma-[[etch|etch]] trenches through the nitride into the silicon.',
    changes: 'Resist protects the future transistor islands; everywhere else becomes a trench.',
    why: 'Oxide-filled trenches provide [[isolation|isolation]], so neighbouring transistors cannot leak into each other.',
    scene: 'etch',
    variant: 'etch',
    view: 'device',
    duration: 14,
    realTime: 'About an hour including lithography',
    at: [...litho6(0.02, 0.42), 0.72, 0.9, 0.95],
    lithoNote: 'Lithography shown in brief — chapter 3 walks through it in full.',
    compare: true,
    schematic: true,
    closer: {
      body: [
        'This is the first patterned layer. Its alignment marks give later layers a reference to line up with.',
        'The etch attacks only where the developed resist has opened a window. Resist is consumed slowly too, which is why it must be thick enough to last.',
      ],
      source: 'mitSti',
    },
  },
  'sti-fill': {
    title: 'Fill and polish',
    doing: 'Fill the trenches with oxide, polish the wafer flat until the nitride shows, then strip the nitride.',
    changes: 'Oxide now fills the trenches and rises slightly above the silicon islands where transistors will sit.',
    why: 'A flat surface keeps later patterns in focus and every film even.',
    scene: 'cmp',
    view: 'tool',
    duration: 12,
    realTime: 'A few hours',
    at: [0.2, 0.7, 0.9, 0.95],
    compare: true,
    schematic: true,
    closer: {
      body: [
        '[[cmp|CMP]] presses the wafer face-down onto a rotating pad soaked with slurry. Nitride polishes much more slowly than oxide, so polishing effectively stops when the nitride is reached.',
        'Hot phosphoric acid typically removes the nitride and barely etches the oxide.',
      ],
      source: 'mitSti',
    },
  },
  wells: {
    title: 'Dope the wells',
    doing: 'Mask one half with thick resist and [[implant|implant]] phosphorus into the other; then swap sides and implant boron.',
    changes: 'The PMOS side becomes an n-type [[well|well]], the NMOS side a p-type well — invisible changes to the silicon’s [[doping|doping]].',
    why: 'Each transistor type is built in silicon of the opposite type to its source and drain.',
    scene: 'implant',
    view: 'device',
    duration: 15,
    realTime: 'About an hour for both masks',
    at: [...litho6(0.02, 0.2), 0.3, 0.42, ...litho6(0.46, 0.64), 0.75, 0.88, 0.95],
    lithoNote: 'Two masking cycles, shown in brief.',
    compare: true,
    schematic: true,
    closer: {
      body: [
        'An ion implanter ionises the dopant, accelerates it and scans the beam across the wafer. Wherever resist covers the wafer, the ions stop in the resist.',
        'The coloured tints in the cross-section are illustrative: doped silicon looks just like undoped silicon.',
      ],
      source: 'samsungDepo',
    },
  },
  anneal: {
    title: 'Anneal',
    doing: 'Heat the wafer so the implanted atoms settle into the crystal and spread a little deeper.',
    changes: 'The dopants become electrically active and the implant damage heals.',
    why: 'Implanted atoms do little until an [[anneal|anneal]] places them in the crystal lattice.',
    scene: 'furnace',
    variant: 'anneal',
    view: 'device',
    duration: 8,
    realTime: 'Seconds (rapid anneal) to hours (furnace)',
    at: [0.6],
    schematic: true,
    closer: {
      body: [
        'Ions knock silicon atoms out of place as they stop. Heating lets the lattice repair itself and moves dopant atoms onto proper crystal sites, where they can donate or accept electrons.',
        'Heat also lets dopants diffuse, so the wells deepen slightly. Later anneals are kept short to keep sources and drains shallow.',
      ],
      source: 'samsungDepo',
    },
  },
  gatestack: {
    title: 'Build the gate stack',
    doing: 'Strip the pad oxide, grow a very thin gate oxide, then deposit [[polysilicon|polysilicon]] over everything.',
    changes: 'A thin insulator now separates the silicon from a conductive polysilicon film.',
    why: 'This becomes each transistor’s [[gate|gate]]: its voltage, acting through the thin oxide, switches the silicon beneath.',
    scene: 'depo',
    variant: 'poly',
    view: 'tool',
    duration: 11,
    realTime: 'Several hours',
    at: [0.2, 0.5, 0.85, 0.9],
    schematic: true,
    closer: {
      body: [
        'Real front-end flows vary a great deal. Modern logic uses high-k dielectrics and metal gates; older CMOS used polysilicon on silicon dioxide, as here.',
        'The gate oxide is drawn far thicker than it really is so you can see it; real gate oxides are only nanometres thick.',
      ],
      source: 'utVlsi',
      extra: ['imecRoadmap'],
    },
  },

  // ───────────────────────────── Chapter 3 · Pattern ─────────────────────────────
  prime: {
    title: 'Prepare the surface',
    doing: 'In the coater–developer track, bake the wafer dry and prime it with HMDS vapour.',
    changes: 'The surface becomes water-repellent, so the resist will grip it.',
    why: 'Poorly adhering resist lets fine lines lift off during development.',
    scene: 'track',
    variant: 'prime',
    view: 'tool',
    duration: 9,
    realTime: 'About a minute',
    closer: {
      body: [
        'This is the start of one full lithography cycle for the gate layer. Every patterned layer goes through a similar loop: prime, coat, bake, align, expose, bake, develop, inspect, etch or implant, strip.',
        'Lithography areas are lit yellow: resists react to ultraviolet and blue light below about 500 nm.',
      ],
      source: 'mcAdhesion',
      extra: ['mcYellow'],
    },
  },
  coat: {
    title: 'Coat the wafer',
    doing: 'Spin a thin, even layer of light-sensitive [[resist|resist]] across the surface.',
    changes: 'A puddle of resist flings outward and thins as it spins; faster spinning leaves a thinner film.',
    why: 'Too thick and the bottom may not clear; too thin and it can wear through during the etch.',
    scene: 'track',
    variant: 'coat',
    view: 'tool',
    duration: 12,
    realTime: 'About a minute',
    control: 'spin',
    at: [0.72],
    closer: {
      body: [
        'Film thickness falls roughly with one over the square root of spin speed. Slow spins leave a thicker, less even film, with a bead at the rim that a solvent jet trims off (edge-bead removal).',
        'The colours you see are thin-film interference, computed from the film thickness: where the thickness changes, so does the colour, which is why uneven coats look banded.',
        'This slider is a qualitative model, not a calibrated coater recipe.',
      ],
      source: 'mcSpin',
    },
  },
  softbake: {
    title: 'Soft bake',
    doing: 'Warm the wafer on a hot plate to drive most of the solvent out of the resist.',
    changes: 'The film densifies and shrinks slightly.',
    why: 'A drier, stable film exposes and develops predictably.',
    scene: 'track',
    variant: 'bake',
    view: 'tool',
    duration: 8,
    realTime: 'About a minute',
    at: [0.6],
    closer: {
      body: ['A chill plate brings the wafer back to a precise temperature before exposure, because resist chemistry is temperature-sensitive.'],
      source: 'mcSoftbake',
    },
  },
  reticle: {
    title: 'Load the reticle',
    doing: 'Fetch the gate-layer [[reticle|reticle]]: a quartz plate carrying the pattern in chrome, four times larger than it will print.',
    changes: 'Nothing on the wafer yet; the reticle is this layer’s master stencil.',
    why: 'Clear quartz lets light through; chrome blocks it. Here the gate lines are chrome, so resist will survive where the gates go.',
    scene: 'scanner',
    variant: 'reticle',
    view: 'tool',
    duration: 9,
    realTime: 'Minutes',
    closer: {
      body: [
        'The projection optics shrink the reticle image 4×, so a reticle feature is four times larger than its printed copy. The same reticle prints every field of this layer, wafer after wafer.',
        'A thin transparent membrane (a pellicle) holds any dust far enough from the chrome that it stays out of focus.',
      ],
      source: 'asmlPrinciples',
      extra: ['halbleiterMasks'],
    },
  },
  align: {
    title: 'Align to the layer below',
    doing: 'The [[scanner|scanner]] measures [[alignment|alignment]] marks left by the isolation layer, then corrects its stages.',
    changes: 'The gate pattern will now land squarely on the silicon islands already on the wafer.',
    why: 'Each layer must sit on the last within a small fraction of a feature. That accuracy is called [[overlay|overlay]].',
    scene: 'scanner',
    variant: 'align',
    view: 'tool',
    duration: 9,
    realTime: 'Seconds per wafer',
    closer: {
      body: [
        'Alignment happens inside the scanner before exposure. Overlay — how well the result lines up — is measured afterwards on a metrology tool.',
        'In chapter 4 you will set a contact-layer misalignment yourself and see what it does.',
      ],
      source: 'asmlAlignStory',
      extra: ['semieOverlay'],
    },
  },
  expose: {
    title: 'Expose',
    doing: 'Sweep a slit of 193 nm deep-UV light through the reticle onto the wafer, one field at a time.',
    changes: '[[exposure|Exposure]] creates acid in the lit resist: a hidden [[latent|latent image]]. Nothing is carved yet.',
    why: 'The [[dose|dose]] sets where the edges land: too little and resist will not clear; too much and lines shrink.',
    scene: 'scanner',
    variant: 'expose',
    view: 'tool',
    duration: 14,
    realTime: 'Under a minute per wafer',
    control: 'dose',
    at: [0.8],
    closer: {
      body: [
        'Step and scan: the reticle and wafer move in sync in opposite directions while a narrow slit of light sweeps the field; then the wafer steps to the next field. The lens reduces the image 4×.',
        'Deep-UV light is invisible. The violet beam is an optional overlay you can switch on to follow the light path; there is no glowing ray in the real tool.',
        'This baseline uses 193 nm argon-fluoride (ArF) light and lens-based optics. EUV (13.5 nm) needs mirrors, reflective masks and vacuum instead — see “DUV vs EUV”.',
      ],
      source: 'asmlLight',
      extra: ['asmlLenses', 'asmlRayleigh', 'spieCd', 'scanPatent'],
    },
  },
  peb: {
    title: 'Post-exposure bake',
    doing: 'Bake again so the light-made acid can switch the exposed resist to a soluble form.',
    changes: 'The latent image becomes a sharp chemical difference the developer can read.',
    why: 'Deep-UV resists are chemically amplified: the [[peb|post-exposure bake]] does most of the chemistry.',
    scene: 'track',
    variant: 'bake',
    view: 'device',
    duration: 8,
    realTime: 'About a minute',
    at: [0.55],
    schematic: true,
    closer: {
      body: [
        'Exposure releases acid; during the bake, each acid molecule catalyses many reactions, which is where “chemically amplified” comes from. The acid also diffuses a little, slightly softening the image.',
      ],
      source: 'mcPeb',
      extra: ['shiCar'],
    },
  },
  develop: {
    title: 'Develop',
    doing: 'Flood the wafer with alkaline developer, then rinse and spin it dry.',
    changes: 'Positive resist: the exposed areas dissolve and the unexposed lines stay.',
    why: 'Now the pattern is physical: openings where the etch may act, resist where it must not.',
    scene: 'track',
    variant: 'develop',
    view: 'device',
    duration: 10,
    realTime: 'About a minute',
    check: 'develop',
    compare: true,
    at: [0.55],
    schematic: true,
    closer: {
      body: [
        'To [[develop|develop]] a positive resist, a metal-ion-free alkaline solution (typically 2.38% TMAH) dissolves the exposed, deprotected resist. A negative resist does the opposite.',
        'The resist lines here have sloped sides where the light fades gradually at the pattern edge.',
      ],
      source: 'samsungLitho',
      extra: ['mcDevelop', 'mcMif'],
    },
  },
  adi: {
    title: 'Inspect the pattern',
    doing: 'Measure the resist lines with a scanning electron microscope before anything permanent happens.',
    changes: 'Nothing changes — unless the pattern is out of spec, in which case it can be reworked.',
    why: 'Until the etch, lithography can be undone: strip, recoat, expose again. That is a [[rework|rework]].',
    scene: 'metrology',
    view: 'tool',
    duration: 9,
    realTime: 'Minutes, on sampled wafers',
    inspect: 'gate-adi',
    closer: {
      body: [
        'A CD-SEM measures the [[cd|critical dimension]] — here the width of the gate line — from above. Overlay tools measure layer-to-layer alignment on dedicated targets.',
        'After-develop inspection is the last cheap chance to fix a bad exposure. Once the pattern is etched, a mistake is permanent.',
      ],
      source: 'semieOverlay',
      extra: ['asmlYieldStar'],
    },
  },
  'gate-etch': {
    title: 'Etch the gate',
    doing: 'A plasma etches polysilicon wherever the resist is open, and stops on the thin gate oxide.',
    changes: 'Resist lines become polysilicon gate lines; the resist itself wears thinner.',
    why: 'This is the moment the pattern becomes permanent in the device.',
    scene: 'etch',
    variant: 'etch',
    view: 'tool',
    duration: 11,
    realTime: 'About a minute',
    at: [0.75],
    compare: true,
    closer: {
      body: [
        'This plasma etch uses ions accelerated toward the wafer, so it cuts almost straight down. [[selectivity|Selectivity]] matters twice: the etch must remove polysilicon faster than the resist mask, and far faster than the gate oxide it should stop on.',
      ],
      source: 'samsungEtch',
      extra: ['mcDryEtch'],
    },
  },
  strip: {
    title: 'Strip the resist',
    doing: 'Remove the leftover resist with an oxygen plasma and a wet clean.',
    changes: 'Only the polysilicon gates remain, crossing the silicon islands.',
    why: 'Resist is a temporary stencil. Every patterned layer repeats this cycle with its own reticle.',
    scene: 'etch',
    variant: 'ash',
    view: 'device',
    duration: 8,
    realTime: 'Minutes',
    at: [0.6, 0.9],
    schematic: true,
    closer: {
      body: [
        'To [[strip|strip]] resist, an oxygen plasma usually “ashes” it into carbon dioxide and water vapour; a wet clean then removes any remaining residue.',
      ],
      source: 'mcRemoval',
    },
  },

  // ───────────────────────────── Chapter 4 · Connect ─────────────────────────────
  sd: {
    title: 'Repeat: sources and drains',
    doing: 'Two more mask-and-implant cycles dope the [[sourcedrain|sources and drains]]: arsenic for NMOS, boron for PMOS.',
    changes: 'The gates block the ions, so the channels get none and each source and drain lines up with its gate.',
    why: 'This is [[selfaligned|self-alignment]], and it is why the gates are patterned first.',
    scene: 'implant',
    view: 'device',
    duration: 15,
    realTime: 'A few hours for both cycles',
    at: [...litho6(0.02, 0.2), 0.3, 0.42, ...litho6(0.46, 0.64), 0.74, 0.84, 0.9, 0.95],
    lithoNote: 'Masks 5 and 6, shown in brief.',
    compare: true,
    schematic: true,
    closer: {
      body: [
        'The n+ and p+ regions are heavily doped, so they conduct well. A short activation anneal follows.',
        'Real flows also add sidewall spacers and lightly doped extensions next to the gate. They are left out here for clarity.',
      ],
      source: 'utVlsi',
      extra: ['samsungDepo'],
    },
  },
  pmd: {
    title: 'Insulate the transistors',
    doing: 'Blanket the transistors with a thick [[dielectric|dielectric]] and polish it flat.',
    changes: 'An insulating layer now buries the gates.',
    why: 'Wires will run on top. They must touch the transistors only where you choose.',
    scene: 'depo',
    variant: 'oxide',
    view: 'tool',
    duration: 10,
    realTime: 'A few hours',
    at: [0.5, 0.85, 0.9],
    closer: {
      body: ['Chemical vapour deposition builds the oxide from gases that react on the hot wafer. CMP then removes the bumps left by the gates.'],
      source: 'samsungDepo',
    },
  },
  'contact-align': {
    title: 'Align the contacts',
    doing: 'Coat resist and set how well the contact reticle lines up with the gates below.',
    changes: 'The preview shows where each [[contact|contact]] hole would land.',
    why: 'Designers leave a [[margin|margin]] around each contact. Drift past it and a contact can touch a gate.',
    scene: 'scanner',
    variant: 'align',
    view: 'device',
    duration: 9,
    realTime: 'Seconds per wafer',
    control: 'overlay',
    check: 'contact',
    at: [0.2, 0.45, 0.6],
    schematic: true,
    closer: {
      body: [
        'Overlay error can come from stage and lens imperfections, wafer distortion and heating. In this simulation it grows slightly toward the wafer edge, as a small scaling error would.',
        'Layout rules keep a gap between each contact and the gate so that normal misalignment cannot short them.',
      ],
      source: 'semieOverlay',
      extra: ['mosisRules'],
    },
  },
  'contact-print': {
    title: 'Print the contacts',
    doing: 'Expose and develop the contact holes, then measure overlay.',
    changes: 'Openings appear in the resist over each source, drain and the gate strap.',
    why: 'If overlay is out of spec, rework now: after the etch it is too late.',
    scene: 'scanner',
    variant: 'expose',
    view: 'device',
    duration: 11,
    realTime: 'About an hour with inspection',
    inspect: 'contact-adi',
    at: [0.35, 0.5, 0.7, 0.9],
    schematic: true,
    closer: {
      body: ['Small openings let through less light, so this reticle draws the contact holes slightly larger than their target size.'],
      source: 'semieOverlay',
    },
  },
  'contact-etch': {
    title: 'Etch the contact holes',
    doing: 'Etch straight down through the oxide, stopping on silicon and polysilicon.',
    changes: 'Narrow holes now reach each source, drain and the gate strap.',
    why: 'Contacts are the [[mol|middle-of-line]] bridge between the transistors and the wiring above.',
    scene: 'etch',
    variant: 'etch',
    view: 'device',
    duration: 10,
    realTime: 'Minutes',
    at: [0.7, 0.9, 0.95],
    compare: true,
    schematic: true,
    closer: {
      body: ['Chipmakers split the flow into the front end (transistors), middle of line (contacts) and back end (stacked wiring).'],
      source: 'imecRoadmap',
    },
  },
  'contact-fill': {
    title: 'Fill with tungsten',
    doing: 'Deposit tungsten to fill the holes, then polish off everything above the oxide.',
    changes: 'Tungsten plugs stand in the oxide, each touching one terminal.',
    why: 'Polishing leaves metal only where there were holes. The same idea builds the copper wiring.',
    scene: 'cmp',
    view: 'device',
    duration: 10,
    realTime: 'A few hours',
    at: [0.35, 0.75, 0.9],
    compare: true,
    schematic: true,
    closer: {
      body: ['Tungsten fills narrow holes well from the gas phase. Some advanced processes now use cobalt or other metals for contacts.'],
      source: 'samsungMetal',
      extra: ['semieMol'],
    },
  },
  metal1: {
    title: 'Lay the first wires',
    doing: 'Etch trenches into a new insulating layer, fill them with copper and polish flat.',
    changes: 'Copper lines join the two drains (the output) and bring ground and power to the sources.',
    why: 'This first [[interconnect|interconnect]] level turns two separate transistors into one circuit.',
    scene: 'cmp',
    view: 'device',
    duration: 13,
    realTime: 'About a day for a full level',
    at: [0.08, ...litho6(0.1, 0.4), 0.5, 0.55, 0.7, 0.85, 0.9, 0.95],
    lithoNote: 'Mask 8, shown in brief.',
    compare: true,
    schematic: true,
    closer: {
      body: [
        'Copper is hard to etch, so it is inlaid instead ([[damascene|damascene]]): etch grooves into the insulator, overfill with copper by electroplating, then polish the excess away.',
      ],
      source: 'imecDamascene',
      extra: ['samsungMetal'],
    },
  },
  metal2: {
    title: 'Add vias and a second level',
    doing: 'Repeat: etch [[via|vias]] and trenches into more insulator, fill with copper, polish.',
    changes: 'Vias link metal 1 up to metal 2, which carries power, ground, input and output toward the pads.',
    why: 'Real chips stack many more wiring levels, the [[beol|back end of line]], each its own litho–etch–fill–polish loop.',
    scene: 'cmp',
    view: 'device',
    duration: 13,
    realTime: 'Days',
    at: [0.06, ...litho6(0.08, 0.3), 0.36, 0.4, ...litho6(0.42, 0.62), 0.68, 0.72, 0.84, 0.9, 0.95],
    lithoNote: 'Masks 9 and 10, shown in brief.',
    schematic: true,
    closer: {
      body: ['Metal 1 and metal 2 are drawn in the same copper colour; the thin cap between them is an etch stop and a barrier that keeps copper from wandering into the insulator.'],
      source: 'imecRoadmap',
      extra: ['imecDamascene', 'samsungMetal'],
    },
  },
  passivate: {
    title: 'Seal the surface',
    doing: 'Cover the chip with a tough [[passivation|passivation]] layer, leaving openings over the bond pads.',
    changes: 'The circuit is sealed against moisture and scratches.',
    why: 'Only the pads stay exposed, so probe needles and bond wires can reach them.',
    scene: 'depo',
    variant: 'pass',
    view: 'tool',
    duration: 9,
    realTime: 'Hours',
    at: [0.6, 0.9],
    closer: {
      body: ['The bond pads sit at the edge of the die, outside the magnified cell shown in the device view.'],
      source: 'samsungMetal',
    },
  },

  // ───────────────────────────── Chapter 5 · Test ─────────────────────────────
  inspect: {
    title: 'Inspect the wafer',
    doing: 'Scan the finished wafer for defects and review what inspection and metrology found.',
    changes: 'Nothing changes; you get a defect map and an overlay summary.',
    why: 'Inspection catches problems before costly testing and packaging, and points engineers to the cause.',
    scene: 'inspect',
    variant: 'review',
    view: 'wafer',
    duration: 9,
    realTime: 'Minutes per wafer',
    closer: {
      body: ['Fabs inspect wafers after many steps, not just at the end, and review a sample of defects with an electron microscope to classify them.'],
      source: 'irdsYield',
    },
  },
  probe: {
    title: 'Probe every die',
    doing: 'A probe card touches each die’s pads and runs the inverter test: input low, input high, idle current.',
    changes: 'Each complete die is marked pass or fail on the wafer map.',
    why: 'Only known-good dies go on to packaging. The pass rate is the [[yield|yield]].',
    scene: 'prober',
    view: 'tool',
    duration: 14,
    realTime: 'Minutes to hours per wafer',
    closer: {
      body: [
        'Each die gets the same three checks here: output high when the input is low, output low when the input is high, and a small idle current ([[iddq|IDDQ]]).',
        'The yield in this simulation is a toy number from a simple model. It does not predict real fabs.',
      ],
      source: 'samsungEds',
    },
  },
  dice: {
    title: 'Cut the dies apart',
    doing: 'Mount the wafer on tape in a frame and saw along the scribe streets between the dies.',
    changes: 'The wafer becomes separate dies, still held in place on the tape.',
    why: 'Simplified: real flows usually thin the wafer from the back first. [[dicing|Dicing]] can use a blade or a laser.',
    scene: 'dicing',
    view: 'tool',
    duration: 11,
    realTime: 'Minutes per wafer',
    closer: {
      body: ['Some flows reverse the order and cut partway before grinding the wafer thin (“dicing before grinding”).'],
      source: 'discoDbg',
      extra: ['samsungPackaging'],
    },
  },
  attach: {
    title: 'Attach the die',
    doing: 'Pick a known-good die off the tape and bond it to a package base.',
    changes: 'Your die now sits on a carrier with leads to the outside world.',
    why: '[[dieattach|Die attach]] gives the tiny die a path for heat and a sturdy mechanical home.',
    scene: 'package',
    variant: 'attach',
    view: 'tool',
    duration: 9,
    realTime: 'Seconds per die',
    closer: {
      body: ['Many modern packages use solder bumps (flip-chip) instead of wires; wire bonding is shown here because it is easy to see.'],
      source: 'samsungPackaging',
      extra: ['amkorServices'],
    },
  },
  bond: {
    title: 'Wire and seal',
    doing: 'Fine gold [[wirebond|wires]] link the die’s pads to the package leads; then the part is moulded in epoxy.',
    changes: 'The chip is enclosed, with only its leads showing.',
    why: 'Packaging protects the die and makes it usable on a circuit board.',
    scene: 'package',
    variant: 'bond',
    view: 'tool',
    duration: 12,
    realTime: 'Sub-second per wire',
    at: [0.5, 0.9],
    closer: {
      body: ['Simplified sequence: packaged parts are tested again (final test) before they ship.'],
      source: 'samsungPackaging',
      extra: ['amkorTest'],
    },
  },
  final: {
    title: 'Flip the input',
    doing: 'Toggle the input and watch the output — and the transistors you built — respond.',
    changes: 'Input low: the PMOS conducts and pulls the output high. Input high: the NMOS pulls it low.',
    why: 'That is a working logic gate, a basic building block of digital chips.',
    scene: 'testbench',
    view: 'device',
    duration: 6,
    realTime: 'Up to billions of times a second in a real chip',
    control: 'input',
    closer: {
      body: [
        'In a CMOS inverter one transistor is always off while the input is steady, so almost no current flows except while switching. That is why CMOS logic is so power-efficient.',
      ],
      source: 'mitInverter',
      extra: ['hmcCmos'],
    },
  },
};
