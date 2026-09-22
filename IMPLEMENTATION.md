# FAB / ONE — implementation notes

How the app is put together: the state model, how each journey step maps onto it, and how
the views read from it. For what is physically right and what is simplified, see
[`ACCURACY.md`](ACCURACY.md). The plan written before building is in
[`docs/PLAN.md`](docs/PLAN.md).

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
progress `p` is `stateAt(plan, start + number of ops whose time ≤ p)`. Scrubbing, replaying,
reduced motion (jump to 1) and deep links (`?step=…&p=…`) all use this same function, so
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

## How the views read the state

| view | reads | notes |
|---|---|---|
| Device cutaway (`three/device`) | `useSimState().grid` | face-culled mesh, top faces merged along x; groups for semiconductors, dielectrics (x-ray ghost option), metals, resist and the glowing conduction path; labels come from the same grid |
| 2D cross-section, layer inset (`ui/CrossSection.tsx`, `ui/Viewport.tsx`) | grid at `CUT_Y` | the inset samples the stack over the NMOS drain |
| "What changed?" (`ui/Overlays.tsx`) | state at step start and step end | slider blends the two cross-sections |
| Wafer (`three/WaferScene.tsx`, `three/wafer/`) | wafer summary + films | colour from a thin-film interference model (`sim/filmColor.ts`); fields, dies, particles, latent image and die map drawn into one canvas texture |
| Tool scenes (`three/tools/*`) | step progress (`useClock`), wafer films | the wafer inside each tool uses the same colour model; light paths are overlays toggled by the learner |
| Step panel (`ui/StepPanel.tsx`, `ui/panels.tsx`) | metrology, diagnosis, electrical, wafer map | every number shown is measured from the simulated state |

Rendering never writes to the model. The only inputs to the model are the choices.

## Journey: step → scene → operations

View: the default zoom level when the step opens (fab · tool · wafer · device). Learners can
switch with the level control or keys 1–4. Ops: operation kinds in the step (count).

| # | chapter | id | title | scene / variant | view | ops | interaction |
|---|---|---|---|---|---|---|---|
| 1 | wafer | `arrive` | Meet the wafer | foup / dock | tool | receive (1) | — |
| 2 | wafer | `transfer` | Move it without touching | foup / robot | tool | — (0) | — |
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
| `Foup` | arrive, transfer | overhead hoist, FOUP on a load port, EFEM robot moving a wafer into a tool |
| `Inspect` | scan, inspect | optical inspection: wafer on a stage under a scanning beam, defect review |
| `WetClean` | clean | single-wafer spin clean with chemical/rinse arms |
| `Furnace` | padox, anneal | vertical furnace: quartz tube and boat |
| `Etch` | sti-etch, gate-etch, contact-etch, strip | plasma etch chamber with glow, ashing variant |
| `Cmp` | sti-fill, contact-fill, metal1, metal2 | rotating pad, carrier head, slurry arm, conditioner |
| `Implant` | wells, sd | ion source, analyser magnet, beamline, end station |
| `Depo` | gatestack, pmd, passivate | deposition chamber with showerhead |
| `Track` | prime, coat, softbake, peb, develop | coater/developer track: spin cup, dispense arm, hot plates, developer puddle |
| `Scanner` | reticle, align, expose, contact steps | 193 nm DUV scanner: illuminator, reticle stage, projection lens, dual wafer stages; toggled light path |
| `Metrology` | adi | CD-SEM / overlay metrology station |
| `Prober` | probe | probe card over a wafer on a chuck, wafer map |
| `Dicing` | dice | blade saw on a taped wafer frame |
| `Package` | attach, bond | die attach and wire bonder |
| `TestBench` | final | packaged chip on a test board |
| `Fab` | fab level of every step | the bay: tools in a row, highlighting the current one |

Equipment is stylised and procedural (no external models or textures). Light paths are
drawn only when the learner turns them on.

