// Stand-in machines until the generated models arrive (M4). Built in the house figure proportions (PLAN.md §5): about 2.8
// head-heights tall with the sensor head a third of the height, shoulders about 1.8 head-widths, a deep chest, short heavy
// legs on a wide stance, and two oversized weapons. One silhouette per archetype, side colour on the shoulders and chest.
//
// The base's jobs are done by a ring painted flat on the hex under the machine: the side-colour rim, a pulsing amber ring
// when it can act, white when its card is pinned, red when it can be attacked right now.
import { Billboard } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group, Mesh, MeshBasicMaterial } from 'three'

export const SIDE_COLOUR = ['#c8463a', '#3a78c8'] as const
const BODY = '#8d939c'
const DARK = '#3b4048'
const VISOR = '#ffcf6a'

/** Total height of a machine in world units (one hex is 1 across the flats). */
export const MACHINE_HEIGHT = 1.1

interface Build {
  /** Overall bulk multiplier on widths. */
  bulk: number
  /** Primary weapon: barrel length and thickness, or a melee head. */
  gun: { len: number; r: number }
  melee?: { len: number; w: number }
  /** A mortar tube on the back. */
  mortar?: boolean
  /** A shield slab on the off arm. */
  shield?: boolean
}

/** One build per archetype, keyed by definition id. Our own designs; names live in names.js. */
const BUILDS: Record<string, Build> = {
  u01: { bulk: 1.0, gun: { len: 0.42, r: 0.035 }, shield: true },
  u02: { bulk: 0.88, gun: { len: 0.3, r: 0.03 }, melee: { len: 0.5, w: 0.05 } },
  u03: { bulk: 0.86, gun: { len: 0.78, r: 0.045 } },
  u04: { bulk: 1.08, gun: { len: 0.34, r: 0.05 }, melee: { len: 0.22, w: 0.12 } },
  u05: { bulk: 1.16, gun: { len: 0.26, r: 0.03 }, melee: { len: 0.62, w: 0.14 } },
  u06: { bulk: 1.04, gun: { len: 0.3, r: 0.035 }, mortar: true },
}

function Box({ p, s, c, emissive }: { p: [number, number, number]; s: [number, number, number]; c: string; emissive?: string }) {
  return (
    <mesh position={p} castShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} roughness={0.55} metalness={0.45} emissive={emissive ?? '#000000'} emissiveIntensity={emissive ? 1.2 : 0} />
    </mesh>
  )
}

/** The figure itself, facing +z, feet at y = 0. */
function Rig({ defId, side }: { defId: string; side: 0 | 1 }) {
  const b = BUILDS[defId] ?? BUILDS.u01!
  const accent = SIDE_COLOUR[side]
  const head = MACHINE_HEIGHT / 2.8 // about 0.39
  const legH = head * 0.95
  const pelvis = 0.07
  const torsoH = head * 0.85
  const headW = 0.28 * b.bulk
  const shoulderW = headW * 1.8
  const torsoY = legH + pelvis + torsoH / 2
  const headY = legH + pelvis + torsoH + head * 0.42
  const armY = legH + pelvis + torsoH * 0.62
  return (
    <group>
      {/* legs: short and heavy, wide stance, big feet */}
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * shoulderW * 0.26, 0, 0]}>
          <Box p={[0, legH * 0.5, 0]} s={[0.13 * b.bulk, legH, 0.15 * b.bulk]} c={BODY} />
          <Box p={[0, 0.035, 0.04]} s={[0.17 * b.bulk, 0.07, 0.26 * b.bulk]} c={DARK} />
        </group>
      ))}
      <Box p={[0, legH + pelvis / 2, 0]} s={[shoulderW * 0.6, pelvis + 0.02, 0.2 * b.bulk]} c={DARK} />
      {/* deep chest with a side-colour plate */}
      <Box p={[0, torsoY, 0]} s={[shoulderW * 0.72, torsoH, 0.3 * b.bulk]} c={BODY} />
      <Box p={[0, torsoY + torsoH * 0.12, 0.155 * b.bulk]} s={[shoulderW * 0.4, torsoH * 0.42, 0.02]} c={accent} />
      {/* broad armoured shoulders in the side colour */}
      {[-1, 1].map((sx) => (
        <Box key={sx} p={[sx * shoulderW * 0.5, legH + pelvis + torsoH * 0.88, 0]} s={[0.2 * b.bulk, 0.14, 0.26 * b.bulk]} c={accent} />
      ))}
      {/* sensor head with a visor, a third of the height */}
      <Box p={[0, headY, 0]} s={[headW, head * 0.62, headW * 0.95]} c={BODY} />
      <Box p={[0, headY + head * 0.04, headW * 0.48]} s={[headW * 0.78, head * 0.14, 0.02]} c={DARK} emissive={VISOR} />
      {/* arms */}
      {[-1, 1].map((sx) => (
        <Box key={sx} p={[sx * shoulderW * 0.56, armY - 0.06, 0.02]} s={[0.1 * b.bulk, torsoH * 0.9, 0.12 * b.bulk]} c={BODY} />
      ))}
      {/* the main weapon, right arm, oversized */}
      <mesh position={[shoulderW * 0.58, armY - 0.14, b.gun.len / 2 + 0.06]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[b.gun.r, b.gun.r * 1.15, b.gun.len, 10]} />
        <meshStandardMaterial color={DARK} roughness={0.4} metalness={0.7} />
      </mesh>
      {b.melee && (
        <Box p={[-shoulderW * 0.6, armY - 0.12, b.melee.len / 2 + 0.05]} s={[b.melee.w, 0.04, b.melee.len]} c="#c9ced6" />
      )}
      {b.shield && <Box p={[-shoulderW * 0.68, armY - 0.08, 0.1]} s={[0.04, torsoH * 1.1, 0.3 * b.bulk]} c={accent} />}
      {b.mortar && (
        <mesh position={[0, torsoY + torsoH * 0.55, -0.2 * b.bulk]} rotation={[-0.5, 0, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.08, 0.36, 10]} />
          <meshStandardMaterial color={DARK} roughness={0.4} metalness={0.7} />
        </mesh>
      )}
    </group>
  )
}

