import { CHAPTERS, chapterSteps, FLOW } from '../sim/flow';
import { useApp } from '../state/store';

export function Wordmark({ onClick }: { onClick?: () => void }) {
  return (
    <button className="wordmark" onClick={onClick} aria-label="FAB / ONE — home">
      FAB<span className="slash">/</span>ONE
    </button>
  );
}

export function Header() {
  const step = useApp((s) => s.step);
  const goHome = useApp((s) => s.goHome);
  const setPanel = useApp((s) => s.setPanel);
  const panel = useApp((s) => s.panel);
  const ch = CHAPTERS.find((c) => c.id === FLOW[step].chapter)!;
  return (
    <header className="header">
      <div>
        <Wordmark onClick={goHome} />
      </div>
      <div className="header__chapter" aria-live="polite">
        <span className="num">{String(ch.index).padStart(2, '0')} /</span>
        {ch.title}
      </div>
      <div className="header__right">
        <button className="btn-text" aria-pressed={panel === 'stages'} onClick={() => setPanel(panel === 'stages' ? null : 'stages')} aria-keyshortcuts="S">
          Stages
        </button>
      </div>
    </header>
  );
}

/** Five chapter dots with connecting bars; the bar fills as steps in a chapter are completed. */
export function ChapterProgress({ interactive = true, labels = true }: { interactive?: boolean; labels?: boolean }) {
  const step = useApp((s) => s.step);
  const route = useApp((s) => s.route);
  const goTo = useApp((s) => s.goTo);
  const current = route === 'journey' ? FLOW[step].chapter : null;
  const curIdx = current ? CHAPTERS.findIndex((c) => c.id === current) : -1;
  return (
    <ol className="progress" aria-label="Chapters">
      {CHAPTERS.map((c, i) => {
        const steps = chapterSteps(c.id);
        const first = steps[0];
        const done = curIdx > i;
        const isCur = curIdx === i;
        const within = isCur ? (steps.indexOf(step) + 1) / steps.length : done ? 1 : 0;
        return (
          <li key={c.id}>
            {i > 0 && (
              <span className="progress__bar" aria-hidden>
                <i style={{ transform: `scaleX(${curIdx >= i ? 1 : 0})` }} />
              </span>
            )}
            <button
              className={'progress__dot' + (isCur ? ' is-current' : '') + (done ? ' is-done' : '')}
              onClick={() => interactive && goTo(first)}
              aria-current={isCur ? 'step' : undefined}
              aria-label={`Chapter ${c.index}: ${c.name}${isCur ? `, ${Math.round(within * 100)}% complete` : done ? ', completed' : ''}`}
              tabIndex={interactive ? 0 : -1}
            >
              {labels && <span className="progress__label">{c.name}</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function Footer() {
  const step = useApp((s) => s.step);
  return (
    <footer className="footer" style={{ position: 'relative' }}>
      <ChapterProgress />
      <span className="footer__step">
        Step {step + 1} of {FLOW.length}
      </span>
    </footer>
  );
}
