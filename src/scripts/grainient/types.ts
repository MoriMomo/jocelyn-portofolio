export type GrainientType = 'linear' | 'radial';

export interface GrainientProps {
  colors?: string[];
  type?: GrainientType;
  angle?: number;
  bands?: number;
  speed?: number;
  flow?: number;
  scale?: number;
  softness?: number;
  silk?: number;
  grainAmount?: number;
  grainSize?: number;
  grainAnimated?: boolean;
  contrast?: number;
  saturation?: number;
  variation?: number;
  interactive?: boolean;
  stir?: number;
  clickSwirl?: boolean;
  intro?: boolean;
  lightMode?: boolean;
  dpr?: number;
  className?: string;
}

export interface GrainientSettings {
  colors: string[];
  type: number;
  angle: number;
  bands: number;
  speed: number;
  flow: number;
  scale: number;
  softness: number;
  silk: number;
  grainAmount: number;
  grainSize: number;
  grainAnimated: boolean;
  contrast: number;
  saturation: number;
  variation: number;
  interactive: boolean;
  stir: number;
  clickSwirl: boolean;
  intro: boolean;
  lightMode: boolean;
  dpr?: number;
}

export const DEFAULT_COLORS = ['#111113', '#1c090b', '#4d080a', '#830000', '#bc0202'];
export const MAX_COLORS = 8;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const DEFAULTS: Omit<GrainientSettings, 'type'> & { type: GrainientType } = {
  colors: DEFAULT_COLORS,
  type: 'linear',
  angle: 55,
  bands: 1,
  speed: 1,
  flow: 0.8,
  scale: 1,
  softness: 1,
  silk: 0.35,
  grainAmount: 0.08,
  grainSize: 1.2,
  grainAnimated: true,
  contrast: 1,
  saturation: 1,
  variation: 0,
  interactive: true,
  stir: 1,
  clickSwirl: true,
  intro: true,
  lightMode: false,
  dpr: undefined,
};

function normalizePalette(colors: string[] | undefined): string[] {
  const valid = Array.isArray(colors) && colors.length > 0;
  const palette = (valid ? colors : DEFAULT_COLORS).slice(0, MAX_COLORS);
  return palette.length > 1 ? palette : [palette[0], palette[0]];
}

export function resolveGrainientSettings(raw: GrainientProps): GrainientSettings {
  const m = Object.assign({}, DEFAULTS, raw);
  return {
    ...m,
    colors: normalizePalette(raw.colors),
    type: m.type === 'radial' ? 1 : 0,
    bands: clamp(m.bands, 1, 8),
    speed: Math.max(0, m.speed),
    flow: clamp(m.flow, 0, 3),
    scale: clamp(m.scale, 0.25, 3),
    softness: clamp(m.softness, 0, 1),
    silk: clamp(m.silk, 0, 1),
    grainAmount: clamp(m.grainAmount, 0, 0.5),
    grainSize: clamp(m.grainSize, 0.5, 4),
    contrast: clamp(m.contrast, 0.2, 2),
    saturation: clamp(m.saturation, 0, 2),
    variation: Math.max(0, m.variation),
    stir: clamp(m.stir, 0, 2),
  };
}
