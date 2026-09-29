# FAB / ONE — implementation notes

How the app is put together: the state model, how each journey step maps onto it, and how
the views read from it. For what is physically right and what is simplified, see
[`ACCURACY.md`](ACCURACY.md). The plan written before building is in
[`docs/PLAN.md`](docs/PLAN.md); what changed in round two, and how it was checked, is in
[`docs/ROUND2.md`](docs/ROUND2.md).

## Architecture in one picture

```
 learner choices (clean, spin, dose, overlay, reworks)          src/state/store.ts
        │
        ▼
 buildPlan(choices, die) ──► 125 micro-operations, each plain JSON  src/sim/flow.ts, history.ts
        │                    + a rolling hash per prefix
        ▼
 Replayer.stateAt(plan, n) ──► SimState { grid, wafer summary }     src/sim/history.ts, ops.ts
        │  (LRU checkpoints at step boundaries; replay forward from the nearest one)
        │
        ├──► 3D device cutaway (mesher)                             src/three/device/
        ├──► wafer view (thin-film colour, fields, dies, particles) src/three/wafer/, WaferScene.tsx
        ├──► tool scenes (film colour + step progress)              src/three/tools/
        ├──► layer inset, 2D cross-section, "What changed?"         src/ui/
        ├──► metrology (CD, residue, overlay)                        src/sim/metrology.ts
        ├──► electrical test (connectivity → truth table)           src/sim/electrical.ts
        ├──► diagnosis (cause + restore path)                        src/sim/diagnose.ts
        └──► wafer map (one run per die bucket, in a Web Worker)     src/sim/waferMap*.ts
```

`src/sim` is plain TypeScript: no React, no Three.js, no DOM. It runs the same in the
browser, in the wafer-map Web Worker and in Vitest.

## The state model

### Die grid (`src/sim/grid.ts`)

The inverter cell is a 192 × 64 grid of columns (0.5 × 1 grid unit each, 96 × 64 gu in
total). Each column is a bottom-to-top stack of up to 16 segments, stored in typed arrays:

| array | meaning |
|---|---|
| `n[c]` | number of segments in column `c` |
| `mat[c·K+k]` | material id (Si, oxide, nitride, poly, resist, W, Cu, ILD, cap, passivation) |
| `tag[c·K+k]` | per-material state: doping for Si (p-sub, p-well, n-well, n+, p+), resist state (coated, baked, exposed, post-exposure-baked, developed), oxide or dielectric kind |
| `top[c·K+k]` | height of the segment's top (its bottom is the previous top, or `zBase`) |
| `dose[c]` | absorbed dose in the top resist of that column: the latent image |

Grid units (gu) are schematic. Relative relationships (what covers what, what is thicker,
what lines up with what) are kept; absolute sizes are not to scale.

### Wafer summary (`src/sim/types.ts`)

Next to the grid, a small record holds wafer-scale facts: blanket films with thickness in
nm (for thin-film interference colour), the resist state and purpose, masks used, particles
and whether they are buried, well/activation flags, metal levels, passivation, probe, dicing
and packaging state, and the surface description shown in the wafer view.

### Choices (`src/sim/types.ts`)

```ts
{ clean: boolean, spin: 0..1, dose: 0..4, overlay: -7..7, gateReworks: n, contactReworks: n }
```

Defaults are a good recipe that yields a working inverter. The store persists choices,
the current step and knowledge-check answers in `localStorage` (`fab-one:v1`).

### Operations (`src/sim/ops.ts`)

Every process action is an `Op` (plain data, so it can be hashed and compared) applied by
`applyOp(state, op)`:

| op | what it does to the grid |
|---|---|
| `oxidize` | grows oxide on exposed Si/poly; consumes 0.44 × the oxide thickness of silicon |
| `deposit` | adds a film, conformal (follows topography) or planar (fills to a level) |
| `prime`, `coat`, `softbake` | HMDS flag; spin coat with partial planarisation, spin-speed thickness and a radial edge rise; solvent-loss shrink |
| `expose` | rasterises the mask (tone, bias, overlay shift) → Gaussian PSF aerial image → dose written into `dose[c]` of the top resist; the resist is only tagged *exposed*, its shape does not change |
| `peb` | blurs the latent image (acid diffusion) and tags the resist *post-bake* |
| `develop` | positive tone: integrates dissolution rate vs depth (Beer–Lambert absorption, contrast curve, fixed developer capacity, tabulated) and removes that much resist per column |
| `etch` | anisotropic, time-based: per-material relative rates set selectivity; resist erodes; stops where the rate is 0 |
| `wetEtch` | removes an exposed target material, and undercuts thin buried slivers next to opened columns |
| `strip` | removes all resist |
| `implant` | dopes silicon where the stack above (weighted by stopping factors) is thinner than the ion range; combines with existing doping |
| `anneal` | drives the wells deeper into the substrate and marks dopants as activated |
| `cmp` | planarises to the top of a stop layer, or to a fixed plane |
| `inspect`, `films`, `backend`, `rework`, `scan`, `receive`, `clean` | bookkeeping on the wafer summary (surface text, films for colour, particles, probe/dice/package flags) |

### Plans, hashing and replay (`src/sim/history.ts`)

`buildPlan(choices, die)` expands the 37 journey steps into 125 operations and records which
op range belongs to each step. `prefix[n]` is a rolling hash of the first `n` ops, so two
plans that share a prefix (for example the same flow with a different contact overlay)
share cached states up to the first difference.

`Replayer.stateAt(plan, n)` returns the state after `n` ops. It looks up `prefix[n]` in an
LRU cache; on a miss it walks back to the nearest cached prefix (or the initial state),
clones it, and applies the remaining ops, caching every step boundary it passes. The
result never depends on what was computed before: `replayFresh` (no cache) is the reference,
and the unit tests seek forwards, backwards and out of order through a small cache and
compare every result with a fresh replay.

### Seeking inside a step (`opCountAt`)

A step's animation runs from progress 0 to 1. Each op in the step has a reveal time (evenly
spaced by default, or the step's own `at` list in `src/content/steps.ts`). The state shown at
progress `p` is `stateAt(plan, start + number of ops whose time ≤ p)`. Playing, scrubbing,
replaying, the film's clock and deep links (`?step=…&p=…`) all use this same function, so
every view agrees on what exists at that moment.

### Derived results (`src/sim/engine.ts`)

The `Engine` facade memoises results by the prefix hash they depend on:

* **Metrology** (`metrology.ts`): gate CD at half resist height after develop and after
  etch, resist residue in openings, contact overlay from the centroid of developed contact
  openings, contact-to-gate touches from geometry.
* **Electrical test** (`electrical.ts`): conductive segments become union-find nodes;
  touching nodes join (n+ and p+ form a junction and do not). Silicon under a gate is a
  channel that conducts when the gate net is at the turn-on level; a gate shorter than
  `L_PUNCH` always conducts, one shorter than `L_IDDQ` fails the leakage check. IN is driven
  to 0 and 1 and OUT is classified as 0, 1, shorted (`X`) or floating (`Z`). The conducting
  path is returned as grid columns so the 3D view can light it.
* **Diagnosis** (`diagnose.ts`): maps the measured evidence (residue, gate length, contact
  touches, particles) to a cause, a plain-language explanation and the steps to revisit.
* **Wafer map** (`waferMap.ts`, run in `waferMap.worker.ts`): each die gets a local resist
  thickness (radial spin profile), a local overlay (global offset + a small magnification
  term) and particle hits. Dies in the same quantised bucket share one full process run, so
  every die verdict comes from the same model. Typical cost: 0.5–2 s in the worker.

## Modes, navigation and presentations *(round two)*

The app has one explicit mode (`src/state/store.ts`, `src/state/nav.ts`):

