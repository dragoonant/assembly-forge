/**
 * The AI opponent.
 *
 * It scores every legal action and takes the best, which is enough for a game
 * whose decisions are mostly local. Two things stop that being as naive as it
 * sounds.
 *
 * ATTACKS ARE SCORED ANALYTICALLY, NOT SAMPLED. `apply` rolls real dice, so
 * looking ahead by applying an attack would evaluate one sample of a random
 * outcome and act on the noise. Damage is Binomial(strength, p), so the mean
 * is available in closed form -- `Combat.expectedHits` -- and the AI uses it.
 * That makes its choices exact, reproducible, and free of the variance that
 * would otherwise make measuring a change impossible.
 *
 * THE TEMPO TRAP, which is this game's version of the horizon effect. Every
 * Primary Action pushes the unit's own Timeline token, so a cheap action means
 * acting again sooner. An evaluator that only looks at the board therefore
 * prefers the 2-cost weapon to the 4-cost one even when the expensive weapon
 * is far better value, and in the worst case prefers Energize -- which changes
 * nothing and costs least -- to attacking at all. Actions are scored per
 * Timeline point spent, not in absolute terms, which is what makes the heavy
 * weapon get used.
 *
 * DOING NOTHING IS SCORED AS NOTHING. The sibling project's AI fired a card at
 * an empty board because "use it for no effect" and "discard it" reached
 * identical positions and the tie-break picked the first. Here, an action whose
 * expected gain is zero is explicitly penalised rather than left to tie, so
 * "achieve nothing cheaply" can never beat "achieve something".
 */

import * as Actions from '../engine/actions.js';
import * as Apply from '../engine/apply.js';
import * as Combat from '../engine/combat.js';
import * as Effects from '../engine/effects.js';
import * as Evaluate from './evaluate.js';
import * as Hex from '../engine/hex.js';
import * as Los from '../engine/los.js';
import * as State from '../engine/state.js';

/**
 * Weights. Deliberately NOT frozen: `tune()` overwrites them so a self-play
 * run can sweep a value without editing the file. Every one of these numbers
 * was chosen by measurement and none of them should be changed without one.
 */
export const TUNING = ({
  /** Value of one expected point of damage dealt. */
  damage: 6,
  /** Bonus for expected damage that finishes the target, plus its bounty. */
  killBonus: 40,
  /** Value of one point of a critical's chance to land a status. */
  critValue: 8,
  /**
   * Penalty for an action that achieves nothing measurable. Large on purpose:
   * the sibling project found the right size by measurement and it was five
   * times bigger than intuition suggested. A small penalty just re-creates the
   * tie it was meant to break.
   */
  wasted: 60,
  /** Timeline is the real currency, so everything is priced per point of it. */
  tempoFloor: 1,
  /**
   * What it costs to spend a Tactics card, over and above what the card does.
   * A hand is nine cards for a whole game; without a price, the AI plays its
   * whole hand in Phase one on marginal gains.
   */
  cardCost: 14,

  /**
   * How much a hex is worth for what can be DONE from it, over and above how
   * it scores positionally.
   *
   * Without this the AI walks toward the enemy because the threat term pulls
   * it, and then discovers on arrival whether it has a shot. With it, the move
   * itself is chosen for the shot it creates. This is most of the difference
   * between a unit that wanders into range and one that takes up a firing
   * position.
   */
  offence: 2.5,

  /**
   * How much expected incoming damage counts against a destination.
   *
   * This is the closest thing to opponent modelling here: a full reply search
   * is not affordable per candidate hex, but "how much could they hurt me if I
   * stand there" is cheap and captures most of the same judgement. Set too
   * high and the AI refuses to engage at all, which is the failure mode to
   * watch for in self-play.
   */
  retaliation: 3.5,

  /**
   * Candidates that get the expensive retaliation check. The rest are ranked
   * on the cheap terms alone. A beam, so the cost stays linear in units rather
   * than quadratic in hexes.
   */
  beam: 8,

  /** Preference for finishing something already wounded over starting fresh. */
  focusFire: 14,

  /**
   * How much of an enemy's attack counts against a hex it cannot reach yet but could after its Advance (2026-11-05).
   * At 0 the danger check sees only weapons already in range, so a melee machine three hexes off looks harmless
   * though it can step in and strike in the same activation. A fraction, not 1: it may not come, and it has no line
   * of sight to check from where it would stand.
   */
  threatReach: 0.5
});

/**
 * Override weights for a measurement run.
 *
 * The whole point of `tools/ai-selfplay.js` is comparing counters before and
 * after a change; sweeping a weight is impossible if changing it means editing
 * a frozen literal and losing the baseline in the same edit.
 *
 * @param {Object} overrides
 */
export function tune(overrides) {
  const keys = Object.keys(overrides || {});
  for (let i = 0; i < keys.length; i++) TUNING[keys[i]] = overrides[keys[i]];
}

/**
 * Choose an action for whoever is currently activating.
 *
 * @param {Object} state
 * @param {{verbose?: boolean}} [opts]
 * @returns {?Object} an action from `legalActions`, or null if there are none
 */
