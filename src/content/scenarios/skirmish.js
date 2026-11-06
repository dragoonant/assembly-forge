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

/**
 * The retail starter board's grid: 14 columns by 15 rows of pointy-top hexes,
 * odd rows one hex shorter and inset half a hex at each end, 203 hexes in all
 * (PLAN.md D6). Only the grid is the publisher's; everything placed on it here
 * is this project's own layout.
 *
 * The players sit at the left and right edges. The layout is point-symmetric
 * about the centre hex, so neither side has a better board: every feature on
 * side 0's half is mirrored onto side 1's by `mirror`.
 */
const COLS = 14;
const ROWS = 15;

/** Hexes in a row: long rows are 14, short (odd) rows 13. */
function rowLength(row) {
  return row & 1 ? COLS - 1 : COLS;
}

/** The point opposite `[col, row]` through the centre of the board. */
function mirror(pair) {
  const row = ROWS - 1 - pair[1];
  return [rowLength(row) - 1 - pair[0], row];
}

/**
 * Side 0's half of the terrain, `[col, row]` -> `{terrain, elevation}`. Each
 * entry is mirrored onto the other half; the centre hex (6, 7) mirrors onto
 * itself.
 *
 *   - A raised spine across the middle, two levels at the centre, which is the
 *     high ground both sides want and the objective everyone has to contest.
 *   - A shallow stream on each flank that slows anything crossing it.
 *   - Debris fields and two wreck stacks that break up long firing lanes.
 */
const HALF_TERRAIN = [
  [[6, 7], { elevation: 2 }],
  [[5, 7], { elevation: 1 }],
  [[6, 6], { elevation: 1 }],
  [[5, 8], { elevation: 1 }],
  [[4, 5], { elevation: 1 }],
  [[3, 2], { terrain: 'water' }],
  [[3, 3], { terrain: 'water' }],
  [[4, 4], { terrain: 'water' }],
  [[2, 9], { terrain: 'debris' }],
  [[3, 10], { terrain: 'debris' }],
  [[8, 3], { terrain: 'debris' }],
  [[5, 11], { terrain: 'blocked' }],
  [[9, 5], { terrain: 'blocked' }]
];

function terrainLayout(half) {
  const out = [];
  const seen = {};
  for (let i = 0; i < half.length; i++) {
    const pair = half[i][0];
    const pairs = [pair, mirror(pair)];
    for (let j = 0; j < pairs.length; j++) {
      const k = pairs[j][0] + ',' + pairs[j][1];
      if (seen[k]) continue;
      seen[k] = true;
      out.push([pairs[j], half[i][1]]);
    }
  }
  return out;
}

/** One Base per side, in the middle of each player's edge. Units deploy from it. */
const BASES = [
  { bid: 'base0', side: 0, at: [0, 7] },
  { bid: 'base1', side: 1, at: mirror([0, 7]) }
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
  const order = Teams.teamOrder();
  const fallback = Teams.hasTeam(DEFAULT_TEAMS[0]) ? DEFAULT_TEAMS : [order[0], order[1] || order[0]];
  const a = playerTeam && Teams.hasTeam(playerTeam) ? playerTeam : fallback[0];
  const b = enemyTeam && Teams.hasTeam(enemyTeam) ? enemyTeam : fallback[1];
  return [Teams.team(a).units.slice(), Teams.team(b).units.slice()];
}

/**
 * Two Garrisons per side, out on the flanks of each player's own half: close
 * enough to Rescue early, exposed enough that the enemy can reach them.
 */
const HALF_GARRISONS = [[3, 1], [2, 12]];

/**
 * Three neutral Objectives, scored at the end of each Phase by whoever controls
 * them: the high centre is worth the most, the two flanks less. Our own values;
 * the published demo scenario's numbers are not used.
 */
const OBJECTIVES = [
  { oid: 'o1', at: [6, 7], vp: 6 },
  { oid: 'o2', at: [6, 2], vp: 4 },
  { oid: 'o3', at: mirror([6, 2]), vp: 4 }
];

/**
 * Map pickups, mirrored: on each half a Shield and a Speed Upgrade out on the flanks and an Energy
 * token on the approach to the centre. A machine collects one by ending a move on it.
 */
const HALF_PICKUPS = [
  { kind: 'upgrade', upgrade: 'shield', at: [4, 1] },
  { kind: 'upgrade', upgrade: 'speed', at: [4, 12] },
  { kind: 'energy', at: [4, 7] }
];

/**
 * This project's own layout. A layout is authored as side 0's half: `terrain` and `pickups` are mirrored onto the
 * other half, `garrisons` are side 0's and mirror onto side 1's, and `objectives` is the whole list. Another layout of
 * the same shape can be passed to `skirmish({layout})`; one kept in the git-ignored local pack folder is how a
 * published scenario is tried in self-play without entering the repository.
 */