| mode | URL | what it shows | writes the learning run? |
|---|---|---|---|
| home | `/` | the fab and the introduction | no |
| learn | `?step=<id>` | a lesson: step panel, caption, 3D stage | yes: step, visited, choices, checks |
| explore | `?explore[=<machine>][&demo=1]` | the bay, a machine, or its demonstration | no |
| watch | `?watch[&t=<s>]` | the narrated film | no |

The URL is the source of truth: `navigate()` writes it (push or replace), Back/Forward call
`navigate()` with the parsed URL, and a refresh starts from it. Mode, lesson step, camera
scale and the explorer's machine are separate pieces of state: changing scale ("Inspect
layers") is a per-step camera override that never touches the step, choices, checks or the
simulated state (an e2e test compares the state key before and after).

Leaving a lesson for Explore or Watch stores a **snapshot** (step, progress, playing,
overlays, scale override, free-look camera) in sessionStorage and pauses the clock;
returning restores it exactly, flies the camera back, and offers *Resume* if it was playing.

Saved progress is `fab-one:v2` in localStorage (`src/state/persist.ts`): every field is
validated on load, and a v1 save is migrated (its steps up to the furthest one count as
visited; checks keep their answers).

**Presentations** (`src/state/presentation.tsx`) decouple the scenes from the learning run.
A presentation says which step a scene shows, at what progress (a progress *source*), for
which run of choices, with which overlays. Learn provides the learner's run and lesson clock;
Watch provides the canonical run on the film clock; an Explore demonstration provides the
canonical run on a local preview clock; an idle machine gets a *parked* presentation (no
learner wafer). The simulation hooks (`useStep`, `useSimState`, `useProgressFrame` …) read
the nearest presentation, so the same scene code serves all of them.

## How the views read the state

| view | reads | notes |
|---|---|---|
| Device cutaway (`three/device`) | presentation's sim state | face-culled mesh, top faces merged along x; groups for semiconductors, dielectrics (x-ray ghost option), metals, resist and the glowing conduction path; labels come from the same grid |
| 2D cross-section, layer inset (`ui/CrossSection.tsx`, `ui/Viewport.tsx`) | learning run's grid at `CUT_Y` | the inset samples the stack over the NMOS drain |
| "What changed?" (`ui/Overlays.tsx`) | state at step start and step end | slider blends the two cross-sections |
| Wafer (`three/wafer/`) | presentation's wafer summary + films | colour from a thin-film interference model (`sim/filmColor.ts`); fields, dies, particles, latent image and die map drawn into one canvas texture; from the die map on, the learner's die is outlined |
| Tool scenes (`three/tools/*`) | presentation's step, progress, films | the wafer inside each tool uses the same colour model; light paths are overlays toggled by the learner (or by the film, labelled) |
| Step panel (`ui/StepPanel.tsx`, `ui/panels.tsx`) | metrology, diagnosis, electrical, wafer map | every number shown is measured from the simulated state |
| Caption (`ui/Caption.tsx`) | step + lesson progress → `content/beats.ts` | one sentence at a time, timed to the operations |

Rendering never writes to the model. The only inputs to the model are the choices.

## Journey: step → scene → operations

View: where the step's shot track ends (tool: with the machine; wafer: on the wafer; device:
in the magnified cross-section). Learners can move between the equipment and the
cross-section at any time (*Inspect layers* / *Back to equipment*). Ops: operation kinds in
the step (count).

| # | chapter | id | title | scene / variant | view | ops | interaction |
|---|---|---|---|---|---|---|---|
| 1 | wafer | `arrive` | Meet the wafer | foup / dock | tool | receive (1) | — |
| 2 | wafer | `transfer` | Move it by robot | foup / robot | tool | — (0) | — |
| 3 | wafer | `scan` | Scan for particles | inspect / scan | wafer | scan (1) | — |
| 4 | wafer | `clean` | Clean the surface | wetclean | tool | clean (1) | control: clean |
| 5 | wafer | `diemap` | Map the dies | wafer / diemap | wafer | — (0) | control: dies |
| 6 | transistors | `padox` | Grow a thin oxide | furnace / oxidize | tool | oxidize, deposit (2) | — |
| 7 | transistors | `sti-etch` | Carve isolation trenches | etch / etch | device | litho cycle, etch, strip, films (9) | compare |
| 8 | transistors | `sti-fill` | Fill and polish | cmp | tool | deposit, cmp, wetEtch, films (4) | compare |
| 9 | transistors | `wells` | Dope the wells | implant | device | 2 × litho cycle, implant, strip (17) | compare |
| 10 | transistors | `anneal` | Anneal | furnace / anneal | device | anneal (1) | — |
| 11 | transistors | `gatestack` | Build the gate stack | depo / poly | tool | wetEtch, oxidize, deposit, films (4) | — |
| 12 | pattern | `prime` | Prepare the surface | track / prime | tool | prime (1) | — |
| 13 | pattern | `coat` | Coat the wafer | track / coat | tool | coat (1) | control: spin |
| 14 | pattern | `softbake` | Soft bake | track / bake | tool | softbake (1) | — |
| 15 | pattern | `reticle` | Load the reticle | scanner / reticle | tool | — (0) | — |
| 16 | pattern | `align` | Align to the layer below | scanner / align | tool | — (0) | — |
| 17 | pattern | `expose` | Expose | scanner / expose | tool | expose (1) | control: dose, light path, DUV vs EUV |
| 18 | pattern | `peb` | Post-exposure bake | track / bake | device | peb (1) | — |
| 19 | pattern | `develop` | Develop | track / develop | device | develop (1) | check: positive resist; compare |
| 20 | pattern | `adi` | Inspect the pattern | metrology | tool | inspect (1) | after-develop inspection, rework |
| 21 | pattern | `gate-etch` | Etch the gate | etch / etch | tool | etch (1) | compare |
| 22 | pattern | `strip` | Strip the resist | etch / ash | device | strip, films (2) | — |
| 23 | connect | `sd` | Repeat: sources and drains | implant | device | 2 × litho cycle, implant, strip, anneal (18) | compare |
| 24 | connect | `pmd` | Insulate the transistors | depo / oxide | tool | deposit, cmp, films (3) | — |
| 25 | connect | `contact-align` | Align the contacts | scanner / align | device | prime, coat, softbake (3) | control: overlay; check: misaligned contact |
| 26 | connect | `contact-print` | Print the contacts | scanner / expose | device | expose, peb, develop, inspect (4) | overlay metrology, rework |
| 27 | connect | `contact-etch` | Etch the contact holes | etch / etch | device | etch, strip, films (3) | compare |
| 28 | connect | `contact-fill` | Fill with tungsten | cmp | device | deposit, cmp, films (3) | compare |
| 29 | connect | `metal1` | Lay the first wires | cmp | device | damascene: deposit, litho, etch, strip, cmp (13) | compare |
| 30 | connect | `metal2` | Add vias and a second level | cmp | device | dual damascene (20) | — |
| 31 | connect | `passivate` | Seal the surface | depo / pass | tool | deposit, films (2) | — |
| 32 | test | `inspect` | Inspect the wafer | inspect / review | wafer | inspect (1) | inspection summary |
| 33 | test | `probe` | Probe every die | prober | tool | backend (1) | wafer map, yield |
| 34 | test | `dice` | Cut the dies apart | dicing | tool | backend (1) | — |
| 35 | test | `attach` | Attach the die | package / attach | tool | backend (1) | — |
| 36 | test | `bond` | Wire and seal | package / bond | tool | backend (2) | — |
| 37 | test | `final` | Flip the input | testbench | device | — (0) | control: input (truth table) |

"Litho cycle" is prime → coat → soft bake → expose → PEB → develop. The gate layer (steps
12–22) shows every stage of the cycle; the other layers run the same operations inside one
step and say so.

### Tool environments (`src/three/tools`)

