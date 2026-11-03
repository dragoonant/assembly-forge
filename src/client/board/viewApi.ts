// The camera's imperative handle, shared by the HUD (reset button, keys) and the e2e test hooks. Filled in by CameraRig on mount.
import type { View } from './cameraModel'

export interface CameraReadout {
  x: number
  y: number
  z: number
  tx: number
  tz: number
  az: number
  zoom: number
  tilt: number
  dist: number
}

export const viewApi = {
  rotate: (_dir: number): void => {},
  reset: (): void => {},
  setView: (_p: Partial<View>): void => {},
  camera: (): CameraReadout | null => null,
  /** Slow orbit of the board, for the game-over view. */
  orbit: (_on: boolean): void => {},
  /** World point to client pixels, for tests that click a hex. */
  project: (_x: number, _y: number, _z: number): { x: number; y: number } | null => null,
}
