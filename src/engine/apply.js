/**
 * `apply(state, action)` -- the only way a game moves forward.
 *
 * It clones, mutates the clone, and returns it. The state handed in is never
 * touched, including its nested objects, so callers may keep old states around
 * for undo, for AI search, or for a test that wants to compare before and
 * after. The seeded generator rides along at `state.rng`, so the returned
 * state carries the advanced generator and a replay from the same seed lands
 * in exactly the same place.
 *
 * Actions are validated against `legalActions` before anything happens. An
 * illegal action throws rather than half-applying.
 */

import * as Actions from './actions.js';
import * as Combat from './combat.js';
import * as Effects from './effects.js';
import * as Hex from './hex.js';
import * as State from './state.js';
import * as Timeline from './timeline.js';

/**
 * @param {Object} state
 * @param {Object} action
 * @returns {Object} a new state
 */
export function apply(state, action) {
  const canonical = Actions.resolveLegal(state, action);
  if (!canonical) {
    throw new Error(
      'Illegal action ' + Actions.actionKey(action || {}) + '. Legal: ' +
      Actions.legalActions(state).map(Actions.actionKey).join(' | ')
    );
  }

  const next = State.clone(state);
  const act = next.activation;

  switch (canonical.type) {
    case 'advance':
      moveUnit(next, canonical, 'advance');
      act.slots.advance = true;
      break;

    case 'dash':
      moveUnit(next, canonical, 'dash');
      act.slots.primary = 'dash';
      Effects.raise(next, act.uid, 'dash', Combat);
      spendTimeline(next, act.uid, next.rules.actions.dash.tlCost);
      break;

    case 'energize': {
      const u = State.unit(next, act.uid);
      u.energy += next.rules.actions.energize.gain;
      act.slots.primary = 'energize';
      closeMovementBlock(next);
      next.log.push({ t: 'energize', uid: u.uid, energy: u.energy });
      spendTimeline(next, act.uid, next.rules.actions.energize.tlCost);
      break;
    }

    case 'attack': {
      // Read the Timeline cost off the weapon BEFORE resolving, because the
      // attack's own critical effects are allowed to modify the weapon.
      const w = Combat.weapon(State.unit(next, act.uid), canonical.wid);
      const free = Boolean(canonical.free);
      const tlCost = free ? 0 : w.tlCost;

      const outcome = Combat.resolveAttack(next, act.uid, canonical.wid, canonical.target);

      if (free) {
        // Granted by an ability, explicitly "at TL0" -- it neither consumes
        // the Primary Action nor advances the Timeline.
        act.extraAttacks -= 1;
      } else {
        act.slots.primary = 'attack';
        closeMovementBlock(next);
      }

      if (canonical.target.kind === 'unit' && outcome.damage > 0 && !outcome.destroyed) {
        Effects.raise(next, canonical.target.id, 'damaged', Combat);
      }
      if (outcome.destroyed) Effects.raise(next, act.uid, 'destroy', Combat);

      spendTimeline(next, act.uid, tlCost);
      break;
    }

    case 'command': {
      const u = State.unit(next, act.uid);
      const a = Effects.ability(u, canonical.aid);
      Effects.resolve(next, act.uid, a, canonical.targetUid || null, Combat);
      act.commandsUsed.push(canonical.aid);
      break;
    }

    case 'tactics': {
      const hand = next.players[act.side].tactics.hand;
      let idx = -1;
      for (let i = 0; i < hand.length; i++) if (hand[i].cid === canonical.cid) { idx = i; break; }
      if (idx === -1) throw new Error('Tactics card not in hand: ' + canonical.cid);
      const c = hand.splice(idx, 1)[0];
      next.players[act.side].tactics.discard.push(c);
      Effects.resolve(next, act.uid, c, canonical.targetUid || null, Combat);
      act.slots.tactics = true;
      // A card played in response to an opponent's attack locks the player out
      // of playing another on their next activation. Nothing plays defensively
      // yet -- every card is command-timed -- so this arms only for response
      // cards, and the lockout is consumed when the next activation opens.
      if (c.timing === 'response' && next.rules.tactics.lockoutAfterDefensivePlay) {
        next.players[act.side].tacticsLockout = true;
      }
      next.log.push({ t: 'tactics', cid: c.cid, uid: act.uid, side: act.side, notice: true });
      break;
    }

    case 'rescue': {
      const g = next.garrisons[canonical.gid];
      g.alive = false;
      next.players[act.side].vp += next.rules.scoring.garrisonRescueVp;
      act.slots.primary = 'rescue';
      closeMovementBlock(next);
      next.log.push({
        t: 'garrison_rescued', gid: g.gid, uid: act.uid, side: act.side,
        vp: next.rules.scoring.garrisonRescueVp, sound: 'rescue', notice: true
      });
      Effects.raise(next, act.uid, 'rescue', Combat);
      spendTimeline(next, act.uid, next.rules.actions.rescue.tlCost);
      break;
    }

    case 'deploy': {
      // Onto the Base, then the unit acts at once; `legalActions` makes it move off first.
      const u = State.unit(next, act.uid);
      u.alive = true;
      u.inReserve = false;
      u.hex = { q: canonical.to.q, r: canonical.to.r };
      act.startHex = { q: u.hex.q, r: u.hex.r };
      act.deployed = true;
      next.log.push({ t: 'deploy', uid: u.uid, side: u.side, to: { q: u.hex.q, r: u.hex.r }, sound: 'deploy' });
      break;
    }

    case 'end_activation':
      endActivation(next);
      break;

    default:
      throw new Error('Unhandled action type: ' + canonical.type);
  }

  return next;
}