export interface MachineProps {
  uid: string
  defId: string
  side: 0 | 1
  position: [number, number, number]
  hp: number
  maxHp: number
  statuses: string[]
  active: boolean
  selected: boolean
  targetable: boolean
  onClick: (e: ThreeEvent<MouseEvent>) => void
  onHover: (over: boolean) => void
}

const STATUS_COLOUR: Record<string, string> = { slow: '#7fb3ff', fracture: '#ff8a5c', disarm: '#e6d45a', blinded: '#b48cff' }

export function Machine(p: MachineProps) {
  const pulse = useRef<Mesh>(null)
  const group = useRef<Group>(null)
  useFrame(({ clock }) => {
    const m = pulse.current
    if (m) {
      const t = (Math.sin(clock.elapsedTime * 4) + 1) / 2
      ;(m.material as MeshBasicMaterial).opacity = 0.35 + 0.55 * t
    }
  })
  // side 0 sits at the left edge and faces +x; side 1 faces -x
  const facing = p.side === 0 ? Math.PI / 2 : -Math.PI / 2
  const frac = Math.max(0, p.hp / p.maxHp)
  return (
    <group ref={group} position={p.position} name={`unit-${p.uid}`}
      onClick={(e) => { e.stopPropagation(); p.onClick(e) }}
      onPointerOver={(e) => { e.stopPropagation(); p.onHover(true) }}
      onPointerOut={() => p.onHover(false)}>
      {/* ground ring decal */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <ringGeometry args={[0.33, 0.4, 40]} />
        <meshBasicMaterial color={SIDE_COLOUR[p.side]} />
      </mesh>
      {p.active && (
        <mesh ref={pulse} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]}>
          <ringGeometry args={[0.41, 0.47, 40]} />
          <meshBasicMaterial color="#f0a830" transparent opacity={0.8} />
        </mesh>
      )}
      {p.selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.009, 0]}>
          <ringGeometry args={[0.27, 0.31, 40]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      )}
      {p.targetable && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <ringGeometry args={[0.41, 0.48, 6, 1, Math.PI / 6]} />
          <meshBasicMaterial color="#ff3b30" />
        </mesh>
      )}
      <group rotation={[0, facing, 0]}>
        <Rig defId={p.defId} side={p.side} />
      </group>
      {/* an invisible hit capsule sized to the machine, so a click lands on it rather than the hex behind */}
      <mesh position={[0, MACHINE_HEIGHT / 2, 0]} visible={false}>
        <cylinderGeometry args={[0.3, 0.3, MACHINE_HEIGHT, 8]} />
        <meshBasicMaterial />
      </mesh>
      <Billboard position={[0, MACHINE_HEIGHT + 0.18, 0]}>
        <mesh position={[0, 0, 0]}>
          <planeGeometry args={[0.62, 0.07]} />
          <meshBasicMaterial color="#111317" />
        </mesh>
        <mesh position={[-(0.6 * (1 - frac)) / 2, 0, 0.001]}>
          <planeGeometry args={[0.6 * frac, 0.05]} />
          <meshBasicMaterial color={frac > 0.5 ? '#5fd17a' : frac > 0.25 ? '#f0c040' : '#ff5a4a'} />
        </mesh>
        {p.statuses.map((s, i) => (
          <mesh key={s} position={[-0.24 + i * 0.12, 0.11, 0]}>
            <circleGeometry args={[0.045, 16]} />
            <meshBasicMaterial color={STATUS_COLOUR[s] ?? '#ffffff'} />
          </mesh>
        ))}
      </Billboard>
    </group>
  )
}
