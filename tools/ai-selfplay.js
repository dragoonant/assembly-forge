/**
 * AI self-play harness.
 *
 *   node tools/ai-selfplay.js [games] [pairs=all] [weight=value ...]
 *
 * `pairs=all` cycles through every ordered pairing of the four preset teams, so
 * each team plays each other team from both seats equally often. That is what
 * separates a seat advantage (a board or Timeline bias) from a team advantage
 * (a balance problem): the report then gives wins by seat AND by team.
 *
 * Runs whole matches with both sides driven by the AI and reports what
 * actually happened. This is the engine's real test: random play reaches
 * states no hand-written case will invent, and a rules bug shows up here as a
 * crash, a wedge, or a number that cannot be right.
 *
 * It is also the only honest way to judge an AI change. "Seems better" is not
 * a result; "wasted actions 41 -> 0, attacks útil 186 -> 190" is. Run it before
 * and after any change to the evaluator and compare the counters.
 */

import * as AI from '../src/ai/ai.js';
import * as Apply from '../src/engine/apply.js';
import * as State from '../src/engine/state.js';
import { skirmish } from '../src/content/scenarios/skirmish.js';
import { TEAM_ORDER } from '../src/content/teams.js';

const games = Number(process.argv[2] || 40);

// Weight overrides: `node tools/ai-selfplay.js 30 retaliation=0 offence=0.5`
// Sweeping a weight over a fixed set of seeds is the only way to tell whether
// a change helped, so it has to be possible without editing the source.
const overrides = {};
let allPairs = false;
for (let i = 3; i < process.argv.length; i++) {
  const bits = String(process.argv[i]).split('=');
  if (bits[0] === 'pairs') { allPairs = bits[1] === 'all'; continue; }
  if (bits.length === 2) overrides[bits[0]] = Number(bits[1]);
}
const PAIRS = [];
for (let a = 0; a < TEAM_ORDER.length; a++) {
  for (let b = 0; b < TEAM_ORDER.length; b++) PAIRS.push([TEAM_ORDER[a], TEAM_ORDER[b]]);
}
const byTeam = {};
for (let i = 0; i < TEAM_ORDER.length; i++) byTeam[TEAM_ORDER[i]] = { games: 0, wins: 0 };
if (Object.keys(overrides).length) {
  AI.tune(overrides);
  process.stdout.write('tuning: ' + JSON.stringify(overrides) + '\n');
}

const totals = {
  games: 0, wins: [0, 0], draws: 0,
  activations: 0, attacks: 0, kills: 0, rescues: 0,
  garrisonsDestroyed: 0, objectivesScored: 0, statuses: 0,
  energize: 0, dashes: 0, passes: 0, vp: [0, 0],
  abilities: 0, tactics: 0, freeAttacks: 0,
  phases: 0, crashes: 0
};

const failures = [];

for (let i = 0; i < games; i++) {
  const pair = allPairs ? PAIRS[i % PAIRS.length] : null;
  const spec = skirmish(pair
    ? { seed: 'selfplay-' + i, playerTeam: pair[0], enemyTeam: pair[1] }
    : { seed: 'selfplay-' + i });
  let result;
  try {
    result = AI.playOut(State.createGame(spec));
  } catch (e) {
    totals.crashes++;
    failures.push('seed selfplay-' + i + ': ' + e.message);
    continue;
  }

  const s = result.state;
  totals.games++;
  totals.activations += result.activations;
  totals.phases += s.phase;
  totals.vp[0] += s.players[0].vp;
  totals.vp[1] += s.players[1].vp;
  if (s.winner === null) totals.draws++; else totals.wins[s.winner]++;
  if (pair && pair[0] !== pair[1]) {
    for (let side = 0; side < 2; side++) {
      byTeam[pair[side]].games++;
      if (s.winner === side) byTeam[pair[side]].wins++;
    }
  }

  for (let j = 0; j < s.log.length; j++) {
    const e = s.log[j];
    if (e.t === 'attack') { totals.attacks++; if (e.destroyed) totals.kills++; }
    else if (e.t === 'garrison_rescued') totals.rescues++;
    else if (e.t === 'garrison_destroyed') totals.garrisonsDestroyed++;
    else if (e.t === 'objective_scored') totals.objectivesScored++;
    else if (e.t === 'status') totals.statuses++;
    else if (e.t === 'energize') totals.energize++;
    else if (e.t === 'dash') totals.dashes++;
    else if (e.t === 'ability') totals.abilities++;
    else if (e.t === 'tactics') totals.tactics++;
    else if (e.t === 'no_primary') totals.passes++;
  }
}

const per = function (n) { return (n / Math.max(1, totals.games)).toFixed(1); };

process.stdout.write('\nAI self-play over ' + games + ' games\n');
process.stdout.write('-------------------------------------------\n');
process.stdout.write('completed        ' + totals.games + '   crashes ' + totals.crashes + '\n');
process.stdout.write('wins             side 0: ' + totals.wins[0] +
  '   side 1: ' + totals.wins[1] + '   draws: ' + totals.draws + '\n');
process.stdout.write('mean VP          ' + (totals.vp[0] / Math.max(1, totals.games)).toFixed(1) +
  ' vs ' + (totals.vp[1] / Math.max(1, totals.games)).toFixed(1) + '\n');
process.stdout.write('per game:\n');
process.stdout.write('  activations    ' + per(totals.activations) + '\n');
process.stdout.write('  attacks        ' + per(totals.attacks) + '\n');
process.stdout.write('  kills          ' + per(totals.kills) + '\n');
process.stdout.write('  statuses       ' + per(totals.statuses) + '\n');
process.stdout.write('  abilities used ' + per(totals.abilities) + '   <- was zero before scoring them\n');
process.stdout.write('  tactics played ' + per(totals.tactics) + '   <- 9 in hand over the whole game\n');
process.stdout.write('  dashes         ' + per(totals.dashes) + '\n');
process.stdout.write('  rescues        ' + per(totals.rescues) + '\n');
process.stdout.write('  garrisons shot ' + per(totals.garrisonsDestroyed) + '\n');
process.stdout.write('  objectives     ' + per(totals.objectivesScored) + '\n');
process.stdout.write('  energize       ' + per(totals.energize) + '   <- should be near zero\n');
process.stdout.write('  forced passes  ' + per(totals.passes) + '   <- should be zero\n');

if (allPairs) {
  process.stdout.write('wins by team (mixed pairings only):\n');
  for (let i = 0; i < TEAM_ORDER.length; i++) {
    const t = byTeam[TEAM_ORDER[i]];
    process.stdout.write('  ' + TEAM_ORDER[i] + '  ' + t.wins + ' / ' + t.games +
      '  (' + Math.round(100 * t.wins / Math.max(1, t.games)) + '%)\n');
  }
}

if (failures.length) {
  process.stdout.write('\nfailures:\n');
  for (let i = 0; i < Math.min(5, failures.length); i++) {
    process.stdout.write('  ' + failures[i] + '\n');
  }
}

process.exit(totals.crashes ? 1 : 0);