Fifteen lazily loaded scenes, one module each, plus the fab bay:

| scene | used by | what it shows |
|---|---|---|
| `Foup` | arrive (`dock`), transfer (`robot`) | equipment front end with two load ports and a fan-filter unit; an overhead hoist sets the translucent FOUP (25 wafers, yours in slot 25) on kinematic pins, the port opens the door; in `robot`, an R-θ robot lifts the wafer onto a pre-aligner that spins it past the edge sensor |
| `Inspect` | scan (`scan`), inspect (`review`) | granite base, XY stage and spinning chuck under an optical head; a spiral laser scan reveals the simulated particles on a live defect map; in review an SEM column visits each defect |
| `WetClean` | clean | edge-pin spin chuck in a splash cup; a chemical arm with spray and megasonic head sweeps, a DI-rinse arm rinses, then spin-dry; particles disappear when the model applies the clean; if the learner skips it, the arms stay parked and the particles stay |
| `Furnace` | padox (`oxidize`), anneal | vertical furnace with a cut-away heater jacket; a quartz boat of 50 wafers (yours on top) rises into the tube; heater glow follows the temperature; gas-line indicator for O₂, nitride precursors or N₂ |
| `Etch` | sti-etch, gate-etch, contact-etch (`etch`), strip (`ash`) | cluster (EFEM, load lock, transfer robot) and the chamber in use: electrostatic chuck, slit valve, endpoint viewport, turbo pump; inductive coil, showerhead or dome source depending on the step; soft plasma glow during the etch, after the slit valve has sealed the chamber; *round four:* the chamber is whole until the housing has opened, then cut open (hatched sections) with the transfer chamber's lid |
| `Cmp` | sti-fill, contact-fill, metal1, metal2 | rotating grooved pad, carrier head pressing the wafer face-down, slurry arm, diamond conditioner, load cup that flips the wafer, clean/dry module; *round four:* the pad turns glossy as the slurry wets it, and slurry banks against the retaining ring while the head presses down |
| `Implant` | wells, sd | high-voltage terminal and source, 90° analyser magnet, resolving slit, acceleration column, scanner and corrector magnet, end station with load lock; the wafer is loaded, tilted 7° to face the beam and scanned, once per mask; ion beam only with the beam-path toggle |
| `Depo` | gatestack (`poly`), pmd (`oxide`), passivate (`pass`) | cluster with a frog-leg robot; the chamber's heater lifts the wafer under a showerhead; the wafer shows the thin-film colour of the growing film; *round four:* the chamber is whole until the housing has opened, then cut open with the transfer chamber's lid |
| `Track` | prime, coat, softbake, peb, develop | coater/developer track: a carrier block, prime chamber, spin coat and develop cups, hot plates and the scanner interface in a row; *round three:* one robot on a rail carries the one wafer between modules (lift pins on the plates, spin chucks that rise above their cups for the hand-off; `trackMotion.ts`), the resist puddle, spread and thinning drawn continuously; *round four:* in the bay's order (carrier west, interface east against the scanner), a four-nozzle resist arm from its solvent bath, edge-bead removal, a slit-nozzle developer bar and rinse arm, plates with lids and proximity pins |
| `Scanner` | reticle, align, expose, contact steps | 193 nm DUV scanner: illuminator, reticle stage, projection lens, dual wafer stages; toggled light path; *round three:* the two chucks swap at the start of the exposure, the stage runs one continuous step-and-scan meander with the reticle scanning opposite, and each field lights up as the slit sweeps it (`scannerMotion.ts`); *round four:* a 1.28 m lens in a metrology frame, the hood 0.5 mm and the lens 1 mm over the wafer (the water shown in a magnified inset), alignment and level sensors, a planar-motor stage base, a patterned reticle, a panelled enclosure |
| `Metrology` | adi | CD-SEM: vacuum chamber, XY stage visiting five sites, electron column; the monitor's image and CD readout come from the simulated developed resist |
| `Prober` | probe | test head docked through a pogo tower to a probe card (drawn in half section so the needles show); the stage indexes and touches down die by die while the wafer map fills in; loader with a FOUP and tester cabinet |
| `Dicing` | dice | taped wafer in a ring frame on a porous chuck; spindle and blade with coolant cut each street in both directions, then the table turns 90° |
| `Package` | attach, bond | `attach`: ejector and collet pick the die and place it on an epoxy dot on a lead frame; `bond`: a capillary makes ball-and-stitch bonds for four wires, then a mould chase encapsulates the die |
| `TestBench` | final (tool view) | the packaged chip in a socket on a load board with an input switch and an output LED that follows the extracted circuit; clicking the switch toggles the input |
| `Fab` | fab level of every step, home page | a 36 m bay with two tool rows, an amber-lit lithography bay, a FOUP transport loop with vehicles and a back-end room; the current station is outlined in violet. Matte surfaces use pre-baked lighting so the bay stays cheap to draw |

Equipment is stylised and procedural (no external models or textures). Light paths are
drawn only when the learner turns them on.

*Round two:* every scene is also the interior of its machine's housing in the bay
(`tools/Fab.tsx` builds the housings; each pose file gives the scene's `mount` in its
station and the `cutaway` that opens). Placed in the bay, a scene draws only what is inside
the housing (`StandaloneOnly` wraps the floor, walls and status lights it needs on its own):
the load-port scene is the inside of a wafer sorter whose hoist hangs from the bay's rail;
the furnace is the middle unit of a bank of three, its boat on a raised floor in the tall
back tower; the implanter is mounted a quarter turn round, its terminal in a closed
high-voltage cage; the etch cluster has the etch chamber on the right and the ash chamber on
the left of one transfer hub; the polisher fills the polisher cell of its housing, next to a
closed clean/dry module; the back-end benches (die bonder, wire bonder) open above their
work holders. The overhead rail and its vehicles fade out within a few metres of the camera,
so a machine framed from across the aisle is not cut by the rail in front of the lens.

### The stage *(round two)* (`src/three/Stage.tsx`, `src/three/stage/`)

