import { useEffect, useMemo, useRef } from 'react';
import { DIES, FULL_DIE_COUNT, INCOMING_PARTICLES, particleKills, YOUR_DIE, WAFER } from '../sim/dies';
import { STEP_INDEX } from '../sim/flow';
import type { Grid } from '../sim/grid';
import { CONTACT_MARGIN } from '../sim/layout';
import { M } from '../sim/materials';
import { CONTACT_LABELS, OVERLAY_SPEC } from '../sim/metrology';
import { mulberry32 } from '../sim/rng';
import { DEFAULT_CHOICES, type Choices } from '../sim/types';
import type { WaferMapResult } from '../sim/waferMap';
import { engine, useStateAtStepEnd, useWaferMap } from '../state/sim';
import { useApp, useClock } from '../state/store';
import { CHOICE_STEP } from './controls';

// ───────────────────────────── knowledge checks ─────────────────────────────

export function DevelopCheck() {
  const ans = useApp((s) => s.checks.develop);
  const answer = useApp((s) => s.answer);
  const options = [
    'The resist that was exposed to light',
    'The resist that stayed in shadow under the chrome',
    'The polysilicon beneath the openings',
  ];
  const feedback = [
    'Right. Exposure made that resist soluble, so it washes away. Watch openings appear over the sources and drains.',
    'That is how a negative resist behaves. This is a positive resist: the exposed areas dissolve, and the shadowed lines stay.',
    'The developer only dissolves resist. Changing the layer underneath takes an etch, which comes after inspection.',
  ];
  const pick = (i: number) => {
    answer('develop', { choice: i, correct: i === 0 });
    useClock.setState({ progress: 0, playing: !useApp.getState().reducedMotion });
    if (useApp.getState().reducedMotion) useClock.getState().set(1);
  };
  return (
    <div className={'card card--check'} role="group" aria-labelledby="chk-dev">
      <p className="card__title">Predict first</p>
      <p className="card__q" id="chk-dev">
        This is a positive resist. What will the developer remove?
      </p>
      <div className="options">
        {options.map((o, i) => (
          <button
            key={i}
            className={'option' + (ans ? (i === 0 ? ' is-correct' : ans.choice === i ? ' is-wrong' : '') : '')}
            aria-pressed={ans ? ans.choice === i || i === 0 : false}
            onClick={() => pick(i)}
          >
            {o}
          </button>
        ))}
      </div>
      {ans && (
        <p className="feedback" aria-live="polite">
          <strong>{ans.correct ? 'Correct. ' : 'Not quite. '}</strong>
          {feedback[ans.choice]}
        </p>
      )}
    </div>
  );
}

export function ContactCheck() {
  const choices = useApp((s) => s.choices);
  const ans = useApp((s) => s.checks.contact);
  const answer = useApp((s) => s.answer);
  const touches = engine.contactTouches(choices);
  const truthYes = touches.length === 0;
  const answeredHere = ans && ans.overlay === choices.overlay;
  const pick = (i: number) => {
    const correct = (i === 0) === truthYes;
    answer('contact', { choice: i, correct, overlay: choices.overlay });
  };
  const names = touches.map((n) => CONTACT_LABELS[n].toLowerCase());
  return (
    <div className="card card--check" role="group" aria-labelledby="chk-ct">
      <p className="card__title">Predict first</p>
      <p className="card__q" id="chk-ct">
        With an offset of {choices.overlay > 0 ? '+' : ''}
        {choices.overlay} units, will every contact still reach its target without touching a gate?
      </p>
      <div className="options">
        {['Yes — it stays within the margin', 'No — at least one will touch a gate'].map((o, i) => (
          <button
            key={i}
            className={'option' + (answeredHere ? ((i === 0) === truthYes ? ' is-correct' : ans!.choice === i ? ' is-wrong' : '') : '')}
            aria-pressed={answeredHere ? ans!.choice === i || (i === 0) === truthYes : false}
            onClick={() => pick(i)}
          >
            {o}
          </button>
        ))}
      </div>
      {answeredHere && (
        <p className="feedback" aria-live="polite">
          <strong>{ans!.correct ? 'Correct. ' : 'Not quite. '}</strong>
          {truthYes
            ? choices.overlay === 0
              ? 'Perfectly aligned: every contact sits in the middle of its source or drain.'
              : 'A misaligned contact can still connect: the offset is smaller than the gap designers leave, so each contact stays on its source or drain. The preview shows the shifted holes.'
            : `The ${names.join(' and ')} contact${names.length > 1 ? 's' : ''} reach${names.length > 1 ? '' : 'es'} a gate. Metal touching the gate ties the input to another node, a short. The preview marks it in red.`}
        </p>
      )}
      {ans && !answeredHere && <p className="note">You answered for a different offset. Choose again for this one.</p>}
    </div>
  );
}

