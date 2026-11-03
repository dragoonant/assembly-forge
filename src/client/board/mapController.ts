// The map camera's input and motion (docs/spec/50-presentation.md "Camera and controls"). Pointer events only, so one code path serves touch, pen and mouse.
//   touch:  one finger drags the map, two fingers twist to rotate and pinch to zoom (towards the midpoint of the fingers).
//   mouse:  left drag pans, right or middle drag rotates and tilts, wheel zooms towards the cursor, Q / E turn the table, R resets the view.
// A press that moves less than 8 px is a tap (see gesture.ts); a drag or a second finger is never a tap.
import { PerspectiveCamera, Raycaster, Vector2 } from 'three'
import {
  ZOOM_MAX,
  ZOOM_MIN,
  cameraPosition,
  clamp,
  clampView,
  distFor,
  isDrag,
  releaseVelocity,
  rotateAbout,
  twoFingerDelta,
  wheelPixels,
  wheelZoom,
  zoomFor,
  type Pt,
  type View,
} from './cameraModel'
import { gesture } from './gesture'

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const smooth = (t: number): number => t * t * (3 - 2 * t)
/** Sand level: the plane the map is dragged on. */
const PLANE_Y = 0.1

interface Tracked extends Pt {
  type: string
  button: number
}

export interface Fit {
  overview: number
  /** Pixel shift that puts the whole board in the free part of the window (overview) and the target in it (close). */
  shiftX: number
  shiftY: number
  centreX: number
  centreY: number
}

export class MapController {
  view: View = { x: 0, z: 0, az: 0, zoom: 0, tilt: 0 }
  fit: Fit = { overview: 22, shiftX: 0, shiftY: 0, centreX: 0, centreY: 0 }
  interactive = false
  autoRotate = false
  lim = { x: 5, z: 4.5 }
  /** Height of the highest surface at a world point (sand, hill or wall top): the camera never goes below it. */
  surface: (x: number, z: number) => number = () => PLANE_Y

  private goalZoom = 0
  private goalAz = 0
  private goalPan: { x: number; z: number; tilt: number } | null = null
  private anchor: Pt | null = null
  private vel = { x: 0, z: 0 }
  private pointers = new Map<number, Tracked>()
  private down: Pt | null = null
  private panGround: { x: number; z: number } | null = null
  private samples: { t: number; x: number; z: number }[] = []
  private pinchPrev: [Pt, Pt] | null = null
  private ray = new Raycaster()
  private ndc = new Vector2()
  private cleanup: (() => void) | null = null

  constructor(
    readonly camera: PerspectiveCamera,
    readonly dom: HTMLElement,
  ) {}

  // ------------------------------------------------------------------ camera placement
  private size(): { w: number; h: number; left: number; top: number } {
    const r = this.dom.getBoundingClientRect()
    return { w: Math.max(1, r.width), h: Math.max(1, r.height), left: r.left, top: r.top }
  }

  /** Put the camera where the current view says (position, look-at, near plane and the framing offset). */
  apply(): void {
    const v = this.view
    const f = this.fit
    const surf = this.surface
    const floorAt = (x: number, z: number): number => Math.max(surf(x, z), surf(x + 0.5, z), surf(x - 0.5, z), surf(x, z + 0.5), surf(x, z - 0.5))
    const p = cameraPosition(v, f.overview, surf(v.x, v.z), floorAt)
    const cam = this.camera
    cam.position.set(p.x, p.y, p.z)
    cam.lookAt(v.x, p.ty, v.z)
    cam.near = clamp(p.dist * 0.02, 0.05, 0.5)
    const k = smooth(clamp(v.zoom, 0, 1))
    const { w, h } = this.size()
    cam.setViewOffset(w, h, -lerp(f.shiftX, f.centreX, k), -lerp(f.shiftY, f.centreY, k), w, h)
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld(true)
  }

  /** The table point under a screen point (client pixels), or null when the ray does not reach the sand. */
  groundAt(pt: Pt, planeY = PLANE_Y): { x: number; z: number } | null {
    const { w, h, left, top } = this.size()
    this.ndc.set(((pt.x - left) / w) * 2 - 1, -((pt.y - top) / h) * 2 + 1)
    this.ray.setFromCamera(this.ndc, this.camera)
    const o = this.ray.ray.origin
    const d = this.ray.ray.direction
    if (d.y > -0.02) return null
    const t = (planeY - o.y) / d.y
    if (t < 0 || t > 160) return null
    return { x: o.x + d.x * t, z: o.z + d.z * t }
  }

  setFit(fit: Fit): void {
    this.fit = fit
    this.apply()
  }

  /** Back to the fitted overview (keeps the azimuth), at once. */
  reset(keepAz = true): void {
    this.view = { x: 0, z: 0, az: keepAz ? this.view.az : 0, zoom: 0, tilt: 0 }
    this.goalZoom = 0
    this.goalAz = this.view.az
    this.goalPan = null
    this.anchor = null
    this.vel = { x: 0, z: 0 }
    this.apply()
  }