### Camera and transitions (`src/three/Stage.tsx`, `src/three/poses.ts`)

Each (view, scene, variant) has a camera pose. Changing zoom level fades the canvas and
starts the camera pulled back (zooming in) or pushed in (zooming out) so the change of
scale reads as a move. A scale chip names the level ("Fab bay · tens of metres across",
"Wafer · 300 mm across; particles and dies drawn larger", "One inverter cell · a few
micrometres across · greatly magnified, schematic"). With reduced motion the camera cuts
instead of gliding.

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

* `src/ui/Home.tsx` — landing page with the fab hero.
* `src/ui/Chrome.tsx` — header (wordmark, chapter, Stages) and footer (chapter progress).
* `src/ui/StepPanel.tsx` — one step: meta line, title, one sentence, the step's single control
  or check, then "What changes" / "Why it matters" (revealed as the animation plays),
  links to Look closer / What changed? / Legend, and Replay / Continue.
* `src/ui/Viewport.tsx` — the canvas, zoom levels, cutaway/x-ray or light-path toggles,
  scrubber and the layer inset.
* `src/ui/Overlays.tsx` — Stages overview, Look closer drawer (labelled section,
  explanation, one source), What changed? comparison, Legend, DUV vs EUV explainer, Recap.
* `src/content/steps.ts`, `glossary.ts`, `sources.ts` — all learner-facing copy and sources.
  Glossary terms are marked `[[termId|text]]` in the copy and defined at first use.
* `src/three/labels.tsx` — scenes declare labels; one DOM layer draws them and a projector
  moves them each frame, avoiding overlaps and the viewport controls.

## Accessibility

* Every control is a native button, radio group or range input with a label; keyboard
  shortcuts: ←/→ step, Space play/pause, R replay, S stages, L look closer, 1–4 zoom level,
  0/1 input on the final test, Esc closes panels.
* Focus moves to the step title on each step; dialogs trap focus and restore it on close.
* `prefers-reduced-motion` (or `?motion=reduce`) removes camera glides and fades and shows
  each step's end state; animation remains available through the scrubber.
* The 3D view is described in text (the region label and the step panel); every value that
  matters is also in the panel.
* Body text is 15–17 px and no text is smaller than 11 px; colour is never the only signal
  (labels, readouts and wording carry the same information).
* Touch: drag to orbit, pinch to zoom; on touch screens every control is at least 44 px tall.

## Performance

* A full replay of all 125 ops takes ~200 ms; seeking inside a step replays at most a few
  ops from a cached checkpoint. Electrical extraction ~30 ms. Device meshing 50–100 ms per
  change (only when the state changes).
* The wafer map runs in a Web Worker and is cached per choice set.
* Tool scenes are code-split and loaded on demand; the environment map is generated
  procedurally (no HDR downloads). The device ground shadow is baked once per step.

## Tests

* `npm test` — Vitest on the process model (`src/sim/model.test.ts`): positive resist removes
  exposed areas; litho precedes etch (exposure alone changes no geometry; etch follows the
  developed openings); deterministic replay and seek (cached vs fresh, any order); overlay
  failure; the inverter truth table; wafer map; diagnosis.
* `npm run e2e` — Playwright against the production build at desktop, tablet and mobile
  sizes: the full first-run journey to a working inverter and the recap; keyboard use;
  reduced motion; overlay failure and restore; under-exposure, rework and recovery;
  skipped clean lowering yield. Console errors fail the tests.
* `npm run screenshots` — regenerates `docs/screenshots/`.

## Adding a step

1. Add the step to `FLOW` in `src/sim/flow.ts` with its operations.
2. Add its copy in `src/content/steps.ts` (scene, view, duration, `at` times, control/check).
3. If it needs a new scene, add a module in `src/three/tools/`, register it in
   `tools/index.tsx`, and give it poses in `tools/poses/`.
4. Run `npm test` (determinism tests cover the new ops automatically) and `npm run e2e`.
