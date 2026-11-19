import { clamp } from '../webglUtils';

export { clamp };
export type SnowVariant = 'square' | 'round' | 'snowflake';

export interface PixelSnowProps {
  color?: string;
  variant?: SnowVariant;
  density?: number;
  speed?: number;
  wind?: number;
  sway?: number;
  flakeSize?: number;
  pixelSize?: number;
  depth?: number;
  brightness?: number;
  glow?: number;
  twinkle?: number;
  accumulate?: boolean;
  mouseInteraction?: boolean;
  intro?: boolean;
  fade?: number;
  opacity?: number;
  lightMode?: boolean;
  paused?: boolean;
  dpr?: number;
  className?: string;
}

export interface SnowSettings {
  color: string;
  variant: number;
  density: number;
  speed: number;
  wind: number;
  sway: number;
  flakeSize: number;
  pixelSize: number;
  depth: number;
  brightness: number;
  glow: number;
  twinkle: number;
  accumulate: boolean;
  mouseInteraction: boolean;
  intro: boolean;
  fade: number;
  opacity: number;
  lightMode: boolean;
  paused: boolean;
  dpr?: number;
}

export interface Flake {
  level: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  rate: number;
  sparkle: number;
  drift: number;
  alt: boolean;
  reveal: number;
  levelSize: number;
}

export const VARIANTS: SnowVariant[] = ['square', 'round', 'snowflake'];

const DEFAULTS: Omit<SnowSettings, 'variant'> & { variant: SnowVariant } = {
  color: '#ffffff',
  variant: 'snowflake',
  density: 0.5,
  speed: 1,
  wind: 0.25,
  sway: 0.5,
  flakeSize: 1,
  pixelSize: 3,
  depth: 0.6,
  brightness: 1,
  glow: 0.8,
  twinkle: 0.35,
  accumulate: false,
  mouseInteraction: true,
  intro: true,
  fade: 0,
  opacity: 1,
  lightMode: false,
  paused: false,
  dpr: undefined,
};

export function resolveSnowSettings(raw: PixelSnowProps): SnowSettings {
  const m = Object.assign({}, DEFAULTS, raw);
  return {
    ...m,
    color: String(m.color),
    variant: Math.max(0, VARIANTS.indexOf(m.variant)),
    density: clamp(m.density, 0, 1),
    wind: clamp(m.wind, -2, 2),
    sway: Math.max(0, m.sway),
    flakeSize: clamp(m.flakeSize, 0, 2),
    pixelSize: Math.round(clamp(m.pixelSize, 1, 12)),
    depth: clamp(m.depth, 0, 1),
    brightness: Math.max(0, m.brightness),
    glow: Math.max(0, m.glow),
    twinkle: clamp(m.twinkle, 0, 1),
    fade: clamp(m.fade, 0, 1),
    opacity: clamp(m.opacity, 0, 1),
  };
}
