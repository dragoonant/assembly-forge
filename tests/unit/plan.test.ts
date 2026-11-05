// The presentation planner: which log entries become blocking beats and which become effects.
import { describe, expect, it } from 'vitest'
import { apply, legalActions, newSkirmish, type Action } from '../../src/client/engine'
import { newEntries, plan, WALK_S_PER_HEX } from '../../src/client/presentation/plan'

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
})
