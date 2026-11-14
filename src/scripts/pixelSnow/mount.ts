import {
  COMPOSITE_FRAGMENT,
  DOWN_FRAGMENT,
  FLAKE_FRAGMENT,
  FLAKE_VERTEX,
  PILE_FRAGMENT,
  QUAD_VERTEX,
  SLOTS,
  SPRITES,
  UP_FRAGMENT,
  buildAtlas,
  linkProgram,
  type LinkedProgram,
} from './shaders';
import {
  INTRO_SECONDS,
  LEVEL_LIGHT,
  MAX_FLAKES,
  populateFlakes,
  seededRng,
  settlePile,
  simulateFlakes,
  type PointerState,
  type ViewState,
} from './simulation';
import { VARIANTS, clamp, resolveSnowSettings, type Flake, type PixelSnowProps, type SnowSettings } from './types';

interface RenderTarget {
  texture: WebGLTexture | null;
  framebuffer: WebGLFramebuffer | null;
  width: number;
  height: number;
}

interface GlPrograms {
  flakeProg: LinkedProgram;
  pileProg: LinkedProgram;
  downProg: LinkedProgram;
  upProg: LinkedProgram;
  compositeProg: LinkedProgram;
}

interface GlResources extends GlPrograms {
  atlasTexture: WebGLTexture | null;
  pileTexture: WebGLTexture | null;
  quadBuffer: WebGLBuffer | null;
  cornerBuffer: WebGLBuffer | null;
  instanceBuffer: WebGLBuffer | null;
  quadVao: WebGLVertexArrayObject | null;
  flakeVao: WebGLVertexArrayObject | null;
  snow: RenderTarget;
  down: RenderTarget[];
  up: RenderTarget[];
}

function createRenderTarget(gl: WebGL2RenderingContext, filter: number): RenderTarget {
  const target: RenderTarget = {
    texture: gl.createTexture(),
    framebuffer: gl.createFramebuffer(),
    width: 0,
    height: 0,
  };
  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return target;
}

function sizeRenderTarget(gl: WebGL2RenderingContext, target: RenderTarget, width: number, height: number): void {
  if (target.width === width && target.height === height) return;
  target.width = width;
  target.height = height;
  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
}

function bindTexture(
  gl: WebGL2RenderingContext,
  entry: LinkedProgram,
  name: string,
  unit: number,
  texture: WebGLTexture | null,
): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(entry.uniforms[name], unit);
}

function drawQuadPass(
  gl: WebGL2RenderingContext,
  entry: LinkedProgram,
  target: RenderTarget | null,
  width: number,
  height: number,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
  gl.viewport(0, 0, width, height);
  gl.useProgram(entry.program);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function createColorResolver(): (value: string) => [number, number, number] {
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const cache = new Map<string, [number, number, number]>();
  return (value: string) => {
    const cached = cache.get(value);
    if (cached) return cached;
    let rgb: [number, number, number] = [1, 1, 1];
    if (probe) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = '#ffffff';
      probe.fillStyle = value;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
      rgb = [r / 255, g / 255, b / 255];
    }
    cache.set(value, rgb);
    return rgb;
  };
}

function parseSnowSettings(container: HTMLElement): SnowSettings {
  try {
    return resolveSnowSettings(JSON.parse(container.dataset.pixelSnow ?? '{}') as PixelSnowProps);
  } catch {
    return resolveSnowSettings({});
  }
}

