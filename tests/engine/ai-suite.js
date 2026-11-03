/**
 * AI test suite.
 *
 * These assert the properties that must hold however the evaluator is tuned.
 * Tuning itself is not tested here -- a weight is not right or wrong, only
 * better or worse, and that is measured with `tools/ai-selfplay.js` over many
 * games rather than asserted on one.
 *
 * What IS asserted is the class of bug that tuning keeps reintroducing:
 * choosing an action that achieves nothing when a real one was available.
 */

import * as T from './harness.js';
import * as F from './fixtures.js';

import * as Actions from '../../src/engine/actions.js';
import * as AI from '../../src/ai/ai.js';
import * as Apply from '../../src/engine/apply.js';
import * as Evaluate from '../../src/ai/evaluate.js';
import * as Hex from '../../src/engine/hex.js';
import * as State from '../../src/engine/state.js';
import { skirmish } from '../../src/content/scenarios/skirmish.js';

const H = Hex.hex;

T.suite('ai', function () {
  T.test('every action it picks is one the engine offered', function () {
    let s = State.createGame(skirmish({ seed: 'ai-legal' }));
    for (let i = 0; i < 120 && s.activation && !Apply.isTerminal(s); i++) {
      const chosen = AI.chooseAction(s);
      if (!chosen) break;
      const legal = Actions.legalActions(s).map(Actions.actionKey);
      T.ok(legal.indexOf(Actions.actionKey(chosen)) !== -1,
        'chose ' + Actions.actionKey(chosen));
      s = Apply.apply(s, chosen);
    }
  });

  T.test('a whole match plays out without wedging', function () {
    const out = AI.playOut(State.createGame(skirmish({ seed: 'ai-full' })));
    T.ok(Apply.isTerminal(out.state), 'the game reached an end');
    T.ok(out.activations > 5, 'and took a plausible number of activations');
  });

  T.test('the same seed gives the same game, twice', function () {
    const a = AI.playOut(State.createGame(skirmish({ seed: 'ai-repeat' })));
    const b = AI.playOut(State.createGame(skirmish({ seed: 'ai-repeat' })));
    T.eq(a.activations, b.activations);
    T.deepEq(a.state.players.map(function (p) { return p.vp; }),
      b.state.players.map(function (p) { return p.vp; }));
  });

  T.test('it shoots rather than banking energy it cannot spend', function () {
    // The failure this guards: Energize is the cheapest Primary in the game
    // and does nothing while no ability spends Energy, so an evaluator that
    // prices actions absolutely will pick it for ever. Measured at 41.7 per
    // game before the fix.
    const g = F.game({
      seed: 'ai-shoot',
      units: [
        F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(2, 0), { tl: 9 })
      ]
    });
    const chosen = AI.chooseAction(g);
    T.eq(chosen.type, 'attack', 'with a target in range it attacks');
  });

  T.test('it never ends a turn with its Primary Action unspent', function () {
    const g = F.game({
      seed: 'ai-primary',
      units: [
        F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(2, 0), { tl: 9 })
      ]
    });
    const after = AI.playActivation(g);
    // The activation either produced a Primary Action or the unit genuinely
    // had none available; a token that moved proves the former.
    T.ok(after.log.some(function (e) {
      return e.t === 'attack' || e.t === 'dash' || e.t === 'energize' || e.t === 'rescue';
    }), 'something was actually done');
  });

  T.test('closing the distance improves the evaluation', function () {
    // The threat term is one-sided precisely so this holds. When it was
    // symmetric, approach scored exactly zero and the AI never engaged.
    const far = F.game({
      seed: 'ai-close',
      units: [F.unit('a1', 'u02', 0, H(-5, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(5, 0), { tl: 9 })]
    });
    const near = F.game({
      seed: 'ai-close',
      units: [F.unit('a1', 'u02', 0, H(-1, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(5, 0), { tl: 9 })]
    });
    T.ok(Evaluate.evaluate(near, 0) > Evaluate.evaluate(far, 0),
      'being closer to a fight is worth more than being far from one');
  });

  T.test('a killed enemy is worth more than a wounded one', function () {
    const wounded = F.game({
      seed: 'ai-dead',
      units: [F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(4, 0), { tl: 9, hp: 1 })]
    });
    const dead = State.clone(wounded);
    dead.units.b1.alive = false;
    dead.units.b1.hp = 0;
    // The bounty has to be paid, because a real kill pays it. Without it the
    // comparison is not the one the AI ever faces -- and it inverts, for a
    // reason worth knowing: killing the last enemy removes our own units'
    // threat bonus, since there is no longer anything to shoot. That term is
    // worth about 17 and the bounty is worth 500, so it can never decide a
    // real choice, but it does mean `evaluate` is not monotonic in enemy
    // casualties when the victory points are stripped out.
    dead.players[0].vp += wounded.units.b1.vp;
    T.ok(Evaluate.evaluate(dead, 0) > Evaluate.evaluate(wounded, 0));
  });
});
