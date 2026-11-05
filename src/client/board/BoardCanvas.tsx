// The 3D board, drawn from engine state and the affordances derived from legal actions. Terrain is an open battlefield with a hex
// grid painted on it (instanced hex prisms, one set per terrain); highlights are flat hex rings laid on the tiles; machines are the stand-ins from Machine.tsx. Every click checks
// the 8 px tap rule first, so a camera drag never also moves a machine.
import { Line, useTexture } from '@react-three/drei'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Color, Float32BufferAttribute, MeshStandardMaterial, Object3D, RepeatWrapping, SRGBColorSpace, type Group, type InstancedMesh, type Texture } from 'three'
import { actionForHex, affordances, hexKey } from '../affordances'
import { cellsOf, losTrace, unitAt, weaponsOf, type Action, type Axial, type GameState } from '../engine'
import { humanTurn, take } from '../game'
import { setStore, useGame } from '../store'
import { CameraRig } from './CameraRig'
import { Prop } from './Prop'
import { isTap } from './gesture'
import { HEX_SIZE, frameFor, hexToWorld, topOf, worldToHex, type Cell, type Frame } from './hexLayout'
import { Machine, SIDE_COLOUR } from './Machine'
import { AttackFxLayer } from './AttackFx'
import { DeployGhost, Effects, UnitMover, type WorldOf } from './Motion'

/**
 * The battlefield (PLAN.md D5, revised 2026-11-04): an open landscape with a hex grid painted on it, not a floor of tiles.
 * Each terrain draws its own ground (grass and earth, rubble and craters, a shallow river, scorched earth under a wreck,
 * rock on a raised plateau) and every ground texture is mapped by world position, so it runs on across hex borders and the
 * board reads as one piece of land. Raised hexes are rock plateaus with cliff sides. A thin dark grid line marks every hex;
 * debris hexes also carry a few loose rocks. Textures live in public/assets/textures (docs/figures.md, "Battlefield").
 */
interface Skin {
  top: string
  tint: string
  roughness: number
  emissive?: string
}
const SKINS: Record<string, Skin> = {
  open: { top: 'grass', tint: '#f6ffe6', roughness: 0.95 },
  raised: { top: 'plateau', tint: '#ffffff', roughness: 0.9 },
  debris: { top: 'rubble', tint: '#ffffff', roughness: 0.95 },
  water: { top: 'water', tint: '#a9c6c6', roughness: 0.2 },
  field: { top: 'grass', tint: '#c9b8ff', roughness: 0.8, emissive: '#2a1a55' },
  blocked: { top: 'scorched', tint: '#ffffff', roughness: 0.95 },
}
/** World units per repeat of a ground texture: large, so a repeat spans several hexes and does not read as tiling. */
const TEXTURE_SPAN = 2.6
const textureUrl = (name: string): string => import.meta.env.BASE_URL + 'assets/textures/' + name + '.jpg'
const skinOf = (cell: Cell): string => (cell.terrain === 'open' ? (cell.elevation > 0 ? 'raised' : 'open') : SKINS[cell.terrain] ? cell.terrain : 'open')
const GAP = 0.94 // highlight rings sit a hair inside the hex
const HL = { move: '#5fd17a', dash: '#f0a830', deploy: '#7fd4ff', shoot: '#ff3b30', hover: '#ffffff', push: '#c58cff', pick: '#7fd4ff' } as const

/** Height of the top of a hex, or 0 off the board. */
function topAt(game: GameState, h: Axial): number {
  const cell = game.board.hexes[hexKey(h)]
  return cell ? topOf(cell) : 0
}

