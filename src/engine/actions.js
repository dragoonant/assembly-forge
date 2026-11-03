/**
 * `legalActions(state)` -- everything the unit currently activating may do.
 *
 * This is the single source of truth for legality. The UI derives every
 * affordance by filtering this list, the AI searches it, and `apply` refuses
 * anything that is not in it, so a rule enforced here is enforced everywhere.
 *
 * Milestone scope: Advance, Dash and Energize. Attack and Rescue arrive with
 * combat and garrisons.
 *
 * The A/B/C/D structure means a turn is not a sequence but a set of slots:
 * a unit may Advance, take exactly one Primary Action, use Command abilities
 * and play one Tactics card, in any order, and exactly one Primary is
 * mandatory. `state.activation` records which slots are spent.
 */

import * as Combat from './combat.js';
import * as Effects from './effects.js';
import * as Hex from './hex.js';
import * as State from './state.js';

/**
 * @typedef {Object} Action
 * @property {string} type   'advance' | 'dash' | 'energize' | 'end_activation'
 * @property {string} uid
 * @property {{q: number, r: number}} [to]    destination, for movement
 * @property {Array<{q: number, r: number}>} [path] start hex first, destination last
 * @property {number} [cost] movement points spent, for movement
 */

/** The four Primary Actions. Exactly one is mandatory per activation. */
export const PRIMARY_ACTIONS = Object.freeze(['attack', 'dash', 'energize', 'rescue']);

/**
 * A canonical string for an action, used to compare a caller's action against
 * the legal list. Two actions with the same key are the same move; the path is
 * derived, so it is not part of the identity.
 *
 * @param {Action} action
 * @returns {string}
 */
export function actionKey(action) {
  const parts = [action.type, action.uid || ''];
  if (action.to) parts.push(Hex.key(action.to));
  if (action.wid) parts.push(action.wid);
  if (action.target) parts.push(action.target.kind + ':' + action.target.id);
  if (action.gid) parts.push(action.gid);
  if (action.aid) parts.push(action.aid);
  if (action.targetUid) parts.push(action.targetUid);
  if (action.cid) parts.push(action.cid);
  return parts.join('|');
}

/**
 * Everything legal right now, sorted by key so the list is stable across runs
 * -- the AI's tie-breaking and the tests both depend on that.
 *
 * @param {Object} state
 * @returns {Action[]}
 */
