import * as THREE from 'three';
import {
  BEVEL,
  ITERATIONS,
  JOINTS,
  MAX_STEP,
  NODE_WEIGHT,
  THICKNESS,
  clamp,
  mix,
  type LanyardLayout,
  type LanyardOptions,
  type LanyardSim,
  type PhysicsParams,
  type RigidBody,
} from './types';

const scratch = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  d: new THREE.Vector3(),
  e: new THREE.Vector3(),
  f: new THREE.Vector3(),
  g: new THREE.Vector3(),
  pin: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  r: new THREE.Quaternion(),
};

export function createSimulation(): LanyardSim {
  const vectors = () => Array.from({ length: JOINTS + 1 }, () => new THREE.Vector3());
  return {
    nodes: vectors(),
    previous: vectors(),
    velocities: vectors(),
    lengths: new Float64Array(JOINTS),
    impulses: new Float64Array(JOINTS),
    rest: 1,
    anchor: new THREE.Vector3(),
    body: {
      position: new THREE.Vector3(),
      previous: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      previousQuaternion: new THREE.Quaternion(),
      angular: new THREE.Vector3(),
      mass: 1,
      inverseInertia: new THREE.Vector3(1, 1, 1),
      hang: new THREE.Vector3(),
    },
    grab: null,
    turn: 0,
    twist: 0,
    twistRaw: 0,
    calm: 0,
  };
}

const clamped = (value: number | undefined, fallback: number, min: number, max: number): number =>
  clamp(value === undefined ? fallback : value, min, max);

export function buildPhysicsParams(settings: LanyardOptions, reducedMotion: boolean): PhysicsParams {
  const gravity = 40 * clamped(settings.gravity, 1, 0, 3);
  const weight = Math.max(gravity, 20);
  const springy = clamped(settings.elasticity, 0.5, 0, 1);
  const settle = clamped(settings.damping, 0.5, 0, 1);
  const breeze = reducedMotion ? 0 : clamped(settings.breeze, 0.5, 0, 1);

  return {
    gravity,
    hold: weight * mix(2.2, 5.5, springy),
    stiffness: weight * 10 * JOINTS,
    spring: weight * mix(0.1, 0.4, springy) * JOINTS,
    bandDamping: weight * mix(0.3, 0.08, springy) * JOINTS,
    linearDrag: 0.25 * Math.pow(16, settle),
    angularDrag: 0.5 * Math.pow(12, settle),
    air: 0.15,
    broadside: 0.5,
    spinAir: 0.03,
    nodeDrag: 2,
    nodeAir: 0.2,
    twist: 30,
    twistDamping: 3,
    grip: 40,
    gripDamping: 6,
    breeze,
  };
}

function applyInverseInertia(body: RigidBody, vector: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  scratch.r.copy(body.quaternion).invert();
  out.copy(vector).applyQuaternion(scratch.r);
  out.set(out.x * body.inverseInertia.x, out.y * body.inverseInertia.y, out.z * body.inverseInertia.z);
  return out.applyQuaternion(body.quaternion);
}

function rotateBody(q: THREE.Quaternion, w: THREE.Vector3): void {
  const { x: qx, y: qy, z: qz, w: qw } = q;
  q.x += 0.5 * (w.x * qw + w.y * qz - w.z * qy);
  q.y += 0.5 * (w.y * qw + w.z * qx - w.x * qz);
  q.z += 0.5 * (w.z * qw + w.x * qy - w.y * qx);
  q.w += 0.5 * (-w.x * qx - w.y * qy - w.z * qz);
  q.normalize();
}

function bodyWeight(body: RigidBody, r: THREE.Vector3, normal: THREE.Vector3): number {
  const rn = scratch.c.crossVectors(r, normal);
  return 1 / body.mass + rn.dot(applyInverseInertia(body, rn, scratch.d));
}

