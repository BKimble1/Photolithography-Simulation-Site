# FAB / ONE — accuracy notes

FAB / ONE is a teaching simulation. It aims to get the **order of operations, cause and
effect, and relative behaviour** right, while making the scale, the numbers and the
equipment deliberately schematic. This file separates:

1. [Facts the app relies on](#1-facts-the-app-relies-on), with sources.
2. [Approximations](#2-approximations-in-the-model): what the model simplifies and how.
3. [What is not modelled](#3-not-modelled) at all.
4. [How the sources were checked](#4-how-the-sources-were-checked), and the limits of that check.

In the app, **Look closer** gives one source per step, and the Legend marks colours that are
illustrative (doping tints, the latent image).

---

## 1. Facts the app relies on

Each line is a statement the app makes or builds into its behaviour, followed by its
source. "Model" says how the simulation reflects it.

### Wafer and handling

* 300 mm wafers are about 775 µm thick (supplier spec 775 ± 25 µm). They are cut from
  Czochralski-grown single-crystal ingots and polished by specialist wafer makers.
  [SVMI SV027](https://svmi.com/wp-content/uploads/2020/09/SV027.pdf) ·
  [SUMCO process](https://www.sumcosi.com/english/products/process/)
* Wafers travel in sealed front-opening pods (FOUPs, up to 25 wafers) between tools,
  carried by overhead vehicles; a load port opens the pod and a robot in a small clean
  enclosure (a minienvironment) moves wafers into the tool. The app says wafers are moved
  by robot and kept sealed, not that nobody ever touches them.
  [Entegris FOUPs](https://www.entegris.com/shop/en/USD/Products/Wafer-Handling/Wafer-Processing/300-mm-Front-Opening-Unified-Pods-(FOUPs)/c/300mmfrontopeningunifiedpodsfoups) ·
  [SEMI E15.1 load port](https://store-us.semi.org/products/e01501-semi-e15-1-specification-for-300-mm-tool-load-port) ·
  [Muratec OHT](https://www.muratec-usa.com/products/779/) ·
  [Aerosol Sci. Technol., FOUP/load-port minienvironment](https://www.tandfonline.com/doi/full/10.1080/027868290920115)
* Particles can kill dies; the critical particle size is set at about half of the half-pitch,
  so particles much smaller than a feature matter.
  [IRDS Yield Enhancement 2022](https://irds.ieee.org/images/files/pdf/2022/2022IRDS_YE.pdf)
  *Model:* particles on the wafer are drawn far larger than real; a particle kills a die
  only if it lands in the circuit area and is above a size threshold.
* Cleanrooms are classified by ISO 14644-1 by airborne particle counts (0.1–5 µm). A human
  hair is roughly 80–100 µm wide.
  [ISO 14644-1:2015](https://www.iso.org/standard/53394.html) ·
  [nano.gov, "Just how small is nano?"](https://www.nano.gov/about-nanotechnology/just-how-small-is-nano/)
* The RCA clean uses alkaline and acidic hydrogen-peroxide baths (SC-1 for organics and
  particles, SC-2 for metal ions), often with a dilute HF dip.
  [Kern 1990, J. Electrochem. Soc.](https://iopscience.iop.org/article/10.1149/1.2086825) ·
  [McGill RCA-2](http://mnm.physics.mcgill.ca/content/rca-2-clean)

### Front end: isolation, wells, gate

* Thermal oxidation consumes silicon: about 44 % of the final oxide thickness comes from
  converted silicon (0.44–0.46 depending on the density assumed).
  [U. Alberta nanoFAB calculator](https://toolbox.nanofab.ualberta.ca/sithox/index.php) ·
  [Georgia Tech ECE 6450](https://alan.ece.gatech.edu/ECE6450/Lectures/ECE6450L4-Oxidation%20Chap%204.pdf)
  *Model:* `oxidize` lowers the silicon surface by 0.44 × the oxide grown.
* Shallow trench isolation: pad oxide, nitride, trench lithography and etch, oxide fill,
  CMP stopping on the nitride, nitride strip. CMP leaves the fill level with the nitride
  top, so after the strip the oxide stands slightly above the silicon.
  [MIT Boning group, STI planarization](https://boning.mit.edu/wp-content/uploads/2022/11/Planarization-and-Integration-of-Shallow-Trench-Isolation.pdf) ·
  [US 7,491,964](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7491964)
* Twin-well CMOS: PMOS in an n-well (phosphorus), NMOS in a p-well (boron). Phosphorus and
  arsenic make silicon n-type; boron makes it p-type.
  [UC Berkeley CMOS baseline](https://nanolab.berkeley.edu/public/process/baseline/reports/baselinerptII.pdf) ·
  [Harvey Mudd E158](https://pages.hmc.edu/harris/class/e158/lect0-intro.pdf) ·
  [Samsung, Part 6](https://semiconductor.samsung.com/support/tools-resources/fabrication-process/eight-essential-semiconductor-fabrication-processes-part-6-deposition-and-ion-implantation-for-the-electrical-properties/)
* Source and drain implants are self-aligned: the polysilicon gate blocks the dopant from
  the channel; an anneal repairs damage and activates dopants.
  [UT Austin VLSI-1, lecture 2](https://users.ece.utexas.edu/~mcdermot/vlsi1/main/lectures/lecture_2.pdf)
  *Model:* the implant dopes only where the stack above is thinner than the ion range, so
  the gate and resist mask it.

### Lithography

* Positive resist: exposed areas dissolve in the developer; negative resist is the reverse.
  [Samsung, Part 4](https://semiconductor.samsung.com/support/tools-resources/fabrication-process/eight-essential-semiconductor-fabrication-processes-part-4-photolithography-laying-the-blueprint/) ·
  [MicroChemicals, development](https://www.microchemicals.com/dokumente/application_notes/development_photoresist.pdf)
  *Model:* exposure only writes a latent image; development removes resist where the
  absorbed dose is high enough. A unit test checks both.
* Before coating, a dehydration bake and HMDS prime make the surface water-repellent so the
  resist adheres; a soft bake drives out most (not all) of the solvent.
  [MicroChemicals, adhesion](https://www.microchemicals.com/dokumente/application_notes/substrate_cleaning_adhesion_photoresist.pdf) ·
  [UT Dallas, HMDS process](https://cleanroom.utdallas.edu/manuals/hmds-process/) ·
  [MicroChemicals, softbake](https://www.microchemicals.com/dokumente/application_notes/softbake_photoresist.pdf)
* Spin-coated film thickness falls roughly with the inverse square root of spin speed; an
  edge bead forms and is removed by edge-bead removal.
  [Ossila spin coating guide](https://www.ossila.com/pages/spin-coating) ·
  [MicroChemicals, spin coating](https://www.microchemicals.com/dokumente/application_notes/spin_coating_photoresist.pdf)
  *Model:* relative thickness = (relative speed)^−½.
* Deep-UV resists are chemically amplified: exposure makes an acid and the post-exposure
  bake lets it switch solubility; positive resists are typically developed in 2.38 % TMAH.
  [Science History Institute](https://www.sciencehistory.org/stories/magazine/patterning-the-world-the-rise-of-chemically-amplified-photoresists/) ·
  [MicroChemicals, PEB](https://www.microchemicals.com/dokumente/application_notes/photoresist_post_exposure_bake_peb.pdf) ·
  [MicroChemicals, MIF developers](https://www.microchemicals.com/PRODUCTS/Photochemicals/Developer/MIF/)
* Lithography areas use yellow light because resists react to UV and blue light below
  about 500 nm (yellow light reduces, but does not remove, the risk).
  [MicroChemicals, yellow light](https://www.microchemicals.com/PRODUCTS/Yellow-light-products/) ·
  [e-ASCT 2025 study](https://www.e-asct.org/journal/view.html?uid=2073&vmd=Full)
* DUV scanners use excimer lasers: KrF at 248 nm and ArF at 193 nm; immersion scanners put
  ultrapure water between lens and wafer (NA up to 1.35; dry ArF up to about 0.93).
  [ASML, light and lasers](https://www.asml.com/en/technology/lithography-principles/light-and-lasers) ·
  [ASML NXT:1470](https://www.asml.com/en/products/duv-lithography-systems/twinscan-nxt1470) ·
  [ASML, immersion (2008)](https://www.asml.com/en/news/press-releases/2008/asml-extends-immersion-to-the-limit-of-single-patterning-lithography) ·
  [Nikon immersion](https://www.nikon.com/business/semi/technology/story04.html)
* The reticle pattern is four times larger than on the wafer (4x reduction); a full field
  is 26 mm × 33 mm; a slit of light sweeps each field while, in DUV scanners, reticle and
  wafer scan in sync in opposite directions; then the wafer steps to the next field.
  [ASML technology](https://www.asml.com/en/technology) ·
  [ASML NXT:1980Di](https://www.asml.com/en/products/duv-lithography-systems/twinscan-nxt1980di) ·
  [SemiAnalysis, reticle size](https://newsletter.semianalysis.com/p/die-size-and-reticle-conundrum-cost) ·
  [SPIE, Controlling CD](https://spie.org/news/controlling-cd) ·
  [US 6,252,370](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6252370)
  *Model:* the wafer map uses 13 × 16.5 mm dies, four to a 26 × 33 mm field.
* Resolution follows CD = k1·λ/NA, with k1 ≥ 0.25 as the physical limit.
  [ASML, Rayleigh criterion](https://www.asml.com/en/technology/lithography-principles/rayleigh-criterion)
* EUV uses 13.5 nm light, which nearly all materials absorb, so EUV optics and masks are
  reflective (Mo/Si multilayer mirrors) and the beam path is kept at very low pressure
  (with hydrogen present), not in air. DUV reticles are chrome on quartz and transmit
  light; DUV projection optics are mostly lens-based (high-NA immersion lenses are
  catadioptric: lenses plus mirrors), which is why the app says "lens-based", not "all lenses".
  [ASML, lenses and mirrors](https://www.asml.com/en/technology/lithography-principles/lenses-and-mirrors) ·
  [SPIE 2012, NXE platform](https://ui.adsabs.harvard.edu/abs/2012SPIE.8322E..1GM/abstract) ·
  [Halbleiter.org, photomasks](https://www.halbleiter.org/en/photolithography/photomasks/) ·
  [imec, lithography](https://www.imec-int.com/en/semiconductor-education-and-workforce-development/microchips/how-are-microchips-made/lithography) ·
  [Pfeiffer Vacuum, EUV](https://www.pfeiffer-vacuum.com/global/en/markets/semiconductor/lithography/euv-lithography)
* The scanner measures alignment marks from earlier layers before exposing. Overlay (layer-to-layer
  error) is measured after development on a metrology tool, and wafers out of spec can be
  reworked (resist stripped and re-patterned) before etch, not after.
  [ASML, aligning to the nanometer](https://www.asml.com/en/news/stories/2021/fellow-simon-mathijssen-aligning-lithography-nanometer) ·
  [ASML YieldStar](https://www.asml.com/en/products/metrology-and-inspection-systems/yieldstar-375f) ·
  [Semiconductor Engineering, overlay](https://semiengineering.com/how-overlay-keeps-pace-with-euv-patterning/)
  *Model:* alignment and overlay metrology are separate steps; rework is offered only
  between develop and etch.
* Thin transparent films on silicon show interference colours that depend on thickness and
  viewing angle.
  [BYU oxide/nitride colour chart](https://www.cleanroom.byu.edu/color_chart)
  *Model:* colours are computed (normal incidence), not taken from a chart.

### Pattern transfer and wiring

* Plasma (dry) etching can cut near-vertical walls; selectivity is the ratio of etch rates
  of two materials; after etching, the resist is removed (for example by oxygen-plasma
  ashing).
  [MicroChemicals, dry etching](https://www.microchemicals.com/dokumente/application_notes/dry_etching_photoresist.pdf) ·
  [MicroChemicals, resist removal](https://www.microchemicals.com/dokumente/application_notes/photoresist_removal.pdf) ·
  [Samsung newsroom, Part 5](https://news.samsung.com/global/eight-major-steps-to-semiconductor-fabrication-part-5-etching-a-circuit-pattern)
* Front end (transistors), middle of line (contacts) and back end (wiring) are the three
  blocks of a logic flow.
  [imec, logic roadmap](https://www.imec-int.com/en/articles/view-logic-technology-roadmap)
* Contacts have traditionally been tungsten (Ti/TiN/W); some advanced nodes use cobalt.
  Copper wiring is made by damascene: etch trenches and vias into dielectric, fill, and
  polish back with CMP.
  [Semiconductor Engineering, BEOL/MOL](https://semiengineering.com/new-beolmol-breakthroughs/) ·
  [Samsung, Part 7](https://semiconductor.samsung.com/support/tools-resources/fabrication-process/eight-essential-semiconductor-fabrication-processes-part-7-metal-interconnects-electrical-highways/) ·
  [imec, semi-damascene](https://www.imec-int.com/en/articles/semi-damascene-metallization-inflection-point-back-end-line-processing) ·
  [ScienceDirect Topics, dual damascene](https://www.sciencedirect.com/topics/engineering/dual-damascene)
* Layout rules leave margin around contacts; a contact misaligned onto a gate shorts the
  gate to the source or drain.
  [MOSIS SCMOS rules](https://www.ece.rice.edu/Courses/422/manual/mosis_scmos7_2.pdf) ·
  [US 6,576,519](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6576519)
  *Model:* the overlay experiment is exactly this failure; the short is found by the
  connectivity test, not scripted.

### Test and packaging

* Every die is electrically probed on the wafer; the wafer is thinned and sawn by blade or
  laser; good dies are attached, wire-bonded, molded and given a final test. (Some flows
  dice before grinding.)
  [Samsung, Part 8](https://semiconductor.samsung.com/support/tools-resources/fabrication-process/eight-essential-semiconductor-fabrication-processes-part-8-eds-electrical-die-sorting-for-the-perfect-chips/) ·
  [Samsung, Part 9](https://semiconductor.samsung.com/support/tools-resources/fabrication-process/eight-essential-semiconductor-fabrication-processes-part-9-packaging-to-protect-the-chips-from-external-elements/) ·
  [DISCO, DBG](https://www.disco.co.jp/eg/solution/library/dbg/dbg_process.html) ·
  [Amkor services](https://amkor.com/services/) ·
  [Amkor test services](https://amkor.com/test-services/)
* A CMOS inverter: input low turns on the PMOS pull-up (output high); input high turns on
  the NMOS pull-down (output low); almost no current flows while the input is steady.
  [MIT 6.012, lecture 13](https://web.mit.edu/6.012/www/SP07-L13.pdf)

---

## 2. Approximations in the model

| area | what the app does | what reality does |
|---|---|---|
| **Scale** | One inverter cell in schematic grid units (96 × 64 gu), heights × 1.3 for legibility. The wafer view draws particles and dies larger. | Real cells are well under a micrometre to a few micrometres; layer thicknesses span nanometres to micrometres. |
| **Time** | Each step animates in about 6–15 s. The panel gives a rough real duration in words. | Steps take seconds (a scanner field) to hours (furnace, CMP with metrology); a full flow takes weeks to months. |
| **Masks** | Rectangles rasterised onto the grid with a small bias; tone per layer (clear or dark field). | Chrome-on-quartz reticles with optical proximity correction, often phase-shifting; pellicles. |
| **Aerial image** | Mask transmission blurred with a Gaussian point-spread function (σ = 1.35 gu), scaled by relative dose. | Partially coherent imaging (Abbe/Hopkins) set by wavelength, NA, illumination shape, focus and aberrations. |
| **Exposure dose** | Five settings relative to dose-to-size (0.45×, 0.7×, 1×, 1.6×, 2.6×). | Doses in mJ/cm², tuned per layer; a focus–exposure window. |
| **Resist** | Beer–Lambert absorption through the film, a sigmoid dissolution-rate curve (contrast 9), a fixed developer time; development proceeds straight down each column. | Absorption, bleaching, standing waves, acid diffusion and quench, development fronts that also move sideways, line-edge roughness. |
| **PEB** | A small extra blur of the latent image and a state change. | Temperature-driven acid-catalysed deprotection; blur depends on time, temperature and quencher. |
| **Spin coat** | Relative thickness = (relative speed)^−½; partial planarisation over topography; a qualitative radial thickening at slow speed; the bead itself is assumed removed. | Thickness depends on viscosity, evaporation, acceleration and exhaust; exponent near −½ but empirical. |
| **Soft bake** | Film shrinks 4 % and is marked baked. | Solvent drops to a few per cent; shrink depends on resist and bake. |
| **Etch** | Anisotropic and time-based with per-material relative rates (selectivity); resist erodes vertically. | Plasma chemistry with loading, aspect-ratio effects, sidewall passivation, undercut, profile tilt. |
| **Wet etch** | Removes the exposed target from the top; undercuts thin buried slivers next to opened areas. | Isotropic (or crystal-plane selective) etching with rates set by chemistry and temperature. |
| **Oxidation** | Uniform oxide grown on exposed silicon/poly, consuming 0.44 × its thickness of silicon. | Deal–Grove kinetics; growth rates depend on temperature, ambient (dry/wet) and orientation. |
| **Deposition** | Conformal (uniform thickness following topography) or planar (fills to a level). | Step coverage, overhangs, voids, grain structure. |
| **Implant** | Dopes silicon where the stack above, weighted by per-material stopping factors, is thinner than the ion range; doping is a type (p-well, n-well, n+, p+), not a concentration. | Gaussian-like depth profiles, lateral straggle, channelling, dose in ions/cm². |
| **Anneal** | Wells deepen by a fixed amount; dopants are marked active. | Diffusion and activation depend on the time–temperature budget. |
| **CMP** | Perfectly flat to the top of a stop layer or to a set plane. | Dishing, erosion and pattern-density effects. |
| **Metals** | Tungsten contacts and two copper damascene levels, drawn without barrier or seed layers. | Ti/TiN liners, TaN/Ta barriers, Cu seed, electroplating, caps. |
| **Electrical test** | Connectivity (union-find) of conductive regions; channels conduct according to the gate net's logic level; gate length below 2.6 gu always conducts (punch-through) and below 4.1 gu fails a leakage check. Output is 0, 1, shorted or floating. | Device physics: threshold voltage, drive current, subthreshold leakage, parasitics, timing. |
| **Overlay** | A global x-shift of the contact mask in schematic units (margin 4 units, spec ±2), plus a small wafer-scale magnification term per die. | Overlay error has translation, rotation, magnification and higher-order terms, measured on dedicated targets. |
| **Wafer map and yield** | Dies share one simulation per bucket of local resist thickness and overlay; eight seeded particles; a toy kill rule. The yield number is not predictive. | Defect densities, clustering (negative-binomial yield models), parametric variation. |
| **Film colours** | Normal-incidence thin-film interference with rounded optical constants under a 6500 K illuminant. | Colour depends on angle, lighting, dispersion and film stacks under the top layer. |
| **Equipment** | Procedural, stylised tools with plausible layouts and proportions, not models of any vendor's product. | Each tool is a complex system (wafer handling, vacuum, gas, control). |
| **Light paths** | Drawn only when toggled, as schematic beams (slit illumination, reticle, lens, wafer; laser and electron beams in inspection and metrology). | The illuminator shapes the pupil; the projection lens has dozens of elements. |
| **Etch and deposition chambers** | Electrode and showerhead gaps are exaggerated so the glow reads; plasma colours are qualitative; resist is stripped with an O₂ plasma in the etch chamber. | Capacitive gaps are a few centimetres; many flows strip resist in a separate chamber. |
| **CMP tool** | One platen; the wafer is flipped in the load cup. | Production polishers have several platens and usually flip the wafer with the robot. |
| **Furnace** | Pad oxide and nitride are grown in the same tube, one after the other. | Fabs usually use separate furnaces for oxidation and LPCVD nitride. |
| **Implanter and other tools** | A generic medium-current beamline; the FOUP shell is drawn translucent so the wafers show; spin speeds and robot motions are visual, not real rpm or timing. | Tool layouts differ by vendor and application. |
| **Back end** | Probe needles, dicing blade (0.8 mm drawn), bond wires and loops are drawn much larger than real; the lead frame is a generic 4-lead strip (VDD, IN, OUT, GND); the prober touches down on every complete die in sequence. | Blades are tens of micrometres thick; probe cards contact many dies at once; packages follow standard outlines. |
| **Fab bay** | One 36 m bay holds every tool of the journey, with the back end behind a glass wall. | Front-end fabs are far larger, tools are grouped by type in separate bays, and packaging and test usually happen at other sites. |
| **Inspection and metrology** | The tool view scans in a spiral, the wafer view in a line, so particles appear in a different order. The CD-SEM images the one simulated die at each of five sites, with small offsets and noise. | Inspection recipes, sampling plans and SEM imaging physics. |

The inverter layout is illustrative, not from a real design kit. Colours for doping and the
latent image are highlights: doped silicon looks the same as undoped silicon, and a latent
image is invisible. The Legend says so.

## 3. Not modelled

* Transistor refinements: lightly doped drains, spacers, halo implants, silicide, gate
  oxide quality, high-k/metal gates, FinFET or gate-all-around structures, well and
  substrate taps, latch-up.
* Lithography refinements: focus and depth of focus, anti-reflective coatings, standing
  waves, flare, pellicles, multiple patterning, OPC beyond a simple bias, immersion-specific
  effects, the physics of alignment sensors.
* Process variation beyond the three wafer-scale terms used for the wafer map (radial
  thickness, magnification overlay, particles). No metrology noise.
* Contamination chemistry: the clean is modelled only as removing particles.
* Thermal budgets, stress, wafer bow, reliability (electromigration, dielectric breakdown).
* Barrier/liner layers, electroplating, via resistance.
* Real throughput and fab logistics (queues, lots, scheduling), apart from a description in
  the fab view.
* Package-level effects (bond wire parasitics, mold stress) and final-test programs.

## 4. How the sources were checked

The facts in section 1 were researched in September 2026. Direct page fetches were blocked
from the build environment for most domains (ASML, imec, Samsung, Wikipedia,
MicroChemicals, university sites). Each fact was therefore confirmed through search-engine
excerpts attributed to the linked page, often across several independent sources, rather
than by reading the page itself. The app does not quote sources word for word. A human
should open the links once before publishing anything that depends on exact wording.

Things that could not be confirmed and are therefore avoided or qualified in the app:

* The exact wording of the ASML "measuring accuracy" and "mechanics" pages. Opposite-direction
  mask/wafer scanning is documented in scanner patents
  ([US 6,252,370](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6252370))
  and SPIE material rather than on ASML pages we could read, so the app describes it only
  for the DUV scanner and does not extend it to EUV.
* Resist removal by "ashing" in Samsung's etch article (the app cites MicroChemicals instead).
* An explicit source that a misaligned contact can miss its diffusion (the app only shows the
  contact–gate short, which is sourced).
* "No human ever touches the wafer" as an absolute: the app says wafers stay sealed and are
  moved by automation.
* SEMI M1, SEMI E47.1 and ISO 14644-1 full texts are paywalled; the app uses supplier
  datasheets and the public abstracts.

A content audit (September 2026) checked every learner-facing sentence against these notes,
qualified the overclaims, and pointed each step's "Look closer" source at a page that
supports it. What remains unsourced, and should be read as the author's general knowledge:

* **Real-world durations** ("About a minute per wafer", "Hours in a furnace", "Days" for the
  second metal level, and so on) are rough orders of magnitude, not sourced figures.
* **Equipment and process details** mentioned in passing: the pre-aligner and wafer notch,
  filtered downflow in the tool front end, laser-scatter particle inspection, single-wafer
  spin cleaning, the pad oxide cushioning the nitride, how CMP polishes, pellicles, the
  chill plate after baking, CD-SEM measurement, SEM defect review, why contact holes are
  drawn larger, copper being hard to plasma-etch, cap and passivation layers, gold wire
  bonds (copper wire is also common), and short late anneals keeping junctions shallow.
* **Items the notes support only through an unclear search excerpt**: hot phosphoric acid for
  the nitride strip, SC-1/SC-2 recipe details, chrome-on-quartz DUV reticles, nitride as
  the STI CMP stop, oxygen-plasma ashing, flip-chip as an alternative to wire bonds.
* **Simulation specs** such as "CD within ±10% of target" and the overlay spec of ±2
  units belong to this model, not to any real process.
* **Idealisations**: "isolation oxide keeps current from leaking" (real isolation leaks a
  little), and the recap's "dozens of masks and hundreds of process steps" for a real chip
  (leading-edge flows can have more).
