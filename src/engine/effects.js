/**
 * Abilities as data.
 *
 * Nothing in this project stores a sentence describing what an ability does.
 * An ability is `{aid, timing, cost, when, effects}` and the English a player
 * reads is generated from that structure at display time. This is the single
 * strongest protection in the project's IP position, because it makes pasting
 * published wording into a definition impossible -- there is no field to paste
 * it into. It also buys a consistent voice for free, and lets a new unit be a
 * data file with no engine change.
 *
 * THE BUG CLASS THIS INVITES, and the reason `content-suite.js` exists: the
 * engine can happily enforce a condition or an effect field that the text
 * generator never learned to say. The player then sees an ability that appears
 * to do nothing, or a sentence with a hole in it. It fails silently in both
 * directions and it produced four separate user-visible bugs in the sibling
 * project. Every describer in `src/content/abilitytext.js` has a counterpart
 * here, and a test renders all of them.
 *
 * THREE TIMINGS, from the sources:
 *
 *   command   usable at any point during this unit's activation, once, if its
 *             condition holds. May cost Energy.
 *   ongoing   continuously true while its condition holds. Never "used" --
 *             it is read at the moment the value it modifies is computed.
 *   response  fires when a named event happens, whether or not the unit is
 *             activating.
 */

import * as Displace from './displace.js';
import * as Hex from './hex.js';
import * as Los from './los.js';
import * as State from './state.js';

/**
 * @typedef {Object} Ability
 * @property {string} aid
 * @property {'command'|'ongoing'|'response'} timing
 * @property {number} [energy]   Energy spent to use it, command only
 * @property {string} [on]       event id, response only
 * @property {boolean} [optional] a response the owning player may decline ("may" on the card)
 * @property {Object} [when]     condition, see `conditionHolds`
 * @property {string} [target]   'self' | 'enemyInRange' | 'adjacentEnemy'
 * @property {number} [range]
 * @property {Array<Object>} effects
 */

/** Effect kinds the engine resolves. Anything else is a bug, not a no-op. */
export const EFFECT_KINDS = Object.freeze([
  'strength', 'accuracy', 'move', 'energy', 'damage', 'status', 'heal', 'extraAttack', 'push', 'pull',
  'weaponStrength', 'grant', 'upgrade', 'damageSelf', 'stripOnAttack',
  // ongoing-only kinds, read where they apply rather than resolved
  'critFrom', 'dashBonus', 'strengthVsStatus'
]);

/** Response events the engine raises. */
export const EVENTS = Object.freeze([
  'rescue', 'destroy', 'damaged', 'dash'
]);

/**
 * @param {Object} u
 * @returns {Ability[]}
 */
export function abilitiesOf(u) {
  return u.abilities || [];
}

/**
 * @param {Object} u
 * @param {string} aid
 * @returns {?Ability}
 */
export function ability(u, aid) {
  const list = abilitiesOf(u);
  for (let i = 0; i < list.length; i++) if (list[i].aid === aid) return list[i];
  return null;
}

/**
 * Does an ability's condition hold right now?
 *
 * Every key here must have a describer in `abilitytext.js`. An unspoken
 * condition is the exact failure this module's header warns about: the ability
 * reads as unconditional and appears broken when it declines to fire.
 *
 * @param {Object} state
 * @param {Object} u
 * @param {?Object} when
 * @returns {boolean}
 */
