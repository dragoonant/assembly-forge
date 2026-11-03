/**
 * Head to head: two differently-tuned AIs, same seeds, same scenarios.
 *
 *   node tools/ai-headtohead.js [games] key=value ...
 *
 * Self-play against itself proves the AI does not crash and shows what it
 * spends its turns on, but it cannot tell you whether a change made the AI
 * BETTER -- both sides improve together and the win rate stays at fifty
 * percent whatever you do. This plays the current weights against a named
 * baseline and reports who actually wins.
 *
 * Sides are swapped every other game so that any advantage baked into the
 * scenario -- deployment, who opens the Phase -- falls equally on both
 * configurations. Without that, a scenario that favours side 0 reads as a
 * victory for whichever configuration happened to be sitting there.
 *
 * BOTH SIDES FIELD THE SAME DOCTRINE. Mirror matches only, rotating through
 * the four. This is not a stylistic choice: the doctrines are not balanced
 * against each other, and any scheme that gives the two configurations
 * different squads measures the squads instead of the AI. An earlier version
 * of this file rotated teams on the same counter as the side, which quietly
 * correlated them -- the candidate only ever fielded two of the four
 * doctrines. Its control run, candidate configured identically to baseline,
 * came out at 18% instead of 50%, which is the only reason the bug was caught
 * rather than shipped as a finding.
 *
 * ALWAYS RUN THE CONTROL after touching this file:
 *
 *     node tools/ai-headtohead.js 60 offence=0 retaliation=0 focusFire=0
 *
 * If that is not close to 50%, nothing else this tool prints means anything.
 */

import * as AI from '../src/ai/ai.js';
import * as Apply from '../src/engine/apply.js';
import * as State from '../src/engine/state.js';
import { skirmish } from '../src/content/scenarios/skirmish.js';
import { TEAM_ORDER } from '../src/content/teams.js';

const games = Number(process.argv[2] || 40);

/** The AI as it was before the movement work: no offence term, no retaliation. */
const BASELINE = { offence: 0, retaliation: 0, focusFire: 0 };

/** The candidate. Overridable from the command line for a sweep. */
const CANDIDATE = {
  offence: AI.TUNING.offence,
  retaliation: AI.TUNING.retaliation,
  focusFire: AI.TUNING.focusFire
};
for (let i = 3; i < process.argv.length; i++) {
  const bits = String(process.argv[i]).split('=');
  if (bits.length === 2) CANDIDATE[bits[0]] = Number(bits[1]);
}

const score = { candidate: 0, baseline: 0, draws: 0, vpFor: 0, vpAgainst: 0, crashes: 0 };

for (let i = 0; i < games; i++) {
  // Alternate which physical side the candidate plays, and rotate the doctrine
  // on a SEPARATE counter so the two never correlate. Both sides field the
  // same one, so the squads cancel exactly.
  const candidateSide = i % 2;
  const doctrine = TEAM_ORDER[Math.floor(i / 2) % TEAM_ORDER.length];

  let s;
  try {
    s = State.createGame(skirmish({
      seed: 'h2h-' + i, playerTeam: doctrine, enemyTeam: doctrine
    }));

    let guard = 0;
    while (!Apply.isTerminal(s) && s.activation) {
      if (++guard > 4000) throw new Error('did not finish');
      // Swap the weights to whichever configuration owns the activating side.
      AI.tune(s.activation.side === candidateSide ? CANDIDATE : BASELINE);
      const action = AI.chooseAction(s);
      if (!action) break;
      s = Apply.apply(s, action);
    }
  } catch (e) {
    score.crashes++;
    continue;
  }

  const mine = s.players[candidateSide].vp;
  const theirs = s.players[candidateSide === 0 ? 1 : 0].vp;
  score.vpFor += mine;
  score.vpAgainst += theirs;
  if (mine > theirs) score.candidate++;
  else if (theirs > mine) score.baseline++;
  else score.draws++;
}

const played = score.candidate + score.baseline + score.draws;
const rate = played ? (100 * score.candidate / played) : 0;

process.stdout.write('\nHead to head over ' + games + ' games\n');
process.stdout.write('-------------------------------------------\n');
process.stdout.write('candidate : ' + JSON.stringify(CANDIDATE) + '\n');
process.stdout.write('baseline  : ' + JSON.stringify(BASELINE) + '\n\n');
process.stdout.write('candidate wins  ' + score.candidate + '\n');
process.stdout.write('baseline wins   ' + score.baseline + '\n');
process.stdout.write('draws           ' + score.draws + '\n');
process.stdout.write('crashes         ' + score.crashes + '\n');
process.stdout.write('win rate        ' + rate.toFixed(1) + '%   <- 50% means no improvement\n');
process.stdout.write('mean VP         ' + (score.vpFor / Math.max(1, played)).toFixed(1) +
  ' vs ' + (score.vpAgainst / Math.max(1, played)).toFixed(1) + '\n');

process.exit(score.crashes ? 1 : 0);
