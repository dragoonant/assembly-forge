/**
 * The Timeline: the scheduler the whole game hangs off.
 *
 * The track is a fixed number of rounds (ten), and every round holds one
 * ordered stack per side. Index 0 is the **top** of a stack and activates
 * first. A unit's token sits on the round it will next act in; taking a
 * Primary Action pushes the token forward by that action's Timeline cost,
 * which is how a cheap action buys you an earlier next turn.
 *
 * **All four stacking rules live in this file and nowhere else.** They
 * interact, and scattering them across the engine guarantees drift:
 *
 *   1. Initial stack order is chosen by the player, at setup only.
 *   2. A token arriving during play joins the **bottom** of the stack.
 *   3. Activation within a round runs top down.
 *   4. When both sides hold the current round, activation begins with the
 *      opponent of whoever acted last.
 *
 * Plus the three tracker rules: rounds with no tokens are skipped, the tracker
 * advances only once every token on it has gone, and a token pushed past the
 * last round waits for the next Phase.
 *
 * Everything here operates on the plain `timeline` sub-tree of the state, so
 * it survives `structuredClone` and can be reasoned about in isolation.
 */

import * as Rng from './rng.js';

/** @typedef {{stacks: [string[], string[]]}} TimelineRound */
/** @typedef {{rounds: TimelineRound[], overflow: [Array<{uid: string, round: number}>, Array<{uid: string, round: number}>]}} Timeline */
/** @typedef {{side: 0|1, round: number, index: number, overflow: boolean}} TokenLocation */

/**
 * @param {0|1} side
 * @returns {0|1}
 */
export function opponent(side) {
  return side === 0 ? 1 : 0;
}

/**
 * An empty track.
 * @param {Object} rules
 * @returns {Timeline}
 */
export function createTimeline(rules) {
  const rounds = [];
  for (let i = 0; i < rules.timeline.rounds; i++) {
    rounds.push({ stacks: [[], []] });
  }
  return { rounds: rounds, overflow: [[], []] };
}

/**
 * Rule 2: put a token on a round, at the **bottom** of that side's stack.
 *
 * Setup uses this too -- it lays tokens down in the order the player chose,
 * which is the same thing as appending each to the bottom. `setSetupOrder`
 * exists for the case where the order is decided after placement.
 *
 * A round beyond the end of the track is not an error: the token goes to the
 * overflow queue and waits for the next Phase (rule 7).
 *
 * @param {Timeline} timeline
 * @param {0|1} side
 * @param {string} uid
 * @param {number} round 1-based
 * @param {Object} rules
 */
export function place(timeline, side, uid, round, rules) {
  if (round < 1) throw new Error('Timeline round must be 1 or greater, got ' + round);
  if (round > rules.timeline.rounds) {
    timeline.overflow[side].push({ uid: uid, round: round });
    return;
  }
  timeline.rounds[round - 1].stacks[side].push(uid);
}

/**
 * Rule 1: apply a player-chosen stack order. Only legal at setup -- nothing in
 * the engine calls this once play has begun.
 *
 * `orderedUids` is the player's whole squad listed top-first. Tokens keep the
 * rounds they were placed on; within each round they are re-sorted to match
 * this order. Any token not named keeps its relative position after the ones
 * that were.
 *
 * @param {Timeline} timeline
 * @param {0|1} side
 * @param {string[]} orderedUids
 */
export function setSetupOrder(timeline, side, orderedUids) {
  const rank = {};
  for (let i = 0; i < orderedUids.length; i++) rank[orderedUids[i]] = i;
  for (let i = 0; i < timeline.rounds.length; i++) {
    const stack = timeline.rounds[i].stacks[side];
    const decorated = stack.map(function (uid, index) {
      const named = Object.prototype.hasOwnProperty.call(rank, uid);
      return { uid: uid, rank: named ? rank[uid] : Infinity, index: index };
    });
    decorated.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.index - b.index;
    });
    timeline.rounds[i].stacks[side] = decorated.map(function (d) { return d.uid; });
  }
}

/**
 * Where a token is, or null if it is not on the track at all.
 * @param {Timeline} timeline
 * @param {string} uid
 * @returns {?TokenLocation}
 */
export function locate(timeline, uid) {
  for (let r = 0; r < timeline.rounds.length; r++) {
    for (let side = 0; side < 2; side++) {
      const index = timeline.rounds[r].stacks[side].indexOf(uid);
      if (index !== -1) {
        return { side: /** @type {0|1} */ (side), round: r + 1, index: index, overflow: false };
      }
    }
  }
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < timeline.overflow[side].length; i++) {
      if (timeline.overflow[side][i].uid === uid) {
        return {
          side: /** @type {0|1} */ (side),
          round: timeline.overflow[side][i].round,
          index: i,
          overflow: true
        };
      }
    }
  }
  return null;
}

/**
 * Take a token off the track entirely. Returns its old location, or null.
 * @param {Timeline} timeline
 * @param {string} uid
 * @returns {?TokenLocation}
 */
export function remove(timeline, uid) {
  const at = locate(timeline, uid);
  if (!at) return null;
  if (at.overflow) timeline.overflow[at.side].splice(at.index, 1);
  else timeline.rounds[at.round - 1].stacks[at.side].splice(at.index, 1);
  return at;
}

