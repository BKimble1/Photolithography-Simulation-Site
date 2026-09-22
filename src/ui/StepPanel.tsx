import { useEffect, useRef } from 'react';
import { FIRST_USE } from '../content/firstUse';
import { GLOSSARY } from '../content/glossary';
import { CHAPTERS, chapterSteps, FLOW } from '../sim/flow';
import { useStep } from '../state/sim';
import { useApp, useClock } from '../state/store';
import { CleanControl, DieInfo, DoseControl, InputControl, OverlayControl, SpinControl } from './controls';
import { ContactAdiPanel, ContactCheck, DevelopCheck, GateAdiPanel, InspectPanel, ProbePanel, ReturnLink, YourDieResult } from './panels';
import { plain, RichText } from './RichText';

function useRevealStage(): number {
  // 0: only "doing"; 1: + changes; 2: + why — tied to animation progress
  const reduced = useApp((s) => s.reducedMotion);
  const stage = useClock((c) => (c.progress >= 0.55 ? 2 : c.progress >= 0.2 ? 1 : 0));
  return reduced ? 2 : stage;
}

export function StepPanel() {
  const { index, id, content } = useStep();
  const chapter = FLOW[index].chapter;
  const ch = CHAPTERS.find((c) => c.id === chapter)!;
  const inCh = chapterSteps(chapter);
  const pos = inCh.indexOf(index) + 1;
  const stage = useRevealStage();
  const next = useApp((s) => s.next);
  const setPanel = useApp((s) => s.setPanel);
  const banner = useApp((s) => s.banner);
  const dismissBanner = useApp((s) => s.dismissBanner);
  const checks = useApp((s) => s.checks);
  const restart = useClock((s) => s.restart);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const isLast = index === FLOW.length - 1;

  // Move focus to the new step title for keyboard and screen-reader users.
  useEffect(() => {
    if (document.activeElement && document.activeElement !== document.body && !document.activeElement.closest('.panel')) return;
    titleRef.current?.focus({ preventScroll: true });
  }, [index]);

  const control = (() => {
    switch (content.control) {
      case 'clean':
        return <CleanControl />;
      case 'spin':
        return <SpinControl />;
      case 'dose':
        return <DoseControl />;
      case 'overlay':
        return <OverlayControl />;
      case 'input':
        return <InputControl />;
      case 'dies':
        return <DieInfo />;
      default:
        return null;
    }
  })();

  const waiting = content.check === 'develop' && !checks.develop;

  return (
    <aside className="panel" aria-label="Current step">
      <div className="panel__scroll">
        <div className="panel__meta">
          <span>
            {ch.name} · step {pos} of {inCh.length}
          </span>
          <span className="dot" aria-hidden />
          <span title="How long this takes in a real fab">{content.realTime}</span>
        </div>
        <h1 className="step-title" tabIndex={-1} ref={titleRef}>
          {content.title}
        </h1>
        <p className="step-lead">
          <RichText text={content.doing} />
        </p>
        <ReturnLink />
        {banner && (
          <div className="banner" role="status">
            <span>{banner}</span>
            <button aria-label="Dismiss" onClick={dismissBanner}>
              ×
            </button>
          </div>
        )}
        {content.check === 'develop' && <DevelopCheck />}
        {control}
        {content.check === 'contact' && <ContactCheck />}
        {content.inspect === 'gate-adi' && <GateAdiPanel />}
        {content.inspect === 'contact-adi' && <ContactAdiPanel />}
        {id === 'inspect' && <InspectPanel />}
        {id === 'probe' && <ProbePanel />}
        {id === 'final' && (
          <div className="card">
            <YourDieResult compact />
          </div>
        )}
        <ul className="microcopy" aria-live="polite">
          <li className={stage >= 1 && !waiting ? '' : 'is-hidden'}>
            <span className="label">What changes</span>
            <span>
              <RichText text={content.changes} />
            </span>
          </li>
          <li className={stage >= 2 && !waiting ? '' : 'is-hidden'}>
            <span className="label">Why it matters</span>
            <span>
              <RichText text={content.why} />
            </span>
          </li>
        </ul>
        {content.lithoNote && <p className="note note--litho">{content.lithoNote}</p>}
        {FIRST_USE[index].length > 0 && (
          <dl className="newterms" aria-label="New terms in this step">
            {FIRST_USE[index].map((t) => (
              <div key={t}>
                <dt>{GLOSSARY[t].term}</dt>
                <dd>{GLOSSARY[t].def}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="link-row">
          <button className="link-btn" onClick={() => setPanel('closer')}>
            Look closer
          </button>
          {content.compare && (
            <button className="link-btn" onClick={() => setPanel('compare')}>
              What changed?
            </button>
          )}
          <button className="link-btn" onClick={() => setPanel('legend')}>
            Legend
          </button>
        </div>
        <p className="sr-only" aria-live="polite">
          {`Step ${index + 1} of ${FLOW.length}: ${content.title}. ${plain(content.doing)}`}
        </p>
      </div>
      <div className="panel__footer">
        <button className="btn" onClick={restart} aria-label="Replay this step's animation">
          Replay
        </button>
        <button className="btn btn--primary btn--grow" onClick={next} aria-keyshortcuts="ArrowRight">
          {isLast ? 'See your recap' : 'Continue'}
        </button>
      </div>
    </aside>
  );
}
