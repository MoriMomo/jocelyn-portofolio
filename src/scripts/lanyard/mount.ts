import * as THREE from 'three';
import {
  FOIL_FRAGMENT_BODY,
  FOIL_FRAGMENT_HEAD,
  FOIL_VERTEX_BODY,
  FOIL_VERTEX_HEAD,
  buildBandGeometry,
  buildCardGeometry,
  buildClampGeometry,
  cardLayout,
} from './geometry';
import { buildPhysicsParams, configureSimulation, createSimulation, placeHanging, stepSimulation } from './physics';
import {
  buildEnvironment,
  buildGrainTexture,
  buildWeaveTexture,
  loadImage,
  makeCanvasTexture,
  paintFace,
  paintStrap,
  parseColor,
} from './textures';
import {
  ANCHORS,
  BAND_BEND,
  BAND_COLUMNS,
  BEVEL,
  CLAMP_BODY,
  EYELET_RADIUS,
  FACE_WIDTH,
  FINISHES,
  FLIP_SPIN,
  FOV,
  JOINTS,
  METALS,
  RING_RADIUS,
  RING_TUBE,
  SAMPLES,
  STRAP_WIDTH,
  THICKNESS,
  clamp,
  mix,
  type LanyardLayout,
  type LanyardOptions,
  type LanyardSim,
} from './types';

interface BandWork {
  points: THREE.Vector3[];
  sides: THREE.Vector3[];
  controls: THREE.Vector3[];
  mouth: THREE.Vector3;
  tuck: THREE.Vector3;
  curve: THREE.CatmullRomCurve3;
  tangent: THREE.Vector3;
  toCamera: THREE.Vector3;
  basis: THREE.Matrix4;
  up: THREE.Vector3;
  across: THREE.Vector3;
  facing: THREE.Vector3;
  end: THREE.Vector3;
  fallbackSide: THREE.Vector3;
}

function createBandWork(): BandWork {
  const controls: THREE.Vector3[] = [];
  return {
    points: Array.from({ length: SAMPLES }, () => new THREE.Vector3()),
    sides: Array.from({ length: SAMPLES }, () => new THREE.Vector3()),
    controls,
    mouth: new THREE.Vector3(),
    tuck: new THREE.Vector3(),
    curve: new THREE.CatmullRomCurve3(controls, false, 'centripetal'),
    tangent: new THREE.Vector3(),
    toCamera: new THREE.Vector3(),
    basis: new THREE.Matrix4(),
    up: new THREE.Vector3(),
    across: new THREE.Vector3(),
    facing: new THREE.Vector3(),
    end: new THREE.Vector3(),
    fallbackSide: new THREE.Vector3(1, 0, 0),
  };
}

function findGuideIndex(sim: LanyardSim, hang: THREE.Vector3, reach: number): number {
  let guide = JOINTS - 1;
  while (guide > 0 && sim.nodes[guide].distanceTo(hang) < reach * 1.1) guide--;
  return guide;
}

function sampleBandCurve(sim: LanyardSim, w: BandWork): { axis: THREE.Vector3; length: number; held: number } {
  const hang = sim.nodes[JOINTS];
  const reach = EYELET_RADIUS + CLAMP_BODY + 0.05;
  const guide = findGuideIndex(sim, hang, reach);

  const axis = w.up.subVectors(sim.nodes[guide], hang);
  if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0).applyQuaternion(sim.body.quaternion);
  axis.normalize();

  w.mouth.copy(hang).addScaledVector(axis, reach);
  w.tuck.copy(hang).addScaledVector(axis, EYELET_RADIUS + CLAMP_BODY * 0.35);
  w.controls.length = 0;
  for (let i = 0; i <= guide; i++) w.controls.push(sim.nodes[i]);
  w.controls.push(w.mouth, w.tuck);
  w.curve.updateArcLengths();
  for (let i = 0; i < SAMPLES; i++) w.curve.getPointAt(i / (SAMPLES - 1), w.points[i]);

  const length = w.curve.getLength();
  return { axis, length, held: 1 - w.mouth.distanceTo(w.tuck) / Math.max(length, 0.001) };
}

