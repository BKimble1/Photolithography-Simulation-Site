import type { SceneId } from '../../content/steps';
import { Cabinet, CleanFloor } from '../kit/parts';

/** Placeholder fab bay; replaced by the full facility scene. */
export function FabScene({ highlight, hero }: { highlight?: SceneId; hero?: boolean }) {
  void highlight;
  void hero;
  return (
    <group>
      <CleanFloor size={40} />
      {Array.from({ length: 6 }, (_, i) => (
        <Cabinet key={i} size={[1.6, 2.2, 1.4]} position={[-5 + i * 2, 0, -2]} />
      ))}
    </group>
  );
}
