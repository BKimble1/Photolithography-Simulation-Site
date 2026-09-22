import { useEffect, useMemo, useRef, useState } from 'react';
import { SOURCES } from '../content/sources';
import { STEPS } from '../content/steps';
import { CHAPTERS, chapterSteps, FLOW, spinModel, STEP_INDEX } from '../sim/flow';
import { CUT_Y, MASKS, MASK_ORDER } from '../sim/layout';
import { DEFAULT_CHOICES, DOSE_LEVELS } from '../sim/types';
import { engine, useStateAtStepEnd, useStateAtStepStart, useStep, useWaferMap } from '../state/sim';
import { useApp } from '../state/store';
import { autoRange, CrossSection } from './CrossSection';
import { LEGEND_HIGHLIGHT, LEGEND_PHYSICAL } from './palette';
import { MiniWaferMap } from './panels';
import { RichText } from './RichText';

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Focus the dialog when it opens, keep Tab inside it, and return focus when it closes. */
function useFocusOnOpen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!el.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return ref;
}

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

// ───────────────────────────── Stages ─────────────────────────────

export function Stages() {
  const step = useApp((s) => s.step);
  const maxStep = useApp((s) => s.maxStep);
  const goTo = useApp((s) => s.goTo);
  const setPanel = useApp((s) => s.setPanel);
  const close = () => setPanel(null);
  useEscape(close);
  const ref = useFocusOnOpen<HTMLDivElement>();
  return (
    <div className="stages" role="dialog" aria-modal="true" aria-labelledby="stages-title" tabIndex={-1} ref={ref}>
      <div className="stages__inner">
        <div className="stages__head">
          <div>
            <h2 className="stages__title" id="stages-title">
              Stages
            </h2>
            <p className="stages__sub">
              Jump to any step. The wafer is rebuilt from your choices, so every stage shows the state it would have at that point. Lithography — patterning — is
              one repeated loop inside the flow, not the whole of chipmaking.
            </p>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close stages">
            <CloseIcon />
          </button>
        </div>
        <div className="stages__grid">
          {CHAPTERS.map((c) => (
            <section className="stages__col" key={c.id} aria-labelledby={'ch-' + c.id}>
              <h3 id={'ch-' + c.id}>
                <span>{String(c.index).padStart(2, '0')}</span>
                {c.name}
              </h3>
              <ol className="stages__list">
                {chapterSteps(c.id).map((i) => {
                  const st = STEPS[FLOW[i].id];
                  const tag = st.control && st.control !== 'dies' && st.control !== 'input' ? 'experiment' : st.check ? 'check' : null;
                  return (
                    <li key={i}>
                      <button
                        className={'stages__item' + (i === step ? ' is-current' : '') + (i <= maxStep ? ' is-visited' : '')}
                        onClick={() => goTo(i)}
                        aria-current={i === step ? 'step' : undefined}
                      >
                        <span className="mark" aria-hidden />
                        <span>
                          {st.title}
                          {tag && <span className="tag">{tag}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── Look closer ─────────────────────────────

export function LookCloser() {
  const { index, content } = useStep();
  const setPanel = useApp((s) => s.setPanel);
  const close = () => setPanel(null);
  useEscape(close);
  const ref = useFocusOnOpen<HTMLDivElement>();
  const state = useStateAtStepEnd(index);
  const [y, setY] = useState(CUT_Y);
  const sources = [content.closer.source, ...(content.closer.extra ?? [])].map((k) => SOURCES[k]);
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="closer-title" tabIndex={-1} ref={ref}>
        <div className="drawer__head">
          <h2 id="closer-title">Look closer · {content.title}</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="drawer__body">
          <CrossSection grid={state.grid} y={y} title={`Cross-section after “${content.title}”`} />
          <div className="xsec-caption">
            <span>Schematic cross-section, greatly magnified, vertical ×{1.3}. Colour tints for doping are illustrative.</span>
          </div>
          <div className="control" style={{ marginTop: 12 }}>
            <div className="control__head">
              <label className="control__label" htmlFor="ypos" style={{ fontSize: 14 }}>
                Section position
              </label>
              <span className="control__value">{y === CUT_Y ? 'through the contacts' : y > 44 ? 'through the gate strap' : `y = ${y}`}</span>
            </div>
            <input
              id="ypos"
              className="range"
              type="range"
              min={2}
              max={62}
              step={1}
              value={y}
              style={{ ['--pct' as string]: `${((y - 2) / 60) * 100}%` }}
              onChange={(e) => setY(Number(e.target.value))}
            />
          </div>
          {content.closer.body.map((p, i) => (
            <p key={i}>
              <RichText text={p} />
            </p>
          ))}
          <div className="drawer__section">
            <h3>In three parts</h3>
            <p>
              <strong>Doing:</strong> <RichText text={content.doing} fresh={false} />
            </p>
            <p>
              <strong>Changes:</strong> <RichText text={content.changes} fresh={false} />
            </p>
            <p>
              <strong>Why:</strong> <RichText text={content.why} fresh={false} />
            </p>
          </div>
          <div className="drawer__section">
            <h3>Source{sources.length > 1 ? 's' : ''}</h3>
            {sources.map((s) => (
              <a key={s.url} className="source" href={s.url} target="_blank" rel="noreferrer">
                {s.title}
                <small>{s.publisher}</small>
              </a>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ───────────────────────────── What changed? ─────────────────────────────

export function Compare() {
  const { index, content } = useStep();
  const setPanel = useApp((s) => s.setPanel);
  const close = () => setPanel(null);
  useEscape(close);
  const ref = useFocusOnOpen<HTMLDivElement>();
  const before = useStateAtStepStart(index);
  const after = useStateAtStepEnd(index);
  const range = useMemo(() => autoRange([before.grid, after.grid]), [before, after]);
  const [split, setSplit] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const drag = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setSplit(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cmp-title" tabIndex={-1} ref={ref}>
        <div className="modal__head">
          <h2 id="cmp-title">What changed? · {content.title}</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="modal__body">
          <div className="compare__labels">
            <span>Before</span>
            <span>After</span>
          </div>
          <div
            className="compare"
            ref={box}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              drag(e.clientX);
            }}
            onPointerMove={(e) => e.buttons && drag(e.clientX)}
            style={{ cursor: 'ew-resize', touchAction: 'none' }}
          >
            <div className="compare__layer">
              <CrossSection grid={before.grid} zRange={range} title="Before this step" />
            </div>
            <div className="compare__after" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
              <CrossSection grid={after.grid} zRange={range} title="After this step" />
            </div>
            <div className="compare__handle" style={{ left: `${split}%` }} />
          </div>
          <input
            className="range"
            type="range"
            min={0}
            max={100}
            value={split}
            onChange={(e) => setSplit(Number(e.target.value))}
            aria-label="Move the divider between before and after"
            style={{ ['--pct' as string]: `${split}%`, marginTop: 8 }}
          />
          <p className="note">
            <RichText text={content.changes} fresh={false} /> Drag across the section to compare. Schematic, greatly magnified.
          </p>
        </div>
      </div>
    </>
  );
}

// ───────────────────────────── Legend ─────────────────────────────

export function Legend() {
  const setPanel = useApp((s) => s.setPanel);
  const close = () => setPanel(null);
  useEscape(close);
  const ref = useFocusOnOpen<HTMLDivElement>();
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="modal" style={{ width: 'min(640px, calc(100vw - 32px))' }} role="dialog" aria-modal="true" aria-labelledby="lg-title" tabIndex={-1} ref={ref}>
        <div className="modal__head">
          <h2 id="lg-title">Legend</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="modal__body">
          <p className="card__title">Physical structure</p>
          <ul className="legend-grid">
            {LEGEND_PHYSICAL.map((l) => (
              <li key={l.label}>
                <span className="sw" style={{ background: l.color }} />
                {l.label}
              </li>
            ))}
          </ul>
          <p className="card__title" style={{ marginTop: 18 }}>
            Illustrative highlights (not visible in reality)
          </p>
          <ul className="legend-grid">
            {LEGEND_HIGHLIGHT.map((l) => (
              <li key={l.label}>
                <span className="sw" style={{ background: l.color }} />
                {l.label}
              </li>
            ))}
            <li>
              <span className="sw sw--hatch" />
              Light path (193 nm UV is invisible)
            </li>
            <li>
              <span className="sw" style={{ background: '#48e0a0' }} />
              Connected to the output (final test)
            </li>
          </ul>
          <p className="note" style={{ marginTop: 16 }}>
            Device views are schematic and greatly magnified: film thicknesses and widths keep their order and relationships but are not to scale. Wafer and tool views
            are illustrative equipment, not any manufacturer’s design. Particles on wafer maps are drawn enormously enlarged.
          </p>
        </div>
      </div>
    </>
  );
}

// ───────────────────────────── DUV vs EUV ─────────────────────────────

export function EuvExplainer() {
  const setPanel = useApp((s) => s.setPanel);
  const close = () => setPanel(null);
  useEscape(close);
  const ref = useFocusOnOpen<HTMLDivElement>();
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="euv-title" tabIndex={-1} ref={ref}>
        <div className="modal__head">
          <h2 id="euv-title">DUV vs EUV</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="modal__body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
            <div>
              <p className="card__title">This journey · deep UV (193 nm)</p>
              <svg viewBox="0 0 260 200" className="aerial" role="img" aria-label="DUV: light passes through a transparent reticle and a column of lenses">
                <rect width="260" height="200" fill="#fbfbfa" />
                <rect x="95" y="14" width="70" height="8" fill="#dfe6ee" stroke="#9aa6b2" />
                <rect x="112" y="14" width="10" height="8" fill="#333" />
                <rect x="138" y="14" width="10" height="8" fill="#333" />
                <text x="172" y="21" fontSize="9" fill="#555">
                  reticle (light passes through)
                </text>
                {[48, 70, 92, 114, 136].map((y, i) => (
                  <ellipse key={y} cx="130" cy={y} rx={36 - i * 3} ry="5" fill="#e6eef6" stroke="#9aa6b2" />
                ))}
                <text x="172" y="96" fontSize="9" fill="#555">
                  refractive lenses
                </text>
                <path d="M110 22 L118 160 L142 160 L150 22 Z" fill="url(#hatch1)" opacity="0.55" />
                <rect x="70" y="162" width="120" height="6" fill="#7566f2" />
                <rect x="70" y="168" width="120" height="10" fill="#4b4e56" />
                <text x="130" y="194" fontSize="9" textAnchor="middle" fill="#555">
                  wafer, in air (or water for immersion)
                </text>
                <defs>
                  <pattern id="hatch1" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="2" height="5" fill="#6a5af9" />
                  </pattern>
                </defs>
              </svg>
              <p className="note">
                Argon-fluoride excimer laser light passes through a chrome-on-quartz reticle and a column of lenses that shrink the image 4×. Immersion scanners add a
                thin film of ultrapure water under the last lens.
              </p>
            </div>
            <div>
              <p className="card__title">Extreme UV (13.5 nm)</p>
              <svg viewBox="0 0 260 200" className="aerial" role="img" aria-label="EUV: light bounces off mirrors and a reflective reticle in vacuum">
                <rect width="260" height="200" fill="#fbfbfa" />
                <rect x="8" y="8" width="244" height="184" rx="10" fill="none" stroke="#9aa6b2" strokeDasharray="4 3" />
                <text x="14" y="22" fontSize="9" fill="#555">
                  vacuum chamber
                </text>
                <rect x="150" y="30" width="80" height="8" fill="#cfd6de" stroke="#9aa6b2" />
                <text x="150" y="52" fontSize="9" fill="#555">
                  reflective reticle
                </text>
                <path d="M40 150 L 60 110" stroke="#9aa6b2" strokeWidth="6" />
                <path d="M100 150 L 128 120" stroke="#9aa6b2" strokeWidth="6" />
                <path d="M170 150 L 190 118" stroke="#9aa6b2" strokeWidth="6" />
                <polyline points="30,40 190,34 50,128 114,136 180,134 150,172" fill="none" stroke="#6a5af9" strokeWidth="2" strokeDasharray="5 3" />
                <rect x="100" y="172" width="100" height="6" fill="#7566f2" />
                <text x="130" y="192" fontSize="9" textAnchor="middle" fill="#555">
                  wafer
                </text>
                <text x="30" y="72" fontSize="9" fill="#555">
                  multilayer mirrors
                </text>
              </svg>
              <p className="note">
                Almost every material absorbs 13.5 nm light, so EUV uses multilayer mirrors and a reflective reticle, with the light path kept at very low pressure.
                The two optical systems are separate machines; this journey’s scanner is DUV.
              </p>
            </div>
          </div>
          <p className="note" style={{ marginTop: 12 }}>
            Smallest printable feature ≈ k₁·λ/NA: a shorter wavelength λ, a larger numerical aperture NA, or cleverer processing (smaller k₁) all shrink it.
          </p>
          <a className="source" href={SOURCES.asmlLenses.url} target="_blank" rel="noreferrer" style={{ marginTop: 10 }}>
            {SOURCES.asmlLenses.title}
            <small>{SOURCES.asmlLenses.publisher}</small>
          </a>
        </div>
      </div>
    </>
  );
}

// ───────────────────────────── Recap ─────────────────────────────

export function Recap() {
  const choices = useApp((s) => s.choices);
  const checks = useApp((s) => s.checks);
  const setPanel = useApp((s) => s.setPanel);
  const goTo = useApp((s) => s.goTo);
  const close = () => setPanel(null);
  useEscape(close);
  const ref = useFocusOnOpen<HTMLDivElement>();
  const dg = engine.diagnosis(choices);
  const map = useWaferMap(choices);
  const ov = engine.contactOverlay(choices);
  const pg = engine.polyGates(choices);
  const sp = spinModel(choices.spin);
  const masks = MASK_ORDER.map((m) => MASKS[m]);
  const answered = Object.values(checks).filter(Boolean).length;
  const correct = Object.values(checks).filter((c) => c?.correct).length;
  const sequence = [
    ['Wafer', 'Receive, scan, clean'],
    ['Oxide + nitride', 'Furnace growth and deposition'],
    ['Isolation', 'Mask 1 → trench etch → oxide fill → CMP'],
    ['Wells', 'Masks 2–3 → phosphorus and boron implants → anneal'],
    ['Gate stack', 'Gate oxide + polysilicon'],
    ['Gates', 'Mask 4, the full lithography cycle → poly etch → strip'],
    ['Sources/drains', 'Masks 5–6 → arsenic and boron implants → anneal'],
    ['Contacts (MOL)', 'Oxide → CMP → mask 7 → etch → tungsten → CMP'],
    ['Metal 1 (BEOL)', 'Dielectric → mask 8 → trench etch → copper → CMP'],
    ['Via 1 + metal 2', 'Dielectric → masks 9–10 → etch → copper → CMP'],
    ['Passivation', 'Protective top coat, pad openings'],
    ['Test & package', 'Inspect → probe → dice → attach → bond → mould → final test'],
  ];
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="recap-title" tabIndex={-1} ref={ref}>
        <div className="modal__head">
          <h2 id="recap-title">What you built</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="modal__body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 22 }}>
            <div>
              <p className="result-line" style={{ color: dg.pass ? 'var(--ok)' : 'var(--bad)' }}>
                <span className="result-dot" style={{ background: dg.pass ? 'var(--ok)' : 'var(--bad)' }} />
                Your inverter {dg.pass ? 'works' : 'fails'}
              </p>
              <p className="feedback" style={{ marginTop: 0 }}>
                {dg.headline} {dg.detail}
              </p>
              <MiniWaferMap map={map} size={230} />
              {map && (
                <p className="note" style={{ textAlign: 'center' }}>
                  {map.passed} of {map.tested} complete dies pass · toy yield {map.yieldPct.toFixed(1)}%
                </p>
              )}
              <p className="card__title" style={{ marginTop: 14 }}>
                Your choices
              </p>
              <ul className="legend-grid" style={{ gridTemplateColumns: '1fr' }}>
                <li>Pre-process clean: {choices.clean ? 'run' : 'skipped'}</li>
                <li>
                  Spin speed: {sp.speedRel.toFixed(2)}× recipe (film {sp.tRel.toFixed(2)}× target)
                  {choices.spin !== DEFAULT_CHOICES.spin ? '' : ' — default'}
                </li>
                <li>
                  Exposure dose: {DOSE_LEVELS[choices.dose].label} → gates {Math.round(pg.worstRel * 100)}% of design
                </li>
                <li>
                  Contact overlay: {choices.overlay} units → measured {Math.round(ov.ofMargin * 100)}% of the margin
                </li>
                <li>Reworks: gate {choices.gateReworks}, contact {choices.contactReworks}</li>
                <li>
                  Knowledge checks: {correct} of {answered} answered correctly
                </li>
              </ul>
            </div>
            <div>
              <p className="card__title">The layer sequence</p>
              <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14 }}>
                {sequence.map(([a, b]) => (
                  <li key={a}>
                    <strong>{a}</strong> — <span style={{ color: 'var(--ink-2)' }}>{b}</span>
                  </li>
                ))}
              </ol>
              <p className="note" style={{ marginTop: 10 }}>
                {masks.length} reticles, each a full lithography loop. A real logic chip uses dozens of masks and hundreds of process steps over weeks to months.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 18 }}>
            {CHAPTERS.map((c) => (
              <button key={c.id} className="btn btn--small" onClick={() => goTo(chapterSteps(c.id)[0])}>
                Replay {c.name}
              </button>
            ))}
            <button className="btn btn--small btn--accent" onClick={() => goTo(STEP_INDEX.coat)}>
              Try a different recipe
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
