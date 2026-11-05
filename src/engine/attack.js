/**
 * The attack sequence, as a resumable state machine (rulebook 2026-10-30, "Attack Timing and Responses").
 *
 *   1. declare, choose weapon and targets, pay Timeline   (the caller, in apply.js)
 *   2. weapon effects that happen before the roll          (a pull, for instance)
 *   3. before-roll window: attacker, then defender
 *   4. roll the dice, once, for every target
 *   5. weapon effects after the roll; attacker's after-roll window; then Disarm; then the defender's window
 *   6. critical effects
 *   7. damage, target by target: reductions, then Shields, then Fracture; a unit that would be defeated gives its
 *      owner a chance to respond first
 *   8. weapon effects after damage; after-damage window: attacker, then defender
 *
 * A window with nothing playable for a side is skipped silently, so a game with no response cards never stops. When a
 * side can respond, `state.pending` names the decision and `legalActions` offers that side its options; `apply`
 * resumes the sequence with `run` once the side has chosen. Everything lives in plain data on the state
 * (`state.attacks` is a stack, because a response can itself make an attack), so a paused attack survives
 * `structuredClone` and replays exactly.
 */

import * as Displace from './displace.js';
import * as Effects from './effects.js';
import * as Hex from './hex.js';
import * as Los from './los.js';
import * as Rng from './rng.js';
import * as State from './state.js';
import * as Timeline from './timeline.js';

let combat = null;

/** combat.js injects itself here, to avoid an import cycle. */
export function bindCombat(c) {
  combat = c;
}

const STEPS = [
  'pre', 'before_a', 'before_d', 'roll', 'post_roll', 'after_a', 'disarm', 'after_d',
  'crits', 'damage', 'post_damage', 'dmg_a', 'dmg_d', 'finish'
];

const WINDOW_OF = {
  before_a: ['beforeRoll', 'attacker'],
  before_d: ['beforeRoll', 'defender'],
  after_a: ['afterRoll', 'attacker'],
  after_d: ['afterRoll', 'defender'],
  dmg_a: ['afterDamage', 'attacker'],
  dmg_d: ['afterDamage', 'defender']
};

/** @returns {?Object} the attack now resolving, if any */
export function current(state) {
  const stack = state.attacks || [];
  return stack.length ? stack[stack.length - 1] : null;
}

function refKey(ref) {
  return ref.kind + ':' + ref.id;
}

/**
 * Start an attack and run it as far as it goes without a decision.
 *
 * @param {Object} state
 * @param {Object} spec `{uid, weapon, targets, areaHexes?, free?, noCrit?, viaCard?}`
 */
export function start(state, spec) {
  const attacker = State.unit(state, spec.uid);
  if (!state.attacks) state.attacks = [];
  state.attackSeq = (state.attackSeq || 0) + 1;
  state.attacks.push({
    id: state.attackSeq,
    uid: spec.uid,
    side: attacker.side,
    weapon: JSON.parse(JSON.stringify(spec.weapon)),
    targets: spec.targets.map(function (r) { return { kind: r.kind, id: r.id }; }),
    areaHexes: spec.areaHexes || null,
    free: Boolean(spec.free),
    noCrit: Boolean(spec.noCrit),
    viaCard: spec.viaCard || null,
    step: 'pre',
    strengthBonus: 0,
    accuracyBonus: 0,
    damageBonus: 0,
    /** Responses already used in each window, by step: a single trigger takes each ability once. */
    used: {},
    reduce: {},
    saved: {},
    asked: {},
    results: [],
    ti: 0,
    faces: null,
    rolls: null,
    rerolls: null,
    crits: 0,
    critFrom: combat.critFromFor(state, attacker),
    dice: 0
  });
  // activation-scoped bonuses for this unit's attacks: +damage on every attack, +strength on the next one only
  const act = state.activation;
  const a = state.attacks[state.attacks.length - 1];
  if (act && act.uid === spec.uid && act.mods) {
    a.damageBonus += act.mods.damage || 0;
    if (act.mods.nextStrength) {
      a.strengthBonus += act.mods.nextStrength;
      act.mods.nextStrength = 0;
    }
  }
  run(state);
}

/** The accuracy shift on one target of an attack: the combat shift plus anything a response added to this attack. */
function shiftOf(state, a, attacker, h) {
  return combat.accuracyShift(state, attacker, a.weapon, h) + (a.accuracyBonus || 0);
}

/** Provisional hits per target, so a player deciding after the roll can see what is coming. */
export function computePreview(state, a) {
  const attacker = state.units[a.uid];
  if (!attacker || !a.faces) return;
  a.preview = livingTargets(state, a).map(function (r) {
    const shift = shiftOf(state, a, attacker, combat.targetHex(state, r));
    let hits = 0;
    for (const f of a.faces) if (combat.isHit(f, shift, state.rules.combat, a.critFrom)) hits++;
    return { ref: r, hits: hits };
  });
}

/** Run the attack on top of the stack until it needs a decision or the stack is empty. */
export function run(state) {
  let guard = 0;
  while (!state.pending) {
    const a = current(state);
    if (!a) return;
    if (++guard > 200) throw new Error('Attack sequence did not settle');
    step(state, a);
  }
}

function advance(a) {
  a.step = STEPS[STEPS.indexOf(a.step) + 1];
}

function livingTargets(state, a) {
  return a.targets.filter(function (r) { return Boolean(combat.targetHex(state, r)); });
}

