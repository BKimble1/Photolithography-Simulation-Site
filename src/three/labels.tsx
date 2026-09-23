/**
 * Screen-space labels for 3D scenes.
 *
 * drei's <Html> mounts a separate React root per label, which React 19 warns about when
 * those roots unmount during a canvas commit. Here scenes only *declare* labels (a plain
 * store); one DOM layer beside the canvas renders them, and the stage director projects them
 * every frame (after it has placed the camera; see labelProjection.ts) and nudges overlapping
 * labels apart. This module has no three.js dependency, so the page can render the layer
 * before the 3D code has loaded.
 *
 * Every label belongs to a space (the fab world or the magnified device) and, inside a mounted
 * machine, to that station. Only labels in the space on screen, from the machines the story
 * is about right now, are shown — a parked neighbour never talks over the current step.
 */
import { createContext, useContext, useEffect, useId, useMemo, type ReactNode } from 'react';
import { create } from 'zustand';
import type { MachineId } from '../state/nav';
import { useStationEnv } from './stage/context';

export type LabelTone = 'dark' | 'light' | 'accent' | 'chip';
export type LabelSpace = 'world' | 'device';

export interface Label3D {
  key: string;
  pos: [number, number, number];
  text: ReactNode;
  tone?: LabelTone;
  /** Higher wins a contested spot; lower-priority labels are nudged away. */
  priority?: number;
}

export interface Group {
  items: Label3D[];
  space: LabelSpace;
  station: MachineId | null;
}

interface LabelStore {
  groups: Record<string, Group>;
}

export const useLabelStore = create<LabelStore>(() => ({ groups: {} }));

/** Which space labels declared below belong to (the device portal sets 'device'). */
export const LabelSpaceContext = createContext<LabelSpace>('world');

/** Declare labels from inside the canvas. Renders nothing in 3D. */
export function Labels({ items }: { items: Label3D[] }) {
  const owner = useId();
  const space = useContext(LabelSpaceContext);
  const { station } = useStationEnv();
  useEffect(() => {
    useLabelStore.setState((s) => ({ groups: { ...s.groups, [owner]: { items, space, station } } }));
  }, [owner, items, space, station]);
  useEffect(
    () => () =>
      useLabelStore.setState((s) => {
        const groups = { ...s.groups };
        delete groups[owner];
        return { groups };
      }),
    [owner],
  );
  return null;
}

/** Convenience for a single label. */
export function Label({ pos, children, tone, priority }: { pos: [number, number, number]; children: ReactNode; tone?: LabelTone; priority?: number }) {
  const items = useMemo(() => [{ key: 'l', pos, text: children, tone, priority }], [pos[0], pos[1], pos[2], children, tone, priority]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Labels items={items} />;
}

export interface FlatLabel extends Label3D {
  id: string;
  space: LabelSpace;
  station: MachineId | null;
}

/** The DOM element of every declared label, by id. */
export const elements = new Map<string, HTMLElement>();

export function flatten(groups: Record<string, Group>): FlatLabel[] {
  const out: FlatLabel[] = [];
  for (const [owner, g] of Object.entries(groups)) for (const l of g.items) out.push({ ...l, id: `${owner}/${l.key}`, space: g.space, station: g.station });
  return out.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/** DOM layer that sits over the canvas (inside the positioned viewport). */
export function LabelLayer() {
  const groups = useLabelStore((s) => s.groups);
  const labels = useMemo(() => flatten(groups), [groups]);
  return (
    <div className="labels3d" aria-hidden>
      {labels.map((l) => (
        <div
          key={l.id}
          className={'lab3d lab3d--' + (l.tone ?? 'dark')}
          style={{ opacity: 0 }}
          ref={(el) => {
            if (el) elements.set(l.id, el);
            else elements.delete(l.id);
          }}
        >
          {l.text}
        </div>
      ))}
    </div>
  );
}

