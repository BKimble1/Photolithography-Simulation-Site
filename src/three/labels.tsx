/**
 * Screen-space labels for 3D scenes.
 *
 * drei's <Html> mounts a separate React root per label, which React 19 warns about when
 * those roots unmount during a canvas commit. Here scenes only *declare* labels (a plain
 * store); one DOM layer beside the canvas renders them, and the stage director projects them
 * every frame (after it has placed the camera) and nudges overlapping labels apart.
 *
 * Every label belongs to a space (the fab world or the magnified device) and, inside a mounted
 * machine, to that station. Only labels in the space on screen, from the machines the story
 * is about right now, are shown — a parked neighbour never talks over the current step.
 */
import { createContext, useContext, useEffect, useId, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
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

interface Group {
  items: Label3D[];
  space: LabelSpace;
  station: MachineId | null;
}

interface LabelStore {
  groups: Record<string, Group>;
}

const useLabelStore = create<LabelStore>(() => ({ groups: {} }));

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

interface FlatLabel extends Label3D {
  id: string;
  space: LabelSpace;
  station: MachineId | null;
}

const elements = new Map<string, HTMLElement>();

function flatten(groups: Record<string, Group>): FlatLabel[] {
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

// ───────────────────────────── projection (called by the director) ─────────────────────────────

type Rect = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Stations whose labels may show (the director keeps this in step with the story). */
export const labelStations = new Set<MachineId>();

const proj = {
  order: [] as FlatLabel[],
  groups: null as Record<string, Group> | null,
  obstacles: [] as Rect[],
  frame: 0,
  v: new THREE.Vector3(),
};

/**
 * Place every label of `space` for this camera; `alpha` fades them (0 while a cross-fade is
 * under way, so labels never float between two scales). Called once per rendered frame.
 */
export function projectLabels(camera: THREE.Camera, space: LabelSpace, alpha: number, width: number, height: number, canvas: HTMLElement) {
  const groups = useLabelStore.getState().groups;
  if (groups !== proj.groups) {
    proj.groups = groups;
    proj.order = flatten(groups);
  }
  const order = proj.order;
  if (!order.length) return;
  // UI floating over the canvas counts as occupied (refreshed a few times a second).
  if (proj.frame++ % 20 === 0) {
    const root = canvas.closest('.viewport');
    const base = canvas.getBoundingClientRect();
    proj.obstacles = root
      ? Array.from(root.querySelectorAll<HTMLElement>('[data-occludes]'))
          .filter((el) => el.offsetParent !== null)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { x0: r.left - base.left - 4, y0: r.top - base.top - 4, x1: r.right - base.left + 4, y1: r.bottom - base.top + 4 };
          })
      : [];
  }
  // Batch reads (sizes) before writes (transforms) to avoid layout thrash.
  const dims = order.map((l) => {
    const el = elements.get(l.id);
    return el ? { el, w: el.offsetWidth, h: el.offsetHeight } : null;
  });
  const placed: Rect[] = [...proj.obstacles];
  const v = proj.v;
  order.forEach((l, i) => {
    const d = dims[i];
    if (!d) return;
    const eligible = alpha > 0.01 && l.space === space && (l.station === null || labelStations.has(l.station));
    let spot: Rect | null = null;
    if (eligible) {
      v.set(l.pos[0], l.pos[1], l.pos[2]).project(camera);
      const x = ((v.x + 1) / 2) * width - d.w / 2;
      const y = ((1 - v.y) / 2) * height - d.h / 2;
      const onScreen = v.z < 1 && v.z > -1 && x > -d.w / 2 && x + d.w / 2 < width && y > -d.h / 2 && y + d.h / 2 < height;
      if (onScreen) {
        const step = d.h + 3;
        for (const dy of [0, -step, step, -2 * step, 2 * step]) {
          const r = { x0: x, y0: y + dy, x1: x + d.w, y1: y + dy + d.h };
          if (!placed.some((p) => overlaps(p, r))) {
            spot = r;
            break;
          }
        }
      }
    }
    // Never stack labels on each other or on the UI: if there is no free spot, hide it.
    if (!spot) {
      if (d.el.style.opacity !== '0') d.el.style.opacity = '0';
      return;
    }
    placed.push(spot);
    d.el.style.transform = `translate3d(${Math.round(spot.x0)}px, ${Math.round(spot.y0)}px, 0)`;
    const o = String(Math.round(alpha * 100) / 100);
    if (d.el.style.opacity !== o) d.el.style.opacity = o;
  });
}
