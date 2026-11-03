// The map camera's pure maths, ported from Three Kingdoms Tactics (its docs/spec/50-presentation.md "Camera and controls"): no three, no React, no DOM.
// The view is a target point on the table, an azimuth around the vertical axis, a zoom (0 = the fitted overview, 1 = a single unit fills
// the screen) and a tilt offset. Distance and pitch both follow the zoom: close = nearer and more side-on, so faces can be read.

/** Closest the camera comes to its target, in tiles (one unit, about 1.1 tiles tall, then fills most of the screen). */
export const CLOSE_DIST = 2.8
/** Zoom below 0 goes past the overview, to at most about 1.3 times its distance. */
export const ZOOM_MIN = -0.1
export const ZOOM_MAX = 1
/** Elevation (radians above the horizon) of the overview and of the closest view. */
export const EL_FAR = Math.PI / 2 - 0.78
export const EL_NEAR = 0.3
export const EL_MAX = 1.32
/** How far above the sand the orbit target sits at full zoom (chest height of a figure). */
export const EYE_HEIGHT = 0.75
/** The camera never goes nearer than this above the surface under it (sand, hill or wall top). */
export const FLOOR_CLEARANCE = 0.32
export const TILT_MIN = -0.9
export const TILT_MAX = 0.6
/** A press that moves less than this many pixels is a tap, whatever the time it takes (card-games §5). */
export const TAP_SLOP = 8

export interface View {
  /** Orbit target on the table (world units; the board is centred on the origin). */
  x: number
  z: number
  /** Azimuth of the camera around the target, radians; 0 looks north from the south side, + moves the camera east. */
  az: number
  zoom: number
  /** Extra pitch the player added with the right mouse button (radians, + = higher). */
  tilt: number
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const smooth = (t: number): number => t * t * (3 - 2 * t)

/** Distance from the camera to its target for a zoom, given the overview (fitted) distance. Logarithmic: equal wheel steps feel equal. */
export function distFor(zoom: number, overview: number): number {
  const close = Math.min(CLOSE_DIST, overview * 0.5)
  return overview * Math.pow(close / overview, zoom)
}

/** Inverse of distFor. */
export function zoomFor(dist: number, overview: number): number {
  const close = Math.min(CLOSE_DIST, overview * 0.5)
  return Math.log(dist / overview) / Math.log(close / overview)
}

/** Lowest elevation allowed at a zoom: the overview may be tipped nearly edge-on, a close view may graze the sand. */
export function elevationMin(zoom: number): number {
  return 0.16 - 0.07 * smooth(clamp(zoom, 0, 1))
}

/** Pitch for a zoom and a tilt: eases from the overview (45 degrees) to side-on (about 17 degrees) as you zoom in. */
export function elevationFor(zoom: number, tilt: number): number {
  const base = EL_FAR + (EL_NEAR - EL_FAR) * smooth(clamp(zoom, 0, 1))
  return clamp(base + tilt, elevationMin(zoom), EL_MAX)
}

/** Height of the orbit target above the sand: ground level in the overview, a figure's chest when close. */
export function targetHeight(zoom: number, ground: number): number {
  return ground + EYE_HEIGHT * smooth(clamp(zoom, 0, 1))
}

/** Camera position for a view. `floor` is the highest surface within reach of the camera's xz; the camera is lifted clear of it. */
export function cameraPosition(v: View, overview: number, ground: number, floorAt: (x: number, z: number) => number): { x: number; y: number; z: number; ty: number; el: number; dist: number } {
  const dist = distFor(v.zoom, overview)
  const el = elevationFor(v.zoom, v.tilt)
  const ty = targetHeight(v.zoom, ground)
  const ch = Math.cos(el)
  const x = v.x + dist * ch * Math.sin(v.az)
  const z = v.z + dist * ch * Math.cos(v.az)
  const y = Math.max(ty + dist * Math.sin(el), floorAt(x, z) + FLOOR_CLEARANCE)
  return { x, y, z, ty, el, dist }
}

/** Keep the orbit target over the board (and inside the allowed window). */
export function clampView(v: View, lim: { x: number; z: number }): View {
  return { x: clamp(v.x, -lim.x, lim.x), z: clamp(v.z, -lim.z, lim.z), az: v.az, zoom: clamp(v.zoom, ZOOM_MIN, ZOOM_MAX), tilt: clamp(v.tilt, TILT_MIN, TILT_MAX) }
}

/** Rotate the point (x, z) about (px, pz) so that an azimuth measured as in View grows by `d`. */
export function rotateAbout(x: number, z: number, px: number, pz: number, d: number): { x: number; z: number } {
  const dx = x - px
  const dz = z - pz
  const c = Math.cos(d)
  const s = Math.sin(d)
  return { x: px + dx * c + dz * s, z: pz - dx * s + dz * c }
}

export interface Pt {
  x: number
  y: number
}

/** What two fingers did between two samples: scale (distance ratio), twist (radians, clockwise on screen is positive) and the midpoint move. */
export function twoFingerDelta(a0: Pt, b0: Pt, a1: Pt, b1: Pt): { scale: number; twist: number; mid: Pt; midMove: Pt } {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y)
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y)
  let twist = Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x)
  while (twist > Math.PI) twist -= Math.PI * 2
  while (twist < -Math.PI) twist += Math.PI * 2
  const mid = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 }
  const mid0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }
  return { scale: d0 > 1 ? d1 / d0 : 1, twist: d0 > 1 && d1 > 1 ? twist : 0, mid, midMove: { x: mid.x - mid0.x, y: mid.y - mid0.y } }
}

/** True when a press that started at `from` and now sits at `to` has moved far enough to be a drag rather than a tap. */
export function isDrag(from: Pt, to: Pt, slop = TAP_SLOP): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= slop
}

/** Wheel delta in pixels whatever the delta mode (0 pixels, 1 lines, 2 pages). */
export function wheelPixels(deltaY: number, deltaMode: number): number {
  return deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
}

/** Zoom change for a wheel delta (pixels): a notch of 100 px changes the distance by about 12%. */
export function wheelZoom(zoom: number, overview: number, px: number): number {
  const dist = distFor(zoom, overview) * Math.exp(px * 0.0012)
  return clamp(zoomFor(dist, overview), ZOOM_MIN, ZOOM_MAX)
}

/** Velocity (world units per second) of a pan from its last samples, for the inertia after release. */
export function releaseVelocity(samples: { t: number; x: number; z: number }[], now: number, window = 0.1): { x: number; z: number } {
  const recent = samples.filter((s) => now - s.t <= window)
  if (recent.length < 2) return { x: 0, z: 0 }
  const a = recent[0]!
  const b = recent[recent.length - 1]!
  const dt = Math.max(0.016, b.t - a.t)
  return { x: (b.x - a.x) / dt, z: (b.z - a.z) / dt }
}
