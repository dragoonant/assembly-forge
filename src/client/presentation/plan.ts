// The presentation plan: which engine log entries become which animations. Pure, so it is unit-tested; the runtime that
// plays a plan is director.ts. Two kinds of beat:
//   - blocking beats play BEFORE the new state is shown (a walk along the path, a deploy, a shot), because the board
//     must not jump to the result before the motion that caused it;
//   - effects play AFTER it is shown and do not block input (a hit burst, a wreck sinking, a floating label, a banner).
import { Names, type Axial, type GameState, type LogEntry, type Side } from '../engine'

/** Seconds per hex of walking: about 1.5 hexes a second (PLAN.md M3). */
export const WALK_S_PER_HEX = 0.66

export type Beat =
  | { kind: 'move'; uid: string; path: Axial[]; dur: number }
  | { kind: 'deploy'; uid: string; at: Axial; dur: number }
  | { kind: 'shot'; uid: string; to: Axial; melee: boolean; dur: number }

export type Effect =
  | { kind: 'burst'; at: Axial; colour: string }
  | { kind: 'wreck'; uid: string; defId: string; side: Side; at: Axial }
  | { kind: 'float'; at: Axial; text: string; colour: string }
  | { kind: 'banner'; text: string }
  | { kind: 'cue'; cue: string }
  | { kind: 'orbit' }

export interface Plan {
  beats: Beat[]
  effects: Effect[]
  /** Seconds the effects need before the next action should start (used to pace the AI). */
  settle: number
}

const COLOUR = { hit: '#ff6a4a', miss: '#c9ced6', vp: '#f0c040', status: '#ffb36b', pickup: '#7fd4ff', tl: '#9aa1ab' }

/** The entries `next` added on top of `prev`. */
export function newEntries(prev: GameState, next: GameState): LogEntry[] {
  return next.log.slice(prev.log.length)
}

export function plan(prev: GameState, next: GameState, entries: LogEntry[]): Plan {
  const beats: Beat[] = []
  const effects: Effect[] = []
  let settle = 0
  for (const e of entries) {
    switch (e.t) {
      case 'advance':
      case 'move':
      case 'dash': {
        const path: Axial[] = e.path && e.path.length > 1 ? e.path : [e.from, e.to]
        beats.push({ kind: 'move', uid: e.uid, path, dur: WALK_S_PER_HEX * (path.length - 1) })
        effects.push({ kind: 'cue', cue: 'move' })
        break
      }
      case 'push':
      case 'pull':
        if (e.to) beats.push({ kind: 'move', uid: e.uid, path: [e.from, e.to], dur: 0.3 })
        break
      case 'deploy':
        beats.push({ kind: 'deploy', uid: e.uid, at: e.to, dur: 0.55 })
        effects.push({ kind: 'cue', cue: 'deploy' })
        break
      case 'attack': {
        const attacker = prev.units[e.uid]
        const to: Axial | null = e.target.kind === 'unit' ? prev.units[e.target.id]?.hex ?? null : prev.garrisons[e.target.id]?.hex ?? null
        if (attacker?.hex && to) {
          const w = attacker.weapons.find((x) => x.wid === e.wid)
          beats.push({ kind: 'shot', uid: e.uid, to, melee: Boolean(w && w.range <= 1), dur: 0.45 })
          effects.push({ kind: 'cue', cue: e.destroyed ? 'destroy' : e.damage > 0 ? 'hit' : 'miss' })
          effects.push({ kind: 'burst', at: to, colour: e.damage > 0 ? COLOUR.hit : COLOUR.miss })
          effects.push({ kind: 'float', at: to, text: e.damage > 0 ? '-' + e.damage : 'miss', colour: e.damage > 0 ? COLOUR.hit : COLOUR.miss })
          if (e.status) effects.push({ kind: 'float', at: to, text: Names.STATUSES[e.status] ?? String(e.status), colour: COLOUR.status })
          settle = Math.max(settle, 0.5)
        }
        break
      }
      case 'destroyed':
        if (e.from) {
          const u = prev.units[e.uid] ?? next.units[e.uid]
          if (u) effects.push({ kind: 'wreck', uid: e.uid, defId: u.defId, side: u.side, at: e.from })
          effects.push({ kind: 'float', at: e.from, text: '+' + e.vp + ' VP', colour: COLOUR.vp })
          settle = Math.max(settle, 0.9)
        }
        break
      case 'garrison_destroyed':
      case 'garrison_rescued': {
        const g = prev.garrisons[e.gid]
        if (g) effects.push({ kind: 'float', at: g.hex, text: '+' + e.vp + ' VP', colour: COLOUR.vp })
        effects.push({ kind: 'cue', cue: e.t === 'garrison_rescued' ? 'rescue' : 'destroy' })
        break
      }
      case 'objective_control': {
        const o = next.objectives[e.oid]
        if (o) effects.push({ kind: 'float', at: o.hex, text: e.side === null ? 'neutral' : 'captured', colour: COLOUR.vp })
        effects.push({ kind: 'cue', cue: 'capture' })
        break
      }
      case 'pickup': {
        const u = next.units[e.uid]
        if (u?.hex) effects.push({ kind: 'float', at: u.hex, text: e.kind === 'energy' ? '+1 Energy' : '+' + (Names.UPGRADES[e.upgrade] ?? e.upgrade), colour: COLOUR.pickup })
        effects.push({ kind: 'cue', cue: 'pickup' })
        break
      }
      case 'timeline': {
        const u = next.units[e.uid]
        if (u?.hex) effects.push({ kind: 'float', at: u.hex, text: e.cost + ' TL', colour: COLOUR.tl })
        break
      }
      case 'status': {
        const u = next.units[e.uid]
        if (u?.hex && !entries.some((x) => x.t === 'attack' && x.status === e.status)) {
          effects.push({ kind: 'float', at: u.hex, text: Names.STATUSES[e.status] ?? String(e.status), colour: COLOUR.status })
        }
        break
      }
      case 'ability':
      case 'tactics':
        if (e.t === 'tactics' || e.aid) effects.push({ kind: 'cue', cue: 'ability' })
        break
      case 'phase':
        effects.push({ kind: 'banner', text: 'Phase ' + e.phase })
        effects.push({ kind: 'cue', cue: 'phase' })
        settle = Math.max(settle, 1.2)
        break
      case 'phase_end':
        effects.push({ kind: 'banner', text: 'End of Phase ' + e.phase })
        settle = Math.max(settle, 1.2)
        break
      case 'game_over':
        effects.push({ kind: 'orbit' })
        effects.push({ kind: 'cue', cue: 'phase' })
        break
      default:
        break
    }
  }
  return { beats, effects, settle }
}