/** A small stable hash of a hex, for per-tile variety that does not change between renders. */
function hexHash(c: Axial, salt = 0): number {
  let h = (c.q * 73856093) ^ (c.r * 19349663) ^ (salt * 83492791)
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

/**
 * A standard material whose map is sampled by world position instead of the mesh's UVs: the ground plane (x, z) for a top,
 * or the wall (along the wall, up) for a cliff side. Instanced meshes are handled, so one material serves a whole tile set.
 */
function worldMapped(map: Texture, opts: { roughness: number; emissive?: string }, mode: 'top' | 'side'): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    map,
    roughness: opts.roughness,
    metalness: 0,
    emissive: new Color(opts.emissive ?? '#000000'),
    emissiveIntensity: opts.emissive ? 0.45 : 0,
  })
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSpan = { value: TEXTURE_SPAN }
    sh.vertexShader =
      'varying vec3 vWorldP;\nvarying vec3 vWorldN;\n' +
      sh.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 wp = vec4(transformed, 1.0);
        vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
          wn = mat3(instanceMatrix) * wn;
        #endif
        vWorldP = (modelMatrix * wp).xyz;
        vWorldN = normalize(mat3(modelMatrix) * wn);`,
      )
    const uv = mode === 'top' ? 'vWorldP.xz' : '(abs(vWorldN.x) > abs(vWorldN.z) ? vec2(vWorldP.z, vWorldP.y) : vec2(vWorldP.x, vWorldP.y))'
    sh.fragmentShader =
      'uniform float uSpan;\nvarying vec3 vWorldP;\nvarying vec3 vWorldN;\n' +
      sh.fragmentShader.replace(
        '#include <map_fragment>',
        // the texture, times a slow light-and-dark variation sampled from its own green channel at a much larger scale, so
        // the ground has patches and no two hexes repeat
        `vec2 wuv = ${uv} / uSpan;
        float patchy = 0.78 + 0.5 * texture2D(map, wuv * 0.19 + vec2(0.37, 0.61)).g;
        diffuseColor *= texture2D(map, wuv) * vec4(vec3(patchy), 1.0);`,
      )
  }
  m.customProgramCacheKey = () => 'world-mapped-' + mode
  return m
}

function useGroundTextures(): Record<string, Texture> {
  const names = ['grass', 'plateau', 'rubble', 'water', 'scorched', 'cliff']
  const list = useTexture(names.map(textureUrl))
  return useMemo(() => {
    const out: Record<string, Texture> = {}
    list.forEach((t, i) => {
      t.colorSpace = SRGBColorSpace
      t.wrapS = t.wrapT = RepeatWrapping
      t.anisotropy = 8
      t.needsUpdate = true
      out[names[i]!] = t
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list])
}

function TileSet({ skin, cells, frame, onPick, onHover }: { skin: Skin; cells: Cell[]; frame: Frame; onPick: (c: Cell) => void; onHover: (c: Cell | null) => void }) {
  const ref = useRef<InstancedMesh>(null)
  const tex = useGroundTextures()
  const materials = useMemo(
    () => [
      worldMapped(tex.cliff!, { roughness: 0.95 }, 'side'),
      worldMapped(tex[skin.top]!, { roughness: skin.roughness, emissive: skin.emissive }, 'top'),
      new MeshStandardMaterial({ color: '#1b1d20' }),
    ],
    [tex, skin],
  )
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const o = new Object3D()
    const c = new Color()
    const base = new Color(skin.tint)
    cells.forEach((cell, i) => {
      const p = hexToWorld(cell, frame)
      const h = topOf(cell)
      o.position.set(p.x, h / 2, p.z)
      o.scale.set(1, h, 1)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
      // higher ground catches a little more light
      c.copy(base).offsetHSL(0, 0, 0.05 * cell.elevation + (hexHash(cell) - 0.5) * 0.04)
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
      <cylinderGeometry args={[HEX_SIZE, HEX_SIZE, 1, 6]} />
    </instancedMesh>
  )
}

/** The painted grid: one thin dark outline per hex, just above its ground. */
function HexGrid({ cells, frame }: { cells: Cell[]; frame: Frame }) {
  const geometry = useMemo(() => {
    const pts: number[] = []
    const r = HEX_SIZE * 0.985
    for (const cell of cells) {
      const p = hexToWorld(cell, frame)
      const y = topOf(cell) + 0.004
      for (let i = 0; i < 6; i++) {
        // corners of a pointy-top hex: one on +z
        const a0 = (i * Math.PI) / 3
        const a1 = ((i + 1) * Math.PI) / 3
        pts.push(p.x + Math.sin(a0) * r, y, p.z + Math.cos(a0) * r, p.x + Math.sin(a1) * r, y, p.z + Math.cos(a1) * r)
      }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pts, 3))
    return g
  }, [cells, frame])
  return (
    <lineSegments geometry={geometry} renderOrder={1}>
      <lineBasicMaterial color="#14120e" transparent opacity={0.42} depthWrite={false} />
    </lineSegments>
  )
}

/** Loose rocks on debris hexes, so rough ground reads in 3D as well as in its texture. */
function Rocks({ cells, frame }: { cells: Cell[]; frame: Frame }) {
  const ref = useRef<InstancedMesh>(null)
  const spots = useMemo(() => {
    const out: { x: number; y: number; z: number; s: number; r: number }[] = []
    for (const cell of cells) {
      if (cell.terrain !== 'debris') continue
      const p = hexToWorld(cell, frame)
      for (let k = 0; k < 4; k++) {
        const a = hexHash(cell, k + 1) * Math.PI * 2
        const d = 0.12 + hexHash(cell, k + 11) * 0.28
        out.push({ x: p.x + Math.cos(a) * d, y: topOf(cell), z: p.z + Math.sin(a) * d, s: 0.035 + hexHash(cell, k + 21) * 0.05, r: hexHash(cell, k + 31) * 6 })
      }
    }
    return out
  }, [cells, frame])
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const o = new Object3D()
    spots.forEach((s, i) => {
      o.position.set(s.x, s.y + s.s * 0.4, s.z)
      o.rotation.set(s.r, s.r * 1.7, s.r * 0.6)
      o.scale.set(s.s * 1.3, s.s * 0.8, s.s)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [spots])
  if (!spots.length) return null
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, spots.length]} castShadow receiveShadow>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#6d655b" roughness={0.95} flatShading />
    </instancedMesh>
  )
}

/** The land around the board, in the same grass, so the battlefield carries on past the edge of play. */
function Surroundings({ frame }: { frame: Frame }) {
  const tex = useGroundTextures()
  const material = useMemo(() => {
    const m = worldMapped(tex.grass!, { roughness: 1 }, 'top')
    m.color = new Color('#7d8272')
    return m
  }, [tex])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow material={material}>
      <planeGeometry args={[frame.halfW * 2 + 60, frame.halfD * 2 + 60]} />
    </mesh>
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
      <Surroundings frame={frame} />
      {groups.map(([k, cs]) => (
        <TileSet key={k} skin={SKINS[k]!} cells={cs} frame={frame} onPick={onPick} onHover={onHover} />
      ))}
      <HexGrid cells={cells} frame={frame} />
      <Rocks cells={cells} frame={frame} />
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
  const picks = useGame((s) => s.picks)
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
  const pickAt = new Map<string, Action>()
  for (const p of picks ?? []) {
    const h = p.targetUid ? game.units[p.targetUid]?.hex : null
    if (h) pickAt.set(hexKey(h), p)
  }
  const deploying = beat && beat.kind === 'deploy' ? game.units[beat.uid] : null

  // Every tap lands on a hex, never on a figure (figures carry no pointer handlers, so a tall model cannot hide the hex
  // behind it). A hex with a legal action takes it (a move, a deploy, an attack on whatever stands there); otherwise a
  // unit's own hex selects that unit, and empty ground clears the selection and any armed weapon.
  const onPick = (cell: Cell) => {
    // an open targeted button (a Command or a Tactics card with several targets): a tap on a target's hex plays it
    const pick = pickAt.get(hexKey(cell))
    if (pick) {
      take(pick)
      return
    }
    const a = actionForHex(af, hexKey(cell), armed)
    if (a) {
      take(a)
      return
    }
    const there = unitAt(game, cell)
    if (there && there.alive) {
      setStore({ selected: selected === there.uid ? null : there.uid })
      return
    }
    setStore({ selected: null, armed: null, openItem: null, picks: null })
  }
  const onHoverHex = (c: Cell | null) => {
    const there = c ? unitAt(game, c) : null
    setStore({ hoverHex: c ? { q: c.q, r: c.r } : null, hoverUnit: there && there.alive ? there.uid : null })
  }

  const units = Object.values(game.units).filter((u) => u.alive && u.hex)
  const shootHexes = new Set(af.shootAt.keys())

  return (
    <>
      <color attach="background" args={['#3a4450']} />
      <fog attach="fog" args={['#3a4450', 22, 55]} />
      <hemisphereLight args={['#e6eef6', '#5a5038', 1.0]} />
      <directionalLight position={[6, 14, 8]} intensity={2.1} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} />
      <HexTiles cells={cells} frame={frame} onPick={onPick} onHover={onHoverHex} />
      {[...af.moveTo.entries()].map(([k, a]) => (
        <HexRing key={'m' + k} at={hexToWorld(a.to!, frame)} y={topAt(game, a.to!)} colour={a.type === 'dash' ? HL.dash : HL.move} />
      ))}
      {[...af.pushTo.entries()].map(([k, a]) => (
        <HexRing key={'p' + k} at={hexToWorld(a.to!, frame)} y={topAt(game, a.to!)} colour={a.collide ? HL.shoot : HL.push} inner={a.collide ? 0.55 : 0.7} />
      ))}
      {[...pickAt.keys()].map((k) => {
        const [q, r] = k.split(',').map(Number) as [number, number]
        return <HexRing key={'k' + k} at={hexToWorld({ q, r }, frame)} y={topAt(game, { q, r })} colour={HL.pick} inner={0.55} />
      })}
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
          />
          </UnitMover>
        )
      })}
      {deploying && beat && beat.kind === 'deploy' && (
        <DeployGhost
          key={beat.uid + ':' + beat.at.q + ',' + beat.at.r}
          defId={deploying.defId}
          side={deploying.side}
          at={beat.at}
          toward={(() => {
            const foe = game.bases.find((b) => b.side !== deploying.side)
            return foe ? worldOf(foe.hex) : null
          })()}
          worldOf={worldOf}
        />
      )}
      <AttackFxLayer worldOf={worldOf} />
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