export function chooseAction(state, opts) {
  const legal = Actions.legalActions(state);
  if (!legal.length) return null;
  if (legal.length === 1) return legal[0];

  // whoever must decide: the side a paused attack is waiting on, otherwise the activating side
  const side = state.pending ? legal[0].side : state.activation.side;
  let best = null;
  let bestScore = -Infinity;
  const scored = [];

  for (let i = 0; i < legal.length; i++) {
    const s = scoreAction(state, legal[i], side);
    scored.push({ action: legal[i], score: s });
    // Strictly greater, so ties keep the earlier action -- and `legalActions`
    // is sorted by key, so that is deterministic rather than incidental.
    if (s > bestScore) {
      bestScore = s;
      best = legal[i];
    }
  }

  if (opts && opts.verbose) {
    scored.sort(function (a, b) { return b.score - a.score; });
    state.log.push({ t: 'ai', considered: scored.length, chose: Actions.actionKey(best) });
  }

  return best;
}

/**
 * Score one action. Higher is better.
 *
 * @param {Object} state
 * @param {Object} action
 * @param {0|1} side
 * @returns {number}
 */
export function scoreAction(state, action, side) {
  switch (action.type) {
    case 'attack':   return scoreAttack(state, action, side);
    case 'advance':
    case 'move':
    case 'react_move':
    case 'dash':     return action.free && action.type === 'dash' ? scoreMove(state, Object.assign({}, action, { type: 'move' }), side) : scoreMove(state, action, side);
    case 'react_attack': return scoreAttack(state, Object.assign({}, action, { free: true }), side) + 1;
    case 'respond':  return scoreResponse(state, action, side);
    case 'displace':
    case 'displace_stop':
    case 'trigger':
    case 'trigger_skip': return scoreDisplace(state, action, side);
    case 'choose':   return scoreChoose(state, action, side);
    case 'pass':     return 0;
    case 'command':  return scoreCommand(state, action, side);
    case 'tactics':  return scoreTactics(state, action, side);
    case 'rescue':   return scoreRescue(state, action);
    case 'energize': return scoreEnergize(state, action, side);
    case 'end_activation': return scoreEnd(state, action, side);
    default:         return 0;
  }
}

/**
 * Expected value of an attack, per Timeline point it costs.
 *
 * @param {Object} state
 * @param {Object} action
 * @param {0|1} side
 * @returns {number}
 */
export function scoreAttack(state, action, side) {
  const attacker = State.unit(state, action.uid);
  const w = action.weapon || Combat.weapon(attacker, action.wid);
  if (!w) return -TUNING.wasted;
  // an area attack is the sum of what it does to each target it catches, priced once
  if (action.targets && action.targets.length > 1) {
    let sum = 0;
    for (const t of action.targets) {
      const v = scoreAttack(state, Object.assign({}, action, { targets: null, target: t, weapon: w, free: true }), side);
      if (v > 0) sum += v;
    }
    return sum <= 0 ? -TUNING.wasted : sum / (action.free ? 1 : Math.max(TUNING.tempoFloor, w.tlCost));
  }
  const tHex = Combat.targetHex(state, action.target);
  if (!tHex) return -TUNING.wasted;

  const shift = Combat.accuracyShift(state, attacker, w, tHex);
  const dice = Combat.strengthOf(state, attacker, w, undefined, [action.target]);
  let expected = Combat.expectedHits(state.rules, dice, shift);

  const critP = Combat.critChance(state.rules, dice);
  if (w.crit && w.crit.damage) expected += critP * w.crit.damage;

  let value;

  if (action.target.kind === 'remote') {
    // a Remote Weapon System has 1 HP: one hit removes it and scores its VP
    const r = state.remotes[action.target.id];
    const anyHit = 1 - Math.pow(1 - Math.min(1, expected / Math.max(1, dice)), dice);
    value = anyHit * ((r ? r.vp : 2) * Evaluate.WEIGHTS.vp * 0.8 + 8);
  } else if (action.target.kind === 'garrison') {
    // A garrison dies to any damage at all, so what matters is the chance of
    // landing a single hit rather than how much is expected.
    const anyHit = 1 - Math.pow(1 - Math.min(1, expected / Math.max(1, dice)), dice);
    value = anyHit * (state.rules.scoring.garrisonDestroyVp * Evaluate.WEIGHTS.vp);
  } else {
    const target = state.units[action.target.id];
    if (!target) return -TUNING.wasted;

    // NO OVERKILL. Damage past a target's remaining hit points buys nothing,
    // so it must not be valued. Without the cap the AI fires its heaviest
    // weapon at a 2 HP target and calls it the best move on the board, when
    // the cheap weapon would finish the job for half the Timeline.
    const useful = Math.min(expected, target.hp);
    value = useful * TUNING.damage;

    if (expected >= target.hp) {
      value += TUNING.killBonus + target.vp * Evaluate.WEIGHTS.vp * 0.5;
    } else {
      // FOCUS FIRE. Short of a kill, hurting something already hurt is worth
      // more than spreading damage evenly -- a dead unit stops shooting, a
      // half-dead one does not.
      value += (1 - target.hp / target.maxHp) * TUNING.focusFire;
    }

    if (w.crit && w.crit.status && target.statuses.indexOf(w.crit.status) === -1) {
      value += critP * TUNING.critValue;
    }
  }

  if (value <= 0) return -TUNING.wasted;
  // a free attack (granted, or part of a reaction) costs no Timeline, so it is not divided by one
  if (action.free) return value;
  return value / Math.max(TUNING.tempoFloor, w.tlCost);
}