  /** Glide back to the overview. */
  flyHome(): void {
    this.goalZoom = 0
    this.anchor = null
    this.goalPan = { x: 0, z: 0, tilt: 0 }
    this.vel = { x: 0, z: 0 }
  }

  /** Glide to a table point at a zoom. */
  flyTo(x: number, z: number, zoom: number): void {
    this.goalZoom = clamp(zoom, ZOOM_MIN, ZOOM_MAX)
    this.anchor = null
    this.goalPan = { x: clamp(x, -this.lim.x, this.lim.x), z: clamp(z, -this.lim.z, this.lim.z), tilt: this.view.tilt }
    this.vel = { x: 0, z: 0 }
  }

  /** Turn the table by eighth-turns (Q / E and the rotate buttons). */
  rotateBy(dir: number): void {
    this.goalAz = this.goalAz + (dir * Math.PI) / 8
    this.anchor = null
  }

  /** Set part of the view at once (tests and tools). */
  setView(p: Partial<View>): void {
    this.view = clampView({ ...this.view, ...p }, this.lim)
    this.goalZoom = this.view.zoom
    this.goalAz = this.view.az
    this.goalPan = null
    this.anchor = null
    this.vel = { x: 0, z: 0 }
    this.apply()
  }

  // ------------------------------------------------------------------ zoom, pan, rotate primitives
  /** Zoom to `zoom` keeping the table point under `at` (client pixels) where it is. */
  private zoomAt(zoom: number, at: Pt | null): void {
    const before = at ? this.groundAt(at) : null
    this.view.zoom = clamp(zoom, ZOOM_MIN, ZOOM_MAX)
    this.apply()
    if (before && at) {
      for (let i = 0; i < 2; i++) {
        const after = this.groundAt(at)
        if (!after) break
        this.view.x += before.x - after.x
        this.view.z += before.z - after.z
        this.view = clampView(this.view, this.lim)
        this.apply()
      }
    }
  }

  private rotateAboutPoint(p: { x: number; z: number }, d: number): void {
    const t = rotateAbout(this.view.x, this.view.z, p.x, p.z, d)
    this.view.x = t.x
    this.view.z = t.z
    this.view.az += d
    this.goalAz = this.view.az
    this.view = clampView(this.view, this.lim)
    this.apply()
  }

  /** Drag the map so that the table point `panGround` follows the finger at `to`. */
  private dragTo(to: Pt): void {
    if (!this.panGround) return
    const g = this.groundAt(to)
    if (!g) return
    this.view.x += this.panGround.x - g.x
    this.view.z += this.panGround.z - g.z
    this.view = clampView(this.view, this.lim)
    this.apply()
    // re-grab: at the board edge the clamp stops the map, and the grip must not accumulate a lead
    this.panGround = this.groundAt(to) ?? this.panGround
    this.samples.push({ t: performance.now() / 1000, x: this.view.x, z: this.view.z })
    if (this.samples.length > 12) this.samples.shift()
  }

  // ------------------------------------------------------------------ frame update
  update(dt: number): void {
    const v = this.view
    if (this.autoRotate) {
      v.az += dt * 0.0524
      this.goalAz = v.az
      this.apply()
      return
    }
    if (!this.interactive) return
    let moved = false
    if (Math.abs(this.goalZoom - v.zoom) > 1e-4) {
      const k = 1 - Math.exp(-dt * 14)
      const z = Math.abs(this.goalZoom - v.zoom) < 0.0008 ? this.goalZoom : v.zoom + (this.goalZoom - v.zoom) * k
      this.zoomAt(z, this.anchor)
      moved = true
    }
    if (Math.abs(this.goalAz - v.az) > 1e-4) {
      const k = 1 - Math.exp(-dt * 11)
      v.az = Math.abs(this.goalAz - v.az) < 0.0008 ? this.goalAz : v.az + (this.goalAz - v.az) * k
      moved = true
    }
    if (this.goalPan) {
      const k = 1 - Math.exp(-dt * 7)
      const g = this.goalPan
      v.x += (g.x - v.x) * k
      v.z += (g.z - v.z) * k
      v.tilt += (g.tilt - v.tilt) * k
      if (Math.hypot(g.x - v.x, g.z - v.z) < 0.01 && Math.abs(g.tilt - v.tilt) < 0.005) {
        v.x = g.x
        v.z = g.z
        v.tilt = g.tilt
        this.goalPan = null
      }
      moved = true
    }
    if (this.vel.x !== 0 || this.vel.z !== 0) {
      const before = { x: v.x, z: v.z }
      v.x += this.vel.x * dt
      v.z += this.vel.z * dt
      this.view = clampView(v, this.lim)
      if (this.view.x !== before.x + this.vel.x * dt) this.vel.x = 0
      if (this.view.z !== before.z + this.vel.z * dt) this.vel.z = 0
      const decay = Math.exp(-dt * 4.2)
      this.vel.x *= decay
      this.vel.z *= decay
      if (Math.hypot(this.vel.x, this.vel.z) < 0.04) this.vel = { x: 0, z: 0 }
      moved = true
    }
    if (moved) {
      this.view = clampView(this.view, this.lim)
      this.apply()
    }
  }

