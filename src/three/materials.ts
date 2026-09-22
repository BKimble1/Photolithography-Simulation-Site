/**
 * Shared physically based materials for the equipment scenes. Created once and reused so
 * the renderer compiles few shader programs. Colours are deliberately restrained:
 * stainless steel, white powder-coated panels, dark glass, black anodised details and a
 * single violet accent for status lights.
 */
import * as THREE from 'three';

function std(p: THREE.MeshStandardMaterialParameters) {
  return new THREE.MeshStandardMaterial(p);
}
function phys(p: THREE.MeshPhysicalMaterialParameters) {
  return new THREE.MeshPhysicalMaterial(p);
}

export const MAT = {
  steel: std({ color: '#c8ccd2', metalness: 1, roughness: 0.26 }),
  steelSatin: std({ color: '#b9bec5', metalness: 1, roughness: 0.4 }),
  steelDark: std({ color: '#7d838c', metalness: 1, roughness: 0.34 }),
  chrome: std({ color: '#e8eaee', metalness: 1, roughness: 0.08 }),
  aluminum: std({ color: '#d5d8dc', metalness: 0.9, roughness: 0.45 }),
  panel: std({ color: '#eef0f2', metalness: 0, roughness: 0.52 }),
  panelWarm: std({ color: '#f1f0ec', metalness: 0, roughness: 0.55 }),
  panelGray: std({ color: '#d4d7db', metalness: 0.05, roughness: 0.6 }),
  panelDark: std({ color: '#3a3e45', metalness: 0.2, roughness: 0.5 }),
  black: std({ color: '#1f2125', metalness: 0.35, roughness: 0.42 }),
  rubber: std({ color: '#18191b', metalness: 0, roughness: 0.92 }),
  ceramic: std({ color: '#f5f5f2', metalness: 0, roughness: 0.32 }),
  ceramicGray: std({ color: '#c9ccd0', metalness: 0, roughness: 0.4 }),
  glassDark: phys({ color: '#20262c', metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.42, clearcoat: 1 }),
  glassClear: phys({ color: '#e9f1f6', metalness: 0, roughness: 0.02, transparent: true, opacity: 0.16, clearcoat: 1, depthWrite: false }),
  quartz: phys({ color: '#f3f7fa', metalness: 0, roughness: 0.06, transparent: true, opacity: 0.28, clearcoat: 1, depthWrite: false }),
  polycarbonate: phys({ color: '#dfe5ea', metalness: 0, roughness: 0.18, transparent: true, opacity: 0.5, clearcoat: 0.6 }),
  copper: std({ color: '#d08a5a', metalness: 1, roughness: 0.28 }),
  gold: std({ color: '#e0b25a', metalness: 1, roughness: 0.22 }),
  mold: std({ color: '#1b1c1f', metalness: 0, roughness: 0.66 }),
  pcb: std({ color: '#1e3b33', metalness: 0.1, roughness: 0.55 }),
  pad: std({ color: '#b8e0f0', metalness: 0.3, roughness: 0.5 }),
  granite: std({ color: '#2b2d31', metalness: 0.05, roughness: 0.55 }),
  floor: std({ color: '#f2f3f4', metalness: 0.05, roughness: 0.35 }),
  floorGrid: std({ color: '#dfe2e5', metalness: 0.1, roughness: 0.5 }),
  violetGlow: std({ color: '#7a6cff', emissive: '#6a5af9', emissiveIntensity: 2.2, roughness: 0.4 }),
  greenGlow: std({ color: '#6ef0b0', emissive: '#3ddc97', emissiveIntensity: 1.6 }),
  amberGlow: std({ color: '#ffb35c', emissive: '#ff8a1f', emissiveIntensity: 1.8 }),
  whiteGlow: std({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.4 }),
  screen: std({ color: '#0e1320', emissive: '#1b2a4a', emissiveIntensity: 0.9, roughness: 0.25 }),
  label: std({ color: '#2a2d33', metalness: 0, roughness: 0.6 }),
  resistLiquid: phys({ color: '#b9a7ff', metalness: 0, roughness: 0.05, transparent: true, opacity: 0.85, clearcoat: 1 }),
  water: phys({ color: '#dff1ff', metalness: 0, roughness: 0.03, transparent: true, opacity: 0.45, clearcoat: 1, depthWrite: false }),
  plasma: new THREE.MeshBasicMaterial({ color: '#b9a8ff', transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }),
  beam: new THREE.MeshBasicMaterial({ color: '#7a6cff', transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
};

export type MatKey = keyof typeof MAT;