/**
 * A response card, judged on what the paused attack looks like now. Simple and readable rather than clever: play a
 * card when it changes something that matters, keep it otherwise.
 *
 * @param {Object} state
 * @param {Object} action
 * @param {0|1} side
 * @returns {number}
 */
/**
 * A Push or Pull step, judged by applying it: the evaluation afterwards, plus the collision damage it deals when the
 * target is an enemy. Deterministic, so a real lookahead costs nothing.
 * @param {Object} state
 * @param {Object} action
 * @param {0|1} side
 * @returns {number}
 */
export function scoreDisplace(state, action, side) {
  const before = Evaluate.evaluate(state, side);
  let after;
  try {
    after = Apply.apply(state, action);
  } catch (e) {
    return -TUNING.wasted;
  }
  return Evaluate.evaluate(after, side) - before + (action.type === 'displace_stop' || action.type === 'trigger_skip' ? 0 : 0.5);
}

/**
 * What holding a card is worth right now. A card still in hand when the game ends is worth nothing, so the price of
 * playing one falls as the game runs down: full early in Phase 1, a quarter by the last rounds.
 * @param {Object} state
 * @returns {number}
 */
export function cardCostNow(state) {
  const rounds = state.rules.timeline.rounds;
  const total = state.rules.match.phasesPerGame * rounds;
  const done = (state.phase - 1) * rounds + state.round;
  const left = Math.max(0, 1 - done / total);
  return TUNING.cardCost * (0.25 + 0.75 * left);
}

export function scoreResponse(state, action, side) {
  const a = state.attacks && state.attacks[state.attacks.length - 1];
  let c;
  let src = null;
  if (action.aid) {
    // a unit's own Response ability: no card is spent, but Energy may be
    src = state.units[action.uid];
    c = src && Effects.ability(src, action.aid);
  } else {
    c = state.players[side].tactics.hand.find(function (x) { return x.cid === action.cid; });
  }
  if (!c) return -TUNING.wasted;
  let value = 0;
  const attacking = a && a.side === side;
  const expectedHits = a ? (a.results && a.results.length ? a.results.reduce(function (m, x) { return Math.max(m, x.hits); }, 0) : (a.dice || 0) * 0.55) : 0;
  for (const e of c.effects) {
    const more = scoreAttackResponse(state, a, e, action, side, src, attacking, expectedHits);
    if (more !== null) { value += more; continue; }
    if (e.k === 'surviveDefeat') value += 40;
    else if (e.k === 'reduceDamage') {
      // after the roll the hits are known; before it, assume an average roll
      const r = a && a.results && a.results.length ? a.results.reduce(function (m, x) { return Math.max(m, x.hits); }, 0) : (a ? a.dice * 0.5 : 0);
      value += Math.min(e.n, r) * TUNING.damage;
    } else if (e.k === 'attackStrength') value += e.n * TUNING.damage * 0.6 + (a && a.targets.some(function (r) { return r.kind === 'unit' && state.units[r.id] && state.units[r.id].hp <= (a.dice + e.n) * 0.5; }) ? TUNING.killBonus * 0.3 : 0);
    else if (e.k === 'attackDamage') value += a && a.results && a.results.some(function (x) { return x.hits > 0; }) ? e.n * TUNING.damage : -1;
    else if (e.k === 'damageAttackerAndTargets') {
      const me = a && state.units[a.uid];
      value += a ? (a.targets.length * e.n - (me && me.hp <= e.n ? 99 : e.n)) * TUNING.damage : -1;
    } else if (e.k === 'stripTargetUpgrade' || e.k === 'stripAttackerUpgrade') value += 2;
  }
  if (action.aid) return value - (c.energy || 0) * 3;
  return value - cardCostNow(state);
}

/**
 * The value of one of the newer response effects on the attack in progress, or null for a kind scored elsewhere.
 * Rough on purpose: each is a readable rule of thumb in the same units as scoreAttack.
 */
