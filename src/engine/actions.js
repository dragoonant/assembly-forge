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

import * as Attack from './attack.js';
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
  if (action.area !== undefined) parts.push('a' + action.area);
  if (action.grant !== undefined) parts.push('g' + action.grant);
  if (action.side !== undefined && (action.type === 'respond' || action.type === 'pass' || action.type === 'displace_stop' || action.type === 'trigger_skip')) parts.push('s' + action.side);
  if (action.collide) parts.push('x');
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
  // A paused attack (a response window, or a unit reacting) is decided before anything else happens.
  if (state.pending) return sortActions(Attack.pendingOptions(state));
  const act = state.activation;
  const rules = state.rules;
  const u = State.unit(state, act.uid);
  // A dead unit should never be handed an activation -- its token is taken off
  // the track when it dies. If one ever is, the ONLY safe answer is an action
  // that clears the round: returning an empty list wedges the scheduler for
  // good, because nothing can then advance the Timeline past this token.
  if (!u.alive) {
    if (act.defeated || !u.inReserve) return [{ type: 'end_activation', uid: u.uid }];
    return reserveActions(state, u, act);
  }

  const out = [];

  // Slot A: Advance. Free, once per activation, and only while the movement
  // block is still open.
  if (!act.slots.advance && !act.movementClosed && u.statuses.indexOf('slow') !== -1) {
    // Slowed: the next Advance moves 0 hexes and spends the status (rulebook 2026-10-30, "Slow").
    out.push({ type: 'advance', uid: u.uid, to: { q: u.hex.q, r: u.hex.r }, path: [{ q: u.hex.q, r: u.hex.r }], cost: 0, slowed: true });
  } else if (!act.slots.advance && !act.movementClosed && !act.slowed) {
    let allowance = rules.movement.advanceHexes;
    allowance += State.upgradeCount(u, 'speed') * rules.upgrades.speedBonusHexes;
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
      const dashes = movementOptions(state, act.uid, rules.movement.dashHexes + dashBonus(state, u));
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
      for (const opt of attackOptions(state, u, weapons[i])) {
        out.push(Object.assign({
          type: 'attack', uid: u.uid, wid: weapons[i].wid,
          tlCost: act.slots.primary ? 0 : weapons[i].tlCost,
          free: Boolean(act.slots.primary)
        }, opt));
      }
    }
  }

  // Granted additional actions (rulebook 2026-10-30, "Additional Actions"): each at no Timeline cost, taken once, and
  // not part of the movement block, so a granted Dash or Move works even after the unit has attacked.
  // A chained grant whose first part cannot happen resolves as much as it can (rulebook, partial resolution): its next
  // part is offered directly, marked `skipped`.
  for (let gi = 0; gi < (act.grants || []).length; gi++) {
    let g = act.grants[gi];
    let skipped = 0;
    let opts = grantOptions(state, u, g, gi);
    while (!opts.length && g.then) {
      g = g.then;
      skipped++;
      opts = grantOptions(state, u, g, gi).map(function (o) { return Object.assign(o, { skipped: skipped }); });
    }
    for (const o of opts) out.push(o);
  }

  // Slot C: Command abilities. Free, once each, in any order, and usable at
  // any point during the activation -- including after the Primary Action.
  const abilities = Effects.abilitiesOf(u);
  for (let i = 0; i < abilities.length; i++) {
    const a = abilities[i];
    if (a.timing !== 'command') continue;
    if (act.commandsUsed.indexOf(a.aid) !== -1) continue;
    if (!Effects.canUseCommand(state, u, a)) continue;
    for (const opt of Effects.targetOptions(state, u, a)) {
      out.push(Object.assign({ type: 'command', uid: u.uid, aid: a.aid }, opt));
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
      // "your active <trait> unit": only a unit carrying the trait may play it
      if (c.activeTrait && (u.traits || []).indexOf(c.activeTrait) === -1) continue;
      const targets = c.timing === 'attack' ? [{}] : Effects.targetOptions(state, u, c);
      if (c.target && c.target !== 'self' && !targets.length) continue;
      if (c.timing === 'attack') {
        // An Attack card is an attack with its own weapon that takes the place of the Primary Attack.
        if (act.slots.primary) continue;
        if (c.requires && c.requires.defId && c.requires.defId !== u.defId) continue;
        for (const opt of attackOptions(state, u, cardWeapon(c))) {
          out.push(Object.assign({ type: 'tactics', uid: u.uid, cid: c.cid, tlCost: c.weapon.tlCost }, opt));
        }
        continue;
      }
      if (c.timing === 'response') continue;
      if (c.requires && c.requires.defId && c.requires.defId !== u.defId) continue;
      for (const opt of targets) {
        out.push(Object.assign({ type: 'tactics', uid: u.uid, cid: c.cid }, opt));
      }
    }
  }

  // A unit standing on a Base must move off it before doing anything else: no unit may end a move
  // or an activation on a Base, and movement cannot resume once another action has been taken
  // (rulebook 2026-10-30, "Deploying your Units"). `deployOptions` only offers a deployment that has
  // a way off, so this list is never empty in play; the end_activation fallback is a wedge guard.
  if (State.baseAt(state, u.hex) && rules.movement.noEndOnBase) {
    // Only the moves off it, plus what never ends or interrupts a move: Commands and non-attack Tactics cards.
    const off = out.filter(function (a) {
      if (a.type === 'advance' || a.type === 'dash' || a.type === 'move' || a.type === 'command') return true;
      if (a.type !== 'tactics') return false;
      const c = state.players[act.side].tactics.hand.find(function (x) { return x.cid === a.cid; });
      return Boolean(c) && c.timing !== 'attack';
    });
    if (!off.length) off.push({ type: 'end_activation', uid: u.uid });
    return sortActions(off);
  }

  // Ending the activation. The Primary Action is mandatory -- but if the unit
  // has no Primary available at all, holding the whole Timeline hostage to
  // that rule would be worse than letting it pass.
  if (act.slots.primary || !rules.actions.primaryMandatory || !hasAnyPrimary(out)) {
    out.push({ type: 'end_activation', uid: u.uid });
  }

  return sortActions(out);
}

