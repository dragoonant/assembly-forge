// Hex to world mapping (PLAN.md D3): 1 unit across the flats, pointy-top, centred on the origin, invertible.
import { describe, expect, it } from 'vitest'
import * as Hex from '../../src/engine/hex.js'
import { ELEV_STEP, BASE_HEIGHT, frameFor, hexToWorld, panLimits, topOf, worldToHex } from '../../src/client/board/hexLayout'

const rect = (cols: number, rows: number) => {
  const out = []
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) out.push(Hex.fromOffset(col, row))
  return out
}

describe('hex layout', () => {
  it('neighbours in a row are exactly 1 unit apart, and rows are 0.75 hex heights apart', () => {
    const f = frameFor(rect(3, 3))
    const a = hexToWorld({ q: 0, r: 0 }, f)
    const east = hexToWorld({ q: 1, r: 0 }, f)
    const se = hexToWorld({ q: 0, r: 1 }, f)
    expect(east.x - a.x).toBeCloseTo(1, 9)
    expect(east.z - a.z).toBeCloseTo(0, 9)
    expect(se.z - a.z).toBeCloseTo(Math.sqrt(3) / 2, 9)
    // every one of the six neighbours is 1 unit away, centre to centre
    for (const n of Hex.neighbours({ q: 0, r: 0 })) {
      const p = hexToWorld(n, f)
      expect(Math.hypot(p.x - a.x, p.z - a.z)).toBeCloseTo(1, 9)
    }
  })

  it('centres the board on the origin', () => {
    const cells = rect(11, 7)
    const f = frameFor(cells)
    let sx = 0
    let minX = Infinity
    let maxX = -Infinity
    for (const c of cells) {
      const p = hexToWorld(c, f)
      sx += p.x
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
    }
    expect(minX + maxX).toBeCloseTo(0, 9)
    expect(Math.abs(sx / cells.length)).toBeLessThan(0.5)
  })

  it('worldToHex inverts hexToWorld, including near a hex edge', () => {
    const cells = rect(14, 15)
    const f = frameFor(cells)
    for (const c of cells) {
      const p = hexToWorld(c, f)
      expect(worldToHex(p.x, p.z, f)).toEqual({ q: c.q, r: c.r })
      expect(worldToHex(p.x + 0.45, p.z, f)).toEqual({ q: c.q, r: c.r })
      expect(worldToHex(p.x - 0.45, p.z, f)).toEqual({ q: c.q, r: c.r })
    }
  })

  it('a 14-wide offset board is about 14.5 units wide, and pan stops at its edge', () => {
    const f = frameFor(rect(14, 15))
    expect(f.halfW * 2).toBeCloseTo(14.5, 6)
    expect(panLimits(f)).toEqual({ x: f.halfW, z: f.halfD })
  })

  it('elevation raises the top by one step per level', () => {
    expect(topOf({ elevation: 0 })).toBeCloseTo(BASE_HEIGHT, 9)
    expect(topOf({ elevation: 2 }) - topOf({ elevation: 1 })).toBeCloseTo(ELEV_STEP, 9)
  })
})