function step(state, a) {
  const attacker = state.units[a.uid];
  // An attacker destroyed mid-sequence (by a collision, a response, or its own card) stops attacking.
  if (!attacker || !attacker.alive) {
    if (a.step !== 'finish') a.step = 'finish';
  }
  const w = a.weapon;

  if (WINDOW_OF[a.step]) {
    const pair = WINDOW_OF[a.step];
    if (pair[0] === 'afterRoll') computePreview(state, a);
    if (offerWindow(state, a, pair[0], pair[1])) return;
    advance(a);
    return;
  }

  switch (a.step) {
    case 'pre':
      weaponEffects(state, a, 'beforeRoll');
      advance(a);
      return;

    case 'roll': {
      const targets = livingTargets(state, a);
      if (!targets.length) {
        a.step = 'finish';
        return;
      }
      a.dice = Math.max(0, combat.strengthOf(state, attacker, w, undefined, targets) + a.strengthBonus);
      a.dice = Math.min(a.dice, 60);
      const r = Rng.rollN(state.rng, a.dice, state.rules.combat.dieSides);
      state.rng = r.state;
      a.rolls = r.value.slice();
      a.faces = r.value.slice();
      advance(a);
      return;
    }

    case 'post_roll':
      weaponEffects(state, a, 'afterRoll');
      computePreview(state, a);
      // Upgrade removal granted for this activation's attacks (an ability) or by a response card.
      if (state.activation && state.activation.uid === a.uid && state.activation.mods.stripOnAttack) {
        for (const r of livingTargets(state, a)) stripUpgrade(state, r, state.activation.mods.stripOnAttack);
      }
      advance(a);
      return;

    case 'disarm': {
      // Disarm resolves after the attacker's after-roll responses: reroll every hit, no crit effects, then it is spent.
      const di = attacker.statuses.indexOf('disarm');
      if (di !== -1) {
        attacker.statuses.splice(di, 1);
        a.disarmed = true;
        // a die is rerolled when it hits any target (on an area attack the targets can differ in accuracy)
        const shifts = livingTargets(state, a).map(function (r) { return shiftOf(state, a, attacker, combat.targetHex(state, r)); });
        if (!shifts.length) shifts.push(0);
        const again = [];
        for (let i = 0; i < a.faces.length; i++) {
          const f = a.faces[i];
          if (shifts.some(function (sh) { return combat.isHit(f, sh, state.rules.combat, a.critFrom); })) {
            const r = Rng.roll(state.rng, state.rules.combat.dieSides);
            state.rng = r.state;
            a.faces[i] = r.value;
          }
          again.push(a.faces[i]);
        }
        a.rerolls = again;
      }
      advance(a);
      return;
    }

    case 'crits': {
      a.crits = 0;
      if (!a.disarmed && !a.noCrit) {
        for (const f of a.faces) if (f >= a.critFrom) a.crits++;
      }
      a.critFired = a.crits >= ((w.crit && w.crit.needs) || 1) && Boolean(w.crit);
      a.critDamage = 0;
      a.critRolls = null;
      if (a.critFired) {
        const c = w.crit;
        if (c.dice) {
          const r = Rng.rollN(state.rng, c.dice, state.rules.combat.dieSides);
          state.rng = r.state;
          a.critRolls = r.value;
        }
        if (c.damage) a.critDamage += c.damage;
        if (c.damagePerCrit) a.critDamage += Math.min(c.max || Infinity, c.damagePerCrit * a.crits);
        // +1 damage per Upgrade on the attacker (of one kind, or of any kind), up to a maximum
        if (c.damagePerUpgrade) {
          const count = c.damagePerUpgrade === 'any' ? attacker.upgrades.length : State.upgradeCount(attacker, c.damagePerUpgrade);
          a.critDamage += Math.min(c.max || Infinity, count);
        }
        if (c.upgrade && !c.afterDamage) gainUpgrade(state, attacker, c.upgrade);
        // non-combat damage to each enemy next to one of the attacker's Remote Weapon Systems
        if (c.damageNearRemote) damageNearRemotes(state, attacker, c.damageNearRemote);
      }
      // Per-target hits, each with its own accuracy (terrain, height): one roll, counted per target.
      a.results = a.targets.map(function (ref) {
        const h = combat.targetHex(state, ref);
        if (!h) return { ref: ref, hits: 0, damage: 0, destroyed: false, gone: true };
        const shift = shiftOf(state, a, attacker, h);
        let hits = 0;
        for (const f of a.faces) if (combat.isHit(f, shift, state.rules.combat, a.critFrom)) hits++;
        if (a.critRolls) for (const f of a.critRolls) if (combat.isHit(f, shift, state.rules.combat, a.critFrom)) hits++;
        return { ref: ref, hits: hits, shift: shift, damage: 0, destroyed: false };
      });
      // Critical hit effects resolve before damage (rulebook 2026-10-30, attack steps 7 and 8), so a Fracture from a
      // crit already counts against this attack's damage.
      if (a.critFired && w.crit.status && !w.crit.afterDamage) {
        for (const res of a.results) {
          if (res.gone || res.ref.kind !== 'unit' || res.hits <= 0) continue;
          if (combat.applyStatus(state, res.ref.id, w.crit.status)) res.status = w.crit.status;
        }
      }
      a.ti = 0;
      advance(a);
      return;
    }

    case 'damage': {
      if (a.ti >= a.results.length) {
        advance(a);
        return;
      }
      const res = a.results[a.ti];
      if (res.gone || res.done) {
        a.ti++;
        return;
      }
      const ref = res.ref;
      const total = res.hits > 0 ? Math.max(0, res.hits + a.critDamage + a.damageBonus - (a.reduce[refKey(ref)] || 0) - auraReduction(state, ref)) : 0;
      if (ref.kind === 'unit' && total > 0) {
        const t = state.units[ref.id];
        const would = combat.previewDamage(state, t, total, true);
        if (would >= t.hp && !a.asked[refKey(ref)]) {
          a.asked[refKey(ref)] = true;
          if (offerDefeatWindow(state, a, t)) return;
        }
      }
      const dealt = total > 0
        ? combat.dealDamage(state, ref, total, a.side, true, a.saved[refKey(ref)] ? { floorHp: 1 } : undefined)
        : { damage: 0, destroyed: false };
      res.damage = dealt.damage;
      res.destroyed = dealt.destroyed;
      if (dealt.absorbed) res.absorbed = dealt.absorbed;
      if (dealt.fractured) res.fractured = true;
      res.done = true;
      a.ti++;
      // a saved unit's response (move, then attack) resolves before the next target
      if (a.saved[refKey(ref)] && !a.savedHandled) {
        a.savedHandled = true;
        const t = state.units[ref.id];
        if (t && t.alive) {
          const plan = a.saved[refKey(ref)];
          state.pending = { kind: 'react_move', uid: t.uid, n: plan.move || 0, wid: plan.attackWid || null, aid: a.id };
        }
      }
      return;
    }

    case 'post_damage':
      weaponEffects(state, a, 'afterDamage');
      // critical effects marked "after combat damage": a status on each target hit, an Upgrade for the attacker
      if (a.critFired && w.crit.afterDamage) {
        if (w.crit.status) {
          for (const res of a.results) {
            if (res.gone || res.ref.kind !== 'unit' || res.hits <= 0 || res.destroyed) continue;
            if (combat.applyStatus(state, res.ref.id, w.crit.status)) res.status = w.crit.status;
          }
        }
        if (w.crit.upgrade && attacker && attacker.alive) gainUpgrade(state, attacker, w.crit.upgrade);
      }
      if (a.critFired && w.crit.move && state.activation && state.activation.uid === a.uid) {
        state.activation.grants.push({ kind: 'move', n: w.crit.move, ignoreEngagement: Boolean(w.crit.ignoreEngagement) });
      }
      advance(a);
      return;

    case 'finish':
      finish(state, a);
      return;

    default:
      throw new Error('Unknown attack step ' + a.step);
  }
}