  // ------------------------------------------------------------------ pointer input
  private startPan(at: Pt): void {
    this.panGround = this.groundAt(at)
    this.samples = []
    this.vel = { x: 0, z: 0 }
    this.goalPan = null
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.interactive) return
    if (this.pointers.size === 0) {
      gesture.dragged = false
      this.down = { x: e.clientX, y: e.clientY }
    } else {
      gesture.dragged = true
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType, button: e.button })
    try {
      this.dom.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointers cannot be captured */
    }
    this.vel = { x: 0, z: 0 }
    this.goalPan = null
    if (this.pointers.size === 2) {
      this.panGround = null
      this.pinchPrev = this.pair()
    }
  }

  private pair(): [Pt, Pt] | null {
    const pts = [...this.pointers.values()]
    return pts.length >= 2 ? [{ x: pts[0]!.x, y: pts[0]!.y }, { x: pts[1]!.x, y: pts[1]!.y }] : null
  }

  private onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId)
    if (!p || !this.interactive) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
    if (this.pointers.size >= 2) {
      this.pinchStep()
      return
    }
    const cur = { x: e.clientX, y: e.clientY }
    if (p.type === 'mouse' && (p.button === 2 || p.button === 1)) {
      if (this.down && isDrag(this.down, cur)) gesture.dragged = true
      this.view.az -= dx * 0.006
      this.goalAz = this.view.az
      this.view.tilt += dy * 0.004
      this.view = clampView(this.view, this.lim)
      this.apply()
      return
    }
    if (!gesture.dragged) {
      if (this.down && isDrag(this.down, cur)) {
        gesture.dragged = true
        this.startPan(cur)
      }
      return
    }
    if (!this.panGround) this.startPan(cur)
    this.dragTo(cur)
  }

  private pinchStep(): void {
    const cur = this.pair()
    const prev = this.pinchPrev
    if (!cur || !prev) return
    this.pinchPrev = cur
    const d = twoFingerDelta(prev[0], prev[1], cur[0], cur[1])
    const mid0 = { x: (prev[0].x + prev[1].x) / 2, y: (prev[0].y + prev[1].y) / 2 }
    const g0 = this.groundAt(mid0)
    if (g0 && d.twist !== 0) this.rotateAboutPoint(g0, d.twist)
    if (d.scale !== 1) {
      const dist = Math.max(1e-3, distFor(this.view.zoom, this.fit.overview) / d.scale)
      this.zoomAt(clamp(zoomFor(dist, this.fit.overview), ZOOM_MIN, ZOOM_MAX), mid0)
      this.goalZoom = this.view.zoom
    }
    if (g0) {
      const g1 = this.groundAt(d.mid)
      if (g1) {
        this.view.x += g0.x - g1.x
        this.view.z += g0.z - g1.z
        this.view = clampView(this.view, this.lim)
        this.apply()
      }
    }
  }

  private onUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId)
    if (!p) return
    this.pointers.delete(e.pointerId)
    try {
      this.dom.releasePointerCapture(e.pointerId)
    } catch {
      /* not captured */
    }
    this.pinchPrev = null
    if (this.pointers.size === 1) {
      // the remaining finger carries on as a pan, from where it is now
      const rest = [...this.pointers.values()][0]!
      this.startPan(rest)
    } else if (this.pointers.size === 0) {
      if (gesture.dragged && this.panGround && e.type === 'pointerup') {
        const v = releaseVelocity(this.samples, performance.now() / 1000)
        const sp = Math.hypot(v.x, v.z)
        if (sp > 0.6) {
          const cap = Math.min(1, 24 / sp)
          this.vel = { x: v.x * cap, z: v.z * cap }
        }
      }
      this.panGround = null
      this.down = null
    }
  }

  private onWheel = (e: WheelEvent): void => {
    if (!this.interactive) return
    e.preventDefault()
    const px = wheelPixels(e.deltaY, e.deltaMode) * (e.ctrlKey ? 2.5 : 1)
    this.goalZoom = wheelZoom(this.goalZoom, this.fit.overview, px)
    this.anchor = { x: e.clientX, y: e.clientY }
    this.vel = { x: 0, z: 0 }
    this.goalPan = null
  }

  private onContext = (e: Event): void => e.preventDefault()

  attach(): void {
    const d = this.dom
    d.style.touchAction = 'none'
    d.addEventListener('pointerdown', this.onDown)
    d.addEventListener('pointermove', this.onMove)
    d.addEventListener('pointerup', this.onUp)
    d.addEventListener('pointercancel', this.onUp)
    d.addEventListener('wheel', this.onWheel, { passive: false })
    d.addEventListener('contextmenu', this.onContext)
    this.cleanup = () => {
      d.removeEventListener('pointerdown', this.onDown)
      d.removeEventListener('pointermove', this.onMove)
      d.removeEventListener('pointerup', this.onUp)
      d.removeEventListener('pointercancel', this.onUp)
      d.removeEventListener('wheel', this.onWheel)
      d.removeEventListener('contextmenu', this.onContext)
    }
  }

  detach(): void {
    this.cleanup?.()
    this.cleanup = null
    this.pointers.clear()
  }
}