function alignWithPrevious(i: number, side: THREE.Vector3, w: BandWork): THREE.Vector3 {
  if (i > 0 && side.dot(w.sides[i - 1]) < 0) side.negate();
  return side;
}

function resolveSideVector(i: number, side: THREE.Vector3, w: BandWork): THREE.Vector3 {
  if (side.lengthSq() < 1e-10) side.copy(i > 0 ? w.sides[i - 1] : w.fallbackSide);
  side.normalize();
  return alignWithPrevious(i, side, w);
}

function orientSampleFrame(i: number, camera: THREE.PerspectiveCamera, w: BandWork): THREE.Vector3 {
  w.tangent.subVectors(w.points[Math.min(SAMPLES - 1, i + 1)], w.points[Math.max(0, i - 1)]);
  if (w.tangent.lengthSq() < 1e-12) w.tangent.set(0, -1, 0);
  w.tangent.normalize();
  w.toCamera.subVectors(camera.position, w.points[i]).normalize();
  return resolveSideVector(i, w.sides[i].crossVectors(w.toCamera, w.tangent), w);
}

function writeBandSample(
  i: number,
  w: BandWork,
  bends: ReadonlyArray<readonly [number, number]>,
  width: number,
  vCoord: number,
  position: THREE.BufferAttribute,
  normal: THREE.BufferAttribute,
  uv: THREE.BufferAttribute,
): void {
  const p = w.points[i];
  const columns = BAND_COLUMNS.length;
  for (let c = 0; c < columns; c++) {
    const k = i * columns + c;
    const offset = (BAND_COLUMNS[c] - 0.5) * width;
    const [bendCos, bendSin] = bends[c];
    position.setXYZ(k, p.x + w.across.x * offset, p.y + w.across.y * offset, p.z + w.across.z * offset);
    normal.setXYZ(
      k,
      w.facing.x * bendCos + w.across.x * bendSin,
      w.facing.y * bendCos + w.across.y * bendSin,
      w.facing.z * bendCos + w.across.z * bendSin,
    );
    uv.setXY(k, BAND_COLUMNS[c], vCoord);
  }
}

function updateBandMesh(
  sim: LanyardSim,
  camera: THREE.PerspectiveCamera,
  bandGeometry: THREE.BufferGeometry,
  clampGroup: THREE.Group,
  strapScale: number,
  tileRatio: number,
  w: BandWork,
): void {
  const { axis, length, held } = sampleBandCurve(sim, w);
  const position = bandGeometry.getAttribute('position') as THREE.BufferAttribute;
  const normal = bandGeometry.getAttribute('normal') as THREE.BufferAttribute;
  const uv = bandGeometry.getAttribute('uv') as THREE.BufferAttribute;
  const restLength = sim.rest * JOINTS;
  const repeats = restLength / (strapScale * tileRatio);
  const width = strapScale / Math.pow(Math.max(1, length / Math.max(restLength, 0.001)), 0.35);
  const bends = BAND_BEND.map((a) => [Math.cos(a), Math.sin(a)] as const);

  for (let i = 0; i < SAMPLES; i++) {
    const side = orientSampleFrame(i, camera, w);
    const angle = -sim.twist * Math.pow(Math.min(1, i / (SAMPLES - 1) / held), 1.3);
    w.facing.crossVectors(w.tangent, side);
    w.across.copy(side).multiplyScalar(Math.cos(angle)).addScaledVector(w.facing, Math.sin(angle));
    w.facing.crossVectors(w.tangent, w.across);
    writeBandSample(i, w, bends, width, (1 - i / (SAMPLES - 1)) * repeats, position, normal, uv);
  }

  w.end.copy(w.across);
  position.needsUpdate = true;
  normal.needsUpdate = true;
  uv.needsUpdate = true;

  w.across.copy(w.end).addScaledVector(axis, -w.end.dot(axis)).normalize();
  w.facing.crossVectors(w.across, axis).normalize();
  w.basis.makeBasis(w.across, axis, w.facing);
  clampGroup.quaternion.setFromRotationMatrix(w.basis);
  clampGroup.position.copy(sim.nodes[JOINTS]);
}

