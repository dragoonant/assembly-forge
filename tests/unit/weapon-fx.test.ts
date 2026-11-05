// The weapon-to-effect map and the timing inside a shot beat.
import { describe, expect, it } from 'vitest'
import { ROSTER, UNITS } from '../../src/content/units.js'
import { BURST, clipTimeAt, FX_DUR, fireTimes, impactAt, lungeAt, SWING } from '../../src/client/presentation/fxTiming'
import { fxKindFor, WEAPON_FX, type FxKind } from '../../src/client/presentation/weaponFx'

const KINDS: FxKind[] = ['beam', 'ballistic', 'missile', 'melee', 'blast', 'mortar']

describe('weapon effects', () => {
  it('every weapon of all fifteen machines has an entry', () => {
    for (let n = 1; n <= 15; n++) {
      const id = 'u' + String(n).padStart(2, '0')
      const def = (UNITS as unknown as Record<string, { weapons: { wid: string }[] }>)[id]!
      for (const w of def.weapons) expect(WEAPON_FX[w.wid], w.wid).toBeDefined()
    }
  })

  it('every weapon in the roster gets a kind, entry or not', () => {
    for (const id of ROSTER as readonly string[]) {
      const def = (UNITS as unknown as Record<string, { weapons: { wid: string; range: number; ignoreLos?: boolean }[] }>)[id]!
      for (const w of def.weapons) expect(KINDS).toContain(fxKindFor(w))
    }
  })

  it('falls back on the stats: melee, mortar, blast, then beam or ballistic by reach', () => {
    expect(fxKindFor({ wid: 'zz1', range: 1 })).toBe('melee')
    expect(fxKindFor({ wid: 'zz2', range: 3, ignoreLos: true })).toBe('mortar')
    expect(fxKindFor({ wid: 'zz3', range: 2, area: [{ q: 1, r: 0 }] })).toBe('blast')
    expect(fxKindFor({ wid: 'zz4', range: 5 })).toBe('beam')
    expect(fxKindFor({ wid: 'zz5', range: 2 })).toBe('ballistic')
    // an entry wins over the stats
    expect(fxKindFor({ wid: 'u06b', range: 3, ignoreLos: true })).toBe('mortar')
    expect(fxKindFor({ wid: 'u02a', range: 2 })).toBe('missile')
  })

  it('every kind fires and lands inside its beat, and has a length', () => {
    for (const k of KINDS) {
      expect(FX_DUR[k]).toBeGreaterThan(0.5)
      for (const f of fireTimes(k)) {
        expect(f).toBeGreaterThan(0)
        expect(f).toBeLessThan(0.9)
      }
      expect(impactAt(k)).toBeGreaterThanOrEqual(fireTimes(k)[0]!)
      expect(impactAt(k)).toBeLessThan(1)
    }
  })

  it('the shoot clip holds the aim through a burst and kicks on every round', () => {
    const aim = clipTimeAt('ballistic', 0.22)
    for (let i = 0; i < BURST.rounds; i++) {
      const f = BURST.first + i * BURST.gap
      expect(clipTimeAt('ballistic', f)).toBeGreaterThan(aim + 0.05)
      expect(clipTimeAt('ballistic', f + 0.08)).toBeCloseTo(aim, 5)
    }
  })

  it('the melee swing dashes out, lands the blow there, and comes back', () => {
    expect(lungeAt(0)).toBe(0)
    expect(lungeAt(SWING.strike)).toBe(1)
    expect(lungeAt(1)).toBe(0)
    // the clip only moves forward through the swing
    let last = -1
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const c = clipTimeAt('melee', t)
      expect(c).toBeGreaterThanOrEqual(last)
      last = c
    }
  })
})
