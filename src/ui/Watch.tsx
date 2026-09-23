/**
 * Watch: the narrated film. The stage draws the film; this layer is its controls, its speech
 * captions and its honest states (loading, buffering, captions-only, ended). Nothing here
 * touches the learning run.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { STEPS } from '../content/steps';
import { CHAPTERS, FLOW } from '../sim/flow';
import { useApp } from '../state/store';
import { VIRTUAL_TIME } from '../three/stage/time';
import { closeFilm, filmControls, openFilm, takeFilmGesture, useFilm } from '../watch/film';
import { locate } from '../watch/timeline';
import { PauseIcon, PlayIcon } from './Chrome';
import { OfflineFilm } from './Offline';

const fmt = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const SPEEDS = [0.75, 1, 1.25, 1.5];

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M2.5 6h2.6L8.5 3v10L5.1 10H2.5z" fill="currentColor" />
      {muted ? (
        <path d="M10.5 5.5l4 5m0-5l-4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      ) : (
        <path d="M10.6 5.4a3.6 3.6 0 0 1 0 5.2M12.4 3.8a6 6 0 0 1 0 8.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      )}
    </svg>
  );
}

/** Where the film is: chapter and step, in the same words as the lessons. */
function FilmPlace() {
  const tl = useFilm((s) => s.tl);
  const seg = useFilm((s) => s.seg);
  if (!tl) return null;
  const s = tl.segments[seg];
  if (!s || s.stepIndex === null) return null;
  const ch = CHAPTERS.find((c) => c.id === FLOW[s.stepIndex!].chapter)!;
  return (
    <div className="film-place" aria-live="polite">
      <b>
        {String(ch.index).padStart(2, '0')} {ch.title}
      </b>
      <span>{STEPS[FLOW[s.stepIndex].id].title}</span>
    </div>
  );
}