function scoreAttackResponse(state, a, e, action, side, src, attacking, expectedHits) {
  const D = TUNING.damage;
  switch (e.k) {
    case 'attackStrength': {
      if (!attacking) return -1;
      let n = e.n;
      if (e.per === 'ownUpgrade') n = e.n * (src ? State.upgradeCount(src, e.kind) : 0);
      else if (e.per === 'alliesInRange') {
        n = e.n * (src ? State.livingUnits(state, side).filter(function (o) {
          return o.uid !== src.uid && o.hex && Hex.distance(o.hex, src.hex) <= e.range;
        }).length : 0);
      } else if (e.per === 'remotesAdjTarget') {
        n = 0;
        const t = a && a.targets[0] && Combat.targetHex(state, a.targets[0]);
        if (t) n = e.n * State.deployedRemotes(state, side).filter(function (r) { return Hex.distance(r.hex, t) === 1; }).length;
      }
      return n * D * 0.55;
    }
    case 'attackAccuracy':
      return (attacking ? e.n : -e.n) * (a ? a.dice : 0) * 0.1 * D;
    case 'setCrit': return attacking ? D * 1.2 + TUNING.critValue : -1;
    case 'rerollMisses': {
      if (!attacking || !a || !a.faces) return -1;
      const misses = Math.max(0, a.faces.length - expectedHits);
      const n = e.n ? Math.min(e.n, misses) : misses;
      return n * 0.55 * D + (e.drawIf && n >= e.drawIf ? 10 : 0);
    }
    case 'pushTarget': return attacking ? 5 : -1;
    case 'delayTargets':
      return a ? a.targets.filter(function (r) { return r.kind === 'unit' && state.units[r.id] && state.units[r.id].side !== side; }).length * 9 : 0;
    case 'slowTargetsNearRemote': return 10;
    case 'draw': return 10 * e.n;
    case 'energyTo': return e.n * 3;
    case 'counterAttack': return 28;
    case 'reactAttack': {
      const u = state.units[action.uid];
      if (!u) return -TUNING.wasted;
      const v = scoreAttack(state, { type: 'attack', uid: u.uid, wid: e.wid, target: { kind: 'unit', id: action.targetUid }, free: true }, side);
      return v - (e.tl || 0) * 4;
    }
    case 'challenge': {
      const c = state.units[action.uid];
      const d = state.units[action.targetUid];
      if (!c || !d) return -TUNING.wasted;
      const risk = function (u) {
        return expectedHits >= u.hp ? TUNING.killBonus + u.vp * Evaluate.WEIGHTS.vp * 0.5 : expectedHits * D * (0.5 + u.vp / 20);
      };
      return risk(d) - risk(c) - 4;
    }
    default: return null;
  }
}

/**
 * A step of a choice an effect opened (an Upgrade, a unit, a hex for a Remote Weapon System), judged by applying it:
 * every choice is deterministic, so a real lookahead costs nothing in reproducibility.
 */
export function scoreChoose(state, action, side) {
  const before = Evaluate.evaluate(state, side);
  let after;
  try {
    after = Apply.apply(state, action);
  } catch (e) {
    return -TUNING.wasted;
  }
  let gain = Evaluate.evaluate(after, side) - before;
  // The evaluator counts an Upgrade the same on any machine, so moving one is a wash to it; credit the move by how
  // much better the receiving machine uses it, and a pass by nothing.
  const p = state.pending;
  if (p && p.kind === 'choose' && p.what === 'transfer' && action.targetUid) {
    const to = state.units[action.targetUid];
    const from = state.units[to.uid === p.a ? p.b : p.a];
    gain += (upgradeUse(to) - upgradeUse(from)) * 3;
  }
  return gain;
}

/** Whether the activating unit can attack right now, remembered per state (scoreEffectSet asks once per option). */
let canAttackMemo = { state: null, value: false };
function canAttackNow(state) {
  if (canAttackMemo.state !== state) {
    canAttackMemo = {
      state: state,
      value: Actions.legalActions(state).some(function (x) { return x.type === 'attack'; })
    };
  }
  return canAttackMemo.value;
}

/**
 * Movement is scored by applying it -- movement is deterministic, so a real
 * lookahead costs nothing in reproducibility.
 *
 * @param {Object} state
 * @param {Object} action
 * @param {0|1} side
 * @returns {number}
 */
export function scoreMove(state, action, side) {
  const before = Evaluate.evaluate(state, side);
  let moved;
  try {
    moved = Apply.apply(state, action);
  } catch (e) {
    return -TUNING.wasted;
  }

  let gain = Evaluate.evaluate(moved, side) - before;

  // A hex is worth what can be DONE from it, not merely how it scores. Without
  // this the AI drifts toward the enemy on the threat gradient and only finds
  // out on arrival whether it has a shot; with it, the destination is chosen
  // for the shot it creates.
  //
  // Compared against the same figure from where the unit already stands, so a
  // move is credited with the offence it ADDS rather than with offence the
  // unit had anyway.
  //
  // A Rescue counts as well as a shot (2026-11-05): on a board with several Garrisons a side, standing next to one is
  // worth as much as a firing position, and without this nothing but the small proximity term ever walked a machine
  // to its own Garrisons.
  const offenceHere = Math.max(bestAttackValue(state, action.uid, side), bestRescueValue(state, action.uid));
  const offenceThere = Math.max(bestAttackValue(moved, action.uid, side), bestRescueValue(moved, action.uid));
  gain += (offenceThere - offenceHere) * TUNING.offence;

  // ...and what can be done TO it. The nearest thing to opponent modelling
  // that is affordable per candidate hex.
  const exposedHere = incomingThreat(state, action.uid);
  const exposedThere = incomingThreat(moved, action.uid);
  gain -= (exposedThere - exposedHere) * TUNING.retaliation;

  // A Dash is a Primary Action: it buys distance at the price of the turn's
  // one chance to do something. Priced per Timeline point like everything else.
  if (action.type === 'dash') {
    if (gain <= 0) return -TUNING.wasted;
    return gain / Math.max(TUNING.tempoFloor, state.rules.actions.dash.tlCost);
  }

  // Advance is free, so it is worth taking on any improvement at all -- but
  // never worth taking for nothing, or the AI shuffles on the spot.
  return gain > 0 ? gain : -1;
}

