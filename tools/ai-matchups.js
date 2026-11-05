/**
 * Unit-versus-unit matchup table, from AI self-play across random squads.
 *
 *   node tools/ai-matchups.js [games] [workers=N] [out=src/ai/matchups.json]
 *
 * Every game gives each side a random legal squad from the built-in pool (three units, a unit once unless it is Mass
 * Produced) and plays it out with the AI on both sides. For every unit A on one side and unit B on the other (each
 * counted once per side, and never when the same unit is on both sides) the table counts a game for A against B, and a
 * win when A's side won. It also keeps each unit's overall record. `src/ai/squad.js` reads the table to counter-pick.
 *
 * Games run in parallel worker processes, one slice of the game indices each, so the result is the same for any number
 * of workers: game i always uses the squads seeded 'matchup-squads-i' and the game seed 'matchup-i'.
 *
 * About 2.5 seconds a game on one core. 4000 games on 20 workers takes under ten minutes.
 */

import { fork } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

import * as AI from '../src/ai/ai.js';
import * as Rng from '../src/engine/rng.js';
import * as Squad from '../src/ai/squad.js';
import * as State from '../src/engine/state.js';
import * as Units from '../src/content/units.js';
import { skirmish } from '../src/content/scenarios/skirmish.js';

const SELF = fileURLToPath(import.meta.url);

/** The squads for game i: the same on every machine and for any number of workers. */
export function squadsFor(i) {
  const a = Squad.randomSquad(Units.pool(), Rng.seedFrom('matchup-squads-' + i));
  const b = Squad.randomSquad(Units.pool(), a.rng);
  return [a.squad, b.squad];
}

function playGame(i) {
  const squads = squadsFor(i);
  try {
    const out = AI.playOut(State.createGame(skirmish({ seed: 'matchup-' + i, playerSquad: squads[0], enemySquad: squads[1] })));
    const passes = out.state.log.filter(function (e) { return e.t === 'no_primary'; }).length;
    return { i: i, squads: squads, winner: out.state.winner, vp: out.state.players.map(function (p) { return p.vp; }), passes: passes };
  } catch (e) {
    return { i: i, squads: squads, crash: String(e && e.message) };
  }
}

// --- worker ------------------------------------------------------------------------------------------------------

if (process.env.MATCHUP_WORKER) {
  const [from, to] = process.env.MATCHUP_WORKER.split(':').map(Number);
  for (let i = from; i < to; i++) process.send(playGame(i));
  process.exit(0);
}

// --- coordinator ---------------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const games = Number(args.find(function (a) { return /^\d+$/.test(a); }) || 2000);
const opt = function (k, dflt) {
  const hit = args.find(function (a) { return a.indexOf(k + '=') === 0; });
  return hit ? hit.slice(k.length + 1) : dflt;
};
const workers = Math.max(1, Number(opt('workers', Math.max(1, cpus().length - 2))));
const outPath = opt('out', 'src/ai/matchups.json');

const pool = Units.pool();
const units = {};
const vs = {};
for (const a of pool) {
  units[a] = { games: 0, wins: 0 };
  vs[a] = {};
  for (const b of pool) if (a !== b) vs[a][b] = { games: 0, wins: 0 };
}
const totals = { games: 0, crashes: 0, passes: 0, wins: [0, 0], failures: [] };

function record(r) {
  if (r.crash) {
    totals.crashes++;
    if (totals.failures.length < 5) totals.failures.push('game ' + r.i + ' ' + r.squads.map(function (s) { return s.join(','); }).join(' v ') + ': ' + r.crash);
    return;
  }
  totals.games++;
  totals.passes += r.passes;
  if (r.winner !== null) totals.wins[r.winner]++;
  const sides = r.squads.map(function (s) { return Array.from(new Set(s)); });
  for (let side = 0; side < 2; side++) {
    const mine = sides[side];
    const theirs = sides[1 - side];
    const won = r.winner === side ? 1 : 0;
    for (const a of mine) {
      if (theirs.indexOf(a) !== -1) continue;
      units[a].games++;
      units[a].wins += won;
      for (const b of theirs) {
        if (mine.indexOf(b) !== -1) continue;
        vs[a][b].games++;
        vs[a][b].wins += won;
      }
    }
  }
}

const started = Date.now();
let done = 0;
let running = 0;
const per = Math.ceil(games / workers);
process.stdout.write('matchups: ' + games + ' games on ' + workers + ' workers\n');
for (let w = 0; w < workers; w++) {
  const from = w * per;
  const to = Math.min(games, from + per);
  if (from >= to) continue;
  running++;
  const child = fork(SELF, [], { env: Object.assign({}, process.env, { MATCHUP_WORKER: from + ':' + to }) });
  child.on('message', function (r) {
    record(r);
    done++;
    if (done % 100 === 0) {
      const secs = (Date.now() - started) / 1000;
      process.stdout.write('  ' + done + ' / ' + games + '  (' + secs.toFixed(0) + ' s)\n');
    }
  });
  child.on('exit', function () {
    running--;
    if (!running) finish();
  });
}

function finish() {
  const seconds = Math.round((Date.now() - started) / 1000);
  const table = {
    note: 'Unit-versus-unit records from AI self-play across random legal squads (tools/ai-matchups.js). vs[a][b] counts ' +
      'games with a on one side and b on the other; wins are games a\'s side won. Regenerate after any balance or AI change.',
    generated: new Date().toISOString().slice(0, 10),
    games: totals.games,
    crashes: totals.crashes,
    forcedPasses: totals.passes,
    seatWins: totals.wins,
    seconds: seconds,
    units: units,
    vs: vs
  };
  writeFileSync(outPath, JSON.stringify(table, null, 1) + '\n');
  process.stdout.write('\n' + totals.games + ' games in ' + seconds + ' s, ' + totals.crashes + ' crashes, ' + totals.passes +
    ' forced passes; seats ' + totals.wins[0] + ' to ' + totals.wins[1] + '\n');
  process.stdout.write('win rate by unit:\n');
  const rows = pool.map(function (d) { return [d, units[d]]; })
    .sort(function (a, b) { return b[1].wins / Math.max(1, b[1].games) - a[1].wins / Math.max(1, a[1].games); });
  for (const [d, t] of rows) {
    process.stdout.write('  ' + d + '  ' + (100 * t.wins / Math.max(1, t.games)).toFixed(1) + '%  (' + t.games + ' games)\n');
  }
  for (const f of totals.failures) process.stdout.write('  failure: ' + f + '\n');
  process.stdout.write('wrote ' + outPath + '\n');
  process.exit(totals.crashes ? 1 : 0);
}
