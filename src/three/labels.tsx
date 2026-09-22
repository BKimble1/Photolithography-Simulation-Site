/**
 * Screen-space labels for 3D scenes.
 *
 * drei's <Html> mounts a separate React root per label, which React 19 warns about when
 * those roots unmount during a canvas commit. Here scenes only *declare* labels (a plain
 * store); one DOM layer beside the canvas renders them, and one projector inside the canvas
 * moves them every frame and nudges overlapping labels apart.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { create } from 'zustand';

export type LabelTone = 'dark' | 'light' | 'accent' | 'chip';

export interface Label3D {
  key: string;
  pos: [number, number, number];
  text: ReactNode;
  tone?: LabelTone;
  /** Higher wins a contested spot; lower-priority labels are nudged away. */
  priority?: number;
}

interface LabelStore {
  groups: Record<string, Label3D[]>;
}

const useLabelStore = create<LabelStore>(() => ({ groups: {} }));

/** Declare labels from inside the canvas. Renders nothing in 3D. */
export function Labels({ items }: { items: Label3D[] }) {
  const owner = useId();
  useEffect(() => {
    useLabelStore.setState((s) => ({ groups: { ...s.groups, [owner]: items } }));
  }, [owner, items]);
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

const elements = new Map<string, HTMLElement>();

function useFlatLabels() {
  const groups = useLabelStore((s) => s.groups);
  return useMemo(() => {
    const out: (Label3D & { id: string })[] = [];
    for (const [owner, items] of Object.entries(groups)) for (const l of items) out.push({ ...l, id: `${owner}/${l.key}` });
    return out;
  }, [groups]);
}

/** DOM layer that sits over the canvas (inside the positioned viewport). */
export function LabelLayer() {
  const labels = useFlatLabels();
  return (
    <div className="labels3d" aria-hidden>
      {labels.map((l) => (
        <div
          key={l.id}
          className={'lab3d lab3d--' + (l.tone ?? 'dark')}
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

type Rect = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Mount once inside the Canvas: projects every declared label each frame. */
export function LabelProjector() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const labels = useFlatLabels();
  const order = useMemo(() => [...labels].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)), [labels]);
  const v = useMemo(() => new THREE.Vector3(), []);
  const obstacles = useRef<Rect[]>([]);
  const frame = useRef(0);
  useFrame(() => {
    if (!order.length) return;
    // UI floating over the canvas (view switch, toggles, scrubber, inset) counts as occupied.
    if (frame.current++ % 20 === 0) {
      const root = gl.domElement.closest('.viewport');
      const base = gl.domElement.getBoundingClientRect();
      obstacles.current = root
        ? Array.from(root.querySelectorAll<HTMLElement>('.vp-top > *, .vp-bottom > *')).map((el) => {
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
    const placed: Rect[] = [...obstacles.current];
    order.forEach((l, i) => {
      const d = dims[i];
      if (!d) return;
      v.set(l.pos[0], l.pos[1], l.pos[2]).project(camera);
      const x = ((v.x + 1) / 2) * size.width - d.w / 2;
      const y = ((1 - v.y) / 2) * size.height - d.h / 2;
      const onScreen = v.z < 1 && v.z > -1 && x > -d.w / 2 && x + d.w / 2 < size.width && y > -d.h / 2 && y + d.h / 2 < size.height;
      let spot: Rect | null = null;
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
      // Never stack labels on each other or on the UI: if there is no free spot, hide it.
      if (!spot) {
        d.el.style.opacity = '0';
        return;
      }
      placed.push(spot);
      d.el.style.transform = `translate3d(${Math.round(spot.x0)}px, ${Math.round(spot.y0)}px, 0)`;
      d.el.style.opacity = '1';
    });
  });
  return null;
}