/**
 * The best attack this unit could make from where it currently stands, in raw
 * value rather than per-Timeline.
 *
 * Analytic throughout -- no dice are rolled and no state is applied, so this
 * is safe to call once per candidate hex.
 *
 * @param {Object} state
 * @param {string} uid
 * @param {0|1} side
 * @returns {number}
 */
export function bestAttackValue(state, uid, side) {
  const u = state.units[uid];
  if (!u || !u.alive) return 0;
  let best = 0;
  const weapons = Combat.weaponsOf(u);
  for (let i = 0; i < weapons.length; i++) {
    const targets = Combat.targetsFor(state, uid, weapons[i]);
    for (let j = 0; j < targets.length; j++) {
      const v = scoreAttack(state, {
        type: 'attack', uid: uid, wid: weapons[i].wid, target: targets[j]
      }, side);
      if (v > best) best = v;
    }
  }
  return best;
}

/**
 * The best Rescue this unit could make from where it stands, in the same raw units as `bestAttackValue`: a Rescue of
 * an adjacent allied Garrison while its Primary Action is still unused, or a Command that rescues and that it can use
 * now. Zero when there is none.
 *
 * @param {Object} state
 * @param {string} uid
 * @returns {number}
 */
export function bestRescueValue(state, uid) {
  const u = state.units[uid];
  if (!u || !u.alive || !u.hex) return 0;
  const act = state.activation;
  if (!act || act.uid !== uid) return 0;
  let best = 0;
  if (!act.slots.primary && Actions.rescueTargets(state, u).length) best = scoreRescue(state, null);
  const list = Effects.abilitiesOf(u);
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.timing !== 'command' || act.commandsUsed.indexOf(a.aid) !== -1) continue;
    if (!(a.effects || []).some(function (e) { return e.k === 'rescue'; })) continue;
    if (!Effects.canUseCommand(state, u, a) || !Effects.targetOptions(state, u, a).length) continue;
    const v = state.rules.scoring.garrisonRescueVp * Evaluate.WEIGHTS.vp * 0.5;
    if (v > best) best = v;
  }
  return best;
}

/**
 * How much a unit gets out of an Upgrade: its hardest-hitting weapon (Strength and Accuracy Upgrades feed it) and
 * what it is worth (a Shield on a valuable machine protects more bounty). Used to see whether handing an Upgrade
 * over is a gain.
 *
 * @param {Object} u
 * @returns {number}
 */
function upgradeUse(u) {
  let strength = 0;
  const weapons = u.weapons || [];
  for (let i = 0; i < weapons.length; i++) if ((weapons[i].strength || 0) > strength) strength = weapons[i].strength;
  return strength + u.vp * 0.5 + (u.weapons || []).some(function (w) { return w.range > 1; }) * 2;
}

/**
 * Expected damage every living enemy could put on this unit where it stands.
 *
 * Deliberately pessimistic: it assumes every enemy shoots this unit with its
 * best weapon, which no real turn allows. That overstates the danger of any
 * one hex, but it overstates every hex the same way, so the COMPARISON between
 * destinations -- which is all this is used for -- stays honest.
 *
 * Damage is capped at the unit's remaining hit points, because the difference
 * between dying and dying twice over is not a difference.
 *
 * @param {Object} state
 * @param {string} uid
 * @returns {number}
 */
export function incomingThreat(state, uid) {
  const me = state.units[uid];
  if (!me || !me.alive) return 0;

  let total = 0;
  const enemies = State.livingUnits(state, State.opponent(me.side));
  for (let i = 0; i < enemies.length; i++) {
    const foe = enemies[i];
    let worst = 0;
    const weapons = Combat.weaponsOf(foe);
    for (let j = 0; j < weapons.length; j++) {
      const w = weapons[j];
      const d = Hex.distance(foe.hex, me.hex);
      let scale = 1;
      if (d > w.range) {
        if (!TUNING.threatReach || d > w.range + state.rules.movement.advanceHexes + State.upgradeCount(foe, 'speed')) continue;
        scale = TUNING.threatReach;
      } else if (!w.ignoreLos &&
          !Los.hasLos(state, foe.hex, me.hex, { side: foe.side, targetUid: me.uid })) continue;
      const shift = Combat.accuracyShift(state, foe, w, me.hex);
      const dice = Combat.strengthOf(state, foe, w);
      const expected = Combat.expectedHits(state.rules, dice, shift) * scale;
      if (expected > worst) worst = expected;
    }
    total += worst;
  }
  return Math.min(total, me.hp);
}

