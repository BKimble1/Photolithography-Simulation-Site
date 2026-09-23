import { useEffect } from 'react';
import { MACHINE_INFO } from './content/machines';
import { STEPS } from './content/steps';
import { FLOW } from './sim/flow';
import { installHistorySync, useApp, useClock } from './state/store';
import { directorCommands, useStageInfo } from './three/stage/info';
import { Caption } from './ui/Caption';
import { Header } from './ui/Chrome';
import { EquipmentList, ExploreHud } from './ui/Explore';
import { HomeIntro } from './ui/Home';
import { Chapters, Compare, EuvExplainer, Legend, LookCloser, Recap } from './ui/Overlays';
import { StepPanel } from './ui/StepPanel';
import { FlatView, HAS_WEBGL, LabelLayer, LearnHud, StageHost } from './ui/Viewport';
import { WatchHud } from './ui/Watch';
import { Diag } from './ui/Diag';
import { DIAG } from './three/stage/quality';

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useApp.getState();
      if (s.panel) return; // open panels handle their own keys (Escape closes them)
      if (s.mode === 'explore') {
        if (e.key === 'Escape') {
          if (s.machine) s.navigate({ mode: 'explore', machine: null });
          else s.navigate({ mode: s.cameFrom === 'learn' ? 'learn' : 'home' });
        }
        return;
      }
      if (s.mode !== 'learn') return;
      const radio = t?.tagName === 'BUTTON' && t.getAttribute('role') === 'radio';
      switch (e.key) {
        case 'ArrowRight':
          if (radio) return;
          s.next();
          e.preventDefault();
          break;
        case 'ArrowLeft':
          if (radio) return;
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
        case 'c':
        case 'C':
          s.setPanel('chapters');
          break;
        case 'e':
        case 'E':
          s.navigate({ mode: 'explore' });
          break;
        case 'i':
        case 'I':
          s.setScaleOverride(useStageInfo.getState().space === 'device' ? 'tool' : 'device');
          break;
        case 'g':
        case 'G':
          s.setScaleOverride(null);
          directorCommands.recentre();
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

/** The address the page was opened with (read once: effects may run twice in development). */
const START_QUERY = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
let started = false;

/** Round-one review parameters (?p, lp, xray, in, panel) apply once, to a lesson deep link. */
function useStartup() {
  useEffect(() => {
    if (started) return;
    started = true;
    const s = useApp.getState();
    if (s.mode !== 'learn') return;
    const q = START_QUERY;
    const override = s.scaleOverride;
    s.goTo(s.step, { history: 'replace' });
    if (override) useApp.setState({ scaleOverride: override });
    const p = q.get('p');
    if (p !== null && Number.isFinite(Number(p))) useClock.setState({ progress: Math.max(0, Math.min(1, Number(p))), playing: false, pendingPlay: false });
    if (q.get('lp') === '1') useApp.setState({ lightPath: true });
    if (q.get('xray') === '1') useApp.setState({ xray: true });
    if (q.get('in') === '1') useApp.setState({ finalInput: 1 });
    const panel = q.get('panel');
    if (panel === 'closer' || panel === 'compare' || panel === 'legend' || panel === 'recap' || panel === 'euv' || panel === 'chapters') useApp.setState({ panel });
  }, []);
}

function viewportLabel(mode: string, step: number, machine: string | null): string {
  if (mode === 'learn') return `3D view of step ${step + 1}: ${STEPS[FLOW[step].id].title}. Drag to look around, scroll or pinch to zoom.`;
  if (mode === 'explore') return machine ? `3D view of the ${MACHINE_INFO[machine as keyof typeof MACHINE_INFO].name}.` : '3D view of the fab bay. Use the equipment list to choose a machine.';
  if (mode === 'watch') return 'The film.';
  return 'The fab bay.';
}

export default function App() {
  const mode = useApp((s) => s.mode);
  const panel = useApp((s) => s.panel);
  const step = useApp((s) => s.step);
  const machine = useApp((s) => s.machine);
  useKeyboard();
  useStartup();
  useEffect(() => installHistorySync(), []);
  return (
    <div className={'app app--' + mode}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main className="stagearea" id="main">
        {mode === 'learn' ? <StepPanel /> : null}
        <section className="viewport" aria-label={viewportLabel(mode, step, machine)}>
          <StageHost fallback={mode === 'learn' ? <FlatView /> : <div className="vp-noweb" />} />
          <LabelLayer />
          {mode === 'learn' && <LearnHud />}
          {mode === 'explore' && <ExploreHud />}
          {mode === 'watch' && <WatchHud />}
          {mode === 'learn' && !HAS_WEBGL && <p className="sr-only">3D is unavailable; the cross-section shows your die.</p>}
        </section>
        {mode === 'home' ? <HomeIntro /> : null}
        {mode === 'learn' ? <Caption where="strip" /> : null}
      </main>
      {panel === 'chapters' && <Chapters />}
      {panel === 'equipment' && <EquipmentList />}
      {panel === 'closer' && <LookCloser />}
      {panel === 'compare' && <Compare />}
      {panel === 'legend' && <Legend />}
      {panel === 'euv' && <EuvExplainer />}
      {panel === 'recap' && <Recap />}
      {DIAG && <Diag />}
    </div>
  );
}