const orNum = (v: number | undefined, fallback: number): number => (v === undefined ? fallback : v);

function frameSceneCamera(
  settings: LanyardOptions,
  layout: LanyardLayout,
  view: { width: number; height: number },
  camera: THREE.PerspectiveCamera,
  sim: LanyardSim,
  foilUniforms: Record<string, { value: unknown }>,
): void {
  const aspect = view.width / view.height;
  let viewHeight = layout.height / clamp(orNum(settings.size, 0.6), 0.15, 0.9);
  const minimumWidth = layout.width / 0.72;
  if (viewHeight * aspect < minimumWidth) viewHeight = minimumWidth / aspect;
  const viewWidth = viewHeight * aspect;

  camera.aspect = aspect;
  camera.position.set(0, 0, viewHeight / 2 / Math.tan((FOV * Math.PI) / 360));
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  (foilUniforms.foilKey.value as THREE.Vector3).set(-2.5, 4, 6).normalize().transformDirection(camera.matrixWorldInverse);
  (foilUniforms.foilFill.value as THREE.Vector3).set(3, -1, 4).normalize().transformDirection(camera.matrixWorldInverse);
  (foilUniforms.foilTop.value as THREE.Vector3).set(0.5, 4.5, 8).normalize().transformDirection(camera.matrixWorldInverse);

  const anchorRatio = ANCHORS[settings.anchor || 'center'] || 0.5;
  const anchorX = (anchorRatio - 0.5) * viewWidth;
  const anchorY = viewHeight / 2 + 0.2;
  const cardTop = viewHeight / 2 - viewHeight * mix(0.12, 0.42, clamp(orNum(settings.strapLength, 0.5), 0, 1));
  const hangTop = cardTop + (layout.hangY - layout.height / 2);

  sim.anchor.set(anchorX, anchorY, 0);
  configureSimulation(sim, layout, anchorY - hangTop);
  sim.nodes[0].copy(sim.anchor);
  sim.previous[0].copy(sim.anchor);
}

function pickFlipDirection(sim: LanyardSim, camera: THREE.PerspectiveCamera, point: THREE.Vector3, up: THREE.Vector3): number {
  if (sim.turn !== 0) return sim.turn > 0 ? -1 : 1;
  const away = point.clone().sub(camera.position).normalize();
  return point.clone().sub(sim.body.position).cross(away).dot(up) < 0 ? -1 : 1;
}

function flipCard(sim: LanyardSim, camera: THREE.PerspectiveCamera, point: THREE.Vector3): void {
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(sim.body.quaternion);
  const direction = pickFlipDirection(sim, camera, point, up);
  sim.turn = sim.turn === 0 ? Math.PI * direction : 0;
  sim.body.angular.addScaledVector(up, FLIP_SPIN * direction);
}

interface PointerState {
  hovering: boolean;
  press: { x: number; y: number; time: number; point: THREE.Vector3 } | null;
}

function createPickFn(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  cardGroup: THREE.Group,
  pickTargets: THREE.Object3D[],
  raycaster: THREE.Raycaster,
) {
  const pointer = new THREE.Vector2();
  return (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    cardGroup.updateMatrixWorld();
    return raycaster.intersectObjects(pickTargets, false)[0] || null;
  };
}

function startGrab(
  e: PointerEvent,
  hit: THREE.Intersection,
  sim: LanyardSim,
  state: PointerState,
  canvas: HTMLCanvasElement,
  onStart: () => void,
): void {
  sim.grab = {
    local: hit.point.clone().sub(sim.body.position).applyQuaternion(sim.body.quaternion.clone().invert()),
    rotation: sim.body.quaternion.clone(),
    reach: hit.distance,
    from: hit.point.clone(),
    target: hit.point.clone(),
  };
  state.press = { x: e.clientX, y: e.clientY, time: performance.now(), point: hit.point.clone() };
  canvas.setPointerCapture?.(e.pointerId);
  canvas.style.cursor = 'grabbing';
  e.preventDefault();
  onStart();
}

