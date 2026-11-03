// The board camera: the sibling MapController (pan, rotate, zoom; touch and mouse; clamped), fitted so the whole hex board sits in the
// free part of the window. The fitting search is the sibling's, re-pointed at the hex frame from hexLayout.ts.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { PerspectiveCamera, Vector3 } from 'three'
import { distFor } from './cameraModel'
import { frameCorners, panLimits, type Frame } from './hexLayout'
import { MapController } from './mapController'
import { viewApi } from './viewApi'

export interface Insets {
  left: number
  right: number
  top: number
  bottom: number
}

/** Pixels of the window the HUD leaves for the board: the Timeline column, the action column, the top bar and the hand. */
export function insetsFor(width: number, height: number): Insets {
  if (width >= 900) return { left: 132, right: 300, top: 56, bottom: 150 }
  return { left: 6, right: 6, top: 96, bottom: Math.round(height * 0.4) }
}

/** The human player sits at the left edge (side 0's Base), so the overview looks across the board from there. */
export const HOME_AZ = -Math.PI / 2

const POLAR = 0.78 // radians from straight down, matching the overview pitch in cameraModel

function projectedBounds(cam: PerspectiveCamera, dist: number, az: number, corners: [number, number, number][]) {
  const dir = new Vector3(Math.sin(az) * Math.sin(POLAR), Math.cos(POLAR), Math.cos(az) * Math.sin(POLAR))
  cam.position.copy(dir).multiplyScalar(dist)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  cam.updateProjectionMatrix()
  let minx = Infinity
  let maxx = -Infinity
  let miny = Infinity
  let maxy = -Infinity
  const v = new Vector3()
  for (const c of corners) {
    v.set(c[0], c[1], c[2]).project(cam)
    minx = Math.min(minx, v.x)
    maxx = Math.max(maxx, v.x)
    miny = Math.min(miny, v.y)
    maxy = Math.max(maxy, v.y)
  }
  return { minx, maxx, miny, maxy }
}

/** Distance and pixel shift that place the board inside the inset rectangle (bisection on the camera distance). */
export function fitBoard(fov: number, w: number, h: number, ins: Insets, az: number, frame: Frame): { dist: number; shiftX: number; shiftY: number } {
  const corners = frameCorners(frame)
  const cam = new PerspectiveCamera(fov, w / h, 0.5, 200)
  const freeW = Math.max(120, w - ins.left - ins.right)
  const freeH = Math.max(120, h - ins.top - ins.bottom)
  let lo = 4
  let hi = 120
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2
    const b = projectedBounds(cam, mid, az, corners)
    const pw = ((b.maxx - b.minx) / 2) * w
    const ph = ((b.maxy - b.miny) / 2) * h
    if (pw <= freeW && ph <= freeH) hi = mid
    else lo = mid
  }
  const b = projectedBounds(cam, hi, az, corners)
  const cx = w / 2 + ((b.minx + b.maxx) / 2) * (w / 2)
  const cy = h / 2 - ((b.miny + b.maxy) / 2) * (h / 2)
  return { dist: hi, shiftX: ins.left + freeW / 2 - cx, shiftY: ins.top + freeH / 2 - cy }
}

export function CameraRig({ frame, surface }: { frame: Frame; surface: (x: number, z: number) => number }) {
  const { camera, size, gl } = useThree()
  const ctl = useMemo(() => new MapController(camera as PerspectiveCamera, gl.domElement), [camera, gl])

  useEffect(() => {
    ctl.attach()
    return () => ctl.detach()
  }, [ctl])

  useEffect(() => {
    ctl.surface = surface
  }, [ctl, surface])

  // fit on every resize; a new board starts from the overview
  useEffect(() => {
    const cam = camera as PerspectiveCamera
    const ins = insetsFor(size.width, size.height)
    const fit = fitBoard(cam.fov, size.width, size.height, ins, HOME_AZ, frame)
    const freeW = Math.max(120, size.width - ins.left - ins.right)
    const freeH = Math.max(120, size.height - ins.top - ins.bottom)
    ctl.homeAz = HOME_AZ
    ctl.interactive = true
    ctl.lim = panLimits(frame)
    ctl.setFit({ overview: fit.dist, shiftX: fit.shiftX, shiftY: fit.shiftY, centreX: ins.left + freeW / 2 - size.width / 2, centreY: ins.top + freeH / 2 - size.height / 2 })
  }, [ctl, camera, size.width, size.height, frame])

  useEffect(() => {
    ctl.reset(false)
  }, [ctl, frame])

  useEffect(() => {
    viewApi.rotate = (dir) => ctl.rotateBy(dir)
    viewApi.reset = () => ctl.flyHome()
    viewApi.setView = (p) => ctl.setView(p)
    viewApi.camera = () => {
      const v = ctl.view
      const c = camera.position
      return { x: c.x, y: c.y, z: c.z, tx: v.x, tz: v.z, az: v.az, zoom: v.zoom, tilt: v.tilt, dist: distFor(v.zoom, ctl.fit.overview) }
    }
    viewApi.orbit = (on) => {
      ctl.autoRotate = on
    }
    viewApi.project = (x, y, z) => {
      camera.updateMatrixWorld(true)
      const v = new Vector3(x, y, z).project(camera)
      const r = gl.domElement.getBoundingClientRect()
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
    }
  }, [camera, ctl, gl])

  useFrame((_, dt) => ctl.update(Math.min(dt, 0.1)))

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLElement && /input|textarea/i.test(e.target.tagName)) return
      if (e.key === 'q' || e.key === 'Q') viewApi.rotate(-1)
      if (e.key === 'e' || e.key === 'E') viewApi.rotate(1)
      if (e.key === 'r' || e.key === 'R' || e.key === 'Home') viewApi.reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return null
}