export function conditionHolds(state, u, when) {
  if (!when) return true;
  // A unit in Reserve is off the battlefield, so no condition about where it stands can hold; the rulebook notes
  // that printed effects may not be active until a unit deploys (2026-10-30, "Deploying your Units").
  if (!u.hex) return false;

  if (when.damageTaken !== undefined) {
    if (u.maxHp - u.hp < when.damageTaken) return false;
  }
  if (when.rescued !== undefined) {
    if ((state.players[u.side].rescued || 0) < when.rescued) return false;
  }
  if (when.attackedWith !== undefined) {
    const act = state.activation;
    if (!act || act.uid !== u.uid || (act.attacked || []).indexOf(when.attackedWith) === -1) return false;
  }
  if (when.objectives !== undefined) {
    let held = 0;
    for (let i = 0; i < state.objectiveOrder.length; i++) {
      if (state.objectives[state.objectiveOrder[i]].controlledBy === u.side) held++;
    }
    if (held < when.objectives) return false;
  }
  if (when.upgrades !== undefined) {
    if (u.upgrades.length < when.upgrades) return false;
  }
  if (when.alliesInRange !== undefined) {
    const spec = when.alliesInRange;
    let n = 0;
    const units = State.livingUnits(state, u.side);
    for (let i = 0; i < units.length; i++) {
      if (units[i].uid === u.uid) continue;
      if (Hex.distance(u.hex, units[i].hex) <= spec.range) n++;
    }
    if (n < spec.n) return false;
  }
  if (when.enemyAdjacent !== undefined) {
    const around = Hex.neighbours(u.hex);
    let found = false;
    for (let i = 0; i < around.length; i++) {
      const other = State.unitAt(state, around[i]);
      if (other && other.side !== u.side) { found = true; break; }
    }
    if (found !== when.enemyAdjacent) return false;
  }
  return true;
}

/**
 * The total ongoing modifier of one kind on a unit.
 *
 * Read at the moment the value is computed rather than applied when the
 * condition becomes true, so an ongoing ability that depends on damage taken
 * changes the same instant the damage lands.
 *
 * @param {Object} state
 * @param {Object} u
 * @param {string} kind 'strength' | 'accuracy'
 * @returns {number}
 */
export function ongoingModifier(state, u, kind) {
  let total = 0;
  const list = abilitiesOf(u);
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.timing !== 'ongoing') continue;
    if (!conditionHolds(state, u, a.when)) continue;
    for (let j = 0; j < a.effects.length; j++) {
      if (a.effects[j].k === kind) total += a.effects[j].n;
    }
  }
  return total;
}

/**
 * Does a unit have an ongoing ability granting a named flag?
 * @param {Object} state
 * @param {Object} u
 * @param {string} flag
 * @returns {boolean}
 */
export function hasOngoingFlag(state, u, flag) {
  const list = abilitiesOf(u);
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.timing !== 'ongoing' || a.flag !== flag) continue;
    if (conditionHolds(state, u, a.when)) return true;
  }
  return false;
}

/**
 * Targets a command ability could be used on.
 *
 * @param {Object} state
 * @param {Object} u
 * @param {Ability} a
 * @returns {Array<?string>} unit ids, or `[null]` for a self-targeted ability
 */
export function targetsFor(state, u, a) {
  if (!a.target || a.target === 'self') return [null];

  const out = [];
  const range = a.target === 'adjacentEnemy' ? 1 : (a.range === undefined ? 1 : a.range);
  const units = State.livingUnits(state);
  for (let i = 0; i < units.length; i++) {
    const t = units[i];
    if (t.side === u.side) continue;
    if (Hex.distance(u.hex, t.hex) > range) continue;
    // `los`: a stated [Range N] needs Line of Sight; "within N hexes" does not (rulebook 2026-10-30, p19)
    if (a.los && !Los.hasLos(state, u.hex, t.hex, { side: u.side, targetUid: t.uid })) continue;
    out.push(t.uid);
  }
  out.sort();
  return out;
}

/**
 * May this unit use this command ability right now?
 *
 * @param {Object} state
 * @param {Object} u
 * @param {Ability} a
 * @returns {boolean}
 */
export function canUseCommand(state, u, a) {
  if (a.timing !== 'command') return false;
  if (a.energy && u.energy < a.energy) return false;
  if (!conditionHolds(state, u, a.when)) return false;
  if (a.target && a.target !== 'self' && !targetsFor(state, u, a).length) return false;
  return true;
}

// --- Resolution --------------------------------------------------------------

/**
 * Apply an ability's effects. MUTATES `state`, which is safe because every
 * caller is working on a clone.
 *
 * @param {Object} state
 * @param {string} uid       the unit whose ability this is
 * @param {Ability} a
 * @param {?string} targetUid
 * @param {Object} combat    the combat module, injected to avoid a cycle
 * @returns {Object} a summary for the log
 */
