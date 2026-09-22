import { lazy, Suspense } from 'react';
import { FLOW } from '../sim/flow';
import { STEPS } from '../content/steps';
import { useApp } from '../state/store';
import { ChapterProgress, Wordmark } from './Chrome';
import { ErrorBoundary, HAS_WEBGL } from './ErrorBoundary';

const HomeCanvas = lazy(() => import('../three/HomeCanvas'));

export function Home() {
  const start = useApp((s) => s.start);
  const goTo = useApp((s) => s.goTo);
  const setPanel = useApp((s) => s.setPanel);
  const step = useApp((s) => s.step);
  const maxStep = useApp((s) => s.maxStep);
  const resumable = maxStep > 0;
  return (
    <div className="home">
      <div className="home__canvas">
        {HAS_WEBGL && (
          <ErrorBoundary fallback={null}>
            <Suspense fallback={null}>
              <HomeCanvas />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
      <div className="home__veil" />
      <nav className="home__nav" aria-label="Main">
        <Wordmark />
        <div className="home__links">
          <button onClick={() => goTo(0)}>The journey</button>
          <button onClick={() => setPanel('stages')}>Explore</button>
        </div>
      </nav>
      <main className="home__hero">
        <h1 className="home__title">
          Build a chip,
          <br />
          layer by layer.
        </h1>
        <p className="home__lead">Follow a wafer through the fab and see how each process changes it.</p>
        <div className="home__cta">
          <button className="btn btn--primary btn--hero" onClick={() => (resumable ? start() : goTo(0))}>
            {resumable ? 'Continue the journey' : 'Start the journey'}
            <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden>
              <path d="M1 7h17M12 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {resumable && (
            <button className="btn-text home__resume" onClick={() => goTo(0)}>
              or start over · you were at “{STEPS[FLOW[step].id].title}”
            </button>
          )}
        </div>
        <p className="home__note">
          An illustrative simulation of a two-transistor inverter · about 15 minutes. Equipment is stylised; process behaviour follows the cited
          sources.
        </p>
      </main>
      <div className="home__chapters">
        <ChapterProgress interactive={false} />
      </div>
    </div>
  );
}
