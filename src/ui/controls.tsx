import { useEffect, useMemo, useRef } from 'react';
import { DIES, FIELDS, FULL_DIE_COUNT, INCOMING_PARTICLES, YOUR_DIE } from '../sim/dies';
import { doseRel, spinModel, STEP_INDEX } from '../sim/flow';
import { CONTACT_MARGIN, CUT_Y } from '../sim/layout';
import { OVERLAY_SPEC, predictContacts } from '../sim/metrology';
import { aerialImage, profileAt } from '../sim/optics';
import { clearedDepthExact, doseToSize, RESIST_RECIPES } from '../sim/ops';
import { DEFAULT_CHOICES, DOSE_LEVELS, OVERLAY_RANGE } from '../sim/types';
import { engine } from '../state/sim';
import { useApp } from '../state/store';

function pct(v: number, lo: number, hi: number) {
  return `${((v - lo) / (hi - lo)) * 100}%`;
}

// ───────────────────────────── clean ─────────────────────────────

export function CleanControl() {
  const clean = useApp((s) => s.choices.clean);
  const setChoice = useApp((s) => s.setChoice);
  return (
    <div className="control">
      <div className="control__head">
        <span className="control__label" id="clean-label">
          Pre-process clean
        </span>
        <span className="control__value">{clean ? 'Particles removed' : `${INCOMING_PARTICLES.length} particles left`}</span>
      </div>
      <div className="segmented" role="radiogroup" aria-labelledby="clean-label">
        <button role="radio" aria-checked={clean} onClick={() => setChoice('clean', true)}>
          Run the clean (recommended)
        </button>
        <button role="radio" aria-checked={!clean} onClick={() => setChoice('clean', false)}>
          Skip it
        </button>
      </div>
      <p className="control__hint">
        {clean
          ? 'The wafer leaves this step with a clean surface.'
          : 'The particles stay on the wafer. Each one that lands inside a die’s circuitry can cost that die at test.'}
      </p>
    </div>
  );
}

// ───────────────────────────── spin ─────────────────────────────

export function SpinControl() {
  const spin = useApp((s) => s.choices.spin);
  const setChoice = useApp((s) => s.setChoice);
  const m = spinModel(spin);
  const tState = m.tRel > 1.12 ? 'Thicker than target' : m.tRel < 0.88 ? 'Thinner than target' : 'On target';
  const uState = m.edgeRise > 0.1 ? 'Uneven: thick rim' : m.edgeRise > 0.05 ? 'Slightly uneven' : 'Even';
  const cls = (bad: boolean, warn: boolean) => 'readout ' + (bad ? 'readout--bad' : warn ? 'readout--warn' : 'readout--ok');
  return (
    <div className="control">
      <div className="control__head">
        <label className="control__label" htmlFor="spin">
          Spin speed
        </label>
        <span className="control__value">{m.speedRel.toFixed(2)}× recipe speed</span>
      </div>
      <input
        id="spin"
        className="range"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={spin}
        style={{ ['--pct' as string]: pct(spin, 0, 1) }}
        onChange={(e) => setChoice('spin', Number(e.target.value))}
        aria-valuetext={`${m.speedRel.toFixed(2)} times the recipe speed; film ${tState.toLowerCase()}; ${uState.toLowerCase()}`}
      />
      <div className="control__scale">
        <span>Slower · thicker</span>
        <span>Faster · thinner</span>
      </div>
      <div className="readouts">
        <div className={cls(m.tRel > 1.3 || m.tRel < 0.66, m.tRel > 1.12 || m.tRel < 0.88)}>
          <div className="readout__k">Film</div>
          <div className="readout__v">{m.tRel.toFixed(2)}× target</div>
        </div>
        <div className={cls(m.edgeRise > 0.15, m.edgeRise > 0.05)}>
          <div className="readout__k">Uniformity</div>
          <div className="readout__v">{uState}</div>
        </div>
      </div>
      <p className="control__hint">
        Simple model: thickness ∝ 1/√speed (an empirical rule), and slow spins thicken toward the rim. Not a calibrated coater recipe.
        {Math.abs(spin - DEFAULT_CHOICES.spin) > 0.01 && (
          <>
            {' '}
            <button className="link-btn" onClick={() => setChoice('spin', DEFAULT_CHOICES.spin)}>
              Restore recipe speed
            </button>
          </>
        )}
      </p>
    </div>
  );
}

