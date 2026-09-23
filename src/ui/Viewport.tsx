/**
 * The viewport: the one persistent 3D canvas (shared by every mode) plus the lesson's
 * heads-up display. The canvas element never unmounts when the mode changes; only the
 * surrounding layout and the controls drawn over it do.
 */
import { lazy, Suspense, useMemo } from 'react';
import { CUT_Y } from '../sim/layout';
import { M } from '../sim/materials';
import { columnStack } from '../sim/metrology';
import { useSimState, useStep } from '../state/sim';
import { useApp, useClock, type ScaleId } from '../state/store';
import { LabelLayer } from '../three/labels';
import { directorCommands, useStageInfo } from '../three/stage/info';
import { Caption } from './Caption';
import { PauseIcon, PlayIcon } from './Chrome';
import { CrossSection } from './CrossSection';
import { ErrorBoundary, HAS_WEBGL } from './ErrorBoundary';
import { matColor } from './palette';

const Stage = lazy(() => import('../three/Stage').then((m) => ({ default: m.Stage })));

/** Quiet, non-interactive: what scale the picture is at, and how literally to take it. */
export const SCALE_LABEL: Record<ScaleId, [string, string]> = {
  fab: ['Fab bay', 'conceptual layout'],
  tool: ['Equipment view', 'stylised machine'],
  wafer: ['Wafer surface', '300 mm wafer'],
  device: ['Magnified cross-section', 'one inverter cell · schematic, not to scale'],
};

export function ScaleLabel() {
  const scale = useStageInfo((s) => s.scale);
  const [a, b] = SCALE_LABEL[scale];
  return (
    <div className="scale-label" data-occludes>
      <b>{a}</b>
      <span>{b}</span>
    </div>
  );
}

// ───────────────────────────── lesson HUD ─────────────────────────────

/** Scenes whose invisible radiation (UV light, ions, electrons) can be shown as an overlay. */
const BEAM_SCENES: Partial<Record<string, string>> = {
  scanner: 'Light path',
  implant: 'Beam path',
  inspect: 'Laser path',
  metrology: 'Beam path',
};

function Commands() {
  const space = useStageInfo((s) => s.space);
  const flying = useStageInfo((s) => s.flying);
  const freeLook = useStageInfo((s) => s.freeLook);
  const override = useApp((s) => s.scaleOverride);
  const setOverride = useApp((s) => s.setScaleOverride);
  const lightPath = useApp((s) => s.lightPath);
  const xray = useApp((s) => s.xray);
  const cutaway = useApp((s) => s.cutaway);
  const toggle = useApp((s) => s.toggle);
  const { content } = useStep();
  const beam = BEAM_SCENES[content.scene];
  const inDevice = space === 'device';
  return (
    <div className="vp-commands" data-occludes>
      {inDevice ? (
        <button className="cmd" onClick={() => setOverride('tool')} aria-keyshortcuts="I" disabled={flying && override === 'tool'}>
          Back to equipment
        </button>
      ) : (
        <button className="cmd" onClick={() => setOverride('device')} aria-keyshortcuts="I" disabled={flying && override === 'device'}>
          Inspect layers
        </button>
      )}
      {(override !== null || freeLook) && (
        <button
          className="cmd cmd--quiet"
          onClick={() => {
            setOverride(null);
            directorCommands.recentre();
          }}
          aria-keyshortcuts="G"
        >
          Guided view
        </button>
      )}
      {!inDevice && beam && (
        <button className="cmd cmd--toggle" aria-pressed={lightPath} onClick={() => toggle('lightPath')}>
          <span className="sw" aria-hidden /> {beam}
        </button>
      )}
      {inDevice && (
        <>
          <button className="cmd cmd--toggle" aria-pressed={cutaway} onClick={() => toggle('cutaway')}>
            <span className="sw" aria-hidden /> Cutaway
          </button>
          <button className="cmd cmd--toggle" aria-pressed={xray} onClick={() => toggle('xray')}>
            <span className="sw" aria-hidden /> X-ray insulators
          </button>
        </>
      )}
    </div>
  );
}

