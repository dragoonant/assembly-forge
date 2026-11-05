// The attack effects: what each kind of weapon (presentation/weaponFx.ts) looks like while its shot beat plays, and the
// smoke and sparks of a destroyed machine flying off. One layer, always mounted, redraws everything each frame as a
// function of the beat's progress (or the wreck's age), so a skip just ends it, ?slowmo slows all of it evenly, and nothing
// is created per shot: two instanced billboard fields (additive glow, and smoke) plus small pools of meshes (beam
// cylinders, tracers, missiles, a shell, a slash arc, shock rings, hex glows) are built once and shown or hidden.
//
// Muzzles, pods and blade tips come from the rigged model's bones where the rig has them (tools/rig/rigs.json says which
// hand aims and whether the gun is arm-held or a shoulder mount); a stand-in machine uses fixed offsets from its hex.
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Object3D,
} from 'three'
import rigsJson from '../../../tools/rig/rigs.json'
import type { Axial } from '../engine'
import { BEAM, BLAST, BURST, impactAt, SALVO, SHELL, SWING } from '../presentation/fxTiming'
import type { Beat } from '../presentation/plan'
import type { FxKind } from '../presentation/weaponFx'
import { getStore } from '../store'
import { unitAnchors } from './motionCue'
import { clamp01, hash01, progress, wreckFlight, WRECK_LIFT, type WorldOf } from './Motion'

type Shot = Extract<Beat, { kind: 'shot' }>
type RGB = readonly [number, number, number]

// Colours in display space (the billboard shaders write them as they are).
const COL = {
  white: [1, 1, 1],
  beam: [0.35, 0.85, 1],
  beamHot: [0.8, 0.98, 1],
  tracer: [1, 0.85, 0.45],
  flash: [1, 0.78, 0.38],
  fire: [1, 0.45, 0.12],
  fireHot: [1, 0.82, 0.42],
  spark: [1, 0.72, 0.3],
  exhaust: [1, 0.6, 0.22],
  boost: [0.45, 0.75, 1],
  slash: [0.7, 0.92, 1],
  smoke: [0.66, 0.66, 0.64],
  darkSmoke: [0.25, 0.24, 0.23],
  dust: [0.6, 0.54, 0.44],
} as const satisfies Record<string, RGB>

// ---------------------------------------------------------------- billboard fields

const BILLBOARD_VERT = /* glsl */ `
attribute vec4 aTint;
varying vec4 vTint;
varying vec2 vUv;
void main() {
  vUv = uv;
  vTint = aTint;
  vec4 mv = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
  mv.xy += position.xy * length(instanceMatrix[0].xyz);
  gl_Position = projectionMatrix * mv;
}`
// a soft glow with a white-hot core; additive, so overlapping glows build up like bloom
const GLOW_FRAG = /* glsl */ `
varying vec4 vTint;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = pow(max(0.0, 1.0 - d * 2.4), 1.5);
  float a = pow(1.0 - d, 2.2) + 0.9 * core;
  gl_FragColor = vec4(mix(vTint.rgb, vec3(1.0), 0.75 * core) * a, vTint.a);
}`
const SMOKE_FRAG = /* glsl */ `
varying vec4 vTint;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = (1.0 - smoothstep(0.2, 1.0, d)) * vTint.a;
  gl_FragColor = vec4(vTint.rgb * (0.78 + 0.3 * (1.0 - d)), a);
}`

/** A pool of camera-facing quads drawn in one call: `add` one per frame for each glow or puff, then `end`. */
class Field {
  readonly mesh: InstancedMesh
  private readonly tint: InstancedBufferAttribute
  private n = 0
  constructor(
    private readonly cap: number,
    material: ShaderMaterial,
  ) {
    const geo = new PlaneGeometry(1, 1)
    this.tint = new InstancedBufferAttribute(new Float32Array(cap * 4), 4)
    this.tint.setUsage(DynamicDrawUsage)
    geo.setAttribute('aTint', this.tint)
    this.mesh = new InstancedMesh(geo, material, cap)
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.renderOrder = 10
  }
  begin(): void {
    this.n = 0
  }
  add(p: Vector3, size: number, c: RGB, a: number): void {
    if (this.n >= this.cap || a <= 0.004 || size <= 0) return
    const m = this.mesh.instanceMatrix.array as Float32Array
    const o = this.n * 16
    m.fill(0, o, o + 16)
    m[o] = size
    m[o + 5] = size
    m[o + 10] = size
    m[o + 12] = p.x
    m[o + 13] = p.y
    m[o + 14] = p.z
    m[o + 15] = 1
    const t = this.tint.array as Float32Array
    t[this.n * 4] = c[0]
    t[this.n * 4 + 1] = c[1]
    t[this.n * 4 + 2] = c[2]
    t[this.n * 4 + 3] = Math.min(1, a)
    this.n++
  }
  end(): void {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    this.tint.needsUpdate = true
  }
  dispose(): void {
    this.mesh.geometry.dispose()
  }
}

// ---------------------------------------------------------------- shared geometry and materials (built once)

