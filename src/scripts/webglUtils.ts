export interface LinkedProgram {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function toLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Creates a cached CSS color parser returning normalized RGB triples. */
export function createColorResolver(options?: {
  fallback?: string;
  linear?: boolean;
}): (value: string) => [number, number, number] {
  const fallback = options?.fallback ?? '#000000';
  const linear = options?.linear ?? false;
  const fallbackRgb: [number, number, number] = fallback === '#ffffff' ? [1, 1, 1] : [0, 0, 0];
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const cache = new Map<string, [number, number, number]>();

  return (value: string): [number, number, number] => {
    const key = String(value);
    const cached = cache.get(key);
    if (cached) return cached;

    let rgb: [number, number, number] = fallbackRgb;
    if (probe) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = fallback;
      probe.fillStyle = key;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
      rgb = linear
        ? [toLinear(r / 255), toLinear(g / 255), toLinear(b / 255)]
        : [r / 255, g / 255, b / 255];
    }
    cache.set(key, rgb);
    return rgb;
  };
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

function readUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): Record<string, WebGLUniformLocation | null> {
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(program, info.name);
  }
  return uniforms;
}

/** Compiles, optionally binds attribute locations, and links a WebGL2 program. */
export function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  attributes: string[] = [],
): LinkedProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  attributes.forEach((name, index) => gl.bindAttribLocation(program, index, name));
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return { program, uniforms: readUniforms(gl, program) };
}

/** Schedules non-critical offscreen initialization once the browser is idle. */
export function scheduleIdleMount(callback: () => void): () => void {
  let cancelled = false;
  const run = () => {
    if (!cancelled) callback();
  };

  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 120 });
    return () => {
      cancelled = true;
      window.cancelIdleCallback(id);
    };
  }

  const timer = window.setTimeout(run, 120);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
  };
}