/**
 * @param {Object} state
 * @returns {boolean}
 */
export function isTerminal(state) {
  return Boolean(state.over);
}

/**
 * Who is ahead, or null on a tie. Meaningful once the game is over; useful
 * before then as a running verdict.
 * @param {Object} state
 * @returns {?0|1}
 */
export function leader(state) {
  const a = state.players[0].vp;
  const b = state.players[1].vp;
  if (a === b) return null;
  return a > b ? 0 : 1;
}

// --- Pieces of a turn --------------------------------------------------------

/**
 * @param {Object} state
 * @param {Object} action canonical, so its path is the engine's own
 * @param {string} kind 'advance' | 'dash'
 */
function moveUnit(state, action, kind) {
  const u = State.unit(state, action.uid);
  const from = { q: u.hex.q, r: u.hex.r };
  u.hex = { q: action.to.q, r: action.to.r };
  state.activation.moved = true;
  state.log.push({
    t: kind, uid: u.uid, from: from, to: { q: u.hex.q, r: u.hex.r }, cost: action.cost
  });
}

/**
 * Movement is one unsplittable block: once the unit has stopped and done
 * something that is not movement, neither Advance nor Dash may move it again
 * this activation. Called by every non-movement action.
 *
 * @param {Object} state
 */
function closeMovementBlock(state) {
  if (state.rules.movement.oneBlock) state.activation.movementClosed = true;
}

/**
 * Push a unit's Timeline token forward by the cost of the action it just took.
 * Only Primary Actions cost Timeline; Advance, Command abilities and Tactics
 * cards are free, so they never reach here.
 *
 * @param {Object} state
 * @param {string} uid
 * @param {number} cost
 */
function spendTimeline(state, uid, cost) {
  if (!cost) return;
  const landed = Timeline.push(state.timeline, uid, cost, state.rules);
  state.log.push({ t: 'timeline', uid: uid, cost: cost, round: landed });
}

/**
 * Close the current activation and hand the Timeline the job of finding the
 * next one.
 * @param {Object} state
 */
function endActivation(state) {
  const act = state.activation;

  // The Primary Action is mandatory, and taking one is what pushes the unit's
  // token off this round. `legalActions` lets an activation end without one
  // only when the unit has no Primary available at all -- so the token has to
  // be pushed here instead, or the round would never empty and the Timeline
  // would sit on the same unit for ever.
  // A unit defeated during its own activation has already paid its Timeline penalty.
  if (!act.slots.primary && !act.defeated) {
    state.log.push({ t: 'no_primary', uid: act.uid });
    spendTimeline(state, act.uid, state.rules.actions.forcedPassTlCost);
  }

  state.lastActedSide = act.side;
  state.lastActedRound = state.round;
  state.activation = null;
  state.log.push({ t: 'end_activation', uid: act.uid, side: act.side });
  settle(state);
}

/**
 * Walk the Timeline forward until somebody is due to act, or the game ends.
 *
 * The round tracker only advances once every token on the current round has
 * gone -- which, since every activation ends with the unit's token pushed at
 * least two rounds forward, means once the round is empty. Empty rounds ahead
 * are skipped. Running off the end of the track ends the Phase.
 *
 * @param {Object} state
 */
function settle(state) {
  let guard = 0;
  while (!state.over) {
    if (++guard > 10000) throw new Error('Timeline failed to settle');

    if (Timeline.roundIsEmpty(state.timeline, state.round)) {
      endRound(state);
      const nextRound = Timeline.firstActiveRound(state.timeline, state.round + 1);
      if (nextRound === null) {
        endPhase(state);
        continue;
      }
      state.round = nextRound;
      state.log.push({ t: 'round', round: state.round, phase: state.phase });
    }

    if (State.beginNextActivation(state)) return;

    // The round is not empty but nobody can act: only reachable if a token
    // belongs to a unit that no longer exists, which would be a bug elsewhere.
    throw new Error('Round ' + state.round + ' holds a token nobody can activate');
  }
}

