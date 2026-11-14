import type * as THREE from 'three';

export type Orientation = 'portrait' | 'landscape';
export type ImageFit = 'cover' | 'contain';
export type Finish = 'glossy' | 'matte' | 'holographic' | 'metallic';
export type Anchor = 'left' | 'center' | 'right';
export type Metal = 'graphite' | 'silver' | 'gold';

export interface LanyardOptions {
  frontImage?: string;
  backImage?: string;
  imageFit?: ImageFit;
  cardColor?: string;
  orientation?: Orientation;
  finish?: Finish;
  cornerRadius?: number;
  size?: number;
  anchor?: Anchor;
  strapLength?: number;
  strapImage?: string;
  strapColor?: string;
  strapWidth?: number;
  metal?: Metal;
  gravity?: number;
  damping?: number;
  elasticity?: number;
  breeze?: number;
  interactive?: boolean;
  intro?: boolean;
}

export interface LanyardLayout {
  width: number;
  height: number;
  radius: number;
  slot: { width: number; height: number; y: number };
  ringY: number;
  hangY: number;
}

export interface GrabState {
  local: THREE.Vector3;
  rotation: THREE.Quaternion;
  reach: number;
  from: THREE.Vector3;
  target: THREE.Vector3;
}

export interface RigidBody {
  position: THREE.Vector3;
  previous: THREE.Vector3;
  velocity: THREE.Vector3;
  quaternion: THREE.Quaternion;
  previousQuaternion: THREE.Quaternion;
  angular: THREE.Vector3;
  mass: number;
  inverseInertia: THREE.Vector3;
  hang: THREE.Vector3;
}

export interface LanyardSim {
  nodes: THREE.Vector3[];
  previous: THREE.Vector3[];
  velocities: THREE.Vector3[];
  lengths: Float64Array;
  impulses: Float64Array;
  rest: number;
  anchor: THREE.Vector3;
  body: RigidBody;
  grab: GrabState | null;
  turn: number;
  twist: number;
  twistRaw: number;
  calm: number;
}

export interface PhysicsParams {
  gravity: number;
  hold: number;
  stiffness: number;
  spring: number;
  bandDamping: number;
  linearDrag: number;
  angularDrag: number;
  air: number;
  broadside: number;
  spinAir: number;
  nodeDrag: number;
  nodeAir: number;
  twist: number;
  twistDamping: number;
  grip: number;
  gripDamping: number;
  breeze: number;
}

export const CARD_SIZES: Record<Orientation, [number, number]> = {
  portrait: [1.6, 2.25],
  landscape: [2.25, 1.6],
};

export const ANCHORS: Record<Anchor, number> = { left: 0.27, center: 0.5, right: 0.73 };
export const THICKNESS = 0.018;
export const BEVEL = 0.007;
export const JOINTS = 4;
export const NODE_WEIGHT = 1 / 0.05;
export const MAX_STEP = 1 / 960;
export const ITERATIONS = 2;
export const SAMPLES = 72;
export const FOV = 24;
export const STRAP_WIDTH = 0.36;
export const RING_RADIUS = 0.095;
export const RING_TUBE = 0.0135;
export const EYELET_RADIUS = 0.036;
export const CLAMP_BODY = 0.15;
export const FACE_WIDTH = 1024;
export const FLIP_SPIN = 9;
export const BAND_COLUMNS = [0, 0.07, 0.93, 1];
export const BAND_BEND = [-0.95, -0.28, 0.28, 0.95];

export const FINISHES: Record<
  Finish,
  { roughness: number; metalness: number; clearcoat: number; clearcoatRoughness: number; foil: number; anisotropy: number }
> = {
  glossy: { roughness: 0.42, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, foil: 0, anisotropy: 0 },
  matte: { roughness: 0.85, metalness: 0, clearcoat: 0, clearcoatRoughness: 0.6, foil: 0, anisotropy: 0 },
  holographic: { roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, foil: 1, anisotropy: 0 },
  metallic: { roughness: 0.36, metalness: 0.75, clearcoat: 0.5, clearcoatRoughness: 0.18, foil: 0, anisotropy: 0.7 },
};

export const METALS: Record<Metal, { color: string; roughness: number }> = {
  silver: { color: '#d9dce2', roughness: 0.16 },
  gold: { color: '#e4b965', roughness: 0.2 },
  graphite: { color: '#4d4f55', roughness: 0.28 },
};

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