/**
 * Command abilities are FREE -- no Primary Action, no Timeline -- so they are
 * worth taking on any positive expectation at all, and are not divided by a
 * tempo cost the way a Primary is.
 *
 * The trap is that a buff is worth nothing on a turn the unit cannot attack.
 * "+3 strength this activation" spent by a unit with no target in range is a
 * wasted Energy and a wasted ability, and it looks identical to a good play if
 * you only read the effect data. So offensive buffs are gated on there
 * actually being something to shoot.
 *
 * @param {Object} state
 * @param {Object} action
 * @param {0|1} side
 * @returns {number}
 */
export function scoreCommand(state, action, side) {
  const u = State.unit(state, action.uid);
  const a = Effects.ability(u, action.aid);
  if (!a) return -TUNING.wasted;
  return scoreEffectSet(state, action, a, u);
}

/**
 * A Tactics card is an ability that lives in a hand, so it is scored the same
 * way -- with one difference: a card is a finite resource. Spending one to
 * gain slightly more than nothing is how a hand evaporates before the Phase
 * that needed it, so the threshold to play one is deliberately higher.
 *
 * @param {Object} state
 * @param {Object} action
 * @param {0|1} side
 * @returns {number}
 */
export function scoreTactics(state, action, side) {
  const u = State.unit(state, action.uid);
  const hand = state.players[side].tactics.hand;
  let c = null;
  for (let i = 0; i < hand.length; i++) if (hand[i].cid === action.cid) { c = hand[i]; break; }
  if (!c) return -TUNING.wasted;
  // an Attack card is an attack with the card's weapon, less what the card is worth in hand
  if (c.timing === 'attack') {
    const v = scoreAttack(state, Object.assign({}, action, { weapon: Actions.cardWeapon(c) }), side);
    return v <= 0 ? -TUNING.wasted : v - TUNING.cardCost * 0.3;
  }

  const raw = scoreEffectSet(state, action, c, u);
  if (raw <= 0) return -TUNING.wasted;
  return raw - cardCostNow(state);
}

/**
 * Shared scoring for anything carrying an effect list.
 *
 * @param {Object} state
 * @param {Object} action
 * @param {Object} a
 * @param {Object} u
 * @returns {number}
 */
