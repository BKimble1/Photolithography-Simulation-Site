# FAB / ONE — round three: smooth playback, continuous transitions, believable machinery

What was reproduced, how it was fixed (with file paths), what the measurements say before
and after, and what still needs real graphics hardware. The design notes are in
[`IMPLEMENTATION.md`](../IMPLEMENTATION.md) (sections marked *round three*); new mechanical
claims and their sources are in [`ACCURACY.md`](../ACCURACY.md).

Baseline: branch `claude/fab-one-round-two`, commit `9073800` (the reviewed commit; nothing
newer existed on any branch). This round: branch `claude/fab-one-round-three`.

## What you will see

* **Nothing snaps.** The machine you leave keeps exactly what it showed — your lesson, your
  settings, the moment you left — until it is out of view. The learner's wafer is on screen
  once, never twice, and it changes machines while the camera is in the aisle between them.
* **The coater/developer track carries the wafer.** A robot on a rail picks it up where the
  last lesson left it (lifted on pins, or on a spin chuck raised out of its cup), carries it
  and sets it down: prime → coat → soft bake, and post-exposure bake → develop, run as one
  continuous piece of machinery. The camera holds on the pick-up and follows the carry.
* **The scanner moves like a scanner.** Its two chucks swap at the start of the exposure
  (measure on one side, expose on the other), the stage carries the wafer to the first field,
  and then steps and scans in one continuous meander, each scan in the opposite direction to
  the last, with the reticle scanning the other way — instead of the wafer jumping half a
  field at the start and end of every scan.
* **Surfaces change smoothly.** The resist puddling, spreading and thinning, a film growing
  in the deposition chamber, exposure fields lighting up as the slit sweeps them, and the
  wafer map filling in die by die are drawn continuously from the exact progress, without
  repainting textures; the cross-section is built off the main thread.
* **Reversing a move never jumps.** Pressing *Inspect layers* / *Back to equipment* half-way
  through a cross-fade, going back a lesson on the same machine, or changing your mind
  mid-flight dissolves from the picture on screen; the camera's motion carries over.
* **The camera does not chase the wafer.** While the polisher flips the wafer, a spin chuck
  turns it or a stage steps and scans it, the camera holds a steady framing of the machine and
  the wafer moves within it.
* **The camera waits for what it goes to.** A machine that is still loading holds the view
  (with a quiet "Loading the …" note) however long it takes; one that fails to load is shown
  from outside with a notice, and the rest of the fab keeps working. A deep link shows a
  plain veil, never a half-built scene, until its machine is ready.
* **Watch lands cleanly after a jump.** A chapter jump or a click on the timeline holds the
  last picture until the new place is loaded and on the stage, then dissolves into it (it
  used to flash an empty frame when it landed in the layers); paused, a seek shows exactly
  the frame that playing reaches, down to how far a machine's housing has opened.
* **No stalls while the picture moves.** Every shader program a lesson needs is compiled
  before it is drawn: the wafer's, the cross-section's and the bay's with the first machine,
  each machine's before the camera goes to it. Lights no longer come and go with machines
  (which made every lit material compile again), the scanner's lens no longer doubles the
  drawing, and operation changes in the layers no longer stall. Where the browser cannot
  compile in the background, the wait comes when *Continue* is pressed, with the camera still.
* **Timing is honest.** Lessons run at their real speed however slowly frames arrive (the
  old clock ran at about 40 % speed on this machine); a hidden tab resumes where it was.

## Method

Everything was measured on the build machine, which has no GPU:

| | |
|---|---|
| browser | Playwright Chromium 141 (headless shell), `--use-angle=swiftshader` |
| renderer | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero))), SwiftShader driver |
| hardware | 4 × Intel Xeon @ 2.80 GHz, 16 GB RAM, no GPU |
| viewports | desktop 1280 × 800 at DPR 1; phone 390 × 844 at DPR 2 (touch) |
| builds | round two: `9073800`; round three: `82093cf`, the application's last commit (the commits after it change tests, measurement scripts and documentation); production builds, `vite preview` |
| quality tier | round two: none (fixed settings); round three: `low` (chosen automatically for a software renderer) and, for comparison, `?quality=high` |

Two kinds of evidence, never mixed:

* **Real time** (`scripts/perf.mjs`, production build, wall clock): frame intervals from
  `requestAnimationFrame` (median, p95, p99, frames over 50 and 100 ms, and the longest frame
  while the camera was moving — it moved into the frame before the gap and again across it —
  and while it held still, judged from the camera itself on both builds), long tasks
  (`PerformanceObserver`: the page's main thread blocked for over 50 ms), draw calls and
  triangles summed over every render pass of a frame, render passes, resource counts and JS
  heap; and which shader programs are compiled when (`scripts/programs.mjs`). On a software
  renderer every frame costs 0.2–3 s, so these numbers measure CPU and render work, **not**
  the frame rate anyone will see on a laptop or phone; and the same scenario varies from run
  to run, so each was run twice per build.
* **Frame by frame** (`scripts/probe.mjs` and the new Playwright specs, `?virt=1`): each frame
  is rendered on the harness clock (exactly 1/30 s) and read back from the drawing buffer in
  the same task; the probe measures the picture (a 16 × 16 luminance grid), the camera (the
  view the director drew) and every learner wafer drawn. A **jump** is a frame whose picture
  changes far more than the frames around it: the ratio of its change to the median of its
  eight neighbours (neighbour changes below 0.25 count as 0.25, so a still picture does not
  magnify noise). Continuous motion scores about 1–2; round two's worst jumps scored 15–37.
  Frame-stepped recordings are continuity evidence, never frame-rate evidence.

### Commands

```bash
# builds and servers (round two: built at 9073800, the output copied aside)
git checkout 9073800 && npm run build && cp -r dist /tmp/dist-r2 && git checkout claude/fab-one-round-three
npx vite preview --port 4174 --strictPort --outDir /tmp/dist-r2      # round two
npm run build && npx vite preview --port 4173 --strictPort           # round three

# real time (one run at a time: parallel software rendering skews the timings); the two
# builds' scenario runs were each done twice
node scripts/perf.mjs http://127.0.0.1:4174 perf-r2.json --label "round two"
node scripts/perf.mjs http://127.0.0.1:4173 perf-r3.json --label "round three"
node scripts/perf.mjs http://127.0.0.1:4173 perf-r3-high.json --query quality=high
node scripts/probe.mjs http://127.0.0.1:4173 ob.json --cases op-boundary   # three runs per build
node scripts/programs.mjs http://127.0.0.1:4173 --step arrive --next 2     # programs compiled around
node scripts/programs.mjs http://127.0.0.1:4173 --step expose --next 2     # lesson changes
node scripts/programs.mjs http://127.0.0.1:4173 --step transfer --next 1
node scripts/perf.mjs http://127.0.0.1:4174 v2.json --scenarios layers-interrupt,prime-coat-softbake,explore-roundtrip --video rec-r2
node scripts/perf.mjs http://127.0.0.1:4173 v3.json --scenarios layers-interrupt,prime-coat-softbake,explore-roundtrip --video rec-r3

# frame by frame
node scripts/probe.mjs http://127.0.0.1:4174 probe-r2.json
node scripts/probe.mjs http://127.0.0.1:4173 probe-r3.json

# checks
npm run typecheck && npm test && npm run build && npm run e2e
```

## The review findings: reproduced, fixed, measured

Each finding was first reproduced on the round-two build with a probe that measures it
(`scripts/probe.mjs`, frame by frame unless marked *real time*); the same probe was then run
on this round's build. The full before/after table is under
[Continuity, frame by frame](#continuity-frame-by-frame).

### A. Outgoing presentations were not snapshots

**Reproduced.** Leaving the exposure half-way (p = 0.45, dose 3 instead of the default 2)
for the post-exposure bake: in the first frame of the move the scanner switched to the
canonical run at the end of its lesson, and the learner's wafer on its stage jumped
**0.246 m**. Consecutive lessons on one machine shared one presentation, so the machine
switched lessons instantly: going back from coat to prime moved the wafer **1.40 m** in one
frame (a picture jump 15× the surrounding frames); finishing prime and going on to coat moved
it 1.40 m; coat → soft bake 0.70 m (7.7×); align → expose 0.88 m (31×); a different etch
chamber opening for the resist strip (20×); the die bonder switching to the wire bonder (21×).

**Fixed** (`src/three/Stage.tsx` `useMounts`, `freeze`, `continuous`, `FrozenRelease`;
`src/three/stage/handover.ts`; `src/three/stage/Director.tsx` `capture`, `applyOwner`;
`src/state/presentation.tsx` `lessonProgress`):

* the machine left behind keeps its **real last frame** — the presentation it showed (run,
  overlays, lesson, variant) with its progress fixed at the value drawn in the last frame —
  and is released only when it is out of the camera's frustum (or hidden by level of
  detail) and the camera has settled; at most two are held;
* **one owner** shows the learner's wafer; ownership passes halfway along the first leg that
  travels between machines, and each side of a cross-fade shows the wafer where that side of
  the move has it (no duplicate wafers, and no second wafer as a workaround);
* same-machine lessons are joined by the tools' own motion where that is designed
  (`BRIDGED`: the next lesson starts exactly where the last one ended), and by a
  captured-picture dissolve otherwise (going back, jumping, leaving half-way, a different
  chamber, and in Watch).

The first after-run of the probe still lost the scanner's wafer in the first frame of the
move. The cause was a renderer behaviour worth knowing: when the list of mounted machines
changed order, React moved the scanner's element, and react-three-fiber re-applies every
declared prop of a re-inserted subtree — so the station group's declared `visible={false}`
came back, the release check (which ran before the director) saw the machine hidden, and
released it on the first frame. Mounts now keep a fixed order and the release runs after the
director. After the fix the scanner's wafer does not move at all (0 m) and is on screen, alone,
until the hand-over.

### B. Interrupted cross-fades lost the composite

**Reproduced.** Reversing *Inspect layers* / *Back to equipment* part-way through the
world ↔ cross-section fade (six interruption points): the next frame dropped one side of the
blend — one-frame jumps up to **36.7×** the surrounding frames (reversed 22 frames into the
fade out of the cross-section) and 17.8× (56 frames into the fade in).

**Fixed** (`Director.tsx`): whatever is on screen when a new request arrives — half of a
cross-fade, a dissolve, a machine about to change — is **captured as displayed**
(`copyFramebufferToTexture`), the new flight starts from the dominant pose underneath it, and
the capture dissolves out over 0.35 s. One capture texture is reused; repeated interruptions
capture the current composite; the latest request always wins. A flight replaced mid-way
hands its own motion over to the new one (0.45 s), so the camera never stops dead. Worst
ratio after: **×1.96 (round two ×36.7), with the latest request winning each time**.

### C. Watch re-planned the move every frame of a gap

**Reproduced.** Crossing one 3.2 s gap (wet clean → inspection) built **83** new Catmull-Rom
paths (arc-length tables of 200 points each): the move was planned again in every frame. A
plan costs about 0.17 ms plus its garbage.

**Fixed** (`src/watch/filmStage.ts` `gapPlan`): each gap's plan is built once and reused
(after: **no path built** over the same 113 frames — the session's one plan was made as the
film entered the move, with both of its machines loaded, before the count began, and reused
in every frame after it); it is rebuilt only when an input changes — the viewport's aspect,
reduced motion, which machines are loaded, whether each end's wafer is where the framing
looks, the stations' footprints — so seeks stay deterministic and moving anchors still
resolve. The wafer hand-over and the machine switch in
a gap follow the same plan's hand-over point.

### D. Readiness was a three-frame guess with a three-second timeout

**Reproduced** (*real time*). With the track's module held back 15 s at the network, the old
director waited three seconds and then flew to the track anyway: the camera came within
**1.9 m** of the machine while its model was missing (4.6 m in a second run, where the model
arrived during the flight), with no notice. When the module could
not be fetched at all, the whole 3D view was replaced by the 2D fallback (no canvas left on the
page): one machine's failure took the stage down. This is the most likely explanation of
round two's one unexplained test failure (a pointing test found no canvas while a second
software-rendered browser ran alongside).

