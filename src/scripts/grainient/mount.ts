import {
  COMPOSITE_SHADER,
  FIELD_SHADER,
  linkGrainientProgram,
  toLab,
  type LinkedGrainientProgram,
} from './shaders';
import {
  MAX_COLORS,
  clamp,
  resolveGrainientSettings,
  type GrainientProps,
  type GrainientSettings,
} from './types';

const MAX_STIRS = 24;
const MAX_TWIRLS = 4;
const STIR_LIFE = 1.3;
const STIR_STEP = 0.06;
const TWIRL_LIFE = 2.6;
const INTRO_SECONDS = 1.6;
const LIFT = 0.2;

interface StirSample {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  grow: number;
  done: boolean;
}

interface SpinSample {
  x: number;
  y: number;
  age: number;
  direction: number;
}

interface PointerState {
  x: number;
  y: number;
  sx: number;
  sy: number;
  vx: number;
  inside: boolean;
  fresh: boolean;
}

interface GrainientGl {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  field: LinkedGrainientProgram;
  composite: LinkedGrainientProgram;
  vao: WebGLVertexArrayObject | null;
  target: WebGLTexture | null;
  buffer: WebGLFramebuffer | null;
}

function parseSettings(container: HTMLElement): GrainientSettings {
  try {
    return resolveGrainientSettings(JSON.parse(container.dataset.grainient ?? '{}') as GrainientProps);
  } catch {
    return resolveGrainientSettings({});
  }
}

function createColorParser(): (value: string) => [number, number, number] {
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const cache = new Map<string, [number, number, number]>();
  return (value: string) => {
    const key = String(value);
    const cached = cache.get(key);
    if (cached) return cached;
    let rgb: [number, number, number] = [0, 0, 0];
    if (probe) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = '#000000';
      probe.fillStyle = key;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
      rgb = [r / 255, g / 255, b / 255];
    }
    cache.set(key, rgb);
    return rgb;
  };
}

function createLinearTarget(gl: WebGL2RenderingContext): WebGLTexture | null {
  const target = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, target);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return target;
}

function linkGrainientPrograms(
  gl: WebGL2RenderingContext,
): { field: LinkedGrainientProgram; composite: LinkedGrainientProgram } | null {
  const field = linkGrainientProgram(gl, FIELD_SHADER);
  const composite = linkGrainientProgram(gl, COMPOSITE_SHADER);
  if (!field || !composite) return null;
  return { field, composite };
}

function createGrainientGl(container: HTMLElement): GrainientGl | null {
  const canvas = container.querySelector<HTMLCanvasElement>('.grainient-canvas');
  const gl = canvas?.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false });
  if (!canvas || !gl) return null;

  const programs = linkGrainientPrograms(gl);
  if (!programs) return null;

  return {
    canvas,
    gl,
    ...programs,
    vao: gl.createVertexArray(),
    target: createLinearTarget(gl),
    buffer: gl.createFramebuffer(),
  };
}

function buildLightRamp(labs: Array<[number, number, number]>, ramp: Float32Array): void {
  const blank = labs.map(([L]) => Math.abs(L - labs[0][0]) < 0.1);
  const tints = labs.filter((_, i) => !blank[i]).reverse();
  labs.forEach((_, i) => {
    const [L, a, b] = blank[i] ? [1, 0, 0] : tints.shift()!;
    ramp.set([L + (1 - L) * LIFT, a * (1 - LIFT), b * (1 - LIFT)], i * 3);
  });
}

function syncRampPalette(
  s: GrainientSettings,
  parseColor: (v: string) => [number, number, number],
  ramp: Float32Array,
): void {
  const labs = s.colors.map((c) => toLab(parseColor(c)));
  if (!s.lightMode) {
    labs.forEach((lab, i) => ramp.set(lab, i * 3));
    return;
  }
  buildLightRamp(labs, ramp);
}

function addTrailSample(
  trail: StirSample[],
  pointer: PointerState,
  aspect: number,
  vy: number,
  dt: number,
): void {
  const head = trail[0];
  if (!head || head.done) {
    trail.unshift({ x: 0, y: 0, vx: 0, vy: 0, age: 0, grow: 0, done: false });
    if (trail.length > MAX_STIRS) trail.pop();
  }
  const live = trail[0];
  live.x = (pointer.sx - 0.5) * aspect;
  live.y = pointer.sy - 0.5;
  live.vx = pointer.vx;
  live.vy = vy;
  live.grow = Math.min(1, live.grow + dt / STIR_STEP);
  live.done = live.grow >= 1;
}