function pushBody(body: RigidBody, r: THREE.Vector3, impulse: THREE.Vector3): void {
  body.position.addScaledVector(impulse, 1 / body.mass);
  rotateBody(body.quaternion, applyInverseInertia(body, scratch.e.crossVectors(r, impulse), scratch.f));
}

function applySegmentImpulse(
  sim: LanyardSim,
  i: number,
  a: THREE.Vector3,
  b: THREE.Vector3,
  last: boolean,
  r: THREE.Vector3,
  normal: THREE.Vector3,
  lambda: number,
  wa: number,
  wb: number,
): void {
  sim.impulses[i] += lambda;
  if (wa) a.addScaledVector(normal, lambda * wa);
  if (last) {
    pushBody(sim.body, r, normal.multiplyScalar(-lambda));
    return;
  }
  b.addScaledVector(normal, -lambda * wb);
}

function segmentTension(sim: LanyardSim, i: number, length: number, stretch: number, h: number, physics: PhysicsParams): number {
  const rate = (length - sim.lengths[i]) / h;
  return (
    physics.hold * Math.tanh((physics.stiffness * stretch) / physics.hold) +
    physics.spring * stretch +
    physics.bandDamping * Math.max(0, rate)
  );
}

function segmentTargetNode(sim: LanyardSim, i: number, r: THREE.Vector3): THREE.Vector3 {
  if (i < JOINTS - 1) return sim.nodes[i + 1];
  return scratch.b.copy(sim.body.position).add(r.copy(sim.body.hang).applyQuaternion(sim.body.quaternion));
}

function targetWeight(sim: LanyardSim, last: boolean, r: THREE.Vector3, normal: THREE.Vector3): number {
  return last ? bodyWeight(sim.body, r, normal) : NODE_WEIGHT;
}

function solveSegment(sim: LanyardSim, i: number, h: number, physics: PhysicsParams): void {
  const a = sim.nodes[i];
  const last = i === JOINTS - 1;
  const r = scratch.g;
  const b = segmentTargetNode(sim, i, r);

  const delta = scratch.a.subVectors(b, a);
  const length = delta.length();
  const stretch = length - sim.rest;
  if (stretch <= 0 || length < 1e-9) return;

  const normal = delta.divideScalar(length);
  const wa = Number(i > 0) * NODE_WEIGHT;
  const wb = targetWeight(sim, last, r, normal);
  const room = segmentTension(sim, i, length, stretch, h, physics) * h * h - sim.impulses[i];
  if (room <= 0) return;

  applySegmentImpulse(sim, i, a, b, last, r, normal, Math.min(stretch / (wa + wb), room), wa, wb);
}

function solvePin(body: RigidBody, grab: NonNullable<LanyardSim['grab']>, target: THREE.Vector3): void {
  const r = scratch.g.copy(grab.local).applyQuaternion(body.quaternion);
  const delta = scratch.a.copy(target).sub(body.position).sub(r);
  const distance = delta.length();
  if (distance < 1e-9) return;
  const normal = delta.divideScalar(distance);
  const lambda = distance / bodyWeight(body, r, normal);
  pushBody(body, r, normal.multiplyScalar(lambda));
}

export function configureSimulation(sim: LanyardSim, layout: LanyardLayout, length: number): void {
  sim.rest = length / JOINTS;
  const { width, height } = layout;
  const t = THICKNESS + BEVEL * 2;
  sim.body.mass = 1;
  sim.body.inverseInertia.set(
    12 / (height * height + t * t),
    12 / (width * width + t * t),
    12 / (width * width + height * height),
  );
  sim.body.hang.set(0, layout.hangY, 0);
}

function clearNodeMotion(sim: LanyardSim): void {
  for (let i = 0; i <= JOINTS; i++) {
    sim.previous[i].copy(sim.nodes[i]);
    sim.velocities[i].set(0, 0, 0);
  }
}

