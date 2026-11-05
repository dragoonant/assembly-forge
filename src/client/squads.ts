// The squad rules as the select screen needs them: the pool of machines, whether one more may join a squad, and the
// AI's pick at each difficulty. A thin adapter over the engine's squad API (src/client/engine.ts), so the screen does not
// care how the engine spells it.
import * as Engine from './engine'

export type Difficulty = 'random' | 'easy' | 'hard'
export const DIFFICULTIES: Difficulty[] = ['random', 'easy', 'hard']
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { random: 'Random', easy: 'Easy', hard: 'Hard' }
export const DIFFICULTY_HINT: Record<Difficulty, string> = {
  random: 'The CPU fields any legal squad.',
  easy: 'The CPU fields machines your squad counters well.',
  hard: 'The CPU counter-picks your squad.',
}

const E = Engine as unknown as {
  Squads?: {
    pool: () => string[]
    size: number
    canAdd: (squad: string[], defId: string) => boolean
    pick: (pool: string[], player: string[], difficulty: Difficulty, seed: string) => string[]
  }
  unitDef: (defId: string) => { traits?: string[] }
}

/** Machines a player may choose from, in menu order. */
export function pool(): string[] {
  return E.Squads ? E.Squads.pool() : ['u01', 'u02', 'u03', 'u04', 'u05', 'u06']
}

export function squadSize(): number {
  return E.Squads ? E.Squads.size : 3
}

/** Any machine once, unless it is mass-produced. */
export function canAdd(squad: string[], defId: string): boolean {
  if (squad.length >= squadSize()) return false
  if (E.Squads) return E.Squads.canAdd(squad, defId)
  return !squad.includes(defId) || (E.unitDef(defId).traits ?? []).includes('mass-produced')
}

/** The CPU's squad against the player's, at a difficulty. */
export function cpuSquad(player: string[], difficulty: Difficulty, seed: string): string[] {
  if (E.Squads) return E.Squads.pick(pool(), player, difficulty, seed)
  // no engine picker yet: a seeded random legal squad
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296)
  const out: string[] = []
  const p = pool()
  while (out.length < squadSize()) {
    const d = p[Math.floor(rnd() * p.length)]!
    if (canAdd(out, d)) out.push(d)
  }
  return out
}