function moveGrab(
  e: PointerEvent,
  sim: LanyardSim,
  state: PointerState,
  pickAt: (x: number, y: number) => THREE.Intersection | null,
  raycaster: THREE.Raycaster,
  onStart: () => void,
): void {
  if (state.press && Math.hypot(e.clientX - state.press.x, e.clientY - state.press.y) > 6) {
    state.press = null;
  }
  pickAt(e.clientX, e.clientY);
  if (sim.grab) raycaster.ray.at(sim.grab.reach, sim.grab.target);
  onStart();
}

function maybeFlipOnTap(
  e: PointerEvent,
  pressed: PointerState['press'],
  sim: LanyardSim,
  camera: THREE.PerspectiveCamera,
): void {
  if (!pressed || e.type !== 'pointerup') return;
  if (performance.now() - pressed.time < 450) flipCard(sim, camera, pressed.point);
}

function resetReleaseCursor(canvas: HTMLCanvasElement, hovering: boolean, pointerType: string): void {
  canvas.style.cursor = hovering && pointerType !== 'touch' ? 'grab' : '';
}

function endGrab(
  e: PointerEvent,
  sim: LanyardSim,
  state: PointerState,
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  onStart: () => void,
): void {
  if (!sim.grab) return;
  sim.grab = null;
  const pressed = state.press;
  state.press = null;
  maybeFlipOnTap(e, pressed, sim, camera);
  canvas.releasePointerCapture?.(e.pointerId);
  resetReleaseCursor(canvas, state.hovering, e.pointerType);
  onStart();
}

function bindPointerControls(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  sim: LanyardSim,
  cardGroup: THREE.Group,
  pickTargets: THREE.Object3D[],
  interactive: boolean,
  onStart: () => void,
  signal: AbortSignal,
): void {
  if (!interactive) return;
  const raycaster = new THREE.Raycaster();
  const state: PointerState = { hovering: false, press: null };
  const pickAt = createPickFn(canvas, camera, cardGroup, pickTargets, raycaster);

  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button > 0) return;
      const hit = pickAt(e.clientX, e.clientY);
      if (hit) startGrab(e, hit, sim, state, canvas, onStart);
    },
    { signal },
  );

  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (sim.grab) return moveGrab(e, sim, state, pickAt, raycaster, onStart);
      if (e.pointerType === 'touch') return;
      state.hovering = Boolean(pickAt(e.clientX, e.clientY));
      canvas.style.cursor = state.hovering ? 'grab' : '';
    },
    { signal },
  );

  const release = (e: PointerEvent) => endGrab(e, sim, state, camera, canvas, onStart);
  canvas.addEventListener('pointerup', release, { signal });
  canvas.addEventListener('pointercancel', release, { signal });
  canvas.addEventListener('lostpointercapture', release, { signal });
  canvas.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 1 && pickAt(e.touches[0].clientX, e.touches[0].clientY)) e.preventDefault();
    },
    { passive: false, signal },
  );
}

function createFoilUniforms(options: LanyardOptions, layout: LanyardLayout): Record<string, { value: unknown }> {
  const finishKey = options.finish || 'glossy';
  return {
    foilStrength: { value: (FINISHES[finishKey] || FINISHES.glossy).foil },
    foilAspect: { value: layout.height / layout.width },
    foilKey: { value: new THREE.Vector3() },
    foilFill: { value: new THREE.Vector3() },
    foilTop: { value: new THREE.Vector3() },
  };
}

function buildFoilInjector(foilUniforms: Record<string, { value: unknown }>) {
  return (shader: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, foilUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FOIL_VERTEX_HEAD}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${FOIL_VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FOIL_FRAGMENT_HEAD}`)
      .replace('#include <opaque_fragment>', `${FOIL_FRAGMENT_BODY}\n#include <opaque_fragment>`);
  };
}

