// The presentation planner: which log entries become blocking beats and which become effects.
import { describe, expect, it } from 'vitest'
import { apply, legalActions, newSkirmish, type Action } from '../../src/client/engine'
import { newEntries, plan, WALK_S_PER_HEX } from '../../src/client/presentation/plan'
import { FX_DUR } from '../../src/client/presentation/fxTiming'
import { fxKindFor } from '../../src/client/presentation/weaponFx'

function firstDeploy() {
  const g = newSkirmish('plan-test', 't_lance', 't_anvil')
  const dep = legalActions(g).find((a) => a.type === 'deploy') as Action
  const next = apply(g, dep)
  return { g, next, dep }
}

describe('presentation plan', () => {
  it('a deploy is a blocking beat onto the Base', () => {
    const { g, next, dep } = firstDeploy()
    const p = plan(g, next, newEntries(g, next))
    expect(p.beats).toEqual([{ kind: 'deploy', uid: dep.uid, at: dep.to, dur: 0.7 }])
  })

  it('a move walks the engine path at about 1.5 hexes a second', () => {
    const { next } = firstDeploy()
    const adv = legalActions(next).filter((a) => a.type === 'advance').sort((a, b) => b.path!.length - a.path!.length)[0]!
    const after = apply(next, adv)
    const p = plan(next, after, newEntries(next, after))
    expect(p.beats).toHaveLength(1)
    const b = p.beats[0]!
    expect(b.kind).toBe('move')
    if (b.kind === 'move') {
      expect(b.path).toEqual(adv.path)
      expect(b.dur).toBeCloseTo(WALK_S_PER_HEX * (adv.path!.length - 1))
    }
  })

  it('the game start shows the Phase banner, and nothing blocks', () => {
    const g = newSkirmish('plan-start', 't_lance', 't_anvil')
    const p = plan(g, g, g.log)
    expect(p.beats).toHaveLength(0)
    expect(p.effects.some((e) => e.kind === 'banner' && e.text === 'Phase 1')).toBe(true)
  })

  it('an attack rolls its dice first, then plays the shot, and its damage lands after', () => {
    // hotseat with a simple policy until an attack is legal
    let g = newSkirmish('plan-attack', 't_lance', 't_spear')
    let attack: Action | undefined
    for (let guard = 0; guard < 400 && !attack; guard++) {
      const legal = legalActions(g)
      attack = legal.find((a) => a.type === 'attack')
      if (attack) break
      const pick =
        legal.find((a) => a.type === 'deploy') ??
        legal
          .filter((a) => a.type === 'advance' || a.type === 'dash')
          .sort((a, b) => Math.abs(a.to!.q + a.to!.r / 2) - Math.abs(b.to!.q + b.to!.r / 2))[0] ??
        legal.find((a) => a.type === 'end_activation')!
      g = apply(g, pick)
    }
    expect(attack).toBeDefined()
    const next = apply(g, attack!)
    const entries = newEntries(g, next)
    const p = plan(g, next, entries)
    const kinds = p.beats.map((b) => b.kind)
    const dice = kinds.indexOf('dice')
    const shot = kinds.indexOf('shot')
    expect(dice).toBeGreaterThanOrEqual(0)
    expect(shot).toBe(dice + 1)
    const b = p.beats[shot]!
    if (b.kind === 'shot') {
      const w = g.units[attack!.uid]!.weapons.find((x) => x.wid === attack!.wid)!
      expect(b.fx).toBe(fxKindFor(w))
      expect(b.dur).toBe(FX_DUR[b.fx])
      expect(b.hits.length).toBeGreaterThan(0)
      const outcome = entries.find((e) => e.t === 'attack')!
      expect(b.miss).toBe(outcome.damage === 0)
    }
    const d = p.beats[dice]!
    if (d.kind === 'dice') expect(d.outcome.t).toBe('attack')
    // the damage number is an effect, so it shows after the beats, as the shot lands
    expect(p.effects.some((e) => e.kind === 'float')).toBe(true)
  })
})
