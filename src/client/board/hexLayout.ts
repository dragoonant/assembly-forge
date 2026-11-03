// Where a hex sits in the 3D world (PLAN.md D3). Pure maths over the engine's own hex module, so it is unit-tested and the
// renderer never does hex arithmetic of its own.
//
// One hex is 1 world unit across the flats, pointy-top, matching src/engine/hex.js. The engine's pixel y axis becomes world +z,
// so "down the screen" in the 2D game is "towards the camera" here. Elevation is ELEV_STEP world units per level.
import * as Hex from '../../engine/hex.js'

export interface Axial {
  q: number
  r: number
}

export interface Cell extends Axial {
  terrain: string
  elevation: number
}

/** Centre to corner, for a hex exactly 1 unit across the flats. */
export const HEX_SIZE = 1 / Math.sqrt(3)
/** World height of one elevation level: a visible step at the overview that does not hide a machine on the lower hex up close. */
export const ELEV_STEP = 0.35
/** Thickness of the ground-level slab, so a level-0 hex still reads as a tile. */
export const BASE_HEIGHT = 0.08

export interface Frame {
  /** Subtracted from raw positions so the board is centred on the world origin. */
  cx: number
  cz: number
  /** Half extents of the board's hex field, edge to edge, in world units. */
  halfW: number
  halfD: number
}

/** Raw (uncentred) world position of a hex centre. */
function raw(h: Axial): { x: number; z: number } {
  const p = Hex.toPixel(h, HEX_SIZE)
  return { x: p.x, z: p.y }
}

/** The frame that centres a board on the origin. */
export function frameFor(cells: Axial[]): Frame {
  if (cells.length === 0) return { cx: 0, cz: 0, halfW: 0, halfD: 0 }
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const c of cells) {
    const p = raw(c)
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  // a pointy-top hex reaches half a flat (0.5) sideways and one corner (HEX_SIZE) up and down from its centre
  return {
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    halfW: (maxX - minX) / 2 + 0.5,
    halfD: (maxZ - minZ) / 2 + HEX_SIZE,
  }
}

/** Centred world position of a hex centre. */
export function hexToWorld(h: Axial, f: Frame): { x: number; z: number } {
  const p = raw(h)
  return { x: p.x - f.cx, z: p.z - f.cz }
}

/** The hex under a centred world point (whether or not it is on the board). */
export function worldToHex(x: number, z: number, f: Frame): Axial {
  const h = Hex.fromPixel({ x: x + f.cx, y: z + f.cz }, HEX_SIZE)
  // normalise -0 so keys and equality behave
  return { q: h.q + 0, r: h.r + 0 }
}

/** Height of a cell's top surface. */
export function topOf(cell: Pick<Cell, 'elevation'>): number {
  return BASE_HEIGHT + cell.elevation * ELEV_STEP
}

/** The eight corners of the board's bounding box, for fitting the camera. */
export function frameCorners(f: Frame, top = 0.6): [number, number, number][] {
  const out: [number, number, number][] = []
  for (const x of [-f.halfW, f.halfW]) for (const z of [-f.halfD, f.halfD]) for (const y of [0, top]) out.push([x, y, z])
  return out
}

/** How far the orbit target may be panned: the board edge, so the map can never be scrolled away. */
export function panLimits(f: Frame): { x: number; z: number } {
  return { x: Math.max(0.5, f.halfW), z: Math.max(0.5, f.halfD) }
}