/**
 * Push a token forward. This is the only way a token ever moves during play:
 * a Primary Action pushes it by the action's Timeline cost, and destruction
 * pushes it by `rules.destruction.tokenPushRounds`.
 *
 * It always lands at the bottom of its new stack (rule 2), and past the end of
 * the track it joins the overflow queue (rule 7).
 *
 * @param {Timeline} timeline
 * @param {string} uid
 * @param {number} rounds how many rounds forward
 * @param {Object} rules
 * @returns {number} the round it landed on, which may exceed the track length
 */
export function push(timeline, uid, rounds, rules) {
  const at = locate(timeline, uid);
  if (!at) throw new Error('No Timeline token for ' + uid);
  remove(timeline, uid);
  const target = at.round + rounds;
  place(timeline, at.side, uid, target, rules);
  return target;
}

/**
 * Does this round hold any token at all?
 * @param {Timeline} timeline
 * @param {number} round
 * @returns {boolean}
 */
export function roundIsEmpty(timeline, round) {
  if (round < 1 || round > timeline.rounds.length) return true;
  const stacks = timeline.rounds[round - 1].stacks;
  return stacks[0].length === 0 && stacks[1].length === 0;
}

/**
 * Rule 5: rounds holding no tokens are skipped. The lowest round at or after
 * `from` that holds a token, or null if the rest of the track is empty.
 *
 * @param {Timeline} timeline
 * @param {number} from 1-based
 * @returns {?number}
 */
export function firstActiveRound(timeline, from) {
  for (let r = Math.max(1, from); r <= timeline.rounds.length; r++) {
    if (!roundIsEmpty(timeline, r)) return r;
  }
  return null;
}

/**
 * Rules 3 and 4: who acts next on the current round.
 *
 * Rule 3 gives the unit -- the top of the chosen stack. Rule 4 gives the
 * stack: when both sides hold the round, it is the opponent of whoever acted
 * last. See `rules.timeline.alternateWithinRound` for the reading of "begins
 * with" that this implements.
 *
 * @param {Object} state
 * @returns {?{side: 0|1, uid: string}}
 */
export function nextActivation(state) {
  const round = state.round;
  if (round < 1 || round > state.timeline.rounds.length) return null;
  const stacks = state.timeline.rounds[round - 1].stacks;
  if (!stacks[0].length && !stacks[1].length) return null;
  const side = chooseSide(stacks, state.lastActedSide, state.lastActedRound, round, state.rules);
  return { side: side, uid: stacks[side][0] };
}

/**
 * @param {[string[], string[]]} stacks
 * @param {?0|1} lastActedSide
 * @param {?number} lastActedRound
 * @param {number} round
 * @param {Object} rules
 * @returns {0|1}
 */
function chooseSide(stacks, lastActedSide, lastActedRound, round, rules) {
  if (!stacks[0].length) return 1;
  if (!stacks[1].length) return 0;
  // Both sides hold the round.
  if (lastActedSide === null || lastActedSide === undefined) return 0;
  if (!rules.timeline.alternateWithinRound && lastActedRound === round) {
    // The narrow reading: whoever started the round empties their stack first.
    return /** @type {0|1} */ (lastActedSide);
  }
  return opponent(/** @type {0|1} */ (lastActedSide));
}

/**
 * The game-start initiative roll: one attack die each, higher goes first.
 * Only called when both players hold a token on the first active round -- the
 * rule says nothing about the case where they do not, and rolling anyway would
 * burn a random number for no reason and change every downstream roll.
 *
 * @param {number} rngState
 * @param {Object} rules
 * @returns {{state: number, value: 0|1, rolls: Array<[number, number]>}}
 */
export function rollInitiative(rngState, rules) {
  const sides = rules.timeline.initiativeDieSides;
  const rolls = [];
  let s = rngState;
  for (;;) {
    const a = Rng.roll(s, sides);
    const b = Rng.roll(a.state, sides);
    s = b.state;
    rolls.push([a.value, b.value]);
    if (a.value !== b.value) {
      return { state: s, value: a.value > b.value ? 0 : 1, rolls: rolls };
    }
    if (!rules.timeline.initiativeRerollTies) {
      return { state: s, value: 0, rolls: rolls };
    }
  }
}

/**
 * Rule 7, second half: at the start of a Phase, tokens that overran the end of
 * the track come back onto it. `rules.timeline.overflow` decides where.
 *
 * They are materialised in the order they overran, each to the bottom of its
 * new stack, so a token that was pushed off first sits above one pushed off
 * later.
 *
 * @param {Timeline} timeline
 * @param {Object} rules
 */
export function beginPhase(timeline, rules) {
  const total = rules.timeline.rounds;
  for (let side = 0; side < 2; side++) {
    const queued = timeline.overflow[side];
    timeline.overflow[side] = [];
    for (let i = 0; i < queued.length; i++) {
      const round = rules.timeline.overflow === 'reset'
        ? 1
        : ((queued[i].round - 1) % total) + 1;
      place(timeline, /** @type {0|1} */ (side), queued[i].uid, round, rules);
    }
  }
}

/**
 * How many tokens are on the track, overflow included. Zero means the Phase
 * has nothing left to run.
 * @param {Timeline} timeline
 * @returns {number}
 */
export function tokenCount(timeline) {
  let n = timeline.overflow[0].length + timeline.overflow[1].length;
  for (let r = 0; r < timeline.rounds.length; r++) {
    n += timeline.rounds[r].stacks[0].length + timeline.rounds[r].stacks[1].length;
  }
  return n;
}
