// The presentation plan: which engine log entries become which animations. Pure, so it is unit-tested; the runtime that
// plays a plan is director.ts. Two kinds of beat:
//   - blocking beats play BEFORE the new state is shown (a walk along the path, a deploy, the dice, a shot), because the
//     board must not jump to the result before the motion that caused it;
//   - effects play AFTER it is shown and do not block input (a hit burst, a wreck flying off, a floating label, a banner).
// An attack is two beats: the dice roll first, then the shot plays (its kind from weaponFx.ts) and lands with the damage.
import { Names, type Axial, type GameState, type LogEntry, type Side } from '../engine'
import { FX_DUR } from './fxTiming'
import { fxKindFor, type FxKind } from './weaponFx'

/** Seconds per hex of walking: about 1.5 hexes a second (PLAN.md M3). */
export const WALK_S_PER_HEX = 0.66

export type Beat =
  | { kind: 'move'; uid: string; path: Axial[]; dur: number; dash?: boolean }
  | { kind: 'deploy'; uid: string; at: Axial; dur: number }
  /** The dice panel for an attack: the controller shows it and waits for it to close. Takes no time of its own. */
  | { kind: 'dice'; outcome: LogEntry; dur: 0 }
  /**
   * The attack animation. `to` is the aimed hex (the first target), `hits` every target's hex, `area` the hexes an area
   * weapon covers, `struck` the units that took damage (they jolt when the hit lands), and `miss` true when nothing did.
   */
  | { kind: 'shot'; uid: string; to: Axial; fx: FxKind; hits: Axial[]; area: Axial[] | null; struck: string[]; miss: boolean; dur: number }

export type Effect =
  | { kind: 'burst'; at: Axial; colour: string }
  | { kind: 'wreck'; uid: string; defId: string; side: Side; at: Axial }
  | { kind: 'float'; at: Axial; text: string; colour: string }
  | { kind: 'banner'; text: string }
  | { kind: 'cue'; cue: string }
  | { kind: 'orbit' }
  /** A unit took damage and survived: its figure flinches. */
  | { kind: 'hurt'; uid: string }

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
        beats.push({ kind: 'move', uid: e.uid, path, dur: WALK_S_PER_HEX * (path.length - 1), ...(e.t === 'dash' ? { dash: true } : {}) })
        effects.push({ kind: 'cue', cue: 'move' })
        break
      }
      case 'push':
      case 'pull':
        if (e.to) beats.push({ kind: 'move', uid: e.uid, path: [e.from, e.to], dur: 0.3 })
        break
      case 'deploy':
        beats.push({ kind: 'deploy', uid: e.uid, at: e.to, dur: 0.7 })
        effects.push({ kind: 'cue', cue: 'deploy' })
        break
      case 'attack': {
        beats.push({ kind: 'dice', outcome: e, dur: 0 })
        const attacker = prev.units[e.uid]
        const hexOf = (r: { kind: string; id: string }): Axial | null =>
          r.kind === 'unit' ? prev.units[r.id]?.hex ?? null : prev.garrisons[r.id]?.hex ?? null
        const results: { ref: { kind: string; id: string }; damage: number; destroyed: boolean; status: string | null }[] =
          e.results && e.results.length ? e.results : [{ ref: e.target, damage: e.damage, destroyed: e.destroyed, status: e.status ?? null }]
        const to = hexOf(e.target)
        if (attacker?.hex && to) {
          const w = attacker.weapons.find((x) => x.wid === e.wid)
          const fx = fxKindFor(w ?? { wid: e.wid, range: 1 })
          const hits = results.map((r) => hexOf(r.ref)).filter((h): h is Axial => h !== null)
          const struck = results.filter((r) => r.ref.kind === 'unit' && r.damage > 0).map((r) => r.ref.id)
          beats.push({
            kind: 'shot', uid: e.uid, to, fx, hits: hits.length ? hits : [to], area: e.area && e.area.length ? e.area : null,
            struck, miss: !results.some((r) => r.damage > 0), dur: FX_DUR[fx],
          })
          effects.push({ kind: 'cue', cue: e.destroyed ? 'destroy' : e.damage > 0 ? 'hit' : 'miss' })
          for (const r of results) {
            const at = hexOf(r.ref)
            if (!at) continue
            effects.push({ kind: 'burst', at, colour: r.damage > 0 ? COLOUR.hit : COLOUR.miss })
            if (r.ref.kind === 'unit' && r.damage > 0 && !r.destroyed) effects.push({ kind: 'hurt', uid: r.ref.id })
            effects.push({ kind: 'float', at, text: r.damage > 0 ? '-' + r.damage : 'miss', colour: r.damage > 0 ? COLOUR.hit : COLOUR.miss })
            if (r.status) effects.push({ kind: 'float', at, text: Names.STATUSES[r.status] ?? String(r.status), colour: COLOUR.status })
          }
          settle = Math.max(settle, 0.5)
        }
        break
      }
      case 'destroyed':
        if (e.from) {
          const u = prev.units[e.uid] ?? next.units[e.uid]
          if (u) effects.push({ kind: 'wreck', uid: e.uid, defId: u.defId, side: u.side, at: e.from })
          effects.push({ kind: 'float', at: e.from, text: '+' + e.vp + ' VP', colour: COLOUR.vp })
          settle = Math.max(settle, 1.1)
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
