import { lazy, Suspense, useMemo } from 'react';
import type { ViewLevel } from '../content/steps';
import { CUT_Y } from '../sim/layout';
import { M } from '../sim/materials';
import { columnStack } from '../sim/metrology';
import { useSimState, useStep } from '../state/sim';
import { useApp, useClock } from '../state/store';
import { SCALE_TEXT } from '../three/poses';
import { matColor } from './palette';

const Stage = lazy(() => import('../three/Stage').then((m) => ({ default: m.Stage })));

const LEVELS: { id: ViewLevel; label: string; key: string }[] = [
  { id: 'fab', label: 'Fab', key: '1' },
  { id: 'tool', label: 'Tool', key: '2' },
  { id: 'wafer', label: 'Wafer', key: '3' },
  { id: 'device', label: 'Device', key: '4' },
];

function ViewSwitch() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  return (
    <div className="levels" role="group" aria-label="Zoom level">
      {LEVELS.map((l) => (
        <button key={l.id} aria-pressed={view === l.id} onClick={() => setView(l.id)} aria-keyshortcuts={l.key} title={`${l.label} (${l.key})`}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

function ScaleChip() {
  const view = useApp((s) => s.view);
  const [a, b] = SCALE_TEXT[view];
  return (
    <div className="scalechip" aria-live="polite">
      <b>{a}</b> · {b}
    </div>
  );
}

function Scrubber() {
  const progress = useClock((c) => Math.round(c.progress * 200) / 200);
  const playing = useClock((c) => c.playing);
  const { content } = useStep();
  const toggle = useClock((c) => c.toggle);
  const set = useClock((c) => c.set);
  const pause = useClock((c) => c.pause);
  const secs = content.duration;
  return (
    <div className="scrub">
      <button className="scrub__play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} aria-keyshortcuts="Space">
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <rect x="2" y="1" width="3" height="10" fill="currentColor" />
            <rect x="7" y="1" width="3" height="10" fill="currentColor" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M3 1.5 L10.5 6 L3 10.5 Z" fill="currentColor" />
          </svg>
        )}
      </button>
      <input
        className="range scrub__range"
        type="range"
        min={0}
        max={1}
        step={0.005}
        value={progress}
        aria-label="Scrub through this step's animation"
        style={{ ['--pct' as string]: `${progress * 100}%` }}
        onChange={(e) => {
          pause();
          set(Number(e.target.value));
        }}
      />
      <span className="scrub__time" title="Animation time (condensed)">
        {Math.round(progress * secs)}s / {secs}s
      </span>
    </div>
  );
}

/** Small layer inset: the stack at one point of the die (bottom-right, like the concept). */
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
  const H = 70;
  const total = layers.reduce((a, l) => a + Math.min(6, Math.max(1.4, l.t)), 0);
  let y = 12;
  return (
    <div className="inset" aria-label="Layer stack at your die">
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
        <div className="inset__title">Layers here</div>
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

function DeviceTools() {
  const xray = useApp((s) => s.xray);
  const cutaway = useApp((s) => s.cutaway);
  const toggle = useApp((s) => s.toggle);
  return (
    <div className="vp-tools">
      <button className="pill" aria-pressed={cutaway} onClick={() => toggle('cutaway')}>
        <span className="sw" aria-hidden /> Cutaway
      </button>
      <button className="pill" aria-pressed={xray} onClick={() => toggle('xray')}>
        <span className="sw" aria-hidden /> X-ray insulators
      </button>
    </div>
  );
}

function LightToggle() {
  const on = useApp((s) => s.lightPath);
  const toggle = useApp((s) => s.toggle);
  return (
    <div className="vp-tools">
      <button className="pill" aria-pressed={on} onClick={() => toggle('lightPath')}>
        <span className="sw" aria-hidden /> Light path
      </button>
    </div>
  );
}

export function Viewport() {
  const view = useApp((s) => s.view);
  const { content } = useStep();
  const describe = `${SCALE_TEXT[view][0]} view: ${content.title}`;
  return (
    <section className="viewport" aria-label={`3D view. ${describe}. Drag to rotate, scroll or pinch to zoom.`}>
      <Suspense fallback={<div className="vp-message">Loading the fab…</div>}>
        <Stage />
      </Suspense>
      <div className="vp-top">
        <ViewSwitch />
        {view === 'device' ? <DeviceTools /> : view === 'tool' && content.scene === 'scanner' ? <LightToggle /> : <ScaleChip />}
      </div>
      <div className="vp-bottom">
        <Scrubber />
        {view !== 'fab' && <LayerInset />}
      </div>
    </section>
  );
}
