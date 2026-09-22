/**
 * Depo scene — placeholder until the full equipment scene is built.
 */
import { Cabinet, CleanFloor } from '../kit/parts';
import type { ToolProps } from './index';

export default function Depo({ variant }: ToolProps) {
  void variant;
  return (
    <group>
      <CleanFloor size={10} />
      <Cabinet size={[1.2, 1.8, 1]} position={[0, 0, 0]} />
    </group>
  );
}