const shared = (() => {
  const glow = new ShaderMaterial({ vertexShader: BILLBOARD_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending })
  const smoke = new ShaderMaterial({ vertexShader: BILLBOARD_VERT, fragmentShader: SMOKE_FRAG, transparent: true, depthWrite: false, blending: NormalBlending })
  const add = (c: string, opacity: number): MeshBasicMaterial =>
    new MeshBasicMaterial({ color: c, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending, toneMapped: false })
  // the slash: a ring sector lit from its leading edge back along a trail, brightest at the outer (blade-tip) edge
  const slash = new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uHead; uniform float uTail; uniform float uAlpha; uniform vec3 uColor; uniform float uIn; uniform float uOut;
      varying vec2 vP;
      void main() {
        float behind = atan(vP.y, vP.x) - uHead;
        if (behind < 0.0 || behind > uTail) discard;
        float k = 1.0 - behind / uTail;
        float r = clamp((length(vP) - uIn) / (uOut - uIn), 0.0, 1.0);
        float rim = smoothstep(0.55, 1.0, r);
        float a = (0.35 + 0.9 * rim) * pow(k, 1.3) * smoothstep(0.0, 0.15, r) * uAlpha;
        gl_FragColor = vec4(mix(uColor, vec3(1.0), rim * k) * a, 1.0);
      }`,
    uniforms: { uHead: { value: 0 }, uTail: { value: 1.6 }, uAlpha: { value: 0 }, uColor: { value: new Vector3(...COL.slash) }, uIn: { value: 0.22 }, uOut: { value: 1.0 } },
    transparent: true,
    depthWrite: false,
    // drawn over the machines: the swing passes in front of and behind them, and a hidden slash reads as no slash
    depthTest: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  })
  return {
    glow,
    smoke,
    slash,
    tube: new CylinderGeometry(1, 1, 1, 12, 1, true),
    rod: new CylinderGeometry(1, 1, 1, 8, 1, false),
    ball: new SphereGeometry(1, 10, 8),
    arc: new RingGeometry(0.22, 1.0, 40, 1, -1.5, 3.0),
    ring: new RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2),
    hex: new CircleGeometry(0.54, 6, Math.PI / 6).rotateX(-Math.PI / 2),
    beamCore: add('#ffffff', 1),
    beamShell: add('#59d8ff', 0.55),
    beamHalo: add('#2aa8ff', 0.18),
    tracer: add('#ffd27a', 1),
    missile: new MeshBasicMaterial({ color: '#d9dde2' }),
    shell: new MeshBasicMaterial({ color: '#2b2d31' }),
    add,
  }
})()

// ---------------------------------------------------------------- small maths

const UP = new Vector3(0, 1, 0)
const tmpA = new Vector3()
const tmpB = new Vector3()
const tmpC = new Vector3()
const basis = new Matrix4()

const smooth = (t: number): number => t * t * (3 - 2 * t)
const fract = (x: number): number => x - Math.floor(x)
/** A repeatable unit direction for (seed, i), leaning up by `up` (0 none, 1 hemisphere). */
function dirOf(seed: number, i: number, up: number, out: Vector3): Vector3 {
  const a = hash01(seed * 7.13 + i * 13.7) * Math.PI * 2
  const y = up + (1 - up) * (hash01(seed * 3.1 + i * 5.3) * 2 - 1)
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  return out.set(Math.cos(a) * r, y, Math.sin(a) * r)
}

function bezier(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, s: number, out: Vector3): Vector3 {
  const u = 1 - s
  return out
    .copy(p0)
    .multiplyScalar(u * u * u)
    .addScaledVector(p1, 3 * u * u * s)
    .addScaledVector(p2, 3 * u * s * s)
    .addScaledVector(p3, s * s * s)
}

/** Place a unit cylinder from a to b with radius r. */
function stretch(m: Mesh, a: Vector3, b: Vector3, r: number): void {
  tmpC.subVectors(b, a)
  const len = tmpC.length()
  if (len < 1e-4 || r <= 0) return
  m.position.addVectors(a, b).multiplyScalar(0.5)
  m.quaternion.setFromUnitVectors(UP, tmpC.divideScalar(len))
  m.scale.set(r, len, r)
  m.visible = true
}

// ---------------------------------------------------------------- particles

/** One spark `age` (0 to 1) through its life: out along dir, slowing, falling, with a short streak behind it. */
function spark(g: Field, at: Vector3, dir: Vector3, age: number, dist: number, size: number, c: RGB = COL.spark): void {
  if (age < 0 || age >= 1) return
  for (let k = 0; k < 3; k++) {
    const a = age - k * 0.05
    if (a < 0) break
    const d = dist * (1 - (1 - a) * (1 - a))
    tmpA.copy(at).addScaledVector(dir, d)
    tmpA.y -= 0.9 * a * a * dist
    g.add(tmpA, size * (1 - 0.3 * k) * (1 - 0.5 * age), age < 0.3 ? COL.fireHot : c, (1 - age) * (1 - 0.35 * k))
  }
}

/** A burst of `n` sparks from `at`, starting at t0 and living `life` (both in beat fractions). */
function sparkBurst(g: Field, at: Vector3, t: number, t0: number, life: number, n: number, seed: number, dist: number, up = 0.35, bias?: Vector3, size = 0.1): void {
  if (t < t0 || t > t0 + life * 1.3) return
  for (let i = 0; i < n; i++) {
    const age = (t - t0) / (life * (0.7 + 0.6 * hash01(seed + i * 1.7)))
    dirOf(seed, i, up, tmpB)
    if (bias) tmpB.add(bias).normalize()
    spark(g, at, tmpB, age, dist * (0.6 + 0.6 * hash01(seed * 2.3 + i)), size)
  }
}

/** A glow that pops at t0 and fades over `life`. */
function flash(g: Field, at: Vector3, t: number, t0: number, life: number, size: number, c: RGB): void {
  const k = (t - t0) / life
  if (k < 0 || k >= 1) return
  g.add(at, size * (0.6 + 0.6 * Math.sqrt(k)), c, (1 - k) * 1.5)
}

/** An explosion: overlapping fire glows that swell and cool, a white core, sparks, then smoke. */
function explosion(g: Field, sm: Field, at: Vector3, t: number, t0: number, life: number, size: number, seed: number): void {
  const k = (t - t0) / life
  if (k < 0) return
  if (k < 1) {
    for (let i = 0; i < 6; i++) {
      dirOf(seed, i + 40, 0.3, tmpB)
      tmpA.copy(at).addScaledVector(tmpB, size * 0.32 * Math.sqrt(k))
      g.add(tmpA, size * (0.45 + 0.6 * k) * (0.7 + 0.5 * hash01(seed + i)), k < 0.3 ? COL.fireHot : COL.fire, (1 - k) * 1.2)
    }
    flash(g, at, t, t0, life * 0.35, size * 1.2, COL.white)
  }
  sparkBurst(g, at, t, t0, life * 1.2, 12, seed, size * 1.1, 0.45)
  smokePuffs(sm, at, t, t0 + life * 0.25, life * 2.4, 4, size * 0.9, seed, COL.darkSmoke, size * 0.6)
}

/** Puffs that swell, drift up and thin out. */
function smokePuffs(sm: Field, at: Vector3, t: number, t0: number, life: number, n: number, size: number, seed: number, c: RGB, rise: number): void {
  for (let i = 0; i < n; i++) {
    const k = (t - t0 - i * life * 0.06) / life
    if (k < 0 || k >= 1) continue
    dirOf(seed, i + 90, 0.2, tmpB)
    tmpA.copy(at).addScaledVector(tmpB, size * 0.35 * Math.sqrt(k))
    tmpA.y += rise * k
    sm.add(tmpA, size * (0.35 + 0.9 * Math.sqrt(k)), c, 0.6 * (1 - k) * Math.min(1, k * 6))
  }
}

// ---------------------------------------------------------------- the shooter

interface RigSpec {
  main_hand?: string
  shot_hand?: string
  shot?: string
  bones?: { name: string }[]
}
const RIGS = rigsJson as unknown as Record<string, RigSpec>
const boneCache = new WeakMap<Object3D, Map<string, Object3D | null>>()
function bone(model: Object3D, name: string): Object3D | null {
  let m = boneCache.get(model)
  if (!m) boneCache.set(model, (m = new Map()))
  if (!m.has(name)) m.set(name, model.getObjectByName(name) ?? null)
  return m.get(name) ?? null
}

/** Where the shooter is this frame: its mover's position, its facing (flat, towards the target), its left, and its bones. */
interface Pose {
  base: Vector3
  facing: Vector3
  left: Vector3
  model: Object3D | null
  rig: RigSpec
}

function poseOf(uid: string, defId: string, home: Vector3, aim: Vector3, out: Pose): Pose {
  const a = unitAnchors.get(uid)
  if (a?.group.current) a.group.current.getWorldPosition(out.base)
  else out.base.copy(home)
  out.facing.set(aim.x - out.base.x, 0, aim.z - out.base.z)
  if (out.facing.lengthSq() < 1e-6) out.facing.set(0, 0, 1)
  out.facing.normalize()
  // the machine's left, facing +z, is +x
  out.left.set(out.facing.z, 0, -out.facing.x)
  out.model = a?.motion.model ?? null
  out.rig = RIGS[defId] ?? {}
  return out
}

type Mount = 'gun' | 'pod' | 'mortar' | 'blade' | 'back'

/** A point on the shooter: the gun's muzzle, a missile pod (idx alternates sides), the mortar tube, the blade tip, its back. */
function mountPoint(p: Pose, mount: Mount, idx: number, out: Vector3): Vector3 {
  const neck = p.model ? bone(p.model, 'head') : null
  const top = neck ? neck.getWorldPosition(tmpA) : tmpA.copy(p.base).addScaledVector(UP, 0.75)
  const handAt = (side: string, ext: number): Vector3 | null => {
    if (!p.model) return null
    const hand = bone(p.model, 'hand_' + side)
    const fore = bone(p.model, 'forearm_' + side)
    if (!hand || !fore) return null
    hand.getWorldPosition(out)
    fore.getWorldPosition(tmpB)
    tmpB.subVectors(out, tmpB).normalize()
    return out.addScaledVector(tmpB, ext)
  }
  switch (mount) {
    case 'gun': {
      if (p.rig.shot !== 'mount') {
        const h = handAt(p.rig.shot_hand ?? p.rig.main_hand ?? 'R', 0.12)
        if (h) return h
        // a stand-in: the gun arm, out in front
        return out.copy(p.base).addScaledVector(UP, 0.62).addScaledVector(p.facing, 0.34).addScaledVector(p.left, -0.18)
      }
      // a shoulder or hip mount
      return out.copy(top).addScaledVector(UP, 0.14).addScaledVector(p.left, 0.2).addScaledVector(p.facing, 0.14)
    }
    case 'pod':
      return out.copy(top).addScaledVector(UP, 0.16).addScaledVector(p.facing, -0.12).addScaledVector(p.left, idx % 2 ? 0.17 : -0.17)
    case 'mortar':
      return out.copy(top).addScaledVector(UP, 0.22).addScaledVector(p.facing, -0.04).addScaledVector(p.left, 0.18)
    case 'back':
      return out.copy(top).addScaledVector(UP, -0.05).addScaledVector(p.facing, -0.26)
    case 'blade': {
      const long = (p.rig.bones ?? []).some((b) => b.name.startsWith('weapon'))
      const h = handAt(p.rig.main_hand ?? 'R', long ? 0.42 : 0.22)
      if (h) return h
      return out.copy(p.base).addScaledVector(UP, 0.6).addScaledVector(p.facing, 0.5)
    }
  }
}

// ---------------------------------------------------------------- the layer

interface Pools {
  root: Group
  glow: Field
  smoke: Field
  beam: [Mesh, Mesh, Mesh]
  tracers: Mesh[]
  missiles: Mesh[]
  shell: Mesh
  arc: Mesh
  rings: Mesh[]
  hexes: Mesh[]
}

function buildPools(): Pools {
  const root = new Group()
  const glow = new Field(480, shared.glow)
  const smoke = new Field(240, shared.smoke)
  const mesh = (geo: import('three').BufferGeometry, mat: import('three').Material, order = 9): Mesh => {
    const m = new Mesh(geo, mat)
    m.visible = false
    m.frustumCulled = false
    m.renderOrder = order
    root.add(m)
    return m
  }
  const beam: [Mesh, Mesh, Mesh] = [mesh(shared.tube, shared.beamHalo), mesh(shared.tube, shared.beamShell), mesh(shared.tube, shared.beamCore)]
  const tracers = Array.from({ length: BURST.rounds }, () => mesh(shared.rod, shared.tracer))
  const missiles = Array.from({ length: SALVO.missiles }, () => mesh(shared.rod, shared.missile, 0))
  const shell = mesh(shared.ball, shared.shell, 0)
  const arc = mesh(shared.arc, shared.slash)
  // each ring and hex glow fades on its own, so each has its own material
  const rings = Array.from({ length: 3 }, () => mesh(shared.ring, shared.add('#ffcf8a', 0)))
  const hexes = Array.from({ length: 12 }, () => mesh(shared.hex, shared.add('#ff7a2a', 0), 8))
  root.add(glow.mesh, smoke.mesh)
  return { root, glow, smoke, beam, tracers, missiles, shell, arc, rings, hexes }
}

const pose: Pose = { base: new Vector3(), facing: new Vector3(), left: new Vector3(), model: null, rig: {} }
const home = new Vector3()
const muzzle = new Vector3()
const aims: Vector3[] = Array.from({ length: 12 }, () => new Vector3())
const v1 = new Vector3()
const v2 = new Vector3()
const v3 = new Vector3()
const v4 = new Vector3()
const v5 = new Vector3()

/**
 * Every attack effect and the wrecks' smoke. Mount once in the scene; it reads the beat and the wrecks from the store each
 * frame.
 */
export function AttackFxLayer({ worldOf }: { worldOf: WorldOf }) {
  const pools = useMemo(buildPools, [])
  const world = useRef(worldOf)
  world.current = worldOf
  useEffect(
    () => () => {
      pools.glow.dispose()
      pools.smoke.dispose()
      for (const m of [...pools.rings, ...pools.hexes]) (m.material as MeshBasicMaterial).dispose()
    },
    [pools],
  )
  useFrame(() => {
    const P = pools
    for (const m of [...P.beam, ...P.tracers, ...P.missiles, P.shell, P.arc, ...P.rings, ...P.hexes]) m.visible = false
    P.glow.begin()
    P.smoke.begin()
    const st = getStore()
    const b = st.beat
    if (b && b.kind === 'shot' && st.game) drawShot(P, b, progress(), Math.round(st.beatStart) % 997, world.current)
    const now = performance.now()
    for (const w of st.wrecks) drawWreck(P, w.id, w.side, world.current(w.at), clamp01((now - w.born) / Math.max(1, w.ms)))
    P.glow.end()
    P.smoke.end()
  })
  return <primitive object={pools.root} />
}

function v(p: readonly [number, number, number], out: Vector3): Vector3 {
  return out.set(p[0], p[1], p[2])
}

function drawShot(P: Pools, b: Shot, t: number, seed: number, worldOf: WorldOf): void {
  const st = getStore()
  const u = st.game!.units[b.uid]
  if (!u?.hex) return
  v(worldOf(u.hex), home)
  // where the shots land: each target's chest, or wide and into the ground beside it on a miss
  const n = Math.min(aims.length, b.hits.length)
  for (let i = 0; i < n; i++) {
    v(worldOf(b.hits[i]!), aims[i]!).y += 0.55
  }
  poseOf(b.uid, u.defId, home, aims[0]!, pose)
  // land on the face of the target that looks at the shooter, not inside it, so the model does not hide the hit
  for (let i = 0; i < n; i++) {
    const a = aims[i]!
    tmpA.set(pose.base.x - a.x, 0, pose.base.z - a.z)
    const d = tmpA.length()
    if (d > 0.5) a.addScaledVector(tmpA.divideScalar(d), 0.3)
  }
  if (b.miss) {
    for (let i = 0; i < n; i++) {
      const a = aims[i]!
      const s = hash01(seed + i) < 0.5 ? -1 : 1
      a.addScaledVector(pose.left, s * 0.62).y -= 0.5
    }
  }
  const kind: FxKind = b.fx
  switch (kind) {
    case 'beam':
      drawBeam(P, t, seed)
      break
    case 'ballistic':
      drawBallistic(P, t, seed, b.miss)
      break
    case 'missile':
      drawMissiles(P, t, seed)
      break
    case 'melee':
      drawMelee(P, t, seed)
      break
    case 'blast':
      drawBlast(P, b, t, seed, worldOf)
      break
    case 'mortar':
      drawMortar(P, t, seed)
      break
  }
  // an area weapon of any other kind still lights every hex it catches when it lands
  if (kind !== 'blast' && b.area) drawAreaHexes(P, b.area, worldOf, t, impactAt(kind), 0.12, seed)
}

// ---------------------------------------------------------------- beam

function drawBeam(P: Pools, t: number, seed: number): void {
  const g = P.glow
  const aim = aims[0]!
  const m = mountPoint(pose, 'gun', 0, muzzle)
  // charge: a growing glow at the muzzle, with motes drawn in to it
  if (t >= BEAM.charge && t < BEAM.off) {
    const c = clamp01((t - BEAM.charge) / (BEAM.fire - BEAM.charge))
    const pulse = 1 + 0.15 * Math.sin(t * 160)
    g.add(m, (0.2 + 0.6 * c) * pulse, COL.beam, 0.5 + 0.5 * c)
    g.add(m, 0.1 + 0.22 * c, COL.white, c)
    if (t < BEAM.fire) {
      for (let i = 0; i < 16; i++) {
        const f = fract(c * 2.4 + hash01(i * 3.7))
        dirOf(7, i, 0, v1)
        v2.copy(m).addScaledVector(v1, (1 - f) * 0.6)
        g.add(v2, 0.07 + 0.07 * f, COL.beam, f * (0.4 + 0.6 * c))
      }
    }
  }
  // the beam itself: a white core in a blue shell in a wide faint halo, flickering, with glows along it for bloom
  if (t >= BEAM.fire && t < BEAM.off + 0.08) {
    const on = clamp01((t - BEAM.fire) / 0.03)
    const off = 1 - clamp01((t - BEAM.off) / 0.08)
    const w = off * (1 + 0.14 * Math.sin(t * 900) + 0.06 * Math.sin(t * 2300))
    const end = v1.copy(m).lerp(aim, on)
    const [halo, shell, core] = P.beam
    stretch(halo, m, end, 0.21 * w)
    stretch(shell, m, end, 0.085 * w)
    stretch(core, m, end, 0.032 * w)
    const len = m.distanceTo(end)
    const steps = Math.max(2, Math.ceil(len / 0.35))
    for (let k = 0; k <= steps; k++) {
      v2.copy(m).lerp(end, k / steps)
      g.add(v2, 0.42 * w, COL.beam, 0.16 * off)
    }
    g.add(m, 0.6 * w, COL.beam, 0.9 * off)
    if (on >= 1) {
      // the impact: a hot glow, and a fountain of sparks thrown back off the target
      g.add(aim, (0.85 + 0.2 * Math.sin(t * 700)) * w, COL.beam, 0.95 * off)
      g.add(aim, 0.42 * w, COL.white, off)
      tmpC.subVectors(m, aim).normalize().multiplyScalar(0.7).addScaledVector(UP, 0.4)
      v3.copy(tmpC)
      for (let i = 0; i < 18; i++) {
        const ph = (t - BEAM.fire) / 0.11 + hash01(i * 9.1)
        const cyc = Math.floor(ph)
        if (BEAM.fire + (cyc / 1) * 0.11 > BEAM.off) continue
        dirOf(seed + cyc * 17, i, 0.2, v4).add(v3).normalize()
        spark(g, aim, v4, fract(ph), 0.7, 0.06, COL.beamHot)
      }
    }
  }
  flash(g, m, t, BEAM.fire, 0.08, 1.0, COL.white)
  flash(g, aim, t, BEAM.fire + 0.03, 0.12, 1.8, COL.beamHot)
  smokePuffs(P.smoke, aim, t, BEAM.fire + 0.1, 0.6, 4, 0.45, seed, COL.smoke, 0.5)
}

// ---------------------------------------------------------------- ballistic

function drawBallistic(P: Pools, t: number, seed: number, miss: boolean): void {
  const g = P.glow
  const m = mountPoint(pose, 'gun', 0, muzzle)
  for (let i = 0; i < BURST.rounds; i++) {
    const f = BURST.first + i * BURST.gap
    if (t < f) break
    // each round lands a little apart; a miss sprays wider
    const spread = miss ? 0.35 : 0.13
    dirOf(seed, i, 0, v1)
    const hit = v2.copy(aims[0]!).addScaledVector(v1, spread)
    // muzzle flash: a hot star, a few sparks forward, a wisp of smoke
    flash(g, m, t, f, 0.07, 0.8, COL.flash)
    flash(g, m, t, f, 0.04, 0.4, COL.white)
    tmpC.copy(pose.facing).multiplyScalar(1.2)
    sparkBurst(g, m, t, f, 0.08, 4, seed + i * 11, 0.35, 0, tmpC, 0.06)
    smokePuffs(P.smoke, m, t, f + 0.02, 0.35, 1, 0.22, seed + i, COL.smoke, 0.2)
    // the tracer: a hot streak along the line
    const s = (t - f) / BURST.travel
    if (s >= 0 && s < 1) {
      const head = v3.copy(m).lerp(hit, s)
      const tail = v4.copy(m).lerp(hit, Math.max(0, s - 0.35))
      stretch(P.tracers[i]!, tail, head, 0.022)
      g.add(head, 0.3, COL.tracer, 1)
    }
    // the hit: a flash, sparks, a puff of dust
    const land = f + BURST.travel
    flash(g, hit, t, land, 0.09, 0.8, COL.flash)
    tmpC.subVectors(m, hit).normalize().multiplyScalar(0.6)
    sparkBurst(g, hit, t, land, 0.18, 9, seed * 3 + i, 0.55, 0.3, tmpC)
    smokePuffs(P.smoke, hit, t, land, 0.45, 2, 0.4, seed + i * 5, COL.dust, 0.2)
  }
}

// ---------------------------------------------------------------- missiles

function missilePath(i: number, seed: number, out: [Vector3, Vector3, Vector3, Vector3]): void {
  const [p0, p1, p2, p3] = out
  mountPoint(pose, 'pod', i, p0)
  const side = (i % 2 ? 1 : -1) * (0.4 + 0.5 * hash01(seed + i))
  p1.copy(p0).addScaledVector(UP, 1.5 + 0.5 * hash01(seed * 2 + i)).addScaledVector(pose.facing, -0.3).addScaledVector(pose.left, side)
  dirOf(seed, i + 20, 0, tmpC)
  p3.copy(aims[0]!).addScaledVector(tmpC, 0.16)
  p2.copy(p3).addScaledVector(UP, 1.3).addScaledVector(pose.left, side * 0.6)
}

const curve: [Vector3, Vector3, Vector3, Vector3] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]
const TRAIL = 26

function drawMissiles(P: Pools, t: number, seed: number): void {
  const g = P.glow
  for (let i = 0; i < SALVO.missiles; i++) {
    const l = SALVO.first + i * SALVO.gap
    if (t < l) break
    missilePath(i, seed, curve)
    const [p0, p1, p2, p3] = curve
    // the launch: a flash and a puff out of the pod
    flash(g, p0, t, l, 0.05, 0.5, COL.exhaust)
    smokePuffs(P.smoke, p0, t, l, 0.5, 2, 0.35, seed + i, COL.smoke, 0.25)
    const s = (t - l) / SALVO.flight
    const ss = Math.pow(clamp01(s), 1.25)
    // the smoke trail: puffs left at fixed points along the path, each fading after the missile passes
    for (let j = 1; j <= TRAIL; j++) {
      const sj = j / TRAIL
      if (ss < sj) break
      const age = (s - Math.pow(sj, 1 / 1.25)) / 0.9
      if (age >= 1) continue
      bezier(p0, p1, p2, p3, sj, v1)
      dirOf(seed + i, j, 0, v2)
      v1.addScaledVector(v2, 0.04 + 0.1 * age)
      P.smoke.add(v1, 0.1 + 0.32 * age, COL.smoke, 0.55 * (1 - age))
    }
    if (s < 1) {
      // the missile: a pale body along the curve, its exhaust glowing behind it
      bezier(p0, p1, p2, p3, ss, v1)
      bezier(p0, p1, p2, p3, Math.max(0, ss - 0.03), v2)
      tmpC.subVectors(v1, v2).normalize()
      v3.copy(v1).addScaledVector(tmpC, -0.17)
      stretch(P.missiles[i]!, v3, v1, 0.035)
      g.add(v3, 0.32 + 0.08 * Math.sin(t * 600 + i), COL.exhaust, 1)
      g.add(v3, 0.13, COL.white, 0.95)
    }
    explosion(g, P.smoke, p3, t, l + SALVO.flight, 0.16, 0.72, seed + i * 31)
  }
}

// ---------------------------------------------------------------- melee

function drawMelee(P: Pools, t: number, seed: number): void {
  const g = P.glow
  const aim = aims[0]!
  // the dash: thrusters at the back, dust kicked up at the start
  if (t < SWING.dashEnd + 0.04) {
    mountPoint(pose, 'back', 0, v1)
    const k = clamp01(t / SWING.dashEnd)
    g.add(v1, (0.3 + 0.1 * Math.sin(t * 500)) * (1 - 0.6 * k), COL.boost, 0.9)
    g.add(v1, 0.12, COL.white, 0.8 * (1 - k))
  }
  smokePuffs(P.smoke, v1.copy(home).addScaledVector(UP, 0.08), t, 0.01, 0.5, 4, 0.4, seed, COL.dust, 0.2)
  // the slash: an arc swept across the target, upper weapon side to lower off side
  const start = SWING.dashEnd - 0.03
  const end = SWING.strike + 0.03
  if (t >= start && t < end + 0.18) {
    const sweep = smooth(clamp01((t - start) / (end - start)))
    const fade = 1 - clamp01((t - end) / 0.18)
    const mat = shared.slash
    mat.uniforms.uHead!.value = 1.5 - 3.0 * sweep
    mat.uniforms.uTail!.value = 0.4 + 1.5 * sweep
    mat.uniforms.uAlpha!.value = 2.0 * fade
    const arc = P.arc
    arc.position.copy(pose.base).addScaledVector(UP, 0.62).addScaledVector(pose.facing, 0.12)
    // a flat, slightly rising sweep, so it reads from the raised tactics camera at any angle (a steep arc goes edge-on)
    const roll = (pose.rig.main_hand ?? 'R') === 'L' ? -1.15 : 1.15
    // local x along the facing; local y is up, rolled most of the way toward the weapon side
    v2.copy(UP).multiplyScalar(Math.cos(roll)).addScaledVector(pose.left, -Math.sin(roll))
    v3.crossVectors(pose.facing, v2)
    basis.makeBasis(pose.facing, v2, v3)
    arc.quaternion.setFromRotationMatrix(basis)
    arc.scale.setScalar(1)
    arc.visible = true
    // the blade tip glints as it travels
    if (t < end) g.add(mountPoint(pose, 'blade', 0, v4), 0.28, COL.slash, 0.9)
  }
  // the impact: a white flash, sparks thrown off, a shock ring on the ground, dust
  const hitT = SWING.strike
  flash(g, aim, t, hitT, 0.1, 1.5, COL.white)
  flash(g, aim, t, hitT, 0.18, 1.1, COL.flash)
  tmpC.copy(pose.facing).multiplyScalar(0.7)
  sparkBurst(g, aim, t, hitT, 0.2, 20, seed, 0.85, 0.35, tmpC, 0.08)
  ring(P, 0, v1.set(aim.x, aim.y - 0.53, aim.z), t, hitT, 0.25, 1.3)
  smokePuffs(P.smoke, v1, t, hitT, 0.55, 5, 0.5, seed + 3, COL.dust, 0.25)
}

/** A shock ring spreading on the ground from `at`. */
function ring(P: Pools, i: number, at: Vector3, t: number, t0: number, life: number, size: number): void {
  const k = (t - t0) / life
  const m = P.rings[i]
  if (!m || k < 0 || k >= 1) return
  m.position.copy(at).y += 0.03
  m.scale.setScalar(0.15 + size * Math.sqrt(k))
  ;(m.material as MeshBasicMaterial).opacity = 0.9 * (1 - k)
  m.visible = true
}

// ---------------------------------------------------------------- area

const order: { h: Axial; d: number }[] = []

/** Light every hex in the area as the wave reaches it (from t0, `spread` to reach the far edge), with a burst on each. */
function drawAreaHexes(P: Pools, area: Axial[], worldOf: WorldOf, t: number, t0: number, spread: number, seed: number, big = false): void {
  order.length = 0
  for (const h of area) {
    const p = worldOf(h)
    order.push({ h, d: Math.hypot(p[0] - home.x, p[2] - home.z) })
  }
  const lo = Math.min(...order.map((o) => o.d))
  const hi = Math.max(...order.map((o) => o.d))
  order.forEach((o, i) => {
    const ti = t0 + (hi > lo ? ((o.d - lo) / (hi - lo)) * spread : 0)
    const p = v(worldOf(o.h), v5)
    const k = (t - ti) / 0.5
    const m = P.hexes[i]
    if (m && k >= 0) {
      m.position.set(p.x, p.y + 0.02, p.z)
      ;(m.material as MeshBasicMaterial).opacity = k < 1 ? 0.75 * (1 - 0.7 * k) : 0.22
      m.visible = true
    }
    v1.copy(p).y += big ? 0.3 : 0.25
    explosion(P.glow, P.smoke, v1, t, ti, big ? 0.24 : 0.16, big ? 1.05 : 0.6, seed + i * 13)
  })
}

function drawBlast(P: Pools, b: Shot, t: number, seed: number, worldOf: WorldOf): void {
  const g = P.glow
  const m = mountPoint(pose, 'gun', 0, muzzle)
  // a short charge, then the discharge: a big flash and a cone of sparks towards the pattern
  if (t < BLAST.fire) {
    const c = clamp01((t - 0.12) / (BLAST.fire - 0.12))
    g.add(m, 0.1 + 0.35 * c, COL.fire, c)
  }
  flash(g, m, t, BLAST.fire, 0.1, 1.3, COL.fireHot)
  tmpC.copy(pose.facing).multiplyScalar(1.5)
  sparkBurst(g, m, t, BLAST.fire, 0.15, 14, seed, 1.1, 0, tmpC, 0.06)
  // the pressure wave: glows racing out from the muzzle to the far edge of the pattern
  const k = (t - BLAST.fire) / (BLAST.spread + 0.04)
  if (k >= 0 && k < 1) {
    for (let i = 0; i < Math.min(aims.length, b.hits.length); i++) {
      v1.copy(m).lerp(aims[i]!, k)
      g.add(v1, 0.55, COL.fire, 0.7 * (1 - k))
    }
  }
  drawAreaHexes(P, b.area ?? b.hits, worldOf, t, BLAST.fire + 0.04, BLAST.spread, seed, true)
}

// ---------------------------------------------------------------- mortar

function drawMortar(P: Pools, t: number, seed: number): void {
  const g = P.glow
  const p0 = mountPoint(pose, 'mortar', 0, muzzle)
  const aim = v5.copy(aims[0]!)
  aim.y -= 0.3
  const dist = Math.hypot(aim.x - p0.x, aim.z - p0.z)
  const H = Math.min(2.6, 1.4 + dist * 0.15)
  const at = (s: number, out: Vector3): Vector3 => out.copy(p0).lerp(aim, s).addScaledVector(UP, 4 * H * s * (1 - s))
  // the launch: a heavy flash and a cloud out of the tube
  flash(g, p0, t, SHELL.launch, 0.08, 1.0, COL.flash)
  tmpC.copy(UP).multiplyScalar(1.2)
  sparkBurst(g, p0, t, SHELL.launch, 0.12, 8, seed, 0.5, 0.6, tmpC, 0.05)
  smokePuffs(P.smoke, p0, t, SHELL.launch, 0.7, 5, 0.5, seed, COL.smoke, 0.5)
  const span = SHELL.land - SHELL.launch
  const s = (t - SHELL.launch) / span
  // the trail: thin smoke left along the arc
  for (let j = 1; j <= TRAIL; j++) {
    const sj = j / TRAIL
    if (s < sj) break
    const age = (s - sj) / 0.8
    if (age >= 1) continue
    at(sj, v1)
    P.smoke.add(v1, 0.13 + 0.3 * age, COL.smoke, 0.6 * (1 - age))
  }
  if (s >= 0 && s < 1) {
    at(s, v1)
    P.shell.position.copy(v1)
    P.shell.scale.setScalar(0.06)
    P.shell.visible = true
    g.add(v1, 0.55 + 0.08 * Math.sin(t * 500), COL.exhaust, 1)
    g.add(v1, 0.14, COL.white, 0.8)
  }
  // the landing: a big explosion, a shock ring, debris and a column of smoke
  explosion(g, P.smoke, v1.copy(aim).addScaledVector(UP, 0.3), t, SHELL.land, 0.2, 1.35, seed)
  ring(P, 0, v2.copy(aim).setY(aim.y - 0.25), t, SHELL.land, 0.22, 1.7)
  sparkBurst(g, v2.copy(aim).addScaledVector(UP, 0.1), t, SHELL.land, 0.22, 18, seed + 5, 1.2, 0.75)
}

// ---------------------------------------------------------------- the wreck flying off

const wreckAt = new Vector3()

function drawWreck(P: Pools, id: number, side: 0 | 1, at: [number, number, number], k: number): void {
  const g = P.glow
  const sm = P.smoke
  const ground = v(at, wreckAt)
  const seed = id * 7
  // the blow-out: a flash, a shower of sparks and smoke off the hex
  v1.copy(ground).addScaledVector(UP, 0.55)
  flash(g, v1, k, 0, 0.16, 2.0, COL.fireHot)
  flash(g, v1, k, 0, 0.08, 1.0, COL.white)
  sparkBurst(g, v1, k, 0.01, 0.3, 26, seed, 1.3, 0.55, undefined, 0.08)
  smokePuffs(sm, v2.copy(ground).addScaledVector(UP, 0.2), k, 0, 0.9, 6, 0.75, seed, COL.darkSmoke, 1.1)
  // the take-off: a thruster blast on the deck
  ring(P, 1, ground, k, WRECK_LIFT * 0.8, 0.25, 1.4)
  // a smoke trail along the flight
  for (let j = 0; j < 30; j++) {
    const kj = WRECK_LIFT * 0.6 + j * 0.028
    if (k < kj) break
    const age = (k - kj) / 0.35
    if (age >= 1) continue
    const f = wreckFlight(id, side, at, kj)
    dirOf(seed, j, 0, v3)
    v1.set(f.pos[0], f.pos[1] + 0.45 * f.scale, f.pos[2]).addScaledVector(v3, 0.08 + 0.2 * age)
    sm.add(v1, (0.22 + 0.6 * age) * f.scale, j % 3 ? COL.darkSmoke : COL.smoke, 0.65 * (1 - age))
  }
  // on the machine: its thrusters, a fire in its chest, sparks still spitting from it
  if (k < 0.97) {
    const f = wreckFlight(id, side, at, k)
    v1.set(f.pos[0], f.pos[1] + 0.25 * f.scale, f.pos[2])
    const boost = k < WRECK_LIFT ? k / WRECK_LIFT : 1
    g.add(v1, (0.45 + 0.12 * Math.sin(k * 400)) * f.scale * boost, COL.boost, 0.95)
    g.add(v1, 0.18 * f.scale * boost, COL.white, 0.9)
    v2.set(f.pos[0], f.pos[1] + 0.62 * f.scale, f.pos[2])
    g.add(v2, (0.3 + 0.08 * Math.sin(k * 230)) * f.scale, COL.fire, 0.85)
    for (let i = 0; i < 6; i++) {
      const ph = k / 0.08 + hash01(seed + i)
      dirOf(seed + Math.floor(ph) * 5, i, 0.1, v3)
      spark(g, v2, v3, fract(ph), 0.45 * f.scale, 0.05)
    }
  }
}
