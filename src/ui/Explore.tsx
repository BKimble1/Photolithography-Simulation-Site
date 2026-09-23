/**
 * Explore fab: look around the bay, pick a machine, read what it does, and watch it work in
 * an isolated demonstration on a sample wafer. Nothing here changes the learning run: the
 * only way into a lesson is the explicit "Open this lesson" link.
 */
import { useEffect } from 'react';
import { DEMO_STEP, lessonsFor, MACHINE_INFO } from '../content/machines';
import { STEPS } from '../content/steps';
import { FLOW, STEP_INDEX } from '../sim/flow';
import { useDemo } from '../state/demo';
import { MACHINES, type MachineId } from '../state/nav';
import { useApp } from '../state/store';
import { directorCommands, useStageInfo } from '../three/stage/Director';
import { useExplore } from '../three/stage/explore';
import { PauseIcon, PlayIcon } from './Chrome';
import { CloseIcon, useEscape, useFocusOnOpen } from './Overlays';
import { ScaleLabel } from './Viewport';

const AREA_NAME = { fab: 'Clean room', backend: 'Test and packaging' } as const;

function Lessons({ id }: { id: MachineId }) {
  const goTo = useApp((s) => s.goTo);
  const lessons = lessonsFor(id);
  return (
    <div className="mcard__lessons">
      <p className="mcard__k">
        {lessons.length > 1 ? `Used in ${lessons.length} steps: the wafer comes back here for later layers` : 'Used in one step'}
      </p>
      <ul>
        {lessons.map((i) => (
          <li key={i}>
            <button className="lesson-chip" onClick={() => goTo(i)} title="Open this lesson">
              <span className="lesson-chip__n">{i + 1}</span>
              {STEPS[FLOW[i].id].title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DemoBar({ id }: { id: MachineId }) {
  const progress = useDemo((s) => Math.round(s.progress * 100) / 100);
  const playing = useDemo((s) => s.playing);
  const toggle = useDemo((s) => s.toggle);
  const goTo = useApp((s) => s.goTo);
  const step = STEP_INDEX[DEMO_STEP[id]];
  return (
    <div className="demo" role="group" aria-label="Demonstration">
      <div className="demo__head">
        <span className="demo__tag">Demonstration</span>
        <span className="demo__title">{STEPS[DEMO_STEP[id]].title}</span>
      </div>
      <div className="demo__row">
        <button className="scrub__play" onClick={toggle} aria-label={playing ? 'Pause demonstration' : 'Play demonstration'}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <div className="demo__bar" aria-hidden>
          <i style={{ transform: `scaleX(${progress})` }} />
        </div>
      </div>
      <p className="demo__note">On a sample wafer. Your own wafer and progress are not changed.</p>
      <button className="linklike" onClick={() => goTo(step)}>
        Open this lesson (step {step + 1})
      </button>
    </div>
  );
}

function MachineCard({ id }: { id: MachineId }) {
  const demo = useApp((s) => s.demo);
  const navigate = useApp((s) => s.navigate);
  const info = MACHINE_INFO[id];
  return (
    <section className="mcard" aria-labelledby="mcard-title" data-occludes>
      <p className={'mcard__area mcard__area--' + info.area}>{AREA_NAME[info.area]}</p>
      <h2 id="mcard-title" className="mcard__title">
        {info.name}
      </h2>
      <p className="mcard__job">{info.job}</p>
      {demo ? <DemoBar id={id} /> : <Lessons id={id} />}
      <div className="mcard__actions">
        {demo ? (
          <button className="btn btn--small" onClick={() => navigate({ mode: 'explore', machine: id }, 'replace')}>
            Stop demonstration
          </button>
        ) : (
          <button className="btn btn--small btn--primary" onClick={() => navigate({ mode: 'explore', machine: id, demo: true })}>
            <PlayIcon /> See it work
          </button>
        )}
        <button className="btn btn--small btn--quiet" onClick={() => navigate({ mode: 'explore', machine: null })}>
          Back to fab
        </button>
      </div>
    </section>
  );
}

function OverviewCard() {
  const setPanel = useApp((s) => s.setPanel);
  return (
    <section className="mcard mcard--overview" aria-labelledby="ov-title" data-occludes>
      <h2 id="ov-title" className="mcard__title">
        The fab
      </h2>
      <p className="mcard__job">Choose a machine to see what it does to the wafer. Drag to look around; scroll or pinch to zoom.</p>
      <ul className="areas">
        <li>
          <i className="areas__sw areas__sw--fab" aria-hidden /> Clean room: fabrication, east of the glass wall
        </li>
        <li>
          <i className="areas__sw areas__sw--backend" aria-hidden /> Test and packaging, west of it
        </li>
      </ul>
      <p className="mcard__fine">Conceptual layout. Real fabs group many copies of each tool into bays and move wafers between them by overhead transport.</p>
      <button className="btn btn--small" onClick={() => setPanel('equipment')}>
        Equipment list
      </button>
    </section>
  );
}

export function ExploreHud() {
  const machine = useApp((s) => s.machine);
  const demo = useApp((s) => s.demo);
  const freeLook = useStageInfo((s) => s.freeLook);
  // The demonstration clock runs only while a demonstration is on screen.
  useEffect(() => {
    if (machine && demo) useDemo.getState().start(machine);
    else useDemo.getState().stop();
  }, [machine, demo]);
  useEffect(() => () => useDemo.getState().stop(), []);
  return (
    <>
      <div className="vp-top">
        <ScaleLabel />
        <div className="vp-commands" data-occludes>
          {freeLook && (
            <button className="cmd cmd--quiet" onClick={() => directorCommands.recentre()}>
              Reset view
            </button>
          )}
        </div>
      </div>
      <div className="explore-dock">{machine ? <MachineCard id={machine} key={machine} /> : <OverviewCard />}</div>
    </>
  );
}

/** Every machine as a plain list: keyboard, screen reader and touch friendly. */
export function EquipmentList() {
  const setPanel = useApp((s) => s.setPanel);
  const navigate = useApp((s) => s.navigate);
  const current = useApp((s) => s.machine);
  const setHovered = useExplore((s) => s.setHovered);
  const close = () => {
    setHovered(null);
    setPanel(null);
  };
  useEscape(close);
  const ref = useFocusOnOpen<HTMLDivElement>();
  const groups: ('fab' | 'backend')[] = ['fab', 'backend'];
  return (
    <>
      <div className="scrim scrim--light" onClick={close} />
      <div className="drawer drawer--equipment" role="dialog" aria-modal="true" aria-labelledby="eq-title" tabIndex={-1} ref={ref}>
        <div className="drawer__head">
          <h2 id="eq-title">Equipment</h2>
          <button className="icon-btn" onClick={close} aria-label="Close equipment list">
            <CloseIcon />
          </button>
        </div>
        <div className="drawer__body">
          {groups.map((g) => (
            <section key={g} className="eq-group" aria-label={AREA_NAME[g]}>
              <h3>{AREA_NAME[g]}</h3>
              <ul className="eq-list">
                {MACHINES.filter((id) => MACHINE_INFO[id].area === g).map((id) => (
                  <li key={id}>
                    <button
                      className={'eq-item' + (id === current ? ' is-current' : '')}
                      aria-current={id === current ? 'true' : undefined}
                      onMouseEnter={() => setHovered(id)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(id)}
                      onBlur={() => setHovered(null)}
                      onClick={() => {
                        setHovered(null);
                        setPanel(null);
                        navigate({ mode: 'explore', machine: id });
                      }}
                    >
                      <b>{MACHINE_INFO[id].name}</b>
                      <span>{MACHINE_INFO[id].job}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
