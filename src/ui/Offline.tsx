/**
 * The film's "Save for offline" control (in the film's controls, never among the home page's
 * main actions). It says only what is true: nothing is offered as available offline until the
 * download has been verified and committed.
 */
import { useEffect, useRef, useState } from 'react';
import { checkOffline, removeOffline, saveOffline, useOffline } from '../watch/offline';

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

const SaveIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <path d="M8 2.5v7.5M4.8 7l3.2 3.2L11.2 7M3 12.8h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function OfflineFilm() {
  const s = useOffline();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void checkOffline();
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const pct = s.totalBytes ? Math.round((s.doneBytes / s.totalBytes) * 100) : 0;
  return (
    <div className="menu" ref={ref}>
      <button
        className="fbtn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={s.phase === 'ready' ? 'Saved for offline' : 'Save for offline'}
        title="Save for offline"
        onClick={() => setOpen(!open)}
        data-state={s.phase}
      >
        <SaveIcon />
      </button>
      {open && (
        <div className="menu__pop offline" role="dialog" aria-label="Save for offline">
          <p className="offline__title">Save for offline</p>
          {s.phase === 'checking' && <p className="offline__text">Checking this device…</p>}
          {s.phase === 'unavailable' && <p className="offline__text">{s.message}</p>}
          {s.phase === 'none' && (
            <>
              <p className="offline__text">Download the film and this site to this device, so Watch works without a connection.</p>
              <button className="btn btn--small btn--primary" onClick={() => void saveOffline()}>
                Download
              </button>
            </>
          )}
          {s.phase === 'downloading' && (
            <div role="status">
              <p className="offline__text">
                Downloading and checking… {mb(s.doneBytes)} of {mb(s.totalBytes)}
              </p>
              <div className="offline__bar" aria-hidden>
                <i style={{ transform: `scaleX(${pct / 100})` }} />
              </div>
            </div>
          )}
          {s.phase === 'ready' && (
            <>
              <p className="offline__text">Saved on this device ({mb(s.savedBytes)}). The film and the site open without a connection here.</p>
              <button className="btn btn--small" onClick={() => void removeOffline()}>
                Remove
              </button>
            </>
          )}
          {s.phase === 'outdated' && (
            <>
              <p className="offline__text">An older version is saved. Update it to match this one ({mb(s.savedBytes)} saved).</p>
              <button className="btn btn--small btn--primary" onClick={() => void saveOffline()}>
                Update
              </button>
            </>
          )}
          {s.phase === 'error' && (
            <>
              <p className="offline__text offline__text--bad" role="alert">
                {s.message}
              </p>
              <button className="btn btn--small" onClick={() => void saveOffline()}>
                Try again
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