function scoreEffectSet(state, action, a, u) {

  const canAttack = canAttackNow(state);
  const foe = State.opponent(u.side);
  const enemiesWithin = function (h, range) {
    return State.livingUnits(state, foe).filter(function (o) { return o.hex && Hex.distance(o.hex, h) <= range; });
  };

  let value = 0;
  for (let i = 0; i < a.effects.length; i++) {
    const e = a.effects[i];
    switch (e.k) {
      case 'strength':
        value += canAttack ? e.n * TUNING.damage * 0.7 : -TUNING.wasted;
        break;
      case 'accuracy':
        value += canAttack ? e.n * TUNING.damage * 0.45 : -TUNING.wasted;
        break;
      case 'extraAttack':
        value += canAttack ? e.n * TUNING.damage * 3 : -TUNING.wasted;
        break;
      case 'move':
        value += e.n * 5;
        break;
      case 'grant':
        value += e.grant.kind === 'attack' ? (canAttack ? TUNING.damage * 3 : -TUNING.wasted) : 8;
        break;
      case 'weaponStrength':
        value += canAttack ? e.n * (e.per === 'rescued' ? (state.players[u.side].rescued || 0) : 1) * TUNING.damage * 0.7 : -TUNING.wasted;
        break;
      case 'upgrade':
        // permanent for the rest of the game, so worth more than a one-turn bonus
        value += 18;
        break;
      case 'damageSelf':
        value -= e.n >= u.hp ? 999 : e.n * TUNING.damage * 0.5;
        break;
      case 'stripOnAttack':
        value += canAttack ? 2 : 0;
        break;
      case 'energy':
        value += 2;
        break;
      case 'heal':
        value += e.n * Evaluate.WEIGHTS.hpPoint * (1 - u.hp / u.maxHp) * 2;
        break;
      case 'damage': {
        const t = action.targetUid ? state.units[action.targetUid] : null;
        const n = e.per === 'upgrades' ? u.upgrades.length : e.n;
        value += n * TUNING.damage;
        if (t && n >= t.hp) value += TUNING.killBonus + t.vp * Evaluate.WEIGHTS.vp * 0.5;
        break;
      }
      case 'status': {
        const t = action.targetUid ? state.units[action.targetUid] : null;
        // A status already on the target does nothing -- it does not stack.
        if (t && t.statuses.indexOf(e.s) !== -1) value -= TUNING.wasted;
        else value += TUNING.critValue * 2.5;
        break;
      }
      // --- the second wave ---
      case 'speed': value += e.n * 2; break;
      case 'hover': value += 1; break;
      case 'rescue': value += state.rules.scoring.garrisonRescueVp * Evaluate.WEIGHTS.vp * 0.5; break;
      case 'upgradeChoice': value += 18 * (e.n || 1); break;
      case 'upgradeSpread':
        value += 15 * Math.min(e.n || 3, State.livingUnits(state, u.side).filter(function (o) {
          return o.hex && (!e.trait || (o.traits || []).indexOf(e.trait) !== -1);
        }).length);
        break;
      case 'transfer': {
        // Worth something only when an Upgrade would end up on the machine that uses it better (2026-11-05: scored
        // as wasted before, so the support walker never shared its Shields).
        const t = action.targetUid ? state.units[action.targetUid] : null;
        if (!t) { value -= TUNING.wasted; break; }
        const gap = upgradeUse(t) - upgradeUse(u);
        const movable = gap > 0 ? u.upgrades.length : t.upgrades.length;
        value += movable ? Math.min(movable, 3) * 12 * Math.min(1, Math.abs(gap) / 4) : -TUNING.wasted;
        break;
      }
      case 'steal': {
        const t = action.targetUid ? state.units[action.targetUid] : null;
        if (!t) { value -= TUNING.wasted; break; }
        const mult = t.side === u.side ? 0 : 2;
        value += (Math.min(e.energy || 0, t.energy) * 3 + Math.min(e.upgrades || 0, t.upgrades.length) * 15) * mult;
        break;
      }
      case 'destroyUpgrades': {
        const t = action.targetUid ? state.units[action.targetUid] : null;
        const n = t ? (e.n === 'all' ? t.upgrades.length : Math.min(e.n, t.upgrades.length)) : 0;
        value += n ? n * 15 : -TUNING.wasted;
        break;
      }
      case 'statusAll': {
        const hit = u.hex ? enemiesWithin(u.hex, e.range).filter(function (o) { return o.statuses.indexOf(e.s) === -1; }).length : 0;
        value += hit ? hit * TUNING.critValue * 2 : -TUNING.wasted;
        break;
      }
      case 'delayNearRemote': {
        const mine = State.remotesOf(state, u.uid).filter(function (r) { return r.hex; });
        const n = State.livingUnits(state, foe).filter(function (o) { return o.hex && mine.some(function (r) { return Hex.distance(r.hex, o.hex) === 1; }); }).length;
        value += n ? n * 10 : -TUNING.wasted;
        break;
      }
      case 'repositionSelf': value += action.to ? 3 : 0; break;
      case 'damageBonus': value += canAttack ? e.n * TUNING.damage * 1.2 : -TUNING.wasted; break;
      case 'nextAttackStrength': value += canAttack ? e.n * TUNING.damage * 0.7 : -TUNING.wasted; break;
      case 'remotesStrike': {
        const list = e.all ? State.deployedRemotes(state) : State.deployedRemotes(state, u.side);
        const n = list.filter(function (r) { return enemiesWithin(r.hex, 1).length; }).length;
        value += n ? n * TUNING.damage * 1.2 : -TUNING.wasted;
        break;
      }
      case 'repositionAllRemotes': value += State.deployedRemotes(state).length * 4; break;
      case 'placeRemote': {
        if (!action.to) { value -= TUNING.wasted; break; }
        const r = state.remotes[u.uid + '.' + e.remote];
        if (!r) { value -= TUNING.wasted; break; }
        value += r.hex ? 1 : 10;
        const allies = State.livingUnits(state, u.side).filter(function (o) { return o.hex && o.uid !== u.uid && Hex.distance(o.hex, action.to) === 1; }).length;
        const near = enemiesWithin(action.to, 1).length;
        if (State.remoteAura(r, 'auraReduceDamage')) value += allies * 3 + (Hex.distance(u.hex, action.to) === 1 ? 3 : 0);
        if (State.remoteAura(r, 'auraAccuracy')) value += near * 4;
        if ((r.abilities || []).some(function (x) { return x.on === 'placed'; })) value += near * 6;
        if (enemiesWithin(action.to, 2).length && !near) value -= 3;
        break;
      }
      case 'moveNow': value += e.n * 2; break;
      case 'rescueMovedAdjacent': {
        const n = state.garrisonOrder.filter(function (gid) {
          const g = state.garrisons[gid];
          return g.alive && g.side === u.side && u.hex && Hex.distance(g.hex, u.hex) <= 6;
        }).length;
        value += n ? n * 60 : -TUNING.wasted;
        break;
      }
      case 'draw': value += 10 * e.n; break;
      default:
        break;
    }
  }

  if (a.energy) value -= a.energy * 3;
  return value <= 0 ? -TUNING.wasted : value;
}

/**
 * @param {Object} state
 * @param {Object} action
 * @returns {number}
 */
