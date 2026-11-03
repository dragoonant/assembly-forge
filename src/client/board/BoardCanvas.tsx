// The 3D board. M0 draws the engine's own board and units as plain geometry: one instanced hex prism per cell (height from
// elevation, colour from terrain) and a stand-in capsule per living unit in its side's colour. Everything is read from engine
// state, so this is already the same data path the real board will use.
import { Canvas } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, Object3D, type InstancedMesh } from 'three'
import { CameraRig } from './CameraRig'
import { HEX_SIZE, frameFor, hexToWorld, topOf, worldToHex, type Cell } from './hexLayout'

export interface BoardUnit {
  uid: string
  side: 0 | 1
  hex: { q: number; r: number }
}

/** Placeholder terrain colours on gunmetal, ahead of the hangar-deck skin (PLAN.md D5, M5). */
const TERRAIN_COLOUR: Record<string, string> = {
  open: '#5b6068',
  debris: '#6e5a44',
  water: '#2f5f7a',
  field: '#5a4f78',
  blocked: '#24262b',
}
const SIDE_COLOUR = ['#c8463a', '#3a78c8'] as const
const GAP = 0.94 // hex prisms are drawn a hair small so a thin seam shows between tiles

function HexTiles({ cells }: { cells: Cell[] }) {
  const ref = useRef<InstancedMesh>(null)
  const frame = useMemo(() => frameFor(cells), [cells])
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const o = new Object3D()
    const c = new Color()
    cells.forEach((cell, i) => {
      const p = hexToWorld(cell, frame)
      const h = topOf(cell)
      o.position.set(p.x, h / 2, p.z)
      o.scale.set(1, h, 1)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
      c.set(TERRAIN_COLOUR[cell.terrain] ?? TERRAIN_COLOUR.open!)
      if (cell.elevation > 0) c.offsetHSL(0, 0, 0.06 * cell.elevation)
      mesh.setColorAt(i, c)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [cells, frame])
  // a 6-sided cylinder has a corner on +z, which is pointy-top in this layout; height 1 is scaled per instance
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, cells.length]} receiveShadow castShadow>
      <cylinderGeometry args={[HEX_SIZE * GAP, HEX_SIZE * GAP, 1, 6]} />
      <meshStandardMaterial roughness={0.85} metalness={0.25} />
    </instancedMesh>
  )
}

function StandIn({ unit, cells }: { unit: BoardUnit; cells: Cell[] }) {
  const frame = useMemo(() => frameFor(cells), [cells])
  const cell = cells.find((c) => c.q === unit.hex.q && c.r === unit.hex.r)
  const p = hexToWorld(unit.hex, frame)
  const y = cell ? topOf(cell) : 0
  return (
    <group position={[p.x, y, p.z]} name={`unit-${unit.uid}`}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <capsuleGeometry args={[0.22, 0.6, 4, 12]} />
        <meshStandardMaterial color={SIDE_COLOUR[unit.side]} roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <ringGeometry args={[0.32, 0.4, 32]} />
        <meshBasicMaterial color={SIDE_COLOUR[unit.side]} />
      </mesh>
    </group>
  )
}

/** A Base: a raised pad in the side's colour, which no machine may stop on. */
function BasePad({ base, cells }: { base: { side: 0 | 1; hex: { q: number; r: number } }; cells: Cell[] }) {
  const frame = useMemo(() => frameFor(cells), [cells])
  const cell = cells.find((c) => c.q === base.hex.q && c.r === base.hex.r)
  const p = hexToWorld(base.hex, frame)
  const y = cell ? topOf(cell) : 0
  return (
    <group position={[p.x, y, p.z]} name={`base-${base.side}`}>
      <mesh position={[0, 0.04, 0]} receiveShadow>
        <cylinderGeometry args={[HEX_SIZE * 0.78, HEX_SIZE * 0.84, 0.08, 6]} />
        <meshStandardMaterial color={SIDE_COLOUR[base.side]} roughness={0.5} metalness={0.4} emissive={SIDE_COLOUR[base.side]} emissiveIntensity={0.15} />
      </mesh>
    </group>
  )
}

export function BoardCanvas({ cells, units, bases }: { cells: Cell[]; units: BoardUnit[]; bases: { side: 0 | 1; hex: { q: number; r: number } }[] }) {
  const frame = useMemo(() => frameFor(cells), [cells])
  const surface = useMemo(() => {
    const byKey = new Map(cells.map((c) => [c.q + ',' + c.r, c]))
    return (x: number, z: number): number => {
      const h = worldToHex(x, z, frame)
      const cell = byKey.get(h.q + ',' + h.r)
      return cell ? topOf(cell) : 0
    }
  }, [cells, frame])

  return (
    <Canvas shadows camera={{ fov: 40, near: 0.1, far: 400, position: [0, 18, 18] }} gl={{ preserveDrawingBuffer: true }} data-testid="board-canvas">
      <color attach="background" args={['#101216']} />
      <hemisphereLight args={['#cfd8e6', '#1a1c20', 0.55]} />
      <directionalLight position={[6, 14, 8]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[frame.halfW * 2 + 6, frame.halfD * 2 + 6]} />
        <meshStandardMaterial color="#17191d" roughness={0.95} />
      </mesh>
      <HexTiles cells={cells} />
      {bases.map((b, i) => (
        <BasePad key={i} base={b} cells={cells} />
      ))}
      {units.map((u) => (
        <StandIn key={u.uid} unit={u} cells={cells} />
      ))}
      <CameraRig frame={frame} surface={surface} />
    </Canvas>
  )
}
