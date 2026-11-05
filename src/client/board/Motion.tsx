// What the director's beats and effects look like on the board. Movers read the current beat from the store every frame
// (getStore, not a subscription), so a walk animates without re-rendering React sixty times a second. The attack
// effects themselves (beams, rounds, missiles, slashes, blasts, shells, and the wreck's smoke) are drawn by AttackFx.tsx.
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { Group, Mesh, MeshBasicMaterial } from 'three'
import type { Axial } from '../engine'
import { clipFor, clipTimeAt, impactAt, lungeAt, SWING } from '../presentation/fxTiming'
import { getStore, useGame } from '../store'
import { Figure } from './Figure'
import { MotionContext, unitAnchors, type MotionRef } from './motionCue'
import { sideFacing } from './Machine'

export type WorldOf = (h: Axial) => [number, number, number]

/** How long a figure flinches after taking damage (ms). */
const HURT_MS = 450
/** How long a struck machine rocks back when a hit lands, as a fraction of the shot beat. */
const JOLT = 0.12
/** A melee dash stops this far short of the target's centre. */
const REACH = 0.62

export const clamp01 = (t: number): number => Math.max(0, Math.min(1, t))
const ease = (t: number): number => t * t * (3 - 2 * t)

/** How far through the current beat we are, 0 to 1. */
export function progress(): number {
  const s = getStore()
  return s.beatMs > 0 ? clamp01((performance.now() - s.beatStart) / s.beatMs) : 1
}

/**
 * Wraps a machine and moves it when the current beat is about it: along the engine's path for a move (with a hop when the
 * height changes); for an attack, turning to face the target with its clip driven by the beat (so the aim holds while the
 * weapon fires and each round kicks the arm), dashing in and back for a melee swing; and rocking back when a hit lands on it.
 */
export function UnitMover({ uid, side, home, worldOf, children }: { uid: string; side: 0 | 1; home: [number, number, number]; worldOf: WorldOf; children: ReactNode }) {
  const ref = useRef<Group>(null)
  const motion = useMemo<MotionRef>(() => ({ current: { clip: 'idle', beatS: 0 }, model: null }), [])
  useEffect(() => {
    unitAnchors.set(uid, { group: ref, motion })
    return () => {
      if (unitAnchors.get(uid)?.motion === motion) unitAnchors.delete(uid)
    }
  }, [uid, motion])
  useFrame(() => {
    const g = ref.current
    if (!g) return
    const st = getStore()
    const b = st.beat
    let [x, y, z] = home
    let yaw = 0
    const hurtAt = st.hurt[uid]
    motion.current = hurtAt !== undefined && performance.now() - hurtAt < HURT_MS ? { clip: 'hit', beatS: HURT_MS / 1000 } : { clip: 'idle', beatS: 0 }
    if (b && 'uid' in b && b.uid === uid) {
      const t = progress()
      if (b.kind === 'move' && b.path.length > 1) {
        const pts = b.path.map(worldOf)
        const span = t * (pts.length - 1)
        const i = Math.min(pts.length - 2, Math.floor(span))
        const f = ease(span - i)
        const a = pts[i]!
        const c = pts[i + 1]!
        x = a[0] + (c[0] - a[0]) * f
        z = a[2] + (c[2] - a[2]) * f
        // a hop on a change of level, a slight bob on the flat
        const hop = a[1] !== c[1] ? 0.35 * Math.sin(Math.PI * f) : 0.03 * Math.sin(Math.PI * f)
        const segS = b.dur / (pts.length - 1)
        motion.current = b.dash ? { clip: 'fly', beatS: b.dur } : a[1] !== c[1] ? { clip: 'jump', beatS: segS } : { clip: 'walk', beatS: b.dur }
        y = a[1] + (c[1] - a[1]) * f + hop
        yaw = Math.atan2(c[0] - a[0], c[2] - a[2]) - sideFacing(side)
      } else if (b.kind === 'shot') {
        const to = worldOf(b.to)
        const dx = to[0] - x
        const dz = to[2] - z
        yaw = Math.atan2(dx, dz) - sideFacing(side)
        motion.current = { clip: clipFor(b.fx), beatS: b.dur, at: clipTimeAt(b.fx, t) }
        if (b.fx === 'melee') {
          // dash in to just short of the target, hold through the swing, then back
          const len = Math.hypot(dx, dz) || 1
          const l = Math.max(0.2, len - REACH) * lungeAt(t)
          x += (dx / len) * l
          z += (dz / len) * l
          y += (t < SWING.dashEnd ? 0.12 * Math.sin((Math.PI * t) / SWING.dashEnd) : 0) + Math.max(0, to[1] - home[1]) * lungeAt(t)
        }
      }
    } else if (b && b.kind === 'shot' && b.struck.includes(uid)) {
      // struck: rock back, away from the attacker, when the hit lands
      const k = (progress() - impactAt(b.fx)) / JOLT
      if (k >= 0 && k < 1) {
        const from = st.game?.units[b.uid]?.hex
        const src = from ? worldOf(from) : home
        const dx = home[0] - src[0]
        const dz = home[2] - src[2]
        const len = Math.hypot(dx, dz) || 1
        const push = 0.16 * Math.sin(Math.PI * k) * (1 - 0.5 * k)
        x += (dx / len) * push
        z += (dz / len) * push
        motion.current = { clip: 'hit', beatS: HURT_MS / 1000 }
      }
    }
    g.position.set(x, y, z)
    g.rotation.y = yaw
  })
  return (
    <MotionContext.Provider value={motion}>
      <group ref={ref} position={home}>
        {children}
      </group>
    </MotionContext.Provider>
  )
}

