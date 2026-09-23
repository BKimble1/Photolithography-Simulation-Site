/**
 * The current beat's anchored labels (content/beats.ts), for the presentation on screen. They
 * follow their anchor every frame (the wafer moves with the robot) and appear only once the
 * camera has arrived, never while it travels.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { beatIndexAt, BEATS, type BeatLabel } from '../../content/beats';
import { machineOfStep } from '../../content/machines';
import { useProgressSource } from '../../state/presentation';
import { useStep } from '../../state/sim';
import { Labels, type Label3D } from '../labels';
import { toolMatrix, waferFrame } from './anchors';
import { useStageInfo } from './info';

const frame = { centre: new THREE.Vector3(), up: new THREE.Vector3(), die: new THREE.Vector3(), x: new THREE.Vector3() };
const m = new THREE.Matrix4();
const v = new THREE.Vector3();

export function BeatLabels() {
  const { index, id } = useStep();
  const src = useProgressSource();
  const get = () => beatIndexAt(id, src.get());
  const idx = useSyncExternalStore(src.subscribe, get, get);
  const flying = useStageInfo((s) => s.flying);
  const space = useStageInfo((s) => s.space);
  const station = machineOfStep(index);
  const defs: BeatLabel[] = BEATS[id][idx]?.labels ?? [];
  const items = useMemo<(Label3D & { def: BeatLabel })[]>(
    () => defs.map((def, i) => ({ key: `beat${i}`, pos: [0, -1000, 0] as [number, number, number], text: def.text, tone: 'chip' as const, priority: 6, def })),
    [defs],
  );
  useFrame(() => {
    for (const it of items) {
      const a = it.def.anchor;
      if (a.kind === 'wafer') {
        if (!waferFrame(station, frame)) {
          it.pos[1] = -1000;
          continue;
        }
        v.copy(frame.centre).addScaledVector(frame.up, a.lift ?? 0.03);
      } else {
        if (!station) continue;
        v.set(a.at[0], a.at[1], a.at[2]).applyMatrix4(toolMatrix(station, m));
      }
      it.pos[0] = v.x;
      it.pos[1] = v.y;
      it.pos[2] = v.z;
    }
  });
  if (flying || space !== 'world' || !items.length) return null;
  return <Labels items={items} />;
}
