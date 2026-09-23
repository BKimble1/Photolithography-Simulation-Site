import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { drawWafer, lookKey, makeCanvasTexture, PUDDLE, RESIST_MAX_NM, type WaferLook } from './waferTexture';
import { framingRegistry, waferRegistry } from '../stage/anchors';
import { useStationEnv } from '../stage/context';
import { usePresentation } from '../../state/presentation';
import { useStep } from '../../state/sim';
import { STEP_INDEX } from '../../sim/flow';
import { filmsColor } from '../../sim/filmColor';
import { WAFER } from '../../sim/dies';
import { M } from '../../sim/materials';
import type { Film } from '../../sim/types';
import type { MatId } from '../../sim/materials';

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

/** What a live film is made of: its material, label (a film with the same label below it
 * grows thicker instead of stacking) and the thickest it gets, nm. Resist by default. */
export interface LiveFilmSpec {
  mat: MatId;
  label?: string;
  max: number;
}

const LUT_N = 256;
/** Resist (beyond RESIST_MAX_NM it is a liquid puddle: no interference colours, just its tint). */
const RESIST_SPEC: LiveFilmSpec = { mat: M.RES, max: RESIST_MAX_NM };

/** The film stack with `nm` of the live film added (on top, or thickening the same layer). */
function withFilm(films: Film[], spec: LiveFilmSpec, nm: number): Film[] {
  const last = films[films.length - 1];
  if (last && spec.label !== undefined && last.mat === spec.mat && last.label === spec.label) return [...films.slice(0, -1), { ...last, nm: last.nm + nm }];
  return [...films, { mat: spec.mat, nm, label: spec.label ?? '' }];
}

/**
 * Thickness lookup: how the live film at each thickness changes the colour of the stack the
 * texture shows (thin-film interference, from the same colour model as the texture), as a
 * per-channel ratio the shader multiplies the painted surface by.
 */
