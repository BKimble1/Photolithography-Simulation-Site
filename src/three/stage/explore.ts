/** Explorer UI state that is not navigation: which machine the pointer or keyboard is on. */
import { create } from 'zustand';
import type { MachineId } from '../../state/nav';

export const useExplore = create<{ hovered: MachineId | null; setHovered: (id: MachineId | null) => void }>((set) => ({
  hovered: null,
  setHovered: (id) => set({ hovered: id }),
}));
