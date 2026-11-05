// What a rigged figure should be doing right now. The unit mover writes it every frame from the current beat; the
// figure reads it and cross-fades its animation clips. A plain ref in a context, so nothing re-renders per frame.
import { createContext } from 'react'

/** The clip to play ('idle', 'walk', 'jump', 'fly', 'melee', 'shoot', 'hit'), and the length of the beat behind it in s. */
export interface MotionCue {
  clip: string
  beatS: number
}

export const MotionContext = createContext<{ current: MotionCue } | null>(null)
