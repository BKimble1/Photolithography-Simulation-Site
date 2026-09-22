import { lazy, Suspense, useEffect } from 'react';
import type { ViewLevel } from './content/steps';
import { useApp, useClock } from './state/store';
import { Footer, Header } from './ui/Chrome';
import { Compare, EuvExplainer, Legend, LookCloser, Recap, Stages } from './ui/Overlays';
import { StepPanel } from './ui/StepPanel';
import { Viewport } from './ui/Viewport';

const Home = lazy(() => import('./ui/Home').then((m) => ({ default: m.Home })));

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useApp.getState();
      if (s.route !== 'journey') return;
      if (s.panel && e.key !== 'Escape') return;
      const views: Record<string, ViewLevel> = { '1': 'fab', '2': 'tool', '3': 'wafer', '4': 'device' };
      if (s.step !== 36 && views[e.key]) {
        s.setView(views[e.key]);
        return;
      }
      switch (e.key) {
        case 'ArrowRight':
          if (t?.tagName === 'BUTTON' && t.getAttribute('role') === 'radio') return;
          s.next();
          e.preventDefault();
          break;
        case 'ArrowLeft':
          if (t?.tagName === 'BUTTON' && t.getAttribute('role') === 'radio') return;
          s.prev();
          e.preventDefault();
          break;
        case ' ':
          if (t?.tagName === 'BUTTON') return;
          useClock.getState().toggle();
          e.preventDefault();
          break;
        case 'r':
        case 'R':
          useClock.getState().restart();
          break;
        case 's':
        case 'S':
          s.setPanel('stages');
          break;
        case 'l':
        case 'L':
          s.setPanel('closer');
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Journey() {
  const panel = useApp((s) => s.panel);
  return (
    <div className="app">
      <a className="skip-link" href="#step-panel">
        Skip to the step
      </a>
      <Header />
      <main className="main" id="step-panel">
        <StepPanel />
        <Viewport />
      </main>
      <Footer />
      {panel === 'stages' && <Stages />}
      {panel === 'closer' && <LookCloser />}
      {panel === 'compare' && <Compare />}
      {panel === 'legend' && <Legend />}
      {panel === 'euv' && <EuvExplainer />}
      {panel === 'recap' && <Recap />}
    </div>
  );
}

export default function App() {
  const route = useApp((s) => s.route);
  const panel = useApp((s) => s.panel);
  useKeyboard();
  useEffect(() => {
    // Journey started from a deep link: start playing (or freeze at ?p= for review/screenshots).
    if (route === 'journey') {
      const s = useApp.getState();
      s.goTo(s.step, { view: s.view });
      const q = new URLSearchParams(window.location.search);
      const p = q.get('p');
      if (p !== null && Number.isFinite(Number(p))) useClock.setState({ progress: Math.max(0, Math.min(1, Number(p))), playing: false });
      if (q.get('lp') === '1') useApp.setState({ lightPath: true });
      if (q.get('xray') === '1') useApp.setState({ xray: true });
      if (q.get('in') === '1') useApp.setState({ finalInput: 1 });
      const panel = q.get('panel');
      if (panel === 'closer' || panel === 'compare' || panel === 'stages' || panel === 'legend' || panel === 'recap' || panel === 'euv') useApp.setState({ panel });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (route === 'home')
    return (
      <Suspense fallback={null}>
        <Home />
        {panel === 'stages' && <Stages />}
      </Suspense>
    );
  return <Journey />;
}