function weaponEffects(state, a, when) {
  const attacker = state.units[a.uid];
  for (const e of a.weapon.effects || []) {
    if (e.when !== when) continue;
    if (e.k === 'approach') {
      // the attacker Moves up to n toward the target, ignoring terrain penalties (one hex at a time)
      const t = livingTargets(state, a)[0];
      const h = t && combat.targetHex(state, t);
      if (h && attacker.hex && approachOptions(state, attacker, h).length) {
        state.pending = { kind: 'react_move', uid: attacker.uid, n: e.n || 1, toward: { q: h.q, r: h.r }, aid: a.id, side: attacker.side };
        return;
      }
      continue;
    }
    if (e.k === 'pull' || e.k === 'push') {
      // the attacking player chooses each step; several targets are moved one after another
      const ids = livingTargets(state, a).filter(function (r) { return r.kind === 'unit'; }).map(function (r) { return r.id; });
      while (ids.length && !state.pending) {
        const first = ids.shift();
        if (Displace.begin(state, attacker, first, e.n, e.k, null, ids.slice())) state.pending.queueN = e.n;
      }
      continue;
    }
    for (const ref of livingTargets(state, a)) {
      if (e.k === 'shieldsOff' && ref.kind === 'unit') {
        const t = state.units[ref.id];
        t.shieldSpent = State.upgradeCount(t, 'shield') * state.rules.upgrades.shieldAbsorb;
        state.log.push({ t: 'shields_off', uid: t.uid });
      } else if (e.k === 'captureNear') {
        captureNear(state, a.side, combat.targetHex(state, ref));
      } else if (e.k === 'stripUpgrade') {
        stripUpgrade(state, ref, e.n || 1);
      }
    }
    if (e.k === 'grantDash' && when === 'afterDamage' && state.activation && state.activation.uid === a.uid) {
      state.activation.grants.push({ kind: 'dash' });
    }
  }
}

/** Take control of one Objective on or next to a hex, at once, whatever its state (rulebook: Capture). */
export function captureNear(state, side, h) {
  if (!h) return;
  for (const oid of state.objectiveOrder) {
    const o = state.objectives[oid];
    if (Hex.distance(o.hex, h) <= 1 && o.controlledBy !== side) {
      const was = o.controlledBy;
      o.controlledBy = side;
      state.log.push({ t: 'objective_control', oid: o.oid, side: side, was: was, captured: true, notice: true });
      return;
    }
  }
}

/** Destroy up to n Upgrades on a unit (the first ones it holds). */
export function stripUpgrade(state, ref, n) {
  if (ref.kind !== 'unit') return;
  const t = state.units[ref.id];
  if (!t) return;
  for (let i = 0; i < n && t.upgrades.length; i++) {
    const gone = t.upgrades.shift();
    state.log.push({ t: 'upgrade_destroyed', uid: t.uid, upgrade: gone, notice: true });
  }
}

function defenderSide(a) {
  return a.side === 0 ? 1 : 0;
}

/** Gain an Upgrade (from a critical effect or a card). */
export function gainUpgrade(state, u, kind) {
  u.upgrades.push(kind);
  state.log.push({ t: 'pickup', uid: u.uid, kind: 'upgrade', upgrade: kind, notice: true });
}

/** Deal n non-combat damage to every enemy next to any of this unit's deployed Remote Weapon Systems. */
export function damageNearRemotes(state, u, n) {
  const hit = {};
  for (const r of State.remotesOf(state, u.uid)) {
    if (!r.hex) continue;
    for (const h of Hex.neighbours(r.hex)) {
      for (const ref of enemyRefsAt(state, u.side, h)) {
        if (hit[refKey(ref)]) continue;
        hit[refKey(ref)] = true;
        combat.dealDamage(state, ref, n, u.side, false);
      }
    }
  }
}

/** Enemy pieces of `side` on a hex: a unit, a Garrison, an RWS. */
export function enemyRefsAt(state, side, h) {
  const out = [];
  const t = State.unitAt(state, h);
  if (t && t.side !== side) out.push({ kind: 'unit', id: t.uid });
  const g = State.garrisonAt(state, h);
  if (g && g.side !== null && g.side !== side) out.push({ kind: 'garrison', id: g.gid });
  const r = State.remoteAt(state, h);
  if (r && r.side !== side) out.push({ kind: 'remote', id: r.rid });
  return out;
}

/** Damage prevented by allied RWS auras next to a unit target ("allies adjacent to this are dealt Damage -1"). */
function auraReduction(state, ref) {
  if (ref.kind !== 'unit') return 0;
  const t = state.units[ref.id];
  if (!t || !t.hex) return 0;
  let n = 0;
  for (const r of State.deployedRemotes(state, t.side)) {
    if (Hex.distance(r.hex, t.hex) === 1) n += State.remoteAura(r, 'auraReduceDamage');
  }
  return n;
}

