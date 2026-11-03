/**
 * Line of sight.
 *
 * Traced centre to centre, and only checked at all from `combat.losMinRange`
 * hexes out -- an adjacent target is always visible. Facing does not exist in
 * this game, so sight is symmetric in geometry but NOT in elevation: the two
 * elevation rules below both depend on who is looking.
 *
 * What blocks a line, from the reconstruction:
 *
 *   - terrain flagged `blocksLos`, and anything off the board;
 *   - a hex higher than the attacker, met before the target;
 *   - when the attacker is higher than the target, a hex at the attacker's own
 *     elevation, met first -- shooting down a slope, the lip of the slope is
 *     what gets in the way;
 *   - an intervening enemy unit, garrison or objective marker. The target
 *     itself never blocks, and neither do the attacker's own units, which is
 *     the source's reading rather than an obvious one.
 *
 * The endpoints are never tested; only the hexes strictly between them.
 *
 * THE BOUNDARY CASE. A line running exactly between two hexes has no single
 * answer, and the source material says so explicitly rather than resolving it.
 * `combat.losBoundary` picks a reading:
 *
 *   'permissive'  the shot is blocked only where BOTH flanking hexes block.
 *                 Implemented by tracing twice with opposite tie-breaks and
 *                 comparing step by step -- where the two traces disagree, the
 *                 line was running along a boundary, and that step is treated
 *                 as clear unless both sides of it block.
 *   'nudge'       take one deterministic line and accept whatever it hits.
 *   'strict'      the mirror of permissive: blocked if EITHER flanking hex
 *                 blocks.
 *
 * This is open question 3. Nothing in the sources settles it.
 */

import * as Hex from './hex.js';
import * as State from './state.js';

/** The mirror of `Hex.LINE_NUDGE`, which tips every boundary the other way. */
const MIRROR_NUDGE = Object.freeze({
  x: -Hex.LINE_NUDGE.x, y: -Hex.LINE_NUDGE.y, z: -Hex.LINE_NUDGE.z
});

/**
 * @typedef {Object} LosContext
 * @property {0|1} side            who is looking
 * @property {number} fromElev
 * @property {number} toElev
 * @property {?string} targetUid   never blocks its own line
 */

/**
 * Both candidate traces between two hexes. One line unless the boundary rule
 * asks for two, and even then only when the two actually differ.
 *
 * @param {Object} state
 * @param {{q: number, r: number}} from
 * @param {{q: number, r: number}} to
 * @returns {Array<Array<{q: number, r: number}>>}
 */
export function traces(state, from, to) {
  const primary = Hex.line(from, to);
  if (state.rules.combat.losBoundary === 'nudge') return [primary];

  const mirror = Hex.line(from, to, { nudge: MIRROR_NUDGE });
  for (let i = 0; i < primary.length; i++) {
    if (!Hex.equals(primary[i], mirror[i])) return [primary, mirror];
  }
  return [primary];
}

/**
 * Does a single intervening hex block?
 *
 * @param {Object} state
 * @param {{q: number, r: number}} h
 * @param {LosContext} ctx
 * @returns {boolean}
 */
export function blocksAt(state, h, ctx) {
  const cell = State.cellAt(state, h);
  if (!cell) return true;

  const kind = State.terrainAt(state, h);
  if (kind && kind.blocksLos) return true;

  // Elevation. Both readings are the attacker's, not the target's.
  if (cell.elevation > ctx.fromElev) return true;
  if (ctx.fromElev > ctx.toElev && cell.elevation === ctx.fromElev) return true;

  const blockers = state.rules.combat.losBlockers;

  const u = State.unitAt(state, h);
  if (u && u.uid !== ctx.targetUid) {
    if (u.side !== ctx.side ? blockers.enemyUnits : blockers.friendlyUnits) return true;
  }

  if (blockers.garrisons && State.garrisonAt(state, h)) return true;
  if (blockers.objectives && State.objectiveAt(state, h)) return true;

  return false;
}

/**
 * Trace a line and report where, if anywhere, it is stopped.
 *
 * @param {Object} state
 * @param {{q: number, r: number}} from
 * @param {{q: number, r: number}} to
 * @param {{side: 0|1, targetUid?: ?string}} opts
 * @returns {{clear: boolean, blockedAt: ?{q: number, r: number}, range: number}}
 */
export function trace(state, from, to, opts) {
  const range = Hex.distance(from, to);
  const combat = state.rules.combat;

  if (range < combat.losMinRange) {
    return { clear: true, blockedAt: null, range: range };
  }

  const ctx = {
    side: opts.side,
    fromElev: State.elevationAt(state, from),
    toElev: State.elevationAt(state, to),
    targetUid: opts.targetUid === undefined ? null : opts.targetUid
  };

  const lines = traces(state, from, to);
  const steps = lines[0].length;

  // Step by step down the trace, skipping both endpoints. With two candidate
  // lines the step is judged by the boundary rule; with one it is judged
  // directly, which is the same code with a single-element array.
  for (let i = 1; i < steps - 1; i++) {
    let blockedCount = 0;
    for (let j = 0; j < lines.length; j++) {
      if (blocksAt(state, lines[j][i], ctx)) blockedCount++;
    }

    let blocked;
    if (lines.length === 1) {
      blocked = blockedCount === 1;
    } else if (combat.losBoundary === 'strict') {
      blocked = blockedCount > 0;
    } else {
      blocked = blockedCount === lines.length;
    }

    if (blocked) return { clear: false, blockedAt: lines[0][i], range: range };
  }

  return { clear: true, blockedAt: null, range: range };
}

/**
 * @param {Object} state
 * @param {{q: number, r: number}} from
 * @param {{q: number, r: number}} to
 * @param {{side: 0|1, targetUid?: ?string}} opts
 * @returns {boolean}
 */
export function hasLos(state, from, to, opts) {
  return trace(state, from, to, opts).clear;
}