One canvas serves every mode and never unmounts. Its world is the fab bay in metres
(`tools/Fab.tsx`): floor, walls, ceiling, the overhead transport loop, and a low-detail model
of every machine, merged and pre-lit so the whole bay costs about 50 draw calls. The
machines the story needs are **mounted** as their detailed scenes at their stations
(`MountedStation`: station matrix × the tool's `mount` from its pose file), with the current
presentation; the next lesson's machine is preloaded, and the last few stay mounted (idle)
so going back is instant.

*Round three* — **readiness and hand-overs** (`stage/handover.ts`, `Stage.tsx`):

* A machine counts as **ready** once its model has mounted, drawn its textures and been
  prepared for the GPU (`renderer.compileAsync` for its shader programs, `initTexture` for its
  textures), one model at a time. The camera waits for the destination **however long it
  takes** (no timeout); after 250 ms the page says what it is waiting for, and the wait ends
  if the learner comes back to where the camera already is. A model that fails
  to load (a module that cannot be fetched) is caught by its own error boundary: the machine
  is framed from outside (`machinePose`), a notice offers a reload, and the rest of the stage
  keeps working. Until the first picture has its machine ready, a veil covers the canvas, so
  a deep link never shows a half-built scene; the lesson clock starts after that. The
  clipped housing materials are compiled once, up front (`Fab.tsx`), so a housing's first
  opening does not stall. The first machine prepared also prepares what no machine's model
  holds (`prewarmShared`): the rest of the bay, the wafer's program (a kept stand-in: a
  machine is prepared with the wafers it holds, perhaps none) and the cross-section's
  materials under their lighting (which also prefilters that lighting's environment map);
  the director compiles its overlay when it mounts. Where the browser cannot compile in
  parallel (`KHR_parallel_shader_compile`), `compileAsync` resolves at once and a program is
  really compiled at its first use: the director uses the prepared programs when the camera
  is still — when the first picture is revealed (under the veil) and when it leaves for a new
  destination, starting the move's clock after that (`stage/programs.ts`).
* **Lights inside machines** (the load port's fan-filter unit, the implanter's chamber) are
  drawn by a fixed pool of two point lights in the world (`stage/StationLight.tsx`): a
  machine's light takes one while the machine is drawn. Every lit program is compiled for the
  number of lights in the scene, so the number never changes.
* A machine the story **leaves** keeps its real last frame — its lesson, run choices,
  overlays and progress, frozen — until it is out of view (outside the camera frustum, or
  hidden by level of detail) and the camera has settled; at most two are held. The release
  is judged after the director has drawn the frame. Mounted machines are kept in a fixed
  order: a machine moved within the scene's list is re-inserted, and the renderer then
  re-applies every declared prop in its subtree (its station group hidden, moving parts back
  at their declared places) for a frame.
* **One wafer.** The learner's wafer has one owner: the director moves ownership to the next
  machine halfway along the first leg that travels between machines (the camera is in the
  aisle), and each side of a cross-fade shows the wafer where that side of the move has it;
  in Watch the film's timeline does the same. Anchor wafers of other machines are hidden, so
  the wafer is never on screen twice.
* **Same machine, next lesson.** Consecutive lessons whose tool animations are designed to
  join (`BRIDGED` in `tools/index.tsx`: arrive→transfer, prime→coat→softbake, peb→develop,
  reticle→align→expose, contact-align→contact-print) switch directly when the first lesson
  has finished. Any other change of what a machine shows (going back, jumping, leaving
  half-way, a different chamber) is held until the director has **captured the picture as
  displayed**; the machine then switches, and the director dissolves from the captured
  picture (0.35 s) before the camera moves.

**Housings.** A machine's bay model is its housing. For machines whose pose file sets
`cutaway: { z, y }` (station-local: toward the aisle and above the given height), the housing
stays on show when the story is at that machine and the camera is near, and its upper front
is clipped away (material clipping planes, animated from the roof down over 0.8 s; inner
faces drawn double-sided) to reveal the detailed interior (*round four:* see
[Equipment and the lithography loop](#equipment-and-the-lithography-loop-round-four) for the
reveal rule, sections and the chambers opened after their housing). *Round three:* back faces of an
opened housing are drawn one pixel's depth slope deeper than front faces (`cutMaterial`), so
the underside of a part resting on another (a housing on its plinth, a roof unit on the
housing top) never z-fights with the surface below it. A machine that loads while the
camera is already there opens at once, and reduced motion skips the wipe. In Watch the
housings move on the film's clock (paused, they stay as they are), and after a seek, or when
a machine loads, the director sets them to where playing up to that time leaves them: it
replays the film's camera and machine over the preceding 1.6 s, a frame at a time
(`Director.tsx` `replayHousings`, `Fab.tsx` `cutClock`). Machines without a
housing hand over from the low-detail to the detailed model when the camera comes within
16 m.

The magnified **device space** is a separate scene (a portal) with its own lighting; it is
built only for steps whose shot track visits it, or on request.

### Camera and transitions *(round two)* (`src/three/stage/Director.tsx`, `tracks.ts`, `flights.ts`, `content/shots.ts`)

The director owns the camera and the render loop in every mode:

* **Shot tracks** (`content/shots.ts`): per step, keyframes in step progress (`{ p, cam }`).
  Framings: `machine` (the whole machine from the aisle, sized from its housing), `shot`
  (a named framing in the tool's pose file), `wafer` (`top`: the whole wafer where the tool
  holds it now; `die`: close over your die), `device` (the cross-section). Because a track is
  a function of p only, scrubbing, replaying and the film's clock all give the same shot at
  the same moment. Steps without a hand-directed track get one from their round-one view:
  device steps go machine → wafer → die → cross-section just before their first operation.
  Sixteen steps are directed by hand, because the wafer is not always in (or visible in)
  the step's machine: in sti-etch, wells, contact-fill and metal1 the lithography, deposition
  or etch before the machine's own action happens in other tools, so the camera stays with
  the layers, comes out to the machine when the wafer arrives, and goes back down through the
  wafer afterwards; the furnace, the hot-plate lid and the ash chamber's plasma enclose the
  wafer, so anneal, peb and strip go down to the layers before they close or from the
  machine itself; sd and metal2 repeat a loop already shown and stay in the layers.
  *Round three:* coat, softbake and develop hold on the pick-up and follow the track's robot
  to the next module; contact-align and contact-print stay with the scanner and go down to
  the layers from there, instead of framing a die the stage is stepping around; contact-align
  comes back out onto the exposure framing at its end, where contact-print starts (a move from
  your die on the measuring chuck to the lens would pass through the metrology frame). Reviewed
  frame by frame, four more hid their subject behind the machine: framed from above, the
  post-exposure bake's raised lid and exhaust filled the die close-up, develop's dispense
  bar swept across the lens, and in the etch chamber the wafer and die framings sat inside
  the plasma's glow; peb, develop, sti-etch and contact-etch now hold the machine view
  through the action and go down into the layers from it. Contact-fill and metal1 watch the
  polisher's flips and the carrier head's return from the machine view the same way (a die
  close-up had the turning wafer or the head in the lens). The die bonder and the wire bonder
  stand side by side, each framed millimetres from its work, and a straight move out of
  either close-up runs through the benches: bond starts on a framing of both benches, comes in
  along its close-up's line of sight, and backs out the same way at the end. A
  flight into or out of the cross-section anchors on your die when the machine is showing
  the wafer, and on the machine itself when it is not, so the camera never closes in on an
  empty holder.
* **World ↔ device**: an anchored, matched cross-fade. The world camera closes in on your die
  while the device camera starts far out along the same direction relative to the wafer's
  axes (the device block's axes follow the wafer's), and the two views are blended.
  *Round three:* each side is drawn to the screen exactly as it would be on its own and
  copied (`copyFramebufferToTexture`), then the other side is drawn and the copy blended over
  it: the blend is of the displayed pictures, so nothing changes brightness, sharpness or
  tone at either end of a fade (the round-two half-float target tone-mapped after blending).
  Labels appear only once the new view settles.
* **Flights** (`flights.ts`) between framings: short moves are direct; moves between
  machines step back into the central aisle (clear of equipment, through the doorway to the
  back-end room), travel along it looking ahead (a centripetal Catmull-Rom path, eased by
  arc length), hold for 0.35 s on the whole new machine, then move in; out of the
  cross-section, the flight first retraces onto the wafer it came from. Durations: 0.6–1.3 s
  for a reframe, 1.6–3 s for travel. A new request retargets from wherever the camera is;
  a superseded flight never completes. With reduced motion every flight is a 0.35 s
  cross-fade between still compositions, and tracks hold each framing and cross-fade to the
  next (`evalTrackStill`).
* *Round three — continuity.* A replaced flight hands its motion over to the new one over
  0.45 s (velocity continuous), instead of stopping dead. A request that arrives mid-fade,
  mid-dissolve or while a machine is about to change is **captured as displayed** and
  dissolved from, so the composite never snaps to one side; the latest request always wins.
  Tracks pass through intermediate framings without stopping (cubic Hermite through the
  keys, tangents limited against overshoot); consecutive keys with the same framing are a
  deliberate hold; a single move still eases in and out. The **field of view** is part of
  each pose (the home and overview framings are composed for the viewport) and
  interpolates with it, so no move or film gap switches it suddenly. **Moving wafers:** a
  machine that flips, spins or steps and scans the wafer registers a steadier stand-in for
  shots to frame (`anchors.ts` `framingRegistry`, `Wafer.tsx` `WaferFraming`) — where the
  wafer rests, right side up: the polisher's ignores the flipper and the head's turn, the
  track's the spin, the scanner's the steps and scans, and the inspection review frames the
  stage's working area between the optics and the review SEM (a stand-in can widen the
  whole-wafer framing to take in a stage's travel) — so the wafer moves within a steady view
  instead of the view chasing the wafer. Spins stop on whole turns, so the next
  lesson finds the die where it was. The key light and shadows follow the
  story to the next machine at the wafer hand-over, while the camera is between machines.
* **Clocks** (`stage/time.ts`): flights, the lesson clock and the demonstration clock run on
  the stage clock, which stops while the page is hidden (and, *round four*, while a dialog
  covers the stage: see below), and lesson progress is measured
  from when playback (re)started rather than accumulated from frame deltas, so a slow frame
  never slows a lesson and a hidden tab resumes where it was. Decorative motion (fans,
  flicker, the overhead vehicles, the signal glow) reads one decorative time: the stage
  clock, or the film's own time in Watch (so a seek shows exactly the frame playing would);
  it stops under reduced motion. The harness clock (`?virt=1`) passes seconds to three.js'
  clock (round two passed milliseconds, which made decorative motion 1000× too fast in
  recordings).
* **Dialogs over the stage** *(round four)* (`Stage.tsx` `useStageCovered`, `CoverStop`;
  `stage/time.ts` `setStageCovered`, `whenUncovered`): while Chapters, Look closer, the
  equipment list or any other dialog is open in a lesson or the explorer, the stage draws
  nothing (the canvas's loop stops, and so do the frames the camera controls had already asked
  for), the stage clock stops, and preparing machines for the GPU (compiling their programs,
  uploading their textures) waits until it closes — so every frame the browser can make goes
  to the dialog, and the lesson, a move or a demonstration carries on from where it was. On the
  software renderer a frame of a lesson ties up the GPU process for seconds, and the Chapters
  drawer, which faded in from transparent, stayed invisible that long (a second click, on its
  invisible backdrop, closed it again): dialogs and cards now slide in fully opaque
  (`styles/app.css`). A resize meanwhile clears the canvas, so the stage is drawn once more,
  as it stands. Watch plays on under its own dialogs (its narration keeps its own clock).
* **Free look**: dragging, pinching or scrolling hands the camera to the learner (Learn and
  Explore); *Guided view* / *Reset view* flies back. Explore keeps the camera inside the
  building (camera-controls boundary).
* Framings are composed for a landscape viewport; narrower viewports pull the camera back
  along its view direction. The explorer's whole-fab view on a portrait screen is instead
  fitted to the machines' boxes (on a phone, into the space above the compact overview card),
  and the fog is pushed back with the camera distance so a distant overview stays readable.
* A quiet **scale label** says what the picture shows (Fab bay, Equipment view, Wafer
  surface, Magnified cross-section · schematic); it comes from the framing, not a control.

## Equipment and the lithography loop *(round four)*

Round four is about what the machines look like and what they visibly do. The reference matrix
behind it (layout, load port, chamber, moving parts, wafer position, what is visible and what
is an overlay, per machine, with sources) is in [`docs/ROUND4.md`](docs/ROUND4.md).

**Housings as equipment** (`tools/Fab.tsx`). A machine's bay model is drawn with physically
based finishes (`LIT`: powder-coated panels on a restrained roughness scale, brushed and
anodised metals, smoked window glass) under a cleanroom reflection environment of ceiling
light strips (`Stage.tsx`, `WorldEnvironment`); the bay's own structure stays baked. The same
model is shown at every distance (no level-of-detail swap). Housings that open are hollow
(`Kit.cavity`, and `prism` for a body whose elevation is not a rectangle: an extruded outline
with its matching inside), so a cut shows walls with a thickness; parts added in `Kit.keep`
(load ports and pods, operator panels, emergency-off buttons, the track's bridge to the
scanner) stay whole when the housing opens. A shared vocabulary gives fronts their detail:
`door` (a panel proud of the body with a gap, pull and label), `grille`, `emo`, `screenArm`,
`loadPorts`.

**The reveal.** A camera pose carries `exterior` (`stage/tracks.ts`): a flight's travel leg
and the establishing hold at a new machine, and the explorer's view of a machine, are
exterior, so the machine is seen closed. The housing opens as the camera moves in from there
(the move-in is a direct leg, `flights.ts` `directLeg`), never closes around the camera
(`insideHousing`), and the scale label says *cutaway view · covers drawn removed* while it is
open (`StageInfo.cutaway`). **Sections** (`kit/section.ts`): an opened solid is drawn as a
flat, finely hatched section where the cut passes through it (back faces of the clipped,
two-sided material), anti-aliased and faded out with distance so it never shimmers.
`SectionCut` applies the same drawing inside a machine: the etch and deposition chambers in
use are whole vessels until their housing is open; then a wedge toward the aisle is pushed in
(`wedgePlanes`) and the transfer chamber's lid wiped off (`slicePlane`). The opening takes
`CUT_TIME` = 1.3 s: the housing the first 0.8 s (`HOUSING_SHARE`), the parts inside the rest
(`innerCut`), closing in reverse; one value, so Watch's replay after a seek covers both.

**The track** (`tools/Track.tsx`, `trackMotion.ts`). Blocks in the bay's order: the carrier
block at the west end (against the bay's load ports), the process block, the interface block
at the east end against the scanner; the working line prime → coat → soft bake → develop →
post-exposure bake runs west to east, every carry at most 0.7 m. The coat cup has a four-nozzle
resist arm that swings from its solvent bath, an edge-bead-removal arm whose solvent jet clears
the rim progressively (`LiveCoat.ebr`, in the wafer's shader), and the liquid reads as a
meniscus puddle; develop has a slit-nozzle bar that lays the puddle across the wafer (a
curtain, then a clipped puddle) and a rinse arm; the plates have lids on columns and proximity
pins; prime is a sealed hot-plate chamber.

**The scanner** (`tools/Scanner.tsx`, `scannerMotion.ts`, `reticleArt.ts`). Heights are shared
constants (`scannerMotion.ts`): the last lens element 1 mm over the wafer, the immersion hood
0.5 mm, a 1.28 m lens in a metrology frame, the reticle above it, the beam delivery where the
bay model's duct meets it. The stages run on a planar motor's tiled base, with encoder heads
and fiducials; alignment and level sensors sit over the measuring side; the reticle carries a
procedural 4× pattern (clear-field for the gate layer, dark-field for contacts) drawn from the
die's floor plan. The slit, the light path and the alignment spot are drawn only with the
light-path overlay, and then over the machine's parts (`LIGHT`: no depth test, drawn after the
machine), from the reticle through the lens to the wafer, only by the scanner the story is at;
while it is shown the scanner publishes a note (`useOverlayNote`) and the scale label names it
as an overlay of invisible light.
**The magnified inset** (`state/magnifier.ts`, `ui/Magnifier.tsx`): the water film is too thin
to see at machine scale, so the page shows it in a titled schematic inset (heights to one
scale, the gap marked); the scene publishes the stage position and whether a field is being
exposed and redraws the inset with the frame it renders (`magnifierFrame.draw`), so seeking,
replay and virtual time show the same inset. It is shown only while the scanner exposes, in
the world, opened.

**The dies** (`wafer/dieArt.ts`, `Wafer.tsx`). One floor plan (seal ring, pad ring, array,
logic and analog blocks, wiring channels) is drawn on the reticle at 4× and, as a brightness
modulation, into every die of the wafer by its shader (`DIE_GLSL`, before any film on top, so
a resist coat still tints it; sampled with the derivatives of the unwrapped die coordinate so
die boundaries do not break its filtering). It appears once the die is patterned, gains
contrast with each layer, shows pads with the metal and opened pads after passivation; its
average is grey, so from a distance the wafer looks as its painted surface does. The wafer's
rim is rounded (0.4 mm).

**The camera through free space** (`stage/flights.ts`). Leaving a close view of the wafer for
another machine, the camera first backs out along its own line of sight to 2.4 m
(`backOutPose`) — except straight out of the layers from your die inside the machine, where it
goes to the machine's own framing first, the way it comes in to inspect the layers (the die
framing is taken from that framing), and travels from there: the line of sight from the die
passes through a module's cover, a polisher's upper works or a furnace's tower. A machine whose
die has nothing above it but the opened housing sets `leaveUp` in its pose file and backs out
upward instead (the etch cluster: the straight way from its load lock to its framing crosses
the load lock's lid), and one whose die lies in a space too tight to leave through sets
`leaveFade` and dissolves from the die to its framing in 0.6 s (the scanner: your die under the
projection lens; the track: in a cup under the module's cover; the polisher: at its clean
station); the move in from an establishing shot is direct; *Inspect layers* at a machine
whose wafer is not in view reveals the layers from where the camera is, and *Back to
equipment* fades straight into the machine's framing (no flight out to its establishing shot
and back). A direct move that turns the view by more than a quarter turn — between machines
that face each other across the aisle — pans about the vertical (`tracks.ts` `turnPose`:
heading the short way round, fixed when the move is planned; pitch and the distance to what it
looks at in proportion; 1 s plus 0.45 s per radian of turn at least): moving the point looked
at in a straight line swept it under the camera, which looked down at the floor. **The room** (`stage/tracks.ts` `ROOM`, `roomAlong`, `fitInRoom`): a camera among
the machines stays over the central aisle (|z| ≤ 1.4 m, clear of the overhead rail above the
load ports), under the ceiling (y ≤ 4.05 m) and inside the walls. A machine's establishing
shot stands at most at the far side of the aisle, and a large machine is framed from there
with a wider lens (`lensFor`: the same picture at the machine as from the distance its size
asks for) instead of from over the other row, at the ceiling; the aspect fit of a narrow
screen (`Director.tsx` `fitPose`) pulls a framing back only as far as the room allows and
widens the lens for the rest (it used to take the camera out through the ceiling). The
learner's free look keeps the lens it took over with.

**Loading order** (`ui/Viewport.tsx`). The 3D stage's modules are fetched once the page's web
fonts have loaded and it has painted once (bounded at 1.5 s). Fetched during the first layout,
while the fonts were still loading, they could leave headless Chromium's renderer waiting
forever on a fallback-font lookup (a fresh load of the last lesson froze about half the time;
`docs/ROUND4.md`, *Continuity*); the fonts are small and come first.

**Shadow programs** (`stage/shadowPrewarm.ts`). Preparing a model compiles its colour programs;
the programs its shadows are drawn with (three.js gives every shadow-casting mesh a depth
material of the mesh material's sidedness, map and alpha test) compiled only when the key light
first turned to it — for a machine opened on the way in, in the middle of the move. Each prepared
model, and the housings' opened materials, are therefore drawn once into a 16 × 16 shadow map of
a light of their own from the world scene's `onAfterRender` (the frame's render state, with its
lights, is still current; the materials' clipping planes are set aside, as the renderer's own
shadow pass does without `clipShadows`), so three.js builds exactly the programs its shadow pass
will ask for, while the camera is still.

**Watch: the sound waits for the picture** (`watch/player.ts` `hold`, `Director.tsx`). While
the stage holds its picture for a machine that is still loading, the film's clock stands
still and the narration pauses where it is; the page says what it is waiting for, and the film
carries on from the same moment once the machine is in. (The picture's own hold after a seek,
a frame or two, does not pause the sound.) Releasing the hold leaves the clock's reference
alone: the frame loop keeps it at the last frame while the film is held, so the first frame
after the hold counts its own time (the stage's wait reaches the player a frame later, and a
hold set while the film was paused is released on the first frame after *Play*: resetting the
reference there left the film a frame behind the time a seek had shown). *Play* and seeks
during a hold leave the narration paused until the hold ends (`syncAudio` starts an element
only when the film is not held). In a background tab the player's timer ends the hold: with no
picture on screen the narration plays on, as before round four, and the stage holds it again on
return if the machine it needs is still loading. The stage's verdict reaches the player a frame
or two after a seek, so a seek into a machine that is still loading plays that long before the
hold begins.

## Experiments and failure modes

All outcomes come from the model; nothing is scripted per setting.

| experiment | where | what happens in the model | where it shows |
|---|---|---|---|
| Skip the clean | step 4 | eight incoming particles stay; those in a die's circuit area kill it | wafer view, inspection, probe map, yield |
| Spin speed | step 13 | film thickness ∝ speed^-½ (relative), edge thickens at slow speed | wafer colour, resist thickness, gate CD, edge dies at probe |
| Exposure dose | step 17 | dose scales the aerial image; development clears less (residue, wide lines) or more (narrow lines) | latent image, develop, ADI metrology, gate length, electrical test |
| Contact overlay | step 25 | contact mask shifted before rasterising; contacts land on gates beyond the margin | preview pillars, overlay metrology, contact–gate shorts, truth table |
| Rework | steps 20, 26 | resist stripped and the litho cycle rerun with the corrected setting | banner, rework count |

Every non-default choice offers "Restore …" and "Go to the … step" actions, and the final
test explains the cause.

## UI structure

* `src/App.tsx` — the page frame: header, the persistent viewport (the canvas never
  unmounts; the layout around it changes with the mode), the lesson panel, overlays, keys.
* `src/ui/Chrome.tsx` — the header: wordmark, the lesson's place (chapter, step title, step
  count, a journey hairline), Chapters, Explore fab, Watch.
* `src/ui/Home.tsx` — the introduction, in normal flow below the header.
* `src/ui/StepPanel.tsx` — one step: meta line, title, one sentence, the step's single control
  or check, then "What changes" / "Why it matters" (revealed as the animation plays),
  links to Look closer / What changed? / Legend, and Replay / Continue.
* `src/ui/Viewport.tsx` — the lesson HUD over the canvas: scale label, contextual commands
  (Inspect layers / Back to equipment / Guided view; light path; cutaway and x-ray in the
  cross-section), caption, resume prompt, scrubber and the layer inset.
* `src/ui/Caption.tsx` + `src/content/beats.ts` — the timed captions and their anchored labels.
* `src/ui/Explore.tsx` — the explorer's card (overview, machine, demonstration) and the
  equipment list.
* `src/ui/Watch.tsx`, `src/ui/Offline.tsx` — the film's controls, captions and states, and
  *Save for offline*.
* `src/ui/Overlays.tsx` — Chapters drawer, Look closer drawer (labelled section,
  explanation, one source), What changed? comparison, Legend, DUV vs EUV explainer, Recap.
* `src/content/steps.ts`, `glossary.ts`, `sources.ts` — all learner-facing copy and sources.
  Glossary terms are marked `[[termId|text]]` in the copy. `content/firstUse.ts` finds the
  step where each term first appears; that step defines it inline under "What changes" /
  "Why it matters", and every mention also has a hover, focus or tap definition.
* `src/three/labels.tsx` — scenes declare labels (tagged with their space and station); one
  DOM layer draws them and the director projects them each frame (`labelProjection.ts`),
  avoiding overlaps and anything marked `data-occludes`.

## Watch *(round two)* (`src/content/film.ts`, `src/content/narration.json`, `src/watch/`)

* **Script**: `content/narration.json` holds the narration, one cue per sentence, one segment
  per step (plus an opening and a closing). `content/film.ts` maps segments to steps and
  places `sync` points: "when this cue starts, the step is at p", a little before each
  operation, so a change happens while the sentence describing it is spoken (a unit test
  checks develop, expose, etch, coat, strip and scan against the measured cue times).
* **Audio**: `tools/narration` renders the script offline (Kokoro-82M v1.0, voice bm_george)
  to one MP3 per segment and a manifest with measured durations and cue times
  (`public/narration/<version>/`).
* **Timeline** (`watch/timeline.ts`, pure and unit-tested): segments back to back, separated
  by silent camera moves whose lengths depend only on where the two steps happen (a reframe
  in the same machine, a trip along the aisle, a retrace out of the cross-section). Film time
  → segment, step, step progress, caption, final-test input.
* **Clock** (`watch/player.ts`): while a segment plays, its audio element's position *is*
  the film time; the silent moves (and captions-only playback when audio fails) run on the
  page clock. Two audio elements alternate so the next segment is loaded while the current
  one plays; both are unlocked inside the click on *Watch*. Pause, seek, speed (pitch
  preserved), mute, buffering and chapter jumps all act on that one time value. In a
  background tab a timer keeps the clock and the segment hand-over going.
* **Picture** (`watch/filmStage.ts`): the stage mounts the machines of the current, next and
  previous segments with presentations whose progress is read from the film time, and the
  camera is the step's own shot track at the mapped progress, or the same flight a lesson
  would make, stretched to fill the move between segments. Seeking anywhere gives exactly
  the frame that playing would. *Round three:* a seek moves the film's camera at once, but
  the stage's tree commits what the new time shows a frame later; the director holds the last
  good picture until the tree has the film's presentation (`filmBridge.pres` against
  `stageCommit`), the layers have their geometry if the film is in them (`deviceShown`), and
  the machines at both ends of a move are loaded (`filmBridge.otherEnd`; after a seek, also the
  machine of a move starting within 3 s, `filmBridge.soon`), then dissolves from it. The film's
  clock does not wait: a long hold is a frozen picture while the narration goes on. The
  director reads the viewport from each frame's own state.
