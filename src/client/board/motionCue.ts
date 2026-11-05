// What a rigged figure should be doing right now. The unit mover writes it every frame from the current beat; the
// figure reads it and cross-fades its animation clips. A plain ref in a context, so nothing re-renders per frame.
import { createContext } from 'react'
import type { Object3D } from 'three'

/** The clip to play ('idle', 'walk', 'jump', 'fly', 'melee', 'shoot', 'hit'), and the length of the beat behind it in s. */
export interface MotionCue {
  clip: string
  beatS: number
  /** Hold the clip at this many seconds instead of playing it by the clock (an attack drives its clip from the beat). */
  at?: number
}

/** The cue, plus the figure's model once it has loaded (the attack effects read its bones for muzzles and blade tips). */
export interface MotionRef {
  current: MotionCue
  model?: Object3D | null
}

export const MotionContext = createContext<MotionRef | null>(null)

/** Each unit on the board, by uid: its mover's group (for the stand-in) and its motion ref (for the model). */
export const unitAnchors = new Map<string, { group: { current: Object3D | null }; motion: MotionRef }>()