const pickFinish = (finish?: LanyardOptions['finish']) => FINISHES[finish || 'glossy'] || FINISHES.glossy;
const pickMetal = (metal?: LanyardOptions['metal']) => METALS[metal || 'silver'] || METALS.silver;

function resolveMaterialLooks(options: LanyardOptions) {
  return {
    finishLook: pickFinish(options.finish),
    metalLook: pickMetal(options.metal),
    cardRgb: parseColor(options.cardColor || '#000000', [0, 0, 0]),
  };
}

function createMaterials(
  options: LanyardOptions,
  frontTexture: THREE.CanvasTexture,
  backTexture: THREE.CanvasTexture,
  strapTexture: THREE.CanvasTexture,
  grain: THREE.DataTexture,
  weave: THREE.DataTexture,
  foilUniforms: Record<string, { value: unknown }>,
) {
  const { finishLook, metalLook, cardRgb } = resolveMaterialLooks(options);
  const injectFoil = buildFoilInjector(foilUniforms);
  const frontMaterial = new THREE.MeshPhysicalMaterial({
    map: frontTexture,
    normalMap: grain,
    normalScale: new THREE.Vector2(0.06, 0.06),
    ...finishLook,
  });
  const backMaterial = new THREE.MeshPhysicalMaterial({
    map: backTexture,
    normalMap: grain,
    normalScale: new THREE.Vector2(0.06, 0.06),
    ...finishLook,
  });
  frontMaterial.onBeforeCompile = injectFoil;
  backMaterial.onBeforeCompile = injectFoil;

  const edgeMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(cardRgb[0] * 0.92, cardRgb[1] * 0.92, cardRgb[2] * 0.92, THREE.SRGBColorSpace),
    roughness: Math.min(finishLook.roughness, 0.35),
    metalness: finishLook.metalness,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  const metalMaterial = new THREE.MeshStandardMaterial({
    metalness: 1,
    color: metalLook.color,
    roughness: metalLook.roughness,
  });
  const bandMaterial = new THREE.MeshPhysicalMaterial({
    map: strapTexture,
    normalMap: weave,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.68,
    sheen: 1,
    sheenRoughness: 0.42,
    sheenColor: new THREE.Color(0.32, 0.32, 0.34),
    side: THREE.DoubleSide,
  });

  return { cardRgb, frontMaterial, backMaterial, edgeMaterial, metalMaterial, bandMaterial };
}

function createRenderer(container: HTMLElement, interactive: boolean): THREE.WebGLRenderer | null {
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    const canvas = renderer.domElement;
    canvas.className = 'lanyard-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.touchAction = interactive ? 'pan-y' : 'auto';
    container.appendChild(canvas);
    container.classList.add('is-ready');
    return renderer;
  } catch {
    return null;
  }
}

function createSceneRig(scene: THREE.Scene): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(-2.5, 4, 6);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
  fillLight.position.set(3, -1, 4);
  scene.add(keyLight, fillLight);
  return camera;
}

function buildAssembly(
  scene: THREE.Scene,
  layout: LanyardLayout,
  strapScale: number,
  mats: ReturnType<typeof createMaterials>,
) {
  const geometry = buildCardGeometry(layout);
  const bodyMesh = new THREE.Mesh(geometry.body, mats.edgeMaterial);
  const frontMesh = new THREE.Mesh(geometry.face, mats.frontMaterial);
  const backMesh = new THREE.Mesh(geometry.face.clone(), mats.backMaterial);
  frontMesh.position.z = THICKNESS / 2 + BEVEL + 0.0006;
  backMesh.rotation.y = Math.PI;
  backMesh.position.z = -(THICKNESS / 2 + BEVEL + 0.0006);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 18, 72), mats.metalMaterial);
  ring.rotation.y = Math.PI / 2 - 0.7;
  ring.position.set(0, layout.ringY, 0);

  const cardGroup = new THREE.Group();
  cardGroup.add(bodyMesh, frontMesh, backMesh, ring);
  scene.add(cardGroup);

  const bandGeometry = buildBandGeometry(SAMPLES);
  const band = new THREE.Mesh(bandGeometry, mats.bandMaterial);
  band.frustumCulled = false;
  scene.add(band);

  const clampGroup = new THREE.Group();
  const clampMesh = new THREE.Mesh(buildClampGeometry(strapScale), mats.metalMaterial);
  clampMesh.position.y = EYELET_RADIUS + CLAMP_BODY / 2 - 0.004;
  const eyelet = new THREE.Mesh(new THREE.TorusGeometry(EYELET_RADIUS, 0.0105, 14, 40), mats.metalMaterial);
  clampGroup.add(clampMesh, eyelet);
  scene.add(clampGroup);

  return {
    cardGroup,
    clampGroup,
    bandGeometry,
    pickTargets: [bodyMesh, frontMesh, backMesh],
    geometries: [bodyMesh, frontMesh, backMesh, ring, clampMesh, eyelet, band],
  };
}