* **Offline** (`watch/offline.ts`, `public/sw.js`): *Save for offline* checks the storage
  estimate, downloads every file of this build (listed with sha256 in `app-files.json`, made
  at build time) and the film's audio (sha256 in the manifest) into a cache named after both
  versions, verifies each file, and writes a completion marker last. The service worker
  serves only from a complete cache and only when the network fails (narration audio,
  immutable per version, is served from the cache first, with byte ranges for seeking).

## Accessibility

* Every control is a native button, radio group or range input with a label; keyboard
  shortcuts in a lesson: ←/→ step, Space play/pause, R replay, I inspect layers / back to
  equipment, G guided view, C chapters, E explore fab, L look closer, 0/1 input on the final
  test, Esc closes panels. In the film: Space or K play/pause, ←/→ ±5 s, M mute,
  C captions, Esc exit. In the explorer: Esc returns to the whole fab.
* Focus moves to the step title on each step; dialogs trap focus and restore it on close.
* The explorer works without pointing: the equipment list names every machine and
  describes its job, and focusing an item outlines the machine in the bay.
* `prefers-reduced-motion` (or `?motion=reduce`): no camera travel. The camera holds still
  compositions and cross-fades between them (0.35 s), housings open without the wipe, and the
  home view stands still. Lessons and the film still play in time, so the process, its
  captions and the narration keep their pacing; nothing is compressed into one frame. (Round
  one landed each lesson on its result instead; that skipped the captions in between.)