/**
 * The ways a weapon can be used right now: one per target, or for an area weapon one per direction it can be aimed.
 * @param {Object} state
 * @param {Object} u
 * @param {Object} w
 * @returns {Array<Object>} partial actions carrying `target`, or `area`, `areaHexes` and `targets`
 */
export function attackOptions(state, u, w) {
  if (w.area) {
    return Attack.areaOptions(state, u, w).map(function (o) {
      const targets = w.alsoAdjacent ? withAdjacent(state, u.side, o.targets) : o.targets;
      return { area: o.dir, areaHexes: o.hexes, targets: targets, target: targets[0] };
    });
  }
  return Combat.targetsFor(state, u.uid, w).map(function (t) {
    // "this attack also targets each enemy adjacent to the target"
    return w.alsoAdjacent ? { target: t, targets: withAdjacent(state, u.side, [t]) } : { target: t };
  });
}

/** The chosen targets plus every enemy adjacent to any of them (units, Garrisons and RWS), each once, chosen first. */
export function withAdjacent(state, side, targets) {
  const out = targets.slice();
  const seen = {};
  for (const r of out) seen[r.kind + ':' + r.id] = true;
  for (const r of targets) {
    const h = Combat.targetHex(state, r);
    if (!h) continue;
    for (const n of Hex.neighbours(h)) {
      for (const ref of Attack.enemyRefsAt(state, side, n)) {
        if (seen[ref.kind + ':' + ref.id]) continue;
        seen[ref.kind + ':' + ref.id] = true;
        out.push(ref);
      }
    }
  }
  return out;
}

/** The weapon an Attack card fires, with a weapon id derived from the card. */
export function cardWeapon(c) {
  return Object.assign({ wid: c.cid + 'w', accuracy: 0, ignoreLos: false, crit: null, effects: [] }, c.weapon);
}

/** Extra hexes on a Dash from an ongoing ability. */
export function dashBonus(state, u) {
  return Effects.ongoingModifier(state, u, 'dashBonus');
}

/**
 * @param {Action[]} out
 * @returns {Action[]}
 */
