// The 3D board, drawn from engine state and the affordances derived from legal actions. Terrain is instanced hex prisms, one
// set per terrain skin; highlights are flat hex rings laid on the tiles; machines are the stand-ins from Machine.tsx. Every click checks
// the 8 px tap rule first, so a camera drag never also moves a machine.
import { Line, useTexture } from '@react-three/drei'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, MeshStandardMaterial, Object3D, RepeatWrapping, SRGBColorSpace, type Group, type InstancedMesh } from 'three'
import { actionForHex, affordances, hexKey } from '../affordances'
import { cellsOf, losTrace, unitAt, weaponsOf, type Axial, type GameState } from '../engine'
import { humanTurn, take } from '../game'
import { setStore, useGame } from '../store'
import { CameraRig } from './CameraRig'
import { Prop } from './Prop'
import { isTap } from './gesture'
import { HEX_SIZE, frameFor, hexToWorld, topOf, worldToHex, type Cell, type Frame } from './hexLayout'
import { Machine, SIDE_COLOUR } from './Machine'
import { DeployGhost, Effects, Tracer, UnitMover, type WorldOf } from './Motion'

/**
 * The hangar-deck skin (PLAN.md D5): each terrain is a set of tiles with its own top texture, and raised hexes are stacked
 * cargo containers. Textures live in public/assets/textures (docs/figures.md, "Deck textures"). The instance colour tints
 * the texture: a little lighter per level up, and a small per-tile jitter so a field of identical plates does not read as
 * wallpaper. Every tile is also turned a random sixth of a turn, which the hex prism allows for free.
 */
interface Skin {
  top: string
  side: string
  tint: string
  roughness: number
  metalness: number
  emissive?: string
}
const SKINS: Record<string, Skin> = {
  open: { top: 'deck_open', side: 'crate_side', tint: '#ffffff', roughness: 0.7, metalness: 0.1 },
  raised: { top: 'crate_top', side: 'crate_side', tint: '#f2f5f8', roughness: 0.65, metalness: 0.1 },
  debris: { top: 'deck_debris', side: 'crate_side', tint: '#fff2e0', roughness: 0.8, metalness: 0.1 },
  water: { top: 'deck_water', side: 'crate_side', tint: '#e6f6ff', roughness: 0.12, metalness: 0.15 },
  field: { top: 'deck_open', side: 'crate_side', tint: '#c3b0ff', roughness: 0.6, metalness: 0.1, emissive: '#3a2370' },
  blocked: { top: 'deck_scorched', side: 'crate_side', tint: '#d8d8d8', roughness: 0.85, metalness: 0.1 },
}
const textureUrl = (name: string): string => import.meta.env.BASE_URL + 'assets/textures/' + name + '.jpg'
const skinOf = (cell: Cell): string => (cell.terrain === 'open' && cell.elevation > 0 ? 'raised' : SKINS[cell.terrain] ? cell.terrain : 'open')
const GAP = 0.94 // hex prisms are drawn a hair small so a thin seam shows between tiles
const HL = { move: '#5fd17a', dash: '#f0a830', deploy: '#7fd4ff', shoot: '#ff3b30', hover: '#ffffff', push: '#c58cff' } as const

/** Height of the top of a hex, or 0 off the board. */
function topAt(game: GameState, h: Axial): number {
  const cell = game.board.hexes[hexKey(h)]
  return cell ? topOf(cell) : 0
}

