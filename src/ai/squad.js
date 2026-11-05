/**
 * Squad picking for the AI side.
 *
 * A squad is any three units from the pool, each at most once unless it is Mass Produced (rulebook 2026-10-30,
 * "Building a Squad"). The AI picks one of three ways:
 *
 *   random -- any legal squad, uniformly.
 *   easy   -- a squad the player's squad counters well: the units with the worst record against the player's.
 *   hard   -- a counter-pick: the units with the best record against the player's.
 *
 * "Record" is data, not opinion: `matchups.json` is a unit-versus-unit table written by `tools/ai-matchups.js`, which
 * plays AI-versus-AI games across random squads and counts, for every pair of units on opposite sides, how often each
 * one's side won. A squad's score against the player's squad is the sum, over every pairing, of how far that unit's
 * win rate against the other is from even. Easy and hard each take a random squad from the five scored worst or best,
 * so the AI does not field the same three every time.
 *
 * Pure and deterministic: the generator state comes in and the advanced state goes out, as everywhere in the engine.
 */

import * as Rng from '../engine/rng.js';
import * as Units from '../content/units.js';
import TABLE from './matchups.json' with { type: 'json' };

export const DIFFICULTIES = Object.freeze(['random', 'easy', 'hard']);

/** How many of the best (or worst) scored squads easy and hard choose among. */
export const SHORTLIST = 5;

/**
 * Every legal squad from a pool, each once, as sorted arrays in pool order.
 * @param {string[]} pool unit ids
 * @param {number} [size]
 * @returns {string[][]}
 */
export function legalSquads(pool, size) {
  const n = size === undefined ? Units.SQUAD_SIZE : size;
  const out = [];
  const mass = function (d) { return (Units.def(d).traits || []).indexOf('mass-produced') !== -1; };
  const walk = function (start, squad) {
    if (squad.length === n) {
      out.push(squad.slice());
      return;
    }
    for (let i = start; i < pool.length; i++) {
      const d = pool[i];
      // a repeat is allowed only for a Mass Produced unit, and only as consecutive copies (so each squad appears once)
      if (squad.indexOf(d) !== -1 && !mass(d)) continue;
      squad.push(d);
      walk(mass(d) ? i : i + 1, squad);
      squad.pop();
    }
  };
  walk(0, []);
  return out;
}

/**
 * A uniformly random legal squad.
 * @param {string[]} pool
 * @param {number} rng generator state
 * @returns {{squad: string[], rng: number}}
 */
export function randomSquad(pool, rng) {
  const all = legalSquads(pool);
  const r = Rng.int(rng, all.length);
  return { squad: all[r.value].slice(), rng: r.state };
}

/**
 * The win rate of unit `a`'s side against unit `b`'s side in the table, smoothed toward even when the table has few
 * games for the pair, or 0.5 when it has none. Pack units are looked up by their built-in counterpart.
 * @param {string} a
 * @param {string} b
 * @param {Object} [table]
 * @returns {number}
 */
export function matchupRate(a, b, table) {
  const t = table || TABLE;
  const ka = Units.counterpartOf(a);
  const kb = Units.counterpartOf(b);
  const cell = t.vs && t.vs[ka] && t.vs[ka][kb];
  if (!cell) return 0.5;
  return (cell.wins + 2) / (cell.games + 4);
}

/**
 * How well a squad does against another, by the table: the sum over every pairing of (win rate - 0.5).
 * Positive means `mine` tends to beat `theirs`.
 * @param {string[]} mine
 * @param {string[]} theirs
 * @param {Object} [table]
 * @returns {number}
 */
export function squadEdge(mine, theirs, table) {
  let score = 0;
  for (const a of mine) for (const b of theirs) score += matchupRate(a, b, table) - 0.5;
  return score;
}

/**
 * Pick the AI's squad.
 *
 * @param {string[]} pool the unit ids a squad may use, in menu order (`Units.pool()`)
 * @param {string[]} playerSquad the squad the AI is answering
 * @param {'random'|'easy'|'hard'} difficulty
 * @param {number} rng generator state (`Rng.seedFrom(seed)`)
 * @param {Object} [table] a matchup table in the shape of matchups.json; the committed one by default
 * @returns {{squad: string[], rng: number}}
 */
export function pickSquad(pool, playerSquad, difficulty, rng, table) {
  const all = legalSquads(pool);
  if (!all.length) throw new Error('No legal squad in a pool of ' + pool.length);
  if (difficulty !== 'easy' && difficulty !== 'hard') {
    const r = Rng.int(rng, all.length);
    return { squad: all[r.value].slice(), rng: r.state };
  }
  const scored = all.map(function (sq, i) { return { sq: sq, i: i, edge: squadEdge(sq, playerSquad || [], table) }; });
  // hard wants the biggest edge over the player, easy the smallest; ties keep pool order, so the result is stable
  scored.sort(function (x, y) {
    const d = difficulty === 'hard' ? y.edge - x.edge : x.edge - y.edge;
    return d || x.i - y.i;
  });
  const shortlist = scored.slice(0, Math.min(SHORTLIST, scored.length));
  const r = Rng.int(rng, shortlist.length);
  return { squad: shortlist[r.value].sq.slice(), rng: r.state };
}

/** The table pickSquad reads by default, for tools and tests. */
export const MATCHUPS = TABLE;
