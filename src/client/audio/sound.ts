// Sound. The cues are synthesized in the browser with the Web Audio API, so nothing is fetched and no paid generation
// was spent on them; recorded cues can replace these later under the same names (MegaMechaTactics' SFX_PROMPTS keys).
// The one music bed (generated for MegaMechaTactics) loops quietly on the setup screens. Mix levels follow the 2D game:
// cues about 0.55, the bed about 0.28. Audio starts only after the first user gesture, as browsers require.
import { getStore, setStore } from '../store'

const CUE_GAIN = 0.55
const BED_GAIN = 0.28
const MUTE_KEY = 'assembly-forge.muted'

let ctx: AudioContext | null = null
let bed: HTMLAudioElement | null = null

function audio(): AudioContext | null {
  if (getStore().muted) return null
  if (!ctx) {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      ctx = AC ? new AC() : null
    } catch {
      ctx = null
    }
  }
  if (ctx && ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** A short tone with an envelope. */
function tone(a: AudioContext, freq: number, endFreq: number, dur: number, type: OscillatorType, gain: number, at = 0): void {
  const t0 = a.currentTime + at
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain * CUE_GAIN, t0 + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(a.destination)
  o.start(t0)
  o.stop(t0 + dur + 0.02)
}

/** A burst of filtered noise. */
function noise(a: AudioContext, dur: number, cutoff: number, gain: number, at = 0): void {
  const t0 = a.currentTime + at
  const len = Math.max(1, Math.floor(a.sampleRate * dur))
  const buf = a.createBuffer(1, len, a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = a.createBufferSource()
  src.buffer = buf
  const f = a.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.value = cutoff
  const g = a.createGain()
  g.gain.value = gain * CUE_GAIN
  src.connect(f).connect(g).connect(a.destination)
  src.start(t0)
}

const CUES: Record<string, (a: AudioContext) => void> = {
  move: (a) => tone(a, 180, 120, 0.12, 'square', 0.12),
  deploy: (a) => {
    tone(a, 120, 520, 0.35, 'sawtooth', 0.12)
    noise(a, 0.3, 1800, 0.25)
  },
  hit: (a) => {
    noise(a, 0.18, 2600, 0.6)
    tone(a, 160, 60, 0.18, 'square', 0.25)
  },
  miss: (a) => noise(a, 0.12, 5000, 0.25),
  destroy: (a) => {
    noise(a, 0.7, 900, 0.9)
    tone(a, 90, 30, 0.7, 'sine', 0.6)
  },
  rescue: (a) => {
    tone(a, 660, 660, 0.12, 'triangle', 0.3)
    tone(a, 880, 880, 0.18, 'triangle', 0.3, 0.1)
  },
  capture: (a) => {
    tone(a, 440, 440, 0.12, 'triangle', 0.28)
    tone(a, 660, 660, 0.2, 'triangle', 0.28, 0.1)
  },
  pickup: (a) => tone(a, 520, 1040, 0.16, 'sine', 0.3),
  ability: (a) => tone(a, 700, 1400, 0.22, 'sine', 0.22),
  phase: (a) => {
    tone(a, 220, 220, 0.6, 'triangle', 0.3)
    tone(a, 330, 330, 0.6, 'triangle', 0.2, 0.05)
  },
}

export function playCue(name: string): void {
  if (getStore().speed === 'instant') return
  const a = audio()
  const cue = CUES[name]
  if (a && cue) {
    try {
      cue(a)
    } catch {
      // a sound failing must never break the game
    }
  }
}

/** The setup screens' music bed; null stops it. */
export function music(on: boolean): void {
  if (on && !getStore().muted) {
    if (!bed) {
      bed = new Audio(import.meta.env.BASE_URL + 'audio/music/setup_bed.mp3')
      bed.loop = true
      bed.volume = BED_GAIN
    }
    void bed.play().catch(() => undefined)
  } else if (bed) {
    bed.pause()
  }
}

export function setMuted(muted: boolean): void {
  setStore({ muted })
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    // storage can be unavailable; the setting then lasts for this visit only
  }
  if (muted) music(false)
}

export function loadMuted(): void {
  try {
    setStore({ muted: window.localStorage.getItem(MUTE_KEY) === '1' })
  } catch {
    // keep the default
  }
}
