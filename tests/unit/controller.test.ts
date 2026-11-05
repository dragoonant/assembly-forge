// The controller's attack path: a player's attack rolls its dice first, then plays the shot, and only commits the new
// state when the shot lands, so the board and the damage change together. Runs the real engine through game.ts with no DOM.
import { describe, expect, it, vi } from 'vitest'
import { closeDice, deploy, take } from '../../src/client/game'
import { legalActions } from '../../src/client/engine'
import { getStore, setStore } from '../../src/client/store'

describe('controller', () => {
  it('rolls the dice, then plays the shot, then commits the attack', async () => {
    setStore({ ai: [false, false], speed: 'normal', mySquad: ['u03', 'u02', 'u01'], foeSquad: ['u05', 'u03', 'u02'] })
    deploy('controller-attack')
    // hotseat: play both sides with a simple policy until an attack is legal
    let guard = 0
    while (guard++ < 400) {
      const g = getStore().game!
      const legal = legalActions(g)
      const attack = legal.find((a) => a.type === 'attack')
      if (attack) {
        const before = g
        take(attack)
        expect(getStore().busy).toBe(true)
        // the dice come first, before any animation, and nothing is committed yet
        expect(getStore().dice).not.toBeNull()
        expect(getStore().beat).toBeNull()
        expect(getStore().game).toBe(before)
        closeDice()
        // then the shot plays, still before the commit
        await vi.waitFor(() => expect(getStore().beat?.kind).toBe('shot'))
        expect(getStore().dice).toBeNull()
        expect(getStore().game).toBe(before)
        await vi.waitFor(() => expect(getStore().game).not.toBe(before), { timeout: 3000 })
        await vi.waitFor(() => expect(getStore().busy).toBe(false))
        expect(getStore().dice).toBeNull()
        return
      }
      // otherwise: deploy, move toward the middle, then end the turn
      const pick =
        legal.find((a) => a.type === 'deploy') ??
        legal
          .filter((a) => a.type === 'advance' || a.type === 'dash')
          .sort((a, b) => Math.abs(a.to!.q + a.to!.r / 2) - Math.abs(b.to!.q + b.to!.r / 2))[0] ??
        legal.find((a) => a.type === 'energize') ??
        legal.find((a) => a.type === 'end_activation')!
      // the instant speed skips animations, so the setup moves resolve at once
      setStore({ speed: 'instant' })
      take(pick)
      await vi.waitFor(() => expect(getStore().busy).toBe(false))
      setStore({ speed: 'normal' })
    }
    throw new Error('no attack became legal in 400 actions')
  })
})