function sortActions(out) {
  out.sort(function (a, b) {
    const ka = actionKey(a);
    const kb = actionKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return out;
}

/**
 * What a unit in Reserve may do when its token comes up: deploy onto one of its side's Bases, or,
 * when no Base offers a way off, Energize and stay in Reserve (rulebook 2026-10-30, "Deploying
 * your Units"). Once that Primary is spent it may only end the activation.
 *
 * Simplification, recorded in PLAN.md: a Base hex occupied by another unit is treated as
 * unavailable rather than "as though it were empty". No unit may end a move on a Base, so this only
 * arises after a Push or Pull, which no current content can do onto a Base.
 *
 * @param {Object} state
 * @param {Object} u
 * @param {Object} act
 * @returns {Action[]}
 */
function reserveActions(state, u, act) {
  if (act.slots.primary) return [{ type: 'end_activation', uid: u.uid }];
  const out = deployOptions(state, u.uid).map(function (h) {
    return { type: 'deploy', uid: u.uid, to: h };
  });
  if (!out.length) {
    if (canEnergize(state, u)) out.push({ type: 'energize', uid: u.uid });
    else out.push({ type: 'end_activation', uid: u.uid });
  }
  return sortActions(out);
}

/**
 * The Base hexes a Reserve unit could deploy onto: its side's Bases that are empty and from which it
 * could then Advance or Dash to a legal hex.
 *
 * @param {Object} state
 * @param {string} uid
 * @returns {Array<{q: number, r: number}>}
 */
export function deployOptions(state, uid) {
  const u = State.unit(state, uid);
  const out = [];
  const bases = State.basesOf(state, u.side);
  for (let i = 0; i < bases.length; i++) {
    const h = bases[i].hex;
    if (State.unitAt(state, h)) continue;
    // Try the deployment on a scratch copy: put the unit on the Base, then ask the movement search.
    const probe = State.clone(state);
    const pu = probe.units[uid];
    pu.alive = true;
    pu.inReserve = false;
    pu.hex = { q: h.q, r: h.r };
    const reach = Math.max(state.rules.movement.advanceHexes, state.rules.movement.dashHexes);
    if (movementOptions(probe, uid, reach).length) out.push({ q: h.q, r: h.r });
  }
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

/** The actions one granted additional action offers, ignoring anything chained after it. */
function grantOptions(state, u, g, gi) {
  const out = [];
  if (g.kind === 'dash') {
    for (const m of movementOptions(state, u.uid, state.rules.movement.dashHexes + dashBonus(state, u))) {
      out.push({ type: 'dash', uid: u.uid, to: m.to, path: m.path, cost: m.cost, free: true, grant: gi });
    }
  } else if (g.kind === 'move') {
    for (const m of movementOptions(state, u.uid, g.n, { ignoreEngagement: g.ignoreEngagement })) {
      out.push({ type: 'move', uid: u.uid, to: m.to, path: m.path, cost: m.cost, grant: gi });
    }
  } else if (g.kind === 'attack') {
    const w = Combat.weapon(u, g.wid);
    if (w) {
      for (const opt of attackOptions(state, u, w)) {
        out.push(Object.assign({ type: 'attack', uid: u.uid, wid: w.wid, tlCost: 0, free: true, grant: gi }, opt));
      }
    }
  }
  return out;
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
 *   - and the whole allowance is one hex shorter when the move starts while
 *     the unit is Engaged (`rules.movement.engagementPenalty`). Entering a hex
 *     next to an enemy costs nothing extra; leaving one is what costs.
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
export function movementOptions(state, uid, allowance, opts) {
  const u = State.unit(state, uid);
  const rules = state.rules;
  const startKey = Hex.key(u.hex);
  const ignoreEngagement = Boolean(opts && opts.ignoreEngagement);
  if (!ignoreEngagement && rules.movement.engagementPenalty && State.isEngaged(state, u.side, u.hex)) {
    allowance -= rules.movement.engagementPenalty;
  }
  // Water and debris: a move started in them loses a hex. Hover ignores terrain penalties.
  const hover = State.hasHover(u, state);
  const startKind = State.terrainAt(state, u.hex);
  if (!hover && startKind && startKind.startPenalty) allowance -= startKind.startPenalty;

  // Jumping (rulebook 2026-10-30, "Jumping"): a move started on elevated terrain keeps that
  // elevation for its whole length, so it passes over lower enemies and gaps and pays extra only
  // to climb above where it started.
  const jumpFrom = rules.movement.jump ? State.elevationAt(state, u.hex) : 0;

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
      if (!canPassThrough(state, u, to, jumpFrom)) continue;
      const cost = currentCost + (hover ? state.rules.movement.baseHexCost : enterCost(state, u.side, from, to, jumpFrom));
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
export function canPassThrough(state, u, h, jumpFrom) {
  const cell = State.cellAt(state, h);
  if (!cell) return false;
  const kind = state.rules.terrain[cell.terrain];
  if (!kind) return false;
  // Impassable terrain may be crossed only with Hover, and never ended on (see canEndOn).
  if (kind.impassable && !State.hasHover(u, state)) return false;
  // A jumping unit passes over enemies standing lower than the level it jumped from.
  const over = jumpFrom !== undefined && jumpFrom > cell.elevation;

  const other = State.unitAt(state, h);
  if (other && other.uid !== u.uid) {
    if (other.side === u.side) {
      if (!state.rules.movement.passThroughFriendly) return false;
    } else if (!state.rules.movement.passThroughEnemy && !over) {
      return false;
    }
  }

  const g = State.garrisonAt(state, h);
  if (g && g.side !== u.side && state.rules.movement.enemyGarrisonBlocks && !over) return false;

  // Enemy structures, such as Bases, may not be moved through; allied ones may.
  const b = State.baseAt(state, h);
  if (b && b.side !== u.side && state.rules.movement.enemyBaseBlocks && !over) return false;

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
  const cell = State.cellAt(state, h);
  if (state.rules.terrain[cell.terrain].impassable) return false;
  const other = State.unitAt(state, h);
  if (other && other.uid !== u.uid && state.rules.movement.onePerHex) return false;
  const g = State.garrisonAt(state, h);
  if (g && !state.rules.movement.endOnFriendly) return false;
  if (State.baseAt(state, h) && state.rules.movement.noEndOnBase) return false;
  // no unit may end its movement in the same hex as a Remote Weapon System (rulebook 2026-10-30, "Remote Weapon System")
  if (State.remoteAt(state, h)) return false;
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
export function enterCost(state, side, from, to, jumpFrom) {
  const m = state.rules.movement;
  let cost = m.baseHexCost;

  // Climbing is paid against the higher of where this step starts and where the move started, so a
  // jumping unit only pays to go above its starting level.
  const floor = Math.max(State.elevationAt(state, from), jumpFrom || 0);
  const climb = State.elevationAt(state, to) - floor;
  if (climb > 0) cost += climb * m.elevationCostPerLevel;

  const kind = State.terrainAt(state, to);
  if (kind) cost += kind.moveExtra;

  return Math.max(m.minHexCost, cost);
}