/** Hexes one step closer to `toward`, ignoring terrain penalties, where the unit may end a move. */
export function approachOptions(state, u, toward) {
  const d = Hex.distance(u.hex, toward);
  const out = [];
  for (const h of Hex.neighbours(u.hex)) {
    if (Hex.distance(h, toward) >= d) continue;
    const cell = State.cellAt(state, h);
    if (!cell || state.rules.terrain[cell.terrain].impassable) continue;
    if (State.unitAt(state, h) || State.garrisonAt(state, h) || State.remoteAt(state, h) || State.baseAt(state, h)) continue;
    out.push({ to: { q: h.q, r: h.r }, path: [{ q: u.hex.q, r: u.hex.r }, { q: h.q, r: h.r }], cost: 1 });
  }
  return out;
}

/**
 * A unit with the ongoing `noEnemyResponses` stops its enemies using Response abilities and Response cards while it
 * is attacking or being attacked.
 */
export function responsesBlocked(state, a, side) {
  const ids = [a.uid].concat(a.targets.filter(function (r) { return r.kind === 'unit'; }).map(function (r) { return r.id; }));
  for (const id of ids) {
    const u = state.units[id];
    if (!u || u.side === side) continue;
    if (Effects.hasOngoingEffect(state, u, 'noEnemyResponses')) return true;
  }
  return false;
}

/** Own units under this attack, alive. */
function defendingUnits(state, a, side) {
  return a.targets.filter(function (r) {
    return r.kind === 'unit' && state.units[r.id] && state.units[r.id].side === side && state.units[r.id].alive;
  }).map(function (r) { return state.units[r.id]; });
}

function isDefending(a, uid) {
  return a.targets.some(function (r) { return r.kind === 'unit' && r.id === uid; });
}

function within(state, from, to, range, los, side, targetUid) {
  if (!from || !from.hex || !to) return false;
  if (Hex.distance(from.hex, to) > range) return false;
  if (los && !Los.hasLos(state, from.hex, to, { side: side, targetUid: targetUid || null })) return false;
  return true;
}

/** Other allied units within a range of a unit (with Line of Sight). */
function alliesNear(state, u, range, los) {
  return State.livingUnits(state, u.side).filter(function (o) {
    return o.uid !== u.uid && o.hex && within(state, u, o.hex, range, los, u.side, o.uid);
  });
}

/** Does an attack-time condition hold? `src` is the unit whose response it is (the attacker for an attacker's card). */
function attackCondition(state, a, cond, src) {
  if (!cond) return true;
  const attacker = state.units[a.uid];
  if (cond.attackerNearAlly !== undefined && (!attacker || !alliesNear(state, attacker, cond.attackerNearAlly, true).length)) return false;
  if (cond.alliesInRange !== undefined && (!src || alliesNear(state, src, cond.alliesInRange, true).length < 1)) return false;
  if (cond.ownUpgrade !== undefined && (!src || State.upgradeCount(src, cond.ownUpgrade) < 1)) return false;
  if (cond.damagedEnemies !== undefined) {
    const n = (a.results || []).filter(function (r) { return r.damage > 0; }).length;
    if (n < cond.damagedEnemies) return false;
  }
  if (cond.targetNearOwnRemote && !targetsNearRemote(state, a, src).length) return false;
  if (cond.unitTarget && !livingTargets(state, a).some(function (r) { return r.kind === 'unit'; })) return false;
  if (cond.unitTargets && !a.targets.some(function (r) { return r.kind === 'unit' && state.units[r.id]; })) return false;
  return true;
}

/** Unit targets of the attack standing next to one of `src`'s deployed RWS. */
function targetsNearRemote(state, a, src) {
  if (!src) return [];
  const mine = State.remotesOf(state, src.uid).filter(function (r) { return r.hex; });
  return livingTargets(state, a).filter(function (ref) {
    if (ref.kind !== 'unit') return false;
    const h = combat.targetHex(state, ref);
    return mine.some(function (r) { return Hex.distance(r.hex, h) === 1; });
  });
}

/** How many of `side`'s RWS stand next to the attack's best-placed target. */
function remotesAdjTarget(state, a, side) {
  let best = 0;
  for (const ref of livingTargets(state, a)) {
    const h = combat.targetHex(state, ref);
    const n = State.deployedRemotes(state, side).filter(function (r) { return Hex.distance(r.hex, h) === 1; }).length;
    if (n > best) best = n;
  }
  return best;
}

/** Could this defender strike back at the attacker with any weapon? */
function canCounter(state, d, a) {
  const attacker = state.units[a.uid];
  if (!attacker || !attacker.alive || !d.alive || !d.hex) return false;
  return combat.weaponsOf(d).some(function (w) {
    return combat.targetsFor(state, d.uid, w).some(function (t) { return t.kind === 'unit' && t.id === a.uid; });
  });
}

/**
 * The options one response (a card or a unit's ability) offers in this window: the bare play, one per defender it can
 * cover ("a defender"), or one per Challenge pairing. `base` carries `side` and either `cid` or `uid` + `aid`.
 */
function responseOptions(state, a, x, role, side, base, src) {
  const out = [];
  const ch = x.effects.find(function (z) { return z.k === 'challenge'; });
  if (ch) {
    // the Challenger: the ability's own unit, or for a card any allied unit; it must not be defending already
    const challengers = src ? [src] : State.livingUnits(state, side).filter(function (o) { return o.hex; });
    for (const c of challengers) {
      if (isDefending(a, c.uid) || !c.hex) continue;
      for (const d of defendingUnits(state, a, side)) {
        if (d.uid === c.uid || !within(state, c, d.hex, ch.range || 2, ch.los !== false, side, d.uid)) continue;
        out.push(Object.assign({}, base, { uid: c.uid, targetUid: d.uid }));
      }
    }
    return out;
  }
  if (x.pick === 'one' && role === 'defender') {
    for (const d of defendingUnits(state, a, side)) {
      if (x.pickWhen === 'lessVp' && !(state.units[a.uid] && d.vp < state.units[a.uid].vp)) continue;
      if (x.pickWhen === 'damaged') {
        const res = (a.results || []).find(function (r) { return r.ref.kind === 'unit' && r.ref.id === d.uid; });
        if (!res || !(res.damage > 0)) continue;
      }
      if (x.pickWhen === 'counter' && !canCounter(state, d, a)) continue;
      out.push(Object.assign({}, base, { targetUid: d.uid }));
    }
    return out;
  }
  out.push(base);
  return out;
}

