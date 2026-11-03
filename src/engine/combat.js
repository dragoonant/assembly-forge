/**
 * Attacks: who can be shot, what the dice say, and what happens to whatever
 * was hit.
 *
 * These functions MUTATE the state they are given. That is safe and deliberate
 * -- `apply` clones first and calls into here with the clone, exactly as it
 * does for movement. Nothing here should ever be handed a state a caller still
 * cares about.
 *
 * TWO INDEPENDENT AXES, and keeping them apart is the whole design:
 *
 *   strength  -- how many dice are rolled.
 *   accuracy  -- what each die has to beat.
 *
 * Published abilities exist for both ("+3 strength this activation", "+2
 * accuracy"), so collapsing them into one number would make some of them
 * inexpressible. Modifiers are applied to the die FACE rather than to the
 * target number, which is what makes the two natural-roll rules coherent:
 * a natural 1 misses and a natural 9 or 10 hits and crits, whatever the
 * modifiers say.
 */

import * as Effects from './effects.js';
import * as Hex from './hex.js';
import * as Los from './los.js';
import * as Rng from './rng.js';
import * as State from './state.js';
import * as Timeline from './timeline.js';

/**
 * @typedef {Object} Weapon
 * @property {string} wid       stable id, unique within the unit
 * @property {number} tlCost
 * @property {number} range     in hexes
 * @property {number} strength  dice rolled
 * @property {number} [accuracy] a permanent shift for this weapon
 * @property {boolean} [ignoreLos]
 * @property {Object} [crit]    effect data, resolved by the effect layer
 */

/**
 * @typedef {Object} TargetRef
 * @property {'unit'|'garrison'} kind
 * @property {string} id
 */

/**
 * The weapons on a unit. Units built before weapons existed simply have none,
 * which is why this tolerates the field being absent rather than throwing.
 *
 * @param {Object} u
 * @returns {Weapon[]}
 */
export function weaponsOf(u) {
  return u.weapons || [];
}

/**
 * @param {Object} u
 * @param {string} wid
 * @returns {?Weapon}
 */
export function weapon(u, wid) {
  const list = weaponsOf(u);
  for (let i = 0; i < list.length; i++) if (list[i].wid === wid) return list[i];
  return null;
}

/**
 * Where a target stands, whatever kind of thing it is.
 * @param {Object} state
 * @param {TargetRef} ref
 * @returns {?{q: number, r: number}}
 */
export function targetHex(state, ref) {
  if (ref.kind === 'unit') {
    const u = state.units[ref.id];
    return u && u.alive ? u.hex : null;
  }
  const g = state.garrisons[ref.id];
  return g && g.alive ? g.hex : null;
}

/**
 * Everything a unit could shoot with a given weapon right now.
 *
 * Enemy units and enemy garrisons, inside the weapon's range, with line of
 * sight unless the weapon ignores it. Friendly units are not targets; the
 * sources give no way to shoot your own side and inventing one would show up
 * in the AI immediately.
 *
 * @param {Object} state
 * @param {string} uid
 * @param {Weapon} w
 * @returns {TargetRef[]}
 */
export function targetsFor(state, uid, w) {
  const u = State.unit(state, uid);
  const out = [];

  const units = State.livingUnits(state);
  for (let i = 0; i < units.length; i++) {
    const t = units[i];
    if (t.side === u.side || !t.alive) continue;
    if (Hex.distance(u.hex, t.hex) > w.range) continue;
    if (!w.ignoreLos && !Los.hasLos(state, u.hex, t.hex, { side: u.side, targetUid: t.uid })) continue;
    out.push({ kind: 'unit', id: t.uid });
  }

  for (let i = 0; i < state.garrisonOrder.length; i++) {
    const g = state.garrisons[state.garrisonOrder[i]];
    if (!g.alive || g.side === u.side || g.side === null) continue;
    if (Hex.distance(u.hex, g.hex) > w.range) continue;
    if (!w.ignoreLos && !Los.hasLos(state, u.hex, g.hex, { side: u.side, targetUid: null })) continue;
    out.push({ kind: 'garrison', id: g.gid });
  }

  return out;
}

