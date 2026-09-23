/**
 * The lesson caption: one short sentence beside the animation, timed to the step (see
 * content/beats.ts). On wide screens it sits in the lower third of the viewport; on phones it
 * sits in a stable strip below the canvas so it never covers the wafer.
 */
import { useMemo } from 'react';
import { beatIndexAt, beatText, BEATS } from '../content/beats';
import { FLOW } from '../sim/flow';
import { engine } from '../state/sim';
import { useApp, useClock } from '../state/store';

export function useRunPass(choices = useApp.getState().choices): boolean {
  return useMemo(() => engine.diagnosis(choices).pass, [choices]);
}

export function Caption({ where }: { where: 'overlay' | 'strip' }) {
  const step = useApp((s) => s.step);
  const choices = useApp((s) => s.choices);
  const id = FLOW[step].id;
  const idx = useClock((c) => beatIndexAt(id, c.progress));
  const pass = useRunPass(choices);
  const beat = BEATS[id][idx];
  if (!beat) return null;
  const text = beatText(beat, { choices, pass });
  return (
    <div className={'caption caption--' + where} data-occludes>
      <p className="caption__text" key={`${id}:${idx}`}>
        {text}
      </p>
    </div>
  );
}