function resetNodes(sim: LanyardSim, intro: boolean): void {
  const dx = intro ? sim.rest : 0;
  const dy = intro ? 0 : sim.rest;
  sim.nodes[0].copy(sim.anchor);
  for (let i = 1; i <= JOINTS; i++) {
    sim.nodes[i].copy(sim.nodes[i - 1]);
    sim.nodes[i].x += dx;
    sim.nodes[i].y -= dy;
  }
  clearNodeMotion(sim);
}

export function placeHanging(sim: LanyardSim, layout: LanyardLayout, intro: boolean): void {
  resetNodes(sim, intro);
  const { body, nodes } = sim;
  body.quaternion.identity();
  if (intro) body.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  body.hang.set(0, layout.hangY, 0);
  body.position.copy(nodes[JOINTS]).sub(scratch.a.copy(body.hang).applyQuaternion(body.quaternion));
  body.previous.copy(body.position);
  body.previousQuaternion.copy(body.quaternion);
  body.velocity.set(0, 0, 0);
  body.angular.set(0, 0, 0);
  sim.lengths.fill(sim.rest);
  sim.turn = 0;
  sim.twist = 0;
  sim.twistRaw = 0;
  sim.calm = 0;
}

function updateTwist(sim: LanyardSim, up: THREE.Vector3): void {
  const q = sim.body.quaternion;
  const front = scratch.b.set(-up.x * up.z, -up.y * up.z, 1 - up.z * up.z);
  if (front.lengthSq() <= 1e-3) return;
  const facing = scratch.d.set(0, 0, 1).applyQuaternion(q);
  const raw = Math.atan2(scratch.e.crossVectors(front, facing).dot(up), front.dot(facing));
  let turned = raw - sim.twistRaw;
  if (turned > Math.PI) turned -= Math.PI * 2;
  else if (turned < -Math.PI) turned += Math.PI * 2;
  sim.twist += turned;
  sim.twistRaw = raw;
}

function applyGrabTorque(sim: LanyardSim, h: number, physics: PhysicsParams): void {
  const grab = sim.grab;
  if (!grab) return;
  const turn = scratch.q.copy(grab.rotation).multiply(scratch.r.copy(sim.body.quaternion).invert());
  if (turn.w < 0) turn.set(-turn.x, -turn.y, -turn.z, -turn.w);
  const torque = scratch.a.set(turn.x, turn.y, turn.z).multiplyScalar(2 * physics.grip);
  torque.addScaledVector(sim.body.angular, -physics.gripDamping);
  sim.body.angular.addScaledVector(applyInverseInertia(sim.body, torque, scratch.b), h);
}

function dampNodes(sim: LanyardSim, h: number, physics: PhysicsParams, nodeDrag: number): void {
  const { nodes, previous, velocities } = sim;
  for (let i = 1; i < JOINTS; i++) {
    const v = velocities[i].subVectors(nodes[i], previous[i]).divideScalar(h).multiplyScalar(nodeDrag);
    v.multiplyScalar(1 / (1 + physics.nodeAir * v.length() * h));
  }
}

function clampBodySpeed(body: RigidBody): void {
  if (body.velocity.lengthSq() > 3600) body.velocity.setLength(60);
  if (body.angular.lengthSq() > 1600) body.angular.setLength(40);
}

function integrateBodyAndDamp(
  sim: LanyardSim,
  h: number,
  physics: PhysicsParams,
  linearDrag: number,
  angularDrag: number,
  nodeDrag: number,
): void {
  dampNodes(sim, h, physics, nodeDrag);
  const { nodes, body } = sim;
  body.velocity.subVectors(body.position, body.previous).divideScalar(h);
  const dq = scratch.q.copy(body.previousQuaternion).invert().premultiply(body.quaternion);
  body.angular.set(dq.x, dq.y, dq.z).multiplyScalar((2 / h) * (dq.w < 0 ? -1 : 1));

  const normal = scratch.a.set(0, 0, 1).applyQuaternion(body.quaternion);
  const across = body.velocity.dot(normal);
  const along = scratch.b.copy(body.velocity).addScaledVector(normal, -across);
  along.multiplyScalar(1 / (1 + physics.air * along.length() * h));
  body.velocity
    .copy(along)
    .addScaledVector(normal, across / (1 + physics.broadside * Math.abs(across) * h))
    .multiplyScalar(linearDrag);
  body.angular.multiplyScalar(angularDrag / (1 + physics.spinAir * body.angular.length() * h));
  clampBodySpeed(body);

  nodes[JOINTS].copy(body.hang).applyQuaternion(body.quaternion).add(body.position);
  for (let i = 0; i < JOINTS; i++) sim.lengths[i] = nodes[i].distanceTo(nodes[i + 1]);
}