/**
 * The total accuracy shift on an attack: how much each die is helped or hurt
 * before it is compared against the accuracy floor.
 *
 * Sources, all cumulative:
 *   - the weapon's own shift;
 *   - the terrain the TARGET stands in (water is harder to hit into);
 *   - elevation difference, in the attacker's favour when shooting downhill;
 *   - the Strength/Shield-style upgrades and statuses that touch accuracy;
 *   - anything an ability passes in for this attack only.
 *
 * @param {Object} state
 * @param {Object} attacker
 * @param {Weapon} w
 * @param {{q: number, r: number}} tHex
 * @param {number} [extra] a one-off shift from an ability or tactics card
 * @returns {number}
 */
export function accuracyShift(state, attacker, w, tHex, extra) {
  const c = state.rules.combat;
  let shift = w.accuracy || 0;

  const kind = State.terrainAt(state, tHex);
  if (kind) shift += kind.accuracy;

  const climb = State.elevationAt(state, attacker.hex) - State.elevationAt(state, tHex);
  shift += climb * c.elevationAccuracyPerLevel;

  if (attacker.upgrades.indexOf('accuracy') !== -1) shift += 1;
  if (attacker.statuses.indexOf('blinded') !== -1) shift -= 1;

  shift += Effects.ongoingModifier(state, attacker, 'accuracy');
  if (state.activation && state.activation.uid === attacker.uid) {
    shift += state.activation.mods.accuracy;
  }

  if (extra) shift += extra;

  const cap = c.maxAccuracyShift;
  return Math.max(-cap, Math.min(cap, shift));
}

/**
 * How many dice this attack rolls.
 * @param {Object} state
 * @param {Object} attacker
 * @param {Weapon} w
 * @param {number} [extra]
 * @returns {number}
 */
export function strengthOf(state, attacker, w, extra) {
  let s = w.strength;
  if (attacker.upgrades.indexOf('strength') !== -1) s += 1;
  s += Effects.ongoingModifier(state, attacker, 'strength');
  if (state.activation && state.activation.uid === attacker.uid) {
    s += state.activation.mods.strength;
  }
  if (extra) s += extra;
  return Math.max(0, s);
}

/**
 * Roll and read the dice.
 *
 * `disarm` is handled here because it changes the dice themselves rather than
 * the outcome: it suppresses the critical effect and forces every hit to be
 * rerolled once, keeping the worse of the two readings.
 *
 * @param {Object} rngState
 * @param {Object} rules
 * @param {number} count
 * @param {number} shift
 * @param {boolean} disarmed
 * @returns {{rolls: number[], rerolls: ?number[], hits: number, crits: number, state: Object}}
 */
export function rollAttack(rngState, rules, count, shift, disarmed) {
  const c = rules.combat;
  const first = Rng.rollN(rngState, count, c.dieSides);
  let rngNow = first.state;
  const faces = first.value.slice();
  let rerolls = null;

  if (disarmed) {
    // Reroll every die that would have hit, and take the new face. A reroll
    // that lands on 1 is a miss like any other, so this genuinely costs the
    // attacker rather than merely re-drawing.
    const again = [];
    for (let i = 0; i < faces.length; i++) {
      if (isHit(faces[i], shift, c)) {
        const r = Rng.roll(rngNow, c.dieSides);
        rngNow = r.state;
        again.push(r.value);
        faces[i] = r.value;
      } else {
        again.push(faces[i]);
      }
    }
    rerolls = again;
  }

  let hits = 0;
  let crits = 0;
  for (let i = 0; i < faces.length; i++) {
    if (isHit(faces[i], shift, c)) hits++;
    if (!disarmed && faces[i] >= c.critFrom) crits++;
  }

  return { rolls: first.value, rerolls: rerolls, hits: hits, crits: crits, state: rngNow };
}

/**
 * Does one die face hit?
 *
 * A natural 1 always misses and a natural `critFrom` or better always hits,
 * both regardless of modifiers. Everything between is the modified face
 * against the accuracy floor.
 *
 * @param {number} face
 * @param {number} shift
 * @param {Object} combatRules
 * @returns {boolean}
 */
export function isHit(face, shift, combatRules) {
  if (face === combatRules.naturalMiss) return false;
  if (face >= combatRules.critFrom) return true;
  return face + shift >= combatRules.defaultAccuracy;
}

/**
 * The expected number of hits, without rolling.
 *
 * The AI needs this and must not sample: hits are Binomial(n, p), so the mean
 * is exact and cheap. Getting it from repeated simulation would make search
 * results noisy and irreproducible for no gain in accuracy.
 *
 * @param {Object} rules
 * @param {number} count
 * @param {number} shift
 * @returns {number}
 */