export function resolve(state, uid, a, targetUid, combat) {
  const u = State.unit(state, uid);
  const applied = resolveEffects(state, uid, a.effects, targetUid, combat);

  if (a.energy) u.energy -= a.energy;

  state.log.push({
    t: 'ability', uid: uid, aid: a.aid, target: targetUid || null,
    applied: applied, sound: 'ability', notice: true
  });
  return { applied: applied };
}

/**
 * Resolve a list of effects in order. A Push or Pull with somewhere to go opens the acting player's choice and stops
 * here; the effects after it are carried on the pending decision and resolved by `resumeEffects` when it ends
 * (rulebook: resolve each effect entirely, in the order printed).
 *
 * @returns {string[]} the effect kinds applied before any pause
 */
export function resolveEffects(state, uid, effects, targetUid, combat) {
  const u = State.unit(state, uid);
  const applied = [];

  for (let i = 0; i < effects.length; i++) {
    const e = effects[i];
    if (!u.alive && e.k !== 'energy') break;
    if ((e.k === 'push' || e.k === 'pull') && targetUid && state.activation) {
      const cont = { uid: uid, effects: effects.slice(i + 1), targetUid: targetUid };
      if (Displace.begin(state, u, targetUid, e.n, e.k, cont, null)) {
        applied.push(e.k);
        return applied;
      }
      continue;
    }
    switch (e.k) {
      case 'strength':
      case 'accuracy':
        // Activation-scoped: it lasts until this unit's turn ends, which is
        // what "this activation" means on every published card.
        if (state.activation && state.activation.uid === uid) {
          state.activation.mods[e.k] += e.n;
          applied.push(e.k);
        }
        break;

      case 'move':
        // An additional Move action of N hexes, on top of the Advance (rulebook 2026-10-30, "Advance": movement from
        // cards and abilities is in addition to the normal Advance).
        if (state.activation && state.activation.uid === uid) {
          state.activation.grants.push({ kind: 'move', n: e.n });
          applied.push('move');
        }
        break;

      case 'energy':
        u.energy += e.n;
        applied.push('energy');
        break;

      case 'heal':
        u.hp = Math.min(u.maxHp, u.hp + e.n);
        applied.push('heal');
        break;

      case 'extraAttack':
        if (state.activation && state.activation.uid === uid) {
          state.activation.extraAttacks += (e.n === undefined ? 1 : e.n);
          applied.push('extraAttack');
        }
        break;

      case 'damage':
        if (targetUid) {
          combat.dealDamage(state, { kind: 'unit', id: targetUid }, e.n, u.side, false, { mayBeSaved: true });
          applied.push('damage');
          if (heldForSave(state, uid, effects, i, targetUid)) return applied;
        }
        break;

      case 'status':
        if (targetUid && combat.applyStatus(state, targetUid, e.s)) applied.push('status');
        break;

      case 'push':
      case 'pull':
        if (targetUid && displace(state, u, targetUid, e.n, e.k, combat)) applied.push(e.k);
        break;

      case 'weaponStrength':
        // +n strength for one named weapon this activation, optionally per Garrison this player has Rescued
        if (state.activation && state.activation.uid === uid) {
          const per = e.per === 'rescued' ? (state.players[u.side].rescued || 0) : 1;
          state.activation.weaponMods[e.wid] = (state.activation.weaponMods[e.wid] || 0) + e.n * per;
          applied.push('weaponStrength');
        }
        break;

      case 'grant':
        if (state.activation && state.activation.uid === uid) {
          state.activation.grants.push(JSON.parse(JSON.stringify(e.grant)));
          applied.push('grant');
        }
        break;

      case 'upgrade':
        u.upgrades.push(e.s);
        state.log.push({ t: 'pickup', uid: uid, kind: 'upgrade', upgrade: e.s, notice: true });
        applied.push('upgrade');
        break;

      case 'damageSelf':
        combat.dealDamage(state, { kind: 'unit', id: uid }, e.n, u.side === 0 ? 1 : 0, false, { mayBeSaved: true });
        applied.push('damageSelf');
        if (heldForSave(state, uid, effects, i, targetUid)) return applied;
        break;

      case 'stripOnAttack':
        if (state.activation && state.activation.uid === uid) {
          state.activation.mods.stripOnAttack = (state.activation.mods.stripOnAttack || 0) + e.n;
          applied.push('stripOnAttack');
        }
        break;

      case 'critFrom':
      case 'dashBonus':
      case 'strengthVsStatus':
        // ongoing kinds: read by combat and movement while their condition holds
        break;

      default:
        // Loud, not silent. An effect kind the engine does not know is a
        // content bug, and a no-op would hide it behind an ability that simply
        // never seems to do anything.
        throw new Error('Unknown effect kind: ' + e.k);
    }
  }
  return applied;
}

