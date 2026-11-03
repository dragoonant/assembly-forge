/**
 * A scenario, in the shape `State.createGame` wants.
 *
 * This one exists so the scaffold has something to draw and so the engine gets
 * exercised outside the tests. The board is real; the stat lines are
 * placeholders sitting inside the ranges the reconstruction observed, and the
 * content milestone replaces them with the roster's own numbers, weapons and
 * abilities.
 *
 * Positions are authored as offset (column, row) pairs, because a rectangular
 * map is what a human draws, and converted to axial here. Nothing downstream
 * ever sees an offset coordinate.
 */

import * as Hex from '../../engine/hex.js';
import * as Tactics from '../tactics.js';
import * as Teams from '../teams.js';
import * as Units from '../units.js';

const COLS = 11;
const ROWS = 7;

/** `[col, row]` -> `{terrain, elevation}`. */
const TERRAIN = [
  [[4, 2], { elevation: 1 }],
  [[4, 3], { elevation: 1 }],
  [[4, 4], { elevation: 1 }],
  [[6, 2], { elevation: 1 }],
  [[6, 4], { elevation: 1 }],
  [[5, 0], { terrain: 'water' }],
  [[5, 1], { terrain: 'water' }],
  [[5, 5], { terrain: 'water' }],
  [[5, 6], { terrain: 'water' }],
  [[2, 3], { terrain: 'rough' }],
  [[8, 3], { terrain: 'rough' }],
  [[3, 0], { terrain: 'blocked' }],
  [[7, 6], { terrain: 'blocked' }]
];

/**
 * Three a side, drawn from the roster in `src/content/units.js`. Stat lines,
 * weapons and crit effects all come from the definition -- nothing is restated
 * here, so a balance change lands in one place.
 *
 * The split gives each side one durable machine, one long threat and one
 * closer, so neither squad is strictly better at anything.
 */
/**
 * Deployment hexes, three a side. Which machine stands on which is decided at
 * squad select; only the positions are fixed here.
 */
const DEPLOY = [
  [[0, 1], [0, 3], [0, 5]],
  [[10, 1], [10, 3], [10, 5]]
];

/** Used when nobody has chosen — the two doctrines that were the old fixed sides. */
const DEFAULT_TEAMS = ['t_lance', 't_anvil'];

/** This scenario's id, for looking its briefing up in `names.js`. */
export const SCENARIO_ID = 'skirmish';

/** How many machines each side fields here. */
export const SQUAD_SIZE = 3;

/**
 * The two squads, from each side's chosen team.
 *
 * Both sides draw from the same four preset teams and the same six machines,
 * so a mirror match is legal and both sides can field the same definition. The
 * instance ids keep them apart; nothing downstream cares that two units share
 * a `defId`.
 *
 * @param {string} [playerTeam]
 * @param {string} [enemyTeam]
 * @returns {[string[], string[]]}
 */
export function squadsFor(playerTeam, enemyTeam) {
  const a = Teams.TEAMS[playerTeam] ? playerTeam : DEFAULT_TEAMS[0];
  const b = Teams.TEAMS[enemyTeam] ? enemyTeam : DEFAULT_TEAMS[1];
  return [Teams.team(a).units.slice(), Teams.team(b).units.slice()];
}

const GARRISONS = [
  { gid: 'g1', side: 0, at: [2, 1] },
  { gid: 'g2', side: 1, at: [8, 5] }
];

const OBJECTIVES = [
  { oid: 'o1', at: [5, 3], vp: 2 }
];

function axial(pair) {
  return Hex.fromOffset(pair[0], pair[1]);
}

/**
 * @param {Object} [opts] `{seed, rules, playerTeam, enemyTeam}` — team ids from
 *        `src/content/teams.js`. The same id on both sides is a legal mirror.
 * @returns {Object} a spec for `State.createGame`
 */
export function skirmish(opts) {
  const o = opts || {};
  const hexes = {};
  for (let i = 0; i < TERRAIN.length; i++) {
    hexes[Hex.key(axial(TERRAIN[i][0]))] = TERRAIN[i][1];
  }

  const squads = squadsFor(o.playerTeam, o.enemyTeam);

  const units = [];
  const decks = [[], []];
  for (let side = 0; side < 2; side++) {
    const defs = [];
    for (let i = 0; i < squads[side].length; i++) {
      const defId = squads[side][i];
      const uid = (side === 0 ? 'a' : 'b') + (i + 1);
      units.push(Units.instance(uid, defId, /** @type {0|1} */ (side), axial(DEPLOY[side][i])));
      defs.push(Units.def(defId));
    }
    // Each side gets the deck its own squad qualifies for, so the two decks
    // differ -- which is the point of gating cards on traits.
    decks[side] = Tactics.buildDeck(defs).map(function (cid) {
      return JSON.parse(JSON.stringify(Tactics.card(cid)));
    });
  }

  return {
    id: 'skirmish',
    seed: o.seed === undefined ? 'skirmish' : o.seed,
    rules: o.rules,
    board: { cols: COLS, rows: ROWS, hexes: hexes },
    units: units,
    tactics: decks,
    garrisons: GARRISONS.map(function (g) {
      return { gid: g.gid, side: g.side, hex: axial(g.at) };
    }),
    objectives: OBJECTIVES.map(function (o2) {
      return { oid: o2.oid, hex: axial(o2.at), vp: o2.vp };
    })
  };
}