function SeekBar() {
  const tl = useFilm((s) => s.tl)!;
  const t = useFilm((s) => s.t);
  const [drag, setDrag] = useState<number | null>(null);
  const value = drag ?? t;
  const chapter = useMemo(() => {
    let c = tl.chapters[0];
    for (const ch of tl.chapters) if (value >= ch.start) c = ch;
    return c;
  }, [tl, value]);
  return (
    <div className="seek">
      <input
        className="range seek__range"
        type="range"
        min={0}
        max={tl.duration}
        step={0.1}
        value={value}
        aria-label="Position in the film"
        aria-valuetext={`${fmt(value)} of ${fmt(tl.duration)}, ${chapter?.title ?? ''}`}
        style={{ ['--pct' as string]: `${(value / tl.duration) * 100}%` }}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDrag(v);
          filmControls.seek(v);
        }}
        onPointerUp={() => setDrag(null)}
        onKeyUp={() => setDrag(null)}
        onBlur={() => setDrag(null)}
      />
      <div className="seek__marks">
        {tl.chapters.map((c) => (
          <button
            key={c.title}
            className="seek__mark"
            style={{ left: `${(c.start / tl.duration) * 100}%` }}
            onClick={() => filmControls.seek(c.start)}
            aria-label={`Jump to chapter: ${c.title}`}
            title={c.title}
          >
            <span className="seek__label">{c.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SpeedMenu() {
  const rate = useFilm((s) => s.rate);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className="fbtn fbtn--text" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="Playback speed">
        {rate}×
      </button>
      {open && (
        <div className="menu__pop" role="menu" aria-label="Playback speed">
          {SPEEDS.map((r) => (
            <button
              key={r}
              role="menuitemradio"
              aria-checked={r === rate}
              onClick={() => {
                filmControls.rate(r);
                useApp.getState().setPrefs({ rate: r });
                setOpen(false);
              }}
            >
              {r === 1 ? 'Normal' : `${r}×`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Controls() {
  const status = useFilm((s) => s.status);
  const t = useFilm((s) => s.t);
  const tl = useFilm((s) => s.tl)!;
  const muted = useFilm((s) => s.muted);
  const volume = useFilm((s) => s.volume);
  const captions = useFilm((s) => s.captions);
  const playing = status === 'playing' || status === 'buffering';
  return (
    <div className="film-bar" data-occludes role="group" aria-label="Film controls">
      <button className="fbtn fbtn--play" onClick={filmControls.toggle} aria-label={playing ? 'Pause' : 'Play'} aria-keyshortcuts="Space">
        {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
      </button>
      <span className="film-bar__time">
        {fmt(t)} <span aria-hidden>/</span>
        <span className="sr-only"> of </span> {fmt(tl.duration)}
      </span>
      <SeekBar />
      <button
        className="fbtn fbtn--text"
        aria-pressed={captions}
        onClick={() => {
          filmControls.captions(!captions);
          useApp.getState().setPrefs({ captions: !captions });
        }}
        title="Captions"
        aria-keyshortcuts="C"
      >
        CC
      </button>
      <button
        className="fbtn"
        aria-pressed={muted}
        aria-label={muted ? 'Unmute' : 'Mute'}
        onClick={() => {
          filmControls.muted(!muted);
          useApp.getState().setPrefs({ muted: !muted });
        }}
        aria-keyshortcuts="M"
      >
        <SpeakerIcon muted={muted} />
      </button>
      <input
        className="range film-bar__vol"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        aria-label="Volume"
        style={{ ['--pct' as string]: `${(muted ? 0 : volume) * 100}%` }}
        onChange={(e) => {
          const v = Number(e.target.value);
          filmControls.volume(v);
          if (muted && v > 0) filmControls.muted(false);
          useApp.getState().setPrefs({ volume: v, muted: false });
        }}
      />
      <SpeedMenu />
      <OfflineFilm />
    </div>
  );
}

function Ended() {
  const navigate = useApp((s) => s.navigate);
  const goTo = useApp((s) => s.goTo);
  return (
    <div className="film-end" role="dialog" aria-labelledby="film-end-title">
      <h2 id="film-end-title">That was the whole journey.</h2>
      <p>One wafer, 37 steps, and a working inverter at the end. Now try it yourself: every setting you change shows up in the result.</p>
      <div className="film-end__actions">
        <button className="btn btn--primary" onClick={() => goTo(0)}>
          Start learning
        </button>
        <button className="btn" onClick={() => navigate({ mode: 'explore' })}>
          Explore fab
        </button>
        <button className="btn btn--quiet" onClick={() => filmControls.play()}>
          Watch again
        </button>
      </div>
    </div>
  );
}

function useFilmKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) && e.key !== ' ') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const f = useFilm.getState();
      if (!f.tl) return;
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          if (el?.tagName === 'BUTTON' && e.key === ' ') return;
          filmControls.toggle();
          e.preventDefault();
          break;
        case 'ArrowRight':
          if (el?.tagName === 'INPUT') return;
          filmControls.seek(f.t + 5);
          e.preventDefault();
          break;
        case 'ArrowLeft':
          if (el?.tagName === 'INPUT') return;
          filmControls.seek(f.t - 5);
          e.preventDefault();
          break;
        case 'm':
        case 'M':
          filmControls.muted(!f.muted);
          break;
        case 'c':
        case 'C':
          filmControls.captions(!f.captions);
          break;
        case 'Escape': {
          const a = useApp.getState();
          a.navigate({ mode: a.cameFrom === 'learn' ? 'learn' : 'home' });
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function WatchHud() {
  const phase = useFilm((s) => s.phase);
  const error = useFilm((s) => s.error);
  const status = useFilm((s) => s.status);
  const cue = useFilm((s) => s.cue);
  const captions = useFilm((s) => s.captions);
  const audioOk = useFilm((s) => s.audioOk);
  const audioError = useFilm((s) => s.audioError);
  const t = useFilm((s) => s.t);
  const tl = useFilm((s) => s.tl);
  useFilmKeys();

  // Open the film when Watch is entered; close it (and remember where) when leaving.
  useEffect(() => {
    const prefs = useApp.getState().prefs;
    useFilm.setState({ captions: prefs.captions });
    const q = new URLSearchParams(window.location.search);
    const t0 = Number(q.get('t')) || 0;
    const autoplay = takeFilmGesture();
    void openFilm(t0, autoplay).then(() => {
      filmControls.rate(prefs.rate);
      filmControls.volume(prefs.volume);
      filmControls.muted(prefs.muted);
    });
    return () => closeFilm();
  }, []);

  const atStart = status === 'paused' && t < 0.5;
  const inGap = tl ? locate(tl, t).inGap : false;
  return (
    <>
      <div className="vp-top">
        <FilmPlace />
      </div>
      {phase === 'loading' && (
        <div className="film-state" role="status">
          Preparing the film…
        </div>
      )}
      {phase === 'error' && (
        <div className="film-state film-state--error" role="alert">
          <p>The film could not be loaded{error ? ` (${error})` : ''}.</p>
          <button className="btn btn--small" onClick={() => void openFilm(0, true)}>
            Try again
          </button>
        </div>
      )}
      {phase === 'ready' && atStart && (
        <button className="film-bigplay" onClick={() => filmControls.play()} aria-label="Play the film">
          <PlayIcon size={26} />
          <span>Play the film · {tl ? fmt(tl.duration) : ''}</span>
        </button>
      )}
      {phase === 'ready' && status === 'buffering' && (
        <div className="film-state film-state--quiet" role="status">
          Loading narration…
        </div>
      )}
      {phase === 'ready' && status === 'ended' && <Ended />}
      <div className="vp-bottom film-bottom">
        {!audioOk && !VIRTUAL_TIME && (
          <div className="film-note" role="status">
            {audioError ?? 'Narration is off.'} Playing with captions only.{' '}
            <button className="linklike" onClick={filmControls.retryAudio}>
              Try the audio again
            </button>
          </div>
        )}
        {captions && cue && !inGap && (
          <p className="film-caption" key={cue}>
            {cue}
          </p>
        )}
        {phase === 'ready' && tl && <Controls />}
      </div>
    </>
  );
}
