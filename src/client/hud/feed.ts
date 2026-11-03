// One readable line per engine log entry worth telling the player about. Everything comes from the entry and names.js;
// an entry type with no line here simply does not appear in the feed.
import { displayName, Names, sideName, Text, type GameState, type LogEntry } from '../engine'

function who(s: GameState, uid: string): string {
  const u = s.units[uid]
  return u ? displayName(u.defId) + ' (' + sideName(u.side) + ')' : uid
}

export function describe(s: GameState, e: LogEntry): string | null {
  switch (e.t) {
    case 'phase':
      return 'Phase ' + e.phase + ' begins.'
    case 'deploy':
      return who(s, e.uid) + ' deploys from its base.'
    case 'attack': {
      const target = e.target.kind === 'unit' ? who(s, e.target.id) : 'a garrison'
      const res = e.destroyed ? ' and destroys it' : e.damage > 0 ? ' for ' + e.damage + ' damage' : ' and misses'
      return who(s, e.uid) + ' fires ' + displayName(e.wid) + ' at ' + target + res + '.'
    }
    case 'destroyed':
      return who(s, e.uid) + ' is destroyed: ' + sideName(e.by) + ' scores ' + e.vp + '. It returns to reserve.'
    case 'garrison_destroyed':
      return sideName(e.by) + ' destroys a garrison for ' + e.vp + '.'
    case 'garrison_rescued':
      return who(s, e.uid) + ' rescues a garrison for ' + e.vp + '.'
    case 'objective_control':
      return e.side === null
        ? who(s, e.by) + ' knocks an objective back to neutral.'
        : who(s, e.by) + ' captures an objective for ' + sideName(e.side) + '.'
    case 'objective_scored':
      return sideName(e.side) + ' scores ' + e.vp + ' for holding an objective.'
    case 'status':
      return who(s, e.uid) + ' is ' + (Names.STATUSES[e.status] || e.status).toLowerCase() + '.'
    case 'pickup':
      return who(s, e.uid) + ' collects ' + (e.kind === 'energy' ? 'an Energy token' : Names.UPGRADES[e.upgrade] || e.upgrade) + '.'
    case 'tactics':
      return sideName(e.side) + ' plays ' + Text.tacticsName(e.cid) + '.'
    case 'ability':
      // a Tactics card resolves through the ability system with no ability id; the card has its own line
      return e.aid ? who(s, e.uid) + ' uses ' + Text.abilityName(e.aid) + '.' : null
    case 'collision':
      return who(s, e.uid) + ' is knocked into something.'
    case 'game_over':
      return 'Game over.'
    default:
      return null
  }
}