**Fixed** (`Stage.tsx` `Ready`, `prewarm`, `ToolBoundary`; `Director.tsx`;
`src/ui/Viewport.tsx` `StageStatus`; `src/three/tools/Fab.tsx` clipped-material warm-up):
readiness means compiled (`compileAsync`) and uploaded (`initTexture`), one model at a time
(where the browser cannot compile in parallel, the director waits for the programs while the
camera is still; see *Shader programs compiled in the middle of lessons and moves* below);
the camera waits however long it takes and says so after 250 ms (after: the camera stayed at
the deposition tool, **13.4 m** from the missing track, with "Loading the coater/developer
track…" on screen, and went when the model arrived); a model that fails is framed from
outside with a notice (after: canvas kept, notice shown, the rest of the fab navigable); the
veil covers a deep link's first picture until its machine is ready; the next lesson's machine
is still preloaded, and the resident cache is still three idle machines plus the current, the
next and at most two frozen ones.

### E. Transition render cost

**Measured.** Round two rendered every cross-fade into a 4-sample half-float target (32 MB
at 1280 × 800) and tone-mapped after blending, preserved the drawing buffer on every frame,
and redrew both 2048² shadow maps on every render — once per view, so twice per frame during
a fade, even when nothing moved: **1 shadow pass per frame paused, 2.1 during a move, 1.7
playing**.

**Fixed** (`Director.tsx` `renderFrame`, `ScreenCopy`; `src/three/stage/quality.ts`;
`Stage.tsx` `QualityControl`): fades blend copies of the displayed pictures (no target to
allocate, no tone-mapping difference at either end of a fade); the drawing buffer is preserved
only for capture tools (`?capture=1`); shadow maps are redrawn only when something that casts
them may have moved (after: **0.03 shadow passes per frame paused, 0.8 during a move, 1
playing**); quality tiers set the pixel-ratio cap, shadow-map size and refresh, from the
device and measured frame rates, with a developer overlay (`?diag=1`) to compare them.

### F. Coarse visual changes

**Reproduced.** Sweeping the coat lesson uploaded **39** full wafer textures (768²,
repainting 72 thin-film rings each time) through a 60-step progress bucket; the deposition
film (160 buckets), the exposure fields (80) and the probe map (240) repainted the same way;
the cross-section was re-meshed on the main thread at every process operation (72–256 ms per
mesh on this CPU; *real time*: 2 long tasks, up to 78 ms, over four operation changes).

**Fixed.** The coat, the deposited film, the exposure fields and the probe map are drawn in
the wafer's shader from the exact progress (`src/three/wafer/Wafer.tsx` `LiveCoat`,
`filmLut`, `LiveFields`; `src/three/tools/Prober.tsx` `MapWafer`): after, **0 texture
uploads** over the same sweep. This is **presentation interpolation** between the model's
operations, labelled as such in the code and in [`ACCURACY.md`](../ACCURACY.md): the puddle,
spread and thinning of the resist and the growth of a film are drawn between the simulated
states and end exactly on the simulated state at each operation; no new physics is
computed. The cross-section is meshed in a worker that also computes the state
(`src/three/device/mesh.worker.ts`, `deviceGeometry.ts`), cached and prepared ahead for the
rest of the step, with the previous geometry on screen until the next arrives (all five meshes
built in the worker, nine served from the cache; after the thin-film table below: **0 long
tasks** in each of three runs); the mesher itself now writes typed buffers (identical
output, verified quad for quad; about 1.6× faster).

### G. Decorative time was not centralised

**Reproduced.** Under the harness clock, three.js' clock received **milliseconds** as
seconds: the overhead vehicles moved **21 m per frame** instead of 0.028 m, so every
frame-stepped recording showed decorative motion 1000× too fast. In real time, the lesson
clock accumulated clamped frame deltas: on this machine lessons ran at **about 40 %** of their
speed (0.039 progress per second instead of 0.09 for an 11 s lesson).

**Fixed** (`src/three/stage/time.ts`, `src/three/anim.ts`, `Stage.tsx` `ClockDriver`,
`Fab.tsx`, `DeviceScene.tsx`): one decorative time (the stage clock, or the film's own time in
Watch, so a seek shows exactly what playing would), frozen under reduced motion; the harness
passes seconds (after: **0.028 m per frame**, as designed); lesson and demonstration progress
are measured from when playback (re)started on a stage clock that stops while the page is
hidden; the film's audio clock stays authoritative; quality tiers never touch timing.

### H. Evidence

The explorer's pointing test hid the overview card; it now points only where the canvas is
really uncovered, with every control in place (`e2e/explore.spec.ts`). New frame-by-frame
specs (`e2e/continuity.spec.ts`, `loading.spec.ts`, `film-continuity.spec.ts`) check
transforms, anchors and pictures around the transitions listed below. Real-time numbers come
from `scripts/perf.mjs`, never from harness frames; `scripts/stats.mjs` (round two's
per-frame CPU submission cost under the harness clock) is kept only as what it is.

## Found along the way

* **The scanner stage jumped twice per field.** The exposure's scan offset was zero while
  stepping and ±half a field while scanning, so the wafer stage jumped **16.5 mm** at the
  start and at the end of every scan — 192 jumps per exposure (round two) — and, once this
  round's chuck exchange was in, it crossed the 0.18 m from its home position to the first
  field in 27 ms. Now one continuous meander, each scan in the opposite direction to the last
  (as scanners run for throughput; see `ACCURACY.md`), with a 0.42 s approach to the first
  field (`src/three/tools/scannerMotion.ts`, unit-tested: the largest move between progress
  samples 10⁻⁵ apart is 0.53 mm, where the old path had 16.5 mm). The message of commit
  `ea2f848` gives the approach as 0.33 s; at the lesson's 14 s it is 0.42 s.
* **The track's robot stepped and snapped** (this round's first version of it). Measured from
  the motion plan itself (`src/three/tools/trackMotion.ts`): the wafer stepped **2 mm** each
  time it changed hands, because the switch between chuck and fork came just before the rising
  fork reached the chuck (or just after the lowering fork left it); a spin chuck rose its 75 mm
  at up to **1.8 m/s**; and backing off to park, squeezed into the last tenth of a transfer, sent
  the carriage off at up to **5 m/s**. The probe caught the result as the largest one-frame
  change of *coat → soft bake* (×9.6 its neighbours: the robot and the rising chuck starting
  together out of a still picture). Now the wafer changes hands exactly where the fork crosses
  the chuck's height, chucks and lift pins are axis moves of their own that rise while the
  robot approaches (0.4 m/s at most), and backing off may run on past the transfer (1.7 m/s at
  most); unit tests bound the hand-off step (under 0.5 mm per 10⁻⁵ of a lesson; it was 2 mm)
  and each axis's speed.