function packStirs(trail: StirSample[], stirs: Float32Array, stirWeights: Float32Array, stirAmount: number): void {
  for (let i = 0; i < MAX_STIRS; i++) {
    const sample = trail[i];
    if (!sample) {
      stirWeights[i] = 0;
      continue;
    }
    const fade = 1 - sample.age / STIR_LIFE;
    const cap = Math.min(1, 2.2 / Math.max(Math.hypot(sample.vx, sample.vy), 0.001));
    stirs.set([sample.x, sample.y, sample.vx * cap, sample.vy * cap], i * 4);
    stirWeights[i] = fade * fade * sample.grow * stirAmount * 0.05;
  }
}

function packTwirls(spins: SpinSample[], twirls: Float32Array): void {
  for (let i = 0; i < MAX_TWIRLS; i++) {
    const spin = spins[i];
    if (!spin) {
      twirls[i * 4 + 2] = 0;
      continue;
    }
    const k = spin.age / TWIRL_LIFE;
    const envelope = Math.min(1, spin.age / 0.18) * (1 - k) * (1 - k);
    const radius = 0.16 + 0.1 * Math.min(1, spin.age / 0.5);
    twirls.set([spin.x, spin.y, spin.direction * 2.4 * envelope, radius], i * 4);
  }
}

function canStir(s: GrainientSettings, pointer: PointerState, speed: number, reduce: boolean): boolean {
  if (!s.interactive || reduce) return false;
  return pointer.inside && speed > 0.02;
}

function expireOldTrails(trail: StirSample[], dt: number): void {
  trail.forEach((sample) => { if (sample.done) sample.age += dt; });
  while (trail.length && trail[trail.length - 1].age > STIR_LIFE) trail.pop();
}

function stepTrailSamples(
  trail: StirSample[],
  pointer: PointerState,
  s: GrainientSettings,
  aspect: number,
  vy: number,
  dt: number,
  reduce: boolean,
): void {
  expireOldTrails(trail, dt);
  if (canStir(s, pointer, Math.hypot(pointer.vx, vy), reduce)) {
    addTrailSample(trail, pointer, aspect, vy, dt);
  } else if (trail[0]) {
    trail[0].done = true;
  }
}

function stepSpinSamples(spins: SpinSample[], dt: number): void {
  spins.forEach((spin) => { spin.age += dt; });
  while (spins.length && spins[spins.length - 1].age > TWIRL_LIFE) spins.pop();
}

function updateTouches(
  trail: StirSample[],
  spins: SpinSample[],
  pointer: PointerState,
  stirs: Float32Array,
  stirWeights: Float32Array,
  twirls: Float32Array,
  s: GrainientSettings,
  dt: number,
  aspect: number,
  reduce: boolean,
): void {
  const follow = 1 - Math.exp(-dt / 0.06);
  const px = pointer.sx;
  const py = pointer.sy;
  pointer.sx += (pointer.x - pointer.sx) * follow;
  pointer.sy += (pointer.y - pointer.sy) * follow;
  pointer.vx = ((pointer.sx - px) / dt) * aspect;
  const vy = (pointer.sy - py) / dt;

  stepTrailSamples(trail, pointer, s, aspect, vy, dt, reduce);
  packStirs(trail, stirs, stirWeights, s.stir);
  stepSpinSamples(spins, dt);
  packTwirls(spins, twirls);
}

function isUnitInside(x: number, y: number): boolean {
  return x >= 0 && x <= 1 && y >= 0 && y <= 1;
}

function locatePointer(pointer: PointerState, rect: DOMRect, clientX: number, clientY: number): void {
  const x = (clientX - rect.left) / Math.max(1, rect.width);
  const y = 1 - (clientY - rect.top) / Math.max(1, rect.height);
  pointer.inside = isUnitInside(x, y);
  pointer.x = x;
  pointer.y = y;
  if (pointer.fresh || !pointer.inside) {
    pointer.sx = x;
    pointer.sy = y;
    pointer.fresh = false;
  }
}

