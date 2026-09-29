# FAB / ONE — round four: believable equipment and photolithography you can follow

What changed so that the machines read as fab equipment and the lithography steps read as what
really happens, what it is based on, how it was checked, and what is still schematic. The design
notes are in [`IMPLEMENTATION.md`](../IMPLEMENTATION.md) (sections marked *round four*); the
accuracy notes and sources are in [`ACCURACY.md`](../ACCURACY.md).

Start: branch `claude/fab-one-round-three`, commit `be6bf3f` (docs of round three; the last
application code there is `82093cf`). This round: branch `claude/fab-one-round-four-realism-x1ze0a`,
end commit given in [Verification](#verification-commands-and-results).

## What you will see

* **Machines look like fab equipment, and are seen closed first.** Every housing is drawn with
  physically based finishes under a cleanroom reflection environment (light strips in the
  ceiling, a dark tool band, the floor): powder-coated panels, brushed and anodised metal,
  smoked glass. Fronts carry what real ones do — service doors with gaps and pulls, kick
  grilles, load ports with pods, operator panels, red emergency-off buttons on yellow plates.
  Arriving at a machine the camera first holds on it **closed**; the housing opens only as the
  camera moves in, and the scale label says *cutaway view · covers drawn removed*. Opened
  walls have a thickness and their cut faces are drawn as a technical illustration's hatched
  sections, not as a shell with a wall missing.
* **Vacuum chambers are whole until they are shown opened.** The etch and deposition chambers
  in use stay closed vessels while the housing opens; then a wedge toward the aisle is cut
  away (hatched sections) and the transfer chamber's lid is wiped off, and they close again
  before the housing does. The robot passes the wafer through the slit valve, the pins set it
  on the chuck, the blade withdraws, the valve seals the chamber, and only then does the
  plasma strike — a restrained, bounded glow over the wafer.
* **The coater/developer track reads as one.** Carrier block, process block and interface
  block stand in the bay's order (the interface against the scanner); the working line runs
  prime → coat → soft bake → develop → post-exposure bake, each carry short. A four-nozzle
  resist arm swings from its solvent bath over the wafer, an edge-bead-removal jet clears the
  rim, the liquid reads as a puddle with a meniscus, the developer is laid by a slit-nozzle bar
  and rinsed, plates have lids and proximity pins.
* **The scanner is a scanner.** A closed, panelled enclosure with a reticle pod port; inside, a
  1.28 m lens in its metrology frame, alignment and level sensors over the measuring stage, two
  wafer stages with encoder heads on a planar-motor base, a reticle with a real-looking chrome
  pattern carried from its library by a handler. The immersion hood rides 0.5 mm and the last
  lens element 1 mm over the wafer, as in production tools — too thin to see at machine scale,
  so a titled **magnified inset** shows the water film under the lens, the hood feeding and
  extracting it, and the wafer moving beneath. The 193 nm light is invisible: its path is drawn
  only when the learner (or the film) turns on the light-path overlay — then over the machine's
  parts, from the reticle through the lens to the wafer — and the picture names it as an
  overlay while it is shown.
* **The polisher is wet.** The pad turns glossy as slurry reaches it; slurry banks against the
  carrier's retaining ring while the head presses down.
* **Dies look like dies.** Close to the wafer, every die shows one floor plan — seal ring, pad
  ring, arrays, logic, analog blocks, wiring — gaining contrast with each layer, with pads once
  there is metal; the reticle carries the same plan at 4×. The wafer's rim is rounded.
* **The camera travels through free space.** Among the machines it stays over the aisle and
  under the ceiling (a large machine is established with a wider lens, not from over the other
  row at the ceiling, where round three's camera went through it). Leaving your die for another
  machine it first returns to that machine's own view (from the etch cluster's load lock it
  backs out upward) before travelling; the move in from an
  establishing shot is direct; *Inspect layers* at a machine whose wafer is out of view reveals
  the layers from where the camera is; between machines that face each other across the aisle
  it pans round instead of dipping to the floor. The blank frames between the dicing saw and
  the die bonder are gone.
* **In Watch, the narration waits for the picture.** If a machine is still loading when the film
  needs it, the film's clock and narration pause where they are (the page says what it is
  waiting for) and carry on from the same moment once it is in. In a background tab, with no
  picture to wait for, the narration plays on.
* **Chapters opens, even over a busy 3D stage.** A dialog over the stage — Chapters, Look
  closer, the equipment list — stops the stage while it is open: it slides in fully opaque, every
  frame the browser can make goes to it, and the lesson, a move or a demonstration carries on
  from where it was when it closes. Every chapter's first lesson opens from the drawer.

## Method

1. **Baseline.** Round three's build (`be6bf3f`) was built and served locally
   (`vite preview`) and kept running through the round, so every comparison was made against
   the same code: matched stills (`scripts/stills.mjs` with
   [`scripts/round4/stills-desktop.json`](../scripts/round4/stills-desktop.json) and
   [`stills-phone.json`](../scripts/round4/stills-phone.json): 54 stills of 33 lessons and views
   at fixed progress values at 1280 × 800, and 11 on a 390 × 844 phone at pixel ratio 2; quality
   tier *low* on both builds), the flight tests below, and the real-time measurements.
2. **References.** For each of the five machines of the lithography loop and the pattern
   transfer (track, scanner, etch, deposition, CMP), and more briefly for the other ten: layout,
   load port, chamber, moving parts, the wafer's position and orientation, what can be seen
   from outside, what is really visible and what is not. Written up as the matrix below before
   modelling, and checked against it after.
3. **Look development on builds, not on the dev server.** Each iteration was built into its own
   directory and served (so a capture was never disturbed by a hot reload), then compared with
   the baseline at the same lesson points. Moves were checked as frame sequences
   (`scripts/frames.mjs`, contact sheets) on the harness clock (`?virt=1`): every frame is
   rendered and read back, so the sequences show continuity, not smoothness.