* **The camera chased moving wafers.** Wafer and die framings followed the wafer mesh: while
  the polisher's flipper turned the wafer over, the die framing swung round beneath it, and
  the inspection review's wafer framing followed the stage back and forth across every swath.
  Machines that move the wafer like this now register a steady stand-in for shots to frame
  (`src/three/stage/anchors.ts` `framingRegistry`, `Wafer.tsx` `WaferFraming`; the review's
  takes in the stage's whole travel between the optics and the SEM), and the two contact
  lithography lessons stay with the scanner instead of framing a stepping die
  (`src/content/shots.ts`). Measured below (*anchors*). A steady framing was not enough at
  the polisher: reviewed frame by frame, the contact fill reached your die's close-up just as
  the flipper turned the wafer, lifting it up to 16 cm, so the wafer turned up through the
  lens (a white disc, then a flat grey frame), and coming back down to the die at the end of
  contact fill and metal 1 the camera met the carrier head still over the load cup. Both
  lessons now watch the flips and the head's return from the machine view and go down into the
  layers once the head's arm is clear.
* **Every opened housing oscillated** (round two). The cutaway's step logic treated a
  housing already at its target as one to move the other way, so every fully open housing
  closed by one step and reopened on alternate frames: the wipe plane bobbed by a few
  centimetres each frame, panels flickered as the camera moved in (the track's housing
  during the move from the scanner), and the shadow map was redrawn every other frame on a
  still picture (`src/three/tools/Fab.tsx`).
* **Opened housings z-fought where one part rests on another** (round two). An opened
  housing is drawn two-sided, so that its inside shows through the cut; the underside of a
  part resting on another then lies exactly in the plane of the surface below it — every
  housing on its plinth, the track's roof unit on the housing top — and the two surfaces
  fought over the same pixels in patches that changed from frame to frame as the camera moved
  in (seen on the approach to the track after leaving the exposure: first the floor inside the
  housing, then the inside of the roof unit). The opened material now draws back faces one
  pixel's depth slope deeper than front faces, as a polygon offset would, which settles every
  such pair in every housing at once (`src/three/tools/Fab.tsx` `cutMaterial`). On that
  approach the frame where the floor flickered changed the picture by 1.06 (mean luminance
  change on the probe's 16 × 16 grid) and now by 0.03, the camera's own motion; the roof
  unit's inside is steady ([before](recordings/round3/zfight-before.jpg) /
  [after](recordings/round3/zfight-after.jpg), eight consecutive frames each).
* **The studio environments were re-rendered** (round two). drei's `Environment` renders
  its cube map again whenever it re-renders (its effect depends on its children), and the
  world and cross-section lighting re-rendered with every lesson change and every hover in
  the explorer: a cube render and its prefiltering each time, and the re-rendered maps came
  out slightly darker than the first, shifting the shading of everything in one frame (seen
  in the layers going from contact fill to metal 1). They now render once
  (`src/three/Stage.tsx` `WorldEnvironment`, `DeviceEnvironment`).
* **Two drawings of one resist.** The coat lesson draws the resist in the shader (the surface
  tinted by the film's thin-film colour factor); from the soft bake on, the texture painter
  drew colour rings instead, with the die pattern on top of them, so the wafer changed look
  the moment the soft bake began (a picture change 8.6× its neighbours). The resist is now one
  drawing in every lesson where it lies on the wafer undeveloped: the settled film is drawn by
  the same shader as the live coat (`src/three/wafer/Wafer.tsx`, `settled`), and the painter,
  still used for pictures painted on their own, tints per pixel in linear light by the same
  factor (`src/three/wafer/waferTexture.ts` `tintByResist`). Coat → soft bake after: the
  largest one-frame change is 1.6 levels (×3.64 its neighbours, in the soft bake's second
  frame, as the track starts moving out of a still picture), and the resist keeps its look.
* **Rising out of the layers, your die popped in** (this round's one-owner hand-over). A
  cross-fade during a flight drew its incoming side with the learner's wafer at the next
  machine. That is right for the reduced-motion fade from one machine's picture to the
  other's, and wrong for a fade out of the layers at the machine being left: from the anneal
  to the deposition tool, the close-up of your die in the furnace faded in empty and the die
  appeared when the fade ended (a picture change ×12.2 its neighbours in the whole-course
  walk). The mirror case, a fade into the layers at the destination, drew the wafer at the
  machine already left, so it would vanish as the fade began. Only the reduced-motion fade
  now shows each side's own machine's wafer; every other fade shows the wafer where the move
  has it at the time (`src/three/stage/Director.tsx` `renderFrame`, `flights.ts` `across`).
  Found by the whole-course walk; `e2e/continuity.spec.ts` now checks the anneal case.
* **The camera flew through the packaging benches** (round two cut here; this round's
  dissolve then flew). The die bonder and the wire bonder stand side by side, each framed
  millimetres from its work; after the dissolve from die attach to wire bond, the move between
  their close-ups ran straight through the benches at working height (white frames, a table
  leg, the floor; a picture change of 67 levels in one frame), and leaving the wire bonder's
  close-up for final test did the same on the way to the aisle. The wire bond now starts on a
  framing of both benches, comes in along its close-up's line of sight as the first wire is
  laid, and backs out the same way after the molding (`src/content/shots.ts`,
  `src/three/tools/poses/package.ts`). To catch any other move like it, the probe now measures
  each frame's picture detail and counts *blank frames* in every move (nothing but a flat
  surface in view; see [Every lesson to the next](#every-lesson-to-the-next)).
* **Contact align to contact print flew through the scanner** (this round). Contact align
  ended in the layers and the bridged contact print starts on the exposure framing, so the
  lesson change rose out of the layers onto your die on the measuring chuck and then moved
  straight to the lens, through the metrology frame: dark stage parts, then the inside of the
  housing, a picture with no detail at all (the blank-frame count found it: 8 blank frames, a
  picture change 10.2× its neighbours). Contact align now comes out of the layers into the
  exposure framing itself at its end, as a track does (along the framing's own line of sight),
  and the bridged lesson change needs no camera move (`src/content/shots.ts`).
* **Aisle moves looked past their destination** (round two). Travelling along the aisle the
  camera looks 6 m ahead; in the short back-end room, from the dicing saw to the die bonder,
  that meant looking at the room's end wall from about 3 m: nine frames of nothing but wall
  (found by the blank-frame count, the same nine in round two). The look-ahead now stops at
  the destination's position along the aisle (`src/three/stage/flights.ts` `worldLeg`); three
  frames of wall remain as the camera turns in to the benches.
* **The machine left behind vanished in the first frame** (this round). Described under A:
  a re-inserted machine gets all its declared props back from the renderer.
* **Shader programs compiled in the middle of lessons and moves** (round two, and this round's
  wafer). three.js compiles a program when it is first drawn, and that frame waits for it; on
  the software renderer each such wait took 1–7 s. Logging every program link and every
  blocking first use in real time (and profiling the long tasks: all of the time was in
  `getProgramInfoLog` inside a draw) found them: the wafer's program (new this round: the
  coat and the exposure fields are in its shader), first drawn when the load port's robot
  takes the wafer out of the pod, since a machine is prepared with the wafers it holds and the
  load port holds none before that (a 3.0–4.6 s task after *Continue* from the arrival; round
  two: 186 ms); the cross-section's materials and its lighting's prefiltered environment map,
  made when the layers were first drawn (3.3 s); the contact shadow's (below; 4–5 s, in a
  flight); parts of the bay not yet drawn (the overhead rail, 1.1 s); and the director's
  overlay, at the first dissolve (1 s). The first machine prepared now prepares all of these
  as well (`src/three/Stage.tsx` `prewarmShared`, with stand-ins kept for the session in
  `src/three/wafer/Wafer.tsx` and `src/three/device/DeviceScene.tsx`; the director compiles
  its overlay when it mounts). Where the browser cannot compile in parallel (the software
  renderer: no `KHR_parallel_shader_compile`), `compileAsync` resolves at once and a program
  is really compiled at its first use, so a machine counted as ready before it was compiled;
  the director now uses the programs prepared so far when the camera is still, under the veil
  when the first picture is revealed and when it leaves for a new destination, and starts the
  move's clock after that (`src/three/stage/programs.ts`). A machine prepared but never
  visited is not waited for (making every preparation wait instead put the wait wherever the
  next machine happened to be prepared, which is as a move sets off, and compiled machines
  that fast navigation never showed: the navigation loop's blocking time rose from 23.9 s to
  39.8 s; this version, 10–16 s in three runs). Measured in real time, whole scenarios, this
  round's build before these fixes → after: exposure → PEB → develop, 10.8 s of long tasks →
  0.3 s; prime → coat → soft bake 2.9 → 0.4 s; the layers toggles 8.8 → 1.4–1.5 s (see
  *Real-time playback*).
* **A machine's own light changed every lit program** (round two). The load port and the
  implanter each had a point light inside the machine. Every lit program is compiled for the
  number of lights in the scene, so whenever one of those machines came into view or left
  it, every lit material on screen needed another program, compiled on the spot; and a
  machine is prepared while it is still hidden, when its own light does not count, so its
  programs were prepared for the wrong number of lights (the wafer's program was compiled
  twice for that reason). The world now keeps a fixed pool of two point lights, and a
  machine's light takes one while the machine is drawn, with the same colour, intensity,
  range and falloff at the same place (`src/three/stage/StationLight.tsx`). Stills of the lit
  load port, the implanter's chamber and the etch cluster: 0 pixels differ. The price is two
  point lights in every lit material's shading all the time: on the software renderer, 3–7 %
  more per frame at four lit views (coat, transfer, exposure, gate etch; frames rendered one
  at a time and waited for), where a GPU should barely notice it.
* **The scanner's last lens element doubled the drawing** (round two). It had a transmissive
  glass material. With transmission on screen, three.js draws every opaque object in view a
  second time, into a target the glass samples, in every frame, and compiles a second program
  for each of them the first time (the overhead rail's was compiled in the flight from the
  exposure to the post-exposure bake: 6.8 s). At the exposure framing: 207 draw calls and
  115,902 triangles per frame with it, 109 and 60,084 without. It is plain transparency now
  (`src/three/tools/Scanner.tsx`); stills of the reticle, align and exposure framings change by
  at most 2 levels (the element is 12 cm across, under the immersion hood).
* **The cross-section's contact shadow never drew the block** (round two). drei's
  `ContactShadows` renders the scene from below, but the mesher emits only the faces seen from
  above and from the sides, so from below there was nothing to draw; only contact align's
  translucent preview pillars (boxes) left a faint mark on the floor (at most 12 levels,
  summed over the colour channels, in 3 % of the frame). It cost three programs compiled in
  the middle of a move (4–5 s), two 512 × 512 render targets for every step, never released
  (it was remounted per step), and a 12 m transparent plane drawn in every frame of the layers.
  Removed: stills of four other cross-section lessons are identical to the pixel.
* **The thin-film colour table stalled every operation change** (this round's live films).
  The wafer's shader colours a film being deposited or coated from a 256-entry table of the
  thin-film colour at each thickness, rebuilt on the main thread when the stack under the film
  changes, which is at every operation. A CPU profile put the one long task per run of the gate
  stack's operation changes (60–103 ms) in that table and the garbage collection it caused: every
  entry ran the whole transfer-matrix stack at 41 wavelengths through complex numbers allocated
  per operation. The table now multiplies the layers underneath out once per wavelength and
  computes the top film in plain numbers (`src/sim/filmColor.ts` `colorsWithTop`): 18–88 ms →
  1.2–2 ms per table in node, identical colours (unit-tested to 1e-9 against the full
  computation, metal and dielectric tops, thin and opaque); operation changes, real time: 0
  long tasks in each of three runs (probe `op-boundary`).
* **Watch after a seek: a blank frame, a move planned twice, housings out of step** (found
  by this round's own Watch specs, which had been failing at their setup: they read the stage's
  harness hooks before the canvas had mounted them). Three faults, each reproduced frame by
  frame on the production build:
  * *A blank frame.* A seek (a chapter jump, a click on the timeline) moved the film's camera
    to the new time at once, but the stage's tree, which mounts what the new time shows,
    commits a frame later (React commits between frames); jumping into a cross-section drew
    one frame of the layers' empty background (33.6 levels from the last picture, then 17.7 to
    the layers: [before](recordings/round3/sheet-watch-jump-before.jpg) /
    [after](recordings/round3/sheet-watch-jump-after.jpg)). In real time the layers' geometry
    comes from a worker as well, so it could be several frames. After a seek the director now
    holds the last good picture until the stage shows the new time — its tree has committed
    the film's presentation, and the layers, if the film is in them, have their geometry — and
    then dissolves from it, as it already did when a machine was loading
    (`src/three/stage/Director.tsx` `seekHold`, `src/three/stage/filmBridge.ts` `stageCommit`,
    `src/three/device/deviceGeometry.ts` `deviceShown`).
  * *A move planned twice.* A seek into a move waited only for the machine the film was at;
    the machine at the move's other end could finish loading during the move, and the move,
    planned without its wafer, was planned again half-way (2 new plans while crossing one gap),
    changing the camera's path in flight. The picture is now held until the machines at both
    ends are ready (`filmBridge.otherEnd`), so a move is planned once, with both in place; and
    a seek that lands less than 3 s before a move also waits for the move's machine
    (`filmBridge.soon`), so that the move then plays through instead of stopping half-way for
    it (the Watch spec caught that case: a seek a second before a move, with the next machine
    still loading, froze the picture as the move began and dissolved into the camera already
    under way, a jump 7.5× its neighbours).
  * *Housings out of step with the film.* A housing opens over 0.8 s once the camera nears
    the machine the story is at, and it did so on the stage clock: it kept opening while the
    film was paused, and a seek left it as it was, so a seek to a time just after a machine
    change showed it fully open where playing showed it just starting to open (11.7 levels
    between the played and the sought frame at one film time, 0 now:
    [before](recordings/round3/sheet-watch-seek-before.jpg) /
    [after](recordings/round3/sheet-watch-seek-after.jpg)). Watch now moves
    the housings on the film's time, and after a seek (or when a machine loads) sets them to
    where playing up to that time leaves them, replaying the film's camera over the preceding
    1.6 s (`Director.tsx` `replayHousings`, `src/three/tools/Fab.tsx` `cutClock`). A seek now
    shows the frame playing does (`e2e/film-continuity.spec.ts`).
* **Going back before a machine had loaded left the wait on** (this round's readiness).
  Pressing *Continue* towards a machine still loading and then going back before it arrived
  kept the camera where it was, rightly, but the director went on waiting for the machine it
  no longer needed: the page said *Loading the coater/developer track* at the deposition tool
  until the next lesson change. The wait now ends when the destination is the current one
  again (`src/three/stage/Director.tsx`; `e2e/loading.spec.ts` "changing your mind…", which
  now also releases the track afterwards and checks the camera stays).
* **The probe's own mistake.** Round two's same-machine comparisons (and the first version of
  this round's) measured the picture change across frames skipped while the camera settled,
  so some "jumps" were not jumps; the pairs are now measured per recorded stretch, and the
  baseline was re-measured with the corrected probe.

## Continuity, frame by frame

`scripts/probe.mjs` on the round-two build (`9073800`) and on this round's (`82093cf`), same
machine, same cases, same corrected probe:

| case | measure | round two | round three |
|---|---|---|---|
| leave the exposure half-way (dose 3) | scanner's wafer moved in the first frame (m) | 0.2463 | 0 |
|  | learner wafers on screen at once (max) | 1 | 1 |
|  | picture change in the first frame (0–255) | 1.366 | 0.014 |
| go back a lesson on the same machine (coat → prime) | worst jump (× neighbours) | 15.01 | 1.23 |
| finish prime, go on to coat | learner's wafer, largest step per frame (m) | 1.4002 | 0.0764 |
|  | worst jump (× neighbours) | 4.04 | 2.41 |
| reverse *Inspect layers* / *Back to equipment* mid-fade (6 points) | worst jump (× neighbours) | 36.72 | 1.96 |
| Watch: cross one 3.2 s gap (113 frames) | camera paths built while crossing | 83 | 0 (plans in the whole session: 1) |
| next machine arrives 15 s late (*real time*) | closest approach to the missing machine (m) | 4.6 | 13.4 |
|  | the page says it is loading | no | yes |
| next machine's module cannot be fetched | 3D view kept (canvas) / notice | no — 2D fallback / no | yes / yes |
| shadow-map redraws per frame | paused / during a move / playing | 1 / 2.1 / 1.7 | 0.03 / 0.8 / 1 |
| sweep the coat lesson (101 frames) | wafer texture uploads (≥ 512 px) | 39 | 0 |
| cross-section at 4 operation changes (*real time*) | long tasks (longest ms) | 2 (68) | 0 (0) |
| harness clock: overhead vehicles | metres per frame (designed 0.028) | 21.0715 | 0.0283 |

Consecutive lessons on one machine (finish the first, go on, play the next one's opening):

| lessons | machine | joined by | wafer step, m/frame: round two → three | worst jump: round two → three |
|---|---|---|---|---|
| arrive → transfer | foup | bridged | 0 → 0 | ×1.59 → ×1.6 |
| prime → coat | track | bridged | 1.4002 → 0.0764 | ×4.04 → ×2.65 |
| coat → softbake | track | bridged | 0.7003 → 0.0801 | ×7.72 → ×3.64 |
| reticle → align | scanner | bridged | 0.804 → 0.0036 | ×1.38 → ×1.39 |
| align → expose | scanner | bridged | 0.8777 → 0.069 | ×31.16 → ×1.56 |
| peb → develop | track | bridged | 1.4002 → 0.0833 | ×2.82 → ×3.43 |
| gate-etch → strip | etch | dissolve | 0.0109 → 0.0109 | ×19.62 → ×1.41 |
| contact-align → contact-print | scanner | bridged | 0.8777 → 0.087 | ×16.23 → ×1.23 |
| contact-fill → metal1 | cmp | dissolve | 0 → 0 | ×0 → ×0 |
| metal1 → metal2 | cmp | dissolve | 0 → 0 | ×4.99 → ×4.99 |
| attach → bond | package | dissolve | 0 → 0 | ×21.25 → ×2.06 |

The camera while a machine moves the wafer it frames (the world-side view the director drew,
every frame of the window):

| lesson window | turn, deg/frame (max): before → after | move, m/frame (max): before → after | reversals: before → after |
|---|---|---|---|
| contact-align@0.04-0.34 | 2.92 → 0 | 0.0871 → 0.13 | 0 → 0 |
| contact-print@0.04-0.34 | 5.02 → 0 | 0.2264 → 0.2558 | 21 → 0 |
| contact-fill@0.42-0.6 | 48.17 → 0 | 0.3956 → 0.1484 | 1 → 0 |
| contact-fill@0.73-0.97 | 3.39 → 0 | 0.2607 → 0.22 | 0 → 0 |
| metal1@0.83-0.99 | 8.22 → 0 | 0.3778 → 0.2445 | 0 → 0 |
| sti-etch@0.55-0.72 | 5.57 → 0 | 0.3983 → 0.2122 | 0 → 0 |
| peb@0.08-0.3 | 1.42 → 0 | 0.0559 → 0.0681 | 0 → 0 |

The camera measurements (*anchors*) need the pose the director actually drew, which round
two does not expose; their *before* is this round's build just before the stand-ins and the
continuous scanner meander (`77d06f4`, with the probe's read-out of the drawn camera pose
added), whose shots are round two's. A *turn* or *move* is measured between consecutive
frames drawn from the world side (a cross-fade into the layers is not a camera move); a
*reversal* is the camera's direction of travel turning back by more than 90° between frames
while it moves more than 2 mm per frame (the camera swinging to and fro as it chases a
wafer).

## Every lesson to the next

The probe's `transitions` case walks the whole course on one page, as a learner would:
each lesson is finished, *Continue* is pressed, and every frame of the move is recorded until
the camera settles. 25 of the 36 moves go to another machine (a flight with the wafer
hand-over in the aisle); 7 continue on the same machine where the tools are designed to join
(*bridged*: the next lesson starts exactly where the last ended); 4 change what a machine
shows in a way that cannot join (a different etch chamber, the polisher's next level, the
die bonder to the wire bonder) and dissolve from the picture on screen.

| # | lesson → next | machines | joined by | worst jump: two → three | wafers on screen: two → three | largest wafer step, m/frame: two → three | blank frames: two → three | frames | hand-over frame |
|---|---|---|---|---|---|---|---|---|---|
| 1 | arrive → transfer | foup | bridged | ×1.57 → ×1.6 | 1 → 1 | 0 → 0 | 0 → 0 | 26 | — |
| 2 | transfer → scan | foup → inspect | flight | ×2.06 → ×1.78 | **2** → 1 | **0.971 (foup)** → 0 | 0 → 0 | 106 | 28 |
| 3 | scan → clean | inspect → wetclean | flight | **×4.72** → ×2.29 | **2** → 1 | **0.2844 (inspect)** → 0 | 0 → 0 | 132 | 33 |
| 4 | clean → diemap | wetclean → inspect | flight | ×2.02 → ×1.44 | 1 → 1 | 0 → 0 | 0 → 0 | 90 | 20 |
| 5 | diemap → padox | inspect → furnace | flight | **×12.71** → ×2.46 | **2** → 1 | **0.2844 (inspect)** → 0 | 0 → 0 | 140 | 37 |
| 6 | padox → sti-etch | furnace → etch | flight | ×1.99 → ×1.72 | 1 → 1 | 0 → 0 | 0 → 0 | 109 | 31 |
| 7 | sti-etch → sti-fill | etch → cmp | flight | ×1.94 → ×3.36 | 1 → 1 | 0 → 0 | 0 → 0 | 141 | 53 |
| 8 | sti-fill → wells | cmp → implant | flight | ×1.98 → ×1.53 | 0 → 0 | 0 → 0 | 0 → 0 | 105 | 29 |
| 9 | wells → anneal | implant → furnace | flight | ×2.6 → ×1.43 | 1 → 1 | 0 → 0 | 0 → 0 | 170 | 69 |
| 10 | anneal → gatestack | furnace → depo | flight | ×3.56 → ×1.81 | 1 → 1 | 0 → 0 | 0 → 0 | 123 | 53 |
| 11 | gatestack → prime | depo → track | flight | ×2.3 → ×2.07 | 1 → 1 | 0 → 0 | 0 → 0 | 145 | 39 |
| 12 | prime → coat | track | bridged | **×16.91** → — | 1 → 1 | **1.4002 (track)** → 0 | 0 → 0 | 20 | — |
| 13 | coat → softbake | track | bridged | **×13.37** → — | 1 → 1 | **0.7003 (track)** → 0 | 0 → 0 | 20 | — |
| 14 | softbake → reticle | track → scanner | flight | **×4.58** → ×1.4 | 1 → 1 | 0 → 0 | 0 → 0 | 116 | 33 |
| 15 | reticle → align | scanner | bridged | ×1.17 → ×1.39 | 1 → 1 | **0.804 (scanner)** → 0 | 0 → 0 | 41 | — |
| 16 | align → expose | scanner | bridged | **×21.63** → ×1.44 | 1 → 1 | **0.8777 (scanner)** → 0 | 0 → 0 | 41 | — |
| 17 | expose → peb | scanner → track | flight | ×2.17 → ×1.39 | 1 → 1 | **0.297 (scanner)** → 0 | 0 → 0 | 126 | 28 |
| 18 | peb → develop | track | bridged | ×2.82 → ×1.23 | 1 → 1 | **1.4002 (track)** → 0 | 0 → 0 | 62 | — |
| 19 | develop → adi | track → metrology | flight | ×3.09 → ×2.15 | **2** → 1 | 0 → 0 | 0 → 0 | 153 | 61 |
| 20 | adi → gate-etch | metrology → etch | flight | ×1.96 → ×1.43 | 1 → 1 | 0 → 0 | 0 → 0 | 108 | 29 |
| 21 | gate-etch → strip | etch | dissolve | **×12.86** → ×1.21 | 1 → 1 | 0 → 0 | 0 → 0 | 52 | — |
| 22 | strip → sd | etch → implant | flight | — → — | 1 → 1 | 0 → 0 | 0 → 0 | 26 | 13 |
| 23 | sd → pmd | implant → depo | flight | ×3.27 → ×4.34 | 1 → 1 | 0 → 0 | 0 → 0 | 148 | 65 |
| 24 | pmd → contact-align | depo → scanner | flight | **×5.09** → ×2.12 | 1 → 1 | 0 → 0 | 0 → 0 | 154 | 44 |
| 25 | contact-align → contact-print | scanner | bridged | ×3.35 → ×0.4 | 1 → 1 | **0.8777 (scanner)** → 0 | 0 → 0 | 20 | — |
| 26 | contact-print → contact-etch | scanner → etch | flight | ×2.13 → ×1.59 | 1 → 1 | **0.297 (scanner)** → 0 | 0 → 0 | 148 | 65 |
| 27 | contact-etch → contact-fill | etch → cmp | flight | — → — | 1 → 1 | 0 → 0 | 0 → 0 | 26 | 13 |
| 28 | contact-fill → metal1 | cmp | dissolve | — → — | 0 → 0 | 0 → 0 | 0 → 0 | 37 | — |
| 29 | metal1 → metal2 | cmp | dissolve | — → — | 0 → 0 | 0 → 0 | 0 → 0 | 37 | — |
| 30 | metal2 → passivate | cmp → depo | flight | ×2.15 → ×1.46 | **2** → 1 | 0 → 0 | 0 → 0 | 123 | 53 |
| 31 | passivate → inspect | depo → inspect | flight | ×2.33 → ×1.52 | 1 → 1 | 0 → 0 | 0 → 0 | 105 | 28 |
| 32 | inspect → probe | inspect → prober | flight | ×3.42 → ×2.33 | 1 → 1 | 0 → 0 | 0 → 0 | 152 | 43 |
| 33 | probe → dice | prober → dicing | flight | ×1.54 → ×1.45 | 1 → 1 | 0 → 0 | 0 → 0 | 136 | 43 |
| 34 | dice → attach | dicing → package | flight | ×1.22 → ×1.94 | 1 → 1 | 0 → 0 | **8** → 3 | 103 | 20 |
| 35 | attach → bond | package | dissolve | **×21.25** → ×1.47 | 0 → 0 | 0 → 0 | 0 → 0 | 48 | — |
| 36 | bond → final | package → testbench | flight | ×2.65 → ×3.61 | 0 → 0 | 0 → 0 | 0 → 0 | 117 | 26 |

Builds: round two `9073800`; round three, the final build (`82093cf`).
Each build's walk ran on one page, from the first lesson to the last, with the same probe.
This round's, on the final build, agrees with the walk made before this round's last
performance and Watch changes: 29 of the 36 moves are identical, the other seven differ in
their largest change by at most 0.1 level (most likely the lens and lighting changes), and
frame counts, wafers, hand-overs and blank frames are the same except that the bridged contact
align → contact print took one frame more to settle.

Where round three is still above ×3:
three moves, *STI etch → STI fill* (×3.36), *S/D implant → PMD deposition* (×4.34) and *wire
bond → final test* (×3.61). Each was reviewed frame by frame; none is a jump in the camera's
path, a blank frame or a misplaced wafer. *STI etch → STI fill*: out of the layers, the camera
first comes back to your die, which at the end of the trench etch is inside the etch cluster
(its transfer chamber), and rises from there, through the opened housing and past the robot's
arm, to the polisher's establishing view across the aisle; for about half a second it is
within centimetres of the machine's inside, so each frame changes most of the picture (83
levels in one frame, 24–62 in the frames around it). *S/D implant → PMD deposition*: half-way
along the aisle, as the wafer changes hands, the camera turns into the deposition tool's bay
past the corner of the machine beside it, which sweeps across a quarter of the picture in two
frames (round two took the same path: ×3.27). *Wire bond → final test*: the move starts from
the wire bonder's close-up, and its first frame changes the picture by less than one level
after a still one; the ratio is measured against the floor for still pictures (0.25).

Columns: *frames* until the camera settled; *worst jump*, the largest one-frame picture
change relative to its neighbours (continuous motion is about 1–2); *wafers on screen*, the
most learner wafers visible in any frame (never more than one); *wafer step*, the largest
move of the learner's wafer between two frames, and in which machine (a teleport would show
as tenths of a metre; the track's robot carries the wafer at up to 0.08 m per frame); the
frame at which the wafer changed hands (between machines: in the aisle; — where it stays);
*blank frames*, frames that show nothing but a flat surface (under 1.5 levels of spread on the
probe's 16 × 16 luminance grid: a wall or a panel filling the view measured 0.6–0.8, the palest
intended picture, a close-up of your die on a pale wafer, 1.9). Frames under 4 levels were also
counted and every one of them looked at: apart from the blank ones, they are the close-ups of
your die that the camera rises onto out of the layers (pale wafers: after STI etch, the anneal,
the bakes and develop, contact align, metal 2), and one frame each of a machine's side panel
passing the lens between the die map and the pad oxide and between inspection and wafer
sort, as in round two.

### The priority sequences

* **Arrival → transfer → scan.** The load port hands the pod's wafer to the front end's
  robot within one machine (bridged: the wafer does not move at the lesson change); the move
  to the inspection tool hands the wafer over in the aisle.
* **Prime → coat → soft bake; exposure → PEB → develop.** One wafer on the track, carried by
  its robot (above, and the recordings); the scanner left half-way stays exactly as it was;
  the wafer moves to the track mid-aisle.
* **STI etch, wells, source/drain, contact fill, metal 1, metal 2.** The distinction between
  steps that happen in several tools and the machine that holds the wafer is kept from round
  two: the camera stays in the layers while the lithography or deposition happens elsewhere,
  comes out to the machine when the wafer arrives, and goes back down afterwards. At the
  polisher the camera now watches the flips and the carrier head's return from the machine
  view (contact fill, metal 1), where a die close-up had the turning wafer or the head in the
  lens.
* **Anneal, PEB, strip.** The camera goes down into the layers before the furnace boat is
  sealed, before the hot plate's lid closes, and as the ash chamber fills with plasma
  (reviewed frame sequences below). Reviewing the stills this round found four framings that
  hid their subject, now re-directed to hold the machine view through the action and go down
  into the layers from it: the post-exposure bake's die close-up (the raised lid and its
  exhaust filled the frame), develop's wafer framing (the dispense bar swept across the
  lens), and the trench and contact etches' wafer and die framings (inside the plasma's
  glow, an almost white picture).
* **Machine → wafer → die → cross-section, both ways, interrupted.** Anchored cross-fades
  between the machine and the layers, reversed at any point without a jump (finding B).
* **Learn → Explore demonstration → return; Watch chapter jumps; back and forward during a
  move.** Explore snapshots the lesson and Return restores it exactly (`e2e/modes.spec.ts`);
  a chapter jump holds the last picture until the machines it needs are loaded and the stage
  shows the new time, then dissolves (`e2e/film-continuity.spec.ts`); a new request during a
  move takes over from the current camera motion, and the latest request wins
  (`e2e/continuity.spec.ts`, `loading.spec.ts`).

## Motion: the camera and the machines

### The camera's rules

* **Continuous position, orientation and field of view.** Shot tracks pass through their
  intermediate framings without stopping (cubic Hermite through the keys, tangents limited so
  a move never overshoots); two consecutive keys with the same framing are a deliberate hold;
  a single move eases in and out. The field of view is part of every pose and interpolates
  with it (round two switched it between the home view and the lesson views). The camera
  always looks at its target with the world's up (no roll).
* **No journeys through housings.** A move between machines steps back into the central aisle,
  travels along it and comes in from the front (round two's aisle legs, kept).
* **Holds are purposeful.** A flight to another machine holds 0.35 s on the whole new machine
  before moving in; on the track, the camera holds on the pick-up before it follows the carry.
* **Stop and retarget.** The latest request always wins. A flight replaced mid-way hands its
  motion to the new one over 0.45 s (no dead stop); a request that arrives mid-fade,
  mid-dissolve or while a machine is about to change what it shows is captured as displayed
  and dissolved from over 0.35 s. Repeated input settles where the last request points
  (`e2e/continuity.spec.ts`, five reversals five frames apart).
* **Moving wafers.** Framings of the wafer and of your die resolve against a steady stand-in
  where the machine flips, spins or scans the wafer (see *Found along the way*). Spins stop on
  whole turns, so the next lesson finds the die where the last one left it.
* **Reduced motion.** Every flight is a 0.35 s cross-fade between still compositions; tracks
  hold each framing and cross-fade to the next; decorative motion stops.

### The machines

| sequence | what moves now | where |
|---|---|---|
| prime → coat → soft bake; PEB → develop (the track) | one wafer, one robot: carriage on a rail along the modules, a lifting column and a fork with two ceramic tines. Each hand-off is approach, lift clearance (lift pins on a hot plate or prime plate; the spin chuck rises above its cup), take, withdraw, carry, place, withdraw, and the pins or chuck go down; axis moves have trapezoidal velocity profiles (the fastest wafer step is 0.08 m per 1/30 s). Chucks and lift pins are axis moves of their own and the wafer changes hands where the fork crosses the chuck's height (no step). Peak speeds: carriage and fork about 2.5 m/s, chucks 0.4 m/s. The chuck spins up, holds and spins down, stopping on a whole number of turns | `src/three/tools/trackMotion.ts` (pure, unit-tested), `Track.tsx` |
| reticle → align → expose (the scanner) | the two chucks swap at the start of the exposure, passing around each other; the stage carries the wafer to the first field (0.42 s) and runs one continuous step-and-scan meander, alternate scan directions, with the reticle stage scanning the other way, 4× the distance; the other chuck measures the next wafer meanwhile | `src/three/tools/scannerMotion.ts` (pure, unit-tested), `Scanner.tsx` |
| coat, deposition, exposure, wafer sort | the resist puddle, spread and thinning (and the edge-bead removal), a film growing to its simulated thickness, each field lighting up as the slit crosses it, the wafer map filling die by die in probing order: drawn in the wafer's shader from the exact progress (presentation interpolation between the model's states); the resist stays in the shader once it is on, so the wafer never changes look between lessons | `src/three/wafer/Wafer.tsx`, `Depo.tsx`, `Prober.tsx` |
| every same-machine lesson change | the next lesson starts exactly where the last ended where that is designed (`BRIDGED`: arrive→transfer, prime→coat→soft bake, PEB→develop, reticle→align→expose, contact align→print), unit-tested for the track; otherwise a dissolve from the picture on screen | `src/three/tools/index.tsx`, `Stage.tsx` |

Mechanical claims new this round (the track's blocks and hand-offs, the dual-stage exchange,
alternating scan directions) are sourced in [`ACCURACY.md`](../ACCURACY.md), where the
equipment is described as reference-informed schematic, not any manufacturer's design.
Round two's detailed machinery (the equipment front end's pre-aligner and slit valves, the
etch and deposition clusters' robots and slit valves, the polisher's carrier head, slurry
arm, conditioner and flipper) is kept as it was; nothing was made heavier. The priority was
the motion that was visibly wrong: teleporting wafers, jumping stages, a camera chasing the
wafer.

## Real-time playback (software rendering)

The same nine scenarios, driven as a learner would drive them (clicks and keys, normal wall
clock, production build), on round two and on this round — first at the tier the app
chose for itself (`low`, since the renderer is software), then forced to `high`. On this
machine every frame is rendered by the CPU, so the absolute frame intervals say nothing
about a laptop or phone; what carries over is the relative change in work per frame, the
long tasks, and the draw calls and passes.

Whole scenarios, two runs of each build (run 1 / run 2): the time the main thread was blocked
(long tasks, summed), the longest single block, frames drawn per second of wall clock, and
draw calls per frame over every render pass (median / max; round three at the `low` tier it
chose for this renderer).

| scenario | blocked, round two | blocked, round three | longest block (s), two → three | frames per second, two → three | draw calls, two → three |
|---|---|---|---|---|---|
| home-idle | 0.7 / 0.8 s | 3.4 / 3.0 s | 0.7 / 0.8 → 2.8 / 2.4 | 4.6 / 4.9 → 3.5 / 3.7 | 53 / 53 → 53 / 72 |
| arrive-transfer-scan | 3.0 / 16.0 s | 5.3 / 7.3 s | 0.8 / 13.0 → 3.2 / 3.2 | 0.8 / 0.9 → 1.1 / 1.1 | 216 / 288 → 198 / 265 |
| prime-coat-softbake | 12.8 / 13.6 s | 0.4 / 0.4 s | 6.3 / 6.3 → 0.4 / 0.4 | 1.0 / 1.1 → 1.3 / 1.3 | 121 / 174 → 140 / 145 |
| expose-peb-develop | 31.7 / 30.6 s | 0.3 / 0.3 s | 9.3 / 10.2 → 0.3 / 0.3 | 0.7 / 0.7 → 1.4 / 1.2 | 125 / 343 → 108 / 224 |
| layers-interrupt | 12.3 / 19.3 s | 1.5 / 1.4 s | 7.3 / 7.0 → 0.7 / 0.7 | 0.8 / 0.9 → 0.9 / 1.0 | 157 / 622 → 42 / 551 |
| explore-roundtrip | 7.8 / 25.7 s | 8.0 / 4.6 s | 3.6 / 16.3 → 4.1 / 2.6 | 0.7 / 0.6 → 1.1 / 1.6 | 200 / 639 → 167 / 575 |
| nav-loop | 41.2 / 41.5 s | 9.9 / 14.7 s | 10.3 / 13.6 → 4.1 / 6.3 | 0.5 / 0.6 → 0.6 / 1.4 | 176 / 539 → 222 / 415 |
| phone-coat-explore | 1.8 / 2.5 s | 1.0 / 0.8 s | 0.9 / 1.5 → 1.0 / 0.8 | 1.6 / 1.6 → 3.3 / 3.1 | 129 / 179 → 144 / 232 |
| watch-minute | 18.6 / 18.5 s | 6.2 / 7.3 s | 8.8 / 9.6 → 3.5 / 2.7 | 0.4 / 0.4 → 1.0 / 1.0 | 224 / 371 → 151 / 233 |
| **all nine** | **130 / 169 s** | **36 / 40 s** | | | |

The moves between lessons and views, per phase: long tasks in run 1 / run 2 (the longest, s);
and from run 2, the longest frame (s) while the camera was moving (it moved into the frame
before the gap and again across it: a stall in the middle of a move; a move shorter than two
frames on this renderer never counts) and while it held still (waiting for a machine, or
before a move sets off); — where no frame qualifies.

| scenario | phase | long tasks, round two | long tasks, round three | longest frame moving, two → three | longest frame otherwise, two → three |
|---|---|---|---|---|---|
| arrive-transfer-scan | to-transfer | 1 (0.2) / 1 (0.2) | 1 (0.2) / 1 (0.2) | 10.3 → — | 1.6 → 4.0 |
| arrive-transfer-scan | to-scan | 1 (0.3) / 2 (13.0) | 2 (3.2) / 2 (3.2) | 0.03 → — | 12.9 → 3.5 |
| prime-coat-softbake | to-coat | 2 (6.3) / 2 (6.3) | 0 (—) / 1 (0.07) | 6.3 → — | 1.4 → 0.9 |
| prime-coat-softbake | to-softbake | 2 (3.0) / 2 (3.7) | 1 (0.4) / 1 (0.4) | — → — | 3.7 → 1.5 |
| expose-peb-develop | to-peb | 3 (6.5) / 3 (6.5) | 0 (—) / 0 (—) | 11.0 → 3.4 | 6.5 → 1.4 |
| expose-peb-develop | to-develop | 3 (9.3) / 3 (10.2) | 1 (0.3) / 1 (0.3) | 0.10 → 0.9 | 10.2 → 0.5 |
| layers-interrupt | toggles | 4 (7.3) / 10 (7.0) | 3 (0.7) / 3 (0.7) | 4.8 → 4.9 | 10.2 → 7.8 |
| explore-roundtrip | to-fab | 2 (3.6) / 2 (3.4) | 0 (—) / 1 (2.6) | — → 1.0 | 1.1 → 1.7 |
| explore-roundtrip | to-etch | 4 (2.6) / 0 (—) | 5 (2.6) / 0 (—) | 0.02 → — | 2.2 → 1.6 |
| explore-roundtrip | demo | 0 (—) / 2 (0.9) | 0 (—) / 3 (0.7) | — → 0.6 | 5.0 → 0.7 |
| explore-roundtrip | return | 1 (0.08) / 2 (16.3) | 2 (4.1) / 0 (—) | — → — | 13.6 → 0.03 |
| nav-loop | loop | 24 (10.3) / 24 (13.6) | 10 (4.1) / 14 (6.3) | 5.7 → 1.6 | 13.6 → 6.3 |
| phone-coat-explore | to-fab | 0 (—) / 0 (—) | 0 (—) / 0 (—) | — → — | 0.05 → 0.3 |

Resources at the end of each scenario, run 2 (geometries / textures / shader programs / JS heap MB).

| scenario | round two | round three |
|---|---|---|
| home-idle | 73 / 11 / 12 / 28 | 72 / 14 / 23 / 38 |
| arrive-transfer-scan | 231 / 17 / 28 / 60 | 227 / 19 / 31 / 61 |
| prime-coat-softbake | 139 / 12 / 18 / 58 | 150 / 16 / 24 / 59 |
| expose-peb-develop | 231 / 23 / 42 / 64 | 272 / 21 / 25 / 66 |
| layers-interrupt | 361 / 22 / 32 / 66 | 363 / 16 / 27 / 63 |
| explore-roundtrip | 486 / 13 / 24 / 68 | 499 / 16 / 27 / 74 |
| nav-loop | 386 / 21 / 42 / 70 | 479 / 23 / 35 / 92 |
| phone-coat-explore | 185 / 12 / 19 / 53 | 195 / 14 / 22 / 55 |
| watch-minute | 178 / 17 / 35 / 59 | 296 / 25 / 27 / 56 |

* Navigation loop, round two (run 2): before 42 geometries, 11 textures, 13 programs → after
  twelve lessons forward and back 386 / 21 / 42. Film seconds played in 60 s of wall clock:
  33.81.
* Navigation loop, round three (run 2): before 174 geometries, 15 textures, 27 programs →
  after twelve lessons forward and back 479 / 23 / 35. Film seconds played in 60 s of wall
  clock: 39.86.

Round three forced to the `high` tier (`?quality=high`: pixel ratio up to 2, 2048² shadow
maps, a decorative shadow refresh every 4 frames; `low` is 1, 1024² and every 30; one run):
blocked (s), longest block (s), frames per second, draw calls median / max.

| scenario | blocked | longest | frames per second | draw calls |
|---|---|---|---|---|
| home-idle | 3.2 | 2.5 | 3.9 | 53 / 72 |
| arrive-transfer-scan | 6.0 | 2.3 | 1.1 | 192 / 265 |
| prime-coat-softbake | 0.5 | 0.5 | 1.2 | 140 / 145 |
| expose-peb-develop | 0.3 | 0.3 | 1.3 | 59 / 224 |
| layers-interrupt | 1.6 | 0.8 | 0.9 | 109 / 551 |
| explore-roundtrip | 6.7 | 4.3 | 1.4 | 166 / 594 |
| nav-loop | 14.2 | 5.5 | 0.7 | 239 / 291 |
| phone-coat-explore | 1.6 | 1.6 | 1.3 | 144 / 164 |
| watch-minute | 7.5 | 2.8 | 0.9 | 151 / 233 |

What the numbers show: on this renderer a frame costs 0.2–3 s whatever the build, so the frame
rates above (about one frame per second) say nothing about a GPU; they move with what is on
screen. What carries over is the work done around the frames, and where the waits fall.

* **The page is blocked far less.** Summed over the nine scenarios, the main thread was
  blocked for 130–169 s in round two and 36–40 s in this round; the longest single block of a
  run fell from 10.3–16.3 s to 4.1–6.3 s. The biggest differences are in the lithography
  sequences (exposure → PEB → develop: 31–32 s → 0.3 s; prime → coat → soft bake: 13–14 s →
  0.4 s) and the layers toggles (12–19 s → 1.4–1.5 s): the cross-section is meshed off the
  main thread, the environments are rendered once, and no shader program is compiled in the
  middle of a move any more (see *Found along the way*).
* **Waits before the moves, not in them.** Round two compiled a machine's shader programs at
  its first draw, in the move: the move into the coat lesson held one frame for 6.3 s and the
  flight into the post-exposure bake one for 11.0 s (*longest frame moving*), the page itself
  blocked for 6.3 and 6.5 s of them. This round compiles the programs in advance; where the
  browser cannot compile in the background (this renderer), the director waits for them when
  *Continue* is pressed, with the camera still, and the move starts after that. That wait is
  the 3.2 s block of the move to the inspection tool (traced: the program's info log,
  `getProgramInfoLog`, read by the director before it sets off), which is why *arrive →
  transfer → scan* still blocks the page for 5–7 s (round two: 3 s and 16 s); the navigation
  loop's 4–6 s blocks also fell while the camera was still (its longest frame while the camera
  moved was 1.6 s). The long frames that remain while the camera moves — 3.4 s into the
  post-exposure bake, 4.9 s in the layers toggles — have no long task behind them (none in the
  move to the bake; at most 0.7 s in the toggles): the page was free and the software renderer
  busy, most likely compiling in its own process the code of programs it first draws there
  (SwiftShader does this at a program's first draw; a GPU driver does it when the program is
  linked, which this round does in advance). The one-off preparation of what every lesson
  shares adds 2.4–2.8 s to the home view.
