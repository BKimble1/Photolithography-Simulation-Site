import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { drawWafer, lookKey, makeCanvasTexture, type WaferLook } from './waferTexture';
import { waferRegistry } from '../stage/anchors';
import { useStationEnv } from '../stage/context';
import { usePresentation } from '../../state/presentation';
import { useStep } from '../../state/sim';
import { STEP_INDEX } from '../../sim/flow';
import { filmsColor } from '../../sim/filmColor';
import { WAFER } from '../../sim/dies';
import { M } from '../../sim/materials';
import type { Film } from '../../sim/types';

/**
 * A 300 mm wafer (radius 0.15 m) with a notch. The top face shows the simulated surface;
 * the edge is polished silicon. Thickness is exaggerated ×2 so it reads at tool scale.
 */
export function useWaferGeometry(radius = 0.15, thickness = 0.0016) {
  return useMemo(() => {
    // Unit shape in [0,1]² so the cap UVs map straight onto the texture.
    const shape = new THREE.Shape();
    const n = 160;
    const notch = 0.012; // half-width of the notch in unit coords
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const da = Math.abs(((a + Math.PI / 2 + Math.PI) % (Math.PI * 2)) - Math.PI);
      let r = 0.5;
      if (da < notch / 0.5) r = 0.5 - (notch - da * 0.5) * 0.9;
      const x = 0.5 + Math.cos(a) * r;
      const y = 0.5 + Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: thickness / (2 * radius), bevelEnabled: false, curveSegments: 4 });
    g.translate(-0.5, -0.5, 0);
    g.rotateX(-Math.PI / 2);
    g.scale(2 * radius, 2 * radius, 2 * radius);
    g.computeVertexNormals();
    return g;
  }, [radius, thickness]);
}

const edgeMat = new THREE.MeshStandardMaterial({ color: '#8f949c', metalness: 0.9, roughness: 0.25 });

/**
 * A resist coat being spun on, set by the tool every frame from the exact step progress.
 *
 * This is presentation interpolation: between the process model's operations (the resist
 * exists in the simulated state only once the coat operation has run) the tool shows the
 * liquid spreading and thinning as a continuous function of progress, drawn in the wafer's
 * shader so nothing is repainted or re-uploaded. It ends exactly on the simulated film
 * (thickness and edge profile) at the operation's progress.
 */
export interface LiveCoat {
  on: boolean;
  /** Fraction of the radius covered by liquid resist (0..1). */
  coverage: number;
  /** Film thickness at the centre, nm. */
  nm: number;
  edgeRise: number;
  /** Extra thickness toward the rim while still flowing (0..1). */
  rim: number;
  /** Edge-bead removal has cleared the outer ring. */
  ebr: boolean;
}

export const makeLiveCoat = (): LiveCoat => ({ on: false, coverage: 0, nm: 0, edgeRise: 0, rim: 0, ebr: false });

const LUT_N = 256;
/** Above this the resist is a thick liquid puddle (no interference colours, just its tint). */
const LUT_MAX = 1800;
const PUDDLE: [number, number, number] = [0.55, 0.47, 0.95];

/**
 * Resist-thickness lookup: how a resist film of each thickness changes the colour of the
 * film stack beneath it (thin-film interference, from the same colour model as the texture),
 * as a per-channel ratio the shader multiplies the painted surface by.
 */