/** A small stable hash of a hex, for per-tile variety that does not change between renders. */
function hexHash(c: Axial): number {
  let h = (c.q * 73856093) ^ (c.r * 19349663)
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

function useSkinMaterials(skin: Skin): MeshStandardMaterial[] {
  const [top, side] = useTexture([textureUrl(skin.top), textureUrl(skin.side)])
  return useMemo(() => {
    const t = top!.clone()
    t.colorSpace = SRGBColorSpace
    t.anisotropy = 8
    t.needsUpdate = true
    const sideTex = side!.clone()
    sideTex.colorSpace = SRGBColorSpace
    sideTex.wrapS = RepeatWrapping
    sideTex.repeat.set(6, 1) // once per face of the prism
    sideTex.needsUpdate = true
    const common = {
      roughness: skin.roughness,
      metalness: skin.metalness,
      emissive: new Color(skin.emissive ?? '#000000'),
      emissiveIntensity: skin.emissive ? 0.6 : 0,
    }
    // CylinderGeometry groups: 0 = side, 1 = top cap, 2 = bottom cap
    return [new MeshStandardMaterial({ map: sideTex, ...common }), new MeshStandardMaterial({ map: t, ...common }), new MeshStandardMaterial({ color: '#111111' })]
  }, [top, side, skin])
}

function TileSet({ skin, cells, frame, onPick, onHover }: { skin: Skin; cells: Cell[]; frame: Frame; onPick: (c: Cell) => void; onHover: (c: Cell | null) => void }) {
  const ref = useRef<InstancedMesh>(null)
  const materials = useSkinMaterials(skin)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const o = new Object3D()
    const c = new Color()
    const base = new Color(skin.tint)
    cells.forEach((cell, i) => {
      const p = hexToWorld(cell, frame)
      const h = topOf(cell)
      const r = hexHash(cell)
      o.position.set(p.x, h / 2, p.z)
      o.rotation.set(0, Math.floor(r * 6) * (Math.PI / 3), 0)
      o.scale.set(1, h, 1)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
      c.copy(base).offsetHSL(0, 0, 0.06 * cell.elevation + (r - 0.5) * 0.08)
      mesh.setColorAt(i, c)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [cells, frame, skin])
  const pick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.instanceId === undefined || !isTap()) return
    onPick(cells[e.instanceId]!)
  }
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, materials, cells.length]}
      receiveShadow
      castShadow
      onClick={pick}
      onPointerMove={(e) => {
        if (e.instanceId !== undefined) onHover(cells[e.instanceId]!)
      }}
      onPointerOut={() => onHover(null)}
    >
      {/* a 6-sided cylinder has a corner on +z, which is pointy-top in this layout; height 1 is scaled per instance */}
      <cylinderGeometry args={[HEX_SIZE * GAP, HEX_SIZE * GAP, 1, 6]} />
    </instancedMesh>
  )
}

function HexTiles({ cells, frame, onPick, onHover }: { cells: Cell[]; frame: Frame; onPick: (c: Cell) => void; onHover: (c: Cell | null) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, Cell[]>()
    for (const c of cells) {
      const k = skinOf(c)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(c)
    }
    return [...m.entries()]
  }, [cells])
  return (
    <>
      {groups.map(([k, cs]) => (
        <TileSet key={k} skin={SKINS[k]!} cells={cs} frame={frame} onPick={onPick} onHover={onHover} />
      ))}
      <Wrecks cells={cells} frame={frame} />
    </>
  )
}

/** Blocked hexes carry a wreck: one of two hull models, turned per hex; a dark block stands in if the models are missing. */
function Wrecks({ cells, frame }: { cells: Cell[]; frame: Frame }) {
  return (
    <>
      {cells
        .filter((c) => c.terrain === 'blocked')
        .map((c) => {
          const p = hexToWorld(c, frame)
          const r = hexHash(c)
          const block = (
            <mesh position={[0, 0.25, 0]} castShadow>
              <cylinderGeometry args={[HEX_SIZE * 0.8, HEX_SIZE * 0.9, 0.5, 6]} />
              <meshStandardMaterial color="#1f2126" roughness={0.9} />
            </mesh>
          )
          return (
            <group key={c.q + ',' + c.r} position={[p.x, topOf(c), p.z]} rotation={[0, r * Math.PI * 2, 0]}>
              <Prop name={r < 0.5 ? 'wreck_a' : 'wreck_b'} width={0.95} fallback={block} />
            </group>
          )
        })}
    </>
  )
}

/** A flat hex ring laid on a tile. Rotated so its corners point along z, matching the pointy-top tiles. */
function HexRing({ at, y, colour, inner = 0.78, opacity = 0.9 }: { at: { x: number; z: number }; y: number; colour: string; inner?: number; opacity?: number }) {
  return (
    <mesh position={[at.x, y + 0.012, at.z]} rotation={[-Math.PI / 2, 0, Math.PI / 6]} renderOrder={2}>
      <ringGeometry args={[HEX_SIZE * GAP * inner, HEX_SIZE * GAP * 0.98, 6, 1]} />
      <meshBasicMaterial color={colour} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  )
}

