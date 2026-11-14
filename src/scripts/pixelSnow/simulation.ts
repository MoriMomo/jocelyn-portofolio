import { LEVELS } from './shaders';
import { clamp, type Flake, type SnowSettings } from './types';

export const MAX_FLAKES = 4000;
const LEVEL_WEIGHTS = [0.46, 0.27, 0.15, 0.08, 0.04];
const LEVEL_FALL = [16, 24, 34, 48, 66];
export const LEVEL_LIGHT = [0.42, 0.58, 0.76, 0.92, 1];
export const INTRO_SECONDS = 1.4;

export interface ViewState {
  width: number;
  height: number;
  ratio: number;
  pixel: number;
  gridWidth: number;
  gridHeight: number;
}

export interface PointerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  inside: boolean;
  time: number;
}

export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickLevel(r: number, flakeSize: number): number {
  const shift = flakeSize - 1;
  const weights = LEVEL_WEIGHTS.map((weight, level) => weight * Math.pow(2.2, shift * (level - 1.5)));
  const sum = weights.reduce((a, b) => a + b, 0);
  let total = 0;
  for (let level = 0; level < LEVELS; level++) {
    total += weights[level] / sum;
    if (r <= total) return level;
  }
  return LEVELS - 1;
}

function spawnFlake(
  rng: () => number,
  view: ViewState,
  s: SnowSettings,
  fromTop: boolean,
): Flake {
  const level = pickLevel(rng(), s.flakeSize);
  return {
    level,
    x: rng() * (view.width + 40) - 20,
    y: fromTop ? -10 - rng() * 30 : rng() * view.height,
    vx: 0,
    vy: LEVEL_FALL[level],
    phase: rng() * Math.PI * 2,
    rate: 0.6 + rng() * 0.9,
    sparkle: rng() * 100,
    drift: 0.7 + rng() * 0.6,
    alt: rng() < 0.5,
    reveal: fromTop ? -1 : rng(),
    levelSize: s.flakeSize,
  };
}

export function populateFlakes(
  flakes: Flake[],
  rng: () => number,
  view: ViewState,
  s: SnowSettings,
): void {
  const target = Math.round(clamp((view.width * view.height * s.density) / 1100, 0, MAX_FLAKES));
  while (flakes.length < target) {
    flakes.push(spawnFlake(rng, view, s, false));
  }
  if (flakes.length > target) flakes.length = target;
}

function applyPointerPush(
  flake: Flake,
  pointer: PointerState,
  push: number,
  dt: number,
): void {
  const radius = 120;
  const dx = flake.x - pointer.x;
  const dy = flake.y - pointer.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= radius || distance <= 0.001) return;

  const near = 1 - distance / radius;
  const repel = near * near * near * push * 1500 * dt;
  const carry = near * near * push * dt * 5;
  flake.vx += (dx / distance) * repel + pointer.vx * carry;
  flake.vy += (dy / distance) * repel + pointer.vy * carry;
}

function addPileColumn(pile: Float32Array, column: number, level: number): void {
  for (let k = -level; k <= level; k++) {
    const idx = column + k;
    if (idx < 0 || idx >= pile.length) continue;
    pile[idx] += (0.35 + level * 0.15) * (1 - Math.abs(k) / (level + 1));
  }
}

function trySettleOnPile(
  flake: Flake,
  pile: Float32Array,
  view: ViewState,
  rng: () => number,
  s: SnowSettings,
): boolean {
  const column = Math.floor(flake.x / view.pixel);
  const pileHeight = pile[column] ?? 0;
  if (pileHeight <= 0.5) return false;

  const surface = view.height - pileHeight * view.pixel;
  if (flake.y < surface) return false;

  addPileColumn(pile, column, flake.level);
  Object.assign(flake, spawnFlake(rng, view, s, true));
  return true;
}

function wrapY(flake: Flake, view: ViewState, rng: () => number, s: SnowSettings, margin: number): void {
  const outY = s.speed >= 0 ? flake.y > view.height + margin : flake.y < -margin;
  if (!outY) return;
  Object.assign(flake, spawnFlake(rng, view, s, true));
  if (s.speed < 0) flake.y = view.height + 10 + rng() * 30;
}