function coatLut(films: Film[]): { tex: THREE.DataTexture; puddle: THREE.Vector3 } {
  const base = filmsColor(films);
  const data = new Uint16Array(LUT_N * 4);
  const ratio = (c: [number, number, number], i: number) => c[i] / Math.max(1e-4, base[i]);
  for (let k = 0; k < LUT_N; k++) {
    const nm = (k / (LUT_N - 1)) * LUT_MAX;
    const c = filmsColor([...films, { mat: M.RES, nm }]);
    for (let i = 0; i < 3; i++) data[k * 4 + i] = THREE.DataUtils.toHalfFloat(ratio(c, i));
    data[k * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const tex = new THREE.DataTexture(data, LUT_N, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const pud = base.map((b, i) => b + (PUDDLE[i] - b) * 0.55) as [number, number, number];
  return { tex, puddle: new THREE.Vector3(ratio(pud, 0), ratio(pud, 1), ratio(pud, 2)) };
}

const COAT_GLSL = /* glsl */ `
if (uCoatOn > 0.5) {
  float u = length(vMapUv * 2.0 - 1.0);
  if (u <= uCoat.x) {
    float r = u * ${WAFER.radius.toFixed(1)};
    float ue = min(1.0, r / ${(WAFER.radius - WAFER.edgeExclusion).toFixed(1)});
    float nm = uCoat.y * (1.0 + uCoat.z * ue * ue * ue) * (1.0 + uCoat.w * pow(u, 6.0) * 2.5);
    if (uEbr > 0.5 && r > ${(WAFER.radius - 2.2).toFixed(1)}) nm = 0.0;
    vec3 k = nm > ${LUT_MAX.toFixed(1)} ? uPuddle : texture2D(uLut, vec2(clamp(nm / ${LUT_MAX.toFixed(1)}, 0.0, 1.0) * ${((LUT_N - 1) / LUT_N).toFixed(6)} + ${(0.5 / LUT_N).toFixed(6)}, 0.5)).rgb;
    diffuseColor.rgb *= k;
  }
}
`;

export function Wafer({
  look,
  radius = 0.15,
  size = 1024,
  position,
  rotation,
  roughness = 0.16,
  metalness = 0.55,
  anchor = false,
  live,
}: {
  look: WaferLook;
  /** This is the learner's wafer: register it so camera shots can frame it and your die. */
  anchor?: boolean;
  radius?: number;
  size?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  roughness?: number;
  metalness?: number;
  /** A resist coat going on, updated by the tool every frame (see LiveCoat). */
  live?: LiveCoat;
}) {
  // From the die map on, the learner's wafer always shows "your die" outlined in violet, so it
  // can be picked out wherever the wafer goes (and the camera can close in on it).
  const { index } = useStep();
  const mark = anchor && index >= STEP_INDEX.diemap && !look.highlightDie;
  look = mark ? { ...look, highlightDie: true } : look;
  const geo = useWaferGeometry(radius);
  const { canvas, tex } = useMemo(() => makeCanvasTexture(size), [size]);
  // The coat shader is part of every wafer's program (one program, prepared in advance).
  const uniforms = useMemo(
    () => ({
      uCoatOn: { value: 0 },
      uCoat: { value: new THREE.Vector4() },
      uEbr: { value: 0 },
      uLut: { value: null as THREE.Texture | null },
      uPuddle: { value: new THREE.Vector3(1, 1, 1) },
    }),
    [],
  );
  const topMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness, metalness, envMapIntensity: 1.1 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uCoatOn;\nuniform vec4 uCoat;\nuniform float uEbr;\nuniform sampler2D uLut;\nuniform vec3 uPuddle;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n' + COAT_GLSL);
    };
    m.customProgramCacheKey = () => 'wafer-coat';
    return m;
  }, [tex, roughness, metalness, uniforms]);
  const films = look.summary.films;
  const filmsKey = films.map((f) => `${f.mat}:${Math.round(f.nm)}`).join(',');
  const lut = useMemo(() => (live ? coatLut(films) : null), [!!live, filmsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => lut?.tex.dispose(), [lut]);
  useFrame(() => {
    const on = !!live?.on && !!lut;
    uniforms.uCoatOn.value = on ? 1 : 0;
    if (!on || !live || !lut) return;
    uniforms.uCoat.value.set(live.coverage, live.nm, live.edgeRise, live.rim);
    uniforms.uEbr.value = live.ebr ? 1 : 0;
    uniforms.uLut.value = lut.tex;
    uniforms.uPuddle.value.copy(lut.puddle);
  });
  const key = lookKey(look, size);
  const last = useRef('');
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawWafer(ctx, size, look);
    tex.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(
    () => () => {
      tex.dispose();
      topMat.dispose();
    },
    [tex, topMat],
  );
  const { station } = useStationEnv();
  const parked = !!usePresentation()?.parked;
  const mesh = useRef<THREE.Mesh>(null);
  useEffect(() => {
    if (!anchor || parked || !station || !mesh.current) return;
    const m = mesh.current;
    waferRegistry.set(station, m);
    return () => {
      if (waferRegistry.get(station) === m) waferRegistry.delete(station);
    };
  }, [anchor, parked, station]);
  // An idle machine the story is not at holds no learner wafer.
  if (anchor && parked) return null;
  return <mesh ref={mesh} geometry={geo} material={[topMat, edgeMat]} position={position} rotation={rotation} castShadow receiveShadow />;
}