function createTexture(gl: WebGL2RenderingContext, filter: number): WebGLTexture | null {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function linkAllPrograms(gl: WebGL2RenderingContext): GlPrograms | null {
  const specs: Array<[keyof GlPrograms, string, string, string[]]> = [
    ['flakeProg', FLAKE_VERTEX, FLAKE_FRAGMENT, ['aCorner', 'aFlake']],
    ['pileProg', QUAD_VERTEX, PILE_FRAGMENT, ['aPosition']],
    ['downProg', QUAD_VERTEX, DOWN_FRAGMENT, ['aPosition']],
    ['upProg', QUAD_VERTEX, UP_FRAGMENT, ['aPosition']],
    ['compositeProg', QUAD_VERTEX, COMPOSITE_FRAGMENT, ['aPosition']],
  ];
  const out: Partial<GlPrograms> = {};
  for (const [key, vs, fs, attrs] of specs) {
    const prog = linkProgram(gl, vs, fs, attrs);
    if (!prog) return null;
    out[key] = prog;
  }
  return out as GlPrograms;
}

function createQuadVao(gl: WebGL2RenderingContext): { quadBuffer: WebGLBuffer | null; quadVao: WebGLVertexArrayObject | null } {
  const quadBuffer = gl.createBuffer();
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  return { quadBuffer, quadVao };
}

function createFlakeVao(gl: WebGL2RenderingContext): {
  cornerBuffer: WebGLBuffer | null;
  instanceBuffer: WebGLBuffer | null;
  flakeVao: WebGLVertexArrayObject | null;
} {
  const cornerBuffer = gl.createBuffer();
  const instanceBuffer = gl.createBuffer();
  const flakeVao = gl.createVertexArray();
  gl.bindVertexArray(flakeVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null);
  return { cornerBuffer, instanceBuffer, flakeVao };
}

function initGlResources(gl: WebGL2RenderingContext): GlResources | null {
  const programs = linkAllPrograms(gl);
  if (!programs) return null;

  const atlas = buildAtlas();
  const atlasTexture = createTexture(gl, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, atlas.width, atlas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlas.data);

  return {
    ...programs,
    atlasTexture,
    pileTexture: createTexture(gl, gl.NEAREST),
    ...createQuadVao(gl),
    ...createFlakeVao(gl),
    snow: createRenderTarget(gl, gl.NEAREST),
    down: [createRenderTarget(gl, gl.LINEAR), createRenderTarget(gl, gl.LINEAR), createRenderTarget(gl, gl.LINEAR)],
    up: [createRenderTarget(gl, gl.LINEAR), createRenderTarget(gl, gl.LINEAR)],
  };
}

function computeFlakeReveal(flake: Flake, height: number, intro: number): number {
  if (flake.reveal < 0 || intro >= 1) return 1;
  return clamp((intro * 1.75 - flake.y / height - flake.reveal * 0.25) / 0.35, 0, 1);
}

function writeFlakeInstance(
  instances: Float32Array,
  index: number,
  flake: Flake,
  view: ViewState,
  s: SnowSettings,
  time: number,
  reveal: number,
): void {
  const level = flake.level;
  const depthLight = 1 - s.depth * (1 - LEVEL_LIGHT[level]);
  const spark = Math.pow(Math.max(0, Math.sin(time * 0.9 + flake.sparkle)), 60) * s.twinkle;
  const slot = level >= 2 && flake.alt ? level + 3 : level;
  const o = index * 4;
  instances[o] = flake.x / view.pixel;
  instances[o + 1] = flake.y / view.pixel;
  instances[o + 2] = s.variant * SLOTS + slot;
  instances[o + 3] = Math.min(1, depthLight * (0.85 + spark * 0.6)) * reveal * reveal;
}

function packInstances(
  flakes: Flake[],
  instances: Float32Array,
  view: ViewState,
  s: SnowSettings,
  time: number,
  intro: number,
): number {
  let count = 0;
  for (const flake of flakes) {
    const reveal = computeFlakeReveal(flake, view.height, intro);
    if (reveal <= 0) continue;
    writeFlakeInstance(instances, count, flake, view, s, time, reveal);
    count++;
  }
  return count;
}

function renderFlakesPass(
  gl: WebGL2RenderingContext,
  res: GlResources,
  instances: Float32Array,
  count: number,
  s: SnowSettings,
): void {
  if (count <= 0) return;
  const sizes = SPRITES[VARIANTS[s.variant]].map((rows) => rows.length);
  gl.useProgram(res.flakeProg.program);
  gl.uniform2f(res.flakeProg.uniforms.uGrid, res.snow.width, res.snow.height);
  gl.uniform4f(res.flakeProg.uniforms.uSizes, sizes[1], sizes[2], sizes[3], 0);
  gl.uniform1f(res.flakeProg.uniforms.uLargest, sizes[4]);
  bindTexture(gl, res.flakeProg, 'uAtlas', 0, res.atlasTexture);
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.MAX);
  gl.bindVertexArray(res.flakeVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, res.instanceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, instances.subarray(0, count * 4), gl.DYNAMIC_DRAW);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  gl.blendEquation(gl.FUNC_ADD);
  gl.disable(gl.BLEND);
}