/** Cards and unit abilities a side could use in this window, as response actions. Empty when the window is closed to it. */
export function windowOptions(state, a, window, role) {
  const side = role === 'attacker' ? a.side : defenderSide(a);
  if (responsesBlocked(state, a, side)) return [];
  const used = a.used[a.step] || [];
  const out = [];
  if (tacticsFree(state, side)) {
    for (const c of state.players[side].tactics.hand) {
      if (c.timing !== 'response' || c.window !== window || c.role !== role) continue;
      if (!responseRequirementMet(state, a, c, role)) continue;
      if (!attackCondition(state, a, c.attackWhen, role === 'attacker' ? state.units[a.uid] : null)) continue;
      for (const o of responseOptions(state, a, c, role, side, { type: 'respond', side: side, cid: c.cid }, null)) out.push(o);
    }
  }
  // units' own Response abilities keyed to this window
  for (const u of State.livingUnits(state, side)) {
    if (!u.hex) continue;
    for (const ab of Effects.abilitiesOf(u)) {
      if (ab.timing !== 'response' || ab.window !== window || ab.role !== role) continue;
      if (used.indexOf(u.uid + ':' + ab.aid) !== -1) continue;
      if (ab.energy && u.energy < ab.energy) continue;
      if (!Effects.conditionHolds(state, u, ab.when)) continue;
      if (role === 'attacker') {
        const attacker = state.units[a.uid];
        const self = a.uid === u.uid;
        if (ab.who === 'self' && !self) continue;
        if (ab.who === 'other' && self) continue;
        if (!self && !within(state, u, attacker && attacker.hex, ab.range || 0, ab.los !== false, side, attacker && attacker.uid)) continue;
      }
      if (!attackCondition(state, a, ab.attackWhen, u)) continue;
      for (const o of responseOptions(state, a, ab, role, side, { type: 'respond', side: side, uid: u.uid, aid: ab.aid }, u)) out.push(o);
    }
  }
  return out;
}

function responseRequirementMet(state, a, c, role) {
  if (c.requires && c.requires.defId) {
    if (role === 'attacker') return state.units[a.uid] && state.units[a.uid].defId === c.requires.defId;
    return a.targets.some(function (r) { return r.kind === 'unit' && state.units[r.id] && state.units[r.id].defId === c.requires.defId; });
  }
  if (role === 'defender') return a.targets.some(function (r) { return r.kind === 'unit'; });
  return true;
}

/** One Tactics card per player per activation (rulebook: "up to one Tactics card per activation"). */
export function tacticsFree(state, side) {
  const act = state.activation;
  if (!act) return false;
  if (act.tacticsBy && act.tacticsBy[side]) return false;
  if (side === act.side && act.slots.tactics) return false;
  return true;
}

function offerWindow(state, a, window, role) {
  if (!state.units[a.uid] || !state.units[a.uid].alive) return false;
  if (!windowOptions(state, a, window, role).length) return false;
  state.pending = { kind: 'window', window: window, role: role, side: role === 'attacker' ? a.side : defenderSide(a), aid: a.id };
  return true;
}

/**
 * Could this unit's owner answer its defeat outside an attack right now? Only between attacks, so the decision never
 * interleaves with an attack in progress.
 * @param {Object} state
 * @param {Object} t the unit
 * @returns {boolean}
 */
export function defeatSavable(state, t) {
  if (!state.activation || (state.attacks && state.attacks.length)) return false;
  if (!tacticsFree(state, t.side)) return false;
  return state.players[t.side].tactics.hand.some(function (c) {
    return c.timing === 'response' && c.window === 'wouldBeDefeated' && (!c.requires || !c.requires.defId || c.requires.defId === t.defId);
  });
}

function offerDefeatWindow(state, a, t) {
  const side = t.side;
  if (!tacticsFree(state, side)) return false;
  if (responsesBlocked(state, a, side)) return false;
  const cards = state.players[side].tactics.hand.filter(function (c) {
    return c.timing === 'response' && c.window === 'wouldBeDefeated' && (!c.requires || !c.requires.defId || c.requires.defId === t.defId);
  });
  if (!cards.length) return false;
  state.pending = { kind: 'window', window: 'wouldBeDefeated', role: 'defender', side: side, aid: a.id, uid: t.uid };
  return true;
}

/**
 * "After an enemy ends its movement within range of this unit": the cards the mover's opponent could answer with, one
 * option per card and unit that can make the attack.
 */
export function enemyMovedOptions(state, side, moverUid) {
  const mover = state.units[moverUid];
  const out = [];
  if (!mover || !mover.alive || !mover.hex || !tacticsFree(state, side)) return out;
  for (const c of state.players[side].tactics.hand) {
    if (c.timing !== 'response' || c.window !== 'enemyMoved') continue;
    const e = c.effects.find(function (x) { return x.k === 'reactAttack'; });
    if (!e) continue;
    for (const u of State.livingUnits(state, side)) {
      if (!u.hex || (c.requires && c.requires.defId && c.requires.defId !== u.defId)) continue;
      if (!within(state, u, mover.hex, e.range || 3, true, side, mover.uid)) continue;
      const w = combat.weapon(u, e.wid);
      if (!w || !combat.targetsFor(state, u.uid, w).some(function (t) { return t.kind === 'unit' && t.id === mover.uid; })) continue;
      out.push({ type: 'respond', side: side, cid: c.cid, uid: u.uid, targetUid: mover.uid });
    }
  }
  return out;
}