function wrapX(flake: Flake, width: number, margin: number): void {
  const span = width + margin * 2;
  if (flake.x < -margin) flake.x += span;
  else if (flake.x > width + margin) flake.x -= span;
}

function syncFlakeSize(flake: Flake, rng: () => number, flakeSize: number): void {
  if (flake.levelSize === flakeSize) return;
  flake.level = pickLevel(rng(), flakeSize);
  flake.levelSize = flakeSize;
}

function updateFlakeMotion(
  flake: Flake,
  pointer: PointerState,
  s: SnowSettings,
  time: number,
  push: number,
  dt: number,
  ease: number,
): void {
  const level = flake.level;
  const parallax = 1 - s.depth * (1 - (level + 1) / LEVELS) * 0.75;
  const swing = Math.sin(time * flake.rate + flake.phase) * s.sway * (6 + level * 7);
  const targetX = (s.wind * 46 * parallax + swing) * flake.drift;
  const targetY = LEVEL_FALL[level] * parallax * s.speed * flake.drift;

  flake.vx += (targetX - flake.vx) * ease;
  flake.vy += (targetY - flake.vy) * ease;
  if (push > 0.001 && pointer.inside) applyPointerPush(flake, pointer, push, dt);

  flake.x += flake.vx * dt;
  flake.y += flake.vy * dt;
}

function stepFlake(
  flake: Flake,
  pile: Float32Array,
  view: ViewState,
  pointer: PointerState,
  rng: () => number,
  s: SnowSettings,
  time: number,
  push: number,
  dt: number,
  ease: number,
  settle: boolean,
): void {
  syncFlakeSize(flake, rng, s.flakeSize);
  updateFlakeMotion(flake, pointer, s, time, push, dt, ease);

  if (settle && trySettleOnPile(flake, pile, view, rng, s)) return;
  wrapY(flake, view, rng, s, 24);
  wrapX(flake, view.width, 24);
}

export function simulateFlakes(
  flakes: Flake[],
  pile: Float32Array,
  view: ViewState,
  pointer: PointerState,
  rng: () => number,
  s: SnowSettings,
  time: number,
  push: number,
  dt: number,
): void {
  const settle = s.accumulate && s.speed > 0 && pile.length > 0;
  const ease = 1 - Math.exp(-dt * 2.2);
  for (const flake of flakes) {
    stepFlake(flake, pile, view, pointer, rng, s, time, push, dt, ease, settle);
  }
}

function growPile(pile: Float32Array, cap: number, s: SnowSettings, dt: number): void {
  const grow = (0.25 + s.density * 0.9) * dt * Math.min(1, s.speed);
  for (let i = 0; i < pile.length; i++) {
    const dune = 0.55 + 0.45 * Math.sin(i * 0.045 + Math.sin(i * 0.013) * 2.1) * Math.sin(i * 0.021 + 1.3);
    if (pile[i] < cap * dune) pile[i] += grow * (0.6 + 0.8 * dune);
  }
}

function smoothPilePass(pile: Float32Array, forward: boolean): void {
  for (let k = 0; k < pile.length - 1; k++) {
    const i = forward ? k : pile.length - 2 - k;
    const diff = pile[i] - pile[i + 1];
    if (Math.abs(diff) <= 1.2) continue;
    const move = (Math.abs(diff) - 1.2) * 0.5 * Math.sign(diff);
    pile[i] -= move;
    pile[i + 1] += move;
  }
}

function decayPile(pile: Float32Array, cap: number, accumulating: boolean, dt: number): void {
  for (let i = 0; i < pile.length; i++) {
    const excess = Math.max(0, pile[i] - cap);
    const rate = accumulating ? excess * 0.8 : 2 + pile[i] * 0.6;
    pile[i] = Math.max(0, pile[i] - rate * dt);
  }
}

export function settlePile(
  pile: Float32Array,
  gridHeight: number,
  s: SnowSettings,
  dt: number,
): void {
  if (!pile.length) return;
  const cap = Math.max(4, gridHeight * 0.08);
  const accumulating = s.accumulate && s.speed > 0;
  if (accumulating) growPile(pile, cap, s, dt);

  smoothPilePass(pile, true);
  smoothPilePass(pile, false);
  decayPile(pile, cap, accumulating, dt);
}