* The 3D view is described in text (the region label, the step panel and the caption); every
  value that matters is also in the panel. Captions are real text.
* Without WebGL the lesson shows the 2D cross-section, the explorer its list and cards, and
  the film its narration and captions.
* Body text is 15–17 px and no text is smaller than 11 px; colour is never the only signal.
* Touch: drag to orbit, pinch to zoom, tap a machine; on touch screens every control is at
  least 44 px tall.

## Performance

*Round three* (details and measurements in [`docs/ROUND3.md`](docs/ROUND3.md)):

* **Quality tiers** (`stage/quality.ts`): high, medium, low — pixel-ratio cap, shadow-map
  size and shadow refresh — chosen from the renderer, cores, memory and screen, and stepped
  from measured frame rates; `?quality=` forces one, `?diag=1` shows a developer overlay with
  buttons to switch. A tier never changes what is shown or when.
* **Shadow maps are redrawn only when something that casts them may have moved** (a mounted
  machine's presented progress changed, a housing is opening, the lit machine changed, a
  model mounted), with a periodic refresh for decorative motion; a camera move alone never
  redraws them.
* **The cross-section is meshed in a worker** (`device/mesh.worker.ts`, which also computes
  the process state), cached (12 geometries) and prepared ahead for the rest of the step;
  the previous geometry stays on screen until the next arrives. The mesher itself now
  writes typed buffers (identical output, about 1.6× faster).