/** How far behind its Base a deploying machine starts, how high, and how wide the cone of directions it may come from. */
export const DEPLOY_FROM = 4.5
export const DEPLOY_HEIGHT = 3.2
export const DEPLOY_SPREAD = (70 * Math.PI) / 180

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * A machine arriving from Reserve: it flies in fast and low from somewhere behind its Base, heading on toward the enemy's
 * Base, and settles onto the hex, turning to its standing facing as it lands. The direction is random within a cone behind
 * the Base (an interface choice, so Math.random is fine).
 */
export function DeployGhost({ defId, side, at, toward, worldOf }: { defId: string; side: 0 | 1; at: Axial; toward: [number, number, number] | null; worldOf: WorldOf }) {
  const ref = useRef<Group>(null)
  const home = worldOf(at)
  const flight = useMemo(() => {
    // the way ahead, flat: towards the enemy's Base, or the side's facing if there is none
    let fx = toward ? toward[0] - home[0] : Math.sin(sideFacing(side))
    let fz = toward ? toward[2] - home[2] : Math.cos(sideFacing(side))
    const len = Math.hypot(fx, fz) || 1
    fx /= len
    fz /= len
    // come from behind the Base, anywhere within the cone
    const a = (Math.random() * 2 - 1) * DEPLOY_SPREAD
    const bx = -(fx * Math.cos(a) - fz * Math.sin(a))
    const bz = -(fx * Math.sin(a) + fz * Math.cos(a))
    return {
      start: [home[0] + bx * DEPLOY_FROM, home[1] + DEPLOY_HEIGHT, home[2] + bz * DEPLOY_FROM] as const,
      // face along the flight (from the start towards the Base), relative to the side's standing facing
      yaw: wrapAngle(Math.atan2(-bx, -bz) - sideFacing(side)),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at.q, at.r, side])
  useFrame(() => {
    const g = ref.current
    if (!g) return
    const t = progress()
    // fast in, easing off for the landing
    const e = 1 - Math.pow(1 - t, 2)
    const s = flight.start
    g.position.set(s[0] + (home[0] - s[0]) * e, home[1] + (s[1] - home[1]) * Math.pow(1 - e, 2), s[2] + (home[2] - s[2]) * e)
    // nose along the flight, then turn to the standing facing over the last third
    const turn = clamp01((t - 0.65) / 0.35)
    g.rotation.y = flight.yaw * (1 - ease(turn))
  })
  return (
    <group ref={ref} position={flight.start as unknown as [number, number, number]}>
      <group rotation={[0, sideFacing(side), 0]}>
        <Figure defId={defId} side={side} pose="fly" />
      </group>
    </group>
  )
}

function Burst({ at, colour, born }: { at: [number, number, number]; colour: string; born: number }) {
  const ref = useRef<Mesh>(null)
  useFrame(() => {
    const m = ref.current
    if (!m) return
    const t = clamp01((performance.now() - born) / 450)
    m.scale.setScalar(0.2 + 0.9 * t)
    ;(m.material as MeshBasicMaterial).opacity = 0.9 * (1 - t)
  })
  return (
    <mesh ref={ref} position={[at[0], at[1] + 0.55, at[2]]}>
      <sphereGeometry args={[0.45, 16, 16]} />
      <meshBasicMaterial color={colour} transparent opacity={0.9} depthWrite={false} />
    </mesh>
  )
}

/** A small repeatable hash in [0, 1), so the wreck's flight and its smoke trail (drawn elsewhere) agree. */
export function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** How far out and up a wreck flies before it is gone, and the share of its time spent lifting off. */
const WRECK_OUT = 16
const WRECK_UP = 13
export const WRECK_LIFT = 0.2

/**
 * Where a destroyed machine is, `k` of the way through its exit (0 to 1). It shudders up off its hex, swings round to face
 * away, then boosts up and out of view behind its own side, within the same cone a deploying machine comes in from (it is
 * going back to Reserve, and comes back that way). The direction is picked from the effect's id, so it is the same every
 * frame and the smoke trail can follow it.
 */
export function wreckFlight(
  id: number,
  side: 0 | 1,
  at: readonly [number, number, number],
  k: number,
): { pos: [number, number, number]; yaw: number; pitch: number; roll: number; scale: number } {
  const facing = sideFacing(side)
  // behind its own side, anywhere in the cone
  const a = facing + Math.PI + (hash01(id) * 2 - 1) * DEPLOY_SPREAD
  const dx = Math.sin(a)
  const dz = Math.cos(a)
  const away = wrapAngle(a - facing)
  if (k < WRECK_LIFT) {
    const u = k / WRECK_LIFT
    const shake = 0.025 * Math.sin(u * 70) * (1 - u)
    return {
      pos: [at[0] + shake, at[1] + 0.45 * ease(u), at[2] - shake],
      yaw: away * ease(u),
      pitch: 0.15 * ease(u),
      roll: 0.22 * Math.sin(u * 9) * (1 - u),
      scale: 1,
    }
  }
  const u = (k - WRECK_LIFT) / (1 - WRECK_LIFT)
  const e = u * u
  return {
    pos: [at[0] + dx * WRECK_OUT * e, at[1] + 0.45 + WRECK_UP * Math.pow(u, 1.6), at[2] + dz * WRECK_OUT * e],
    yaw: away,
    // leaning into the boost, with a slow tumble from the damage
    pitch: 0.15 + 0.4 * Math.min(1, u * 3),
    roll: 0.35 * Math.sin(u * 5),
    scale: 1 - 0.35 * u,
  }
}

/** A destroyed machine: it lifts off its hex and flies rapidly up and out of view, back to Reserve. */
function Wreck({ id, defId, side, at, born, ms }: { id: number; defId: string; side: 0 | 1; at: [number, number, number]; born: number; ms: number }) {
  const ref = useRef<Group>(null)
  const tilt = useRef<Group>(null)
  useFrame(() => {
    const g = ref.current
    if (!g) return
    const f = wreckFlight(id, side, at, clamp01((performance.now() - born) / Math.max(1, ms)))
    g.position.set(f.pos[0], f.pos[1], f.pos[2])
    g.rotation.y = f.yaw
    g.scale.setScalar(f.scale)
    if (tilt.current) tilt.current.rotation.set(f.pitch, 0, f.roll)
  })
  return (
    <group ref={ref} position={at}>
      <group rotation={[0, sideFacing(side), 0]}>
        <group ref={tilt}>
          <Figure defId={defId} side={side} pose="fly" />
        </group>
      </group>
    </group>
  )
}

/** Every non-blocking effect now on screen. */
export function Effects({ worldOf, phase, round }: { worldOf: WorldOf; phase: number; round: number }) {
  const bursts = useGame((s) => s.bursts)
  const wrecks = useGame((s) => s.wrecks)
  const floats = useGame((s) => s.floats)
  const scorches = useGame((s) => s.scorches)
  return (
    <>
      {bursts.map((b) => <Burst key={b.id} at={worldOf(b.at)} colour={b.colour} born={b.born} />)}
      {wrecks.map((w) => <Wreck key={w.id} id={w.id} defId={w.defId} side={w.side} at={worldOf(w.at)} born={w.born} ms={w.ms} />)}
      {scorches
        .filter((s) => s.phase === phase && s.round === round)
        .map((s) => {
          const p = worldOf(s.at)
          return (
            <mesh key={s.id} position={[p[0], p[1] + 0.008, p[2]]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.34, 24]} />
              <meshBasicMaterial color="#050505" transparent opacity={0.7} depthWrite={false} />
            </mesh>
          )
        })}
      {floats.map((f) => {
        const p = worldOf(f.at)
        return (
          <Html key={f.id} position={[p[0], p[1] + 1.25, p[2]]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
            <div className="float" style={{ color: f.colour }}>{f.text}</div>
          </Html>
        )
      })}
    </>
  )
}
