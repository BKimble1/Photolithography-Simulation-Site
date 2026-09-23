/**
 * Places the declared labels (labels.tsx) on screen for the camera the director has just
 * rendered with.
 */
import * as THREE from 'three';
import type { MachineId } from '../state/nav';
import { elements, flatten, useLabelStore, type FlatLabel, type Group, type LabelSpace } from './labels';

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