* **The resist is drawn in the wafer's shader**: going on, from the exact lesson progress,
  and afterwards (coated, baked, exposed) from the simulated film, with thin-film colours
  from a 256-entry lookup computed once per film stack; the texture shows the surface under
  it and is not repainted as the coat spreads or when the resist is baked or exposed, and a
  wafer never changes look when one lesson hands it to the next. The deposited film, the
  exposure fields and the probe map are drawn the same way.
* **Housings open once and stay open** (a housing at its target no longer steps back and
  forth every frame), and **the studio environments render once** (drei's `Environment`
  re-rendered its cube map with every re-render of the lighting: at every lesson change and
  every hover in the explorer).
* Cross-fades copy the displayed picture instead of rendering into a 4-sample half-float
  target; the canvas no longer preserves its drawing buffer (capture tools ask for it with
  `?capture=1`).
* The film plans each silent move once and reuses it (it re-planned, building two
  Catmull-Rom curves, every frame of every gap).
* **No shader program is compiled where the picture moves**: see the stage's readiness above
  (shared preparation, the programs used when the camera is still) and the constant light
  count. The scanner's last lens element is plain transparency rather than transmission
  (which made three.js draw every opaque object in view twice per frame). The cross-section
  has no contact shadow: drei's `ContactShadows` looked at the block from below, where the
  mesher emits no faces, and drew nothing but cost three programs, two render targets per step
  and a full-floor transparent plane.
* **Thin-film colour tables** (`sim/filmColor.ts` `colorsWithTop`): the layers under the film
  are multiplied out once per wavelength and the top film is computed in plain numbers, so a
  256-entry table costs about 2 ms instead of 20–90 ms (the table is rebuilt at every
  operation change of a live film).

* A full replay of all 125 ops takes ~200 ms; seeking inside a step replays at most a few
  ops from a cached checkpoint. Electrical extraction ~30 ms. Device meshing 50–100 ms per
  change (only when the state changes).
* The wafer map runs in a Web Worker and is cached per choice set.
* Tool scenes are code-split and loaded on demand; the environment map is generated
  procedurally (no HDR downloads).