function Objectives({ game, frame }: { game: GameState; frame: Frame }) {
  return (
    <>
      {game.objectiveOrder.map((oid) => {
        const o = game.objectives[oid]!
        const p = hexToWorld(o.hex, frame)
        const y = topAt(game, o.hex)
        const colour = o.controlledBy === null ? '#e8e2c8' : SIDE_COLOUR[o.controlledBy]
        return (
          <group key={oid} position={[p.x, y, p.z]} name={`objective-${oid}`}>
            <Prop
              name="objective"
              height={0.5}
              fallback={
                <mesh position={[0, 0.02, 0]}>
                  <cylinderGeometry args={[0.22, 0.26, 0.04, 24]} />
                  <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={0.5} />
                </mesh>
              }
            />
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
              <ringGeometry args={[0.27, 0.31, 32]} />
              <meshBasicMaterial color={colour} />
            </mesh>
            <mesh position={[0, 0.75, 0]}>
              <cylinderGeometry args={[0.025, 0.025, 0.6, 8]} />
              <meshBasicMaterial color={colour} transparent opacity={0.55} />
            </mesh>
            {/* one pip per VP around the marker, so its worth reads on the board */}
            {Array.from({ length: Math.min(8, o.vp) }).map((_, i) => (
              <mesh key={i} position={[Math.cos((i / o.vp) * Math.PI * 2) * 0.33, 0.03, Math.sin((i / o.vp) * Math.PI * 2) * 0.33]}>
                <boxGeometry args={[0.05, 0.03, 0.05]} />
                <meshBasicMaterial color={colour} />
              </mesh>
            ))}
          </group>
        )
      })}
    </>
  )
}

function Garrisons({ game, frame, shootable }: { game: GameState; frame: Frame; shootable: Set<string> }) {
  return (
    <>
      {game.garrisonOrder.map((gid) => {
        const g = game.garrisons[gid]!
        if (!g.alive) return null
        const p = hexToWorld(g.hex, frame)
        const y = topAt(game, g.hex)
        const colour = g.side === null ? '#bbbbbb' : SIDE_COLOUR[g.side]
        return (
          <group key={gid} position={[p.x, y, p.z]} name={`garrison-${gid}`}>
            <Prop
              name="garrison"
              width={0.72}
              fallback={
                <mesh position={[0, 0.13, 0]} castShadow>
                  <boxGeometry args={[0.42, 0.26, 0.36]} />
                  <meshStandardMaterial color="#6d737c" roughness={0.7} />
                </mesh>
              }
            />
            <mesh position={[0.3, 0.45, 0]}>
              <cylinderGeometry args={[0.012, 0.012, 0.6, 6]} />
              <meshStandardMaterial color="#d0d4da" />
            </mesh>
            <mesh position={[0.39, 0.66, 0]}>
              <boxGeometry args={[0.18, 0.11, 0.01]} />
              <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={0.3} />
            </mesh>
            {shootable.has(hexKey(g.hex)) && <HexRing at={{ x: 0, z: 0 }} y={0} colour={HL.shoot} inner={0.84} />}
          </group>
        )
      })}
    </>
  )
}

function Bases({ game, frame }: { game: GameState; frame: Frame }) {
  return (
    <>
      {game.bases.map((b) => {
        const p = hexToWorld(b.hex, frame)
        const y = topAt(game, b.hex)
        return (
          <group key={b.bid} position={[p.x, y, p.z]} name={`base-${b.side}`}>
            <mesh rotation={[-Math.PI / 2, 0, Math.PI / 6]} position={[0, 0.01, 0]}>
              <ringGeometry args={[HEX_SIZE * 0.8, HEX_SIZE * 0.92, 6, 1]} />
              <meshBasicMaterial color={SIDE_COLOUR[b.side]} />
            </mesh>
            <Prop
              name="base"
              width={0.9}
              fallback={
                <mesh position={[0, 0.04, 0]} receiveShadow>
                  <cylinderGeometry args={[HEX_SIZE * 0.78, HEX_SIZE * 0.84, 0.08, 6]} />
                  <meshStandardMaterial color={SIDE_COLOUR[b.side]} roughness={0.5} metalness={0.4} emissive={SIDE_COLOUR[b.side]} emissiveIntensity={0.15} />
                </mesh>
              }
            />
          </group>
        )
      })}
    </>
  )
}

const PICKUP_COLOUR: Record<string, string> = { shield: '#7fd4ff', speed: '#5fd17a', strength: '#ff8a5c', accuracy: '#e6d45a', energy: '#f0a830' }