export function scoreRescue(state, action) {
  const vp = state.rules.scoring.garrisonRescueVp * Evaluate.WEIGHTS.vp;
  return vp / Math.max(TUNING.tempoFloor, state.rules.actions.rescue.tlCost);
}

/**
 * Energy is worth having only when something can spend it. Nothing does yet,
 * so this is near-zero on purpose -- and must stay below any real action, or
 * the cheapest Primary in the game becomes the default and the AI stops
 * fighting.
 *
 * @param {Object} state
 * @param {Object} action
 * @param {0|1} side
 * @returns {number}
 */
export function scoreEnergize(state, action, side) {
  const u = State.unit(state, action.uid);
  const cap = state.rules.actions.maxEnergy;
  if (cap !== null && u.energy >= cap) return -TUNING.wasted;

  // Until an ability actually spends Energy, banking it achieves nothing, and
  // "achieves nothing" must score below every real action rather than tie with
  // them. It stays barely positive so that a unit with genuinely no other
  // Primary available still takes it over a forced pass.
  if (!ENERGY_HAS_A_SPENDER) return 0.01;

  // Energy is only worth banking if this unit has something to spend it on and
  // cannot already afford it. A unit already holding enough for its ability is
  // banking a second charge it has no way to use.
  let cheapest = Infinity;
  const list = Effects.abilitiesOf(u);
  for (let i = 0; i < list.length; i++) {
    if (list[i].timing === 'command' && list[i].energy && list[i].energy < cheapest) {
      cheapest = list[i].energy;
    }
  }
  if (cheapest === Infinity || u.energy >= cheapest) return 0.01;

  // What the Energy buys right now (2026-11-05): a Command is free and can follow the Primary Action in the same
  // activation, so Energize-then-Command is worth most of the Command, per Timeline point. Without this, banking
  // Energy scored 0.75 against any attack's tens, and a machine whose best play is an Energy Command (the support
  // walker's Rescue from range) almost never had the Energy for it.
  let unlocked = 0;
  let after = null;
  try { after = Apply.apply(state, action); } catch (e) { after = null; }
  if (after && after.activation && after.activation.uid === u.uid) {
    const me = after.units[u.uid];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.timing !== 'command' || !a.energy || a.energy <= u.energy) continue;
      if (after.activation.commandsUsed.indexOf(a.aid) !== -1 || !Effects.canUseCommand(after, me, a)) continue;
      for (const opt of Effects.targetOptions(after, me, a)) {
        const v = scoreEffectSet(after, Object.assign({ type: 'command', uid: u.uid, aid: a.aid }, opt), a, me);
        if (v > unlocked) unlocked = v;
      }
    }
  }
  const banked = Evaluate.WEIGHTS.energy / state.rules.actions.energize.tlCost;
  return Math.max(banked, unlocked * 0.8 / Math.max(TUNING.tempoFloor, state.rules.actions.energize.tlCost));
}

/**
 * Whether anything in the game can currently spend Energy.
 *
 * False until the effects milestone, when every unit gained an Energy-costing
 * Command ability. Flipped then, and re-measured: banking Energy is now a real
 * play rather than a wasted action dressed up as a cheap one.
 */
const ENERGY_HAS_A_SPENDER = true;

/**
 * Ending the turn is worth nothing, and is worth LESS than nothing while a
 * Primary Action is still available -- passing up the turn's only chance to
 * act is exactly the wasted move this penalty exists to prevent.
 *
 * @param {Object} state
 * @param {Object} action
 * @param {0|1} side
 * @returns {number}
 */
export function scoreEnd(state, action, side) {
  if (state.activation && state.activation.slots.primary) return 0;
  return -TUNING.wasted * 2;
}

/**
 * Play one activation through to its end.
 *
 * @param {Object} state
 * @param {{verbose?: boolean}} [opts]
 * @returns {Object}
 */
export function playActivation(state, opts) {
  let s = state;
  const uid = s.activation ? s.activation.uid : null;
  let guard = 0;
  while (s.activation && s.activation.uid === uid && !Apply.isTerminal(s)) {
    if (++guard > 96) throw new Error('AI failed to end an activation');
    const action = chooseAction(s, opts);
    if (!action) break;
    s = Apply.apply(s, action);
  }
  return s;
}

/**
 * Play a whole match out, both sides driven by this AI. The workhorse for
 * measuring a change: run it many times and count the specific behaviour that
 * was supposed to improve, rather than reasoning about whether it did.
 *
 * @param {Object} state
 * @param {{limit?: number, verbose?: boolean}} [opts]
 * @returns {{state: Object, activations: number}}
 */
export function playOut(state, opts) {
  const o = opts || {};
  let s = state;
  let n = 0;
  const cap = o.limit === undefined ? 2000 : o.limit;
  while (!Apply.isTerminal(s) && s.activation) {
    if (++n > cap) throw new Error('AI game did not finish in ' + cap + ' activations');
    s = playActivation(s, o);
  }
  return { state: s, activations: n };
}
