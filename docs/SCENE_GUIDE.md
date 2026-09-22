# Building a tool scene

Each equipment scene lives in its own file in `src/three/tools/` and owns a camera pose file
in `src/three/tools/poses/`. Scenes are lazy-loaded by `src/three/tools/index.tsx`.

## Contract

```tsx
import type { ToolProps } from './index';
export default function Etch({ variant }: ToolProps) { ... }
```

* Units are **metres**. The floor is `y = 0`. Wafer-handling decks sit around `y ≈ 0.85–1.0`.
  A 300 mm wafer has radius `0.15`. Equipment is illustrative, not any manufacturer's design:
  no logos, brand names or copied product shapes.
* The current simulated wafer comes from `useSimState()` (`state.wafer` is the wafer summary).
  Draw it with `<Wafer look={{ summary: state.wafer, showParticles: true }} position={...} size={768} />`
  from `src/three/wafer/Wafer.tsx`. The wafer lies flat, notch toward +z.
* The step animation is a pure function of progress `p ∈ [0,1]`:
  - `useProgressFrame((p, t) => { ref.current.position.y = ... })` for per-frame transforms
    (`t` is wall-clock seconds for idle motion such as fans; anything that tells the process
    story must depend on `p` only, so scrubbing and replay are exact);
  - `useProgressBucket(n)` when React needs to re-render at thresholds;
  - helpers `seg`, `smooth`, `ease`, `lerp` from `src/three/anim.ts`.
* Which step is playing: `useStep()` → `{ id, content }` (`content.variant`, `content.at` = the
  progress values at which the process model applies each operation — align visuals to these).
* Materials: `MAT` in `src/three/materials.ts`. Parts: `Box`, `Cyl`, `Lathe`, `Chuck`, `Bowl`,
  `NozzleArm`, `ScaraRobot`, `LightTower`, `Cabinet`, `CleanFloor`, `ShadowBlob` in
  `src/three/kit/parts.tsx`. **Do not edit shared files** (materials, parts, anim, Stage, poses.ts,
  Wafer, other scenes). If you need a new helper or material, define it in your own file.
* Camera: edit only your own `src/three/tools/poses/<scene>.ts` (`POSE`, optional `variants`).
  The camera eases to the pose on step change; the learner can orbit and zoom.

## Look

Calm, precise, expensive: brushed stainless (`steel`, `steelSatin`), white powder-coated panels
(`panel`), dark glass, black anodised details, ceramic chucks. One violet accent at most (status
light). Cutaway fronts so the mechanism is visible. Real light emission is allowed where it
exists (plasma glow in an etch chamber, heater glow in a furnace), kept subtle. Beams of
invisible radiation (UV, ions, electrons) are only drawn as optional educational overlays.
Keep scenes efficient: memoise geometry, share materials, a few hundred meshes at most, no
network assets.

## Verify

The dev server runs at `http://127.0.0.1:5173`. Freeze any step at a progress value and grab a
screenshot:

```
node scripts/shot.mjs "http://127.0.0.1:5173/?step=gate-etch&p=0.5" /tmp/shot.png 1440 900 6000
```

Look at several progress values and every variant. Type-check with `npx tsc -b` (fix errors
in your own files only).