/** If the damage just dealt opened a would-be-defeated decision, park the rest of the effects on it. */
function heldForSave(state, uid, effects, i, targetUid) {
  const p = state.pending;
  if (!p || p.kind !== 'window' || !p.outside) return false;
  p.cont = { uid: uid, effects: effects.slice(i + 1), targetUid: targetUid };
  return true;
}

/**
 * After a Push or Pull decision ends: resolve whatever effects followed it.
 * @param {Object} state
 * @param {?Object} cont `{uid, effects, targetUid}`
 * @param {Object} combat
 */
export function resumeEffects(state, cont, combat) {
  if (!cont || !cont.effects.length) return;
  if (!state.units[cont.uid] || !state.units[cont.uid].alive) return;
  resolveEffects(state, cont.uid, cont.effects, cont.targetUid, combat);
}


/**
 * Raise a response event and fire whatever answers it.
 *
 * Responses fire whether or not their unit is activating, which is what makes
 * them different from commands. Only the unit's OWN responses are considered
 * here; a reaction to somebody else's event is a Tactics card's job.
 *
 * With `interactive`, a response the player may decline, or one with more than one possible target, opens a
 * decision (`state.pending.kind === 'trigger'`) instead of resolving at once; the rest wait on it. Without it (events
 * raised in the middle of an attack) each resolves on its first target, as before.
 *
 * @param {Object} state
 * @param {string} uid
 * @param {string} event
 * @param {Object} combat
 * @param {boolean} [interactive]
 */
export function raise(state, uid, event, combat, interactive) {
  const u = state.units[uid];
  if (!u || !u.alive) return;
  const queue = abilitiesOf(u)
    .filter(function (a) { return a.timing === 'response' && a.on === event; })
    .map(function (a) { return a.aid; });
  runTriggers(state, uid, queue, combat, Boolean(interactive));
}

function runTriggers(state, uid, queue, combat, interactive) {
  const u = state.units[uid];
  while (queue.length) {
    if (!u.alive || state.pending) return;
    const a = ability(u, queue.shift());
    if (!a || !conditionHolds(state, u, a.when)) continue;
    const targets = targetsFor(state, u, a);
    if (a.target && a.target !== 'self' && !targets.length) continue;
    if (interactive && (a.optional || targets.length > 1)) {
      state.pending = {
        kind: 'trigger', side: u.side, uid: uid, aid: a.aid, targets: targets,
        optional: Boolean(a.optional), rest: queue.slice()
      };
      return;
    }
    resolve(state, uid, a, targets[0] || null, combat);
  }
}

/** The open trigger decision's options: use it (on each possible target), or decline it when it is optional. */
export function triggerOptions(state) {
  const p = state.pending;
  const out = p.targets.map(function (t) {
    const o = { type: 'trigger', side: p.side, uid: p.uid, aid: p.aid };
    if (t) o.targetUid = t;
    return o;
  });
  if (p.optional) out.push({ type: 'trigger_skip', side: p.side, uid: p.uid, aid: p.aid });
  return out;
}

/** Resolve the trigger decision, then whatever responses were waiting behind it. */
export function decideTrigger(state, action, combat) {
  const p = state.pending;
  state.pending = null;
  const u = state.units[p.uid];
  if (action.type === 'trigger' && u && u.alive) {
    resolve(state, p.uid, ability(u, p.aid), action.targetUid || null, combat);
  } else {
    state.log.push({ t: 'declined', uid: p.uid, aid: p.aid });
  }
  runTriggers(state, p.uid, p.rest.slice(), combat, true);
}