export function expectedHits(rules, count, shift) {
  const c = rules.combat;
  let hitFaces = 0;
  for (let face = 1; face <= c.dieSides; face++) {
    if (isHit(face, shift, c)) hitFaces++;
  }
  return count * (hitFaces / c.dieSides);
}

/**
 * The chance an attack produces at least one critical.
 * @param {Object} rules
 * @param {number} count
 * @returns {number}
 */
export function critChance(rules, count) {
  const c = rules.combat;
  const perDie = (c.dieSides - c.critFrom + 1) / c.dieSides;
  return 1 - Math.pow(1 - perDie, count);
}

// --- Resolution --------------------------------------------------------------

/**
 * Resolve an attack against the state, mutating it.
 *
 * @param {Object} state       a state the caller owns outright
 * @param {string} uid         attacker
 * @param {string} wid         weapon
 * @param {TargetRef} ref
 * @param {{strength?: number, accuracy?: number}} [extra] one-off modifiers
 * @returns {Object} a summary, also pushed onto the log
 */
export function resolveAttack(state, uid, wid, ref, extra) {
  const attacker = State.unit(state, uid);
  const w = weapon(attacker, wid);
  if (!w) throw new Error('Unit ' + uid + ' has no weapon ' + wid);

  const tHex = targetHex(state, ref);
  if (!tHex) throw new Error('Attack on a target that is not on the board: ' + ref.id);

  const bonus = extra || {};
  const shift = accuracyShift(state, attacker, w, tHex, bonus.accuracy);
  const dice = strengthOf(state, attacker, w, bonus.strength);
  const disarmed = attacker.statuses.indexOf('disarm') !== -1;

  const rolled = rollAttack(state.rng, state.rules, dice, shift, disarmed);
  state.rng = rolled.state;

  const outcome = {
    t: 'attack',
    uid: uid,
    wid: wid,
    target: ref,
    dice: dice,
    shift: shift,
    rolls: rolled.rolls,
    rerolls: rolled.rerolls,
    hits: rolled.hits,
    crits: rolled.crits,
    disarmed: disarmed,
    damage: 0,
    destroyed: false,
    sound: rolled.hits > 0 ? 'hit' : 'miss'
  };

  // Criticals fire ONCE per attack however many were rolled, which is the
  // published rule. Extra dice resolve before damage so they can contribute
  // hits; the flat bonus and the status are applied after.
  let hits = rolled.hits;
  let critDamage = 0;
  if (rolled.crits > 0 && w.crit) {
    outcome.critFired = true;
    if (w.crit.dice) {
      const more = rollAttack(state.rng, state.rules, w.crit.dice, shift, disarmed);
      state.rng = more.state;
      hits += more.hits;
      outcome.critRolls = more.rolls;
    }
    if (w.crit.damage) critDamage += w.crit.damage;
  }

  if (hits > 0) {
    const dealt = dealDamage(state, ref, hits + critDamage, attacker.side);
    outcome.hits = hits;
    outcome.damage = dealt.damage;
    outcome.destroyed = dealt.destroyed;
    if (dealt.destroyed) outcome.sound = 'destroy';
    if (dealt.absorbed) outcome.absorbed = dealt.absorbed;
    if (dealt.fractured) outcome.fractured = true;

    // A status only sticks to something still standing.
    if (rolled.crits > 0 && w.crit && w.crit.status && !dealt.destroyed && ref.kind === 'unit') {
      if (applyStatus(state, ref.id, w.crit.status)) outcome.status = w.crit.status;
    }
  }

  state.log.push(outcome);
  return outcome;
}

/**
 * Give a unit a status.
 *
 * A unit may carry several different statuses but never two of the same, so a
 * repeat is a no-op rather than a stack. Returns whether anything changed, so
 * a caller can avoid reporting an effect that did not land.
 *
 * @param {Object} state
 * @param {string} uid
 * @param {string} status
 * @returns {boolean}
 */
export function applyStatus(state, uid, status) {
  const u = state.units[uid];
  if (!u || !u.alive) return false;
  if (state.rules.statuses.known.indexOf(status) === -1) {
    throw new Error('Unknown status: ' + status);
  }
  if (u.statuses.indexOf(status) !== -1) return false;
  u.statuses.push(status);
  state.log.push({ t: 'status', uid: uid, status: status, notice: true });
  return true;
}