function createTextures(anisotropy: number, layout: LanyardLayout) {
  const frontCanvas = document.createElement('canvas');
  const backCanvas = document.createElement('canvas');
  const strapCanvas = document.createElement('canvas');
  const faceHeight = Math.round((FACE_WIDTH * layout.height) / layout.width);
  frontCanvas.width = FACE_WIDTH;
  frontCanvas.height = faceHeight;
  backCanvas.width = FACE_WIDTH;
  backCanvas.height = faceHeight;

  const frontTexture = makeCanvasTexture(frontCanvas, anisotropy);
  const backTexture = makeCanvasTexture(backCanvas, anisotropy);
  const strapTexture = makeCanvasTexture(strapCanvas, anisotropy);
  strapTexture.wrapS = THREE.ClampToEdgeWrapping;
  strapTexture.wrapT = THREE.RepeatWrapping;

  return {
    frontCanvas,
    backCanvas,
    strapCanvas,
    frontTexture,
    backTexture,
    strapTexture,
    grain: buildGrainTexture(),
    weave: buildWeaveTexture(),
  };
}

function guardSimulationStability(sim: LanyardSim, layout: LanyardLayout): void {
  const sum = sim.body.position.x + sim.body.position.y + sim.body.position.z + sim.body.quaternion.w;
  if (Number.isFinite(sum)) return;
  sim.grab = null;
  placeHanging(sim, layout, false);
}

function shouldScheduleFrame(sim: LanyardSim, visible: boolean, breeze: number): boolean {
  if (!visible) return false;
  return !(sim.calm > 1.2 && !sim.grab && breeze === 0);
}

function bindObservers(
  container: HTMLElement,
  resize: () => void,
  onVisibility: (isVisible: boolean) => void,
  signal: AbortSignal,
) {
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const intersectionObserver = new IntersectionObserver(([entry]) => onVisibility(entry.isIntersecting));
  intersectionObserver.observe(container);
  document.addEventListener('visibilitychange', () => !document.hidden && onVisibility(true), { signal });
  return () => {
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
  };
}

function loadLanyardImages(
  options: LanyardOptions,
  isAlive: () => boolean,
  onLoaded: (front: HTMLImageElement | null, back: HTMLImageElement | null, strap: HTMLImageElement | null) => void,
): void {
  const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
  Promise.all([
    loadImage(imageCache, options.frontImage),
    loadImage(imageCache, options.backImage),
    loadImage(imageCache, options.strapImage),
  ]).then(([front, back, strap]) => {
    if (isAlive()) onLoaded(front, back, strap);
  });
}

