// Everything the interface offers is the engine's own legal-action list, filtered. Which hexes glow, which enemies can be
// clicked, which buttons exist: all of it comes from here, so the board and the buttons can never disagree.
import { isTerminal, legalActions, targetHex, type Action, type GameState } from './engine'

export interface Affordances {
  legal: Action[]
  /** Hex key -> the move that reaches it. An Advance is preferred over a Dash to the same hex, because it is free. */
  moveTo: Map<string, Action>
  /** Hex key -> deploy action. */
  deployTo: Map<string, Action>
  /** Hex key -> the attacks on whatever stands there, for the armed weapon if one is armed. */
  shootAt: Map<string, Action[]>
  /** Unit ids that can be attacked right now with the armed weapon (or any weapon when none is armed). */
  targetable: Set<string>
  /** Hex key -> a Push or Pull step the player may choose (a collision when `collide` is set). */
  pushTo: Map<string, Action>
}

export const hexKey = (h: { q: number; r: number }): string => h.q + ',' + h.r

/**
 * The hex a targeted play (a Command, a Tactics card, a choice) lands on, so a tap there can take it: the hex it names,
 * else its target machine's hex, else its Garrison's, else (a drone step) the drone's. Null when it has no place.
 */
export function actionHex(game: GameState, a: Action): { q: number; r: number } | null {
  if (a.to) return a.to
  if (a.targetUid) return game.units[a.targetUid]?.hex ?? null
  if (a.gid) return game.garrisons[a.gid]?.hex ?? null
  const remotes = (game as unknown as { remotes?: Record<string, { hex: { q: number; r: number } | null }> }).remotes
  if (a.uid && remotes && remotes[a.uid]) return remotes[a.uid]!.hex
  return null
}

const EMPTY: Affordances = { legal: [], moveTo: new Map(), deployTo: new Map(), shootAt: new Map(), targetable: new Set(), pushTo: new Map() }

export function affordances(game: GameState | null, armed: string | null, active: boolean): Affordances {
  if (!game || !active || isTerminal(game)) return EMPTY
  const legal = legalActions(game)
  const moveTo = new Map<string, Action>()
  const deployTo = new Map<string, Action>()
  const shootAt = new Map<string, Action[]>()
  const targetable = new Set<string>()
  const pushTo = new Map<string, Action>()
  for (const a of legal) {
    if (a.type === 'displace' && a.to) {
      pushTo.set(hexKey(a.to), a)
      continue
    }
    if ((a.type === 'advance' || a.type === 'dash' || a.type === 'move' || a.type === 'react_move') && a.to) {
      const k = hexKey(a.to)
      const have = moveTo.get(k)
      // prefer whatever is free: an Advance, a granted Move or Dash, before a Dash that spends the Primary Action
      const rank = (x: Action) => (x.type === 'dash' && !x.free ? 1 : 0)
      if (!have || rank(a) < rank(have)) moveTo.set(k, a)
    } else if (a.type === 'deploy' && a.to) {
      deployTo.set(hexKey(a.to), a)
    } else if ((a.type === 'attack' || a.type === 'react_attack' || (a.type === 'tactics' && a.target)) && a.target) {
      // armed is a weapon id, or 'card:<cid>' for an Attack card from the hand
      if (a.type === 'tactics') {
        if (armed !== 'card:' + a.cid) continue
      } else if (armed && a.wid !== armed) continue
      if (a.type === 'react_attack' && armed) continue
      for (const t of a.targets ?? [a.target]) {
        const h = targetHex(game, t)
        if (!h) continue
        const k = hexKey(h)
        shootAt.set(k, [...(shootAt.get(k) ?? []), a])
        if (t.kind === 'unit') targetable.add(t.id)
      }
    }
  }
  return { legal, moveTo, deployTo, shootAt, targetable, pushTo }
}

/** The single action a click on a hex means, or null. Deploy, then attack (armed), then move. */
export function actionForHex(af: Affordances, key: string, armed: string | null): Action | null {
  const push = af.pushTo.get(key)
  if (push) return push
  const d = af.deployTo.get(key)
  if (d) return d
  const shots = af.shootAt.get(key)
  // an area weapon may catch this hex from several aims: take the aim that catches the most
  if (shots && shots.length && (armed || shots[0]!.type === 'react_attack')) {
    return [...shots].sort((a, b) => (b.targets?.length ?? 1) - (a.targets?.length ?? 1))[0]!
  }
  return af.moveTo.get(key) ?? null
}