function integrateSubstep(
  sim: LanyardSim,
  h: number,
  physics: PhysicsParams,
  windX: number,
  windZ: number,
): void {
  const { nodes, previous, velocities, body } = sim;
  for (let i = 1; i < JOINTS; i++) {
    velocities[i].y -= physics.gravity * h;
    velocities[i].x += windX * h;
    velocities[i].z += windZ * h;
    previous[i].copy(nodes[i]);
    nodes[i].addScaledVector(velocities[i], h);
  }
  body.previous.copy(body.position);
  body.previousQuaternion.copy(body.quaternion);
  applyGrabTorque(sim, h, physics);
  const up = scratch.a.set(0, 1, 0).applyQuaternion(body.quaternion);
  updateTwist(sim, up);
  if (!sim.grab) {
    const spin = body.angular.dot(up);
    body.angular.addScaledVector(up, (physics.twist * (sim.turn - sim.twist) - physics.twistDamping * spin) * h);
  }
  body.velocity.y -= physics.gravity * h;
  body.velocity.x += windX * 0.35 * h;
  body.velocity.z += windZ * 0.35 * h;
  body.position.addScaledVector(body.velocity, h);
  rotateBody(body.quaternion, scratch.f.copy(body.angular).multiplyScalar(h));
}

function solveConstraintPass(sim: LanyardSim, h: number, physics: PhysicsParams): void {
  for (let i = 0; i < JOINTS; i++) solveSegment(sim, i, h, physics);
  if (sim.grab) solvePin(sim.body, sim.grab, scratch.pin);
}

function solveSubstepConstraints(sim: LanyardSim, h: number, physics: PhysicsParams, alpha: number): void {
  sim.impulses.fill(0);
  if (sim.grab) scratch.pin.lerpVectors(sim.grab.from, sim.grab.target, alpha);
  for (let iter = 0; iter < ITERATIONS; iter++) solveConstraintPass(sim, h, physics);
}

function measureEnergy(sim: LanyardSim): number {
  let energy = sim.body.velocity.lengthSq() + sim.body.angular.lengthSq() * 0.3;
  for (let i = 1; i < JOINTS; i++) energy += sim.velocities[i].lengthSq() * 0.05;
  return energy;
}

export function stepSimulation(sim: LanyardSim, dt: number, physics: PhysicsParams, time: number): void {
  const steps = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-6));
  const h = dt / steps;
  const windX = physics.breeze * (Math.sin(time * 0.53) * 0.7 + Math.sin(time * 1.31 + 1.7) * 0.3) * 3;
  const windZ = physics.breeze * Math.sin(time * 0.37 + 0.6) * 2;
  const nodeDrag = Math.exp(-physics.nodeDrag * h);
  const linearDrag = Math.exp(-physics.linearDrag * h);
  const angularDrag = Math.exp(-physics.angularDrag * h);

  for (let s = 0; s < steps; s++) {
    integrateSubstep(sim, h, physics, windX, windZ);
    solveSubstepConstraints(sim, h, physics, (s + 1) / steps);
    integrateBodyAndDamp(sim, h, physics, linearDrag, angularDrag, nodeDrag);
  }

  sim.grab?.from.copy(sim.grab.target);
  sim.calm = measureEnergy(sim) < 2e-4 ? sim.calm + dt : 0;
}
