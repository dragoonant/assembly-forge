// What the director's beats and effects look like on the board. Movers read the current beat from the store every frame
// (getStore, not a subscription), so a walk animates without re-rendering React sixty times a second.
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, type ReactNode } from 'react'
import type { Group, Mesh, MeshBasicMaterial } from 'three'
import type { Axial } from '../engine'
import { getStore, useGame } from '../store'
import { Figure } from './Figure'
import { MotionContext, type MotionCue } from './motionCue'
import { sideFacing } from './Machine'

export type WorldOf = (h: Axial) => [number, number, number]

/** How long a figure flinches after taking damage (ms). */
const HURT_MS = 450

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t))
const ease = (t: number): number => t * t * (3 - 2 * t)

function progress(): number {
  const s = getStore()
  return s.beatMs > 0 ? clamp01((performance.now() - s.beatStart) / s.beatMs) : 1
}

/**
 * Wraps a machine and moves it when the current beat is about it: along the engine's path for a move (with a hop when the
 * height changes), turning to face the target and lunging for a melee shot.
 */
export function UnitMover({ uid, side, home, worldOf, children }: { uid: string; side: 0 | 1; home: [number, number, number]; worldOf: WorldOf; children: ReactNode }) {
  const ref = useRef<Group>(null)
  const cue = useRef<MotionCue>({ clip: 'idle', beatS: 0 })
  useFrame(() => {
    const g = ref.current
    if (!g) return
    const st = getStore()
    const b = st.beat
    let [x, y, z] = home
    let yaw = 0
    const hurtAt = st.hurt[uid]
    cue.current = hurtAt !== undefined && performance.now() - hurtAt < HURT_MS ? { clip: 'hit', beatS: HURT_MS / 1000 } : { clip: 'idle', beatS: 0 }
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
        cue.current = b.dash ? { clip: 'fly', beatS: b.dur } : a[1] !== c[1] ? { clip: 'jump', beatS: segS } : { clip: 'walk', beatS: b.dur }
        y = a[1] + (c[1] - a[1]) * f + hop
        yaw = Math.atan2(c[0] - a[0], c[2] - a[2]) - sideFacing(side)
      } else if (b.kind === 'shot') {
        const to = worldOf(b.to)
        const dx = to[0] - x
        const dz = to[2] - z
        yaw = Math.atan2(dx, dz) - sideFacing(side)
        cue.current = { clip: b.melee ? 'melee' : 'shoot', beatS: b.dur }
        if (b.melee) {
          const len = Math.hypot(dx, dz) || 1
          const l = 0.35 * Math.sin(Math.PI * t)
          x += (dx / len) * l
          z += (dz / len) * l
        }
      }
    }
    g.position.set(x, y, z)
    g.rotation.y = yaw
  })
  return (
    <MotionContext.Provider value={cue}>
      <group ref={ref} position={home}>
        {children}
      </group>
    </MotionContext.Provider>
  )
}

/** A machine arriving from Reserve: it drops onto its Base. */
export function DeployGhost({ defId, side, at, worldOf }: { defId: string; side: 0 | 1; at: Axial; worldOf: WorldOf }) {
  const ref = useRef<Group>(null)
  const home = worldOf(at)
  useFrame(() => {
    const g = ref.current
    if (!g) return
    const t = ease(progress())
    g.position.set(home[0], home[1] + (1 - t) * 2.2, home[2])
    g.scale.setScalar(0.6 + 0.4 * t)
  })
  return (
    <group ref={ref} position={home}>
      <group rotation={[0, sideFacing(side), 0]}>
        <Figure defId={defId} side={side} pose="fly" />
      </group>
    </group>
  )
}

/** A ranged shot: a bright slug from the shooter's weapon to the target. */
export function Tracer({ from, to }: { from: [number, number, number]; to: [number, number, number] }) {
  const ref = useRef<Mesh>(null)
  useFrame(() => {
    const m = ref.current
    if (!m) return
    const t = progress()
    m.position.set(from[0] + (to[0] - from[0]) * t, from[1] + 0.7 + (to[1] + 0.55 - from[1] - 0.7) * t, from[2] + (to[2] - from[2]) * t)
  })
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.07, 10, 10]} />
      <meshBasicMaterial color="#ffe39a" />
    </mesh>
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

/** A destroyed machine: it lurches, topples and sinks into the deck. */
function Wreck({ defId, side, at, born }: { defId: string; side: 0 | 1; at: [number, number, number]; born: number }) {
  const ref = useRef<Group>(null)
  useFrame(() => {
    const g = ref.current
    if (!g) return
    const t = clamp01((performance.now() - born) / 900)
    g.rotation.z = (side === 0 ? -1 : 1) * 1.2 * ease(t)
    g.position.set(at[0], at[1] - 0.6 * t * t, at[2])
    g.scale.setScalar(1 - 0.4 * t)
  })
  return (
    <group ref={ref} position={at}>
      <group rotation={[0, sideFacing(side), 0]}>
        <Figure defId={defId} side={side} pose="destroyed" />
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
      {wrecks.map((w) => <Wreck key={w.id} defId={w.defId} side={w.side} at={worldOf(w.at)} born={w.born} />)}
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