/**
 * Apply damage to whatever was hit.
 *
 * A garrison has no hit points: any damage at all destroys it. A unit runs its
 * damage through the Shield upgrade and the `fracture` status first.
 *
 * @param {Object} state
 * @param {TargetRef} ref
 * @param {number} hits
 * @param {0|1} bySide
 * @returns {{damage: number, destroyed: boolean, absorbed?: number, fractured?: boolean}}
 */
export function dealDamage(state, ref, hits, bySide) {
  if (ref.kind === 'garrison') {
    const g = state.garrisons[ref.id];
    if (!g || !g.alive) return { damage: 0, destroyed: false };
    g.alive = false;
    state.players[bySide].vp += state.rules.scoring.garrisonDestroyVp;
    state.log.push({
      t: 'garrison_destroyed', gid: g.gid, by: bySide,
      vp: state.rules.scoring.garrisonDestroyVp, sound: 'destroy', notice: true
    });
    return { damage: hits, destroyed: true };
  }

  const u = state.units[ref.id];
  if (!u || !u.alive) return { damage: 0, destroyed: false };

  let damage = hits;
  let absorbed = 0;
  let fractured = false;

  // The Shield upgrade absorbs one point per activation of the unit holding
  // it, so it is spent here and refreshed when that unit next activates.
  if (u.upgrades.indexOf('shield') !== -1 && !u.shieldSpent && damage > 0) {
    absorbed = 1;
    damage -= 1;
    u.shieldSpent = true;
  }

  // `fracture` adds 3 the next time the unit takes 3 or more, then clears.
  const fi = u.statuses.indexOf('fracture');
  if (fi !== -1 && damage >= state.rules.statuses.fractureThreshold) {
    damage += state.rules.statuses.fractureBonus;
    u.statuses.splice(fi, 1);
    fractured = true;
  }

  u.hp -= damage;

  if (u.hp <= 0) {
    u.hp = 0;
    destroyUnit(state, u, bySide);
    return { damage: damage, destroyed: true, absorbed: absorbed, fractured: fractured };
  }

  return { damage: damage, destroyed: false, absorbed: absorbed, fractured: fractured };
}

/**
 * Take a unit off the board and settle everything that follows.
 *
 * THE DEADLOCK THIS AVOIDS. The rule is that a destroyed unit's token moves
 * two rounds forward, which reads as though the token stays on the track. If
 * it does, the scheduler will eventually open an activation for a unit that no
 * longer exists, `legalActions` returns nothing, and the game wedges -- there
 * is no action available to clear the round.
 *
 * So the token only stays where it has somewhere to come back to. With
 * redeployment available the unit is pushed and will return; without it the
 * token is removed outright, which keeps the invariant that every token on the
 * track belongs to a living unit.
 *
 * @param {Object} state
 * @param {Object} u
 * @param {0|1} bySide
 */
export function destroyUnit(state, u, bySide) {
  u.alive = false;
  u.hp = 0;
  state.players[bySide].vp += u.vp;

  const redeploys = canRedeploy(state, u.side);
  if (redeploys) {
    Timeline.push(state.timeline, u.uid, state.rules.destruction.tokenPushRounds, state.rules);
  } else {
    Timeline.remove(state.timeline, u.uid);
  }

  state.log.push({
    t: 'destroyed', uid: u.uid, side: u.side, by: bySide, vp: u.vp,
    redeploys: redeploys, sound: 'destroy', notice: true
  });
}

/**
 * May a destroyed unit of this side come back? Open question 2.
 *
 * @param {Object} state
 * @param {0|1} side
 * @returns {boolean}
 */
export function canRedeploy(state, side) {
  const mode = state.rules.destruction.redeploy;
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  // 'scenario': only where the scenario actually laid down a base for this
  // side. A scenario that never anticipated redeployment cannot be broken by
  // a rule it does not participate in.
  const bases = state.bases || [];
  for (let i = 0; i < bases.length; i++) {
    if (bases[i].side === side) return true;
  }
  return false;
}

/**
 * Refresh the per-activation Shield charge. Called when a unit activates.
 * @param {Object} state
 * @param {string} uid
 */
export function refreshShield(state, uid) {
  const u = state.units[uid];
  if (u) u.shieldSpent = false;
}