function renderDownPasses(gl: WebGL2RenderingContext, res: GlResources): void {
  let source = res.snow;
  for (const target of res.down) {
    sizeRenderTarget(gl, target, Math.max(1, Math.ceil(source.width / 2)), Math.max(1, Math.ceil(source.height / 2)));
    gl.useProgram(res.downProg.program);
    gl.uniform2f(res.downProg.uniforms.uTexel, 1 / source.width, 1 / source.height);
    gl.uniform2f(res.downProg.uniforms.uTarget, target.width, target.height);
    bindTexture(gl, res.downProg, 'uSource', 0, source.texture);
    drawQuadPass(gl, res.downProg, target, target.width, target.height);
    source = target;
  }
}

function renderUpPasses(gl: WebGL2RenderingContext, res: GlResources): void {
  for (let level = res.up.length - 1; level >= 0; level--) {
    const from = level === res.up.length - 1 ? res.down[res.down.length - 1] : res.up[level + 1];
    const target = res.up[level];
    sizeRenderTarget(gl, target, res.down[level].width, res.down[level].height);
    gl.useProgram(res.upProg.program);
    gl.uniform2f(res.upProg.uniforms.uTexel, 1 / from.width, 1 / from.height);
    gl.uniform2f(res.upProg.uniforms.uTarget, target.width, target.height);
    bindTexture(gl, res.upProg, 'uSource', 0, from.texture);
    bindTexture(gl, res.upProg, 'uBase', 1, res.down[level].texture);
    drawQuadPass(gl, res.upProg, target, target.width, target.height);
  }
}

function renderGlowAndComposite(
  gl: WebGL2RenderingContext,
  res: GlResources,
  canvas: HTMLCanvasElement,
  view: ViewState,
  s: SnowSettings,
  rgb: [number, number, number],
): void {
  gl.bindVertexArray(res.quadVao);
  renderDownPasses(gl, res);
  renderUpPasses(gl, res);

  const c = res.compositeProg.uniforms;
  gl.useProgram(res.compositeProg.program);
  gl.uniform2f(c.uResolution, canvas.width, canvas.height);
  gl.uniform2f(c.uGrid, res.snow.width, res.snow.height);
  gl.uniform1f(c.uPixel, view.pixel * view.ratio);
  gl.uniform3fv(c.uColor, rgb);
  gl.uniform1f(c.uBrightness, s.brightness);
  gl.uniform1f(c.uGlow, s.glow);
  gl.uniform1f(c.uFade, s.fade);
  gl.uniform1f(c.uOpacity, s.opacity);
  gl.uniform1f(c.uLightMode, s.lightMode ? 1 : 0);
  bindTexture(gl, res.compositeProg, 'uSnow', 0, res.snow.texture);
  bindTexture(gl, res.compositeProg, 'uGlowMap', 1, res.up[0].texture);
  drawQuadPass(gl, res.compositeProg, null, canvas.width, canvas.height);
}

function isInsideBounds(x: number, y: number, rect: DOMRect): boolean {
  return x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
}

function updatePointerVelocity(pointer: PointerState, x: number, y: number, now: number): void {
  if (!pointer.inside || !pointer.time) return;
  const elapsed = Math.max(1, now - pointer.time) / 1000;
  pointer.vx = clamp((x - pointer.x) / elapsed, -3000, 3000);
  pointer.vy = clamp((y - pointer.y) / elapsed, -3000, 3000);
}

function updatePointerCoords(pointer: PointerState, rect: DOMRect, clientX: number, clientY: number): void {
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const now = performance.now();
  updatePointerVelocity(pointer, x, y, now);
  pointer.x = x;
  pointer.y = y;
  pointer.time = now;
  pointer.inside = isInsideBounds(x, y, rect);
}