export function Scrubber() {
  const progress = useClock((c) => Math.round(c.progress * 200) / 200);
  const playing = useClock((c) => c.playing || c.pendingPlay);
  const { content } = useStep();
  const toggle = useClock((c) => c.toggle);
  const set = useClock((c) => c.set);
  const secs = content.duration;
  return (
    <div className="scrub" data-occludes>
      <button className="scrub__play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} aria-keyshortcuts="Space">
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <input
        className="range scrub__range"
        type="range"
        min={0}
        max={1}
        step={0.005}
        value={progress}
        aria-label="Scrub through this step"
        aria-valuetext={`${Math.round(progress * secs)} of ${secs} seconds`}
        style={{ ['--pct' as string]: `${progress * 100}%` }}
        onChange={(e) => {
          useClock.getState().pause();
          set(Number(e.target.value));
        }}
      />
      <span className="scrub__time" title="Animation time (condensed)">
        {Math.round(progress * secs)}s / {secs}s
      </span>
    </div>
  );
}

/** After Explore or Watch, the lesson waits where it was: offer Resume instead of surprise playback. */
function ResumePrompt() {
  const from = useApp((s) => s.resumeFrom);
  const dismiss = useApp((s) => s.dismissResume);
  if (!from) return null;
  return (
    <div className="resume" role="status" data-occludes>
      <span>Paused where you left it.</span>
      <button className="btn btn--primary btn--small" onClick={() => useClock.getState().play()}>
        <PlayIcon /> Resume
      </button>
      <button className="icon-btn icon-btn--small" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

/** Small layer inset: the stack at one point of your die. */
function LayerInset() {
  const state = useSimState();
  const layers = useMemo(() => {
    // Sample over the NMOS drain at the cut line and summarise distinct materials, top first.
    const st = columnStack(state.grid, 34, CUT_Y);
    const out: { label: string; color: string; t: number }[] = [];
    for (let i = st.length - 1; i >= 0 && out.length < 5; i--) {
      const l = st[i];
      if (l.mat === M.SI && out.some((o) => o.label.endsWith('silicon') || o.label.includes('well') || o.label === 'Silicon')) continue;
      const label = l.mat === M.SI ? 'Silicon' : l.label;
      if (out.length && out[out.length - 1].label === label) continue;
      out.push({ label, color: matColor(l.mat, l.mat === M.SI ? 0 : l.tag), t: l.thickness });
    }
    return out;
  }, [state]);
  if (!layers.length) return null;
  const H = 70;
  const total = layers.reduce((a, l) => a + Math.min(6, Math.max(1.4, l.t)), 0);
  let y = 12;
  return (
    <div className="inset" aria-label="Layer stack at your die" data-occludes>
      <svg width="92" height="84" viewBox="0 0 92 84" aria-hidden>
        {layers.map((l, i) => {
          const h = (Math.min(6, Math.max(1.4, l.t)) / total) * H;
          const yy = y;
          y += h;
          return (
            <g key={i}>
              <path d={`M6 ${yy + 8} L56 ${yy + 8} L86 ${yy} L36 ${yy} Z`} fill={l.color} opacity={0.95} />
              <rect x={6} y={yy + 8} width={50} height={h} fill={l.color} />
              <path d={`M56 ${yy + 8} L86 ${yy} L86 ${yy + h} L56 ${yy + 8 + h} Z`} fill={l.color} style={{ filter: 'brightness(0.82)' }} />
            </g>
          );
        })}
      </svg>
      <div>
        <div className="inset__title">Layers at your die</div>
        <ul className="inset__legend">
          {layers.map((l, i) => (
            <li key={i}>
              <span className="sw" style={{ background: l.color }} />
              {l.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function LearnHud() {
  const space = useStageInfo((s) => s.space);
  return (
    <>
      <div className="vp-top">
        <ScaleLabel />
        <Commands />
      </div>
      <div className="vp-bottom">
        <ResumePrompt />
        <Caption where="overlay" />
        <div className="vp-bottom__row">
          <Scrubber />
          {space !== 'device' && <LayerInset />}
        </div>
      </div>
    </>
  );
}

// ───────────────────────────── the canvas host ─────────────────────────────

/** Without WebGL, the lesson shows the same state as a 2D cross-section. */
export function FlatView() {
  const state = useSimState();
  const { content } = useStep();
  return (
    <div className="vp-flat">
      <CrossSection grid={state.grid} title={`Cross-section of your die: ${content.title}`} />
      <p className="vp-flat__note">3D isn’t available in this browser, so you’re seeing the cross-section of your die. Every step, control and result still works.</p>
    </div>
  );
}

export function StageHost({ fallback }: { fallback: React.ReactNode }) {
  if (!HAS_WEBGL) return <>{fallback}</>;
  return (
    <ErrorBoundary fallback={fallback}>
      <Suspense fallback={<div className="vp-message">Loading the fab…</div>}>
        <Stage />
      </Suspense>
    </ErrorBoundary>
  );
}

export { HAS_WEBGL, LabelLayer };
