// When things happen inside an attack's shot beat, as fractions of the beat (0 to 1). Pure, so it is unit-tested; the
// board's effects (board/AttackFx.tsx) and the attacker's clip both read it, so the muzzle flash, the recoil and the
// blade swing stay in step at every speed and under ?slowmo.
import type { FxKind } from './weaponFx'

/** Seconds each kind of attack takes at normal speed. */
export const FX_DUR: Record<FxKind, number> = { beam: 1.0, ballistic: 0.9, missile: 1.15, melee: 0.85, blast: 1.05, mortar: 1.2 }

/** The rounds of a ballistic burst: when each leaves the muzzle, and how long it takes to land. */
export const BURST = { rounds: 5, first: 0.25, gap: 0.1, travel: 0.08 } as const
/** The missiles of a salvo: when each launches and how long each flies. */
export const SALVO = { missiles: 4, first: 0.12, gap: 0.07, flight: 0.45 } as const
/** The beam: charge from, fires at, and shuts off at. */
export const BEAM = { charge: 0.12, fire: 0.42, off: 0.86 } as const
/** The melee swing: the dash ends, the blade lands, the return starts. */
export const SWING = { dashEnd: 0.36, strike: 0.46, back: 0.66 } as const
/** The blast: the discharge, and how long the wave takes to reach the far edge of the pattern. */
export const BLAST = { fire: 0.28, spread: 0.3 } as const
/** The mortar shell: launch and landing. */
export const SHELL = { launch: 0.2, land: 0.78 } as const

/** The moment the first hit lands, for the target's jolt. */
export function impactAt(kind: FxKind): number {
  switch (kind) {
    case 'beam':
      return BEAM.fire + 0.03
    case 'ballistic':
      return BURST.first + BURST.travel
    case 'missile':
      return SALVO.first + SALVO.flight
    case 'melee':
      return SWING.strike
    case 'blast':
      return BLAST.fire + 0.04
    case 'mortar':
      return SHELL.land
  }
}

// Key times in the rigged clips (tools/rig/rig_machine.py, 24 frames a second).
const SHOOT = { aim: 6 / 24, kick: 9 / 24, settle: 13 / 24, end: 20 / 24 }
const MELEE = { windup: 8 / 24, strike: 13 / 24, hold: 19 / 24, end: 26 / 24 }

const lerp = (a: number, b: number, t: number): number => a + (b - a) * Math.max(0, Math.min(1, t))

/** A short recoil pulse after each of `times` (1 right at the shot, gone after `len`). */
function recoil(t: number, times: number[], len = 0.07): number {
  let k = 0
  for (const s of times) if (t >= s && t < s + len) k = Math.max(k, 1 - (t - s) / len)
  return k
}

/** Which clip an attack plays: the melee clip for a melee swing, the shoot clip for everything else. */
export const clipFor = (kind: FxKind): 'melee' | 'shoot' => (kind === 'melee' ? 'melee' : 'shoot')

/**
 * Where the attacker's clip should be, in seconds, at beat progress `t`. The clip is driven by the beat rather than by the
 * clock, so the aim is held while the weapon fires and every shot of a burst kicks the arm.
 */
export function clipTimeAt(kind: FxKind, t: number): number {
  if (kind === 'melee') {
    if (t < SWING.dashEnd) return lerp(0, MELEE.windup, t / SWING.dashEnd)
    if (t < SWING.strike) return lerp(MELEE.windup, MELEE.strike, (t - SWING.dashEnd) / (SWING.strike - SWING.dashEnd))
    if (t < SWING.back) return lerp(MELEE.strike, MELEE.hold, (t - SWING.strike) / (SWING.back - SWING.strike))
    return lerp(MELEE.hold, MELEE.end, (t - SWING.back) / (1 - SWING.back))
  }
  const fires = fireTimes(kind)
  const raise = Math.min(0.2, fires[0]! * 0.9)
  if (t < raise) return lerp(0, SHOOT.aim, t / raise)
  const lower = 0.86
  if (t >= lower) return lerp(SHOOT.settle, SHOOT.end, (t - lower) / (1 - lower))
  // held on aim, kicked toward the recoil pose by each shot
  return lerp(SHOOT.aim, SHOOT.kick, recoil(t, fires))
}

/** When the weapon fires (the muzzle flashes and the arm kicks). */
export function fireTimes(kind: FxKind): number[] {
  switch (kind) {
    case 'ballistic':
      return Array.from({ length: BURST.rounds }, (_, i) => BURST.first + i * BURST.gap)
    case 'missile':
      return Array.from({ length: SALVO.missiles }, (_, i) => SALVO.first + i * SALVO.gap)
    case 'beam':
      return [BEAM.fire]
    case 'blast':
      return [BLAST.fire]
    case 'mortar':
      return [SHELL.launch]
    case 'melee':
      return [SWING.strike]
  }
}

/**
 * The attacker's lunge for a melee swing, as a fraction of the way to the point just short of the target: out fast on the
 * dash, held through the swing, back home after.
 */
export function lungeAt(t: number): number {
  const smooth = (x: number): number => x * x * (3 - 2 * x)
  if (t < SWING.dashEnd) return smooth(t / SWING.dashEnd)
  if (t < SWING.back) return 1
  return 1 - smooth((t - SWING.back) / (1 - SWING.back))
}