function filmLut(films: Film[], spec: LiveFilmSpec): { tex: THREE.DataTexture; puddle: THREE.Vector3 } {
  const base = filmsColor(films);
  const data = new Uint16Array(LUT_N * 4);
  const ratio = (c: [number, number, number], i: number) => c[i] / Math.max(1e-4, base[i]);
  for (let k = 0; k < LUT_N; k++) {
    const c = filmsColor(withFilm(films, spec, (k / (LUT_N - 1)) * spec.max));
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

/**
 * Exposure fields being printed, set by the scanner every frame: fields [0, done) are
 * exposed, the one being scanned fades in as the slit sweeps it (presentation of the latent
 * image, which the model only records once the exposure operation has run).
 */
export interface LiveFields {
  on: boolean;
  done: number;
}
const MAX_FIELDS = 128;

function fieldsTexture(fields: readonly { x: number; y: number; w: number; h: number }[]): THREE.DataTexture {
  const data = new Float32Array(MAX_FIELDS * 4);
  fields.slice(0, MAX_FIELDS).forEach((f, i) => data.set([f.x, f.y, f.w, f.h], i * 4));
  const tex = new THREE.DataTexture(data, MAX_FIELDS, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const R_MM = WAFER.radius.toFixed(1);
const COAT_GLSL = /* glsl */ `
if (uCoatOn > 0.5) {
  float u = length(vMapUv * 2.0 - 1.0);
  if (u <= uCoat.x) {
    float r = u * ${R_MM};
    float ue = min(1.0, r / ${(WAFER.radius - WAFER.edgeExclusion).toFixed(1)});
    float nm = uCoat.y * (1.0 + uCoat.z * ue * ue * ue) * (1.0 + uCoat.w * pow(u, 6.0) * 2.5);
    if (uEbr > 0.5 && r > ${(WAFER.radius - 2.2).toFixed(1)}) nm = 0.0;
    vec3 k = (uPuddleOn > 0.5 && nm > uLutMax) ? uPuddle : texture2D(uLut, vec2(clamp(nm / uLutMax, 0.0, 1.0) * ${((LUT_N - 1) / LUT_N).toFixed(6)} + ${(0.5 / LUT_N).toFixed(6)}, 0.5)).rgb;
    diffuseColor.rgb *= k;
  }
}
if (uFieldsOn > 0.5) {
  vec2 mm = (vMapUv * 2.0 - 1.0) * ${R_MM};
  float fill = 0.0;
  float edge = 0.0;
  for (int i = 0; i < ${MAX_FIELDS}; i++) {
    if (float(i) >= uFieldsDone) break;
    vec4 f = texture2D(uFields, vec2((float(i) + 0.5) / ${MAX_FIELDS.toFixed(1)}, 0.5));
    vec2 d = abs(mm - f.xy) - f.zw * 0.5;
    float m = max(d.x, d.y);
    if (m > 0.0) continue;
    float k = clamp(uFieldsDone - float(i), 0.0, 1.0);
    fill = max(fill, k);
    edge = max(edge, k * step(-0.45, m));
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.672, 0.617, 1.0), 0.28 * fill);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.144, 0.102, 0.947), 0.55 * edge);
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
  liveFilm = RESIST_SPEC,
  liveFields,
  fieldRects,
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
  /** A film going on (a resist coat, a deposition), updated by the tool every frame. */
  live?: LiveCoat;
  /** What that film is (resist unless given). */
  liveFilm?: LiveFilmSpec;
  /** Exposure fields being printed, updated by the tool every frame, and where they are (mm). */
  liveFields?: LiveFields;
  fieldRects?: readonly { x: number; y: number; w: number; h: number }[];
}) {
  // From the die map on, the learner's wafer always shows "your die" outlined in violet, so it
  // can be picked out wherever the wafer goes (and the camera can close in on it).
  const { index } = useStep();
  const mark = anchor && index >= STEP_INDEX.diemap && !look.highlightDie;
  look = mark ? { ...look, highlightDie: true } : look;
  // A resist on the wafer (coated, baked or exposed: not yet developed) is drawn by the shader,
  // exactly as the coat lesson draws it going on, so a wafer never changes look when one lesson
  // hands it to the next; the texture shows the surface under it (and is not repainted when
  // the resist is baked or exposed).
  const r = look.summary.resist;
  const resist = !live && r && r.phase !== 'developed' ? r : null;
  const settled = useMemo<LiveCoat | null>(
    () => (resist ? { on: true, coverage: 1, nm: resist.nm, edgeRise: resist.edgeRise, rim: 0, ebr: true } : null),
    [resist?.nm, resist?.edgeRise], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (resist) look = { ...look, summary: { ...look.summary, resist: null } };
  const coat = live ?? settled ?? undefined;
  const geo = useWaferGeometry(radius);
  const { canvas, tex } = useMemo(() => makeCanvasTexture(size), [size]);
  // The coat shader is part of every wafer's program (one program, prepared in advance).
  const uniforms = useMemo(
    () => ({
      uCoatOn: { value: 0 },
      uCoat: { value: new THREE.Vector4() },
      uEbr: { value: 0 },
      uLut: { value: null as THREE.Texture | null },
      uLutMax: { value: 1 },
      uPuddleOn: { value: 0 },
      uPuddle: { value: new THREE.Vector3(1, 1, 1) },
      uFieldsOn: { value: 0 },
      uFieldsDone: { value: 0 },
      uFields: { value: null as THREE.Texture | null },
    }),
    [],
  );
  const topMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness, metalness, envMapIntensity: 1.1 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uCoatOn;\nuniform vec4 uCoat;\nuniform float uEbr;\nuniform sampler2D uLut;\nuniform float uLutMax;\nuniform float uPuddleOn;\nuniform vec3 uPuddle;\nuniform float uFieldsOn;\nuniform float uFieldsDone;\nuniform sampler2D uFields;',
        )
        .replace('#include <map_fragment>', '#include <map_fragment>\n' + COAT_GLSL);
    };
    m.customProgramCacheKey = () => 'wafer-coat';
    return m;
  }, [tex, roughness, metalness, uniforms]);
  const films = look.summary.films;
  const filmsKey = films.map((f) => `${f.mat}:${Math.round(f.nm)}`).join(',');
  const specKey = `${liveFilm.mat}:${liveFilm.label ?? ''}:${liveFilm.max}`;
  const lut = useMemo(() => (coat ? filmLut(films, liveFilm) : null), [!!coat, filmsKey, specKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => lut?.tex.dispose(), [lut]);
  const fieldsTex = useMemo(() => (fieldRects ? fieldsTexture(fieldRects) : null), [fieldRects]);
  useEffect(() => () => fieldsTex?.dispose(), [fieldsTex]);
  useFrame(() => {
    const on = !!coat?.on && !!lut;
    uniforms.uCoatOn.value = on ? 1 : 0;
    if (on && coat && lut) {
      uniforms.uCoat.value.set(coat.coverage, coat.nm, coat.edgeRise, coat.rim);
      uniforms.uEbr.value = coat.ebr ? 1 : 0;
      uniforms.uLut.value = lut.tex;
      uniforms.uLutMax.value = liveFilm.max;
      uniforms.uPuddleOn.value = liveFilm.mat === M.RES ? 1 : 0;
      uniforms.uPuddle.value.copy(lut.puddle);
    }
    const fOn = !!liveFields?.on && !!fieldsTex && liveFields.done > 0;
    uniforms.uFieldsOn.value = fOn ? 1 : 0;
    if (fOn && liveFields && fieldsTex) {
      uniforms.uFieldsDone.value = Math.min(fieldRects!.length, liveFields.done);
      uniforms.uFields.value = fieldsTex;
    }
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

/**
 * A steadier stand-in for the learner's wafer, for shots to frame instead of the wafer itself
 * (see anchors.ts, framingRegistry): an empty object in the wafer mesh's own frame, which the
 * machine keeps where the wafer rests, right side up, while it flips, spins or scans the wafer.
 */
export function WaferFraming({ frameRef, position, rotation }: { frameRef?: React.RefObject<THREE.Group | null>; position?: [number, number, number]; rotation?: [number, number, number] }) {
  const own = useRef<THREE.Group>(null);
  const ref = frameRef ?? own;
  const { station } = useStationEnv();
  const parked = !!usePresentation()?.parked;
  useEffect(() => {
    const o = ref.current;
    if (parked || !station || !o) return;
    framingRegistry.set(station, o);
    return () => {
      if (framingRegistry.get(station) === o) framingRegistry.delete(station);
    };
  }, [ref, parked, station]);
  return <group ref={ref} position={position} rotation={rotation} />;
}
