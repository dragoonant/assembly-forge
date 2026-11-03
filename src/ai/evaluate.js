/**
 * Position evaluation, from one side's point of view.
 *
 * Higher is better for `side`. The scale is arbitrary but the weights are not
 * independent of each other -- they encode what the game is actually about:
 *
 *   Victory points dominate, because they are the win condition and nothing
 *   else is. Everything below is a proxy for future points.
 *
 *   A unit's hit points are worth something, but a LIVING unit is worth much
 *   more than its remaining hit points suggest -- a machine on 1 HP still
 *   activates, still contests an objective, still shoots. That step change at
 *   zero is what stops the AI trading its own units evenly.
 *
 *   Bounty cuts both ways. Losing a high-VP unit hands the opponent points, so
 *   the roster's own balancing device has to appear in the evaluation or the
 *   AI will happily throw its glass cannon away.
 *
 * The proximity term is deliberately small. It exists to break ties between
 * positions that are otherwise identical, so that a unit with nothing better
 * to do drifts toward the objectives instead of standing still. If it grows
 * large enough to compete with damage, the AI starts sightseeing.
 */

import * as Combat from '../engine/combat.js';
import * as Hex from '../engine/hex.js';
import * as State from '../engine/state.js';

export const WEIGHTS = Object.freeze({
  vp: 100,
  unitAlive: 24,
  hpPoint: 2,
  bountyAtRisk: 3,
  objectiveHeld: 30,
  garrison: 12,
  proximity: 0.6,
  /**
   * Being able to shoot something.
   *
   * Without this the evaluator has no opinion about the enemy's POSITION at
   * all, only about their hit points -- so a unit with no target in range sees
   * every move as equally pointless, sits still, and banks energy it can never
   * spend. Measured over 40 self-play games, its absence produced 41.7
   * Energize actions per game against 13.5 attacks. It has to be big enough to
   * pull a unit across the board and small enough not to outweigh the damage
   * that pull is for.
   */
  threat: 2.5,
  statusOnEnemy: 6,
  statusOnSelf: -6,
  energy: 1.5
});

/**
 * @param {Object} state
 * @param {0|1} side
 * @returns {number}
 */
export function evaluate(state, side) {
  const w = WEIGHTS;
  const foe = State.opponent(side);
  let score = (state.players[side].vp - state.players[foe].vp) * w.vp;

  const units = State.livingUnits(state);
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const mine = u.side === side;
    const sign = mine ? 1 : -1;

    score += sign * w.unitAlive;
    score += sign * u.hp * w.hpPoint;
    // A wounded expensive unit is a liability: the closer it is to dying, the
    // more of its bounty is effectively already conceded.
    score -= sign * (1 - u.hp / u.maxHp) * u.vp * w.bountyAtRisk;
    score += sign * u.energy * w.energy;
    score += (mine ? w.statusOnSelf : -w.statusOnEnemy) * -u.statuses.length * (mine ? -1 : 1);

    score += sign * proximityBonus(state, u) * w.proximity;

    // ONE-SIDED ON PURPOSE. Scored for our units only, never subtracted for
    // theirs. Distance is mutual: if closing raised our threat and their threat
    // by the same amount, the two would cancel exactly and approaching would
    // score zero -- which is precisely what happened, and produced 40 straight
    // draws with 0 attacks and 85 Energize actions per game. The danger of
    // being shot at is already represented, by our units losing hit points.
    if (mine) score += threatBonus(state, u) * w.threat;
  }

  for (let i = 0; i < state.objectiveOrder.length; i++) {
    const o = state.objectives[state.objectiveOrder[i]];
    if (o.controlledBy === side) score += w.objectiveHeld;
    else if (o.controlledBy === foe) score -= w.objectiveHeld;
  }

  for (let i = 0; i < state.garrisonOrder.length; i++) {
    const g = state.garrisons[state.garrisonOrder[i]];
    if (!g.alive || g.side === null) continue;
    // A friendly garrison still standing is points waiting to be collected;
    // an enemy one is points waiting to be taken off you.
    score += (g.side === side ? 1 : -1) * w.garrison;
  }

  return score;
}

/**
 * How well placed a unit is, as a small positive number. Being near an
 * objective it could contest, or near a garrison it could act on, counts.
 *
 * @param {Object} state
 * @param {Object} u
 * @returns {number}
 */
function proximityBonus(state, u) {
  let best = 0;
  for (let i = 0; i < state.objectiveOrder.length; i++) {
    const o = state.objectives[state.objectiveOrder[i]];
    const d = Hex.distance(u.hex, o.hex);
    // Adjacent is what actually controls an objective, so the peak is at 1.
    const value = d === 1 ? 10 : Math.max(0, 8 - d);
    if (value > best) best = value;
  }
  for (let i = 0; i < state.garrisonOrder.length; i++) {
    const g = state.garrisons[state.garrisonOrder[i]];
    if (!g.alive) continue;
    const wants = g.side === u.side || g.side !== null;
    if (!wants) continue;
    const d = Hex.distance(u.hex, g.hex);
    const value = d === 1 ? 9 : Math.max(0, 7 - d);
    if (value > best) best = value;
  }
  return best;
}

/**
 * How close a unit is to being able to fight.
 *
 * Peaks when an enemy is inside the unit's longest weapon range, and falls off
 * with distance beyond that, so a unit with nothing to shoot still has a
 * gradient to walk down. Without the falloff the term would be flat across the
 * whole approach and the unit would never start walking.
 *
 * @param {Object} state
 * @param {Object} u
 * @returns {number}
 */
function threatBonus(state, u) {
  let reach = 0;
  const weapons = u.weapons || [];
  for (let i = 0; i < weapons.length; i++) {
    if (weapons[i].range > reach) reach = weapons[i].range;
  }
  if (!reach) return 0;

  // Being in range is not the same as having a shot. A unit sitting the right
  // distance from an enemy but with no line of sight has nothing to do, and
  // if this term peaked on distance alone it would tell the unit it had
  // arrived -- so it would stand there banking Energy it cannot spend.
  for (let i = 0; i < weapons.length; i++) {
    if (Combat.targetsFor(state, u.uid, weapons[i]).length) return 12;
  }

  let nearest = Infinity;
  const units = State.livingUnits(state);
  for (let i = 0; i < units.length; i++) {
    if (units[i].side === u.side) continue;
    const d = Hex.distance(u.hex, units[i].hex);
    if (d < nearest) nearest = d;
  }
  if (nearest === Infinity) return 0;

  if (nearest <= reach) return 10;
  return Math.max(0, 10 - (nearest - reach) * 1.5);
}

/**
 * The score a side would take from the position right now, ignoring anything
 * still to come. Used to sanity-check the evaluator against the real result.
 *
 * @param {Object} state
 * @param {0|1} side
 * @returns {number}
 */
export function vpMargin(state, side) {
  return state.players[side].vp - state.players[State.opponent(side)].vp;
}
