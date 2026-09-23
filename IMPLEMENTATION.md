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
| `Etch` | sti-etch, gate-etch, contact-etch (`etch`), strip (`ash`) | cluster (EFEM, load lock, transfer robot) and a cutaway chamber: electrostatic chuck, slit valve, endpoint viewport, turbo pump; inductive coil, showerhead or dome source depending on the step; soft plasma glow during the etch |
| `Cmp` | sti-fill, contact-fill, metal1, metal2 | rotating grooved pad, carrier head pressing the wafer face-down, slurry arm, diamond conditioner, load cup that flips the wafer, clean/dry module |
| `Implant` | wells, sd | high-voltage terminal and source, 90° analyser magnet, resolving slit, acceleration column, scanner and corrector magnet, end station with load lock; the wafer is loaded, tilted 7° to face the beam and scanned, once per mask; ion beam only with the beam-path toggle |
| `Depo` | gatestack (`poly`), pmd (`oxide`), passivate (`pass`) | cluster with a frog-leg robot; the cutaway chamber's heater lifts the wafer under a showerhead; the wafer shows the thin-film colour of the growing film |
| `Track` | prime, coat, softbake, peb, develop | coater/developer track: spin cup, dispense arm, hot plates, developer puddle |
| `Scanner` | reticle, align, expose, contact steps | 193 nm DUV scanner: illuminator, reticle stage, projection lens, dual wafer stages; toggled light path |
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
  takes** (no timeout); after 250 ms the page says what it is waiting for. A model that fails
  to load (a module that cannot be fetched) is caught by its own error boundary: the machine
  is framed from outside (`machinePose`), a notice offers a reload, and the rest of the stage
  keeps working. Until the first picture has its machine ready, a veil covers the canvas, so
  a deep link never shows a half-built scene; the lesson clock starts after that. The
  clipped housing materials are compiled once, up front (`Fab.tsx`), so a housing's first
  opening does not stall.
* A machine the story **leaves** keeps its real last frame — its lesson, run choices,
  overlays and progress, frozen — until it is out of view (outside the camera frustum, or
  hidden by level of detail) and the camera has settled; at most two are held.
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
faces drawn double-sided) to reveal the detailed interior. A machine that loads while the
camera is already there opens at once, and reduced motion skips the wipe. Machines without a
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
  Nine steps are directed by hand, because the wafer is not always in (or visible in)
  the step's machine: in sti-etch, wells, contact-fill and metal1 the lithography, deposition
  or etch before the machine's own action happens in other tools, so the camera stays with
  the layers, comes out to the machine when the wafer arrives, and goes back down through the
  wafer afterwards; the furnace, the hot-plate lid and the ash chamber's plasma enclose the
  wafer, so anneal, peb and strip go down to the layers before they close or from the
  machine itself; sd and metal2 repeat a loop already shown and stay in the layers. A
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
  interpolates with it, so no move or film gap switches it suddenly. No track frames your
  die while its wafer turns (spins happen while the camera frames the machine or the whole
  wafer, a framing that does not depend on the wafer's rotation), and spins stop on whole
  turns, so the next lesson finds the die where it was. The key light and shadows follow the
  story to the next machine at the wafer hand-over, while the camera is between machines.
* **Clocks** (`stage/time.ts`): flights, the lesson clock and the demonstration clock run on
  the stage clock, which stops while the page is hidden, and lesson progress is measured
  from when playback (re)started rather than accumulated from frame deltas, so a slow frame
  never slows a lesson and a hidden tab resumes where it was. Decorative motion (fans,
  flicker, the overhead vehicles, the signal glow) reads one decorative time: the stage
  clock, or the film's own time in Watch (so a seek shows exactly the frame playing would);
  it stops under reduced motion. The harness clock (`?virt=1`) passes seconds to three.js'
  clock (round two passed milliseconds, which made decorative motion 1000× too fast in
  recordings).
* **Free look**: dragging, pinching or scrolling hands the camera to the learner (Learn and
  Explore); *Guided view* / *Reset view* flies back. Explore keeps the camera inside the
  building (camera-controls boundary).
* Framings are composed for a landscape viewport; narrower viewports pull the camera back
  along its view direction. The explorer's whole-fab view on a portrait screen is instead
  fitted to the machines' boxes (on a phone, into the space above the compact overview card),
  and the fog is pushed back with the camera distance so a distant overview stays readable.
* A quiet **scale label** says what the picture shows (Fab bay, Equipment view, Wafer
  surface, Magnified cross-section · schematic); it comes from the framing, not a control.

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
  the frame that playing would.
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
* **The resist coat is drawn in the wafer's shader** from the exact lesson progress, with
  thin-film colours from a 256-entry lookup computed once per film stack; the texture is no
  longer repainted and re-uploaded as the coat spreads.
* Cross-fades copy the displayed picture instead of rendering into a 4-sample half-float
  target; the canvas no longer preserves its drawing buffer (capture tools ask for it with
  `?capture=1`).
* The film plans each silent move once and reuses it (it re-planned, building two
  Catmull-Rom curves, every frame of every gap).

* A full replay of all 125 ops takes ~200 ms; seeking inside a step replays at most a few
  ops from a cached checkpoint. Electrical extraction ~30 ms. Device meshing 50–100 ms per
  change (only when the state changes).
* The wafer map runs in a Web Worker and is cached per choice set.
* Tool scenes are code-split and loaded on demand; the environment map is generated
  procedurally (no HDR downloads). The device ground shadow is baked once per step.
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
  switch flips on its cue.
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

  Frame-stepped tests (`?virt=1`) step until the camera has arrived (`settle`) rather than a
  fixed number of frames. On the build machine (software WebGL, 4 cores) the whole suite
  takes about an hour.
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
