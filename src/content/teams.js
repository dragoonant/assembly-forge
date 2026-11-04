/**
 * Preset squads.
 *
 * A player picks a whole team rather than assembling one machine at a time.
 * Both sides draw from the same four, and both may field the SAME team — the
 * mirror match is legal, and is the cleanest way to see whether a team is
 * actually strong or just favourably matched.
 *
 * Every team is three machines, which is `SQUAD_SIZE` for the skirmish
 * scenario. Each is built around a way of winning rather than around a colour:
 * the game pays points for kills, for garrisons, and for holding an objective,
 * and no team is good at all three.
 *
 * Names and descriptions live in `src/content/names.js` with everything else a
 * player reads. This file is composition only.
 */

import { activePack } from './packs.js';

/** @typedef {{tid: string, units: string[]}} Team */

export const TEAMS = Object.freeze({
  // Reach and burst. Wins by removing something expensive before it arrives.
  t_lance: Object.freeze({ tid: 't_lance', units: Object.freeze(['u03', 'u02', 'u01']) }),

  // Everything hits hard at close range and nothing is in a hurry.
  t_hammer: Object.freeze({ tid: 't_hammer', units: Object.freeze(['u05', 'u04', 'u01']) }),

  // Built to stand on the objective and make leaving it the enemy's problem.
  t_anvil: Object.freeze({ tid: 't_anvil', units: Object.freeze(['u06', 'u01', 'u04']) }),

  // The two highest bounties in the roster plus the fastest machine. Hits
  // hardest and concedes most when it loses.
  t_spear: Object.freeze({ tid: 't_spear', units: Object.freeze(['u05', 'u03', 'u02']) })
});

/** Menu order for the built-in cast. Use `teamOrder()`, which follows the active pack. */
export const TEAM_ORDER = Object.freeze(['t_lance', 't_hammer', 't_anvil', 't_spear']);

/** @returns {string[]} the active pack's team order, or the built-in one */
export function teamOrder() {
  const pack = activePack();
  return pack ? pack.teamOrder.slice() : TEAM_ORDER.slice();
}

/**
 * @param {string} tid
 * @returns {boolean}
 */
export function hasTeam(tid) {
  const pack = activePack();
  return Boolean(pack ? pack.teams[tid] : TEAMS[tid]);
}

/**
 * @param {string} tid
 * @returns {Team}
 */
export function team(tid) {
  const pack = activePack();
  const t = pack ? pack.teams[tid] && { tid: tid, units: pack.teams[tid].units } : TEAMS[tid];
  if (!t) throw new Error('No team: ' + tid);
  return t;
}

/**
 * Pick a team for the opponent.
 *
 * Uses the seeded generator rather than `Math.random`, so a game set up from a
 * given seed is reproducible all the way from squad select — which matters for
 * self-play and for reproducing a bug report.
 *
 * @param {Object} rngStep a `{state, value}` supplier — pass `Rng.int`
 * @param {number} rngState
 * @returns {{tid: string, state: number}}
 */
export function pickOpponentTeam(rngStep, rngState) {
  const order = teamOrder();
  const r = rngStep(rngState, order.length);
  return { tid: order[r.value], state: r.state };
}
