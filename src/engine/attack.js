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
    damageBonus: 0,
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
  run(state);
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
      const r = Rng.rollN(state.rng, a.dice, state.rules.combat.dieSides);
      state.rng = r.state;
      a.rolls = r.value.slice();
      a.faces = r.value.slice();
      advance(a);
      return;
    }

    case 'post_roll':
      weaponEffects(state, a, 'afterRoll');
      // provisional hits per target, so a player deciding after the roll can see what is coming
      a.preview = livingTargets(state, a).map(function (r) {
        const shift = combat.accuracyShift(state, attacker, w, combat.targetHex(state, r));
        let hits = 0;
        for (const f of a.faces) if (combat.isHit(f, shift, state.rules.combat, a.critFrom)) hits++;
        return { ref: r, hits: hits };
      });
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
        const shift = combat.accuracyShift(state, attacker, w, combat.targetHex(state, a.targets[0]) || attacker.hex);
        const again = [];
        for (let i = 0; i < a.faces.length; i++) {
          if (combat.isHit(a.faces[i], shift, state.rules.combat, a.critFrom)) {
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
      }
      // Per-target hits, each with its own accuracy (terrain, height): one roll, counted per target.
      a.results = a.targets.map(function (ref) {
        const h = combat.targetHex(state, ref);
        if (!h) return { ref: ref, hits: 0, damage: 0, destroyed: false, gone: true };
        const shift = combat.accuracyShift(state, attacker, w, h);
        let hits = 0;
        for (const f of a.faces) if (combat.isHit(f, shift, state.rules.combat, a.critFrom)) hits++;
        if (a.critRolls) for (const f of a.critRolls) if (combat.isHit(f, shift, state.rules.combat, a.critFrom)) hits++;
        return { ref: ref, hits: hits, shift: shift, damage: 0, destroyed: false };
      });
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
      const total = res.hits > 0 ? Math.max(0, res.hits + a.critDamage + a.damageBonus - (a.reduce[refKey(ref)] || 0)) : 0;
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
      // A crit's status lands after damage, and only on something still standing.
      if (a.critFired && w.crit.status && !dealt.destroyed && ref.kind === 'unit' && res.hits > 0) {
        if (combat.applyStatus(state, ref.id, w.crit.status)) res.status = w.crit.status;
      }
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

/** Cards a side could play in this window, as response actions. Empty when the window is closed to it. */
export function windowOptions(state, a, window, role) {
  const side = role === 'attacker' ? a.side : defenderSide(a);
  if (!tacticsFree(state, side)) return [];
  const out = [];
  for (const c of state.players[side].tactics.hand) {
    if (c.timing !== 'response' || c.window !== window || c.role !== role) continue;
    if (!responseRequirementMet(state, a, c, role)) continue;
    out.push({ type: 'respond', side: side, cid: c.cid });
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

function offerDefeatWindow(state, a, t) {
  const side = t.side;
  if (!tacticsFree(state, side)) return false;
  const cards = state.players[side].tactics.hand.filter(function (c) {
    return c.timing === 'response' && c.window === 'wouldBeDefeated' && (!c.requires || !c.requires.defId || c.requires.defId === t.defId);
  });
  if (!cards.length) return false;
  state.pending = { kind: 'window', window: 'wouldBeDefeated', role: 'defender', side: side, aid: a.id, uid: t.uid };
  return true;
}

/** Options for the pending decision. */
export function pendingOptions(state) {
  const p = state.pending;
  const a = current(state);
  if (!p) return [];
  if (p.kind === 'displace') return Displace.options(state);
  if (p.kind === 'window') {
    let opts;
    if (p.window === 'wouldBeDefeated') {
      const t = state.units[p.uid];
      opts = state.players[p.side].tactics.hand
        .filter(function (c) { return c.timing === 'response' && c.window === 'wouldBeDefeated' && (!c.requires || !c.requires.defId || c.requires.defId === t.defId); })
        .map(function (c) { return { type: 'respond', side: p.side, cid: c.cid }; });
    } else {
      opts = a ? windowOptions(state, a, p.window, p.role) : [];
    }
    return opts.concat([{ type: 'pass', side: p.side }]);
  }
  if (p.kind === 'react_move') {
    const moves = p.n > 0 ? combat.reactMoves(state, p.uid, p.n) : [];
    return moves.map(function (m) { return { type: 'react_move', side: state.units[p.uid].side, uid: p.uid, to: m.to, path: m.path, cost: m.cost }; })
      .concat([{ type: 'pass', side: state.units[p.uid].side }]);
  }
  if (p.kind === 'react_attack') {
    const u = state.units[p.uid];
    const w = u && combat.weapon(u, p.wid);
    const out = [];
    if (w) {
      for (const t of combat.targetsFor(state, u.uid, w)) out.push({ type: 'react_attack', side: u.side, uid: u.uid, wid: w.wid, target: t });
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

  if (p.kind === 'window') {
    if (action.type === 'respond') playResponse(state, a, action, p);
    if (a && p.window !== 'wouldBeDefeated') advance(a);
  } else if (p.kind === 'react_move') {
    if (action.type === 'react_move') {
      const u = state.units[action.uid];
      const from = { q: u.hex.q, r: u.hex.r };
      u.hex = { q: action.to.q, r: action.to.r };
      state.log.push({ t: 'move', uid: u.uid, from: from, to: { q: u.hex.q, r: u.hex.r }, path: action.path, cost: action.cost });
    }
    if (p.wid) state.pending = { kind: 'react_attack', uid: p.uid, wid: p.wid, aid: p.aid };
  } else if (p.kind === 'react_attack') {
    if (action.type === 'react_attack') {
      const u = state.units[action.uid];
      start(state, { uid: u.uid, weapon: combat.weapon(u, action.wid), targets: [action.target], free: true });
      return;
    }
  }
  run(state);
}

function playResponse(state, a, action, p) {
  const side = action.side;
  const hand = state.players[side].tactics.hand;
  const idx = hand.findIndex(function (c) { return c.cid === action.cid; });
  const c = hand.splice(idx, 1)[0];
  state.players[side].tactics.discard.push(c);
  if (!state.activation.tacticsBy) state.activation.tacticsBy = {};
  state.activation.tacticsBy[side] = true;
  if (side === state.activation.side) state.activation.slots.tactics = true;
  state.log.push({ t: 'tactics', cid: c.cid, side: side, uid: p.uid || (p.role === 'attacker' ? a.uid : null), notice: true });

  for (const e of c.effects) {
    switch (e.k) {
      case 'attackStrength': a.strengthBonus += e.n; break;
      case 'attackDamage': a.damageBonus += e.n; break;
      case 'reduceDamage':
        for (const r of a.targets) if (r.kind === 'unit' && state.units[r.id] && state.units[r.id].side === side) a.reduce[refKey(r)] = (a.reduce[refKey(r)] || 0) + e.n;
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
      case 'surviveDefeat':
        a.saved['unit:' + p.uid] = { move: e.move || 0, attackWid: e.attackWid || null };
        break;
      default:
        throw new Error('Unknown response effect: ' + e.k);
    }
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