function drawFieldPass(
  ctx: GrainientGl,
  s: GrainientSettings,
  aspect: number,
  time: number,
  introClock: number,
  ramp: Float32Array,
  stirs: Float32Array,
  stirWeights: Float32Array,
  twirls: Float32Array,
  fieldSize: { width: number; height: number },
): void {
  const { gl, field, vao, buffer } = ctx;
  const fu = field.uniforms;
  const radians = (s.angle * Math.PI) / 180;
  gl.bindVertexArray(vao);
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
  gl.viewport(0, 0, fieldSize.width, fieldSize.height);
  gl.useProgram(field.program);
  gl.uniform1f(fu.uAspect, aspect);
  gl.uniform1f(fu.uTime, time);
  gl.uniform3fv(fu.uRamp, ramp);
  gl.uniform1i(fu.uCount, s.colors.length);
  gl.uniform1i(fu.uType, s.type);
  gl.uniform2f(fu.uDir, Math.sin(radians), Math.cos(radians));
  gl.uniform1f(fu.uExtent, aspect * Math.abs(Math.sin(radians)) + Math.abs(Math.cos(radians)));
  gl.uniform1f(fu.uBands, s.bands);
  gl.uniform1f(fu.uSoftness, s.softness);
  gl.uniform1f(fu.uFlow, s.flow);
  gl.uniform1f(fu.uScale, s.scale);
  gl.uniform1f(fu.uSilk, s.silk);
  gl.uniform4fv(fu.uStir, stirs);
  gl.uniform1fv(fu.uStirWeight, stirWeights);
  gl.uniform4fv(fu.uTwirl, twirls);
  gl.uniform2f(fu.uSeed, s.variation * 3.17, s.variation * 1.91);
  gl.uniform1f(fu.uContrast, s.contrast);
  gl.uniform1f(fu.uSaturation, s.saturation);
  gl.uniform1f(fu.uSettle, introClock * introClock * (3 - 2 * introClock));
  gl.uniform1f(fu.uReveal, introClock);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function drawCompositePass(ctx: GrainientGl, s: GrainientSettings, ratio: number, frameSeed: number): void {
  const { gl, canvas, composite, target } = ctx;
  const cu = composite.uniforms;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(composite.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, target);
  gl.uniform1i(cu.uField, 0);
  gl.uniform1f(cu.uGrain, s.grainAmount);
  gl.uniform1f(cu.uGrainSize, s.grainSize * ratio);
  gl.uniform1f(cu.uFrame, frameSeed);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function cleanupGrainientGl(ctx: GrainientGl): void {
  const { gl, target, buffer, vao, field, composite, canvas } = ctx;
  gl.deleteTexture(target);
  gl.deleteFramebuffer(buffer);
  gl.deleteVertexArray(vao);
  gl.deleteProgram(field.program);
  gl.deleteProgram(composite.program);
  if (!canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext();
}

function canSwirl(pointer: PointerState, s: GrainientSettings, reduce: boolean): boolean {
  if (!pointer.inside || !s.clickSwirl) return false;
  return !reduce;
}

function pushSpinIfActive(
  spins: SpinSample[],
  pointer: PointerState,
  view: { width: number; height: number },
  s: GrainientSettings,
  reduce: boolean,
): boolean {
  if (!canSwirl(pointer, s, reduce)) return false;
  spins.unshift({
    x: (pointer.x - 0.5) * (view.width / view.height),
    y: pointer.y - 0.5,
    age: 0,
    direction: pointer.vx < 0 ? 1 : -1,
  });
  if (spins.length > MAX_TWIRLS) spins.pop();
  return true;
}

function setupGrainientListeners(
  container: HTMLElement,
  pointer: PointerState,
  spins: SpinSample[],
  trail: StirSample[],
  view: { width: number; height: number },
  s: GrainientSettings,
  reduce: boolean,
  resize: () => void,
  wake: () => void,
  onResetClock: () => void,
  setVisible: (v: boolean) => void,
): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const intersection = new IntersectionObserver((entries) => {
    const isVisible = entries.some((entry) => entry.isIntersecting);
    setVisible(isVisible);
    if (isVisible) onResetClock();
  });
  intersection.observe(container);

  window.addEventListener(
    'pointermove',
    (event) => {
      locatePointer(pointer, container.getBoundingClientRect(), event.clientX, event.clientY);
      if (pointer.inside || trail.length) wake();
    },
    { passive: true, signal },
  );
  window.addEventListener(
    'pointerdown',
    (event) => {
      locatePointer(pointer, container.getBoundingClientRect(), event.clientX, event.clientY);
      if (pushSpinIfActive(spins, pointer, view, s, reduce)) wake();
    },
    { passive: true, signal },
  );
  document.documentElement.addEventListener('pointerleave', () => { pointer.inside = false; }, { signal });
  document.addEventListener('visibilitychange', onResetClock, { signal });

  return () => {
    controller.abort();
    resizeObserver.disconnect();
    intersection.disconnect();
  };
}

function hasActiveAnimation(s: GrainientSettings, reduce: boolean): boolean {
  if (reduce) return false;
  return s.speed > 0 || s.grainAnimated;
}

function isGrainientBusy(
  s: GrainientSettings,
  reduce: boolean,
  introClock: number,
  trailLen: number,
  spinsLen: number,
): boolean {
  if (hasActiveAnimation(s, reduce) || introClock < 1) return true;
  return trailLen > 0 || spinsLen > 0;
}

function resizeFieldTarget(
  ctx: GrainientGl,
  fieldSize: { width: number; height: number },
  width: number,
  height: number,
): void {
  if (width === fieldSize.width && height === fieldSize.height) return;
  fieldSize.width = width;
  fieldSize.height = height;
  ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, ctx.target);
  ctx.gl.texImage2D(ctx.gl.TEXTURE_2D, 0, ctx.gl.RGBA8, width, height, 0, ctx.gl.RGBA, ctx.gl.UNSIGNED_BYTE, null);
  ctx.gl.bindFramebuffer(ctx.gl.FRAMEBUFFER, ctx.buffer);
  ctx.gl.framebufferTexture2D(ctx.gl.FRAMEBUFFER, ctx.gl.COLOR_ATTACHMENT0, ctx.gl.TEXTURE_2D, ctx.target, 0);
  ctx.gl.bindFramebuffer(ctx.gl.FRAMEBUFFER, null);
}

function isHiddenOrOffscreen(visible: boolean): boolean {
  if (!visible) return true;
  return document.hidden;
}

function computeDt(last: number, now: number): number {
  return last ? clamp((now - last) / 1000, 0.001, 0.05) : 1 / 60;
}

function getReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function mountGrainient(container: HTMLElement): () => void {
  const ctx = createGrainientGl(container);
  if (!ctx) return () => {};

  const s = parseSettings(container);
  const parseColor = createColorParser();
  const reduce = getReducedMotion();
  const view = { width: 1, height: 1, ratio: 1 };
  const fieldSize = { width: 0, height: 0 };
  const ramp = new Float32Array(MAX_COLORS * 3);
  const stirs = new Float32Array(MAX_STIRS * 4);
  const stirWeights = new Float32Array(MAX_STIRS);
  const twirls = new Float32Array(MAX_TWIRLS * 4);
  const trail: StirSample[] = [];
  const spins: SpinSample[] = [];
  const pointer: PointerState = { x: 0.5, y: 0.5, sx: 0.5, sy: 0.5, vx: 0, inside: false, fresh: true };
  let time = 0;
  let introClock = s.intro && !reduce ? 0 : 1;
  let frameSeed = 0;
  let grainClock = 0;
  let raf = 0;
  let last = 0;
  let visible = true;

  syncRampPalette(s, parseColor, ramp);

  const draw = () => {
    const aspect = view.width / view.height;
    drawFieldPass(ctx, s, aspect, time, introClock, ramp, stirs, stirWeights, twirls, fieldSize);
    drawCompositePass(ctx, s, view.ratio, frameSeed);
  };

  const advanceGrainSeed = (dt: number) => {
    grainClock += dt;
    if (!s.grainAnimated || reduce || grainClock <= 1 / 24) return;
    grainClock = 0;
    frameSeed = (frameSeed + 1) % 97;
  };

  const frame = (now: number) => {
    raf = 0;
    if (isHiddenOrOffscreen(visible)) return;
    const dt = computeDt(last, now);
    last = now;
    if (!reduce) time += dt * s.speed * 0.16;
    introClock = Math.min(1, introClock + dt / INTRO_SECONDS);
    advanceGrainSeed(dt);
    updateTouches(trail, spins, pointer, stirs, stirWeights, twirls, s, dt, view.width / view.height, reduce);
    draw();
    if (isGrainientBusy(s, reduce, introClock, trail.length, spins.length)) raf = requestAnimationFrame(frame);
    else last = 0;
  };

  const wake = () => {
    if (!raf && !isHiddenOrOffscreen(visible)) raf = requestAnimationFrame(frame);
  };

  const resize = () => {
    view.width = Math.max(1, container.clientWidth);
    view.height = Math.max(1, container.clientHeight);
    view.ratio = Math.min(s.dpr || window.devicePixelRatio || 1, 2);
    ctx.canvas.width = Math.max(1, Math.round(view.width * view.ratio));
    ctx.canvas.height = Math.max(1, Math.round(view.height * view.ratio));
    resizeFieldTarget(ctx, fieldSize, Math.max(1, Math.round(ctx.canvas.width / 2)), Math.max(1, Math.round(ctx.canvas.height / 2)));
    draw();
    wake();
  };

  const unbind = setupGrainientListeners(
    container,
    pointer,
    spins,
    trail,
    view,
    s,
    reduce,
    resize,
    wake,
    () => { last = 0; wake(); },
    (v) => { visible = v; },
  );
  resize();

  return () => {
    cancelAnimationFrame(raf);
    unbind();
    cleanupGrainientGl(ctx);
  };
}