export function mountLanyard(container: HTMLElement, options: LanyardOptions): () => void {
  const interactive = options.interactive !== false;
  const renderer = createRenderer(container, interactive);
  if (!renderer) return () => {};

  const scene = new THREE.Scene();
  const environment = buildEnvironment(renderer);
  scene.environment = environment.texture;
  const camera = createSceneRig(scene);

  const layout = cardLayout(options.orientation || 'portrait', orNum(options.cornerRadius, 0.3));
  const foilUniforms = createFoilUniforms(options, layout);
  const tex = createTextures(Math.min(8, renderer.capabilities.getMaxAnisotropy()), layout);
  const mats = createMaterials(options, tex.frontTexture, tex.backTexture, tex.strapTexture, tex.grain, tex.weave, foilUniforms);
  const strapScale = STRAP_WIDTH * clamp(orNum(options.strapWidth, 0.65), 0.4, 2);
  const rig = buildAssembly(scene, layout, strapScale, mats);

  const sim = createSimulation();
  const bandWork = createBandWork();
  const view = { width: Math.max(1, container.clientWidth), height: Math.max(1, container.clientHeight) };
  const reducedMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  let tileRatio = 2;
  let raf = 0;
  let last = performance.now();
  let time = 0;
  let visible = true;
  let alive = true;

  const drawFaces = (front: HTMLImageElement | null, back: HTMLImageElement | null) => {
    const fit = options.imageFit === 'contain' ? 'contain' : 'cover';
    paintFace(tex.frontCanvas, front, mats.cardRgb, fit);
    paintFace(tex.backCanvas, back || front, mats.cardRgb, fit);
    tex.frontTexture.needsUpdate = true;
    tex.backTexture.needsUpdate = true;
  };
  const drawStrap = (strap: HTMLImageElement | null) => {
    tileRatio = paintStrap(tex.strapCanvas, strap, parseColor(options.strapColor || '#111111', [0.07, 0.07, 0.07]));
    tex.weave.repeat.set(2, 2 * tileRatio);
    tex.strapTexture.dispose();
    tex.strapTexture.needsUpdate = true;
  };
  drawFaces(null, null);
  drawStrap(null);

  const render = () => {
    rig.cardGroup.position.copy(sim.body.position);
    rig.cardGroup.quaternion.copy(sim.body.quaternion);
    updateBandMesh(sim, camera, rig.bandGeometry, rig.clampGroup, strapScale, tileRatio, bandWork);
    renderer.render(scene, camera);
  };

  const tick = (now: number) => {
    raf = 0;
    if (!alive) return;
    const dt = Math.min(1 / 30, Math.max(1 / 240, (now - last) / 1000));
    last = now;
    time += dt;
    const physics = buildPhysicsParams(options, reducedMotion);
    stepSimulation(sim, dt, physics, time);
    guardSimulationStability(sim, layout);
    render();
    if (shouldScheduleFrame(sim, visible, physics.breeze)) raf = requestAnimationFrame(tick);
  };

  const start = () => {
    if (raf || !visible || !alive) return;
    sim.calm = 0;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const resize = () => {
    view.width = Math.max(1, container.clientWidth);
    view.height = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(view.width, view.height, false);
    frameSceneCamera(options, layout, view, camera, sim, foilUniforms);
    render();
  };

  loadLanyardImages(
    options,
    () => alive,
    (front, back, strap) => {
      drawFaces(front, back);
      drawStrap(strap);
      start();
    },
  );

  frameSceneCamera(options, layout, view, camera, sim, foilUniforms);
  placeHanging(sim, layout, options.intro !== false && !reducedMotion);

  const controller = new AbortController();
  bindPointerControls(renderer.domElement, camera, sim, rig.cardGroup, rig.pickTargets, interactive, start, controller.signal);
  const stopObservers = bindObservers(
    container,
    resize,
    (isVisible) => {
      visible = isVisible;
      if (visible) start();
    },
    controller.signal,
  );

  resize();
  start();

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    controller.abort();
    stopObservers();
    rig.geometries.forEach((m) => m.geometry?.dispose());
    [mats.frontMaterial, mats.backMaterial, mats.edgeMaterial, mats.metalMaterial, mats.bandMaterial].forEach((m) => m.dispose());
    [tex.frontTexture, tex.backTexture, tex.strapTexture, tex.grain, tex.weave].forEach((t) => t.dispose());
    environment.dispose();
    renderer.dispose();
    container.classList.remove('is-ready');
    renderer.domElement.parentNode?.removeChild(renderer.domElement);
  };
}