export function legalActions(state) {
  if (state.over || !state.activation) return [];
  const act = state.activation;
  const rules = state.rules;
  const u = State.unit(state, act.uid);
  // A dead unit should never be handed an activation -- its token is taken off
  // the track when it dies. If one ever is, the ONLY safe answer is an action
  // that clears the round: returning an empty list wedges the scheduler for
  // good, because nothing can then advance the Timeline past this token.
  if (!u.alive) return [{ type: 'end_activation', uid: u.uid }];

  const out = [];

  // Slot A: Advance. Free, once per activation, and only while the movement
  // block is still open.
  if (!act.slots.advance && !act.movementClosed && !act.slowed) {
    let allowance = rules.movement.advanceHexes;
    if (u.upgrades.indexOf('speed') !== -1) allowance += rules.upgrades.speedBonusHexes;
    allowance += act.mods.move;
    const moves = movementOptions(state, act.uid, allowance);
    for (let i = 0; i < moves.length; i++) {
      out.push({
        type: 'advance', uid: u.uid, to: moves[i].to, path: moves[i].path, cost: moves[i].cost
      });
    }
  }

  // Slot B: exactly one Primary Action.
  if (!act.slots.primary) {
    if (!act.movementClosed) {
      const dashes = movementOptions(state, act.uid, rules.movement.dashHexes);
      for (let i = 0; i < dashes.length; i++) {
        out.push({
          type: 'dash', uid: u.uid, to: dashes[i].to, path: dashes[i].path, cost: dashes[i].cost
        });
      }
    }
    if (canEnergize(state, u)) out.push({ type: 'energize', uid: u.uid });

    // Rescue: a friendly garrison on an adjacent hex.
    const rescuable = rescueTargets(state, u);
    for (let i = 0; i < rescuable.length; i++) {
      out.push({ type: 'rescue', uid: u.uid, gid: rescuable[i] });
    }
  }

  // Attack: one entry per weapon per legal target, because the two choices are
  // not independent -- range and line of sight differ per weapon, and the
  // Timeline cost charged is the weapon's.
  //
  // Outside the Primary slot when an ability has granted an extra attack. Those
  // are explicitly "at TL0" on the published cards, so they neither consume the
  // Primary Action nor cost Timeline.
  if (!act.slots.primary || act.extraAttacks > 0) {
    const weapons = Combat.weaponsOf(u);
    for (let i = 0; i < weapons.length; i++) {
      const targets = Combat.targetsFor(state, u.uid, weapons[i]);
      for (let j = 0; j < targets.length; j++) {
        out.push({
          type: 'attack', uid: u.uid, wid: weapons[i].wid, target: targets[j],
          tlCost: act.slots.primary ? 0 : weapons[i].tlCost,
          free: Boolean(act.slots.primary)
        });
      }
    }
  }

  // Slot C: Command abilities. Free, once each, in any order, and usable at
  // any point during the activation -- including after the Primary Action.
  const abilities = Effects.abilitiesOf(u);
  for (let i = 0; i < abilities.length; i++) {
    const a = abilities[i];
    if (a.timing !== 'command') continue;
    if (act.commandsUsed.indexOf(a.aid) !== -1) continue;
    if (!Effects.canUseCommand(state, u, a)) continue;
    const targets = Effects.targetsFor(state, u, a);
    for (let j = 0; j < targets.length; j++) {
      out.push({ type: 'command', uid: u.uid, aid: a.aid, targetUid: targets[j] });
    }
  }

  // Slot D: one Tactics card. Free, and blocked entirely if the player played
  // one defensively on their previous activation.
  if (!act.slots.tactics && !act.tacticsLocked && rules.tactics.onePerUnitTurn) {
    const hand = state.players[act.side].tactics.hand;
    for (let i = 0; i < hand.length; i++) {
      const c = hand[i];
      // A card is an ability that lives in a hand, so it is gated the same way.
      if (!Effects.conditionHolds(state, u, c.when)) continue;
      const targets = Effects.targetsFor(state, u, c);
      if (c.target && c.target !== 'self' && !targets.length) continue;
      for (let j = 0; j < targets.length; j++) {
        out.push({ type: 'tactics', uid: u.uid, cid: c.cid, targetUid: targets[j] });
      }
    }
  }

  // Ending the activation. The Primary Action is mandatory -- but if the unit
  // has no Primary available at all, holding the whole Timeline hostage to
  // that rule would be worse than letting it pass.
  if (act.slots.primary || !rules.actions.primaryMandatory || !hasAnyPrimary(out)) {
    out.push({ type: 'end_activation', uid: u.uid });
  }

  out.sort(function (a, b) {
    const ka = actionKey(a);
    const kb = actionKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return out;
}

/**
 * @param {Action[]} actions
 * @returns {boolean}
 */
function hasAnyPrimary(actions) {
  for (let i = 0; i < actions.length; i++) {
    if (PRIMARY_ACTIONS.indexOf(actions[i].type) !== -1) return true;
  }
  return false;
}

/**
 * Friendly garrisons this unit is standing next to and could Rescue.
 *
 * Rescue is performed from an ADJACENT hex, not from on top of the garrison --
 * which is consistent with a unit being unable to end its movement on one.
 *
 * @param {Object} state
 * @param {Object} u
 * @returns {string[]} garrison ids
 */
export function rescueTargets(state, u) {
  const out = [];
  const around = Hex.neighbours(u.hex);
  for (let i = 0; i < around.length; i++) {
    const g = State.garrisonAt(state, around[i]);
    if (g && g.alive && g.side === u.side) out.push(g.gid);
  }
  out.sort();
  return out;
}

/**
 * @param {Object} state
 * @param {Object} u
 * @returns {boolean}
 */
function canEnergize(state, u) {
  const cap = state.rules.actions.maxEnergy;
  return cap === null || cap === undefined || u.energy < cap;
}

/**
 * Is this action currently legal? Compares by `actionKey`, so a caller may
 * hand back an action without its derived `path`.
 *
 * @param {Object} state
 * @param {Action} action
 * @returns {?Action} the canonical form of the action, or null
 */
export function resolveLegal(state, action) {
  if (!action || !action.type) return null;
  const wanted = actionKey(action);
  const legal = legalActions(state);
  for (let i = 0; i < legal.length; i++) {
    if (actionKey(legal[i]) === wanted) return legal[i];
  }
  return null;
}

// --- Movement ----------------------------------------------------------------

/**
 * Every hex a unit could finish a movement action on, given an allowance in
 * hexes, with the cheapest legal path to each.
 *
 * The costs, all from the movement rules:
 *
 *   - one point to enter an ordinary hex;
 *   - one more per level of elevation *ascended* (descending is free);
 *   - whatever the terrain kind adds (water costs a hex);
 *   - a further point for entering an engaged hex -- one adjacent to an enemy
 *     unit or enemy Garrison. See `rules.movement.engagementCost` for why this
 *     is read as a penalty.
 *
 * And the restrictions:
 *
 *   - friendly units and Garrisons may be moved *through* but not stopped on;
 *   - enemy units may not be entered at all, so the unit must detour;
 *   - one unit per hex, so no destination may already be occupied;
 *   - a movement action may not finish where it began.
 *
 * @param {Object} state
 * @param {string} uid
 * @param {number} allowance hexes of movement
 * @returns {Array<{to: {q: number, r: number}, path: Array<{q: number, r: number}>, cost: number}>}
 */
export function movementOptions(state, uid, allowance) {
  const u = State.unit(state, uid);
  const rules = state.rules;
  const startKey = Hex.key(u.hex);

  // Dijkstra: costs vary by hex, so a breadth-first walk would lie about which
  // hexes are in range. The frontier is scanned in (cost, key) order, which
  // keeps the chosen path deterministic when two routes tie.
  const best = {};
  const prev = {};
  const settled = {};
  best[startKey] = 0;

  for (;;) {
    let currentKey = null;
    let currentCost = Infinity;
    const open = Object.keys(best);
    for (let i = 0; i < open.length; i++) {
      const k = open[i];
      if (settled[k]) continue;
      if (best[k] < currentCost || (best[k] === currentCost && currentKey !== null && k < currentKey)) {
        currentCost = best[k];
        currentKey = k;
      }
    }
    if (currentKey === null) break;
    settled[currentKey] = true;

    const from = Hex.parseKey(currentKey);
    const around = Hex.neighbours(from);
    for (let i = 0; i < around.length; i++) {
      const to = around[i];
      const toKey = Hex.key(to);
      if (settled[toKey]) continue;
      if (!canPassThrough(state, u, to)) continue;
      const cost = currentCost + enterCost(state, u.side, from, to);
      if (cost > allowance) continue;
      if (best[toKey] === undefined || cost < best[toKey]) {
        best[toKey] = cost;
        prev[toKey] = currentKey;
      }
    }
  }

  const out = [];
  const reached = Object.keys(best).sort();
  for (let i = 0; i < reached.length; i++) {
    const k = reached[i];
    // A movement action may not finish where it began. Dropping the start hex
    // here is the whole of that rule: every other destination the search found
    // is somewhere else by construction.
    if (k === startKey) {
      if (rules.movement.noEndOnStartHex) continue;
      out.push({ to: Hex.parseKey(k), path: [Hex.parseKey(k)], cost: 0 });
      continue;
    }
    const to = Hex.parseKey(k);
    if (!canEndOn(state, u, to)) continue;
    out.push({ to: to, path: pathTo(prev, startKey, k), cost: best[k] });
  }

  return out;
}

/**
 * @param {Object} prev
 * @param {string} startKey
 * @param {string} endKey
 * @returns {Array<{q: number, r: number}>}
 */
function pathTo(prev, startKey, endKey) {
  const keys = [endKey];
  let k = endKey;
  let guard = 0;
  while (k !== startKey) {
    if (++guard > 1000) throw new Error('Movement path did not terminate');
    k = prev[k];
    keys.unshift(k);
  }
  return keys.map(Hex.parseKey);
}

/**
 * May this unit's movement enter a hex at all -- pass through it, whether or
 * not it stops there?
 *
 * @param {Object} state
 * @param {Object} u
 * @param {{q: number, r: number}} h
 * @returns {boolean}
 */
export function canPassThrough(state, u, h) {
  const cell = State.cellAt(state, h);
  if (!cell) return false;
  const kind = state.rules.terrain[cell.terrain];
  if (!kind || kind.impassable) return false;

  const other = State.unitAt(state, h);
  if (other && other.uid !== u.uid) {
    if (other.side === u.side) {
      if (!state.rules.movement.passThroughFriendly) return false;
    } else if (!state.rules.movement.passThroughEnemy) {
      return false;
    }
  }

  const g = State.garrisonAt(state, h);
  if (g && g.side !== u.side && state.rules.movement.enemyGarrisonBlocks) return false;

  return true;
}

/**
 * May this unit finish its movement on a hex?
 *
 * @param {Object} state
 * @param {Object} u
 * @param {{q: number, r: number}} h
 * @returns {boolean}
 */
export function canEndOn(state, u, h) {
  if (!canPassThrough(state, u, h)) return false;
  const other = State.unitAt(state, h);
  if (other && other.uid !== u.uid && state.rules.movement.onePerHex) return false;
  const g = State.garrisonAt(state, h);
  if (g && !state.rules.movement.endOnFriendly) return false;
  return true;
}

/**
 * What it costs to step from one hex to an adjacent one.
 *
 * @param {Object} state
 * @param {0|1} side
 * @param {{q: number, r: number}} from
 * @param {{q: number, r: number}} to
 * @returns {number}
 */
export function enterCost(state, side, from, to) {
  const m = state.rules.movement;
  let cost = m.baseHexCost;

  const climb = State.elevationAt(state, to) - State.elevationAt(state, from);
  if (climb > 0) cost += climb * m.elevationCostPerLevel;

  const kind = State.terrainAt(state, to);
  if (kind) cost += kind.moveExtra;

  if (m.engagementCost !== 0 && State.isEngaged(state, side, to)) cost += m.engagementCost;

  return Math.max(m.minHexCost, cost);
}
