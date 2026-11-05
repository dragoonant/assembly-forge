// Plays a presentation plan (plan.ts). Blocking beats run one after another and resolve when they finish or when the
// player clicks to skip; a dice beat hands over to the controller, which shows the dice panel and resumes when it closes; effects are dropped into the store with a birth time and cleared when they have faded. Speed
// follows the opponent-speed setting: normal is full length, fast is 0.4x, instant shows nothing at all.
import { viewApi } from '../board/viewApi'
import type { GameState } from '../engine'
import { getStore, setStore, type Speed } from '../store'
import { playCue } from '../audio/sound'
import type { Beat, Effect } from './plan'

export const SPEED_FACTOR: Record<Speed, number> = { normal: 1, fast: 0.4, instant: 0 }

/** How long each effect stays on screen, in ms at full speed. */
export const EFFECT_MS = { burst: 450, wreck: 1100, float: 1300, banner: 1500 } as const

let skipCurrent: (() => void) | null = null
/** Review switch (?slowmo=N): every blocking beat runs N times longer, so an animation can be watched or screenshotted. */
let slowmo = 1
export function setSlowmo(n: number): void {
  slowmo = Number.isFinite(n) && n > 0 ? n : 1
}
export const getSlowmo = (): number => slowmo
let nextId = 1

/** Skip the beat now playing, if any. Wired to any click on the page while a beat is running. */
export function skipBeat(): void {
  if (skipCurrent) skipCurrent()
}

function runBeat(b: Beat, onDice?: (b: Extract<Beat, { kind: 'dice' }>) => Promise<void>): Promise<void> {
  if (b.kind === 'dice') return onDice ? onDice(b) : Promise.resolve()
  const f = SPEED_FACTOR[getStore().speed]
  if (f === 0 || b.dur <= 0) return Promise.resolve()
  const ms = b.dur * f * slowmo * 1000
  setStore({ beat: b, beatStart: performance.now(), beatMs: ms })
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      skipCurrent = null
      setStore({ beat: null })
      resolve()
    }
    const timer = setTimeout(done, ms)
    skipCurrent = done
  })
}

/**
 * Play the beats in order. `onDice` shows an attack's dice and resolves when the panel closes; `stillCurrent` is asked
 * between beats, so a new game abandons the rest of an old one's plan.
 */
export async function runBeats(beats: Beat[], onDice?: (b: Extract<Beat, { kind: 'dice' }>) => Promise<void>, stillCurrent: () => boolean = () => true): Promise<void> {
  for (const b of beats) {
    if (!stillCurrent()) return
    await runBeat(b, onDice)
  }
}

/** Show the effects. Returns how long, in ms, the caller should wait before the next action for them to read. */
export function runEffects(effects: Effect[], game: GameState, settleS: number): number {
  const f = SPEED_FACTOR[getStore().speed]
  for (const e of effects) {
    if (e.kind === 'cue') {
      playCue(e.cue)
      continue
    }
    if (e.kind === 'orbit') {
      viewApi.orbit(true)
      continue
    }
    if (f === 0) continue
    const born = performance.now()
    const id = nextId++
    if (e.kind === 'burst') {
      setStore((s) => ({ bursts: [...s.bursts, { id, at: e.at, colour: e.colour, born }] }))
      later(EFFECT_MS.burst * f, () => setStore((s) => ({ bursts: s.bursts.filter((x) => x.id !== id) })))
    } else if (e.kind === 'wreck') {
      const ms = EFFECT_MS.wreck * f * slowmo
      setStore((s) => ({ wrecks: [...s.wrecks, { id, defId: e.defId, side: e.side, at: e.at, born, ms }] }))
      later(ms, () =>
        setStore((s) => ({
          wrecks: s.wrecks.filter((x) => x.id !== id),
          // the scorch mark stays for the rest of the round
          scorches: [...s.scorches, { id, at: e.at, phase: game.phase, round: game.round }],
        })),
      )
    } else if (e.kind === 'float') {
      setStore((s) => ({ floats: [...s.floats, { id, at: e.at, text: e.text, colour: e.colour, born }] }))
      later(EFFECT_MS.float * f, () => setStore((s) => ({ floats: s.floats.filter((x) => x.id !== id) })))
    } else if (e.kind === 'hurt') {
      setStore((s) => ({ hurt: { ...s.hurt, [e.uid]: born } }))
    } else if (e.kind === 'banner') {
      setStore({ banner: { text: e.text, born } })
      later(EFFECT_MS.banner * f, () => setStore((s) => (s.banner && s.banner.born === born ? { banner: null } : {})))
    }
  }
  return settleS * f * 1000
}

function later(ms: number, fn: () => void): void {
  setTimeout(fn, Math.max(0, ms))
}

/** Clear every effect, for a new game. */
export function clearEffects(): void {
  skipCurrent = null
  setStore({ beat: null, bursts: [], wrecks: [], floats: [], scorches: [], banner: null, hurt: {} })
  viewApi.orbit(false)
}