* **Less drawing where it mattered.** The scanner's lens no longer makes every frame draw the
  scene twice (at the exposure framing 207 → 109 draw calls); the cross-section has no contact
  shadow plane. Draw-call medians of whole scenarios depend on how long each view is on screen,
  so they are not a like-for-like comparison.
* **Resources settle.** After twelve lessons forward and back, round two had gone from 11
  textures and 13 shader programs to 17–21 and 40–42, this round from 15 and 27 to 22–23 and 35
  (the light count no longer changes, so no second set of programs). Geometries depend on which
  machines are still mounted as the loop ends (round two 386–408, this round 235–479); the
  frame-by-frame spec that runs the loop twice finds the second loop ending within 10 % of the
  first in geometries, and within 4 textures and 2 programs (`e2e/continuity.spec.ts`).
* **The film plays on.** Film seconds played per minute of wall clock (the film's clock
  follows the narration and holds for machines still loading): 31–34 → 37–40.
* **The `high` tier** (one run) blocks the page about as much on this machine (41.5 s in all,
  against 36–40 s at `low`). Its pixel ratio makes no difference at the desktop size here (the
  page's own ratio is 1); in the phone scenario (ratio 2) it draws four times the pixels, at
  1.3 frames per second against 3.1–3.3. Its shadow maps and pixel ratio are to be judged on a
  GPU.

Draw calls stay at a few hundred per frame at most (every render pass counted, shadow passes
included), so merging or instancing the detailed machines was not needed at this level and
was not done; the bay was already merged and pre-lit in round two.

## Recordings

All in [`docs/recordings/round3/`](recordings/round3/).

**Real time, before and after** (`scripts/perf.mjs --video`: Playwright's screencast of the
page as it actually ran on the software renderer, stalls included — each clip is as slow as
this machine is; compare the two builds, not the frame rate; round three recorded at
`3f1e472`, whose later changes touch only Watch and a loading notice, not these scenarios):

| scenario | round two | round three |
|---|---|---|
| *Inspect layers* / *Back to equipment* six times, 450 ms apart | [r3-rt-layers-interrupt-r2.mp4](recordings/round3/r3-rt-layers-interrupt-r2.mp4) | [r3-rt-layers-interrupt-r3.mp4](recordings/round3/r3-rt-layers-interrupt-r3.mp4) |
| prime → coat → soft bake at the track | [r3-rt-prime-coat-softbake-r2.mp4](recordings/round3/r3-rt-prime-coat-softbake-r2.mp4) | [r3-rt-prime-coat-softbake-r3.mp4](recordings/round3/r3-rt-prime-coat-softbake-r3.mp4) |
| a lesson → the fab → the etch cluster's demonstration → back | [r3-rt-explore-roundtrip-r2.mp4](recordings/round3/r3-rt-explore-roundtrip-r2.mp4) | [r3-rt-explore-roundtrip-r3.mp4](recordings/round3/r3-rt-explore-roundtrip-r3.mp4) |

What they show: each pair is the same scenario on the same machine, recorded as it ran (about
one frame per second on this renderer, so the clips are jerky in both builds; compare what
happens, not the smoothness). *Layers*: round two shows an empty canvas for its first seconds
and then the etch cluster's closed housing; this round keeps the veil up until the machine and
its programs are ready (longer here, since everything a lesson shares is compiled under it),
then moves between the machine, your die and the layers with each press. *Prime → coat → soft
bake*: in round two the coat lesson begins with the wafer already in the coat cup, and the
clip ends before the soft bake (the lesson changes held the page for up to 6.9 s); in this
round the robot lifts the wafer off the prime plate's pins, sets it on the raised spin chuck,
the resist spreads and thins, and the robot carries the coated wafer on towards the hot plate,
all within the clip. *Explore*: round two shows the lesson half-built behind the interface
while it loads and takes about 40 s to reach the etch cluster's demonstration; this round
shows the veil, then the coat lesson, the fab, the etch cluster (with a loading note until it
is ready) and its demonstration within 36 s.

**Frame by frame** (`scripts/record.mjs`, the harness clock: continuity evidence, not frame
rate; specs in `scripts/recordings/r3-*.json`):

* [`r3-01-track-prime-to-coat.mp4`](recordings/round3/r3-01-track-prime-to-coat.mp4) — the
  end of the prime, then the robot lifts the wafer off the prime plate's pins, carries it to
  the coat cup, sets it on the raised spin chuck; the dispense begins.
* [`r3-02-track-coat-to-softbake.mp4`](recordings/round3/r3-02-track-coat-to-softbake.mp4) —
  the spin stops on a whole turn, the chuck rises, the robot carries the coated wafer to the
  hot plate.
* [`r3-03-leave-exposure-half-way.mp4`](recordings/round3/r3-03-leave-exposure-half-way.mp4) —
  the exposure's step-and-scan meander at dose 3, then *Continue* half-way: the scanner stays
  exactly as it was while the camera leaves, and the wafer appears on the track only once the
  camera is in the aisle.
* [`r3-04-layers-reversed-mid-fade.mp4`](recordings/round3/r3-04-layers-reversed-mid-fade.mp4)
  — *Inspect layers* reversed part-way through the fade, three times, then twice in quick
  succession: every reversal dissolves from the picture on screen.
* [`r3-05-polisher-flip-steady-camera.mp4`](recordings/round3/r3-05-polisher-flip-steady-camera.mp4)
  — the contact fill: out of the layers onto the polisher as the wafer settles in the load
  cup; the flipper turns it face-down in a steady view, and the head picks it up and swings it
  to the pad.

**Reviewed frame sequences** (stills at chosen lesson points, `scripts/frames.mjs`; before =
the commit before these fixes, after = this round's build):

* enclosures stay readable: [anneal](recordings/round3/sheet-anneal.jpg), [resist
  strip](recordings/round3/sheet-strip.jpg), post-exposure bake
  [before](recordings/round3/sheet-peb-before.jpg) /
  [after](recordings/round3/sheet-peb-after.jpg), develop
  [before](recordings/round3/sheet-develop-before.jpg) /
  [after](recordings/round3/sheet-develop-after.jpg), contact etch
  [before](recordings/round3/sheet-etch-before.jpg) /
  [after](recordings/round3/sheet-etch-after.jpg);
* the camera around moving wafers: the polisher's flip
  [before](recordings/round3/sheet-cmpflip-before.jpg) /
  [after](recordings/round3/sheet-cmpflip-after.jpg), the inspection review
  [before](recordings/round3/sheet-review-before.jpg) /
  [after](recordings/round3/sheet-review-after.jpg), contact printing
  [before](recordings/round3/sheet-print-before.jpg) /
  [after](recordings/round3/sheet-print-after.jpg);
* Watch after a seek (frame by frame, `?virt=1`; before = `38d8516`, after = the final build):
  a chapter jump from the furnace into the layers with both places already loaded, the frame
  before the jump and the eleven after it
  [before](recordings/round3/sheet-watch-jump-before.jpg) /
  [after](recordings/round3/sheet-watch-jump-after.jpg), and the frame played at one film time
  next to the same time reached by a paused seek
  [before](recordings/round3/sheet-watch-seek-before.jpg) /
  [after](recordings/round3/sheet-watch-seek-after.jpg) (made by
  `scripts/recordings/watch-sheets.mjs`).

## Verification: commands and results

On the final build (`82093cf`), on the machine described under *Method*:

| command | result |
|---|---|
| `npm run typecheck` | passes (`tsc -b`, no errors) |
| `npm test` | 42 tests in 4 files pass (the process model, the film timeline, the lesson beats, and round three's stage checks: the track robot's and the scanner's motion, the thin-film colour table) |
| `npm run build` | succeeds (`tsc -b && vite build`, about 2 s): the site is 38 files, 2.4 MB, listed with their sha256 in `dist/app-files.json` for the offline package; with the film's narration (4.4 MB) the offline download is about 7 MB, as the README says |
| `npm run e2e` | 79 passed, 0 failed, 50 skipped (the frame-by-frame specs run once, at the desktop size, not again for the tablet and phone projects): one run of the whole suite, 1 h 43 min |
| `node scripts/probe.mjs http://127.0.0.1:4173 probe.json` | all cases; results above |
| `node scripts/perf.mjs http://127.0.0.1:4173 perf.json` (and `--query quality=high`) | results above |

The runs before the last one: the first full run this round, on the build before the last two
Watch changes, passed 77 and failed 2 — the seek check (its played frames froze and dissolved
half-way into a move: the case *a seek just before a move* now handles) and Explore's round trip
in `modes.spec.ts` (out of time at the desktop size); the next full run was cut short by a
restart of the machine after 29 tests, one of which, the viewport check of the gap test, had
failed on a race in its own wait (now waiting for the new aspect, not just a matching one).

New focused tests, one per requirement:

| requirement | test |
|---|---|
| leaving a part-done lesson with non-default choices does not change its outgoing picture | `e2e/continuity.spec.ts` "leaving a lesson half-way keeps the machine left behind exactly as it was"; probe `leave-partial` |
| interrupting world ↔ layers fades at several blend values; finite poses, no jump, the latest destination wins | `continuity` "reversing the cross-section fade at any point never jumps; the latest request wins", "rising out of the layers to leave for another machine, your die fades in"; probe `interrupt` |
| same-machine transitions, replay, backward seek, arbitrary chapter jumps | `continuity` "the track carries the wafer…", "going back a lesson on the same machine dissolves…"; `film-continuity` "a seek shows exactly the frame that playing would…", "chapter jumps land on a loaded, consistent scene"; round two's `modes` (scrubbing forwards and back equals playing); unit tests for the track's hand-offs; probe `pairs`, `transitions` |
| readiness delayed beyond the old timeout, load failure, navigation while a model loads | `e2e/loading.spec.ts` (four tests); probe `slow-load` (real time), `load-fail` |
| Watch plan reuse, invalidation, audio and captions after seeking and speed changes | `film-continuity` "a gap move is planned once and reused; a new viewport plans it again"; round two's `watch` (narration clock through pause, seek, 1.5×, mute, chapter jump, background); probe `film-gap` |
| Watch after a seek: no blank frame, housings as playing leaves them | `film-continuity` "a seek shows exactly the frame that playing would…" (sought and played frames at one film time), "chapter jumps land on a loaded, consistent scene" (held picture, then a dissolve, no jump) |
| reduced motion, pause/resume, hidden-tab return, resize during a flight, real UI overlays while picking | `continuity` "reduced motion…", "a hidden page resumes a move where it left it (real time)", "resizing the window during a move…"; `explore` (pointing only where the canvas is uncovered, with the overview card in place); round two's `fallbacks` and `modes` (pause, resume) |
| a repeated navigation loop with resources stabilising after warm-up | `continuity` "going back and forth through the lessons does not accumulate GPU resources"; perf `nav-loop` |
| no stall in the layers at an operation change | `round3.test.ts` "the fast table equals the full stack computation at every thickness" (the thin-film colour table, to 1e-9); probe `op-boundary` (real time, three runs) |
| no shader program compiled in the middle of a move | `scripts/programs.mjs` (real time: every program link and every blocking first use, with the camera's state); perf `intervalMs.maxMoving` |

Useful round-two tests are kept as they were, except for time: Explore's round trip in
`modes.spec.ts`, which steps every frame, now has 12 minutes (it ran past its 8 at the desktop
size once the browser was slow to start). The explorer's pointing test no longer hides
the overview card (it was hiding a real overlay to get a click through); it now asks the
page which element is under each point and only points where the canvas is uncovered. No
assertion was loosened and no test skips a failure; the new round-three specs run once, at
desktop size, because they step frames and read pixels (minutes per test on a software
renderer). Their waits are conditions (the camera settled, a machine ready), except where
real time is the scenario: a model held back at the network while 8 s of frames are rendered
(the test then lets it through), and a page hidden for 3 s. The resource loop (twenty lesson
changes, every frame of every move rendered) runs at 720 × 450: what it counts does not depend
on the canvas size, and at the desktop size it took over twenty minutes on this renderer.

Two of this round's own specs had never reached their checks: the Watch specs read the stage's
harness hooks before the canvas had mounted them, and the loading specs held the track's module
back after the lesson before it had already loaded it (the next lesson's machine is loaded
ahead). Corrected, they found the four faults described under *Watch after a seek* and *Going
back before a machine had loaded*; the Watch seek check also compared the sought frame with the
frame after it, and now compares frames at the same film time.

## Measure it on your hardware

Everything above ran on a software renderer. The targets — a steady 60 fps on an ordinary
laptop and 30 fps on a modest phone — can only be checked on real graphics hardware. A short
benchmark (about ten minutes) repeats this report's real-time scenarios on the machine it
runs on:

```bash
npm ci
npx playwright install chromium        # once, if Playwright's browser is not installed yet
npm run build
npm run preview                         # serves http://127.0.0.1:4173 (leave it running)
# in a second terminal:
node scripts/perf.mjs http://127.0.0.1:4173 perf-gpu.json --gpu --headed --label "my laptop"
node scripts/perf.mjs http://127.0.0.1:4173 perf-gpu-high.json --gpu --headed --query quality=high
```

`--gpu` uses the machine's graphics hardware instead of SwiftShader, and `--headed` runs in a
visible window (some drivers only accelerate a visible one). Each report records the renderer
string, the tier the app chose, the build's commit, and per phase the frame intervals (median,
p95, p99, frames over 50 and 100 ms, the longest while the camera moved and while it held
still), long tasks, draw calls and triangles over every render pass, and resource counts. Keep
the window in front and the machine plugged in. Read `intervalMs.median`: 16.7 ms is 60 fps,
33.3 ms is 30 fps; p95 and the count of frames over 50 ms show whether transitions stutter,
and `intervalMs.maxMoving`, the longest frame while the camera was moving, whether a move ever
stalls (`maxStill` is the longest while it held still, where a wait for a machine or for its
shader programs belongs).

For a phone, open the preview from the phone (`npm run preview -- --host`, then the
computer's address on port 4173) with `?diag=1` added: the developer overlay shows the
renderer, the tier and the reason it was chosen, the frame rate and 95th-percentile frame
time over the last second, the pixel ratio, the last render pass's draw calls and
triangles, shadow-map redraws per second, resource counts, and buttons to force each tier.
`?quality=low|medium|high` forces a tier from the address. Neither is shown to learners.

## Remaining limitations

* **No real GPU was available.** Every real-time number here was measured on SwiftShader, so
  it shows CPU and render work and relative change, not the frame rate a learner will see;
  the 60 fps (laptop) and 30 fps (phone) targets are unverified. Use the benchmark above.
* **Browsers.** Only Chromium 141 (headless shell) was available. Firefox, Safari/WebKit and
  real phones and tablets were not tested; the phone and tablet runs are emulated (viewport,
  touch, pixel ratio). Shader programs are compiled in parallel, in the background, where the
  browser has `KHR_parallel_shader_compile`; where it does not (SwiftShader here), the director
  waits for a machine's programs when the camera is still, which on the software renderer is
  1–6 s at the moment *Continue* is pressed for a new machine (the camera then leaves without
  a stall). How long that wait is on a GPU without the extension was not measured. In Watch,
  whose clock is the narration and never waits for a press, a machine's programs are still
  compiled at their first draw where the browser cannot compile in the background, and two
  programs of the etch cluster's demonstration in Explore are too (0.5–0.9 s each here).
* **Leaving a die close-up inside a machine.** The move out of the layers goes back to your die
  first, then leaves; when the wafer is inside a machine (the etch cluster's transfer chamber
  at the end of the trench etch), the camera rises through the opened housing past its robot
  for about half a second (continuous, but a busy picture: *STI etch → STI fill* in the
  whole-course walk).
* **Quality tiers** step down (and back up) from measured frame times, but their thresholds
  were set without real hardware to tune them on.
* **Shadow redraws are conservative**: any change in a machine's shown progress redraws the
  shadow map, whether or not a shadow-casting part moved.
* **Watch**: a seek holds the last good picture until the machines it needs (both ends of a
  move) are loaded and the stage shows the new time, then dissolves from it. A seek to another
  lesson that is already loaded is held for the frame the stage takes to catch up and dissolved
  too (scrubbing across lessons shows a string of short dissolves); a seek within the same
  lesson cuts. If the stage has not caught up after 2 s, the picture is shown anyway. The
  film's clock does not wait for the picture: on a slow network a held picture is a frozen
  frame while the narration goes on, and it dissolves into wherever the film has got to.
* **The track's robot is quick.** Its transfers fit in the first 14–26 % of their lessons
  (1.1–2.4 s for approach, pick, carry and place), so the carriage and the fork peak at about
  2.5 m/s, faster than a real track's transfer arm is likely to run; lengthening the transfers
  means re-timing those lessons' process, shots and narration together, which was not done.
* **Going back a lesson on the same machine** is a dissolve, not a reversed animation: under
  the dissolve the wafer is where the earlier lesson starts (it does not travel back).
* The cross-section worker needs module workers (all current browsers); without them the
  mesh is built on the main thread as before.
