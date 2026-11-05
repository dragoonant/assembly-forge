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

import * as Attack from './attack.js';
import * as Actions from './actions.js';
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
  if (ref.kind === 'remote') {
    const r = state.remotes && state.remotes[ref.id];
    return r && r.hex ? r.hex : null;
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

  // Enemy Remote Weapon Systems can be attacked and destroyed (rulebook 2026-10-30, "Remote Weapon System").
  for (const r of State.deployedRemotes(state, State.opponent(u.side))) {
    if (Hex.distance(u.hex, r.hex) > w.range) continue;
    if (!w.ignoreLos && !Los.hasLos(state, u.hex, r.hex, { side: u.side, targetUid: null })) continue;
    out.push({ kind: 'remote', id: r.rid });
  }

  // An Engaged unit must target at least one of the enemies it is Engaged with (rulebook
  // 2026-10-30, "Engagement"). Every target here is single, so that means only those enemies.
  if (state.rules.movement.engagedMustTargetEngaged) {
    const engaged = State.engagedWith(state, u.side, u.hex);
    if (engaged.length) {
      const ok = {};
      for (let i = 0; i < engaged.length; i++) ok[engaged[i].kind + ':' + engaged[i].id] = true;
      return out.filter(function (t) { return ok[t.kind + ':' + t.id]; });
    }
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

  // Terrain: the target's hex and the attacker's own both count (water and debris), and an
  // interference field applies once against a non-adjacent target if either is inside it.
  const into = State.terrainAt(state, tHex);
  const from = State.terrainAt(state, attacker.hex);
  if (into) shift += into.accuracyInto || 0;
  if (from) shift += from.accuracyFrom || 0;
  if (((into && into.field) || (from && from.field)) && Hex.distance(attacker.hex, tHex) > 1) {
    shift += c.fieldAccuracy;
  }

  const climb = State.elevationAt(state, attacker.hex) - State.elevationAt(state, tHex);
  shift += (c.elevationAccuracyFlat ? Math.sign(climb) : climb) * c.elevationAccuracyPerLevel;

  shift += State.upgradeCount(attacker, 'accuracy');
  if (attacker.statuses.indexOf('blinded') !== -1) shift -= 1;

  shift += Effects.ongoingModifier(state, attacker, 'accuracy');

  // an allied RWS with an accuracy aura: +n attacking an enemy adjacent to it
  for (const r of State.deployedRemotes(state, attacker.side)) {
    const n = State.remoteAura(r, 'auraAccuracy');
    if (n && Hex.distance(r.hex, tHex) === 1) shift += n;
  }
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
export function strengthOf(state, attacker, w, extra, targets) {
  let s = w.strength;
  s += State.upgradeCount(attacker, 'strength');
  s += Effects.ongoingModifier(state, attacker, 'strength');
  if (state.activation && state.activation.uid === attacker.uid) {
    s += state.activation.mods.strength;
    // weapon-specific bonuses for this activation (an ability that boosts one named weapon)
    const wm = state.activation.weaponMods && state.activation.weaponMods[w.wid];
    if (wm) s += wm;
  }
  // a weapon that grows with nearby allies: +n per other ally within a range
  if (w.strengthPerAlly && attacker.hex) {
    let n = 0;
    for (const o of State.livingUnits(state, attacker.side)) {
      if (o.uid === attacker.uid || !o.hex || Hex.distance(o.hex, attacker.hex) > w.strengthPerAlly.range) continue;
      if (w.strengthPerAlly.los && !Los.hasLos(state, attacker.hex, o.hex, { side: attacker.side, targetUid: o.uid })) continue;
      n++;
    }
    s += n * w.strengthPerAlly.n;
  }
  // +n per Upgrade of a kind on the attacker
  if (w.strengthPerUpgrade) s += State.upgradeCount(attacker, w.strengthPerUpgrade.kind) * w.strengthPerUpgrade.n;
  // +n per allied RWS adjacent to the target (the first target, or any of several: the bonus is counted on the best)
  if (w.strengthPerRemoteAdj && targets && targets.length) {
    let best = 0;
    for (const ref of targets) {
      const h = targetHex(state, ref);
      if (!h) continue;
      const n = State.deployedRemotes(state, attacker.side).filter(function (r) { return Hex.distance(r.hex, h) === 1; }).length;
      if (n > best) best = n;
    }
    s += best * w.strengthPerRemoteAdj;
  }
  // a bonus against targets carrying a status; with several targets it applies if any one qualifies
  const vsStatus = Effects.ongoingModifier(state, attacker, 'strengthVsStatus');
  if (vsStatus && targets && targets.some(function (r) { return r.kind === 'unit' && state.units[r.id] && state.units[r.id].statuses.length > 0; })) {
    s += vsStatus;
  }
  if (extra) s += extra;
  return Math.max(0, s);
}

/**
 * The lowest die face that counts as a critical for this attacker: the rules' default, or lower with an ongoing
 * ability that widens it (a unit whose 7s and 8s crit).
 * @param {Object} state
 * @param {Object} attacker
 * @returns {number}
 */
export function critFromFor(state, attacker) {
  let c = state.rules.combat.critFrom;
  for (const a of Effects.abilitiesOf(attacker)) {
    if (a.timing !== 'ongoing' || !Effects.conditionHolds(state, attacker, a.when)) continue;
    for (const e of a.effects) if (e.k === 'critFrom' && e.n < c) c = e.n;
  }
  return c;
}

/**
 * What damage a unit would actually take from `hits`, after Shields and Fracture, without changing anything.
 * @param {Object} state
 * @param {Object} u
 * @param {number} hits
 * @param {boolean} combatDamage
 * @returns {number}
 */
export function previewDamage(state, u, hits, combatDamage) {
  let damage = hits;
  const ready = State.upgradeCount(u, 'shield') * state.rules.upgrades.shieldAbsorb - (u.shieldSpent | 0);
  if (ready > 0 && damage > 0) damage -= Math.min(ready, damage);
  if (combatDamage && u.statuses.indexOf('fracture') !== -1 && damage >= state.rules.statuses.fractureThreshold) {
    damage += state.rules.statuses.fractureBonus;
  }
  return damage;
}

/**
 * Where a unit reacting outside its own activation may Move: an ordinary move of `n` hexes.
 * @param {Object} state
 * @param {string} uid
 * @param {number} n
 * @returns {Array<Object>}
 */
export function reactMoves(state, uid, n) {
  return Actions.movementOptions(state, uid, n);
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
export function isHit(face, shift, combatRules, critFrom) {
  if (face === combatRules.naturalMiss) return false;
  if (face >= (critFrom || combatRules.critFrom)) return true;
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
export function resolveAttack(state, uid, wid, ref) {
  const attacker = State.unit(state, uid);
  const w = weapon(attacker, wid);
  if (!w) throw new Error('Unit ' + uid + ' has no weapon ' + wid);
  Attack.start(state, { uid: uid, weapon: w, targets: [ref] });
  // with no response cards in play the sequence never pauses; if it does, the caller must resolve the decision
  for (let i = state.log.length - 1; i >= 0; i--) if (state.log[i].t === 'attack') return state.log[i];
  return null;
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
export function dealDamage(state, ref, hits, bySide, combat, opts) {
  if (ref.kind === 'garrison') {
    const g = state.garrisons[ref.id];
    if (!g || !g.alive) return { damage: 0, destroyed: false };
    g.alive = false;
    // 2 VP for defeating an ENEMY Garrison (rulebook 2026-10-30, "Garrisons"): a side that destroys its own scores nothing
    const vp = bySide === g.side ? 0 : state.rules.scoring.garrisonDestroyVp;
    state.players[bySide].vp += vp;
    if (vp) state.players[bySide].garrisonsDestroyed = (state.players[bySide].garrisonsDestroyed || 0) + 1;
    state.log.push({
      t: 'garrison_destroyed', gid: g.gid, by: bySide,
      vp: vp, sound: 'destroy', notice: true
    });
    return { damage: hits, destroyed: true };
  }

  if (ref.kind === 'remote') {
    const r = state.remotes && state.remotes[ref.id];
    if (!r || !r.hex || hits <= 0) return { damage: 0, destroyed: false };
    r.hp -= hits;
    if (r.hp > 0) return { damage: hits, destroyed: false };
    destroyRemote(state, r, true);
    return { damage: hits, destroyed: true };
  }

  const u = state.units[ref.id];
  if (!u || !u.alive) return { damage: 0, destroyed: false };

  let damage = hits;
  let absorbed = 0;
  let fractured = false;

  // `fracture` adds 3 the next time the unit takes 3 or more COMBAT damage from one attack, then
  // clears. Direct damage from an ability never triggers it (rulebook 2026-10-30, "Fracture").
  const fi = u.statuses.indexOf('fracture');
  if (combat && fi !== -1 && damage >= state.rules.statuses.fractureThreshold) {
    damage += state.rules.statuses.fractureBonus;
    u.statuses.splice(fi, 1);
    fractured = true;
  }

  // Shields come after every other effect on the damage, Fracture included (rulebook 2026-10-30, "Damage and
  // Shields"). Each active Shield prevents one point and then deactivates until its holder next activates
  // (rulebook 2026-10-30, "Shield Upgrades"). Shields also stop collision damage.
  const ready = State.upgradeCount(u, 'shield') * state.rules.upgrades.shieldAbsorb - (u.shieldSpent | 0);
  if (ready > 0 && damage > 0) {
    absorbed = Math.min(ready, damage);
    damage -= absorbed;
    u.shieldSpent = (u.shieldSpent | 0) + absorbed;
  }

  u.hp -= damage;
  // a response that keeps a unit standing at 1 HP instead of being defeated
  if (opts && opts.floorHp && u.hp < opts.floorHp) {
    u.hp = opts.floorHp;
    state.log.push({ t: 'survived', uid: u.uid, notice: true });
  }

  // Damage outside an attack that would defeat a unit whose owner can answer it: hold the unit at 1 HP and ask
  // (the "would be defeated" window, which applies to any damage, not only an attack's).
  if (u.hp <= 0 && opts && opts.mayBeSaved && !state.pending && Attack.defeatSavable(state, u)) {
    u.hp = 1;
    state.pending = { kind: 'window', window: 'wouldBeDefeated', role: 'defender', side: u.side, uid: u.uid, outside: true, by: bySide, cont: null };
    return { damage: damage, destroyed: false, absorbed: absorbed, fractured: fractured, held: true };
  }

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
  // the defeated unit's opponent scores it, whoever dealt the last damage (rulebook 2026-10-30, "Defeated Units")
  state.players[u.side === 0 ? 1 : 0].vp += u.vp;
  const from = u.hex ? { q: u.hex.q, r: u.hex.r } : null;

  const redeploys = canRedeploy(state, u.side);
  if (redeploys) {
    Timeline.push(state.timeline, u.uid, state.rules.destruction.tokenPushRounds, state.rules);
    // Back to Reserve, repaired: hit points reset and statuses cleared, while Energy and Upgrades
    // are kept (rulebook 2026-10-30, "Defeated Units"). It redeploys on its next activation.
    u.inReserve = true;
    u.hex = null;
    u.hp = u.maxHp;
    u.statuses = [];
    u.shieldSpent = 0;
  } else {
    Timeline.remove(state.timeline, u.uid);
  }

  // Its Remote Weapon Systems return to its supply (each RWS card says so).
  for (const r of State.remotesOf(state, u.uid)) if (r.hex) destroyRemote(state, r, false);

  // A unit defeated during its own activation ends that activation at once.
  if (state.activation && state.activation.uid === u.uid) state.activation.defeated = true;

  state.log.push({
    t: 'destroyed', uid: u.uid, side: u.side, by: bySide, vp: u.vp, from: from,
    redeploys: redeploys, sound: 'destroy', notice: true
  });
}

/**
 * Take an RWS off the board and back to its owner's supply, repaired. Defeated in play, its VP go to the opposing
 * player like a unit's; returned because its owner fell, nobody scores it.
 * @param {Object} state
 * @param {Object} r
 * @param {boolean} defeated
 */
export function destroyRemote(state, r, defeated) {
  const from = r.hex ? { q: r.hex.q, r: r.hex.r } : null;
  r.hex = null;
  r.hp = r.maxHp;
  if (defeated) state.players[r.side === 0 ? 1 : 0].vp += r.vp;
  state.log.push({
    t: 'remote_destroyed', rid: r.rid, owner: r.owner, side: r.side, from: from, vp: defeated ? r.vp : 0,
    returned: !defeated, sound: defeated ? 'destroy' : undefined, notice: true
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

Effects.bindCombat({ dealDamage: dealDamage });

Attack.bindCombat({
  targetHex: targetHex, strengthOf: strengthOf, accuracyShift: accuracyShift, isHit: isHit, critFromFor: critFromFor,
  previewDamage: previewDamage, dealDamage: dealDamage, applyStatus: applyStatus, weapon: weapon,
  targetsFor: targetsFor, reactMoves: reactMoves, destroyUnit: destroyUnit, weaponsOf: weaponsOf, destroyRemote: destroyRemote
});
