/**
 * The header: the same bar in every mode, so the wordmark always has its own reserved space
 * and never shares it with a headline. What the bar says follows the mode:
 *
 *   home     wordmark · Watch
 *   learn    wordmark · chapter, step title, step count · Chapters · Explore fab · Watch
 *   explore  wordmark · "Explore fab" · Equipment · Return to lesson
 *   watch    wordmark · film title · Exit
 */
import { STEPS } from '../content/steps';
import { MACHINE_INFO } from '../content/machines';
import { CHAPTERS, FLOW } from '../sim/flow';
import { useApp } from '../state/store';
import { markFilmGesture } from '../watch/film';

export function Wordmark() {
  const navigate = useApp((s) => s.navigate);
  return (
    <button className="wordmark" onClick={() => navigate({ mode: 'home' })} aria-label="FAB / ONE, home">
      FAB<span className="slash">/</span>ONE
    </button>
  );
}

export const PlayIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden>
    <path d="M3 1.6 L10.4 6 L3 10.4 Z" fill="currentColor" />
  </svg>
);

export const PauseIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden>
    <rect x="2.2" y="1.5" width="2.8" height="9" rx="0.6" fill="currentColor" />
    <rect x="7" y="1.5" width="2.8" height="9" rx="0.6" fill="currentColor" />
  </svg>
);

const ListIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const FabIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
    <path d="M1.8 13.5h12.4M3 13.5V7.2l3-1.8v2.2l3-1.8v2.2l3-1.8v7.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

const BackIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
    <path d="M9.5 3.5 5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function WatchButton() {
  const navigate = useApp((s) => s.navigate);
  return (
    <button
      className="hbtn hbtn--watch"
      onClick={() => {
        // the click itself unlocks sound, so the film can start speaking straight away
        markFilmGesture();
        navigate({ mode: 'watch' });
      }}
      aria-label="Watch the film"
      title="Watch the narrated film"
    >
      <span className="hbtn__play" aria-hidden>
        <PlayIcon size={10} />
      </span>
      <span className="hbtn__text">Watch</span>
    </button>
  );
}

/** Chapter, step title and step count; the same wording everywhere a lesson is named. */
function LessonPlace() {
  const step = useApp((s) => s.step);
  const ch = CHAPTERS.find((c) => c.id === FLOW[step].chapter)!;
  const title = STEPS[FLOW[step].id].title;
  return (
    <div className="place" aria-live="polite">
      <span className="place__ch">
        <span className="place__num">{String(ch.index).padStart(2, '0')}</span> <span className="place__chname">{ch.title}</span>
      </span>
      <span className="place__sep" aria-hidden>
        ·
      </span>
      <span className="place__title">{title}</span>
      <span className="place__count">
        {step + 1}
        <span aria-hidden>/</span>
        <span className="sr-only"> of </span>
        {FLOW.length}
      </span>
    </div>
  );
}

/** A hairline under the header: how far through the 37 steps the learner is, by chapter. */
function JourneyLine() {
  const step = useApp((s) => s.step);
  return (
    <div className="journey" aria-hidden>
      <i style={{ transform: `scaleX(${(step + 1) / FLOW.length})` }} />
    </div>
  );
}

export function Header() {
  const mode = useApp((s) => s.mode);
  const panel = useApp((s) => s.panel);
  const setPanel = useApp((s) => s.setPanel);
  const navigate = useApp((s) => s.navigate);
  const cameFrom = useApp((s) => s.cameFrom);
  const snapshot = useApp((s) => s.learnSnapshot);
  const machine = useApp((s) => s.machine);
  const toggle = (p: 'chapters' | 'equipment') => setPanel(panel === p ? null : p);
  const backToLesson = cameFrom === 'learn' && snapshot;
  return (
    <header className={'topbar topbar--' + mode}>
      <div className="topbar__brand">
        <Wordmark />
      </div>
      <div className="topbar__centre">
        {mode === 'learn' && <LessonPlace />}
        {mode === 'explore' && (
          <div className="place">
            <span className="place__ch">Explore fab</span>
            {machine && (
              <>
                <span className="place__sep" aria-hidden>
                  ·
                </span>
                <span className="place__title">{MACHINE_INFO[machine].name}</span>
              </>
            )}
          </div>
        )}
        {mode === 'watch' && (
          <div className="place">
            <span className="place__ch">Watch</span>
            <span className="place__sep" aria-hidden>
              ·
            </span>
            <span className="place__title">From bare silicon to a working inverter</span>
          </div>
        )}
      </div>
      <nav className="topbar__actions" aria-label="Main">
        {mode === 'home' && <WatchButton />}
        {mode === 'learn' && (
          <>
            <button className="hbtn" aria-expanded={panel === 'chapters'} onClick={() => toggle('chapters')} aria-keyshortcuts="C">
              <ListIcon />
              <span className="hbtn__text">Chapters</span>
            </button>
            <button className="hbtn" onClick={() => navigate({ mode: 'explore' })} aria-keyshortcuts="E">
              <FabIcon />
              <span className="hbtn__text">Explore fab</span>
            </button>
            <WatchButton />
          </>
        )}
        {mode === 'explore' && (
          <>
            <button className="hbtn" aria-expanded={panel === 'equipment'} onClick={() => toggle('equipment')}>
              <ListIcon />
              <span className="hbtn__text">Equipment</span>
            </button>
            <button className="hbtn hbtn--strong" onClick={() => navigate({ mode: backToLesson ? 'learn' : cameFrom === 'learn' ? 'learn' : 'home' })}>
              <BackIcon />
              <span className="hbtn__text">{backToLesson || cameFrom === 'learn' ? 'Return to lesson' : 'Home'}</span>
            </button>
          </>
        )}
        {mode === 'watch' && (
          <button className="hbtn hbtn--strong" onClick={() => navigate({ mode: cameFrom === 'learn' ? 'learn' : 'home' })}>
            <BackIcon />
            <span className="hbtn__text">Exit film</span>
          </button>
        )}
      </nav>
      {mode === 'learn' && <JourneyLine />}
    </header>
  );
}