* *Round two:* the bay is merged and pre-lit (about 50 draw calls for the whole fab); only
  the machines near the camera draw their detailed models, and only the one the story is at
  opens its housing. A view costs 10–550 draw calls and 15–410 k triangles, and 0.5–4 ms of
  main-thread time per frame (`node scripts/stats.mjs`; the table is in
  [`docs/ROUND2.md`](docs/ROUND2.md#performance)). The pixel ratio drops when frames are slow
  (`PerformanceMonitor`), and the film preloads one narration segment ahead.

## Tests

* `npm test` — Vitest. `src/sim/model.test.ts` (the process model): positive resist removes
  exposed areas; litho precedes etch (exposure alone changes no geometry; etch follows the
  developed openings); deterministic replay and seek (cached vs fresh, any order); overlay
  failure; the inverter truth table; wafer map; diagnosis. `src/content/beats.test.ts`: every
  step has captions, in order from its start, each one idea of 12–24 words, and the caption
  shown follows progress. `src/watch/timeline.test.ts`: the built narration matches the
  script and the film definition; the film runs 10–15 minutes with every step in order;
  time maps monotonically onto segments and step progress; each process change happens while
  the sentence describing it is spoken; captions follow the narration and the final test's
  switch flips on its cue. *Round three:* `src/three/stage/round3.test.ts` — the track's
  robot ends each lesson exactly where the next one starts (wafer, carriage, fork, pins and
  chucks), never moves the wafer faster than 0.09 m per 1/30 s, hands it between chuck and
  fork without a step, keeps every axis under 2.8 m/s (chucks and pins under 0.5 m/s), and
  stops spins on whole turns; the thin-film colour table equals the full stack computation
  (metal, dielectric and resist tops, thin and opaque); the scanner's stage paths (the chuck exchange, the alignment marks, the
  step-and-scan meander) are continuous; tracks pass through intermediate framings on time
  and velocity-continuous, and hold on repeated framings; the wafer changes hands halfway
  along the first move between machines; the starting quality tier follows the device.
  *Round four:* `src/three/stage/round4.test.ts` — section cuts (a closed wedge cuts nothing of
  its chamber, an open one exactly its sector, for plain, turned and mirrored chambers; a
  chamber opens only once its housing is open and closes before it; a lid wipes from the
  front); camera routes (leaving a wafer close-up the camera backs out along its line of sight,
  the move in from an establishing shot is direct, between machines facing each other across
  the aisle it pans round and never looks steeper than its two framings); the room
  (establishing shots over the aisle and under the ceiling with a lens that keeps the framing,
  a narrow screen's fit inside the room, the etch → polisher move under the ceiling); leaving
  your die for another machine (the machine's own framing, a dissolve, upward from the load
  lock); *Inspect layers* in place where the wafer is out of view, and back; the lithography
  cell (process order, short carries, the scanner east of the track, the immersion gap); the
  stage clock under a dialog.
* `npm run e2e` — Playwright against the production build at desktop (1440 × 900), tablet
  (1024 × 768, touch) and phone (390 × 844, touch) sizes. Any console error fails a test.
  * `layout` — wordmark, headline and actions never collide or overflow at ten sizes (from
    a 320 px phone to 1920 × 640, landscape phones, a laptop at 200 % zoom), at normal and
    150 % text size, and with the web fonts blocked; the lesson header keeps brand, place
    and actions apart.
  * `modes` — changing scale never changes the step, choices, checks or the simulation hash;
    Explore pauses and snapshots the lesson and Return restores it exactly (camera included)
    with a Resume offer; chapters drawer, deep links, Back/Forward and refresh agree; rapid
    navigation never lets a stale camera move finish; scrubbing forwards and back equals
    playing.
  * `explore` — every machine opens from the equipment list by keyboard, and by clicking or
    tapping it in the bay; hover names a machine; a drag of the view is not a click. (That a
    demonstration leaves the learning run untouched is checked in `modes`.)
  * `watch` — the film reaches the working inverter on its own without asking a quiz or
    changing the saved run; the picture's clock stays within 150 ms of the narration through
    pause, seek, 1.5× speed, mute, a chapter jump and a spell in the background; slow audio
    makes the whole picture wait (buffering); audio that cannot load gives an honest
    captions-only film.
  * `offline` — Save for offline downloads and verifies every file, then the film plays with
    the network cut; an interrupted download is reported and retry completes it; too little
    storage is reported before anything downloads.
  * `fallbacks` — reduced motion (the step plays, captions follow it, the camera only cuts);
    no WebGL (2D lesson, equipment list, captioned film).
  * `journey`, `experiments` — round one's full first run through all 37 steps to a working
    inverter and the recap, keyboard use, and the experiments (overlay, dose, skipped clean).
  * `canvas` — reads the WebGL drawing buffer back: a lesson and the film draw a picture
    with real contrast, and it changes from frame to frame.
  * *Round three, frame by frame (desktop):* `continuity` — leaving a lesson half-way with a
    non-default dose keeps the scanner exactly as it was (run, progress, the wafer where it
    was, still in the scanner as the move begins) with one learner wafer on screen; the
    cross-section fade reversed at six points and five rapid reversals never jump and end
    where the last request points; rising out of the layers to leave for another machine,
    your die fades in with the wafer still in the machine being left; the track carries the wafer from module to module (no
    teleport, always exactly one wafer in the track); going back on the same machine
    dissolves; reduced motion only cross-fades between still compositions; a resize during
    a move stays continuous; a forward-and-back navigation loop does not accumulate
    geometries, textures or shader programs; a hidden page resumes a move where it left it
    (real time). `loading` (the track's module held at the network from its first request,
    since the next lesson's machine is loaded ahead) — the camera waits for the model however
    long it is held and says what it is waiting for; changing your mind while it loads ends
    the wait, and the model arriving later does not take the camera there; a model that cannot
    load is shown from outside with a notice while the stage keeps working; the first
    picture is veiled until its machine is ready. `film-continuity` — a gap's move is
    planned once and reused, and planned again for a new viewport; a seek shows exactly the
    frame playing reaches (housings included); chapter jumps hold the last picture until the
    machine is ready and the stage shows the new time, then dissolve, never showing two wafers
    or an empty frame. `offline` also checks that the cross-section's
    worker comes from the saved build.
  * *Round four* (`round4`, frame by frame at desktop size unless noted): a machine is shown
    closed, opens as the camera moves in and its chamber after it; each machine of the
    lithography loop keeps its parts and your wafer inside its housing's outline; the camera
    travels through free space (seven moves: the path ray-cast between frames, every frame's
    luminance spread above a floor, no one-frame jump); the magnified inset (desktop and
    phone) and its absence over the layers; Watch waits for a machine that is still loading
    (harness clock, and in real time with the narration: *Play*, a seek, a background tab); no
    shader program is linked in the middle of the move to the etch cluster; the last lesson
    loads in fresh browsers without freezing; Chapters over a busy stage in real time (opaque
    as it appears, not one frame of the stage under it, the lesson and the stage clock still, one
    redraw after a resize) and every chapter's first lesson opened from the drawer (desktop and
    phone); reduced motion opens a machine and its chamber at once.

  Frame-stepped tests (`?virt=1`) step until the camera has arrived (`settle`) rather than a
  fixed number of frames. On the build machine (software WebGL, 4 cores) the whole suite
  took 1.4 hours on round three's build and 3.6 on round four's (whose frames cost about twice
  as much there).
* `npm run screenshots` — regenerates `docs/screenshots/round2/`.
* `node scripts/cue-alignment.mjs` — decodes the narration in the browser and compares where
  speech starts and ends with the cue times the film uses.
* `node scripts/stats.mjs` — renderer statistics per view (below).

## Adding a step

1. Add the step to `FLOW` in `src/sim/flow.ts` with its operations.
2. Add its copy in `src/content/steps.ts` (scene, view, duration, `at` times, control/check)
   and its captions in `src/content/beats.ts` (one idea each, 12–24 words, timed in step
   progress; `npm test` checks the length and order).
3. If it needs a new machine, add a scene in `src/three/tools/`, register it in
   `tools/index.tsx`, give it poses (with its `mount` and `cutaway`) in `tools/poses/`, a
   station in `tools/poses/fab.ts` and a housing in `tools/Fab.tsx`, and list it in
   `state/nav.ts` (`MACHINES`) and `content/machines.ts` (what the explorer says about it).
4. The camera follows the default grammar for the step's view; add a track to `SHOTS` in
   `src/content/shots.ts` only if the step needs different direction.
5. For the film, add a segment to `src/content/narration.json` and `src/content/film.ts`,
   bump the narration `version`, and run `tools/narration/build.sh` (see its README).
6. Run `npm test` (determinism tests cover the new ops automatically) and `npm run e2e`.
