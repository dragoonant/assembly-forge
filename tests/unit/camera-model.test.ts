// The map camera's maths (docs/spec/50-presentation.md "Camera and controls"): zoom distance and pitch, the floor clamp, the pinch and
// twist deltas, and tap versus drag. Ported from Three Kingdoms Tactics with the tent-cloth fade tests removed.
import { describe, expect, it } from 'vitest'
import {
  CLOSE_DIST,
  EL_FAR,
  FLOOR_CLEARANCE,
  TAP_SLOP,
  ZOOM_MAX,
  ZOOM_MIN,
  cameraPosition,
  clampView,
  distFor,
  elevationFor,
  elevationMin,
  isDrag,
  releaseVelocity,
  rotateAbout,
  twoFingerDelta,
  wheelPixels,
  wheelZoom,
  zoomFor,
} from '../../src/client/board/cameraModel'

describe('zoom', () => {
  it('distFor and zoomFor are inverses, zoom 0 is the overview and zoom 1 is the closest', () => {
    for (const overview of [18, 25, 57]) {
      expect(distFor(0, overview)).toBeCloseTo(overview, 6)
      expect(distFor(1, overview)).toBeCloseTo(CLOSE_DIST, 6)
      for (const z of [-0.1, 0.2, 0.5, 0.9]) expect(zoomFor(distFor(z, overview), overview)).toBeCloseTo(z, 6)
    }
  })
  it('the closest distance is about one unit from a unit (under 3.5 tiles) and the zoom-out stays within 1.4x', () => {
    expect(CLOSE_DIST).toBeLessThan(3.5)
    expect(distFor(ZOOM_MIN, 25)).toBeLessThan(25 * 1.4)
  })
  it('a wheel notch changes the distance by about 12% and the zoom stays clamped', () => {
    const d1 = distFor(wheelZoom(0, 25, -100), 25)
    expect(d1 / 25).toBeCloseTo(Math.exp(-0.12), 2)
    expect(wheelZoom(0.95, 25, -100000)).toBe(ZOOM_MAX)
    expect(wheelZoom(0, 25, 100000)).toBe(ZOOM_MIN)
    expect(wheelPixels(3, 1)).toBe(48)
    expect(wheelPixels(1, 2)).toBe(400)
  })
})

describe('pitch eases lower as you zoom in', () => {
  it('is the overview pitch at zoom 0, side-on at zoom 1, and decreases monotonically between', () => {
    expect(elevationFor(0, 0)).toBeCloseTo(EL_FAR, 6)
    let prev = Infinity
    for (let z = 0; z <= 1.0001; z += 0.1) {
      const e = elevationFor(z, 0)
      expect(e).toBeLessThanOrEqual(prev + 1e-9)
      prev = e
    }
    expect(elevationFor(1, 0)).toBeLessThan(0.4)
    expect(elevationFor(1, 0)).toBeGreaterThan(0.1)
  })
  it('the tilt moves it but never below the minimum or above the cap', () => {
    expect(elevationFor(0, -5)).toBeCloseTo(elevationMin(0), 6)
    expect(elevationFor(0, 5)).toBeLessThanOrEqual(1.33)
    expect(elevationMin(1)).toBeLessThan(elevationMin(0))
  })
})

describe('camera position never goes under a surface', () => {
  const view = { x: 0, z: 0, az: 0, zoom: 1, tilt: -5 }
  it('is lifted clear of a high surface under the camera', () => {
    const wallTop = 0.95
    const p = cameraPosition(view, 25, 0.1, () => wallTop)
    expect(p.y).toBeGreaterThanOrEqual(wallTop + FLOOR_CLEARANCE - 1e-9)
  })
  it('keeps the camera above the sand at every zoom, tilt and azimuth', () => {
    for (const zoom of [-0.1, 0, 0.4, 0.8, 1]) {
      for (const tilt of [-0.9, 0, 0.6]) {
        for (const az of [0, 1, 2, 3, 4, 5]) {
          const p = cameraPosition({ x: 2, z: -1, az, zoom, tilt }, 25, 0.1, () => 0.1)
          expect(p.y).toBeGreaterThanOrEqual(0.1 + FLOOR_CLEARANCE - 1e-9)
          expect(p.dist).toBeGreaterThan(0)
        }
      }
    }
  })
  it('looks at the target and sits on the side of the azimuth', () => {
    const p = cameraPosition({ x: 0, z: 0, az: Math.PI / 2, zoom: 0, tilt: 0 }, 20, 0.1, () => 0)
    expect(p.x).toBeGreaterThan(10)
    expect(Math.abs(p.z)).toBeLessThan(1e-6)
  })
})

describe('clamp, rotate and gestures', () => {
  it('clampView keeps the target over the board and the zoom and tilt in range', () => {
    const v = clampView({ x: 99, z: -99, az: 7, zoom: 9, tilt: 9 }, { x: 5, z: 4 })
    expect(v).toMatchObject({ x: 5, z: -4, az: 7, zoom: ZOOM_MAX })
    expect(v.tilt).toBeLessThanOrEqual(1)
  })
  it('rotateAbout turns the azimuth of an offset the same way the camera azimuth grows', () => {
    const r = rotateAbout(0, 1, 0, 0, Math.PI / 2) // camera south of the target (az 0) moves to the east (az +90 degrees)
    expect(r.x).toBeCloseTo(1, 6)
    expect(r.z).toBeCloseTo(0, 6)
    const p = rotateAbout(3, 2, 3, 2, 1.2)
    expect(p).toEqual({ x: 3, z: 2 })
  })
  it('twoFingerDelta reads scale, twist (clockwise positive) and the midpoint', () => {
    const d = twoFingerDelta({ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 90, y: 100 }, { x: 210, y: 100 })
    expect(d.scale).toBeCloseTo(1.2, 6)
    expect(d.twist).toBeCloseTo(0, 6)
    expect(d.mid).toEqual({ x: 150, y: 100 })
    const t = twoFingerDelta({ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 200, y: 150 })
    expect(t.twist).toBeGreaterThan(0.4)
    expect(t.scale).toBeGreaterThan(1)
    const wrap = twoFingerDelta({ x: 0, y: 0 }, { x: -10, y: 0.5 }, { x: 0, y: 0 }, { x: -10, y: -0.5 })
    expect(Math.abs(wrap.twist)).toBeLessThan(0.2) // no 2*pi jump across the atan2 seam
  })
  it('a press is a tap below 8 px, whatever the time, and a drag from 8 px', () => {
    expect(TAP_SLOP).toBe(8)
    expect(isDrag({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe(false)
    expect(isDrag({ x: 0, y: 0 }, { x: 8, y: 0 })).toBe(true)
  })
  it('releaseVelocity uses only the latest samples', () => {
    const now = 10
    const v = releaseVelocity(
      [
        { t: 9.5, x: 0, z: 0 },
        { t: 9.92, x: 1, z: 0 },
        { t: 10, x: 1.8, z: 0 },
      ],
      now,
    )
    expect(v.x).toBeCloseTo(10, 5)
    expect(releaseVelocity([{ t: 9.99, x: 0, z: 0 }], now)).toEqual({ x: 0, z: 0 })
  })
})