/** Options for the pending decision. */
export function pendingOptions(state) {
  const p = state.pending;
  const a = current(state);
  if (!p) return [];
  if (p.kind === 'displace') return Displace.options(state);
  if (p.kind === 'trigger') return Effects.triggerOptions(state);
  if (p.kind === 'choose') return Effects.chooseOptions(state);
  if (p.kind === 'window') {
    let opts;
    if (p.window === 'wouldBeDefeated') {
      const t = state.units[p.uid];
      opts = state.players[p.side].tactics.hand
        .filter(function (c) { return c.timing === 'response' && c.window === 'wouldBeDefeated' && (!c.requires || !c.requires.defId || c.requires.defId === t.defId); })
        .map(function (c) { return { type: 'respond', side: p.side, cid: c.cid }; });
    } else if (p.window === 'enemyMoved') {
      opts = enemyMovedOptions(state, p.side, p.mover);
    } else {
      opts = a ? windowOptions(state, a, p.window, p.role) : [];
    }
    return opts.concat([{ type: 'pass', side: p.side }]);
  }
  if (p.kind === 'react_move') {
    const u = state.units[p.uid];
    let moves = [];
    if (u && u.alive && u.hex) {
      if (p.toward) moves = approachOptions(state, u, p.toward);
      else if (p.n > 0) moves = combat.reactMoves(state, p.uid, p.n);
    }
    return moves.map(function (m) { return { type: 'react_move', side: u.side, uid: p.uid, to: m.to, path: m.path, cost: m.cost }; })
      .concat([{ type: 'pass', side: u ? u.side : 0 }]);
  }
  if (p.kind === 'react_attack') {
    const u = state.units[p.uid];
    const out = [];
    if (u && u.alive && u.hex) {
      const weapons = p.wid ? [combat.weapon(u, p.wid)].filter(Boolean) : combat.weaponsOf(u);
      for (const w of weapons) {
        for (const t of combat.targetsFor(state, u.uid, w)) {
          if (p.only && !(t.kind === p.only.kind && t.id === p.only.id)) continue;
          out.push({ type: 'react_attack', side: u.side, uid: u.uid, wid: w.wid, target: t });
        }
      }
    }
    return out.concat([{ type: 'pass', side: u ? u.side : 0 }]);
  }
  return [];
}

/**
 * Apply a decision on the pending prompt, then resume. Mutates `state` (a clone the caller owns).
 * @param {Object} state
 * @param {Object} action
 */
export function decide(state, action) {
  const p = state.pending;
  const a = current(state);
  state.pending = null;

  if (p.kind === 'window' && p.outside) {
    decideOutsideSave(state, action, p);
    return;
  }
  if (p.kind === 'window' && p.window === 'enemyMoved') {
    if (action.type === 'respond') {
      const c = spendCard(state, p.side, action.cid, action.uid);
      const e = c.effects.find(function (x) { return x.k === 'reactAttack'; });
      const u = state.units[action.uid];
      // an out-of-turn attack at a stated Timeline cost, paid on the attacker's own token
      if (e.tl) payTimeline(state, u.uid, e.tl);
      start(state, { uid: u.uid, weapon: combat.weapon(u, e.wid), targets: [{ kind: 'unit', id: action.targetUid }], free: true });
      return;
    }
    run(state);
    return;
  }
  if (p.kind === 'window') {
    if (action.type === 'respond') {
      if (p.window === 'wouldBeDefeated') playDefeatSave(state, a, action, p);
      else playResponse(state, a, action, p);
    } else if (a && p.window !== 'wouldBeDefeated') {
      // a pass closes the window; a response leaves it open for whatever else may answer the same trigger
      advance(a);
    }
  } else if (p.kind === 'react_move') {
    if (action.type === 'react_move') {
      const u = state.units[action.uid];
      const from = { q: u.hex.q, r: u.hex.r };
      u.hex = { q: action.to.q, r: action.to.r };
      state.log.push({ t: 'move', uid: u.uid, from: from, to: { q: u.hex.q, r: u.hex.r }, path: action.path, cost: action.cost });
      State.collectPickup(state, u);
      if (state.activation && state.activation.uid === u.uid) state.activation.moved = true;
      Effects.afterMovement(state, u.uid, action.path || [from, { q: u.hex.q, r: u.hex.r }], combat);
    } else {
      state.trail = { uid: p.uid, hexes: [] };
    }
    if (p.wid) state.pending = { kind: 'react_attack', uid: p.uid, wid: p.wid, aid: p.aid, cont: p.cont };
    else if (p.cont && !state.pending) Effects.resumeEffects(state, p.cont, combat);
    else if (p.cont) state.deferred.push({ kind: 'resume', cont: p.cont });
  } else if (p.kind === 'react_attack') {
    // a save outside an attack: the rest of the ability that dealt the damage resolves first, then the strike back
    if (p.cont) Effects.resumeEffects(state, p.cont, combat);
    if (action.type === 'react_attack' && !state.pending) {
      const u = state.units[action.uid];
      const w = combat.weapon(u, action.wid);
      if (p.tlMod !== undefined) payTimeline(state, u.uid, Math.max(0, w.tlCost + p.tlMod));
      start(state, { uid: u.uid, weapon: w, targets: [action.target], free: true });
      return;
    }
  }
  run(state);
}

/** Move a unit's Timeline token forward outside its own Primary Action (an out-of-turn attack's cost, a delay). */
export function payTimeline(state, uid, n) {
  if (!n || n <= 0) return;
  if (!Timeline.locate(state.timeline, uid)) return;
  const landed = Timeline.push(state.timeline, uid, n, state.rules);
  state.log.push({ t: 'timeline', uid: uid, cost: n, round: landed });
}

/** Take a response card from a hand into the discard and record it as that player's card for this activation. */
function spendCard(state, side, cid, uid) {
  const hand = state.players[side].tactics.hand;
  const c = hand.splice(hand.findIndex(function (x) { return x.cid === cid; }), 1)[0];
  state.players[side].tactics.discard.push(c);
  if (!state.activation.tacticsBy) state.activation.tacticsBy = {};
  state.activation.tacticsBy[side] = true;
  if (side === state.activation.side) state.activation.slots.tactics = true;
  state.log.push({ t: 'tactics', cid: c.cid, side: side, uid: uid || null, notice: true });
  return c;
}

