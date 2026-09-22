# FAB / ONE — implementation plan

A short plan written before building. It records the decisions that shape the code; the
finished design is described in `IMPLEMENTATION.md` and the physics caveats in `ACCURACY.md`.

## Stack

Vite + React 19 + TypeScript, Three.js through React Three Fiber and drei, zustand for UI
state, Vitest for the process model, Playwright (pinned to the pre-installed Chromium) for
browser checks. No backend, no network assets: geometry is procedural, lighting comes from
a procedural environment, fonts are bundled from `@fontsource`.

## Core idea: one deterministic process model drives everything

`src/sim` is plain TypeScript with no React or Three.js imports.

* **Die grid.** The illustrative inverter cell is a 96 × 64 grid of columns. Each column is
  a bottom-to-top stack of segments `(material, top z, doping/state tag, aux value)`.
  Deposition, oxidation, coating, etching, implanting, CMP and stripping are pure functions
  on this grid. The 3D cutaway, the 2D cross-section, the layer inset and the electrical
  test all read the same grid.
* **Wafer summary.** A small record next to the grid holds wafer-scale facts (blanket film
  thicknesses for interference colour, resist state, particles, exposed fields, mask
  count, dicing state).
* **Operations and history.** Every step in the journey expands to a list of micro
  operations parameterised by the learner's choices. The full history is rebuilt from the
  choices. The state at any step and animation progress comes from replaying that history
  from the nearest cached checkpoint. Seeking or replaying always produces the same state.
* **Lithography model.** The mask is rasterised with any overlay offset applied, blurred
  with a Gaussian point-spread function to form an aerial image, and scaled by dose. The
  result is a latent image stored in the resist. Positive-tone development removes resist
  where the absorbed dose exceeds a threshold, with Beer–Lambert absorption through the
  film depth. Exposure changes only the resist. Etch and implant come later and act only
  where resist has been removed.
* **Electrical test.** Conductive segments (metal, tungsten, doped poly, n+/p+ silicon)
  are joined with union-find. Channels under gates conduct according to the gate net's
  logic level, and punch-through is flagged for very short gates. For IN = 0 and IN = 1
  the test finds whether OUT reaches VDD, GND, both (a short) or neither (floating).
  Pass/fail comes from the geometry the learner produced.
* **Wafer map.** Each die gets local parameters: resist thickness from the radial spin
  profile, overlay (the global offset plus a small radial term) and particles. Dies with
  the same parameter bucket share one simulation, so the whole map uses real process runs.

## Journey (37 steps, 5 chapters)

Wafer → Transistors → Pattern → Connect → Test. Lithography (gate layer) gets the full
eleven-step cycle and the most time. Other lithography layers are shown in compressed
form and labelled as such. Each step defines copy (doing / changes / why), a tool scene,
a default view level (fab · tool · wafer · device), an animation duration, micro-ops, and
optionally a control, knowledge check, before/after comparison, "Look closer" content
and source.

Experiments: particle clean (ch 1), spin speed (ch 3), exposure dose (ch 3), contact
overlay (ch 4). After-develop inspection offers rework. The probe step and the final
inverter test show the downstream results. Every failure has a "restore default" path.

## Vertical slices

1. Scaffold, plan, process model plus unit tests (resist tone, litho→etch ordering,
   replay determinism, overlay failure, truth table).
2. UI shell (home, stage layout, progress, Stages overview) wired to the model, with the
   device cutaway and 2D section.
3. Wafer renderer (thin-film colours, die grid, fields, particles, die map).
4. Tool scenes, starting with the lithography cluster (track, scanner, etch), then the
   rest of the flow, then the fab bay.
5. Experiments, checks, comparisons, recap, accessibility and reduced motion.
6. Browser verification at desktop and mobile sizes, screenshots, fixes, documentation.
