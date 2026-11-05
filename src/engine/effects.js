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
import * as Timeline from './timeline.js';

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
  'speed', 'hover', 'rescue', 'upgradeChoice', 'upgradeSpread', 'transfer', 'steal', 'destroyUpgrades', 'statusAll',
  'delayNearRemote', 'repositionSelf', 'damageBonus', 'nextAttackStrength', 'remotesStrike', 'repositionAllRemotes',
  'placeRemote', 'moveNow', 'rescueMovedAdjacent', 'damageMovedAdjacent', 'draw',
  // ongoing-only kinds, read where they apply rather than resolved
  'critFrom', 'dashBonus', 'strengthVsStatus', 'noEnemyResponses', 'auraReduceDamage', 'auraAccuracy'
]);

/** Response events the engine raises. */
export const EVENTS = Object.freeze([
  'rescue', 'destroy', 'damaged', 'dash', 'moved'
]);

/** Upgrade kinds a player may choose from ("1 Upgrade of your choice"). */
function upgradeKinds(state) {
  return state.rules.upgrades.known.slice();
}

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
  if (when.hasUpgrade !== undefined) {
    if (u.upgrades.indexOf(when.hasUpgrade) === -1) return false;
  }
  if (when.garrisonsDestroyed !== undefined) {
    if ((state.players[u.side].garrisonsDestroyed || 0) < when.garrisonsDestroyed) return false;
  }
  if (when.notMoved !== undefined) {
    // "if this unit hasn't moved this activation": only during its own activation
    const act = state.activation;
    if (!act || act.uid !== u.uid || act.moved) return false;
  }
  if (when.ownRemoteDeployed !== undefined) {
    if (!State.remotesOf(state, u.uid).some(function (r) { return r.hex; })) return false;
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
 * Does a unit have an ongoing ability carrying an effect of this kind, with its condition holding?
 * @param {Object} state
 * @param {Object} u
 * @param {string} kind
 * @returns {boolean}
 */
export function hasOngoingEffect(state, u, kind) {
  for (const a of abilitiesOf(u)) {
    if (a.timing !== 'ongoing' || !a.effects.some(function (e) { return e.k === kind; })) continue;
    if (conditionHolds(state, u, a.when)) return true;
  }
  return false;
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
 * Every way an ability or card can be aimed, as the fields its action carries: `{}` for itself, `{targetUid}` for a
 * unit, `{gid}` for a Garrison, `{to}` for a hex.
 *
 * @param {Object} state
 * @param {Object} u
 * @param {Ability} a
 * @returns {Array<Object>}
 */
export function targetOptions(state, u, a) {
  const t = a.target;
  if (!t || t === 'self') return [{}];
  if (t === 'enemyInRange' || t === 'adjacentEnemy') return targetsFor(state, u, a).map(function (id) { return { targetUid: id }; });
  if (!u.hex) return [];
  const range = a.range === undefined ? 1 : a.range;
  const inReach = function (h, id) {
    if (Hex.distance(u.hex, h) > range) return false;
    return !a.los || Los.hasLos(state, u.hex, h, { side: u.side, targetUid: id || null });
  };
  const out = [];
  if (t === 'allyInRange' || t === 'unitInRange') {
    for (const o of State.livingUnits(state)) {
      if (o.uid === u.uid || !o.hex || (t === 'allyInRange' && o.side !== u.side)) continue;
      if (inReach(o.hex, o.uid)) out.push({ targetUid: o.uid });
    }
  } else if (t === 'enemyNearOwnRemote') {
    // an enemy unit adjacent to an allied Remote Weapon System
    const rws = State.deployedRemotes(state, u.side);
    for (const o of State.livingUnits(state, State.opponent(u.side))) {
      if (o.hex && rws.some(function (r) { return Hex.distance(r.hex, o.hex) === 1; })) out.push({ targetUid: o.uid });
    }
  } else if (t === 'allyGarrisonInRange') {
    for (const gid of state.garrisonOrder) {
      const g = state.garrisons[gid];
      if (g.alive && g.side === u.side && inReach(g.hex, null)) out.push({ gid: gid });
    }
  } else if (t === 'emptyHex') {
    for (const k of Object.keys(state.board.hexes)) {
      const h = state.board.hexes[k];
      if (Hex.distance(u.hex, h) > range) continue;
      if (State.isEmptyHex(state, h) && inReach(h, null)) out.push({ to: { q: h.q, r: h.r } });
    }
  } else if (t === 'hexNearOwnRemote') {
    // a hex next to one of this unit's own RWS where it could stand; with none, the rest of the effect still resolves
    const seen = {};
    for (const r of State.remotesOf(state, u.uid)) {
      if (!r.hex || (a.remote && r.defId !== a.remote)) continue;
      for (const h of Hex.neighbours(r.hex)) {
        const k = Hex.key(h);
        if (seen[k] || Hex.equals(h, u.hex) || !State.cellAt(state, h)) continue;
        seen[k] = true;
        if (canStand(state, h)) out.push({ to: { q: h.q, r: h.r } });
      }
    }
    if (!out.length) out.push({});
  } else {
    throw new Error('Unknown target kind: ' + t);
  }
  out.sort(function (x, y) {
    const kx = x.targetUid || x.gid || (x.to ? Hex.key(x.to) : '');
    const ky = y.targetUid || y.gid || (y.to ? Hex.key(y.to) : '');
    return kx < ky ? -1 : kx > ky ? 1 : 0;
  });
  return out;
}

/** May a unit be placed (repositioned) on this hex: passable and holding no piece or structure? */
function canStand(state, h) {
  const cell = State.cellAt(state, h);
  if (!cell || state.rules.terrain[cell.terrain].impassable) return false;
  return !State.unitAt(state, h) && !State.garrisonAt(state, h) && !State.remoteAt(state, h) && !State.baseAt(state, h);
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
  if (a.target && a.target !== 'self' && !targetOptions(state, u, a).length) return false;
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
export function resolve(state, uid, a, targetUid, combat, ctx) {
  const u = State.unit(state, uid);
  // Energy is paid when the ability is used, before its effects resolve
  if (a.energy) u.energy -= a.energy;
  const applied = resolveEffects(state, uid, a.effects, targetUid, combat, ctx);

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
export function resolveEffects(state, uid, effects, targetUid, combat, ctx) {
  const u = State.unit(state, uid);
  const applied = [];
  const c = ctx || {};
  const rest = function (i) { return { uid: uid, effects: effects.slice(i + 1), targetUid: targetUid, ctx: c }; };

  for (let i = 0; i < effects.length; i++) {
    const e = effects[i];
    if (!u.alive && e.k !== 'energy') break;
    if (EXTENDED[e.k]) {
      // the newer effect kinds: each returns true when it opened a decision, which carries the rest of the list
      applied.push(e.k);
      if (EXTENDED[e.k](state, u, e, targetUid, c, combat, rest(i))) return applied;
      continue;
    }
    if ((e.k === 'push' || e.k === 'pull') && targetUid && state.activation) {
      const cont = rest(i);
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
        // "then, if it has full HP, it gains Energy"
        if (e.ifFullHp && u.hp < u.maxHp) break;
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
          // `per: 'upgrades'`: damage equal to the Upgrades on the ability's unit
          const n = e.per === 'upgrades' ? u.upgrades.length : e.n;
          if (n <= 0) break;
          combat.dealDamage(state, { kind: 'unit', id: targetUid }, n, u.side, false, { mayBeSaved: true });
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
      case 'noEnemyResponses':
      case 'auraReduceDamage':
      case 'auraAccuracy':
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

// --- The newer effect kinds ----------------------------------------------------

/** Push a unit's Timeline token forward ("moves up the Timeline"). */
export function delayToken(state, uid, n) {
  if (!n || !Timeline.locate(state.timeline, uid)) return;
  const landed = Timeline.push(state.timeline, uid, n, state.rules);
  state.log.push({ t: 'timeline', uid: uid, cost: n, round: landed, delayed: true, notice: true });
}

/** Rescue an allied Garrison outside the Rescue action: its VP, the count, and the unit's own Rescue responses. */
export function rescueGarrison(state, u, gid, combat) {
  const g = state.garrisons[gid];
  if (!g || !g.alive || g.side !== u.side) return;
  g.alive = false;
  const vp = state.rules.scoring.garrisonRescueVp;
  state.players[u.side].vp += vp;
  state.players[u.side].rescued = (state.players[u.side].rescued || 0) + 1;
  state.log.push({ t: 'garrison_rescued', gid: g.gid, uid: u.uid, side: u.side, vp: vp, sound: 'rescue', notice: true });
  raise(state, u.uid, 'rescue', combat, false);
}

/** Hexes a unit entered on its last movement (the start hex excluded). */
function trailOf(state, uid) {
  return state.trail && state.trail.uid === uid ? state.trail.hexes : [];
}

/** Every hex next to any hex of the unit's last movement. */
function besideTrail(state, uid) {
  const out = {};
  for (const h of trailOf(state, uid)) for (const n of Hex.neighbours(h)) out[Hex.key(n)] = n;
  return Object.keys(out).sort().map(function (k) { return out[k]; });
}

/**
 * After a unit ends any movement of its own: remember the trail (for "each enemy it moved adjacent to"), fire its own
 * movement responses, and queue the enemy's chance to answer a unit ending its movement nearby.
 */
export function afterMovement(state, uid, path, combat) {
  const hexes = (path || []).slice(1).map(function (h) { return { q: h.q, r: h.r }; });
  state.trail = { uid: uid, hexes: hexes };
  if (!state.deferred) state.deferred = [];
  state.deferred.push({ kind: 'enemyMoved', uid: uid });
  raise(state, uid, 'moved', combat, true);
}

/** Open a choice. Returns true when there is something to decide; the rest of the effect list waits on `cont`. */
function openChoice(state, spec, cont) {
  state.pending = Object.assign({ kind: 'choose', cont: cont }, spec);
  return settleChoice(state, false);
}

const EXTENDED = {
  speed: function (state, u, e) {
    if (state.activation && state.activation.uid === u.uid) state.activation.mods.move += e.n;
  },
  hover: function (state, u) {
    if (state.activation && state.activation.uid === u.uid) state.activation.mods.hover = true;
  },
  damageBonus: function (state, u, e) {
    if (state.activation && state.activation.uid === u.uid) state.activation.mods.damage += e.n;
  },
  nextAttackStrength: function (state, u, e) {
    if (state.activation && state.activation.uid === u.uid) state.activation.mods.nextStrength += e.n;
  },
  draw: function (state, u, e) {
    State.drawTactics(state, u.side, e.n);
  },
  rescue: function (state, u, e, targetUid, c, combat) {
    if (c.gid) rescueGarrison(state, u, c.gid, combat);
  },
  statusAll: function (state, u, e, targetUid, c, combat) {
    for (const o of State.livingUnits(state, State.opponent(u.side))) {
      if (!o.hex || Hex.distance(u.hex, o.hex) > e.range) continue;
      if (e.los && !Los.hasLos(state, u.hex, o.hex, { side: u.side, targetUid: o.uid })) continue;
      combat.applyStatus(state, o.uid, e.s);
    }
  },
  delayNearRemote: function (state, u, e) {
    const mine = State.remotesOf(state, u.uid).filter(function (r) { return r.hex; });
    // simultaneous delays resolve in Timeline order (Q&A 22, 28): earliest token first
    const at = function (x) { const l = Timeline.locate(state.timeline, x.uid); return l ? l.round : 99; };
    const hit = State.livingUnits(state, State.opponent(u.side)).filter(function (o) {
      return o.hex && mine.some(function (r) { return Hex.distance(r.hex, o.hex) === 1; });
    }).sort(function (x, y) { return at(x) - at(y); });
    for (const o of hit) delayToken(state, o.uid, e.n);
  },
  repositionSelf: function (state, u, e, targetUid, c, combat) {
    if (!c.to) return false;
    const from = { q: u.hex.q, r: u.hex.r };
    u.hex = { q: c.to.q, r: c.to.r };
    if (state.activation && state.activation.uid === u.uid) state.activation.moved = true;
    state.log.push({ t: 'reposition', uid: u.uid, from: from, to: { q: u.hex.q, r: u.hex.r }, path: [from, { q: u.hex.q, r: u.hex.r }] });
    State.collectPickup(state, u);
    afterMovement(state, u.uid, [from, u.hex], combat);
    return Boolean(state.pending);
  },
  placeRemote: function (state, u, e, targetUid, c, combat, cont) {
    const r = state.remotes[u.uid + '.' + e.remote];
    if (!r || !c.to) return false;
    const from = r.hex ? { q: r.hex.q, r: r.hex.r } : null;
    r.hex = { q: c.to.q, r: c.to.r };
    state.log.push({
      t: from ? 'remote_repositioned' : 'remote_deployed', rid: r.rid, owner: u.uid, side: u.side, from: from,
      to: { q: r.hex.q, r: r.hex.r }, sound: 'deploy', notice: true
    });
    return remotePlaced(state, r, cont);
  },
  repositionAllRemotes: function (state, u, e, targetUid, c, combat, cont) {
    const queue = State.deployedRemotes(state).map(function (r) { return r.rid; });
    if (!queue.length) return false;
    return openChoice(state, { what: 'repositionRemotes', side: u.side, uid: u.uid, queue: queue, left: queue.length }, cont);
  },
  remotesStrike: function (state, u, e, targetUid, c, combat, cont) {
    const queue = (e.all ? State.deployedRemotes(state) : State.deployedRemotes(state, u.side)).map(function (r) { return r.rid; });
    if (!queue.length) return false;
    return openChoice(state, { what: 'remoteStrike', side: u.side, queue: queue, n: e.n, left: queue.length }, cont);
  },
  upgradeChoice: function (state, u, e, targetUid, c, combat, cont) {
    const t = targetUid ? state.units[targetUid] : u;
    return openChoice(state, { what: 'gainUpgrade', side: u.side, uid: u.uid, target: t.uid, left: e.n || 1 }, cont);
  },
  upgradeSpread: function (state, u, e, targetUid, c, combat, cont) {
    return openChoice(state, { what: 'spreadUpgrades', side: u.side, uid: u.uid, trait: e.trait || null, left: e.n || 3, units: [], kinds: [] }, cont);
  },
  transfer: function (state, u, e, targetUid, c, combat, cont) {
    const t = targetUid && state.units[targetUid];
    if (!t) return false;
    const left = u.upgrades.length + t.upgrades.length;
    if (!left) return false;
    return openChoice(state, { what: 'transfer', side: u.side, uid: u.uid, a: u.uid, b: t.uid, left: left }, cont);
  },
  steal: function (state, u, e, targetUid, c, combat, cont) {
    const t = targetUid && state.units[targetUid];
    if (!t) return false;
    const n = Math.min(e.energy || 0, t.energy);
    if (n) {
      t.energy -= n;
      u.energy += n;
      state.log.push({ t: 'energy_taken', uid: u.uid, from: t.uid, n: n, notice: true });
    }
    if (!e.upgrades || !t.upgrades.length) return false;
    return openChoice(state, { what: 'takeUpgrade', side: u.side, uid: u.uid, from: t.uid, left: e.upgrades }, cont);
  },
  destroyUpgrades: function (state, u, e, targetUid, c, combat, cont) {
    const t = targetUid && state.units[targetUid];
    if (!t || !t.upgrades.length) return false;
    if (e.n === 'all') {
      while (t.upgrades.length) {
        const gone = t.upgrades.shift();
        state.log.push({ t: 'upgrade_destroyed', uid: t.uid, upgrade: gone, notice: true });
      }
      return false;
    }
    return openChoice(state, { what: 'destroyUpgrade', side: u.side, uid: u.uid, target: t.uid, left: e.n }, cont);
  },
  moveNow: function (state, u, e, targetUid, c, combat, cont) {
    // "Moves N. Then, ...": the move is taken at once, as a decision, and whatever follows waits for it
    state.trail = { uid: u.uid, hexes: [] };
    if (!combat.reactMoves(state, u.uid, e.n).length) return false;
    state.pending = { kind: 'react_move', uid: u.uid, n: e.n, side: u.side, cont: cont };
    return true;
  },
  rescueMovedAdjacent: function (state, u, e, targetUid, c, combat) {
    for (const h of besideTrail(state, u.uid)) {
      const g = State.garrisonAt(state, h);
      if (g && g.side === u.side) rescueGarrison(state, u, g.gid, combat);
    }
  },
  damageMovedAdjacent: function (state, u, e, targetUid, c, combat) {
    for (const h of besideTrail(state, u.uid)) {
      const o = State.unitAt(state, h);
      if (o && o.side !== u.side) combat.dealDamage(state, { kind: 'unit', id: o.uid }, e.n, u.side, false);
      const g = State.garrisonAt(state, h);
      if (g && g.side !== null && g.side !== u.side) combat.dealDamage(state, { kind: 'garrison', id: g.gid }, e.n, u.side, false);
      const r = State.remoteAt(state, h);
      if (r && r.side !== u.side) combat.dealDamage(state, { kind: 'remote', id: r.rid }, e.n, u.side, false);
    }
  }
};

/** An RWS was just deployed or repositioned: its own "after this is deployed or repositioned" response. */
export function remotePlaced(state, r, cont) {
  const onPlace = (r.abilities || []).find(function (a) { return a.timing === 'response' && a.on === 'placed'; });
  const hit = onPlace && onPlace.effects.find(function (x) { return x.k === 'damage'; });
  if (!hit) return false;
  return openChoice(state, { what: 'remoteStrike', side: r.side, queue: [r.rid], n: hit.n, left: 1 }, cont);
}

/**
 * Skip the parts of an open choice that have nothing to choose, and resolve a strike with exactly one target (it is
 * not optional). Returns true while a real decision is open.
 */
function settleChoice(state, resume) {
  let guard = 0;
  while (state.pending && state.pending.kind === 'choose') {
    if (++guard > 64) throw new Error('Choice did not settle');
    const p = state.pending;
    if (p.left <= 0 || (p.queue && !p.queue.length)) {
      finishChoice(state, resume);
      return Boolean(state.pending);
    }
    const opts = chooseOptions(state).filter(function (o) { return o.type === 'choose'; });
    if (!opts.length) {
      if (p.queue && p.queue.length) {
        p.queue.shift();
        p.left = p.queue.length;
        continue;
      }
      finishChoice(state, resume);
      return Boolean(state.pending);
    }
    if (p.what === 'remoteStrike' && opts.length === 1) {
      applyChoice(state, opts[0]);
      continue;
    }
    return true;
  }
  return Boolean(state.pending);
}

function finishChoice(state, resume) {
  const p = state.pending;
  state.pending = null;
  // a choice settled at once returns to the effect list that opened it; one a player decided resumes that list here
  if (resume && p && p.cont) resumeEffects(state, p.cont, choiceCombat);
}

let choiceCombat = null;

/** combat.js is injected for the choice resolutions that deal damage (it imports this module). */
export function bindCombat(c) {
  choiceCombat = c;
}

/** Distinct Upgrade kinds a unit holds, in the order it gained them. */
function kindsOn(u) {
  return u.upgrades.filter(function (k, i, l) { return l.indexOf(k) === i; });
}

/**
 * The open choice's options: `choose` actions naming `targetUid` (a unit), `to` (a hex), `aid` (an Upgrade kind) and,
 * for an RWS step, `uid` (the RWS id), plus a `pass` where the card says "up to" or the step is optional.
 */
export function chooseOptions(state) {
  const p = state.pending;
  const out = [];
  const opt = function (fields) { out.push(Object.assign({ type: 'choose', side: p.side }, fields)); };
  if (p.what === 'gainUpgrade') {
    for (const k of upgradeKinds(state)) opt({ targetUid: p.target, aid: k });
  } else if (p.what === 'spreadUpgrades') {
    for (const o of State.livingUnits(state, p.side)) {
      if (!o.hex || p.units.indexOf(o.uid) !== -1 || (p.trait && (o.traits || []).indexOf(p.trait) === -1)) continue;
      for (const k of upgradeKinds(state)) if (p.kinds.indexOf(k) === -1) opt({ targetUid: o.uid, aid: k });
    }
    out.push({ type: 'pass', side: p.side });
  } else if (p.what === 'transfer') {
    const a = state.units[p.a];
    const b = state.units[p.b];
    for (const k of kindsOn(a)) opt({ targetUid: b.uid, aid: k });
    for (const k of kindsOn(b)) opt({ targetUid: a.uid, aid: k });
    out.push({ type: 'pass', side: p.side });
  } else if (p.what === 'takeUpgrade') {
    for (const k of kindsOn(state.units[p.from])) opt({ targetUid: p.from, aid: k });
  } else if (p.what === 'destroyUpgrade') {
    const t = state.units[p.target];
    for (const k of kindsOn(t)) opt({ targetUid: t.uid, aid: k });
    out.push({ type: 'pass', side: p.side });
  } else if (p.what === 'repositionRemotes') {
    const r = state.remotes[p.queue[0]];
    for (const k of Object.keys(state.board.hexes)) {
      const h = state.board.hexes[k];
      if (State.isEmptyHex(state, h)) opt({ uid: r.rid, to: { q: h.q, r: h.r } });
    }
    out.push({ type: 'pass', side: p.side });
  } else if (p.what === 'remoteStrike') {
    const r = state.remotes[p.queue[0]];
    if (r && r.hex) {
      for (const h of Hex.neighbours(r.hex)) {
        const o = State.unitAt(state, h);
        if (o && o.side !== p.side) opt({ uid: r.rid, targetUid: o.uid });
      }
    }
  }
  return out;
}

/** Apply one `choose` step (mutates `state`). */
function applyChoice(state, action) {
  const p = state.pending;
  if (p.what === 'gainUpgrade' || p.what === 'spreadUpgrades') {
    const t = state.units[action.targetUid];
    t.upgrades.push(action.aid);
    state.log.push({ t: 'pickup', uid: t.uid, kind: 'upgrade', upgrade: action.aid, notice: true });
    if (p.what === 'spreadUpgrades') {
      p.units.push(t.uid);
      p.kinds.push(action.aid);
    }
    p.left--;
  } else if (p.what === 'transfer' || p.what === 'takeUpgrade') {
    const to = p.what === 'takeUpgrade' ? state.units[p.uid] : state.units[action.targetUid];
    const from = p.what === 'takeUpgrade' ? state.units[p.from] : state.units[to.uid === p.a ? p.b : p.a];
    from.upgrades.splice(from.upgrades.indexOf(action.aid), 1);
    to.upgrades.push(action.aid);
    // a Shield that changes hands is reactivated (rulebook 2026-10-30, "Redistributing or Taking Upgrades")
    if (action.aid === 'shield') {
      from.shieldSpent = Math.min(from.shieldSpent | 0, State.upgradeCount(from, 'shield') * state.rules.upgrades.shieldAbsorb);
    }
    state.log.push({ t: 'upgrade_moved', uid: to.uid, from: from.uid, upgrade: action.aid, notice: true });
    p.left--;
  } else if (p.what === 'destroyUpgrade') {
    const t = state.units[action.targetUid];
    t.upgrades.splice(t.upgrades.indexOf(action.aid), 1);
    state.log.push({ t: 'upgrade_destroyed', uid: t.uid, upgrade: action.aid, notice: true });
    p.left--;
  } else if (p.what === 'repositionRemotes') {
    const r = state.remotes[action.uid];
    const from = { q: r.hex.q, r: r.hex.r };
    r.hex = { q: action.to.q, r: action.to.r };
    state.log.push({ t: 'remote_repositioned', rid: r.rid, owner: r.owner, side: r.side, from: from, to: { q: r.hex.q, r: r.hex.r }, notice: true });
    p.queue.shift();
    p.left = p.queue.length;
  } else if (p.what === 'remoteStrike') {
    choiceCombat.dealDamage(state, { kind: 'unit', id: action.targetUid }, p.n, p.side, false);
    p.queue.shift();
    p.left = p.queue.length;
  }
}

/**
 * Resolve the player's step on an open choice, then whatever the choice was holding up.
 * @param {Object} state
 * @param {Object} action a `choose` or a `pass`
 */
export function decideChoose(state, action) {
  const p = state.pending;
  if (action.type === 'pass') {
    if (p.what === 'repositionRemotes') {
      p.queue.shift();
      p.left = p.queue.length;
    } else {
      p.left = 0;
    }
  } else {
    applyChoice(state, action);
  }
  settleChoice(state, true);
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
  resolveEffects(state, cont.uid, cont.effects, cont.targetUid, combat, cont.ctx);
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
    if (a.energy && u.energy < a.energy) continue;
    const targets = targetsFor(state, u, a);
    if (a.target && a.target !== 'self' && !targets.length) continue;
    // a response that costs Energy is always the player's choice to pay
    const optional = Boolean(a.optional || a.energy);
    if (interactive && (optional || targets.length > 1)) {
      state.pending = {
        kind: 'trigger', side: u.side, uid: uid, aid: a.aid, targets: targets,
        optional: optional, rest: queue.slice()
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