/** The would-be-defeated decision outside an attack: survive at 1 HP and react, or be defeated. */
function decideOutsideSave(state, action, p) {
  const u = state.units[p.uid];
  if (action.type !== 'respond') {
    u.hp = 0;
    combat.destroyUnit(state, u, p.by);
    Effects.resumeEffects(state, p.cont, combat);
    return;
  }
  const c = spendCard(state, p.side, action.cid, u.uid);
  state.log.push({ t: 'survived', uid: u.uid, notice: true });
  const e = c.effects.find(function (x) { return x.k === 'surviveDefeat'; }) || {};
  if (e.move || e.attackWid) {
    state.pending = { kind: 'react_move', uid: u.uid, n: e.move || 0, wid: e.attackWid || null, aid: null, cont: p.cont };
  } else {
    Effects.resumeEffects(state, p.cont, combat);
  }
}

function playDefeatSave(state, a, action, p) {
  const c = spendCard(state, action.side, action.cid, p.uid);
  for (const e of c.effects) {
    if (e.k === 'surviveDefeat') a.saved['unit:' + p.uid] = { move: e.move || 0, attackWid: e.attackWid || null };
  }
}

/** Use a response in an attack window: a card from the hand, or a unit's own Response ability. */
function playResponse(state, a, action, p) {
  const side = action.side;
  let x;
  let src = null;
  if (action.cid) {
    x = spendCard(state, side, action.cid, p.role === 'attacker' ? a.uid : (action.targetUid || null));
    src = p.role === 'attacker' ? state.units[a.uid] : null;
  } else {
    src = state.units[action.uid];
    x = Effects.ability(src, action.aid);
    if (x.energy) src.energy -= x.energy;
    if (!a.used[a.step]) a.used[a.step] = [];
    a.used[a.step].push(src.uid + ':' + x.aid);
    state.log.push({
      t: 'ability', uid: src.uid, aid: x.aid, target: action.targetUid || null,
      applied: x.effects.map(function (e) { return e.k; }), sound: 'ability', notice: true
    });
  }
  for (const e of x.effects) {
    if (state.pending) break;
    attackEffect(state, a, e, action, side, src);
  }
}

/** Reroll up to `n` dice (all when n is absent) that miss every living target; returns how many were rerolled. */
function rerollMisses(state, a, n) {
  const attacker = state.units[a.uid];
  const shifts = livingTargets(state, a).map(function (r) { return shiftOf(state, a, attacker, combat.targetHex(state, r)); });
  if (!shifts.length) return 0;
  const misses = [];
  for (let i = 0; i < a.faces.length; i++) {
    const f = a.faces[i];
    if (!shifts.some(function (sh) { return combat.isHit(f, sh, state.rules.combat, a.critFrom); })) misses.push(i);
  }
  misses.sort(function (x, y) { return a.faces[x] - a.faces[y] || x - y; });
  const take = misses.slice(0, n === undefined || n === null ? misses.length : n);
  const before = a.faces.slice();
  for (const i of take) {
    const r = Rng.roll(state.rng, state.rules.combat.dieSides);
    state.rng = r.state;
    a.faces[i] = r.value;
  }
  if (take.length) state.log.push({ t: 'reroll', uid: a.uid, before: before, after: a.faces.slice(), dice: take });
  computePreview(state, a);
  return take.length;
}

/** Response effects that act on the attack in progress. Exported so their list can be checked against the describer. */
export const RESPONSE_EFFECTS = Object.freeze([
  'attackStrength', 'attackAccuracy', 'attackDamage', 'reduceDamage', 'setCrit', 'rerollMisses', 'pushTarget',
  'delayTargets', 'slowTargetsNearRemote', 'draw', 'energyTo', 'challenge', 'counterAttack', 'stripTargetUpgrade',
  'stripAttackerUpgrade', 'damageAttackerAndTargets', 'surviveDefeat', 'reactAttack'
]);

function attackEffect(state, a, e, action, side, src) {
  const attacker = state.units[a.uid];
  switch (e.k) {
    case 'attackStrength': {
      let n = e.n;
      if (e.per === 'ownUpgrade') n = e.n * (src ? State.upgradeCount(src, e.kind) : 0);
      else if (e.per === 'alliesInRange') n = e.n * (src ? alliesNear(state, src, e.range, true).length : 0);
      else if (e.per === 'remotesAdjTarget') n = e.n * remotesAdjTarget(state, a, a.side);
      a.strengthBonus += n;
      break;
    }
    case 'attackAccuracy': a.accuracyBonus = (a.accuracyBonus || 0) + e.n; break;
    case 'attackDamage': a.damageBonus += e.n; break;
    case 'reduceDamage': {
      for (const r of a.targets) {
        if (r.kind !== 'unit' || !state.units[r.id] || state.units[r.id].side !== side) continue;
        if (action.targetUid && r.id !== action.targetUid) continue;
        let n = e.n;
        if (e.perRemote) {
          const t = state.units[r.id];
          n += e.perRemote * State.deployedRemotes(state, side).filter(function (rw) {
            return t.hex && Hex.distance(rw.hex, t.hex) <= (e.range || 2) && Los.hasLos(state, t.hex, rw.hex, { side: side, targetUid: null });
          }).length;
        }
        a.reduce[refKey(r)] = (a.reduce[refKey(r)] || 0) + n;
      }
      break;
    }
    case 'setCrit': {
      // the lowest die that is not already a critical becomes a 10
      let idx = -1;
      for (let i = 0; i < a.faces.length; i++) {
        if (a.faces[i] >= a.critFrom) continue;
        if (idx === -1 || a.faces[i] < a.faces[idx]) idx = i;
      }
      if (idx !== -1) {
        const before = a.faces.slice();
        a.faces[idx] = state.rules.combat.dieSides;
        state.log.push({ t: 'reroll', uid: a.uid, before: before, after: a.faces.slice(), dice: [idx], setCrit: true });
        computePreview(state, a);
      }
      break;
    }
    case 'rerollMisses': {
      const n = rerollMisses(state, a, e.n);
      if (e.drawIf && n >= e.drawIf) State.drawTactics(state, side, e.draw || 1);
      break;
    }
    case 'pushTarget': {
      const ids = livingTargets(state, a).filter(function (r) { return r.kind === 'unit'; }).map(function (r) { return r.id; });
      if (ids.length && src) {
        const first = ids.shift();
        if (Displace.begin(state, src, first, e.n, 'push', null, ids)) state.pending.queueN = e.n;
      }
      break;
    }
    case 'delayTargets':
      for (const r of a.targets) if (r.kind === 'unit' && state.units[r.id]) payTimeline(state, r.id, e.n);
      break;
    case 'slowTargetsNearRemote':
      for (const r of targetsNearRemote(state, a, src)) combat.applyStatus(state, r.id, 'slow');
      break;
    case 'draw':
      State.drawTactics(state, side, e.n);
      break;
    case 'energyTo':
      if (action.targetUid && state.units[action.targetUid]) state.units[action.targetUid].energy += e.n;
      break;
    case 'challenge': {
      // swap the Challenger with the defending ally; the Challenger becomes the target (rulebook, "Challenge")
      const c = state.units[action.uid];
      const d = state.units[action.targetUid];
      if (!c || !d || !c.hex || !d.hex) break;
      const ch = { q: c.hex.q, r: c.hex.r };
      c.hex = { q: d.hex.q, r: d.hex.r };
      d.hex = ch;
      for (const r of a.targets) if (r.kind === 'unit' && r.id === d.uid) r.id = c.uid;
      state.log.push({ t: 'swap', uid: c.uid, with: d.uid, from: ch, to: { q: c.hex.q, r: c.hex.r }, notice: true });
      break;
    }
    case 'counterAttack':
      if (action.targetUid && attacker && attacker.alive) {
        state.pending = { kind: 'react_attack', uid: action.targetUid, wid: null, only: { kind: 'unit', id: a.uid }, tlMod: e.tl || 0, aid: a.id };
      }
      break;
    case 'stripTargetUpgrade':
      for (const r of livingTargets(state, a)) stripUpgrade(state, r, e.n || 1);
      break;
    case 'stripAttackerUpgrade':
      stripUpgrade(state, { kind: 'unit', id: a.uid }, e.n || 1);
      break;
    case 'damageAttackerAndTargets':
      combat.dealDamage(state, { kind: 'unit', id: a.uid }, e.n, defenderSide(a), false);
      for (const r of a.targets) if (combat.targetHex(state, r)) combat.dealDamage(state, r, e.n, a.side, false);
      break;
    default:
      throw new Error('Unknown response effect: ' + e.k);
  }
}

