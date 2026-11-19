import {
  DITHER_FRAGMENT,
  WAVE_FRAGMENT,
  createDitherColorResolver,
  linkDitherProgram,
} from './shaders';
import {
  INTRO_SECONDS,
  MAX_PALETTE,
  MAX_RIPPLES,
  MAX_TRAIL,
  RIPPLE_SECONDS,
  clamp,
  resolveDitherSettings,
  type DitherProps,
} from './types';

interface TrailPoint {
  x: number;
  y: number;
  weight: number;
}

interface Ripple {
  x: number;
  y: number;
  age: number;
}

function parseDitherOptions(container: HTMLElement): DitherProps {
  try {
    const raw = container.dataset.dither;
    return raw ? (JSON.parse(raw) as DitherProps) : {};
  } catch {
    return {};
  }
}

export function mountDither(container: HTMLElement): () => void {
  const canvas = container.querySelector<HTMLCanvasElement>('.dither-canvas');
  const gl = canvas?.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!canvas || !gl) return () => {};

  const wave = linkDitherProgram(gl, WAVE_FRAGMENT);
  const dither = linkDitherProgram(gl, DITHER_FRAGMENT);
  if (!wave || !dither) return () => {};

  const s = resolveDitherSettings(parseDitherOptions(container));
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const toColor = createDitherColorResolver();

  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const field = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, field);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const framebuffer = gl.createFramebuffer();

  const view = { width: 1, height: 1, ratio: 1, cell: 1, cellCss: 1, cols: 1, rows: 1 };
  const pointer = { x: 0, y: 0, inside: false, set: false };
  const trailPoints: TrailPoint[] = [];
  const ripples: Ripple[] = [];
  const trailData = new Float32Array(MAX_TRAIL * 3);
  const rippleData = new Float32Array(MAX_RIPPLES * 4);
  const paletteData = new Float32Array(MAX_PALETTE * 3);
  const state = {
    time: 0,
    hx: 0,
    hy: 0,
    presence: 0,
    reveal: s.intro && !reduce ? 0 : 1,
  };

  let raf = 0;
  let last = 0;
  let visible = true;

  const allocate = (): void => {
    const cssPixel = view.width < 640 ? Math.max(2, s.pixelSize - 1) : s.pixelSize;
    view.cell = Math.max(1, Math.round(cssPixel * view.ratio));
    view.cellCss = view.cell / view.ratio;
    view.cols = Math.max(1, Math.ceil(canvas.width / view.cell));
    view.rows = Math.max(1, Math.ceil(canvas.height / view.cell));
    gl.bindTexture(gl.TEXTURE_2D, field);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, view.cols, view.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, field, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  const toUv = (x: number, y: number): [number, number] => {
    const aspect = view.width / view.height;
    return [(x / view.width - 0.5) * aspect, -(y / view.height - 0.5)];
  };

  const render = (): void => {
    let trailCount = 0;
    for (let i = 0; i < trailPoints.length && trailCount < MAX_TRAIL; i++) {
      const point = trailPoints[i];
      if (point.weight <= 0.01) continue;
      trailData.set([point.x, point.y, point.weight], trailCount * 3);
      trailCount++;
    }

    let rippleCount = 0;
    for (let i = ripples.length - 1; i >= 0 && rippleCount < MAX_RIPPLES; i--) {
      rippleData.set([ripples[i].x, ripples[i].y, ripples[i].age, 1], rippleCount * 4);
      rippleCount++;
    }

    const eased = s.intro && !reduce ? state.reveal * state.reveal * (3 - 2 * state.reveal) : 1;
    const vwScale = clamp(view.width / 1200, 0.58, 1.2);

    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, view.cols, view.rows);
    gl.useProgram(wave.program);
    const w = wave.uniforms;
    gl.uniform2f(w.uResolution, canvas.width / view.ratio, canvas.height / view.ratio);
    gl.uniform1f(w.uCell, view.cellCss);
    gl.uniform1f(w.uTime, state.time);
    gl.uniform1f(w.uWaveSpeed, s.waveSpeed);
    gl.uniform1f(w.uWaveFrequency, s.waveFrequency);
    gl.uniform1f(w.uWaveAmplitude, s.waveAmplitude);
    gl.uniform1f(w.uScale, s.scale * vwScale);
    gl.uniform1f(w.uContrast, s.contrast);
    gl.uniform1f(w.uBrightness, s.brightness);
    gl.uniform1i(w.uEffect, s.effect);
    gl.uniform1f(w.uRadius, s.mouseRadius * clamp(vwScale, 0.7, 1.15));
    gl.uniform1f(w.uStrength, s.mouseStrength);
    gl.uniform3fv(w.uTrail, trailData);
    gl.uniform1i(w.uTrailCount, trailCount);
    gl.uniform4fv(w.uRipples, rippleData);
    gl.uniform1i(w.uRippleCount, rippleCount);
    gl.uniform1f(w.uIntro, eased);
    gl.uniform1f(w.uReach, 0.5 * Math.hypot(view.width / view.height, 1) + 0.45);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(dither.program);
    const d = dither.uniforms;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, field);
    gl.uniform1i(d.uField, 0);
    gl.uniform2i(d.uFieldSize, view.cols, view.rows);
    gl.uniform1f(d.uCellDevice, view.cell);
    gl.uniform1i(d.uMode, s.mode);
    gl.uniform1f(d.uColorNum, s.colorNum);
    gl.uniform3fv(d.uWave, toColor(s.waveColor));
    const transparent = s.backgroundColor === 'transparent';
    gl.uniform3fv(d.uBackground, transparent ? [0, 0, 0] : toColor(s.backgroundColor));
    gl.uniform1f(d.uTransparent, transparent ? 1 : 0);
    s.palette.forEach((value, index) => paletteData.set(toColor(value), index * 3));
    gl.uniform3fv(d.uPalette, paletteData);
    gl.uniform1i(d.uPaletteCount, s.palette.length);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const frame = (now: number): void => {
    raf = 0;
    if (!visible || document.hidden) return;
    const dt = last ? clamp((now - last) / 1000, 0.0005, 0.05) : 1 / 60;
    last = now;
    if (!s.disableAnimation && !reduce) state.time += dt;

    const engaged = s.enableMouseInteraction && pointer.inside && !reduce;
    state.presence += ((engaged ? 1 : 0) - state.presence) * (1 - Math.exp(-dt / (engaged ? 0.045 : 0.38)));
    if (pointer.set) {
      const [tx, ty] = toUv(pointer.x, pointer.y);
      const follow = 1 - Math.exp(-dt / 0.025);
      const moved = Math.hypot(tx - state.hx, ty - state.hy);
      state.hx += (tx - state.hx) * follow;
      state.hy += (ty - state.hy) * follow;
      if (engaged && moved > 0.09 && (!ripples.length || ripples[ripples.length - 1].age > 0.22)) {
        ripples.push({ x: tx, y: ty, age: 0 });
        if (ripples.length > MAX_RIPPLES) ripples.shift();
      }
      const decay = Math.exp(-dt / (0.08 + s.trail * 0.7));
      trailPoints.forEach((point) => {
        point.weight *= decay;
      });
      const head = trailPoints[0];
      if (!head || Math.hypot(head.x - state.hx, head.y - state.hy) > 0.012 || moved > 0.012) {
        trailPoints.unshift({ x: state.hx, y: state.hy, weight: state.presence });
      } else {
        head.x = state.hx;
        head.y = state.hy;
        head.weight = state.presence;
      }
      if (s.trail <= 0.001) trailPoints.length = Math.min(trailPoints.length, 1);
      while (
        trailPoints.length > MAX_TRAIL ||
        (trailPoints.length > 1 && trailPoints[trailPoints.length - 1].weight < 0.01)
      ) {
        trailPoints.pop();
      }
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].age += dt;
      if (ripples[i].age >= RIPPLE_SECONDS) ripples.splice(i, 1);
    }

    if (!s.intro || reduce) state.reveal = 1;
    else if (state.reveal < 1) state.reveal = Math.min(1, state.reveal + dt / INTRO_SECONDS);

    render();
    const busy =
      !s.disableAnimation ||
      state.reveal < 1 ||
      ripples.length > 0 ||
      state.presence > 0.002 ||
      trailPoints.some((point) => point.weight > 0.01);
    if (busy && !reduce) raf = requestAnimationFrame(frame);
    else last = 0;
  };

  const wake = (): void => {
    if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };

  const resize = (): void => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const ratio = Math.min(s.dpr || window.devicePixelRatio || 1, 2);
    view.width = width;
    view.height = height;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    view.ratio = canvas.width / width;
    allocate();
    render();
    wake();
  };

  const locate = (event: PointerEvent): void => {
    const rect = container.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
    pointer.inside = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= rect.width && pointer.y <= rect.height;
    if (pointer.inside && !pointer.set) {
      const [x, y] = toUv(pointer.x, pointer.y);
      state.hx = x;
      state.hy = y;
      pointer.set = true;
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    locate(event);
    wake();
  };

  const onPointerDown = (event: PointerEvent): void => {
    locate(event);
    if (!pointer.inside || !s.clickRipple || reduce) return;
    const [x, y] = toUv(pointer.x, pointer.y);
    ripples.push({ x, y, age: 0 });
    if (ripples.length > MAX_RIPPLES) ripples.shift();
    wake();
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') pointer.inside = false;
  };

  const onPointerLeave = (): void => {
    pointer.inside = false;
  };

  const onVisibility = (): void => {
    last = 0;
    wake();
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const intersection = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    if (visible) {
      last = 0;
      wake();
    }
  });
  intersection.observe(container);

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  window.addEventListener('pointercancel', onPointerUp, { passive: true });
  document.documentElement.addEventListener('pointerleave', onPointerLeave);
  document.addEventListener('visibilitychange', onVisibility);
  resize();

  return () => {
    cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    intersection.disconnect();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    document.documentElement.removeEventListener('pointerleave', onPointerLeave);
    document.removeEventListener('visibilitychange', onVisibility);
    gl.deleteProgram(wave.program);
    gl.deleteProgram(dither.program);
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    gl.deleteTexture(field);
    gl.deleteFramebuffer(framebuffer);
    if (!canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
}
