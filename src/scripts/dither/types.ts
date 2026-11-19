export type DitherMode =
  | 'bayer'
  | 'bayer4'
  | 'bayer2'
  | 'halftone'
  | 'lines'
  | 'crosshatch'
  | 'noise'
  | 'none';

export type DitherEffect = 'erase' | 'reveal' | 'ripple';

export type RgbColor = [number, number, number] | string;

export interface DitherProps {
  waveSpeed?: number;
  waveFrequency?: number;
  waveAmplitude?: number;
  waveColor?: RgbColor;
  backgroundColor?: RgbColor;
  colorNum?: number;
  pixelSize?: number;
  disableAnimation?: boolean;
  enableMouseInteraction?: boolean;
  mouseRadius?: number;
  ditherMode?: DitherMode;
  palette?: string[];
  scale?: number;
  contrast?: number;
  brightness?: number;
  mouseEffect?: DitherEffect;
  mouseStrength?: number;
  trail?: number;
  clickRipple?: boolean;
  intro?: boolean;
  dpr?: number;
  className?: string;
}

export interface DitherSettings {
  waveSpeed: number;
  waveFrequency: number;
  waveAmplitude: number;
  waveColor: RgbColor;
  backgroundColor: RgbColor;
  colorNum: number;
  pixelSize: number;
  disableAnimation: boolean;
  enableMouseInteraction: boolean;
  mouseRadius: number;
  mode: number;
  palette: string[];
  scale: number;
  contrast: number;
  brightness: number;
  effect: number;
  mouseStrength: number;
  trail: number;
  clickRipple: boolean;
  intro: boolean;
  dpr?: number;
}

export const MAX_TRAIL = 16;
export const MAX_RIPPLES = 4;
export const MAX_PALETTE = 8;
export const INTRO_SECONDS = 1.8;
export const RIPPLE_SECONDS = 1.6;

const MODES: Record<DitherMode, number> = {
  bayer: 0,
  bayer4: 1,
  bayer2: 2,
  halftone: 3,
  lines: 4,
  crosshatch: 5,
  noise: 6,
  none: 7,
};

const EFFECTS: Record<DitherEffect, number> = {
  erase: 0,
  reveal: 1,
  ripple: 2,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveDitherSettings(raw: DitherProps): DitherSettings {
  const palette = Array.isArray(raw.palette) ? raw.palette.filter(Boolean).slice(0, MAX_PALETTE) : [];
  return {
    waveSpeed: raw.waveSpeed ?? 0.05,
    waveFrequency: raw.waveFrequency ?? 3,
    waveAmplitude: raw.waveAmplitude ?? 0.3,
    waveColor: raw.waveColor ?? [0.5, 0.5, 0.5],
    backgroundColor: raw.backgroundColor ?? [0, 0, 0],
    colorNum: Math.max(2, raw.colorNum ?? 4),
    pixelSize: Math.max(1, raw.pixelSize ?? 2),
    disableAnimation: raw.disableAnimation ?? false,
    enableMouseInteraction: raw.enableMouseInteraction ?? true,
    mouseRadius: Math.max(0.001, raw.mouseRadius ?? 1),
    mode: MODES[raw.ditherMode ?? 'bayer'] ?? 0,
    palette,
    scale: Math.max(0.05, raw.scale ?? 1),
    contrast: raw.contrast ?? 1,
    brightness: raw.brightness ?? 0,
    effect: EFFECTS[raw.mouseEffect ?? 'erase'] ?? 0,
    mouseStrength: Math.max(0, raw.mouseStrength ?? 1),
    trail: clamp(raw.trail ?? 0.5, 0, 1),
    clickRipple: raw.clickRipple ?? true,
    intro: raw.intro ?? true,
    dpr: raw.dpr,
  };
}