function finish(state, a) {
  state.attacks.pop();
  const first = a.results[0] || { ref: a.targets[0], hits: 0, damage: 0, destroyed: false };
  const anyDestroyed = a.results.some(function (r) { return r.destroyed; });
  const outcome = {
    t: 'attack',
    uid: a.uid,
    wid: a.weapon.wid,
    viaCard: a.viaCard,
    target: first.ref,
    targets: a.targets,
    area: a.areaHexes,
    dice: a.dice,
    shift: first.shift || 0,
    rolls: a.rolls || [],
    rerolls: a.rerolls,
    critRolls: a.critRolls || null,
    hits: first.hits,
    crits: a.crits,
    critFired: Boolean(a.critFired),
    disarmed: Boolean(a.disarmed),
    damage: first.damage,
    destroyed: first.destroyed,
    absorbed: first.absorbed,
    fractured: first.fractured,
    status: first.status,
    results: a.results.map(function (r) { return { ref: r.ref, hits: r.hits, damage: r.damage, destroyed: r.destroyed, status: r.status || null }; }),
    sound: anyDestroyed ? 'destroy' : a.results.some(function (r) { return r.damage > 0; }) ? 'hit' : 'miss'
  };
  state.log.push(outcome);
  if (state.activation && state.activation.uid === a.uid) {
    if (!state.activation.attacked) state.activation.attacked = [];
    state.activation.attacked.push(a.weapon.wid);
  }

  for (const r of a.results) {
    if (r.ref.kind === 'unit' && r.damage > 0 && !r.destroyed) Effects.raise(state, r.ref.id, 'damaged', combat);
  }
  if (anyDestroyed) Effects.raise(state, a.uid, 'destroy', combat);

  // A crit that repeats the attack: once more at no Timeline cost, and the repeat cannot crit-repeat again.
  if (a.critFired && a.weapon.crit.repeat && !a.noCrit && state.units[a.uid] && state.units[a.uid].alive) {
    const still = a.targets.filter(function (r) { return Boolean(combat.targetHex(state, r)); });
    if (still.length) {
      start(state, { uid: a.uid, weapon: a.weapon, targets: still, free: true, noCrit: true });
    }
  }
}

/**
 * The area an area weapon covers when aimed in a direction, as board hexes.
 * @param {Object} state
 * @param {Object} u
 * @param {Object} w
 * @param {number} dir 0..5
 * @returns {Array<{q: number, r: number}>}
 */
export function areaHexes(state, u, w, dir) {
  return w.area.map(function (off) {
    const rot = Hex.rotate({ q: off[0], r: off[1] }, dir);
    return { q: u.hex.q + rot.q, r: u.hex.r + rot.r };
  }).filter(function (h) { return State.onBoard(state, h); });
}

/**
 * Every way to aim an area weapon: one option per direction that catches at least one enemy in line of sight (area
 * attacks ignore units and Garrisons for line of sight). An Engaged attacker must catch an enemy it is Engaged with.
 */
export function areaOptions(state, u, w) {
  const out = [];
  const engaged = state.rules.movement.engagedMustTargetEngaged ? State.engagedWith(state, u.side, u.hex) : [];
  for (let dir = 0; dir < 6; dir++) {
    const hexes = areaHexes(state, u, w, dir);
    const targets = [];
    for (const h of hexes) {
      const t = State.unitAt(state, h);
      const g = State.garrisonAt(state, h);
      const ref = t && t.side !== u.side ? { kind: 'unit', id: t.uid } : g && g.side !== null && g.side !== u.side ? { kind: 'garrison', id: g.gid } : null;
      if (!ref) continue;
      if (!w.ignoreLos && !Los.hasLos(state, u.hex, h, { side: u.side, targetUid: t ? t.uid : null, ignoreUnits: true })) continue;
      targets.push(ref);
    }
    if (!targets.length) continue;
    if (engaged.length && !targets.some(function (r) { return engaged.some(function (e) { return e.kind === r.kind && e.id === r.id; }); })) continue;
    out.push({ dir: dir, hexes: hexes, targets: targets });
  }
  return out;
}