// ───────────────────────────── dose ─────────────────────────────

/**
 * Absorbed dose at the resist surface across the NMOS gate, with the level needed to clear
 * the film the learner actually coated (a thicker film needs more light to clear).
 */
function AerialChart({ level, tRel }: { level: number; tRel: number }) {
  const data = useMemo(() => {
    const img = aerialImage('poly');
    const prof = profileAt(img, CUT_Y);
    const tNom = RESIST_RECIPES.fine.t;
    const t = tNom * tRel * 0.96; // after the soft-bake shrink
    const d2s = doseToSize(tNom);
    const dose = d2s * doseRel(level);
    // the surface dose at which this film just clears to the bottom
    let lo = 0.2;
    let hi = 20;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (clearedDepthExact(mid, t, tNom) >= t - 1e-3) hi = mid;
      else lo = mid;
    }
    const clearAt = hi;
    // x from 10 to 40 gu (NMOS source, gate, drain)
    const pts = prof.map((v, i) => ({ x: (i + 0.5) * 0.5, e: v * dose })).filter((p) => p.x >= 10 && p.x <= 40);
    return { pts, clearAt, max: d2s * 2.7 };
  }, [level, tRel]);
  const W = 300;
  const H = 96;
  const sx = (x: number) => ((x - 10) / 30) * W;
  const sy = (e: number) => H - 8 - (e / data.max) * (H - 18);
  const path = data.pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.e).toFixed(1)}`).join(' ');
  const area = `${path} L${sx(40)} ${H - 8} L${sx(10)} ${H - 8} Z`;
  const clipId = 'clr';
  return (
    <svg className="aerial" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Light reaching the resist across one gate, compared with the level needed to clear the resist">
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={W} height={sy(data.clearAt)} />
        </clipPath>
      </defs>
      <rect x={sx(22)} y={0} width={sx(28) - sx(22)} height={H - 8} fill="#ececea" />
      <text x={sx(25)} y={11} fontSize={9} textAnchor="middle" fill="#737883">
        chrome
      </text>
      <path d={area} fill="rgba(106,90,249,0.12)" />
      <path d={area} fill="rgba(106,90,249,0.45)" clipPath={`url(#${clipId})`} />
      <path d={path} fill="none" stroke="#6a5af9" strokeWidth={2} />
      <line x1={0} x2={W} y1={sy(data.clearAt)} y2={sy(data.clearAt)} stroke="#0e0f12" strokeDasharray="4 3" strokeWidth={1} />
      <text x={W - 4} y={sy(data.clearAt) - 4} fontSize={9} textAnchor="end" fill="#0e0f12">
        fully clears above this line
      </text>
      <line x1={0} x2={W} y1={H - 8} y2={H - 8} stroke="#d2d2cc" />
      <text x={2} y={H - 1} fontSize={8.5} fill="#737883">
        source
      </text>
      <text x={sx(25)} y={H - 1} fontSize={8.5} textAnchor="middle" fill="#737883">
        gate line
      </text>
      <text x={W - 2} y={H - 1} fontSize={8.5} textAnchor="end" fill="#737883">
        drain
      </text>
    </svg>
  );
}

