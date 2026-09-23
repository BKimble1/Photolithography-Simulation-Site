/**
 * Home: the fab itself, full-bleed, with a compact introduction in its own column below the
 * header. The introduction is laid out in normal flow (never absolutely centred), so it can
 * never collide with the wordmark, whatever the screen height, zoom or font loading state.
 */
import { STEPS } from '../content/steps';
import { FLOW } from '../sim/flow';
import { useApp } from '../state/store';

export function HomeIntro() {
  const navigate = useApp((s) => s.navigate);
  const goTo = useApp((s) => s.goTo);
  const step = useApp((s) => s.step);
  const maxStep = useApp((s) => s.maxStep);
  const resumable = maxStep > 0;
  return (
    <section className="home-intro" aria-labelledby="home-title">
      <h1 id="home-title" className="home-intro__title">
        Build a chip, <span className="nowrap">layer by layer.</span>
      </h1>
      <p className="home-intro__lead">Follow one silicon wafer through a fab, from bare disc to a working inverter, and see what each machine does to it.</p>
      <div className="home-intro__actions">
        <button className="btn btn--primary btn--lg" onClick={() => (resumable ? navigate({ mode: 'learn', step }) : goTo(0))}>
          {resumable ? 'Resume learning' : 'Start learning'}
          <svg width="18" height="12" viewBox="0 0 20 14" aria-hidden>
            <path d="M1 7h17M12 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="btn btn--lg btn--quiet" onClick={() => navigate({ mode: 'explore' })}>
          Explore fab
        </button>
      </div>
      {resumable && (
        <p className="home-intro__resume">
          You were at <b>{STEPS[FLOW[step].id].title}</b> (step {step + 1} of {FLOW.length}).{' '}
          <button className="linklike" onClick={() => goTo(0)}>
            Start from the beginning
          </button>
        </p>
      )}
      <p className="home-intro__note">
        An illustrative simulation of a two-transistor inverter, about 15 minutes. Equipment is stylised and the layout is conceptual; process behaviour is
        simplified from cited sources.
      </p>
    </section>
  );
}