4. **Continuity problems were reproduced before they were fixed**, on round three's build where
   they predate this round, and each fix has a test that fails without it (the list is in
   [Verification](#verification-commands-and-results)).
5. **Real-time behaviour** was measured with `scripts/perf.mjs` on both builds, one run at a
   time on an otherwise idle machine, in wall-clock time. The machine has no GPU: WebGL runs on
   SwiftShader, a CPU rasteriser, so the numbers compare the two builds with each other; they
   say nothing about a laptop's or a phone's frame rate.

## Reference matrix

How each machine is laid out, where the wafer is and which way up, what moves, what a person
standing at the tool can actually see, and what the app therefore draws as an *effect* (it is
really visible) or only as an *overlay* (it is invisible, and drawn only when the learner asks,
labelled as such). This is what the models were checked against; the machines remain
illustrative and generic — no manufacturer's model, photograph, CAD file, logo or branded shell
was copied, and none is named on screen.

**How the sources were read.** This session's network allowed search-engine results but refused
every page fetch (the equipment makers' sites, Wikipedia, patent servers, university lab pages:
see [Limitations](#remaining-limitations)). Every fact below therefore rests on search-result
excerpts of the linked pages, not on the pages read in full; where one excerpt cited several
pages, the likeliest source is linked. Patents describe one embodiment of a machine, not a
particular product. Where nothing was found (exterior sizes, windows), the model says so in
[`ACCURACY.md`](../ACCURACY.md) and makes a plain, labelled assumption.

### Summary

| Machine | Wafer during the process | What moves | Really visible (drawn as an effect) | Invisible (overlay only) |
|---|---|---|---|---|
| Coater/developer track | face up, flat, on a vacuum spin chuck; on proximity pins 0.05–0.2 mm over a hot plate | transfer arm (x, reach, lift, turn), chuck or lift pins in the cup, nozzle arm from its solvent bath, hot-plate lid, lift pins | liquid streams (resist, solvent, developer, water), spinning, the develop puddle | wafer-edge exposure light; heat (plates at 90–300 °C do not glow) |
| DUV immersion scanner | face up on a vacuum-clamped table; reticle pattern side down | two wafer tables (measure and expose), reticle stage scanning against the wafer at 4×, wafer and reticle handlers | essentially nothing: the machine is enclosed; the water film is real but about a millimetre thick, under the hood | 193 nm light, the slit, the optical path; the water film shown magnified |
| Plasma etch cluster | face up on an electrostatic chuck | pod door, front-end robot, load lock, vacuum robot, slit valves, lift pins (2–5 cm) | plasma glow, but only through a chamber viewport | ions, RF fields |
| Deposition cluster | face up on a heated pedestal under a showerhead | robot, lift pins, pedestal rising to the process position | PECVD glow between showerhead and pedestal (sealed chamber) | film growth (nm), gas flow |
| CMP polisher | **face down** in the carrier head, pressed onto the rotating pad | flip in the load cup, head on a swing arm, platen, conditioner arm, slurry arm | slurry and water on the pad, rotation, the sweeping arms | downforce zones, thickness sensing |
| Vertical furnace | flat, stacked in a vertical boat | multi-fork transfer robot, boat elevator, boat rotation | none (the heater is behind insulation) | heat, gas |
| Ion implanter | clamped to a platen turned from flat (load) to upright (scan) | platen turn and scan, robots | none | the ion beam |
| Single-wafer wet clean | face up on edge pins | spin chuck, swinging nozzle arms, splash cup rising and falling | sprays, spin | chemistry |
| Inspection, CD-SEM | face up on a stage (spiral scan for unpatterned inspection) | stage | none | laser, electron beam |
| Wafer prober | face up on an XYZθ chuck under a probe card whose needles face down | chuck: X–Y, then up into the needles (plus a small overtravel); docked test head | none | test signals |
| Dicing saw | on tape in a ring frame, on the chuck table | spindle and blade, table feed, spinner | cutting-water spray, the spinning blade | — |
| Die attach, wire bond, mould | die on tape; lead frame on a heated stage | ejector needles, collet and bond head, capillary, press | wire loops forming | ultrasonic energy |

### 1. Coater/developer track

* **Layout.** Blocks in a row: a carrier block with the pod load ports, one or more process
  blocks of *stacked* modules (coat and develop bowls; bake and chill plates stacked in towers),
  and an interface block that passes wafers to and from the scanner, in line with it. Modules
  named in lab and resale listings: resist coater, developer, BARC coater, low- and
  high-temperature hot plates, chill plate, HMDS prime.
  Sources: [US 7740410](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7740410),
  [EPFL CMi, TEL ACT-8](https://www.epfl.ch/research/facilities/cmi/equipment/photolithography/tel-cleantrack-act-8/),
  [resale listing, LITHIUS multi-block](https://www.macquarie.com/is/en/about/company/commodities-and-global-markets/specialised-and-asset-finance/electronics/inventory/semiconductor-fabrication/multi-block--resist-coater-developer-/227828.html).
* **Load port and transfer.** Carrier block: mounting table, pod opener and a transfer arm; the
  main arms move in X, Y, Z and turn. The interface block's arm hands wafers to the exposure tool
  and takes exposed ones back ([US 2009/0059187](https://patents.google.com/patent/US20090059187)).
* **Coat module.** Vacuum spin chuck in a cup with a drain and exhaust; handover either by the
  chuck rising out of the cup or by three lift pins in the cup
  ([US 8505479](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8505479),
  [US 8940365](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8940365)). The
  resist nozzle waits in a solvent-atmosphere standby bath and moves over the wafer centre to
  dispense ([US 8505479](https://patents.google.com/patent/US8505479)); a module can carry
  several resist nozzles (four lines per coater in the EPFL page and the listing above). Static or
  dynamic dispense, then acceleration to spread and thin
  ([US 6191053](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6191053)); spin
  speeds about 800–4000 rpm for thin to thick resists
  ([MicroChemicals](https://www.microchemicals.com/dokumente/application_notes/spin_coating_photoresist.pdf)).
  Edge-bead removal by a solvent nozzle at the edge, a backside rinse from below
  ([UCLA](https://nanolab.ucla.edu/project/svg-track-coater/),
  [US 6453916](https://patents.google.com/patent/US6453916B1/en)).
* **Bake.** The wafer rests on proximity pins over the plate (about 0.1 mm), lift pins raise it,
  a lid comes down to close the treatment space
  ([US 11222783](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11222783),
  [US 8757089](https://patents.justia.com/patent/8757089)).
* **Develop.** A slit nozzle lays developer across the wafer; the puddle stands still; rinse,
  then spin-dry ([US 8398319](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8398319),
  [US 5897982](https://patents.google.com/patent/US5897982),
  [US 6759179](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6759179)).
* **Seen from outside.** Nothing sourced: no evidence of windows on production tracks. The app
  draws the track closed (service doors, grilles), and opens it only as an illustration's cutaway.
* **Effect / overlay.** Liquids, spin and the puddle are drawn; bake plates are not drawn glowing
  (they run below the ~525 °C [Draper point](https://en.wikipedia.org/wiki/Draper_point)).

### 2. DUV immersion scanner

* **Size and parts.** The highest-resolution DUV lenses are "more than 1.2 meters tall and weighing
  more than a metric ton" (NA 1.35, 4× reduction, 26 × 33 mm field)
  ([ASML, lenses and mirrors](https://www.asml.com/en/technology/lithography-principles/lenses-and-mirrors),
  [ASML NXT:2000i](https://www.asml.com/en/products/duv-lithography-systems/twinscan-nxt2000i)).
  A separate 193 nm ArF excimer laser feeds it through an enclosed beam delivery
  ([ASML, light and lasers](https://www.asml.com/en/technology/lithography-principles/light-and-lasers),
  [US 7016388](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7016388)).
* **Handling.** A wafer handler and a reticle handler; wafers arrive in line from the track;
  reticles come in pods through a reticle library with a pre-aligner and barcode reader
  ([ASML, mechanics](https://www.asml.com/en/technology/lithography-principles/mechanics-and-mechatronics),
  [EPFL CMi, PAS 5500](https://www.epfl.ch/research/facilities/cmi/equipment/photolithography/asml-pas-5500-350c/)).
* **Stages.** Two wafer tables: one is measured (alignment, levelling) while the other is exposed,
  on a planar, magnetically levitated stage; the reticle stage scans opposite to the wafer, four
  times as far and as fast; wafer position is measured about 20,000 times a second
  ([ASML, mechanics](https://www.asml.com/en/technology/lithography-principles/mechanics-and-mechatronics),
  [ASML, measuring accuracy](https://www.asml.com/en/technology/lithography-principles/measuring-accuracy),
  [ASML NXT:1965Ci](https://www.asml.com/en/products/duv-lithography-systems/twinscan-nxt-1965ci)).
* **Immersion.** A hood "formed a ring around the last lens element to control the puddle"
  ([ASML, immersion](https://www.asml.com/en/news/stories/2023/how-immersion-lithography-saved-moores-law));
  its underside rides "about 0.1 mm to about 1 mm" over the wafer, air knives holding the water in
  ([US 9632426](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9632426)). The
  water is local to the lens, never across the wafer.
* **Reticle.** Pattern side down, held by vacuum; a pellicle on a frame a few millimetres under
  the pattern ([US 6614504](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6614504),
  [US 12346034](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12346034)); a slit
  field stop and masking blades shape the light
  ([US 5677754](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/5677754)).
* **Seen from outside.** Nothing sourced; treated as fully enclosed (no glazing in the app).
* **Effect / overlay.** 193 nm is invisible
  ([ZEISS SMT](https://www.zeiss.com/semiconductor-manufacturing-technology/smt-magazine/so-does-euv-lithography-work.html)):
  the slit, the beam and the optical path are drawn only with the *Light path* overlay; the water
  film is drawn at its real thickness and shown in a titled, magnified inset. No EUV parts (mirrors,
  vacuum) are mixed in.

### 3. Plasma etch cluster

* **Layout.** Equipment front end with load ports, load locks, a vacuum transfer chamber with a
  central robot (often frog-leg or SCARA), process chambers around it behind slit valves
  ([US 10366869](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10366869),
  [US 6291814](https://patents.google.com/patent/US6291814),
  [US 10453725](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10453725),
  [TEL Tactras](https://www.tel.com/product/tactras.html)).
* **Chamber.** Inductive (planar coil over a dielectric window) or capacitive (showerhead
  electrode, confinement rings) sources
  ([US 9767996](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9767996),
  [US 9190302](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9190302)); a
  pendulum throttle valve between chamber and turbo pump
  ([US 2013/0115776](https://patents.google.com/patent/US20130115776)); an optical-emission
  viewport through which plasma light leaves the chamber
  ([US 11862442](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11862442)).
* **Sequence.** The blade passes through the slit valve, lift pins take the wafer (2–5 cm) and
  lower it onto the chuck, the blade withdraws and the valve closes to seal the chamber — then the
  plasma ([US 10023954](https://patents.google.com/patent/US10023954),
  [US 5491603](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/5491603)).
* **Seen from outside.** Only the viewport, from behind the covers (unconfirmed from the aisle).
* **Effect / overlay.** A bounded glow in the gap over the wafer, hue by chemistry
  ([plasma.com](https://www.plasma.com/en/plasma-technology-glossary/colour-of-the-plasma/)); ions
  and RF are not drawn.

### 4. Deposition cluster

* **Chambers.** A heated pedestal under a showerhead; the robot brings the wafer through the slit
  valve, pins take it, the pedestal rises to the process gap (millimetres)
  ([US 5882411](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/5882411),
  [US 8282734](https://patents.google.com/patent/US8282734B2/en)); multi-station tools index
  wafers between pedestals ([US 9484233](https://patents.google.com/patent/US9484233B2/en)).
* **Effect / overlay.** PECVD glow between faceplate and pedestal
  ([US 9725806](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9725806)); film
  growth is nanometres and is shown as the wafer's colour changing, not as a cloud.

### 5. CMP polisher

* **Process.** "Precise downforce across the backside of the wafer … pressing the front surface
  against a rotating pad" with slurry ([Applied, CMP](https://www.appliedmaterials.com/us/en/semiconductor/products/shape/cmp.html));
  the wafer is turned face down before the load cup
  ([US 6406359](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6406359),
  [US 7044832](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7044832)); a head
  on a swing arm, platen and head at about 50–115 rpm
  ([US 9144881](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9144881),
  [US 2006/0183407](https://patents.google.com/patent/US20060183407A1/en)); a retaining ring and a
  pressurised membrane in the head ([US 6272902](https://patents.google.com/patent/US6272902B1/en));
  conditioner and slurry arms over the pad ([US 6872127](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6872127));
  brush and megasonic cleaning, then drying ([US 9548222](https://patents.google.com/patent/US9548222)).
* **Effect / overlay.** Slurry, water and rotation are visible; downforce zones and thickness
  sensing are not drawn. Slurry colour is not confirmed by a source (drawn milky white).

### 6–12. The other machines

* **Vertical furnace:** wafers flat in a vertical boat, loaded five at a time by a multi-fork
  robot in a nitrogen loading area; the boat rises into a quartz tube inside an insulated heater
  ([US 5902103](https://www.freepatentsonline.com/5902103.html),
  [US 5676869](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/5676869),
  [US 7059849](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7059849)).
* **Ion implanter:** terminal with the source, analyser magnet, acceleration, scanner, end station;
  the platen turns from flat to upright to scan
  ([US 6130436](https://patents.google.com/patent/US6130436A/en),
  [US 6633046](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6633046)); the
  beam is not visible ([arXiv 1601.04907](https://arxiv.org/pdf/1601.04907)).
* **Wet clean:** chambers stacked in towers; edge-gripping spin chuck, swinging nozzle arms, a
  splash cup that rises and falls ([SCREEN SU-3200](https://www.screen.co.jp/spe/en/products/su-3200),
  [US 6863741](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6863741)).
* **Inspection and CD-SEM:** a laser scanned over a moving wafer, an electron column over a
  vacuum stage behind a load lock ([US 9116132](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9116132),
  [US 7405835](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7405835)); the
  beams are overlays.
* **Prober:** XYZθ chuck under a probe card whose needles face down, a docked test head on a
  manipulator; X–Y, then up into the needles with a small overtravel
  ([US 2011/0037492](https://patents.google.com/patent/US20110037492A1/en),
  [US 4755747](https://patents.google.com/patent/US4755747)).
* **Dicing saw:** spindle at 30,000–60,000 rpm, a 20–40 µm blade, cutting water, the wafer on tape
  in a frame ([DISCO DAD3350](https://www.disco.co.jp/eg/products/dicer/dad3350.html),
  [DISCO blade](https://www.discousa.com/eg/products/blade/zhzz.html)).
* **Die attach and wire bond:** ejector needles and a collet, epoxy on the pad, ball and stitch
  bonds from a capillary ([US 2013/0039733](https://patents.google.com/patent/US20130039733A1/en),
  [Sierra Circuits](https://www.protoexpress.com/blog/wire-bonding-efficient-interconnection-technique/)).

### Common vocabulary: load ports, front ends, the cleanroom

* Load ports put the pod's plate about 900 mm off the floor (SEMI E15.1, via
  [US 9834378](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9834378)); a pod
  is about 420 × 342 × 338 mm ([ePAK](https://www.epak.com/products/modular-foup-system/)); an
  equipment front end is a robot under a fan-filter unit with "skins" closing the mini-environment
  ([US 7066707](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7066707)).
* Emergency-off buttons are red mushrooms on a yellow plate, mounted 0.84–1.64 m high
  ([SEMI S2 checklist](https://www.semi.org/sites/semi.org/files/2020-08/AUX004-00-1100.pdf),
  [install note](https://docs.rs-online.com/137e/A700000012781286.pdf)).
* Air comes down from ceiling filter units through a perforated raised floor; lithography bays
  are lit yellow (resists are sensitive below 500 nm)
  ([MicroChemicals](https://www.microchemicals.com/PRODUCTS/Yellow-light-products/)).

## What changed, machine by machine

### Look: environment and materials

* `src/three/Stage.tsx` (`WorldEnvironment`): the reflection environment is a cleanroom — a grid
  of ceiling light strips over a mid-grey background, darker walls, a dark band at tool height
  and the floor — instead of a uniform grey, so metals read as metal (they reflect structure)
  rather than as grey plastic. Ambient and hemisphere light were lowered to match.
* `src/three/materials.ts`: the palette was retuned toward real finishes (roughness steps
  for powder coat, anodised aluminium, brushed steel), and the section colours are shared.
* `src/three/tools/Fab.tsx`: housings are lit (`LIT`, `litOf`) instead of baked; the bay's
  own structure stays baked. No post-processing was added: no bloom, no ambient occlusion, no
  depth of field.

### Housings (`src/three/tools/Fab.tsx`, `src/three/kit/section.ts`, `src/three/stage/Director.tsx`)

* Hollow bodies (`Kit.cavity`, `prism` for a stepped elevation), parts kept whole when opened
  (`Kit.keep`), and the exterior vocabulary `door`, `grille`, `emo`, `screenArm`,
  `loadPorts`, with window glass that reflects.
* The reveal: `CamPose.exterior` (a flight's travel and establishing hold, the explorer's
  machine view) keeps a housing closed; it opens as the camera moves in and never closes
  around the camera; the scale label says it is a cutaway (`StageInfo.cutaway`).
* Sections: `sectionMaterial` draws what the cut passes through as a flat, anti-aliased hatch
  that fades with distance. `SectionCut`, `wedgePlanes`, `slicePlane`: a chamber inside a
  housing is cut open after it (`innerCut`, `CUT_TIME` 1.3 s of which the housing takes the
  first 0.8 s), in the same deterministic opening Watch replays after a seek.
* Exteriors: the track (three blocks with doors, grilles, the carrier's load ports and pods,
  an operator panel, the bridge to the scanner), the scanner (below), the etch and deposition
  front ends (panels over the ports with a small window onto the robot, fan-filter unit, panel
  and emergency-off button; doors on the gas and RF cabinets), and emergency-off buttons,
  grilles and doors on the sorter, inspection, wet clean, furnace, polisher, implanter,
  metrology and the filler tools.

### Coater/developer track (`src/three/tools/Track.tsx`, `trackMotion.ts`, `poses/track.ts`)

* The blocks in the bay's order: carrier at the west end beside the bay's load ports, the
  interface at the east end against the scanner (round three had the handedness reversed),
  and the modules prime −1.1 m, coat −0.4 m, soft bake 0.3 m, develop 1.0 m, post-exposure
  bake 1.7 m along the line; every carry is at most 0.7 m (unit-tested).
* Coat: a cup with a splash guard and drain; a resist arm with four nozzles that swings from a
  solvent bath; the resist stream, a meniscus puddle, spreading and thinning in the wafer's
  shader; an edge-bead-removal arm whose jet clears the rim progressively (`LiveCoat.ebr`).
* Develop: a slit-nozzle bar that lays a curtain and then the puddle across the wafer (a
  clipped puddle mesh), and a rinse arm.
* Bake and post-exposure bake: plates with lids on columns and proximity pins; prime: a sealed
  hot-plate chamber; the transfer fork straddles the chuck and passes its lift pins.
* Framings from in front of each module, over the open front of its cell.

### DUV scanner (`src/three/tools/Scanner.tsx`, `scannerMotion.ts`, `reticleArt.ts`, `poses/scanner.ts`)

* Heights shared by the scene and the bay model (`scannerMotion.ts`): the lens 1 mm and the
  hood 0.5 mm over the wafer; the lens 1.28 m in a metrology frame (columns, beam, mount ring);
  the reticle 0.22 m above the lens; the beam delivery at the height the bay model's duct
  meets it.
* Stages: a planar-motor stage base (a tiled top), stage bodies with encoder heads and fiducial
  plates; the dual-stage exchange and the step-and-scan meander of round three are unchanged.
* Metrology cues: an alignment sensor and a level sensor (projector and detector at a glancing
  angle) over the measuring side; the alignment spot only with the overlay.
* Reticle: a procedural chrome pattern (one 4× field of 2 × 2 dies, scribe marks, barcode,
  alignment marks; clear-field for the gate layer, dark-field for contacts) with its pellicle;
  the reticle lesson starts on the library and follows the handler to the reticle stage.
* The slit and the optical path are drawn only with the light-path overlay (193 nm is
  invisible). Round three drew the path at low strength behind the machine's parts, where the
  metrology frame and the lens barrel hid most of it; it is now drawn over them, including the
  stretch through the lens (schematic), only by the machine the story is at, and the scale
  label adds *light path: an overlay · 193 nm UV is invisible* while it is shown
  (`state/magnifier.ts` `useOverlayNote`). The water film is drawn at its real thickness under
  the hood.
* The magnified inset (`src/state/magnifier.ts`, `src/ui/Magnifier.tsx`): a half-section from
  the lens axis — last lens element, immersion hood with its supply and extraction channels,
  the water held under the lens to its meniscus, the resist-coated wafer moving with the stage
  — titled *Magnified · schematic*, heights to one scale (the gap is marked ≈ 1 mm), widths
  compressed; the light only with the overlay; compact on phones.
* The enclosure (`Fab.tsx`, `scanner`): wafer-handling, main and reticle-handling modules with
  service doors (no glazing), a reticle pod port with a pod on its shelf, the operator panel,
  emergency-off buttons, the illuminator's housing raised on the roof, the laser behind.

### Etch and deposition (`src/three/tools/Etch.tsx`, `Depo.tsx`)

* The chamber in use is a whole vessel (full turned parts, the turbo pump's rotor inside) cut
  open only after its housing (`SectionCut` with `wedgePlanes`); legs, lines and the animated
  viewport stay whole; the plasma volume is never cut.
* The transfer chambers have lids with a viewport, wiped off from the front as the chamber
  opens.
* Sequences (unchanged, now visible): slit valve open → pins up → blade in → pins down →
  blade out → valve closed → plasma; deposition: the heater rises to the process gap, the film
  grows as the wafer's interference colour, the PECVD glow stays between faceplate and heater.
* The deposition chambers' exhaust pipes, which stood 6–8 cm out through the housing's side
  walls (they would have shown through the closed machine), stay inside it; a test checks the
  parts of every machine of the lithography loop, and your wafer, against its housing's
  outline.

### CMP (`src/three/tools/Cmp.tsx`)

* The pad's clearcoat and roughness follow the slurry film (glossy when wet); a bead of slurry
  gathers on the upstream side of the retaining ring while the head presses down (a texture
  turned toward the incoming pad each frame). Carrier engagement, head and platen rotation,
  the conditioner and slurry arms, the flip in the load cup and the face-down polish are as in
  round three. Downforce and thickness sensing are not drawn (they are invisible).

### Wafer and dies (`src/three/wafer/Wafer.tsx`, `dieArt.ts`)

* A rounded rim (0.4 mm) instead of a sharp cylinder edge.
* The die floor plan in every die, drawn by the wafer's shader before any film (a resist
  coat still tints it), with contrast growing by layer and pads with the metal; the painted
  surface, the live coat, the exposure fields and the process model's operation boundaries
  are unchanged.

## Continuity

What the brief asked for, what was found and what was done. Frame sequences are in
[Before and after](#before-and-after); the tests that guard each point are listed in
[Verification](#verification-commands-and-results).

* **No pop, flash or brightness change when a machine opens.** The housing is the same model at
  every distance (round three swapped nothing either), lit the same way; the opening is a clip
  plane moving over 0.8 s and the chamber's wedge over the next 0.5 s, both functions of one
  opening value (`Fab.tsx` `cutT`), so Watch's replay after a seek lands on exactly the frame
  playing would. The clipped, two-sided materials of every housing are compiled in advance, as
  in round three, and the chambers' section materials are assigned when the machine mounts, so
  the programs prepared before the camera leaves are the ones drawn. That still left the
  programs shadows are drawn with: measured with `scripts/programs.mjs` on the move from the
  CD-SEM to the etch cluster, the key light's first shadow of the opening housing compiled a
  depth program **in the middle of the move in** (a 12.7 s block on this renderer, measured
  while other work was running). Round three has the same stall, shorter: on an idle machine
  its move compiled one depth program in the middle of the move in both of two runs (1.3 and
  2.5 s blocks; in a run under load, 5.1 s just after arrival). Now every prepared model is
  also drawn once into a small shadow map of its own, right after a frame, so three.js builds
  exactly the programs its shadow pass will ask for (`stage/shadowPrewarm.ts`, for the
  machines and the housings' opened materials): the same move compiles no program at all, in
  the move or on arrival, and has no long task (two runs on an idle machine). A test records
  every program link and whether the camera was moving.
* **Shells are preloaded.** Every machine's closed housing is part of the bay from the first
  frame; the detailed interiors are prepared while the camera is still (round three).
* **A deliberate exterior → interior reveal.** Closed during the travel and the establishing
  beat (`exterior`), opening on the move in, never closing around the camera. A test renders the
  arrival at the etch cluster frame by frame: at least eight frames held on the closed machine,
  the housing's opening never decreasing on the way in, the chamber's cut only once the housing
  is open, the cutaway label on. On round three's build the same test finds no frame at all
  held on the closed machine (its housing opened while the camera was still arriving).
* **The camera through free space (STI etch → STI fill).** Measured on round three's build,
  frame by frame (the camera's path ray-cast against the scene between frames): leaving your
  die in the etch cluster's load lock, the camera headed for the aisle through the opened front
  end (its inside filled the picture for a moment; the part it passed through was cut away, so
  the ray-cast does not count it), rose to 4.86 m, through the 4.6 m ceiling (crossing it at
  frame 62), and then moved in to the polisher along the aisle, looking along it rather than at
  the machine. The polisher's establishing shot stood across the aisle from it,
  over the etch cluster, 8 cm under the ceiling, and the stage's aspect fit (the stage beside
  the lesson panel is narrower than the framings are composed for) pulled it back another 10 %.
  Fixed in `stage/tracks.ts` (`ROOM`, `roomAlong`, `fitInRoom`): an establishing shot stands at
  most at the far side of the aisle, under the ceiling, and a large machine is framed from there
  with a wider lens (the polisher: 42.6°, 46.5° with that fit); a fit pulls back only as far as
  the room allows and widens the lens for the rest. Round four's own change made a second fix
  necessary: housings now close during the travel, so a move from a wafer inside a cluster
  straight for the aisle would pass through the closed front end — the camera now backs out
  along its line of sight to 2.4 m first (`flights.ts` `backOutPose`), and moves in from the
  establishing shot directly (`directLeg`). Round four's build: no crossing, highest point
  3.60 m. The same measurement found the close-up of your die at the start of the move flat on
  round three's build (21 frames with a luminance spread of 2.1–2.7, on a 0–255 scale over a
  16 × 16 grid): the die had no structure to see. With the dies' floor plan, the lowest spread
  of the whole move is 10.4.
* **Blank frames between the dicing saw and the die bonder (dice → attach).** Measured on
  round three's build: on the move in from the benches' establishing shot, which took the aisle
  path and looked along the back-end room at its end wall, frames 71–73 have a luminance spread
  of 0.7 — a flat wall filling the picture — and frames 70 and 74 5.9 and 4.1, against a median
  of 19.8 for the move. Fixed by the direct move in; round four's build: lowest 22.0. A test
  requires every frame of both moves to have a spread above 6 and the camera's path to be
  clear.
* **Between machines that face each other across the aisle, the camera looked down at the
  floor (CD-SEM → gate etch)** (a regression of this round's room limits, found at the end of
  the round in the clip of the arrival at the etch cluster; fixed). The CD-SEM's lesson ends on
  a view into it from across the aisle; the etch cluster's establishing shot, now kept to the
  far side of the aisle, looks back from 2 m away: the short, direct move between them swapped
  the camera's side and its direction of view, and moving the point it looks at in a straight
  line swept that point under the camera. Measured frame by frame at 1280 × 800 on the build
  before the fix: half-way the view pitched 68° down and one frame was the bare floor (a
  luminance spread of 0.0). Round three's establishing shot stood over the other row, and its
  walk found no blank frame on this move. A direct move that turns the view by more than a
  quarter turn now pans about the vertical — heading the short way round, pitch and the distance
  to what it looks at in proportion (`stage/tracks.ts` `turnPose`, used by `flights.ts`), over
  a little more time (1 s plus 0.45 s per radian of turn): on the same move the view is never
  steeper than 32° and the lowest spread is 22.4; the move takes 120 frames instead of 91.
* **Leaving a machine from your die, straight out of the layers** (regressions of this round's
  back-out, found at the end of the round by walking the whole course move by move; fixed).
  Leaving a close view of the wafer for another machine, this round's camera backed out along
  its line of sight to 2.4 m — the fix for STI etch → STI fill. Four other moves leave a machine
  from your die straight out of the layers, and there the line of sight ran through the
  machine: at the developer through the module's cover (a white frame, then the cover over most
  of the picture: a change of 60 levels in one frame), at the polisher into its upper works
  (11 blank frames, a spread of 0.1), in the furnace's tower (the camera stayed inside and looked
  at the inside of the tower's front: 2 blank frames), and at the scanner through the lens
  barrel (1 blank frame). Round three's walk found none of these. Leaving for another machine
  from your die, the camera now goes to the machine's own framing first — the way it comes in to
  inspect the layers, since the die framing is taken from that framing — and travels from there
  (`flights.ts`) — the furnace, for one. Where that straight way is not clear, the machine says
  so in its pose file: the etch cluster keeps the upward back-out (`leaveUp`: the straight way
  from its load lock crosses the load lock's lid), and the scanner, the track and the polisher
  dissolve from your die to their framing in 0.6 s (`leaveFade`): moving the camera out of the
  scanner swept the lens barrel across the picture (a change of 99 levels in one frame), and
  the free-space test's ray-cast found the straight way out clipping the front of the develop
  cell and a part beside the polisher's clean station. After the fixes the walk finds no blank
  frame on any of the 36 moves (see below).
* **Inspect layers at a machine whose wafer is out of view** (the prober, for example, holds
  the wafer under its probe card) first flew out to the machine's establishing shot. Measured on
  round three's build: the camera turned away from the prober down onto the aisle floor — for
  five frames the picture is nothing but floor, two of them a single flat colour (luminance
  spread 0.0) — and the move took 91 frames. It now fades into the layers from where the camera
  is (58 frames, lowest spread 35.8), and *Back to equipment* fades straight back (`flights.ts`,
  unit-tested; [frames](recordings/round4/seq-inspect-layers-at-prober.jpg)).
* **Watch during a slow load.** Policy (`watch/player.ts` `hold`, `Director.tsx`): the picture
  holds its last good frame while a machine it needs is loading, the film's clock and narration
  pause where they are, and the page says what it is waiting for ("Loading the coater/developer
  track…"); once the machine is in, the film carries on from the same moment, with nothing
  skipped. A seek's own hold (the frame or two the stage takes to show a new time) does not
  pause the sound. Round three held the picture but let the narration run on, so on a slow
  connection the narration described a machine the viewer could not see yet: with the track's
  module held back at the network, the test finds round three's film clock running on by 2.4 s
  over the frames it reads while the picture waits (round four: it stands still, under
  0.05 s). Two gaps in that policy were found at the end of the round, in real time with the
  narration playing, and fixed (`watch/player.ts`): *Play* or a seek made during the wait
  started the narration under the held picture (the clock stood still, so the end of the wait
  played that stretch again) — they now start it only when the wait ends; and a film that was
  waiting when its tab went to the background stayed silent until the viewer came back (the
  stage draws no frames there, so the wait never ended) — in a background tab, where there is
  no picture to wait for, the narration now plays on, as in round three, and the stage waits
  again on return if it must. Still open: a seek into a machine that has not loaded plays for
  the one or two frames the stage takes to see the seek before the wait begins — measured on
  this renderer at up to 0.6 s of film; at 60 frames per second it would be about 33 ms (not
  measured).
* **After a seek, the film started a frame late** (a regression of this round's hold, found by
  round three's own seek test on this round's build; fixed). The stage's wait for a machine
  reaches the player one frame later, so a hold set while the film was paused was released on
  the first frame after *Play* — and releasing it also reset the clock's reference, so that
  frame added no time: from then on the picture was a frame (1/30 s) behind the time it would
  have shown after a seek, and `e2e/film-continuity.spec.ts` "a seek shows exactly the frame
  that playing would" found the two pictures 17.2 apart (the mean difference of a 16 × 16
  luminance grid, 0–255; it allows 1.5). On the harness clock, the first frame after *Play* advances the film by
  0.033 s on round three's build, 0.000 on this round's before the fix, 0.033 after it
  (`watch/player.ts` `hold`: the clock's reference is left to the frame loop, which keeps it
  current while the film is held).
* **Reduced motion.** Housings and chambers open at once (no moving cut); flights remain still
  cross-fades; a test checks no frame is half open.
* **A fresh load of the last lesson could freeze the page** (found in this round's own build
  while capturing its stills; fixed). On a fresh browser, the page of lesson 37 stopped
  answering for good in 3–5 of 6–8 loads (round three's build: 0 of 6). The renderer's main
  thread was waiting on a fallback-font lookup (`FontServiceThread::MatchFamilyName`, a
  synchronous call to the browser process) in the page's first layout, while the 3D stage's
  modules were being fetched: round four splits them into seven files where round three had
  three. Bisected to `5a1313b` (its section code, shared by the bay and two machines, split the
  modules); holding the stage's modules back 600 ms removed the freeze (0 of 8). Fix
  (`ui/Viewport.tsx`): the stage's modules are fetched once the page's fonts have loaded and it
  has painted (bounded at 1.5 s) — none of 24 fresh loads of the last and the coat lessons
  froze afterwards. A test loads the last lesson in four fresh browsers (the other tests reuse a
  browser that has loaded a page before, which is why none of them met it). All of this is
  headless Chromium on Linux (Playwright's build); whether a desktop browser can meet the same
  wait was not tested. Separately, a fresh load of the explorer's scanner view keeps the page
  busy for 4–8 s on this software renderer before it answers again (it always recovers).
* **Chapters did not open** (reported by the user at the end of the round; fixed). Clicking
  *Chapters* in a lesson put the drawer in the page at once, but it slid in from fully
  transparent, and its transparent first frame stayed on screen for as long as the browser made
  no new frames — on this software renderer, where a frame of the coat lesson ties up the GPU
  process for 2–4 s and the drawer is drawn by the same renderer after the stage's frames
  already queued, for seconds; a second click, landing on the drawer's invisible backdrop,
  closed it again. Round three has the same fade and the same wait. Measured with a Chrome
  trace of a click on *Chapters* 20 s into the coat lesson (1440 × 900; the time at which the
  first screenshot showing the drawer was due on screen; `node scripts/dialog-latency.mjs <base>
  --runs 3`): round three's build 4.6, 6.3 and 8.0 s in three runs, this round's before the fix
  (`65f4e12`) 2.3, 4.5 and 9.4 s (in both, the first picture with the drawer showed it
  transparent). Fixed three ways: dialogs and cards slide in
  fully opaque (`styles/app.css`; the *Look closer* modal and the film's end card also lost a
  jump — their rise replaced their centring for its duration); while a dialog covers the stage
  in a lesson or the explorer, the stage draws nothing, not even the frames its controls had
  already asked for, and its clock stops, so the lesson carries on from where it was when the
  dialog closes (`Stage.tsx`, `stage/time.ts`); and preparing machines for the GPU waits until
  it closes (a program compiled meanwhile would hold the dialog's frames back: 1–7 s each on
  this renderer, as measured in round three). After the
  fix: 2.3, 4.7 and 5.9 s, the drawer opaque in the first picture that has it, and not one frame
  of the stage after the click (before it, 14–18 in the next 22 s; round three 22–24), so the
  page answers at full rate while the drawer is open. What remains on this renderer is the
  stage's frame that was already on its way when the click came: with WebGL switched off, the
  same drawer is on screen 34 ms after the click on the same software compositor (on graphics
  hardware the wait is one frame of the stage — not measured). A resize under a dialog (a phone
  turned with Chapters open) clears the canvas, and with the stage stopped it stayed cleared (a
  luminance spread of 12.4 beside the drawer, against 39.1 with a picture); the stage is now
  drawn once more, as it stood. The *Chapters* button and Watch's
  chapter marks are the elements under their own centres at 1440 × 900, 1024 × 768, 390 × 844
  and 844 × 390, and a test opens the first lesson of every chapter from the drawer. A change
  that follows: a lesson now pauses under *Look closer*, *What changed?* and the legend (it
  played on underneath before); Watch plays on under its own dialogs.

**The whole course, move by move** (`node scripts/probe.mjs <base> walk.json --cases
transitions`): the probe walks the course on one page as a learner would — each lesson
finished, *Continue* pressed, every frame of the move recorded until the camera settles
(1280 × 800, on the harness clock; a frame with under 1.5 levels of luminance spread over its
16 × 16 grid counts as blank, under 4 as low in detail). Round three's figures are from its own
walk (`docs/ROUND3.md`); round four's from `65f4e12`, the build with the final camera (the six
moves that leave the scanner, the track or the polisher were walked again on it after their
departures became dissolves; the rest of the course on the build before that change, which
does not touch them; the final build's later change, dialogs pausing the stage, touches no
move).

| # | lesson → next | machines | worst jump: three → four | wafers on screen: three → four | largest wafer step, m/frame: three → four | blank frames: three → four | frames under 4 levels (four) | least detail (four) | frames: three → four | hand-over frame: three → four |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | arrive → transfer | foup | ×1.6 → ×1.62 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 31.74 | 26 → 26 | — → — |
| 2 | transfer → scan | foup → inspect | ×1.78 → ×2.44 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 25.85 | 106 → 105 | 28 → 20 |
| 3 | scan → clean | inspect → wetclean | ×2.29 → ×1.47 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 15.66 | 132 → 136 | 33 → 56 |
| 4 | clean → diemap | wetclean → inspect | ×1.44 → ×1.37 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 16.2 | 90 → 99 | 20 → 20 |
| 5 | diemap → padox | inspect → furnace | ×2.46 → ×2.03 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 5.09 | 140 → 135 | 37 → 61 |
| 6 | padox → sti-etch | furnace → etch | ×1.72 → ×2.11 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 17.91 | 109 → 103 | 31 → 28 |
| 7 | sti-etch → sti-fill | etch → cmp | ×3.36 → ×2.75 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 10.58 | 141 → 165 | 53 → 83 |
| 8 | sti-fill → wells | cmp → implant | ×1.53 → ×1.74 | 0 → 0 | 0 → 0 | 0 → 0 | 0 | 19.82 | 105 → 103 | 29 → 28 |
| 9 | wells → anneal | implant → furnace | ×1.43 → ×1.59 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 19.11 | 170 → 137 | 69 → 64 |
| 10 | anneal → gatestack | furnace → depo | ×1.81 → ×2.42 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 8.24 | 123 → 204 | 53 → 118 |
| 11 | gatestack → prime | depo → track | ×2.07 → ×2.18 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 13.2 | 145 → 136 | 39 → 35 |
| 12 | prime → coat | track | — → — | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 27.48 | 20 → 20 | — → — |
| 13 | coat → softbake | track | — → — | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 36.17 | 20 → 20 | — → — |
| 14 | softbake → reticle | track → scanner | ×1.4 → ×1.78 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 15.11 | 116 → 118 | 33 → 30 |
| 15 | reticle → align | scanner | ×1.39 → ×1.1 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 48.65 | 41 → 36 | — → — |
| 16 | align → expose | scanner | ×1.44 → ×1.45 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 48.26 | 41 → 41 | — → — |
| 17 | expose → peb | scanner → track | ×1.39 → ×1.21 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 17.75 | 126 → 97 | 28 → 20 |
| 18 | peb → develop | track | ×1.23 → ×1.52 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 9.88 | 62 → 63 | — → — |
| 19 | develop → adi | track → metrology | ×2.15 → ×3.07 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 8.82 | 153 → 171 | 61 → 82 |
| 20 | adi → gate-etch | metrology → etch | ×1.43 → ×2.61 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 22.39 | 108 → 120 | 29 → 35 |
| 21 | gate-etch → strip | etch | ×1.21 → ×1.21 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 36.18 | 52 → 52 | — → — |
| 22 | strip → sd | etch → implant | — → — | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 27.98 | 26 → 26 | 13 → 13 |
| 23 | sd → pmd | implant → depo | ×4.34 → ×2.36 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 21.92 | 148 → 144 | 65 → 61 |
| 24 | pmd → contact-align | depo → scanner | ×2.12 → ×2.06 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 15 | 154 → 149 | 44 → 42 |
| 25 | contact-align → contact-print | scanner | ×0.4 → ×0.65 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 53.18 | 20 → 20 | — → — |
| 26 | contact-print → contact-etch | scanner → etch | ×1.59 → ×1.54 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 12.36 | 148 → 165 | 65 → 83 |
| 27 | contact-etch → contact-fill | etch → cmp | — → — | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 24.8 | 26 → 26 | 13 → 13 |
| 28 | contact-fill → metal1 | cmp | — → — | 0 → 0 | 0 → 0 | 0 → 0 | 0 | 25.64 | 37 → 37 | — → — |
| 29 | metal1 → metal2 | cmp | — → — | 0 → 0 | 0 → 0 | 0 → 0 | 0 | 27.65 | 37 → 37 | — → — |
| 30 | metal2 → passivate | cmp → depo | ×1.46 → ×2.94 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 5.24 | 123 → 146 | 53 → 71 |
| 31 | passivate → inspect | depo → inspect | ×1.52 → ×1.46 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 22.95 | 105 → 105 | 28 → 27 |
| 32 | inspect → probe | inspect → prober | ×2.33 → ×2.03 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 4.84 | 152 → 166 | 43 → 65 |
| 33 | probe → dice | prober → dicing | ×1.45 → ×2.25 | 1 → 1 | 0 → 0 | 0 → 0 | 0 | 12.91 | 136 → 141 | 43 → 43 |
| 34 | dice → attach | dicing → package | ×1.94 → ×1.31 | 1 → 1 | 0 → 0 | 3 → 0 | 0 | 22.15 | 103 → 105 | 20 → 20 |
| 35 | attach → bond | package | ×1.47 → ×1.44 | 0 → 0 | 0 → 0 | 0 → 0 | 0 | 23.99 | 48 → 48 | — → — |
| 36 | bond → final | package → testbench | ×3.61 → ×3.65 | 0 → 0 | 0 → 0 | 0 → 0 | 0 | 13.91 | 117 → 131 | 26 → 33 |

No move has a blank frame (round three: three, all between the dicing saw and the die bonder)
or a frame under 4 levels; the lowest are the ones round three reviewed as well — a machine's
side panel passing the lens between the die map and the pad oxide (5.1) and between inspection
and wafer sort (4.8) — and the close-up of your die on the freshly polished wafer at the
polisher (5.2). One learner wafer on screen at most; no wafer steps. The one-frame changes of
×3 and more, each looked at frame by frame: *develop → ADI* (×3.1, 7.0 levels): the CD-SEM's
roof is cut away in a single frame as its reveal begins — the cut is a plane lowering through a
flat roof (the frames around it change by about 2 levels); *wire bond → final test* (×3.65, as
in round three): a change of under one level after a still frame, measured against the floor
for still pictures. The moves out of the layers are longer than round three's (to the
machine's own framing first, then the new machine's establishing beat: anneal → gate stack 123
→ 204 frames).


## Before and after

All stills and frame sequences here were rendered on the harness clock (`?virt=1`) and read
back from the canvas, on SwiftShader: they show what is drawn and how moves continue from frame
to frame, never how smoothly a device plays them. Left: round three's build (`be6bf3f`); right:
this round's; the same lesson, progress, viewport (1280 × 800, or a 390 × 844 phone at pixel
ratio 2) and quality tier (*low*) on both. Reproduce with `node scripts/stills.mjs <baseUrl>
scripts/round4/stills-desktop.json <dir>` against each build.

**Stills** (`docs/recordings/round4/`):

* [`sheet-1-exteriors.jpg`](recordings/round4/sheet-1-exteriors.jpg) — the explorer's view of
  the track, scanner, etch cluster and polisher. Round three showed each machine already cut
  open; round four shows it closed — panels, service doors, grilles, load ports with pods,
  operator panels, emergency-off buttons — from the far side of the aisle (its demonstration
  then opens it). The track, 6.3 m long, does not fit whole into that view: its near end is
  cut off by the frame.
* [`sheet-2-track.jpg`](recordings/round4/sheet-2-track.jpg) — prime, coat (dispense,
  spreading, edge-bead removal), soft bake and develop.
* [`sheet-3-scanner.jpg`](recordings/round4/sheet-3-scanner.jpg) — the reticle leaving its
  library, alignment, and exposure with and without the light-path overlay.
* [`sheet-4-etch-depo-cmp.jpg`](recordings/round4/sheet-4-etch-depo-cmp.jpg) — the etch
  chamber whole, then cut open after its housing; deposition; the wet pad of the polisher.
* [`sheet-5-other.jpg`](recordings/round4/sheet-5-other.jpg) — the other machines' fronts.
* [`sheet-6-phone.jpg`](recordings/round4/sheet-6-phone.jpg) — the phone: lessons, and the
  explorer's machine views from inside the bay (round three's looked down through the ceiling).
* [`inset.jpg`](recordings/round4/inset.jpg) — the page during the exposure: the magnified
  inset under the lens, without and with the light-path overlay, on a desktop and a phone
  (round four only; round three had no inset).

**Frame sequences** (every frame of a stretch of a move, read back from the canvas):

* [`seq-inspect-layers-at-prober.jpg`](recordings/round4/seq-inspect-layers-at-prober.jpg) —
  *Inspect layers* at the prober: round three turns down onto the floor; round four holds on
  the machine and fades into the layers from there.
* [`seq-dice-to-attach.jpg`](recordings/round4/seq-dice-to-attach.jpg) — from the dicing saw
  to the die bonder, frames 66–77: round three's flat wall, round four's direct move in.
* [`seq-sti-etch-to-fill.jpg`](recordings/round4/seq-sti-etch-to-fill.jpg) — out of the etch
  cluster to the polisher, every 10th frame of the whole move: round three's close-up of the
  die is a flat surface, the inside of the front end fills the picture on the way out, the
  establishing shot stands over the etch cluster (the camera went through the ceiling to get
  there) and the move in looks along the aisle; round four's die shows its floor plan, the
  camera backs out of the load lock, establishes the closed polisher from the aisle and moves
  straight in.

**Clips** (`docs/recordings/round4/`, rendered on the harness clock at 30 frames per second
on the final build, `node scripts/record.mjs scripts/recordings/r4-0N-….json`; continuity
evidence, not frame-rate evidence):

* [`r4-01-track-prime-to-coat.mp4`](recordings/round4/r4-01-track-prime-to-coat.mp4) — the
  end of priming, the move to the coater with the wafer, then the four-nozzle arm over the
  wafer: the resist is dispensed, spreads and thins in interference colours.
* [`r4-02-scanner-exposure-with-inset.mp4`](recordings/round4/r4-02-scanner-exposure-with-inset.mp4)
  — the start of the exposure with the page: the stages exchange, the step-and-scan meander
  runs, and the magnified inset shows the water under the lens with the wafer moving beneath.
* [`r4-03-arrive-at-etch-open-and-etch.mp4`](recordings/round4/r4-03-arrive-at-etch-open-and-etch.mp4)
  — from the CD-SEM to the etch cluster across the aisle: the camera pans round, holds for a
  moment on the closed machine, then opens it on the way in (the
  housing, the chamber's wedge, the transfer chamber's lid); the hand-off through the slit
  valve and the etch.
* [`r4-04-polisher-wet-pad.mp4`](recordings/round4/r4-04-polisher-wet-pad.mp4) — the end of
  the tungsten polish (the pad glossy under the slurry, the slurry banked against the retaining
  ring), then the lesson's own move into the layers.
* [`r4-05-bay-to-scanner-closed-then-opened.mp4`](recordings/round4/r4-05-bay-to-scanner-closed-then-opened.mp4)
  — the explorer: from the bay to the scanner, seen closed, then its demonstration opens it.
* [`r4-06-zoom-reversed-mid-fade.mp4`](recordings/round4/r4-06-zoom-reversed-mid-fade.mp4) —
  *Inspect layers* and *Back to equipment* pressed in quick succession during the gate etch:
  each request reverses the fade from where it is.
* [`r4-07-watch-after-a-seek.mp4`](recordings/round4/r4-07-watch-after-a-seek.mp4) — the film
  after a seek into the exposure, with its narration.
* [`r4-08-phone-exposure.mp4`](recordings/round4/r4-08-phone-exposure.mp4) — the exposure on
  a 390 × 844 phone screen, with the compact inset.
* [`r4-09-sti-etch-to-fill.mp4`](recordings/round4/r4-09-sti-etch-to-fill.mp4) — out of the
  etch cluster from your die in the load lock to the polisher: back out, travel, the closed
  polisher established from the aisle, straight in.

**Real-time screencasts** (`docs/recordings/round4/r4-rt-…-r3.mp4` and `…-r4.mp4`): six of the
scenarios of [Real-time playback](#real-time-playback-software-rendering), recorded as they
played on round three's build and on the final build (`node scripts/perf.mjs <base> <out.json>
--scenarios … --video <dir>`: Playwright's screencast of the page, in real time; one build after
the other on the idle machine, 00:21–00:32 UTC; scaled to 960 px wide). They show what this
software renderer makes of each build — the loading veil, held pictures and stalls included —
and nothing about how a laptop or a phone would play them. Recording costs frames of its own
(the coat lessons: 1.5 → 0.6 frames per second while recording, 1.9 → 0.7 without).

| what | scenario | round three | round four |
|---|---|---|---|
| the track loop: priming, the coat, the soft bake | `prime-coat-softbake` | [38 s](recordings/round4/r4-rt-prime-coat-softbake-r3.mp4) | [46 s](recordings/round4/r4-rt-prime-coat-softbake-r4.mp4) |
| the scanner's exposure, the post-exposure bake, the develop and its check | `expose-peb-develop` | [41 s](recordings/round4/r4-rt-expose-peb-develop-r3.mp4) | [56 s](recordings/round4/r4-rt-expose-peb-develop-r4.mp4) |
| rapid zoom reversal: *Inspect layers* / *Back to equipment* six times, 0.45 s apart, at the gate etch | `layers-interrupt` | [56 s](recordings/round4/r4-rt-layers-interrupt-r3.mp4) | [85 s](recordings/round4/r4-rt-layers-interrupt-r4.mp4) |
| overview to close-up: a lesson, the whole bay, the etch cluster from the equipment list, its demonstration (the etch), back to the lesson | `explore-roundtrip` | [38 s](recordings/round4/r4-rt-explore-roundtrip-r3.mp4) | [50 s](recordings/round4/r4-rt-explore-roundtrip-r4.mp4) |
| Watch: the film after a seek to 4:40, for a minute | `watch-minute` | [65 s](recordings/round4/r4-rt-watch-minute-r3.mp4) | [73 s](recordings/round4/r4-rt-watch-minute-r4.mp4) |
| a phone (390 × 844): the coat lesson, then the explorer's bay | `phone-coat-explore` | [19 s](recordings/round4/r4-rt-phone-coat-explore-r3.mp4) | [17 s](recordings/round4/r4-rt-phone-coat-explore-r4.mp4) |

The polish is not in the real-time set (it is in the frame-stepped `r4-04` above).

## Real-time playback (software rendering)

The nine scenarios of round three (`scripts/perf.mjs`), driven as a learner would drive them
(clicks and keys, the wall clock, production builds), once on each build, one after the other
within the same quarter of an hour (23:53–00:09 UTC) with nothing else running on the machine:
round three's build (`be6bf3f`) and this round's final build (`822bb0f`). Chromium 141 (Playwright 1.56.1's
headless shell); WebGL through ANGLE on SwiftShader (Vulkan, Subzero JIT) on 4 CPU cores, no
GPU; the app chose its `low` tier
for this renderer (pixel ratio 1, 1024² shadow maps, a shadow refresh every 30 frames); desktop
scenarios at 1280 × 800 and pixel ratio 1, the phone scenario at 390 × 844 and pixel ratio 2
(rendered at 1). Every frame is drawn by the CPU, so these numbers compare the two builds with
each other and nothing else: **they are not frame rates of any laptop or phone. The targets —
60 frames per second on an ordinary laptop, 30 on a modest phone — remain unverified**, since no
graphics hardware was available.

Whole scenarios, round three → round four:

| scenario | frames per second | frame interval median / p95 / p99 / max (ms) | frames > 50 ms / > 100 ms | long tasks: count, total (s), longest (s) | draw calls median / max | triangles median / max (thousands) |
|---|---|---|---|---|---|---|
| home-idle | 5.5 → 3.2 | 133.3 / 483.4 / 1966.6 / 1966.6 → 33.4 / 899.9 / 1933.3 / 1933.3 | 28 / 27 → 12 / 11 | 2, 0.6, 0.5 → 3, 2.4, 2.0 | 53 / 72 → 218 / 298 | 21 / 21 → 52 / 108 |
| arrive-transfer-scan | 1.6 → 1.1 | 66.6 / 2566.5 / 3066.6 / 3766.4 → 50 / 3616.6 / 4066.6 / 4116.6 | 31 / 29 → 26 / 24 | 7, 2.4, 1.3 → 7, 7.3, 4.0 | 192 / 265 → 210 / 277 | 114 / 154 → 125 / 161 |
| prime-coat-softbake | 1.9 → 0.7 | 550 / 1216.7 / 1366.6 / 1666.7 → 1449.9 / 3399.9 / 4366.4 / 4366.4 | 39 / 37 → 20 / 19 | 1, 0.2, 0.2 → 1, 0.1, 0.1 | 140 / 146 → 138 / 205 | 70 / 75 → 74 / 102 |
| expose-peb-develop | 1.7 → 0.8 | 166.6 / 1933.3 / 2749.8 / 4916.4 → 516.6 / 3583.2 / 4049.8 / 4049.8 | 41 / 40 → 21 / 20 | 1, 0.2, 0.2 → 1, 0.2, 0.2 | 59 / 228 → 158 / 245 | 29 / 127 → 74 / 117 |
| layers-interrupt | 1.2 → 0.8 | 33.4 / 4749.9 / 7349.7 / 7983 → 116.7 / 4849.8 / 8566.2 / 9899.7 | 35 / 31 → 31 / 30 | 3, 1.0, 0.5 → 4, 3.2, 2.0 | 175 / 551 → 210 / 558 | 132 / 407 → 174 / 445 |
| explore-roundtrip | 1.2 → 0.7 | 533.2 / 3066.6 / 4749.8 / 4749.8 → 683.4 / 4783.1 / 9566.3 / 9566.3 | 22 / 18 → 25 / 24 | 4, 10.2, 5.6 → 5, 28.9, 18.9 | 553 / 641 → 359 / 704 | 408 / 454 → 212 / 510 |
| nav-loop | 2.2 → 0.5 | 116.6 / 2433.1 / 4299.9 / 4916.5 → 1016.6 / 6199.7 / 6749.8 / 6749.8 | 46 / 37 → 17 / 15 | 13, 8.2, 4.2 → 14, 22.4, 6.7 | 171 / 483 → 233 / 601 | 112 / 371 → 141 / 418 |
| phone-coat-explore | 7 → 2.3 | 116.6 / 400 / 533.2 / 1500 → 450 / 899.9 / 949.9 / 949.9 | 61 / 55 → 25 / 25 | 1, 0.4, 0.4 → 1, 1.4, 1.4 | 68 / 230 → 143 / 316 | 36 / 110 → 74 / 98 |
| watch-minute | 1.2 → 0.6 | 816.7 / 1916.6 / 2116.7 / 2450 → 1466.7 / 4799.8 / 7199.7 / 7199.7 | 60 / 56 → 27 / 26 | 6, 3.4, 1.2 → 7, 6.3, 3.2 | 151 / 232 → 155 / 248 | 86 / 128 → 65 / 114 |

The moves between lessons and views, and the lessons themselves, per phase (`to-…` a move,
`play-…` a lesson playing, as in round three): the longest frame while the camera moved (a stall
in the middle of a move), the longest frame otherwise (the picture held, for instance while a
machine is prepared), and long tasks (count, the longest in seconds); — where no frame
qualifies:

| scenario | phase | longest frame while moving (s) | longest frame otherwise (s) | long tasks (longest, s) |
|---|---|---|---|---|
| home-idle | idle | 1.97 → 1.93 | 0.08 → — | 2 (0.49) → 3 (1.96) |
| arrive-transfer-scan | cold-load | — → — | 0.40 → 1.97 | 4 (0.38) → 4 (1.98) |
| arrive-transfer-scan | play-arrive | — → — | 3.07 → 2.90 | 0 → 0 |
| arrive-transfer-scan | to-transfer | — → — | 2.48 → 4.07 | 1 (0.10) → 1 (0.10) |
| arrive-transfer-scan | play-transfer | — → — | 3.77 → 1.80 | 0 → 0 |
| arrive-transfer-scan | to-scan | 1.15 → — | 2.63 → 4.12 | 2 (1.26) → 2 (4.03) |
| arrive-transfer-scan | play-scan | 2.35 → 1.82 | 1.13 → 1.85 | 0 → 0 |
| prime-coat-softbake | play-prime | — → — | 1.17 → 2.20 | 0 → 0 |
| prime-coat-softbake | to-coat | — → — | 1.15 → 3.03 | 0 → 0 |
| prime-coat-softbake | play-coat | 1.22 → 4.37 | 1.23 → 1.43 | 0 → 0 |
| prime-coat-softbake | to-softbake | — → — | 1.08 → 1.68 | 1 (0.19) → 1 (0.10) |
| prime-coat-softbake | play-softbake | — → — | 1.37 → 1.55 | 0 → 0 |
| expose-peb-develop | play-expose | — → — | 1.83 → 4.05 | 0 → 0 |
| expose-peb-develop | to-peb | 1.93 → — | 2.75 → 3.45 | 0 → 0 |
| expose-peb-develop | play-peb | 2.13 → — | 1.77 → 3.28 | 0 → 0 |
| expose-peb-develop | to-develop | 0.35 → 0.18 | 0.30 → 3.58 | 1 (0.23) → 1 (0.21) |
| expose-peb-develop | play-develop | — → 0.03 | 4.92 → 3.13 | 0 → 0 |
| layers-interrupt | toggles | 2.28 → 2.23 | 7.98 → 9.90 | 3 (0.46) → 4 (2.02) |
| layers-interrupt | rest | — → — | — → — | 0 → 0 |
| explore-roundtrip | to-fab | 0.03 → — | — → 1.65 | 0 → 0 |
| explore-roundtrip | to-etch | 1.35 → — | 3.07 → 3.80 | 3 (3.07) → 1 (7.14) |
| explore-roundtrip | demo | 2.67 → 0.75 | 1.92 → 1.48 | 0 → 3 (1.49) |
| explore-roundtrip | return | — → — | 4.75 → 9.57 | 1 (5.61) → 1 (18.93) |
| explore-roundtrip | rest | — → — | — → — | 0 → 0 |
| nav-loop | loop | 1.77 → 0.02 | 4.92 → 6.75 | 13 (4.22) → 14 (6.74) |
| nav-loop | rest | — → — | 0.32 → — | 0 → 0 |
| phone-coat-explore | play-coat | 0.53 → 0.57 | 1.50 → 0.90 | 0 → 0 |
| phone-coat-explore | to-fab | 0.45 → — | 0.23 → 0.45 | 1 (0.38) → 0 |
| phone-coat-explore | fab | — → 0.53 | 0.33 → 0.95 | 0 → 1 (1.38) |
| watch-minute | film | 1.87 → 3.23 | 2.45 → 7.20 | 6 (1.18) → 7 (3.23) |

Resources at the end of each scenario:

| scenario | geometries / textures / shader programs / JS heap MB, round three → round four |
|---|---|
| home-idle | 72 / 14 / 23 / 39 → 374 / 16 / 25 / 29 |
| arrive-transfer-scan | 230 / 19 / 31 / 61 → 353 / 23 / 31 / 64 |
| prime-coat-softbake | 154 / 16 / 24 / 59 → 264 / 21 / 27 / 54 |
| expose-peb-develop | 269 / 22 / 25 / 68 → 413 / 27 / 28 / 62 |
| layers-interrupt | 363 / 16 / 27 / 63 → 423 / 19 / 29 / 67 |
| explore-roundtrip | 496 / 16 / 27 / 70 → 684 / 21 / 32 / 71 |
| nav-loop | 488 / 21 / 35 / 91 → 558 / 23 / 37 / 100 |
| phone-coat-explore | 195 / 14 / 22 / 55 → 397 / 18 / 25 / 51 |
| watch-minute | 296 / 24 / 27 / 57 → 517 / 26 / 30 / 46 |

What this shows:

* **This round's look costs about half the frame rate on this renderer** (0.2–0.7 of round
  three's, scenario by scenario; about half in most). The cause was measured frame by frame on the harness clock
  (the time for 12 frames, drawing finished, at the `low` tier; on this round's build before its
  last fixes, none of which changes what a frame costs to draw): the cleanroom reflection
  environment that every lit surface samples. Removed at run time, it halves the frame time —
  the bay from the home view 633 → 314 ms, the coat lesson 1584 → 804 ms, the exposure
  1714 → 844 ms; shadows account for 5–10 %; half the pixel ratio makes a frame about four times
  cheaper (the renderer is bound by pixels); a smaller environment texture (64 instead of
  256 px) changes nothing. Draw calls rose where the whole bay is in view (home 53 → 218: the
  housings are lit now, one mesh per finish, where round three baked them into a few); triangles
  rose modestly (home 21 → 52 thousand).
* On graphics hardware, sampling a reflection environment is a handful of texture reads per pixel,
  and 200–300 draw calls are within ordinary budgets — but that was not measured. If a device
  cannot hold its frame rate at the `low` tier, a tier without reflections is the next step. It
  was not taken this round: without an environment, metals render almost black in this
  renderer, and every picture of the round would change.
* **Moves.** In the middle of the moves the longest frames are shorter or gone in most
  scenarios (the navigation loop 1.8 → 0.02 s, the explorer's demonstration 2.7 → 0.8 s, the
  moves to the post-exposure bake and to the scanner 1.9 and 1.2 s → none; the layers' toggles
  2.3 → 2.2 s), but with frames this slow a move spans only a few of them, so that column says
  less than it did in round three. The long blocks come while the picture is held for a machine
  being prepared, and they are longer than round three's (the navigation loop 4.9 → 6.8 s, the
  layers 8.0 → 9.9 s, the explorer's return to the lesson 4.8 → 9.6 s, Watch 2.5 → 7.2 s).
  Where they fall varies from run to run: the explorer round trip, run twice more on the final
  build and twice on the build before the dialog fix, had its longest blocks of 4.7–6.1 s on the
  way to the bay, to the etch cluster or back to the lesson depending on the run (on the way
  back: none, 5.1 s, 6.0 s and none), against the 18.9 s block of the table's run there. Elsewhere, frames are simply
  slower while the camera moves (following the process in the coat lesson: 4.4 s; Watch
  1.9 → 3.2 s).
* **Shader programs compiled during moves** (`scripts/programs.mjs`: every program link, every
  call that blocked the page for over 15 ms after it, and whether the camera was moving; real
  time, one run at a time on an idle machine). From the CD-SEM to the etch cluster (`--step
  adi`): round three links one shadow depth program in the middle of the move in (1.3 and
  2.5 s blocks in two runs); this round before its fix linked two (the first a 12.7 s block,
  measured under load); the final build links none and has no long task, in two runs, the move
  taking 4.7–5.2 s (it now pans round: see *Continuity*). From the inspection tool to the wet
  clean (`--step transfer`): all builds link the same two small programs of the wet clean's
  preparation near the end of the move, and nothing blocked for over 15 ms; the longest task in
  the whole run was 0.27 s on round three's build and 0.17 s on the final build.
* **Resources.** At the end of each scenario round four holds more geometries (the lit housings
  are more, smaller meshes: the home view 72 → 374), 2–5 more textures and 0–5 more shader
  programs, and about the same JS heap (−11 to +9 MB). The real-time `nav-loop` is not a leak
  check: its counts at the end depend on which machines are still loaded when it stops (in three
  runs of round four's builds 254, 558 and 605 geometries; of round three's, 332, 451 and 488). The check is
  `e2e/continuity.spec.ts` "going back and forth through the lessons does not accumulate GPU
  resources": the same loop twice, frame by frame, the second adding at most 10 % geometries,
  4 textures and 2 programs.
* **Watch** covered 32.2 s of film in a minute of wall clock (round three 42.3 s): the film now
  stops its clock and narration while a machine it needs is being prepared (see *Continuity*),
  which on this renderer happens often; round three played the sound on over a held picture.
* A fresh load of the explorer's scanner view keeps the page busy for 4–8 s before it answers
  (measured separately, four loads; it always recovers).

Reproduce: `node scripts/perf.mjs http://127.0.0.1:4173 perf.json` against a build (and against
round three's, served on another port); `--gpu --headed` measures on graphics hardware instead,
as described in [`docs/ROUND3.md`](ROUND3.md#measure-it-on-your-hardware).

## Verification: commands and results

On the final build — application code at `822bb0f`; the commits after it on the branch add
only this document's results and recordings, one test's time budget and a wait in the clip
recorder (below) — on the machine described under *Method*:

| command | result |
|---|---|
| `npm run typecheck` | passes (`tsc -b`: the app, the unit tests, and the Playwright specs and configs; no errors) |
| `npm test` | 63 tests in 5 files pass: round three's 42, and 21 new in `src/three/stage/round4.test.ts` (section cuts; camera routes: back out, move in, pan round between facing machines; the room; out of the layers to another machine from your die — the machine's framing, a dissolve, upward; reveal in place; the lithography cell; the stage clock under a dialog) |
| `npm run build` | succeeds (`tsc -b && vite build`; vite's part 1.3–2.4 s): the site is 43 files, 2.4 MB, listed with their sha256 in `dist/app-files.json`; with the film's narration (4.5 MB) the offline download is still about 7 MB |
| `npx playwright test` (the whole suite, desktop, tablet and phone; `playwright.config.ts`) on `822bb0f` | 98 passed, 84 skipped (tests that run at some sizes only), 1 failed, in 3.6 h (02:54–06:29): the desktop run of `modes.spec.ts` "Explore fab pauses the lesson; returning restores it exactly and offers Resume" ran out of its 12-minute budget while still stepping frames, with no assertion failed (creating its browser context alone took 190 s, behind the previous test's work on the renderer). Round three's build needs 8.2 of those minutes there; the same test passed at the tablet and phone sizes in 8.8 and 4.6 minutes (round three 4.3 and 2.5). Run alone on the same build it passes in 11.5 minutes, 96 % of that budget, which is now 25 minutes (below). |
| `node scripts/perf.mjs <base> <out.json> --label …`, round three's build and this one | the tables in [Real-time playback](#real-time-playback-software-rendering) |
| `node scripts/programs.mjs <base> --step adi` and `--step transfer`, both builds | shader programs during moves, same section |
| `node scripts/perf.mjs <base> <out.json> --scenarios … --video <dir>`, both builds | the real-time screencasts in [Before and after](#before-and-after) |
| `node scripts/dialog-latency.mjs <base> --runs 3`, round three's build, this round's before the dialog fix and the final build | the Chapters timings in *Continuity* |
| `node scripts/stills.mjs <base> scripts/round4/stills-desktop.json <dir>` (and `stills-phone.json`), `scripts/frames.mjs`, `node scripts/record.mjs scripts/recordings/r4-0N-….json` | the stills, frame sequences and clips in `docs/recordings/round4/`; the clips were recorded again on the final build. The recorder now waits for the picture of the setup's last frame before it captures: the zoom-reversal clip's 150 setup frames took about two minutes to reach the screen on this renderer, and its first capture ran out of its 120 s twice |

The runs before the last one: the first full run, on the build before the player's fixes
(`cd29ffc`), was stopped after the first 30 desktop tests, 29 passed and one failed — round
three's seek check, which found the one-frame lag after a seek (fixed, see *Continuity*).
Targeted runs of the Watch tests on the next build then found `watch.spec.ts`'s speed check
failing: the film now waits for a loading machine (the test was adapted, below); investigating
it found the two gaps in the player's hold (fixed, with a new test). A second full run, on
`0e35bcf`, was stopped after two tests when the review of the recordings found the CD-SEM →
etch floor frame (fixed; the whole course was then walked move by move, see *Continuity*).
**Baseline.** Round three's own suite on round three's build (`be6bf3f`, built from a separate
checkout and served the same way, on the same machine and browser): 79 passed, 50 skipped,
0 failed, in 1.4 h — what round three reported (the skips are the suite's own: tests that run
on some of the three projects only).

**New tests this round**, and where each requirement of the brief is covered (the round-three
tests named here still pass on this round's build):

| requirement | tests |
|---|---|
| machines closed from outside, opened deliberately; silhouette and anchors consistent | `e2e/round4.spec.ts` "a machine is shown closed from outside, opens as the camera moves in, and its chamber opens after it" (frame by frame: ≥ 8 frames held on the closed machine, the opening never decreasing, the chamber cut only once the housing is open); "each machine of the lithography loop keeps its parts and your wafer inside its housing's outline" (track, scanner, etch, deposition, polisher); `round4.test.ts` section cuts (a closed wedge cuts nothing, an open one exactly its sector, for plain, turned and mirrored chambers; the lid wipes from the front) |
| continuous wafer and moving parts, prime → coat → soft bake and align → expose | `round3.test.ts` "track: one wafer, carried" (five tests) and "scanner: the stages move, they never jump", on this round's module positions; `e2e/continuity.spec.ts` "the track carries the wafer from module to module (no teleporting)"; `round4.test.ts` the lithography cell (process order west to east, carrier and interface ends, every carry ≤ 0.7 m, the scanner east of the track, the immersion gap) |
| exterior ↔ interior and machine ↔ wafer ↔ die ↔ layers, both ways, with interruption | `round4.spec.ts` the closed-first test; `round4.test.ts` "into the layers and back, at a machine whose wafer is not in view" (reveal in place; back along the line of sight); `continuity.spec.ts` "reversing the cross-section fade at any point never jumps; the latest request wins", "rising out of the layers to leave for another machine, your die fades in (no pop)" |
| the camera through free space | `round4.spec.ts` "the camera travels through free space and never shows a blank frame" (STI etch → STI fill, dice → attach, CD-SEM → gate etch: the camera's path ray-cast between frames — except across a dissolve, where there is no path — every frame's luminance spread > 6, no one-frame jump; and the four moves out of the layers from your die — metal 2 → passivation, anneal → gate stack, develop → ADI, contact print → contact etch — with a spread above 1.5, the probe's count of blank frames, since a close-up of a pale wafer is legitimately flat); `round4.test.ts` "camera routes" and "the room" (back out along the line of sight; a direct move in; between machines facing each other across the aisle, a pan that never looks steeper than its two framings; establishing shots over the aisle and under the ceiling with a lens that keeps the framing; a narrow screen's fit inside the room; the etch → polisher move under the ceiling throughout); `scripts/probe.mjs --cases transitions` (every lesson-to-lesson move of the course, frame by frame) |
| readiness, failure, rapid navigation | `e2e/loading.spec.ts` (four tests: a late machine, changing your mind while one loads, a machine that fails, the first picture only when ready); `e2e/modes.spec.ts` "rapid navigation: the last request wins and no stale camera move completes"; `round4.spec.ts` "the last lesson loads in a fresh browser without the page freezing" |
| Watch: pause, seek, narration during a slow load | `round4.spec.ts` "Watch: the narration waits for a machine that is still loading, and carries on where it stopped" (harness clock) and "Watch, with its narration (real time): Play or a seek during a hold does not start the narration; a background tab plays it on" (the track's module held at the network: the narration silent and the clock still through the wait, *Play* and a seek; playing on in a background tab; waiting again on return; running once the track is in); `e2e/film-continuity.spec.ts` (seek = play, chapter jumps); `e2e/watch.spec.ts` (the narration clock through pause, seek, speed, mute, a background tab) |
| reduced motion | `round4.spec.ts` "reduced motion: a machine and its chamber open at once, without a moving cut"; `continuity.spec.ts` "reduced motion: moves become still cross-fades, and still nothing jumps" |
| Chapters (the user's report) and the dialogs over the stage | `round4.spec.ts` "Chapters opens at once over a busy stage, and the lesson waits behind it (real time)" (the drawer fully opaque as it appears and pictured within 30 s; not one frame of the stage from the key press; the lesson's progress and the stage clock still while it is open; after a resize under it, exactly one frame; frames and the lesson carrying on after *Escape*) and "every chapter opens from the Chapters drawer: its first lesson, at its machine" (desktop and phone); `round4.test.ts` "a dialog over the stage" (the stage clock stops, work waiting for the stage goes on when it closes); `modes.spec.ts` "chapters drawer, deep links and browser history agree"; `journey.spec.ts` "keyboard: start, advance, chapters, inspect layers"; `watch.spec.ts` and `film-continuity.spec.ts` (Watch's chapter marks) |
| resource stability | `continuity.spec.ts` "going back and forth through the lessons does not accumulate GPU resources"; `perf.mjs` `nav-loop` (resources before and after, above) |
| the magnified inset and the light-path overlay | `round4.spec.ts` "the magnified inset shows the immersion film while the scanner exposes, moving with the stage" (desktop and phone: the wafer moves with the stage, the same progress gives the same inset, 193 nm light only with the overlay, which the picture then names; clear of the scale label; gone after the lesson moves on) and "the magnified inset is not drawn over the layers" |

**Run against round three's build**, the new browser tests fail where round three had the
problem: the closed-first test finds no frame held on the closed machine; the STI move crosses
the ceiling at frame 62; the dice → attach move has a frame with a luminance spread of 5.9; the
Watch test finds the film clock running on by 2.4 s while the picture waits. The tests added
with the fixes made at the end of the round fail on this round's own builds from before them:
the CD-SEM → gate etch case at frame 18 (a spread of 0.0) on the build before the pan
(`0e35bcf`); the real-time Watch test at "Play during the hold: no narration while the picture
waits" on the build before the player's fixes (`cd29ffc`), and at "no hold in a background
tab" on that build with only the first of them applied; round three's seek test ("a seek shows
exactly the frame that playing would") at a difference of 17.2 on `cd29ffc`; the Chapters test
at its first check on `65f4e12` (the drawer in the page with an opacity of 0).

No assertion was loosened and no test skips a failure; the new frame-by-frame tests run once, at
the desktop size (they step frames and read pixels), and their waits are conditions (the camera
settled, a machine ready, a frame rendered), except where real time is the scenario (a module
held back at the network until released; fresh browsers given 15 s to answer; the Chapters test
watching for 2 s that nothing is drawn under the drawer). Two time budgets were raised, both
round three's tests that step every frame, with round four's frames costing about twice as
much on this renderer (see *Real-time playback*): "reversing the cross-section fade at any
point never jumps" steps every frame of six reversals and a burst, which took 14–15 minutes;
it ran out of its 25 minutes on this build, alone, while still reversing (no assertion had
failed), and now has 45 (it passes in 32–35). `modes.spec.ts` "Explore fab pauses the lesson…"
took 8.2 of its 12 minutes at the desktop size on round three's build; on this one it passes
alone in 11.5 and ran out of time in the whole suite (above), and now has 25. One round-three
test was adapted to this round's Watch policy:
`watch.spec.ts` "narration drives the film clock…" timed the film at 1.5× over the two seconds
right after a seek into the track's lessons, which on this renderer the film now spends partly
waiting for the track (it found 1.31 s of film where it needs 2.2). It now waits until the
picture is live at a loaded machine and the film is not held — before the speed check, and
before the drift check after the background tab, which also samples until ten readings have
found the narration playing (20 readings 100 ms apart: on this renderer the film could reach
the end of its segment, and a silent move, first; 4 of them found it playing) — and asserts
exactly what it did.

## Remaining limitations

**Still schematic, on purpose or for now.**

* **The machines are generic illustrations.** Their layouts, moving parts and sequences follow
  the references above; their proportions outside do not follow any product (no exterior
  dimensions were found), and no manufacturer's model, photograph, CAD file, logo or branded
  shell was used. Inside, parts are simplified: the scanner's illuminator and reticle-masking
  unit are closed boxes without their optics, and its projection lens is one turned column
  where a real one holds many elements; the track's modules stand in one row where a
  production track stacks them in towers; in the etch and deposition clusters only the chamber
  in use is detailed (the others are closed bodies); gas, RF and vacuum lines are indicated,
  not routed.
* **Things you could not see are drawn only as labelled overlays**: the 193 nm light and slit
  (light-path toggle), ion beams, the alignment spot. The **magnified inset** of the immersion
  film is a schematic (heights to scale, widths compressed), titled as such. The scale label
  names the scanner's light path as an overlay in the lessons and the explorer; the film has no
  scale label, so there its narration and captions say what the light is (the inset's own
  "193 nm (invisible)" note shows on desktops, not on phones). The other machines' beam
  overlays are named by their toggles only.
* **The dies' floor plan is invented** (one plan, the same in every die), and its contrast by
  layer is a visual cue, not an optical model; the cross-section view of the layers is the
  schematic of round three.
* **Plasma and liquids are stylised**: the plasma is a restrained, bounded glow (real plasmas
  are seen only through a viewport); liquids are shaded surfaces, not simulated flows; the
  slurry bank is a texture.
* **A camera kept to the room widens its lens.** Large machines are established from the far
  side of the aisle with a vertical field of view of up to 48° at the landscape aspect the
  framings are composed for (the base lens is 32°; the coater/developer track, 6.3 m long,
  needs the most), and a narrow screen widens it further rather than taking the camera out
  through the ceiling; expect more perspective at the edges of those pictures than in round
  three's.

**Still open.**

* **After a seek into a machine that has not loaded, the narration starts for a frame or two**
  before it waits for the machine (the stage's verdict reaches the player a frame or two
  later): up to 0.6 s of film on this software renderer; at 60 frames per second it would be
  about 33 ms (not measured).
* **Switching between a lesson and the explorer changes the page's layout, and the canvas is
  blank for the frame in between** in the frame-stepped recordings (`r4-05`, frame 16; round
  two's explorer recording shows the same frame, so it predates this round): the canvas is
  resized, which clears it, before the next frame is drawn. Whether a browser running in real
  time shows that frame was not checked.
* **On a software renderer a dialog still waits for the stage's frame in flight**: 2.3–5.9 s
  after the click for the Chapters drawer on this machine (34 ms with WebGL off). Keeping the
  stage to one frame queued when frames are this slow would shorten it; it was not done this
  round, since on graphics hardware the same limit would cost frame rate.

**Not verified in this session.**

* **Frame rate on real hardware.** This machine has no GPU; everything ran on SwiftShader, a
  software rasteriser. The targets of 60 frames per second on a laptop and 30 on a phone are
  **unmeasured**: the numbers in [Real-time playback](#real-time-playback-software-rendering)
  compare the two builds on the same software renderer and are not device results. No real
  phone or tablet was used (the phone runs are Chromium at a phone's viewport and pixel ratio),
  and neither Safari/WebKit nor Firefox was run.
* **Recordings on the harness clock are not evidence of smoothness.** The clips in
  `docs/recordings/round4/` were rendered frame by frame (`?virt=1`) and show continuity only;
  the real-time clips made by `perf.mjs --video` show the software renderer's actual pacing.
* **Sources were read as search excerpts.** Every page fetch was refused by this environment's
  network policy — among others asml.com, tel.com, lamresearch.com, appliedmaterials.com,
  epfl.ch, patents.google.com, en.wikipedia.org, fab.cba.mit.edu and snfguide.stanford.edu —
  so the matrix rests on the excerpts search results quoted, with each fact linked to the page
  it came from. Allowing those hosts in the environment's network access settings would let a
  later round read them in full.