export function DoseControl() {
  const dose = useApp((s) => s.choices.dose);
  const tRel = spinModel(useApp((s) => s.choices.spin)).tRel;
  const setChoice = useApp((s) => s.setChoice);
  const lightPath = useApp((s) => s.lightPath);
  const toggle = useApp((s) => s.toggle);
  const setPanel = useApp((s) => s.setPanel);
  const lvl = DOSE_LEVELS[dose];
  const status = dose === 2 ? 'readout--ok' : dose === 0 || dose === 4 ? 'readout--bad' : 'readout--warn';
  const predict =
    dose === 0
      ? 'Too little light: resist will not clear in the openings.'
      : dose === 1
        ? 'Lines print a little wide.'
        : dose === 2
          ? 'Edges land where the reticle draws them.'
          : dose === 3
            ? 'Lines print a little narrow.'
            : 'Lines print much too narrow.';
  return (
    <div className="control">
      <div className="control__head">
        <label className="control__label" htmlFor="dose">
          Exposure dose
        </label>
        <span className="control__value">
          {lvl.label} · {lvl.rel.toFixed(2)}× dose-to-size
        </span>
      </div>
      <input
        id="dose"
        className="range"
        type="range"
        min={0}
        max={4}
        step={1}
        value={dose}
        list="dose-ticks"
        style={{ ['--pct' as string]: pct(dose, 0, 4) }}
        onChange={(e) => setChoice('dose', Number(e.target.value))}
        aria-valuetext={`${lvl.label}: ${predict}`}
      />
      <datalist id="dose-ticks">
        {DOSE_LEVELS.map((d, i) => (
          <option key={i} value={i} label={d.label} />
        ))}
      </datalist>
      <div className="control__scale">
        <span>Under</span>
        <span>Nominal</span>
        <span>Over</span>
      </div>
      <div className="readouts">
        <div className={'readout ' + status}>
          <div className="readout__k">Prediction</div>
          <div className="readout__v" style={{ fontSize: 13.5 }}>
            {predict}
          </div>
        </div>
      </div>
      <AerialChart level={dose} tRel={tRel} />
      {Math.abs(tRel - 1) > 0.1 && (
        <p className="control__hint">
          {tRel > 1
            ? 'Your resist came out thicker than target, so the clearing line sits higher: it needs more light to clear.'
            : 'Your resist came out thinner than target, so it clears with less light, and lines print a little narrow.'}
        </p>
      )}
      <div className="xsec-caption">
        <span>Light reaching the resist across one gate (schematic)</span>
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <label className="toggle">
          <input type="checkbox" checked={lightPath} onChange={() => toggle('lightPath')} />
          Show light path
        </label>
        <button className="link-btn" onClick={() => setPanel('euv')}>
          DUV vs EUV
        </button>
        {dose !== DEFAULT_CHOICES.dose && (
          <button className="link-btn" onClick={() => setChoice('dose', DEFAULT_CHOICES.dose)}>
            Restore nominal dose
          </button>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── overlay ─────────────────────────────

export function OverlayControl() {
  const overlay = useApp((s) => s.choices.overlay);
  const setChoice = useApp((s) => s.setChoice);
  const frac = Math.abs(overlay) / CONTACT_MARGIN;
  const touching = predictContacts(overlay).filter((c) => c.touchesGate);
  const status = frac <= OVERLAY_SPEC ? 'readout--ok' : frac < 1 ? 'readout--warn' : 'readout--bad';
  const spec = frac <= OVERLAY_SPEC ? 'Within spec' : frac < 1 ? 'Out of spec, inside margin' : 'Beyond the margin';
  return (
    <div className="control">
      <div className="control__head">
        <label className="control__label" htmlFor="overlay">
          Contact overlay offset
        </label>
        <span className="control__value">
          {overlay > 0 ? '+' : ''}
          {overlay} units · {Math.round(frac * 100)}% of margin
        </span>
      </div>
      <input
        id="overlay"
        className="range"
        type="range"
        min={-OVERLAY_RANGE}
        max={OVERLAY_RANGE}
        step={1}
        value={overlay}
        style={{ ['--pct' as string]: pct(overlay, -OVERLAY_RANGE, OVERLAY_RANGE) }}
        onChange={(e) => setChoice('overlay', Number(e.target.value))}
        aria-valuetext={`${overlay} units, ${Math.round(frac * 100)} percent of the contact margin`}
      />
      <div className="control__scale">
        <span>← shift left</span>
        <span>aligned</span>
        <span>shift right →</span>
      </div>
      <div className="readouts">
        <div className={'readout ' + status}>
          <div className="readout__k">Overlay</div>
          <div className="readout__v">{spec}</div>
        </div>
        <div className={'readout ' + (touching.length ? 'readout--bad' : 'readout--ok')}>
          <div className="readout__k">Preview</div>
          <div className="readout__v">{touching.length ? `${touching.length} touch a gate` : 'All clear'}</div>
        </div>
      </div>
      <p className="control__hint">
        One unit is a schematic step; the margin is the designed gap of {CONTACT_MARGIN} units between each contact and its gate. The
        overlay spec (±{Math.round(OVERLAY_SPEC * 100)}% of the margin) is tighter than the margin on purpose.
        {overlay !== 0 && (
          <>
            {' '}
            <button className="link-btn" onClick={() => setChoice('overlay', 0)}>
              Re-align to zero
            </button>
          </>
        )}
      </p>
    </div>
  );
}

// ───────────────────────────── die explorer ─────────────────────────────

export function DieInfo() {
  const your = DIES[YOUR_DIE];
  return (
    <div className="card">
      <p className="card__title">This wafer</p>
      <div className="readouts" style={{ marginTop: 4 }}>
        <div className="readout">
          <div className="readout__k">Die sites</div>
          <div className="readout__v">{DIES.length}</div>
        </div>
        <div className="readout">
          <div className="readout__k">Complete dies</div>
          <div className="readout__v">{FULL_DIE_COUNT}</div>
        </div>
        <div className="readout">
          <div className="readout__k">Exposure fields</div>
          <div className="readout__v">{FIELDS.length}</div>
        </div>
      </div>
      <p className="note">
        Your die sits just up and right of the centre (column {your.col}, row {your.row}). Drag to turn the wafer; each die is 13 mm × 16.5 mm
        in this illustration.
      </p>
    </div>
  );
}

// ───────────────────────────── final input ─────────────────────────────

export function InputControl() {
  const v = useApp((s) => s.finalInput);
  const set = useApp((s) => s.setFinalInput);
  const choices = useApp((s) => s.choices);
  const e = engine.electrical(choices);
  const out = v === 0 ? e.out.in0 : e.out.in1;
  const outText = out === 1 ? '1 (high)' : out === 0 ? '0 (low)' : out === 'X' ? 'shorted' : 'floating';
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement) return;
      if (ev.key === '0') set(0);
      if (ev.key === '1') set(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [set]);
  return (
    <div className="control" ref={ref}>
      <div className="control__head">
        <span className="control__label" id="in-label">
          Input
        </span>
        <span className={'led' + (out === 1 ? ' is-on' : '')} aria-live="polite">
          <i aria-hidden />
          Output {outText}
        </span>
      </div>
      <div className="bigtoggle" role="radiogroup" aria-labelledby="in-label">
        <button role="radio" aria-checked={v === 0} aria-pressed={v === 0} onClick={() => set(0)}>
          <span>
            <b>0</b>low
          </span>
        </button>
        <button role="radio" aria-checked={v === 1} aria-pressed={v === 1} onClick={() => set(1)}>
          <span>
            <b>1</b>high
          </span>
        </button>
      </div>
      <table className="truth">
        <thead>
          <tr>
            <th>Input</th>
            <th>Output</th>
            <th>Conducting</th>
          </tr>
        </thead>
        <tbody>
          <tr className={v === 0 ? 'is-active' : ''}>
            <td>0</td>
            <td>{fmt(e.out.in0)}</td>
            <td>PMOS pulls up to VDD</td>
          </tr>
          <tr className={v === 1 ? 'is-active' : ''}>
            <td>1</td>
            <td>{fmt(e.out.in1)}</td>
            <td>NMOS pulls down to GND</td>
          </tr>
        </tbody>
      </table>
      <p className="control__hint">Press 0 or 1 on your keyboard to switch the input.</p>
    </div>
  );
}

function fmt(l: 0 | 1 | 'X' | 'Z') {
  return l === 'X' ? 'shorted' : l === 'Z' ? 'floating' : String(l);
}

export const CHOICE_STEP = {
  clean: STEP_INDEX.clean,
  spin: STEP_INDEX.coat,
  dose: STEP_INDEX.expose,
  overlay: STEP_INDEX['contact-align'],
};