function PickupGem({ x, y, z, colour, kind }: { x: number; y: number; z: number; colour: string; kind: 'upgrade' | 'energy' }) {
  const ref = useRef<Group>(null)
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.elapsedTime * 0.8
      ref.current.position.y = y + 0.08 + Math.sin(clock.elapsedTime * 2) * 0.03
    }
  })
  const gem = (
    <mesh position={[0, 0.2, 0]}>
      <octahedronGeometry args={[0.13]} />
      <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={0.6} />
    </mesh>
  )
  return (
    <group position={[x, y, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <ringGeometry args={[0.16, 0.21, 32]} />
        <meshBasicMaterial color={colour} transparent opacity={0.85} />
      </mesh>
      <group ref={ref} position={[0, 0.08, 0]}>
        <Prop name={kind === 'energy' ? 'energy' : 'crate'} height={kind === 'energy' ? 0.34 : 0.24} fallback={gem} />
        <pointLight color={colour} intensity={0.6} distance={0.8} position={[0, 0.25, 0]} />
      </group>
    </group>
  )
}

function Pickups({ game, frame }: { game: GameState; frame: Frame }) {
  return (
    <>
      {game.pickups.map((pk) => {
        const p = hexToWorld(pk.hex, frame)
        const colour = PICKUP_COLOUR[pk.kind === 'energy' ? 'energy' : pk.upgrade ?? 'shield'] ?? '#ffffff'
        return <PickupGem key={pk.pid} x={p.x} y={topAt(game, pk.hex)} z={p.z} colour={colour} kind={pk.kind} />
      })}
    </>
  )
}

/** While a weapon is armed, a line from the shooter to the hovered enemy: solid when clear, dashed red when blocked. */
function LosLine({ game, frame, armed, hover }: { game: GameState; frame: Frame; armed: string | null; hover: Axial | null }) {
  if (!armed || !hover || !game.activation) return null
  const me = game.units[game.activation.uid]
  if (!me || !me.hex) return null
  const target = unitAt(game, hover)
  if (!target || target.side === me.side) return null
  const w = weaponsOf(me).find((x) => x.wid === armed)
  const tr = w && w.ignoreLos ? { clear: true, blockedAt: null } : losTrace(game, me.hex, hover, me.side, target.uid)
  const a = hexToWorld(me.hex, frame)
  const b = hexToWorld(hover, frame)
  const pts: [number, number, number][] = [
    [a.x, topAt(game, me.hex) + 0.7, a.z],
    [b.x, topAt(game, hover) + 0.6, b.z],
  ]
  const blocked = tr.blockedAt
  return (
    <>
      <Line points={pts} color={tr.clear ? '#9ff0b4' : '#ff5a4a'} lineWidth={2} dashed={!tr.clear} dashSize={0.15} gapSize={0.1} />
      {blocked && <HexRing at={hexToWorld(blocked, frame)} y={topAt(game, blocked)} colour="#ff5a4a" inner={0.5} />}
    </>
  )
}

function Scene() {
  const game = useGame((s) => s.game)
  const armed = useGame((s) => s.armed)
  const selected = useGame((s) => s.selected)
  const hoverHex = useGame((s) => s.hoverHex)
  const busy = useGame((s) => s.busy)
  const ai = useGame((s) => s.ai)
  const beat = useGame((s) => s.beat)

  // The board never changes shape during a game, so the cells (and the camera frame built from them) are keyed on the
  // match, not on the state: every apply() returns a new state object, and a frame rebuilt on each one would make the
  // camera rig reset the view after every move.
  const boardKey = game ? (game as unknown as { seed: string }).seed + '|' + Object.keys(game.board.hexes).length : ''
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cells = useMemo(() => (game ? cellsOf(game) : []), [boardKey])
  const frame = useMemo(() => frameFor(cells), [cells])
  // humanTurn() reads busy and ai from the store, so they are dependencies even though they are not passed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const af = useMemo(() => affordances(game, armed, humanTurn()), [game, armed, busy, ai])
  const surface = useMemo(() => {
    const byKey = new Map(cells.map((c) => [c.q + ',' + c.r, c]))
    return (x: number, z: number): number => {
      const h = worldToHex(x, z, frame)
      const cell = byKey.get(h.q + ',' + h.r)
      return cell ? topOf(cell) : 0
    }
  }, [cells, frame])

  if (!game) return null
  const worldOf: WorldOf = (h) => {
    const p = hexToWorld(h, frame)
    return [p.x, topAt(game, h), p.z]
  }
  const shooter = beat && beat.kind === 'shot' ? game.units[beat.uid] : null
  const deploying = beat && beat.kind === 'deploy' ? game.units[beat.uid] : null

  const onPick = (cell: Cell) => {
    const a = actionForHex(af, hexKey(cell), armed)
    if (a) {
      take(a)
      return
    }
    // clicking empty ground cancels a pinned card or an armed weapon
    setStore({ selected: null, armed: null })
  }

  const units = Object.values(game.units).filter((u) => u.alive && u.hex)
  const shootHexes = new Set(af.shootAt.keys())

  return (
    <>
      <color attach="background" args={['#0d0f12']} />
      <hemisphereLight args={['#cfd8e6', '#1a1c20', 0.55]} />
      <directionalLight position={[6, 14, 8]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[frame.halfW * 2 + 8, frame.halfD * 2 + 8]} />
        <meshStandardMaterial color="#15171b" roughness={0.95} />
      </mesh>
      <HexTiles cells={cells} frame={frame} onPick={onPick} onHover={(c) => setStore({ hoverHex: c ? { q: c.q, r: c.r } : null })} />
      {[...af.moveTo.entries()].map(([k, a]) => (
        <HexRing key={'m' + k} at={hexToWorld(a.to!, frame)} y={topAt(game, a.to!)} colour={a.type === 'dash' ? HL.dash : HL.move} />
      ))}
      {[...af.pushTo.entries()].map(([k, a]) => (
        <HexRing key={'p' + k} at={hexToWorld(a.to!, frame)} y={topAt(game, a.to!)} colour={a.collide ? HL.shoot : HL.push} inner={a.collide ? 0.55 : 0.7} />
      ))}
      {[...af.deployTo.entries()].map(([k, a]) => (
        <HexRing key={'d' + k} at={hexToWorld(a.to!, frame)} y={topAt(game, a.to!)} colour={HL.deploy} inner={0.6} />
      ))}
      {hoverHex && game.board.hexes[hexKey(hoverHex)] && (
        <HexRing at={hexToWorld(hoverHex, frame)} y={topAt(game, hoverHex)} colour={HL.hover} inner={0.9} opacity={0.6} />
      )}
      <Bases game={game} frame={frame} />
      <Objectives game={game} frame={frame} />
      <Garrisons game={game} frame={frame} shootable={shootHexes} />
      <Pickups game={game} frame={frame} />
      {units.map((u) => {
        return (
          <UnitMover key={u.uid} uid={u.uid} side={u.side} home={worldOf(u.hex!)} worldOf={worldOf}>
          <Machine
            uid={u.uid}
            defId={u.defId}
            side={u.side}
            position={[0, 0, 0]}
            hp={u.hp}
            maxHp={u.maxHp}
            statuses={u.statuses}
            active={game.activation?.uid === u.uid}
            selected={selected === u.uid}
            targetable={af.targetable.has(u.uid)}
            onClick={() => {
              if (!isTap()) return
              const a = actionForHex(af, hexKey(u.hex!), armed)
              if (a && (a.type === 'attack' || a.type === 'react_attack' || a.type === 'tactics')) take(a)
              else setStore({ selected: selected === u.uid ? null : u.uid })
            }}
            onHover={(over) => setStore({ hoverUnit: over ? u.uid : null, hoverHex: over ? u.hex : null })}
          />
          </UnitMover>
        )
      })}
      {deploying && beat && beat.kind === 'deploy' && <DeployGhost defId={deploying.defId} side={deploying.side} at={beat.at} worldOf={worldOf} />}
      {shooter?.hex && beat && beat.kind === 'shot' && !beat.melee && <Tracer from={worldOf(shooter.hex)} to={worldOf(beat.to)} />}
      <Effects worldOf={worldOf} phase={game.phase} round={game.round} />
      <LosLine game={game} frame={frame} armed={armed} hover={hoverHex} />
      <CameraRig frame={frame} surface={surface} />
    </>
  )
}

export function BoardCanvas() {
  return (
    <Canvas shadows camera={{ fov: 40, near: 0.1, far: 400, position: [0, 18, 18] }} gl={{ preserveDrawingBuffer: true }} data-testid="board-canvas">
      <Scene />
    </Canvas>
  )
}