export const OUR_LAYOUT = Object.freeze({
  id: 'ours',
  terrain: HALF_TERRAIN,
  garrisons: HALF_GARRISONS,
  objectives: OBJECTIVES,
  pickups: HALF_PICKUPS
});

function garrisonLayout(half) {
  const out = [];
  for (let i = 0; i < half.length; i++) out.push({ gid: 'g' + (i + 1), side: 0, at: half[i] });
  for (let i = 0; i < half.length; i++) out.push({ gid: 'g' + (half.length + i + 1), side: 1, at: mirror(half[i]) });
  return out;
}

function pickupLayout(half) {
  const out = [];
  for (let i = 0; i < half.length; i++) {
    const p = half[i];
    out.push({ pid: 'p' + (2 * i + 1), kind: p.kind, upgrade: p.upgrade, at: p.at });
    out.push({ pid: 'p' + (2 * i + 2), kind: p.kind, upgrade: p.upgrade, at: mirror(p.at) });
  }
  return out;
}

function axial(pair) {
  return Hex.fromOffset(pair[0], pair[1]);
}

/** Exported for tests: the layout's own parts, as axial hexes. */
export const LAYOUT = Object.freeze({
  cols: COLS,
  rows: ROWS,
  bases: BASES.map(function (b) { return { bid: b.bid, side: b.side, hex: axial(b.at) }; }),
  mirror: mirror
});

/**
 * @param {Object} [opts] `{seed, rules, playerSquad, enemySquad, playerTeam, enemyTeam, decks, layout}`; `layout` is
 *        `OUR_LAYOUT` unless given. A squad is an array
 *        of three unit ids from `Units.pool()`; an illegal one is ignored. Team ids from `src/content/teams.js` are the
 *        older way to choose and are used only when no squad is given. The same squad on both sides is a legal mirror. `decks` is an optional
 *        `[cids | null, cids | null]`, the players' own choice of cards; a side without a legal choice gets the
 *        suggested deck.
 * @returns {Object} a spec for `State.createGame`
 */
export function skirmish(opts) {
  const o = opts || {};
  const layout = o.layout || OUR_LAYOUT;
  const hexes = {};
  const terrain = terrainLayout(layout.terrain);
  for (let i = 0; i < terrain.length; i++) {
    hexes[Hex.key(axial(terrain[i][0]))] = terrain[i][1];
  }

  // A squad given directly (any three units from the pool, a unit once unless Mass Produced) wins over a preset team.
  const squads = squadsFor(o.playerTeam, o.enemyTeam);
  if (o.playerSquad && Units.isLegalSquad(o.playerSquad, SQUAD_SIZE)) squads[0] = o.playerSquad.slice();
  if (o.enemySquad && Units.isLegalSquad(o.enemySquad, SQUAD_SIZE)) squads[1] = o.enemySquad.slice();
  // nine cards, plus three for each Phase beyond two (rulebook 2026-10-30, "Building a Deck")
  const phases = (o.rules && o.rules.match && o.rules.match.phasesPerGame) || 2;
  const size = 9 + 3 * Math.max(0, phases - 2);

  const units = [];
  const decks = [[], []];
  for (let side = 0; side < 2; side++) {
    const defs = [];
    for (let i = 0; i < squads[side].length; i++) {
      const defId = squads[side][i];
      const uid = (side === 0 ? 'a' : 'b') + (i + 1);
      // No hex: every machine starts in Reserve and deploys from its Base.
      units.push(Units.instance(uid, defId, /** @type {0|1} */ (side), null));
      defs.push(Units.def(defId));
    }
    // Each side gets the deck its own squad qualifies for, so the two decks
    // differ -- which is the point of gating cards on traits.
    const chosen = o.decks && o.decks[side];
    const cids = chosen && Tactics.isLegalDeck(chosen, defs, size) ? chosen.slice() : Tactics.buildDeck(defs, size);
    decks[side] = cids.map(function (cid) {
      return JSON.parse(JSON.stringify(Tactics.card(cid)));
    });
  }

  return {
    id: 'skirmish',
    seed: o.seed === undefined ? 'skirmish' : o.seed,
    rules: o.rules,
    board: { cols: COLS, rows: ROWS, shortRows: true, hexes: hexes },
    bases: LAYOUT.bases,
    pickups: pickupLayout(layout.pickups).map(function (p) {
      return { pid: p.pid, kind: p.kind, upgrade: p.upgrade, hex: axial(p.at) };
    }),
    units: units,
    tactics: decks,
    garrisons: garrisonLayout(layout.garrisons).map(function (g) {
      return { gid: g.gid, side: g.side, hex: axial(g.at) };
    }),
    objectives: layout.objectives.map(function (o2) {
      return { oid: o2.oid, hex: axial(o2.at), vp: o2.vp };
    })
  };
}