/**
 * End-of-round hook. Objective control is recalculated here once objectives
 * are scored -- the sources are explicit that control is tracked per round but
 * only banked at the end of a Phase, so the two clocks stay separate.
 * @param {Object} state
 */
function endRound(state) {
  if (state.rules.scoring.objectiveControlPerRound) recomputeObjectiveControl(state);
  state.log.push({ t: 'round_end', round: state.round, phase: state.phase });
}

/**
 * Recalculate who holds each objective.
 *
 * Control goes to whichever side has strictly more living units on the hexes
 * SURROUNDING the marker -- adjacency, not occupancy, which is why a unit
 * cannot simply park on an objective and own it. A tie leaves the objective
 * uncontrolled rather than leaving the previous holder in place.
 *
 * Note the two clocks: control is recomputed every round, but only converted
 * into victory points at the end of a Phase. Both are in the sources and they
 * are easy to conflate.
 *
 * @param {Object} state
 */
export function recomputeObjectiveControl(state) {
  for (let i = 0; i < state.objectiveOrder.length; i++) {
    const o = state.objectives[state.objectiveOrder[i]];
    const around = Hex.neighbours(o.hex);
    let counts = [0, 0];
    for (let j = 0; j < around.length; j++) {
      const u = State.unitAt(state, around[j]);
      if (u && u.alive) counts[u.side]++;
    }
    const was = o.controlledBy;
    o.controlledBy = counts[0] > counts[1] ? 0 : counts[1] > counts[0] ? 1 : null;
    if (o.controlledBy !== was) {
      state.log.push({
        t: 'objective_control', oid: o.oid, side: o.controlledBy,
        counts: counts, notice: true
      });
    }
  }
}

/**
 * End of a Phase: score, then either start the next Phase or finish the game.
 *
 * A Phase ends when the track has no tokens left to run. Tokens that overran
 * round 10 come back onto the track here, and the round tracker resets to 1
 * before skipping forward to the first round that holds anything.
 *
 * @param {Object} state
 */
function endPhase(state) {
  // Objectives are banked here, not when control changes hands.
  if (state.rules.scoring.objectiveScoreAtPhaseEnd) {
    recomputeObjectiveControl(state);
    for (let i = 0; i < state.objectiveOrder.length; i++) {
      const o = state.objectives[state.objectiveOrder[i]];
      if (o.controlledBy === null) continue;
      state.players[o.controlledBy].vp += o.vp;
      state.log.push({
        t: 'objective_scored', oid: o.oid, side: o.controlledBy, vp: o.vp, notice: true
      });
    }
  }
  state.log.push({ t: 'phase_end', phase: state.phase });

  if (state.phase >= state.rules.match.phasesPerGame) {
    finish(state, 'phases-exhausted');
    return;
  }

  state.phase += 1;
  Timeline.beginPhase(state.timeline, state.rules);

  // Both players draw at the start of each Phase after the first. The sources
  // are explicit only about the draw after Phase one; `drawOnlyAfterFirstPhase`
  // carries the narrower reading.
  const draw = state.rules.tactics;
  if (!draw.drawOnlyAfterFirstPhase || state.phase === 2) {
    for (let side = 0; side < 2; side++) {
      State.drawTactics(state, /** @type {0|1} */ (side), draw.drawPerPhase);
    }
  }

  state.round = 1;
  const first = Timeline.firstActiveRound(state.timeline, 1);
  if (first === null) {
    // No tokens at all -- every unit is gone. Nothing can happen in any
    // remaining Phase, so stop rather than spinning through empty ones.
    finish(state, 'no-units');
    return;
  }
  state.round = first;
  state.log.push({ t: 'phase', phase: state.phase });
  state.log.push({ t: 'round', round: state.round, phase: state.phase });
}

/**
 * @param {Object} state
 * @param {string} reason
 */
function finish(state, reason) {
  state.over = true;
  state.result = reason;
  state.winner = leader(state);
  state.activation = null;
  state.log.push({ t: 'game_over', reason: reason, winner: state.winner });
}

/**
 * A convenience for tests, replays and the AI: apply a whole sequence.
 * @param {Object} state
 * @param {Array<Object>} actions
 * @returns {Object}
 */
export function applyAll(state, actions) {
  let s = state;
  for (let i = 0; i < actions.length; i++) s = apply(s, actions[i]);
  return s;
}

/**
 * Where a unit's token currently sits, as `{round, side, index}`. Exposed here
 * because the UI and tests both want it and neither should reach into the
 * Timeline's internals.
 * @param {Object} state
 * @param {string} uid
 * @returns {?Object}
 */
export function tokenAt(state, uid) {
  return Timeline.locate(state.timeline, uid);
}