// ───────────────────────────── SEM-style top view ─────────────────────────────

/** Top-down, SEM-like rendering of one material's thickness (bright where tall, bright edges). */
export function SemView({ grid, mat, label }: { grid: Grid; mat: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const x0 = 8,
      x1 = 42,
      y0 = 10,
      y1 = 46; // NMOS area in gu
    const W = 340;
    const H = Math.round((W * (y1 - y0)) / (x1 - x0));
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(W, H);
    const rand = mulberry32(7);
    const thick = (xg: number, yg: number) => {
      const c = grid.col(Math.min(grid.nx - 1, Math.max(0, Math.floor(xg / grid.dx))), Math.min(grid.ny - 1, Math.max(0, Math.floor(yg / grid.dy))));
      let t = 0;
      for (let k = 0; k < grid.n[c]; k++) if (grid.mat[c * grid.K + k] === mat) t += grid.thickness(c, k);
      return t;
    };
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const xg = x0 + ((px + 0.5) / W) * (x1 - x0);
        const yg = y1 - ((py + 0.5) / H) * (y1 - y0);
        const t = thick(xg, yg);
        const tx = thick(xg + 0.5, yg) - thick(xg - 0.5, yg);
        const ty = thick(xg, yg + 1) - thick(xg, yg - 1);
        const edge = Math.min(1, Math.hypot(tx, ty) / 3);
        let v = 40 + Math.min(1, t / 5) * 70 + edge * 140;
        v += (rand() - 0.5) * 38;
        v = Math.max(0, Math.min(255, v));
        const i = (py * W + px) * 4;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // measurement cursors at the gate line
    const gx0 = ((22 - x0) / (x1 - x0)) * W;
    const gx1 = ((28 - x0) / (x1 - x0)) * W;
    const yMid = H * 0.5;
    ctx.strokeStyle = '#9dff9d';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(gx0, yMid - 26);
    ctx.lineTo(gx0, yMid + 26);
    ctx.moveTo(gx1, yMid - 26);
    ctx.lineTo(gx1, yMid + 26);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#9dff9d';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('design width', gx1 + 6, yMid - 16);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(label, 8, H - 8);
  }, [grid, mat, label]);
  return <canvas ref={ref} className="sem" role="img" aria-label={`Scanning electron microscope style top view: ${label}`} />;
}

// ───────────────────────────── gate after-develop inspection ─────────────────────────────

export function GateAdiPanel() {
  const choices = useApp((s) => s.choices);
  const rework = useApp((s) => s.rework);
  const next = useApp((s) => s.next);
  const dev = useStateAtStepEnd(STEP_INDEX.develop);
  const rg = engine.resistGates(choices);
  const residue = engine.resistResidue(choices);
  const cd = rg.worstRel;
  const cdOk = Math.abs(cd - 1) <= 0.1;
  const resOk = residue < 0.3;
  const inSpec = cdOk && resOk;
  const cdPct = (r: number) => `${Math.round(r * 100)}%`;
  const reason = !resOk
    ? 'Resist was left in the openings (scum). The etch would be blocked there.'
    : cd > 1.1
      ? 'Gate lines printed too wide.'
      : 'Gate lines printed too narrow.';
  return (
    <div className={'card ' + (inSpec ? 'card--ok' : 'card--bad')}>
      <p className="card__title">After-develop inspection</p>
      <div className="readouts" style={{ marginTop: 0 }}>
        <div className={'readout ' + (Math.abs(rg.nmos.rel - 1) <= 0.1 ? 'readout--ok' : 'readout--bad')}>
          <div className="readout__k">NMOS gate CD</div>
          <div className="readout__v">{cdPct(rg.nmos.rel)} of target</div>
        </div>
        <div className={'readout ' + (Math.abs(rg.pmos.rel - 1) <= 0.1 ? 'readout--ok' : 'readout--bad')}>
          <div className="readout__k">PMOS gate CD</div>
          <div className="readout__v">{cdPct(rg.pmos.rel)} of target</div>
        </div>
        <div className={'readout ' + (resOk ? 'readout--ok' : 'readout--bad')}>
          <div className="readout__k">Residue</div>
          <div className="readout__v">{residue < 0.05 ? 'None' : residue < 1 ? 'Thin film' : 'Thick'}</div>
        </div>
      </div>
      <SemView grid={dev.grid} mat={M.RES} label="Resist after develop · NMOS gate" />
      <p className="note">Spec: CD within ±10% of target, no residue in openings. Percentages come from the simulated resist profile.</p>
      {inSpec ? (
        <p className="result-line" style={{ color: 'var(--ok)', marginTop: 10 }}>
          <span className="result-dot" style={{ background: 'var(--ok)' }} /> In spec — released to etch
        </p>
      ) : (
        <>
          <p className="result-line" style={{ color: 'var(--bad)', marginTop: 10 }}>
            <span className="result-dot" style={{ background: 'var(--bad)' }} /> Out of spec
          </p>
          <p className="feedback" style={{ marginTop: 0 }}>
            {reason} Nothing is permanent yet: rework strips this resist so you can recoat and expose again.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn btn--small btn--accent" onClick={() => rework('gate')}>
              Rework: strip and redo
            </button>
            <button className="btn btn--small" onClick={next}>
              Etch anyway
            </button>
          </div>
        </>
      )}
      {choices.gateReworks > 0 && <p className="note">Reworked {choices.gateReworks}× on this wafer.</p>}
    </div>
  );
}

