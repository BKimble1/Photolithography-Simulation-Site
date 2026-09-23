/**
 * The Watch controller: loads the film manifest, builds the timeline, owns the player and
 * publishes a small UI state (throttled) for the controls and captions. Watch never reads or
 * writes the learning run.
 */
import { create } from 'zustand';
import narration from '../content/narration.json';
import { stageTime, TEST_HOOKS, VIRTUAL_TIME } from '../three/stage/time';
import { filmAudio, FilmPlayer, type FilmStatus } from './player';
import { buildTimeline, cueAt, locate, type FilmManifest, type Timeline } from './timeline';

export const FILM_VERSION: string = narration.version;
export const FILM_BASE = `${import.meta.env.BASE_URL}narration/${FILM_VERSION}/`;

export interface FilmUi {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  tl: Timeline | null;
  status: FilmStatus;
  /** Film time for the UI (updated a few times a second and on every event). */
  t: number;
  rate: number;
  volume: number;
  muted: boolean;
  captions: boolean;
  audioOk: boolean;
  audioError: string | null;
  cue: string | null;
  /** Index of the segment on screen. */
  seg: number;
}

export const useFilm = create<FilmUi>(() => ({
  phase: 'idle',
  error: null,
  tl: null,
  status: 'paused',
  t: 0,
  rate: 1,
  volume: 1,
  muted: false,
  captions: true,
  audioOk: true,
  audioError: null,
  cue: null,
  seg: 0,
}));

let player: FilmPlayer | null = null;
const tickListeners = new Set<() => void>();

/** Called after every clock tick (the stage follows the film through this). */
export function onFilmTick(fn: () => void): () => void {
  tickListeners.add(fn);
  return () => {
    tickListeners.delete(fn);
  };
}

function tick() {
  if (!player) return;
  player.tick();
  tickListeners.forEach((f) => f());
  publish();
}
let raf = 0;
/** Bumped by every open and close, so a slow load cannot resurrect a closed film. */
let generation = 0;
let manifestPromise: Promise<FilmManifest> | null = null;

export const filmPlayer = () => player;

let gestureAt = -Infinity;

/** Record that the viewer clicked Watch (sound may start without another click). */
export function markFilmGesture(): void {
  filmAudio(true);
  gestureAt = performance.now();
}

/** Whether the film was opened by a click just now. */
export function takeFilmGesture(): boolean {
  return performance.now() - gestureAt < 4000;
}

function publish(force = false) {
  const p = player;
  if (!p) return;
  const cur = useFilm.getState();
  const cue = cueAt(p.tl, p.t)?.text ?? null;
  const seg = locate(p.tl, p.t).seg.index;
  const t = Math.round(p.t * 4) / 4;
  if (!force && cur.t === t && cur.cue === cue && cur.status === p.status && cur.seg === seg) return;
  useFilm.setState({ t: p.t, cue, seg, status: p.status, rate: p.rate, volume: p.volume, muted: p.muted, audioOk: p.audioOk, audioError: p.audioError });
}

function loop() {
  raf = requestAnimationFrame(loop);
  // In the frame-stepped harness the film ticks with each rendered frame instead.
  if (!VIRTUAL_TIME) tick();
}

export async function loadManifest(): Promise<FilmManifest> {
  if (!manifestPromise)
    manifestPromise = fetch(FILM_BASE + 'manifest.json').then((r) => {
      if (!r.ok) throw new Error(`manifest ${r.status}`);
      return r.json() as Promise<FilmManifest>;
    });
  manifestPromise.catch(() => (manifestPromise = null));
  return manifestPromise;
}

/** Open the film at time t (seconds). Starts playing if `autoplay` (after a Watch click). */
export async function openFilm(t = 0, autoplay = true): Promise<void> {
  if (player) return;
  const gen = ++generation;
  useFilm.setState({ phase: 'loading', error: null });
  try {
    const manifest = await loadManifest();
    if (gen !== generation) return;
    const tl = buildTimeline(manifest);
    // In the frame-stepped test harness there is no real playback: captions-only clock.
    player = new FilmPlayer(tl, FILM_BASE, () => publish(true), VIRTUAL_TIME ? null : filmAudio());
    useFilm.setState({ phase: 'ready', tl });
    player.seek(t);
    if (autoplay) player.play();
    publish(true);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
    if (VIRTUAL_TIME) stageTime.beforeFrame = tick;
  } catch (e) {
    if (gen === generation) useFilm.setState({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

export function closeFilm(): void {
  generation++;
  cancelAnimationFrame(raf);
  player?.dispose();
  player = null;
  stageTime.beforeFrame = null;
  useFilm.setState({ phase: 'idle', tl: null, status: 'paused', cue: null });
}

export const filmControls = {
  toggle: () => player?.toggle(),
  play: () => player?.play(),
  pause: () => player?.pause(),
  seek: (t: number) => player?.seek(t),
  rate: (r: number) => player?.setRate(r),
  volume: (v: number) => player?.setVolume(v),
  muted: (m: boolean) => player?.setMuted(m),
  retryAudio: () => player?.retryAudio(),
  captions: (on: boolean) => useFilm.setState({ captions: on }),
};

if (TEST_HOOKS) (window as unknown as { __fabFilm: unknown }).__fabFilm = { filmPlayer, useFilm, filmControls };