function stepIntro(state: { intro: number }, s: SnowSettings, dt: number, reduce: boolean): void {
  if (!s.intro || reduce) {
    state.intro = 1;
    return;
  }
  state.intro = Math.min(1, state.intro + dt / INTRO_SECONDS);
}

function computePushGoal(pointer: PointerState, s: SnowSettings, reduce: boolean): number {
  if (!s.mouseInteraction || reduce) return 0;
  return pointer.inside ? 1 : 0;
}

function stepMotionState(
  state: { time: number; intro: number; push: number },
  pointer: PointerState,
  s: SnowSettings,
  dt: number,
  reduce: boolean,
): number {
  stepIntro(state, s, dt, reduce);
  const goal = computePushGoal(pointer, s, reduce);
  state.push += (goal - state.push) * (1 - Math.exp(-dt * (goal ? 6 : 3)));
  pointer.vx *= Math.exp(-dt * 6);
  pointer.vy *= Math.exp(-dt * 6);
  return goal;
}

function renderPilePass(
  gl: WebGL2RenderingContext,
  res: GlResources,
  pile: Float32Array,
  pileWidth: number,
  time: number,
  depth: number,
): number {
  if (!pile.length || !pile.some((h) => h > 0.4)) return pileWidth;
  gl.bindTexture(gl.TEXTURE_2D, res.pileTexture);
  if (pileWidth !== pile.length) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, pile.length, 1, 0, gl.RED, gl.FLOAT, pile);
  } else {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, pile.length, 1, gl.RED, gl.FLOAT, pile);
  }
  gl.useProgram(res.pileProg.program);
  bindTexture(gl, res.pileProg, 'uPile', 0, res.pileTexture);
  gl.uniform1f(res.pileProg.uniforms.uTime, time);
  gl.uniform1f(res.pileProg.uniforms.uLight, 1 - depth * 0.1);
  gl.bindVertexArray(res.quadVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return pile.length;
}

function computeFrameDt(last: number, now: number): number {
  return last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
}

function shouldKeepAnimating(moving: boolean, goal: number, push: number): boolean {
  if (moving) return true;
  return Math.abs(goal - push) > 0.001;
}

function setupSnowListeners(
  container: HTMLElement,
  pointer: PointerState,
  resize: () => void,
  wake: () => void,
  onVisible: () => void,
  setVisible: (v: boolean) => void,
): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const intersection = new IntersectionObserver((entries) => {
    const isVisible = entries.some((entry) => entry.isIntersecting);
    setVisible(isVisible);
    if (isVisible) onVisible();
  });
  intersection.observe(container);
  window.addEventListener(
    'pointermove',
    (event) => {
      updatePointerCoords(pointer, container.getBoundingClientRect(), event.clientX, event.clientY);
      wake();
    },
    { passive: true, signal },
  );
  document.documentElement.addEventListener('pointerleave', () => { pointer.inside = false; wake(); }, { signal });
  document.addEventListener('visibilitychange', onVisible, { signal });
  return () => {
    controller.abort();
    resizeObserver.disconnect();
    intersection.disconnect();
  };
}

function cleanupGlResources(gl: WebGL2RenderingContext, res: GlResources, canvas: HTMLCanvasElement): void {
  for (const target of [res.snow, ...res.down, ...res.up]) {
    gl.deleteTexture(target.texture);
    gl.deleteFramebuffer(target.framebuffer);
  }
  for (const prog of [res.flakeProg, res.pileProg, res.downProg, res.upProg, res.compositeProg]) {
    gl.deleteProgram(prog.program);
  }
  gl.deleteTexture(res.atlasTexture);
  gl.deleteTexture(res.pileTexture);
  gl.deleteBuffer(res.quadBuffer);
  gl.deleteBuffer(res.cornerBuffer);
  gl.deleteBuffer(res.instanceBuffer);
  gl.deleteVertexArray(res.quadVao);
  gl.deleteVertexArray(res.flakeVao);
  if (!canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext();
}

function getSnowContext(container: HTMLElement): {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  res: GlResources;
} | null {
  const canvas = container.querySelector<HTMLCanvasElement>('.pixel-snow-canvas');
  if (!canvas) return null;
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) return null;
  const res = initGlResources(gl);
  return res ? { canvas, gl, res } : null;
}

function getReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function advanceFlakesIfMoving(
  moving: boolean,
  state: { time: number; push: number },
  flakes: Flake[],
  pile: Float32Array,
  view: ViewState,
  pointer: PointerState,
  rng: () => number,
  s: SnowSettings,
  dt: number,
): void {
  if (!moving) return;
  state.time += dt;
  simulateFlakes(flakes, pile, view, pointer, rng, s, state.time, state.push, dt);
  settlePile(pile, view.gridHeight, s, dt);
}

export function mountPixelSnow(container: HTMLElement): () => void {
  const ctx = getSnowContext(container);
  if (!ctx) return () => {};
  const { canvas, gl, res } = ctx;

  const s = parseSnowSettings(container);
  const toRgb = createColorResolver();
  const reduce = getReducedMotion();
  const rng = seededRng(4271);
  const flakes: Flake[] = [];
  const view: ViewState = { width: 1, height: 1, ratio: 1, pixel: 1, gridWidth: 1, gridHeight: 1 };
  const pointer: PointerState = { x: 0, y: 0, vx: 0, vy: 0, inside: false, time: 0 };
  const state = { time: 0, intro: s.intro && !reduce ? 0 : 1, push: 0 };
  const instances = new Float32Array(MAX_FLAKES * 4);
  let pile = new Float32Array(0);
  let pileWidth = 0;
  let raf = 0;
  let last = 0;
  let visible = true;

  const render = () => {
    sizeRenderTarget(gl, res.snow, view.gridWidth, view.gridHeight);
    const count = packInstances(flakes, instances, view, s, state.time, state.intro);
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.snow.framebuffer);
    gl.viewport(0, 0, res.snow.width, res.snow.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    pileWidth = renderPilePass(gl, res, pile, pileWidth, state.time, s.depth);
    renderFlakesPass(gl, res, instances, count, s);
    renderGlowAndComposite(gl, res, canvas, view, s, toRgb(s.color));
  };

function isHiddenOrOffscreen(visible: boolean): boolean {
  if (!visible) return true;
  return document.hidden;
}

function isAnimationActive(paused: boolean, reduce: boolean): boolean {
  return !paused && !reduce;
}

  const frame = (now: number) => {
    raf = 0;
    if (isHiddenOrOffscreen(visible)) return;
    const dt = computeFrameDt(last, now);
    last = now;
    const moving = isAnimationActive(s.paused, reduce);
    const goal = stepMotionState(state, pointer, s, dt, reduce);
    populateFlakes(flakes, rng, view, s);
    advanceFlakesIfMoving(moving, state, flakes, pile, view, pointer, rng, s, dt);
    render();
    if (shouldKeepAnimating(moving, goal, state.push)) raf = requestAnimationFrame(frame);
    else last = 0;
  };

  const wake = () => {
    if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };

  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const ratio = Math.min(s.dpr || window.devicePixelRatio || 1, 2);
    view.width = width;
    view.height = height;
    view.ratio = ratio;
    view.pixel = Math.max(1, Math.round(s.pixelSize * ratio)) / ratio;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    view.gridWidth = Math.max(1, Math.ceil(width / view.pixel));
    view.gridHeight = Math.max(1, Math.ceil(height / view.pixel));
    if (pile.length !== view.gridWidth) pile = new Float32Array(view.gridWidth);
    populateFlakes(flakes, rng, view, s);
    render();
    wake();
  };

  const unbindListeners = setupSnowListeners(
    container,
    pointer,
    resize,
    wake,
    () => { last = 0; wake(); },
    (v) => { visible = v; },
  );
  resize();

  return () => {
    cancelAnimationFrame(raf);
    unbindListeners();
    cleanupGlResources(gl, res, canvas);
  };
}