// ───────────────────────────── contact after-develop inspection ─────────────────────────────

export function ContactAdiPanel() {
  const choices = useApp((s) => s.choices);
  const rework = useApp((s) => s.rework);
  const ov = engine.contactOverlay(choices);
  const frac = ov.ofMargin;
  return (
    <div className={'card ' + (ov.inSpec ? 'card--ok' : frac < 1 ? 'card--warn' : 'card--bad')}>
      <p className="card__title">Overlay metrology</p>
      <div className="readouts" style={{ marginTop: 0 }}>
        <div className={'readout ' + (ov.inSpec ? 'readout--ok' : frac < 1 ? 'readout--warn' : 'readout--bad')}>
          <div className="readout__k">Measured shift</div>
          <div className="readout__v">
            {ov.dx >= 0 ? '+' : ''}
            {ov.dx.toFixed(1)} units
          </div>
        </div>
        <div className="readout">
          <div className="readout__k">Of margin</div>
          <div className="readout__v">{Math.round(frac * 100)}%</div>
        </div>
        <div className="readout">
          <div className="readout__k">Spec</div>
          <div className="readout__v">±{Math.round(OVERLAY_SPEC * CONTACT_MARGIN * 10) / 10} units</div>
        </div>
      </div>
      <p className="note">Measured from the developed contact openings against their design positions.</p>
      {ov.inSpec ? (
        <p className="result-line" style={{ color: 'var(--ok)', marginTop: 10 }}>
          <span className="result-dot" style={{ background: 'var(--ok)' }} /> In spec — released to etch
        </p>
      ) : (
        <>
          <p className="feedback">
            {frac < 1
              ? 'Out of spec but still inside the physical margin. A fab would usually rework to keep a safety buffer.'
              : 'Beyond the margin: some contacts will land on a gate. Rework now, before the etch makes it permanent.'}
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn btn--small btn--accent" onClick={() => rework('contact')}>
              Rework: strip and re-align
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ───────────────────────────── wafer map (mini) ─────────────────────────────

export function MiniWaferMap({ map, highlight = true, size = 260 }: { map?: WaferMapResult; highlight?: boolean; size?: number }) {
  const R = WAFER.radius;
  const scale = size / (2 * R + 8);
  const col = (id: number) => {
    const r = map?.dies[id];
    if (!r) return '#e6e6e2';
    if (r.verdict === 'edge') return '#efefec';
    return r.verdict === 'pass' ? '#3fb07f' : '#d5553f';
  };
  return (
    <svg className="wmap" viewBox={`0 0 ${size} ${size}`} style={{ maxWidth: size }} role="img" aria-label={map ? `Wafer map: ${map.passed} of ${map.tested} dies pass` : 'Wafer map, testing in progress'}>
      <g transform={`translate(${size / 2} ${size / 2}) scale(${scale} ${-scale})`}>
        <circle r={R} fill="#f6f6f4" stroke="#c9c9c4" strokeWidth={1.4 / scale} />
        {DIES.map((d) => (
          <rect key={d.id} x={d.x - WAFER.dieW / 2 + 0.6} y={d.y - WAFER.dieH / 2 + 0.6} width={WAFER.dieW - 1.2} height={WAFER.dieH - 1.2} fill={col(d.id)} rx={0.8} />
        ))}
        {highlight && (
          <rect
            x={DIES[YOUR_DIE].x - WAFER.dieW / 2}
            y={DIES[YOUR_DIE].y - WAFER.dieH / 2}
            width={WAFER.dieW}
            height={WAFER.dieH}
            fill="none"
            stroke="#6a5af9"
            strokeWidth={3 / scale}
          />
        )}
        <path d={`M -4 ${-R} L 0 ${-R + 5} L 4 ${-R}`} fill="#fbfbfa" stroke="#c9c9c4" strokeWidth={1 / scale} />
      </g>
    </svg>
  );
}

const CAUSE_LABEL: Record<string, string> = {
  particle: 'particle',
  residue: 'resist residue → poly shorts',
  'short-gate': 'gates too short (leakage)',
  overlay: 'contact touching gate',
  other: 'other',
  open: 'not wired',
};

export function ProbePanel() {
  const choices = useApp((s) => s.choices);
  const map = useWaferMap(choices);
  const dg = engine.diagnosis(choices);
  return (
    <div className={'card ' + (dg.pass ? 'card--ok' : 'card--bad')}>
      <p className="card__title">Wafer sort results</p>
      <MiniWaferMap map={map} />
      {map ? (
        <div className="stat-row">
          <span className="chip chip--ok">{map.passed} pass</span>
          <span className="chip chip--bad">{map.tested - map.passed} fail</span>
          <span className="chip">{DIES.length - FULL_DIE_COUNT} partial edge dies not tested</span>
          <span className="chip chip--accent">Yield {map.yieldPct.toFixed(1)}% (toy model)</span>
        </div>
      ) : (
        <p className="note">Probing… running the process for every group of dies.</p>
      )}
      {map && Object.keys(map.byCause).length > 0 && (
        <p className="note">
          Failures:{' '}
          {Object.entries(map.byCause)
            .map(([k, v]) => `${v} ${CAUSE_LABEL[k] ?? k}`)
            .join(' · ')}
        </p>
      )}
      <YourDieResult />
    </div>
  );
}

export function YourDieResult({ compact = false }: { compact?: boolean }) {
  const choices = useApp((s) => s.choices);
  const dg = engine.diagnosis(choices);
  return (
    <div style={{ marginTop: 12 }}>
      <p className="result-line" style={{ color: dg.pass ? 'var(--ok)' : 'var(--bad)' }}>
        <span className="result-dot" style={{ background: dg.pass ? 'var(--ok)' : 'var(--bad)' }} />
        Your die: {dg.pass ? 'pass' : 'fail'}
      </p>
      <p className="feedback" style={{ marginTop: 0 }}>
        <strong>{dg.headline}</strong> {!compact && dg.detail}
      </p>
      {dg.notes.map((n, i) => (
        <p className="note" key={i}>
          {n}
        </p>
      ))}
      <RestoreActions />
    </div>
  );
}

/** Offer a way back from any non-default choice. */
export function RestoreActions() {
  const choices = useApp((s) => s.choices);
  const setChoice = useApp((s) => s.setChoice);
  const goTo = useApp((s) => s.goTo);
  const step = useApp((s) => s.step);
  const off = (Object.keys(CHOICE_STEP) as (keyof typeof CHOICE_STEP)[]).filter((k) => choices[k] !== DEFAULT_CHOICES[k]);
  if (off.length === 0) return null;
  const labels: Record<string, string> = {
    clean: 'Run the clean',
    spin: 'Restore spin speed',
    dose: 'Restore nominal dose',
    overlay: 'Re-align contacts',
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
      {off.map((k) => (
        <button key={k} className="btn btn--small" onClick={() => setChoice(k, DEFAULT_CHOICES[k] as never)}>
          {labels[k]}
        </button>
      ))}
      {off.length > 1 && (
        <button
          className="btn btn--small btn--accent"
          onClick={() => off.forEach((k) => setChoice(k, DEFAULT_CHOICES[k] as never))}
        >
          Restore all
        </button>
      )}
      {off.map((k) =>
        CHOICE_STEP[k] !== step ? (
          <button
            key={'go' + k}
            className="link-btn"
            onClick={() => {
              useApp.setState({ returnTo: step });
              goTo(CHOICE_STEP[k], { keepReturn: true });
            }}
          >
            Go to the {k === 'clean' ? 'clean' : k === 'spin' ? 'coat' : k === 'dose' ? 'exposure' : 'contact alignment'} step
          </button>
        ) : null,
      )}
    </div>
  );
}

// ───────────────────────────── final inspection ─────────────────────────────

export function InspectPanel() {
  const choices = useApp((s) => s.choices);
  const ov = engine.contactOverlay(choices);
  const pg = engine.polyGates(choices);
  const killers = useMemo(() => INCOMING_PARTICLES.map(particleKills), []);
  const nKill = killers.filter((k) => k.kills).length;
  return (
    <div className="card">
      <p className="card__title">Inspection summary</p>
      <div className="readouts" style={{ marginTop: 0 }}>
        <div className={'readout ' + (choices.clean ? 'readout--ok' : 'readout--bad')}>
          <div className="readout__k">Particles</div>
          <div className="readout__v">{choices.clean ? 'None found' : `${INCOMING_PARTICLES.length} buried`}</div>
        </div>
        <div className={'readout ' + (Math.abs(pg.worstRel - 1) <= 0.1 ? 'readout--ok' : 'readout--bad')}>
          <div className="readout__k">Gate CD</div>
          <div className="readout__v">{Math.round(pg.worstRel * 100)}%</div>
        </div>
        <div className={'readout ' + (ov.inSpec ? 'readout--ok' : ov.ofMargin < 1 ? 'readout--warn' : 'readout--bad')}>
          <div className="readout__k">Contact overlay</div>
          <div className="readout__v">{Math.round(ov.ofMargin * 100)}% of margin</div>
        </div>
      </div>
      <DefectExample show={!choices.clean} killers={nKill} />
    </div>
  );
}

function DefectExample({ show, killers }: { show: boolean; killers: number }) {
  return (
    <div style={{ marginTop: 12 }}>
      <p className="card__title">Defect example</p>
      <svg viewBox="0 0 300 120" className="aerial" role="img" aria-label="Illustration of a particle buried under the films, bridging two wires">
        <rect width="300" height="120" fill="#fbfbfa" />
        <rect x="0" y="92" width="300" height="28" fill="#4b4e56" />
        <rect x="0" y="40" width="300" height="52" fill="#e2e6ea" />
        <rect x="40" y="56" width="70" height="22" fill="#c47f4c" />
        <rect x="170" y="56" width="70" height="22" fill="#c47f4c" />
        <ellipse cx="140" cy="68" rx="30" ry="24" fill="#2b2b2e" />
        <path d="M0 40 C 90 40 100 22 140 22 C 180 22 190 40 300 40" fill="none" stroke="#a9b8c8" strokeWidth="3" />
        <text x="140" y="14" fontSize="11" textAnchor="middle" fill="#1a1c20">
          particle (drawn enlarged) bridges two wires
        </text>
      </svg>
      <p className="note">
        {show
          ? `Your wafer skipped the clean: ${killers} of the ${INCOMING_PARTICLES.length} particles landed inside a die’s circuitry and are expected to kill it. Particles in scribe streets or pad rings do no harm in this toy model.`
          : 'Your wafer was cleaned, so this is a reference example. A particle buried under later films can bridge or break wires, killing the die it sits on.'}
      </p>
    </div>
  );
}

export function ReturnLink() {
  const returnTo = useApp((s) => s.returnTo);
  const step = useApp((s) => s.step);
  const goTo = useApp((s) => s.goTo);
  if (returnTo === null || returnTo <= step) return null;
  return (
    <button className="btn btn--small btn--accent" style={{ marginBottom: 14 }} onClick={() => goTo(returnTo)}>
      Return to where you were →
    </button>
  );
}

export function currentChoicesSummary(c: Choices): string[] {
  const out: string[] = [];
  out.push(c.clean ? 'Pre-process clean: run' : 'Pre-process clean: skipped');
  out.push(`Spin speed: ${c.spin === 0.5 ? 'recipe' : c.spin < 0.5 ? 'slower' : 'faster'}`);
  return out;
}
