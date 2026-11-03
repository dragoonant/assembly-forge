/**
 * Engine test suite.
 *
 * One mechanic per test, each set up by building the position directly rather
 * than playing toward it, so a failure names the rule that broke.
 *
 * Milestone scope: hex geometry, the seeded generator, the rules config, the
 * Timeline scheduler, and Advance / Dash / Energize.
 */

import * as T from './harness.js';
import * as F from './fixtures.js';

import * as Actions from '../../src/engine/actions.js';
import * as Apply from '../../src/engine/apply.js';
import * as Hex from '../../src/engine/hex.js';
import * as Rng from '../../src/engine/rng.js';
import * as Rules from '../../src/engine/rules.js';
import * as State from '../../src/engine/state.js';
import * as Timeline from '../../src/engine/timeline.js';

const H = Hex.hex;

// --- Hex geometry ------------------------------------------------------------

T.suite('hex', function () {
  T.test('distance to self is zero', function () {
    T.eq(Hex.distance(H(0, 0), H(0, 0)), 0);
    T.eq(Hex.distance(H(3, -2), H(3, -2)), 0);
  });

  T.test('distance is one step per hex, and symmetric', function () {
    T.eq(Hex.distance(H(0, 0), H(1, 0)), 1, 'east');
    T.eq(Hex.distance(H(0, 0), H(0, 1)), 1, 'south-east');
    T.eq(Hex.distance(H(0, 0), H(1, -1)), 1, 'north-east');
    T.eq(Hex.distance(H(0, 0), H(2, -1)), 2);
    T.eq(Hex.distance(H(0, 0), H(-3, 1)), 3);
    T.eq(Hex.distance(H(-3, 1), H(0, 0)), 3, 'symmetric');
  });

  T.test('the axis that is not q or r still costs one per step', function () {
    // (1, -1) and (-1, 1) are single steps despite both coordinates changing.
    T.eq(Hex.distance(H(0, 0), H(3, -3)), 3);
    T.eq(Hex.distance(H(0, 0), H(-3, 3)), 3);
    // ...but changing q and r the same way is two steps per hex.
    T.eq(Hex.distance(H(0, 0), H(1, 1)), 2);
  });

  T.test('a hex has six distinct neighbours, all at distance one', function () {
    const ns = Hex.neighbours(H(2, -1));
    T.eq(ns.length, 6);
    const seen = {};
    for (let i = 0; i < ns.length; i++) {
      T.eq(Hex.distance(H(2, -1), ns[i]), 1, 'neighbour ' + i);
      seen[Hex.key(ns[i])] = true;
    }
    T.eq(Object.keys(seen).length, 6, 'all six are different hexes');
  });

  T.test('neighbours are mutual', function () {
    const ns = Hex.neighbours(H(-2, 3));
    for (let i = 0; i < ns.length; i++) {
      T.ok(Hex.isAdjacent(ns[i], H(-2, 3)), 'neighbour ' + i + ' points back');
    }
  });

  T.test('cube conversion round-trips', function () {
    const h = H(4, -7);
    T.deepEq(Hex.fromCube(Hex.toCube(h)), { q: 4, r: -7 });
    const c = Hex.toCube(h);
    T.eq(c.x + c.y + c.z, 0, 'cube coordinates sum to zero');
  });

  T.test('a ring has 6n hexes and a range has 3n(n+1)+1', function () {
    for (let n = 1; n <= 4; n++) {
      T.eq(Hex.ring(H(1, 1), n).length, 6 * n, 'ring ' + n);
      T.eq(Hex.range(H(1, 1), n).length, 3 * n * (n + 1) + 1, 'range ' + n);
    }
    T.eq(Hex.ring(H(0, 0), 0).length, 1, 'ring 0 is the centre');
  });

  T.test('every hex of a ring is exactly that far out', function () {
    const r = Hex.ring(H(-1, 2), 3);
    for (let i = 0; i < r.length; i++) T.eq(Hex.distance(H(-1, 2), r[i]), 3);
  });

  T.test('a line runs from a to b, one step at a time', function () {
    const a = H(-3, 1);
    const b = H(2, -1);
    const l = Hex.line(a, b);
    T.eq(l.length, Hex.distance(a, b) + 1, 'one hex per step, both ends included');
    T.deepEq(l[0], { q: a.q, r: a.r }, 'starts at a');
    T.deepEq(l[l.length - 1], { q: b.q, r: b.r }, 'ends at b');
    for (let i = 1; i < l.length; i++) {
      T.ok(Hex.isAdjacent(l[i - 1], l[i]), 'step ' + i + ' is to a neighbour');
    }
  });

  T.test('a line of length zero is a single hex', function () {
    T.deepEq(Hex.line(H(2, 2), H(2, 2)), [{ q: 2, r: 2 }]);
  });

  T.test('a line drawn backwards is the same line reversed', function () {
    // Boundary ties are broken by nudging both endpoints the same way, so the
    // line does not depend on which end you start from. Line of sight has to
    // be symmetric or two units can see each other one-way.
    const pairs = [[H(0, 0), H(3, -1)], [H(-2, 4), H(3, -3)], [H(1, 1), H(-4, 0)]];
    for (let i = 0; i < pairs.length; i++) {
      const forward = Hex.line(pairs[i][0], pairs[i][1]);
      const back = Hex.line(pairs[i][1], pairs[i][0]).slice().reverse();
      T.deepEq(back, forward, 'pair ' + i);
    }
  });

  T.test('pixel conversion round-trips, pointy-top', function () {
    const hexes = [H(0, 0), H(3, -2), H(-4, 1), H(2, 2)];
    for (let i = 0; i < hexes.length; i++) {
      const p = Hex.toPixel(hexes[i], 20);
      T.deepEq(Hex.fromPixel(p, 20), { q: hexes[i].q, r: hexes[i].r }, Hex.key(hexes[i]));
    }
  });

  T.test('offset coordinates round-trip', function () {
    for (let row = -3; row <= 3; row++) {
      for (let col = -3; col <= 3; col++) {
        const h = Hex.fromOffset(col, row);
        T.deepEq(Hex.toOffset(h), { col: col, row: row }, col + '/' + row);
      }
    }
  });

  T.test('key and parseKey round-trip', function () {
    T.eq(Hex.key(H(-2, 5)), '-2,5');
    T.deepEq(Hex.parseKey('-2,5'), { q: -2, r: 5 });
  });
});

// --- Seeded generator --------------------------------------------------------

T.suite('board shape', function () {
  T.test('the starter board is 15 rows alternating 14 and 13 hexes, 203 in all', function () {
    const b = State.createBoard({ cols: 14, rows: 15, shortRows: true });
    T.eq(Object.keys(b.hexes).length, 203);
    for (let row = 0; row < 15; row++) {
      let n = 0;
      const keys = Object.keys(b.hexes);
      for (let i = 0; i < keys.length; i++) if (b.hexes[keys[i]].r === row) n++;
      T.eq(n, row % 2 === 0 ? 14 : 13, 'row ' + row);
    }
  });

  T.test('a short row is inset half a hex at both ends', function () {
    const b = State.createBoard({ cols: 14, rows: 15, shortRows: true });
    // odd-r: row 1 starts half a hex right of row 0, and with its last hex dropped it also ends half a hex short
    const first0 = Hex.toPixel(Hex.fromOffset(0, 0), 1).x;
    const first1 = Hex.toPixel(Hex.fromOffset(0, 1), 1).x;
    const last0 = Hex.toPixel(Hex.fromOffset(13, 0), 1).x;
    const last1 = Hex.toPixel(Hex.fromOffset(12, 1), 1).x;
    T.ok(Math.abs(first1 - first0 - Math.sqrt(3) / 2) < 1e-9, 'inset on the left');
    T.ok(Math.abs(last0 - last1 - Math.sqrt(3) / 2) < 1e-9, 'inset on the right');
    T.ok(State.onBoard({ board: b }, Hex.fromOffset(13, 0)), 'long row keeps its 14th hex');
    T.notOk(State.onBoard({ board: b }, Hex.fromOffset(13, 1)), 'short row has no 14th hex');
  });

  T.test('without shortRows a board stays a full rectangle', function () {
    T.eq(Object.keys(State.createBoard({ cols: 14, rows: 15 }).hexes).length, 210);
  });
});

T.suite('rng', function () {
  T.test('the same seed produces the same sequence', function () {
    const a = sequence(Rng.seedFrom('replay-me'), 20);
    const b = sequence(Rng.seedFrom('replay-me'), 20);
    T.deepEq(a, b);
  });

  T.test('different seeds diverge', function () {
    const a = sequence(Rng.seedFrom('alpha'), 20);
    const b = sequence(Rng.seedFrom('beta'), 20);
    T.notOk(JSON.stringify(a) === JSON.stringify(b), 'two seeds gave the same stream');
  });

  T.test('a numeric seed is used directly', function () {
    T.eq(Rng.seedFrom(12345), 12345);
  });

  T.test('every step returns the advanced state, and never mutates', function () {
    const start = Rng.seedFrom('threaded');
    const one = Rng.step(start);
    T.notOk(one.state === start, 'the generator moved on');
    // Stepping the original again must repeat, not continue.
    T.deepEq(Rng.step(start), one, 'the generator state is the only position there is');
  });

  T.test('values sit in [0, 1)', function () {
    let s = Rng.seedFrom('range');
    for (let i = 0; i < 500; i++) {
      const r = Rng.step(s);
      s = r.state;
      T.ok(r.value >= 0 && r.value < 1, 'value out of range: ' + r.value);
    }
  });

  T.test('rolls land on the die', function () {
    let s = Rng.seedFrom('dice');
    const seen = {};
    for (let i = 0; i < 600; i++) {
      const r = Rng.roll(s, 10);
      s = r.state;
      T.ok(r.value >= 1 && r.value <= 10, 'd10 rolled ' + r.value);
      seen[r.value] = true;
    }
    T.eq(Object.keys(seen).length, 10, 'every face of a d10 came up over 600 rolls');
  });

  T.test('rollN rolls a handful in one call', function () {
    const r = Rng.rollN(Rng.seedFrom('handful'), 5, 10);
    T.eq(r.value.length, 5);
    // The same rolls, taken one at a time, must match.
    let s = Rng.seedFrom('handful');
    const one = [];
    for (let i = 0; i < 5; i++) {
      const step = Rng.roll(s, 10);
      s = step.state;
      one.push(step.value);
    }
    T.deepEq(r.value, one);
    T.eq(r.state, s, 'the generator ends in the same place either way');
  });

  T.test('pick chooses from the list and advances the generator', function () {
    const list = ['a', 'b', 'c', 'd'];
    const r = Rng.pick(Rng.seedFrom('pick'), list);
    T.ok(list.indexOf(r.value) !== -1, 'picked ' + r.value);
    T.notOk(r.state === Rng.seedFrom('pick'), 'the generator advanced');
    T.eq(Rng.pick(Rng.seedFrom('pick'), list).value, r.value, 'deterministic');
  });

  T.test('shuffle permutes without touching the input', function () {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const r = Rng.shuffle(Rng.seedFrom('shuffle'), input);
    T.deepEq(input, [1, 2, 3, 4, 5, 6, 7, 8, 9], 'input untouched');
    T.deepEq(r.value.slice().sort(function (a, b) { return a - b; }), input, 'same elements');
    T.deepEq(Rng.shuffle(Rng.seedFrom('shuffle'), input).value, r.value, 'deterministic');
  });

  function sequence(seed, n) {
    const out = [];
    let s = seed;
    for (let i = 0; i < n; i++) {
      const r = Rng.step(s);
      s = r.state;
      out.push(r.value);
    }
    return out;
  }
});

// --- Rules config ------------------------------------------------------------

T.suite('rules', function () {
  T.test('every open question from the reconstruction has a value behind it', function () {
    const rules = Rules.createRules();
    T.eq(Rules.OPEN_QUESTIONS.length, 7, 'the reconstruction lists seven');
    for (let i = 0; i < Rules.OPEN_QUESTIONS.length; i++) {
      const q = Rules.OPEN_QUESTIONS[i];
      T.notOk(Rules.valueAt(rules, q.path) === undefined,
        'question ' + q.n + ' (' + q.question + ') has no value at ' + q.path);
      T.ok(q.decision && q.decision.length > 0, 'question ' + q.n + ' has no recorded decision');
    }
  });

  T.test('every house decision names a real config value', function () {
    const rules = Rules.createRules();
    for (let i = 0; i < Rules.HOUSE_DECISIONS.length; i++) {
      const d = Rules.HOUSE_DECISIONS[i];
      T.notOk(Rules.valueAt(rules, d.path) === undefined, 'no value at ' + d.path);
    }
  });

  T.test('overrides merge deeply and leave their neighbours alone', function () {
    const rules = Rules.createRules({ movement: { advanceHexes: 5 } });
    T.eq(rules.movement.advanceHexes, 5);
    T.eq(rules.movement.dashHexes, Rules.DEFAULTS.movement.dashHexes, 'sibling value survived');
    T.eq(rules.timeline.rounds, 10, 'other sections survived');
  });

  T.test('creating rules never touches the defaults', function () {
    const before = JSON.stringify(Rules.DEFAULTS);
    const rules = Rules.createRules({ timeline: { rounds: 4 }, terrain: { open: { moveExtra: 9 } } });
    rules.movement.advanceHexes = 99;
    rules.terrain.water.moveExtra = 99;
    T.eq(JSON.stringify(Rules.DEFAULTS), before, 'DEFAULTS was modified');
  });

  T.test('terrain kinds are looked up through the rules', function () {
    const rules = Rules.createRules();
    T.eq(Rules.terrain(rules, 'water').moveExtra, 1);
    T.eq(Rules.terrain(rules, 'blocked').impassable, true);
    T.eq(Rules.terrain(rules, 'nonsense'), undefined);
  });
});

// --- Setup -------------------------------------------------------------------

T.suite('setup', function () {
  T.test('a token starts on the round its card names', function () {
    const s = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 }),
        F.unit('a2', 'u01', 0, H(-2, 1), { tl: 3 }),
        F.unit('b1', 'u06', 1, H(2, 0), { tl: 2 })
      ]
    });
    T.deepEq(T.stack(s, 1, 0), ['a1']);
    T.deepEq(T.stack(s, 3, 0), ['a2']);
    T.deepEq(T.stack(s, 2, 1), ['b1']);
  });

  T.test('the tracker starts on the lowest round holding a token', function () {
    const s = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(-2, 0), { tl: 4 }),
        F.unit('b1', 'u06', 1, H(2, 0), { tl: 6 })
      ]
    });
    T.eq(s.round, 4);
    T.eq(s.activation.uid, 'a1');
  });

  T.test('an unknown terrain kind is rejected at construction', function () {
    T.throws(function () {
      F.game({
        board: State.createBoard({ radius: 2, hexes: { '0,0': { terrain: 'lava' } } }),
        units: [F.unit('a1', 'u02', 0, H(-1, 0))]
      });
    });
  });

  T.test('two units may not share a hex, even at setup', function () {
    T.throws(function () {
      F.game({
        units: [
          F.unit('a1', 'u02', 0, H(0, 0)),
          F.unit('b1', 'u06', 1, H(0, 0))
        ]
      });
    });
  });

  T.test('a unit may not be placed off the board', function () {
    T.throws(function () {
      F.game({ arena: { radius: 2 }, units: [F.unit('a1', 'u02', 0, H(5, 0))] });
    });
  });
});

// --- Timeline: stacking ------------------------------------------------------

T.suite('timeline stacking', function () {
  T.test('rule 1: the player chooses their stack order at setup', function () {
    const units = [
      F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 }),
      F.unit('a2', 'u04', 0, H(-2, 1), { tl: 1 }),
      F.unit('a3', 'u05', 0, H(-2, 2), { tl: 1 })
    ];
    const natural = F.game({ units: units });
    T.deepEq(T.stack(natural, 1, 0), ['a1', 'a2', 'a3'], 'declaration order by default');

    const chosen = F.game({ units: units, setupOrder: [['a3', 'a1', 'a2'], []] });
    T.deepEq(T.stack(chosen, 1, 0), ['a3', 'a1', 'a2'], 'the chosen order');
  });

  T.test('rule 3: activation runs from the top of the stack down', function () {
    const s = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 }),
        F.unit('a2', 'u04', 0, H(-2, 1), { tl: 1 }),
        F.unit('a3', 'u05', 0, H(-2, 2), { tl: 1 })
      ],
      setupOrder: [['a2', 'a3', 'a1'], []]
    });
    const run = T.drain(s);
    T.eq(run.order[0].uid, 'a2', 'top of stack goes first');
    T.eq(run.order[1].uid, 'a3');
    T.eq(run.order[2].uid, 'a1');
  });

  T.test('rule 2: a token arriving during play joins the bottom of the stack', function () {
    // a1 starts on round 1 and a3 on round 3. Energizing costs 2, so a1's
    // token lands on round 3 -- underneath the token already sitting there.
    let s = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 }),
        F.unit('a3', 'u05', 0, H(-2, 2), { tl: 3 })
      ]
    });
    T.deepEq(T.stack(s, 3, 0), ['a3']);
    s = T.act(s, { type: 'energize' });
    T.deepEq(T.stack(s, 3, 0), ['a3', 'a1'], 'the arriving token went to the bottom');
  });

  T.test('rule 2 is not a re-sort: arrival order decides, not the round the token came from', function () {
    let s = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 }),
        F.unit('a2', 'u04', 0, H(-2, 1), { tl: 2 }),
        F.unit('a3', 'u05', 0, H(-2, 2), { tl: 4 })
      ]
    });
    s = T.pass(s);                        // a1: round 1 -> 3
    T.deepEq(T.stack(s, 3, 0), ['a1']);
    s = T.pass(s);                        // a2: round 2 -> 4, underneath a3
    T.deepEq(T.stack(s, 4, 0), ['a3', 'a2']);
    s = T.pass(s);                        // a1 again: round 3 -> 5
    T.deepEq(T.stack(s, 5, 0), ['a1']);
    T.deepEq(T.stack(s, 4, 0), ['a3', 'a2'], 'round 4 was not reshuffled');
  });

  T.test('rule 4: with both sides on a round, the opponent of the last actor goes first', function () {
    // a1 has round 1 to itself, so side 0 acts last before round 2 -- which
    // both sides hold. Side 1 must open it.
    let s = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 }),
        F.unit('a2', 'u04', 0, H(-2, 1), { tl: 2 }),
        F.unit('b1', 'u06', 1, H(2, 0), { tl: 2 })
      ]
    });
    T.eq(s.activation.uid, 'a1');
    s = T.pass(s);
    T.eq(s.round, 2);
    T.eq(s.activation.side, 1, 'side 1 opens round 2');
    T.eq(s.activation.uid, 'b1');
    s = T.pass(s);
    T.eq(s.activation.uid, 'a2', 'and side 0 follows');
  });

  T.test('rule 4 keeps alternating for the whole round', function () {
    const s = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 }),
        F.unit('a2', 'u04', 0, H(-3, 1), { tl: 2 }),
        F.unit('a3', 'u05', 0, H(-3, 2), { tl: 2 }),
        F.unit('b1', 'u06', 1, H(3, 0), { tl: 2 }),
        F.unit('b2', 'u01', 1, H(3, -1), { tl: 2 })
      ]
    });
    const run = T.drain(s);
    const first5 = run.order.slice(0, 5).map(function (o) { return o.uid; });
    T.deepEq(first5, ['a1', 'b1', 'a2', 'b2', 'a3']);
  });

  T.test('the narrow reading of rule 4 is one config value away', function () {
    const s = F.game({
      rules: { timeline: { alternateWithinRound: false } },
      units: [
        F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 }),
        F.unit('a2', 'u04', 0, H(-3, 1), { tl: 2 }),
        F.unit('a3', 'u05', 0, H(-3, 2), { tl: 2 }),
        F.unit('b1', 'u06', 1, H(3, 0), { tl: 2 }),
        F.unit('b2', 'u01', 1, H(3, -1), { tl: 2 })
      ]
    });
    const run = T.drain(s);
    const first5 = run.order.slice(0, 5).map(function (o) { return o.uid; });
    T.deepEq(first5, ['a1', 'b1', 'b2', 'a2', 'a3'], 'side 1 empties its stack first');
  });

  T.test('initiative is rolled only when both sides hold the first active round', function () {
    const contested = F.game({
      seed: 'initiative',
      units: [
        F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(2, 0), { tl: 1 })
      ]
    });
    T.notOk(contested.initiativeSide === null, 'a roll should have happened');
    T.eq(contested.activation.side, contested.initiativeSide, 'the winner activates first');
    T.notOk(contested.rng === Rng.seedFrom('initiative'), 'the generator advanced');

    const uncontested = F.game({
      seed: 'initiative',
      units: [
        F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(2, 0), { tl: 2 })
      ]
    });
    T.eq(uncontested.initiativeSide, null, 'nobody to roll against');
    T.eq(uncontested.rng, Rng.seedFrom('initiative'), 'no random number was burned');
  });

  T.test('the initiative roll is decided by the seed, not by chance', function () {
    const a = F.game({
      seed: 'fixed', units: [
        F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(2, 0), { tl: 1 })
      ]
    });
    const b = F.game({
      seed: 'fixed', units: [
        F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(2, 0), { tl: 1 })
      ]
    });
    T.eq(a.initiativeSide, b.initiativeSide);
    T.eq(a.rng, b.rng);
  });
});

// --- Timeline: the round tracker --------------------------------------------

T.suite('timeline tracker', function () {
  T.test('the tracker waits for every token on the round', function () {
    let s = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 }),
        F.unit('a2', 'u04', 0, H(-2, 1), { tl: 1 })
      ]
    });
    T.eq(s.round, 1);
    s = T.pass(s);
    T.eq(s.round, 1, 'a2 has not gone yet');
    T.eq(s.activation.uid, 'a2');
    s = T.pass(s);
    T.eq(s.round, 3, 'both tokens left round 1, and round 2 is empty');
  });

  T.test('rounds holding no tokens are skipped', function () {
    let s = F.game({
      rules: { match: { phasesPerGame: 1 } },
      units: [F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 })]
    });
    T.eq(s.round, 1);
    s = T.act(s, { type: 'energize' });
    s = T.act(s, { type: 'end_activation' });
    T.eq(s.round, 3, 'round 2 held nothing and was skipped');
    T.eq(s.activation.uid, 'a1');
  });

  T.test('a full ten-round Phase drains, one round at a time', function () {
    const s = F.game({
      rules: { match: { phasesPerGame: 1 } },
      units: [
        F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(2, 0), { tl: 2 })
      ]
    });
    const run = T.drain(s);
    const rounds = run.order.map(function (o) { return o.round; });
    T.deepEq(rounds, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'every round ran, in order');
    const uids = run.order.map(function (o) { return o.uid; });
    T.deepEq(uids, ['a1', 'b1', 'a1', 'b1', 'a1', 'b1', 'a1', 'b1', 'a1', 'b1']);
    T.ok(Apply.isTerminal(run.state), 'the game ended with the Phase');
    T.eq(run.state.phase, 1, 'it was a one-Phase game');
  });

  T.test('a token pushed past the last round waits for the next Phase', function () {
    const s = F.game({
      rules: { match: { phasesPerGame: 1 } },
      units: [F.unit('a1', 'u02', 0, H(-2, 0), { tl: 9 })]
    });
    const run = T.drain(s);
    T.eq(run.order.length, 1, 'one activation, on round 9');
    const at = Timeline.locate(run.state.timeline, 'a1');
    T.ok(at.overflow, 'the token is waiting off the end of the track');
    T.eq(at.round, 11);
  });

  T.test('a Phase ends when the track runs out, and the tracker resets to round 1', function () {
    let s = F.game({
      rules: { match: { phasesPerGame: 2 } },
      units: [F.unit('a1', 'u02', 0, H(-2, 0), { tl: 9 })]
    });
    T.eq(s.phase, 1);
    s = T.pass(s);                       // round 9 -> 11, off the end
    T.eq(s.phase, 2, 'the Phase turned over');
    T.eq(s.round, 1, 'the tracker went back to round 1');
    T.eq(T.tokenRound(s, 'a1'), 1, 'round 11 wrapped to round 1');
    T.eq(s.activation.uid, 'a1');
  });

  T.test('overflow keeps the difference between a cheap and an expensive overrun', function () {
    // Both tokens overrun round 10; the one pushed further starts later.
    let s = F.game({
      rules: { match: { phasesPerGame: 2 } },
      units: [
        F.unit('a1', 'u02', 0, H(-2, 0), { tl: 9 }),
        F.unit('b1', 'u06', 1, H(2, 0), { tl: 10 })
      ]
    });
    s = T.pass(s);                       // a1: 9 -> 11
    s = T.pass(s);                       // b1: 10 -> 12, ends the Phase
    T.eq(s.phase, 2);
    T.eq(T.tokenRound(s, 'a1'), 1);
    T.eq(T.tokenRound(s, 'b1'), 2);
  });

  T.test("'reset' overflow drops every overrun token on round 1", function () {
    let s = F.game({
      rules: { match: { phasesPerGame: 2 }, timeline: { overflow: 'reset' } },
      units: [
        F.unit('a1', 'u02', 0, H(-2, 0), { tl: 9 }),
        F.unit('b1', 'u06', 1, H(2, 0), { tl: 10 })
      ]
    });
    s = T.pass(s);
    s = T.pass(s);
    T.eq(T.tokenRound(s, 'a1'), 1);
    T.eq(T.tokenRound(s, 'b1'), 1);
  });

  T.test('the game ends after the last Phase', function () {
    const s = F.game({
      rules: { match: { phasesPerGame: 2 } },
      units: [
        F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(2, 0), { tl: 2 })
      ]
    });
    const run = T.drain(s, 200);
    T.ok(Apply.isTerminal(run.state));
    T.eq(run.state.phase, 2, 'stopped at the end of the second Phase');
    T.eq(run.state.result, 'phases-exhausted');
    T.eq(run.state.activation, null, 'no unit is left mid-turn');
    T.eq(Actions.legalActions(run.state).length, 0, 'a finished game offers nothing');
  });

  T.test('a Timeline cost of two is what moves a token two rounds', function () {
    let s = F.game({ units: [F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 })] });
    T.eq(T.tokenRound(s, 'a1'), 1);
    s = T.act(s, { type: 'energize' });
    T.eq(T.tokenRound(s, 'a1'), 3, 'Energize costs 2');
  });
});

// --- Activation: the A/B/C/D slots ------------------------------------------

T.suite('activation', function () {
  T.test('a Primary Action is mandatory', function () {
    const s = F.duel();
    T.notOk(T.find(s, { type: 'end_activation' }), 'cannot end a turn without acting');
    const after = T.act(s, { type: 'energize' });
    T.ok(T.find(after, { type: 'end_activation' }), 'and can once the Primary is spent');
  });

  T.test('exactly one Primary Action per activation', function () {
    const s = T.act(F.duel(), { type: 'energize' });
    T.notOk(T.find(s, { type: 'energize' }), 'no second Energize');
    T.notOk(T.find(s, { type: 'dash' }), 'and no Dash either');
    T.eq(s.activation.slots.primary, 'energize');
  });

  T.test('Advance is free and may be taken once', function () {
    let s = F.duel();
    T.eq(T.tokenRound(s, 'a1'), 1);
    s = T.act(s, { type: 'advance', to: H(-2, 0) });
    T.eq(T.tokenRound(s, 'a1'), 1, 'Advance costs no Timeline');
    T.ok(s.activation.slots.advance);
    T.eq(T.findAll(s, { type: 'advance' }).length, 0, 'no second Advance');
  });

  T.test('Advance and Dash may be taken in either order', function () {
    let advanceFirst = F.duel();
    advanceFirst = T.act(advanceFirst, { type: 'advance', to: H(-2, 0) });
    T.ok(T.find(advanceFirst, { type: 'dash' }), 'Dash is still available after Advancing');
    advanceFirst = T.act(advanceFirst, { type: 'dash', to: H(0, 0) });
    T.deepEq(T.where(advanceFirst, 'a1'), { q: 0, r: 0 });

    // The enemy sits well out of the way, so engagement does not shorten the
    // second half of the move.
    let dashFirst = F.duel({ b: H(5, 0) });
    dashFirst = T.act(dashFirst, { type: 'dash', to: H(-1, 0) });
    T.ok(T.find(dashFirst, { type: 'advance' }), 'Advance is still available after Dashing');
    dashFirst = T.act(dashFirst, { type: 'advance', to: H(2, 0) });
    T.deepEq(T.where(dashFirst, 'a1'), { q: 2, r: 0 }, 'five hexes in total');
  });

  T.test('a non-movement action closes the movement block', function () {
    // Movement is one block: once the unit has stopped and done something
    // else, it cannot pick the move back up.
    const s = T.act(F.duel(), { type: 'energize' });
    T.ok(s.activation.movementClosed);
    T.eq(T.findAll(s, { type: 'advance' }).length, 0, 'no Advance after the block closed');
  });

  T.test('a unit with no Primary available may pass, and its token still moves', function () {
    // A one-hex board with Energy capped: nowhere to Dash, nothing to Energize.
    // The mandatory-Primary rule must not be allowed to freeze the Timeline.
    let s = F.game({
      rules: { actions: { maxEnergy: 0 }, match: { phasesPerGame: 1 } },
      board: F.arena({ radius: 0 }),
      units: [F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 })]
    });
    T.deepEq(Actions.legalActions(s).map(Actions.actionKey), ['end_activation|a1'],
      'nothing but ending the turn is possible');
    s = T.act(s, { type: 'end_activation' });
    T.eq(T.tokenRound(s, 'a1'), 3, 'the token moved on anyway');

    const run = T.drain(s);
    T.ok(Apply.isTerminal(run.state), 'and the Phase still drains');
  });

  T.test('the activation record tracks the slots and the starting hex', function () {
    const s = F.duel();
    T.deepEq(s.activation.slots, { advance: false, primary: null, command: false, tactics: false });
    T.deepEq(s.activation.startHex, { q: -3, r: 0 });
    T.eq(s.activation.moved, false);
    T.eq(s.activation.tacticsLocked, false);
  });

  T.test('a Tactics lockout is consumed by the next activation', function () {
    let s = F.duel();
    s.players[0].tacticsLockout = true;      // as a defensive card would set it
    s = T.pass(s);                           // a1 acts, b1 comes up
    s = T.pass(s);                           // back to side 0
    T.eq(s.activation.side, 0);
    T.eq(s.activation.tacticsLocked, true, 'the lockout reached the activation');
    T.eq(s.players[0].tacticsLockout, false, 'and was consumed');
  });
});

// --- Movement ----------------------------------------------------------------

T.suite('movement', function () {
  T.test('Advance reaches three hexes and no further', function () {
    const s = F.duel();
    const moves = T.findAll(s, { type: 'advance' });
    T.ok(moves.length > 0);
    for (let i = 0; i < moves.length; i++) {
      T.ok(Hex.distance(H(-3, 0), moves[i].to) <= 3, 'reached ' + Hex.key(moves[i].to));
      T.ok(moves[i].cost <= 3, 'cost ' + moves[i].cost);
    }
    T.ok(T.find(s, { type: 'advance', to: H(0, 0) }), 'three hexes east is reachable');
    T.notOk(T.find(s, { type: 'advance', to: H(1, 0) }), 'four hexes east is not');
  });

  T.test('an Advance may not finish where it started', function () {
    const s = F.duel();
    T.notOk(T.find(s, { type: 'advance', to: H(-3, 0) }), 'the start hex is not a destination');
  });

  T.test('turning the rule off makes standing still a legal Advance', function () {
    const s = F.duel({ rules: { movement: { noEndOnStartHex: false } } });
    T.ok(T.find(s, { type: 'advance', to: H(-3, 0) }), 'one config edit, per the rules file');
  });

  T.test('Dash moves two hexes and costs two Timeline', function () {
    let s = F.duel();
    T.notOk(T.find(s, { type: 'dash', to: H(0, 0) }), 'three hexes is beyond a Dash');
    s = T.act(s, { type: 'dash', to: H(-1, 0) });
    T.deepEq(T.where(s, 'a1'), { q: -1, r: 0 });
    T.eq(T.tokenRound(s, 'a1'), 3, 'Dash costs 2');
  });

  T.test('one unit per hex: an occupied hex is not a destination', function () {
    const s = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 }),
        F.unit('a2', 'u04', 0, H(-1, 0), { tl: 5 }),
        F.unit('b1', 'u06', 1, H(0, 0), { tl: 5 })
      ],
      rules: { movement: { engagementPenalty: 0 } }
    });
    T.eq(s.activation.uid, 'a1');
    T.notOk(T.find(s, { type: 'advance', to: H(-1, 0) }), 'cannot stop on a friendly unit');
    T.notOk(T.find(s, { type: 'advance', to: H(0, 0) }), 'cannot stop on an enemy unit');
  });

  T.test('a unit may move through a friendly unit but not stop on it', function () {
    const s = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 }),
        F.unit('a2', 'u04', 0, H(-2, 0), { tl: 5 })
      ]
    });
    T.notOk(T.find(s, { type: 'advance', to: H(-2, 0) }), 'not a destination');
    const through = T.find(s, { type: 'advance', to: H(-1, 0) });
    T.ok(through, 'but the hex beyond it is');
    T.eq(through.cost, 2, 'and by the direct route');
    T.deepEq(through.path, [{ q: -3, r: 0 }, { q: -2, r: 0 }, { q: -1, r: 0 }]);
  });

  T.test('a unit may not move through an enemy unit and must detour', function () {
    const s = F.game({
      // Engagement off, so this test is about the wall and nothing else.
      rules: { movement: { engagementPenalty: 0 } },
      units: [
        F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(-2, 0), { tl: 5 })
      ]
    });
    T.notOk(T.find(s, { type: 'advance', to: H(-2, 0) }), 'the enemy hex is closed');
    const around = T.find(s, { type: 'advance', to: H(-1, 0) });
    T.ok(around, 'the hex beyond is still reachable');
    T.eq(around.cost, 3, 'but it costs a detour');
    for (let i = 0; i < around.path.length; i++) {
      T.notOk(Hex.equals(around.path[i], H(-2, 0)), 'the path went through the enemy');
    }
  });

  T.test('impassable terrain is neither entered nor crossed', function () {
    const s = F.game({
      board: F.arena({ hexes: { '-2,0': { terrain: 'blocked' } } }),
      rules: { movement: { engagementPenalty: 0 } },
      units: [F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 })]
    });
    T.notOk(T.find(s, { type: 'advance', to: H(-2, 0) }));
    const around = T.find(s, { type: 'advance', to: H(-1, 0) });
    T.eq(around.cost, 3, 'reached the long way round');
  });

  T.test('the board edge is a wall', function () {
    const s = F.game({
      arena: { radius: 3 },
      units: [F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 })]
    });
    const moves = T.findAll(s, { type: 'advance' });
    for (let i = 0; i < moves.length; i++) {
      T.ok(State.onBoard(s, moves[i].to), Hex.key(moves[i].to) + ' is off the board');
    }
    T.notOk(T.find(s, { type: 'advance', to: H(-4, 0) }));
  });

  T.test('climbing costs a hex per level, descending is free', function () {
    const s = F.game({
      board: F.arena({ hexes: { '-2,0': { elevation: 1 }, '-1,0': { elevation: 2 } } }),
      units: [F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 })]
    });
    T.eq(Actions.enterCost(s, 0, H(-3, 0), H(-2, 0)), 2, 'one level up');
    T.eq(Actions.enterCost(s, 0, H(-2, 0), H(-1, 0)), 2, 'one more level up');
    T.eq(Actions.enterCost(s, 0, H(-1, 0), H(-2, 0)), 1, 'a level down is free');
    T.eq(Actions.enterCost(s, 0, H(-1, 0), H(0, 0)), 1, 'two levels down is still free');
  });

  T.test('a two-level climb costs two extra hexes', function () {
    const s = F.game({
      board: F.arena({ hexes: { '-2,0': { elevation: 2 } } }),
      units: [F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 })]
    });
    T.eq(Actions.enterCost(s, 0, H(-3, 0), H(-2, 0)), 3);
    const move = T.find(s, { type: 'advance', to: H(-2, 0) });
    T.eq(move.cost, 3, 'the whole Advance is spent on the climb');
  });

  T.test('elevation puts a hex out of reach', function () {
    const flat = F.duel();
    T.ok(T.find(flat, { type: 'advance', to: H(0, 0) }), 'three flat hexes is exactly an Advance');

    const hill = F.game({
      board: F.arena({ hexes: { '0,0': { elevation: 1 } } }),
      units: [F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 })]
    });
    T.notOk(T.find(hill, { type: 'advance', to: H(0, 0) }), 'the same hex, one level up, is not');
  });

  T.test('water costs an extra hex', function () {
    const s = F.game({
      board: F.arena({ hexes: { '-2,0': { terrain: 'water' } } }),
      units: [F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 })]
    });
    T.eq(Actions.enterCost(s, 0, H(-3, 0), H(-2, 0)), 2);
    T.eq(T.find(s, { type: 'advance', to: H(-2, 0) }).cost, 2);
    const beyond = T.find(s, { type: 'advance', to: H(-1, 0) });
    T.eq(beyond.cost, 3, 'wading through and out again');
  });

  T.test('walking up to an enemy costs nothing extra', function () {
    const s = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(1, 0), { tl: 5 })
      ]
    });
    T.ok(State.isEngaged(s, 0, H(0, 0)), 'next to the enemy');
    T.notOk(State.isEngaged(s, 0, H(-1, 0)), 'two hexes away is not');
    T.eq(Actions.enterCost(s, 0, H(-1, 0), H(0, 0)), 1, 'no surcharge to enter');
    T.ok(T.find(s, { type: 'advance', to: H(0, 0) }), 'so the engaged hex is a full Advance away');
  });

  T.test('a move started while Engaged loses one hex', function () {
    const s = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(1, 0), { tl: 5 })
      ]
    });
    T.ok(State.isEngaged(s, 0, H(0, 0)));
    T.ok(T.find(s, { type: 'advance', to: H(-2, 0) }), 'two hexes away is still reachable');
    T.notOk(T.find(s, { type: 'advance', to: H(-3, 0) }), 'but three is not: the Advance is one short');
    const free = F.game({
      rules: { movement: { engagementPenalty: 0 } },
      units: [
        F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(1, 0), { tl: 5 })
      ]
    });
    T.ok(T.find(free, { type: 'advance', to: H(-3, 0) }), 'with the penalty off the full three come back');
  });

  T.test('an enemy on a different elevation does not engage', function () {
    const s = F.game({
      arena: { hexes: { '1,0': { elevation: 1 } } },
      units: [
        F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(1, 0), { tl: 5 })
      ]
    });
    T.notOk(State.isEngaged(s, 0, H(0, 0)), 'the enemy stands a level higher');
    T.ok(T.find(s, { type: 'advance', to: H(-3, 0) }), 'so the Advance is not shortened');
  });

  T.test('an Engaged unit may only attack an enemy it is Engaged with', function () {
    const s = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(1, 0), { tl: 5 }),
        F.unit('b2', 'u03', 1, H(-2, 0), { tl: 5 })
      ]
    });
    const attacks = T.findAll(s, { type: 'attack' });
    T.ok(attacks.length > 0);
    for (let i = 0; i < attacks.length; i++) T.eq(attacks[i].target.id, 'b1', 'only the adjacent enemy');
  });

  T.test('an enemy garrison blocks movement and projects engagement', function () {
    const s = F.game({
      units: [F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 })],
      garrisons: [{ gid: 'g1', side: 1, hex: H(-1, 0) }]
    });
    T.notOk(T.find(s, { type: 'advance', to: H(-1, 0) }), 'cannot enter it');
    T.ok(State.isEngaged(s, 0, H(-2, 0)), 'and it engages the hex next door');
    T.eq(T.find(s, { type: 'advance', to: H(-2, 0) }).cost, 1, 'arriving next to it costs nothing extra');
  });

  T.test('a friendly garrison may be crossed but not stopped on', function () {
    const s = F.game({
      units: [F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 })],
      garrisons: [{ gid: 'g1', side: 0, hex: H(-2, 0) }]
    });
    T.notOk(T.find(s, { type: 'advance', to: H(-2, 0) }), 'not a destination');
    const through = T.find(s, { type: 'advance', to: H(-1, 0) });
    T.eq(through.cost, 2, 'crossed it directly');
    T.deepEq(through.path[1], { q: -2, r: 0 });
  });

  T.test('every reported path is contiguous and ends where it says', function () {
    const s = F.game({
      board: F.arena({
        hexes: {
          '-2,0': { elevation: 1 }, '-2,1': { terrain: 'water' }, '-1,-1': { terrain: 'blocked' }
        }
      }),
      units: [
        F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(2, 1), { tl: 5 })
      ]
    });
    const moves = T.findAll(s, function (a) { return a.type === 'advance' || a.type === 'dash'; });
    T.ok(moves.length > 5, 'there is something to check');
    for (let i = 0; i < moves.length; i++) {
      const p = moves[i].path;
      T.deepEq(p[0], { q: -3, r: 0 }, 'path starts at the unit');
      T.deepEq(p[p.length - 1], moves[i].to, 'path ends at the destination');
      for (let j = 1; j < p.length; j++) {
        T.ok(Hex.isAdjacent(p[j - 1], p[j]), 'step ' + j + ' of ' + Hex.key(moves[i].to));
      }
    }
  });

  T.test('Energize banks a token of Energy', function () {
    const s = T.act(F.duel(), { type: 'energize' });
    T.eq(State.unit(s, 'a1').energy, 1);
  });
});

// --- Purity ------------------------------------------------------------------

T.suite('apply', function () {
  T.test('apply never mutates the state it was given', function () {
    const before = F.duel();
    const frozen = T.snapshot(before);
    const moved = Apply.apply(before, T.find(before, { type: 'advance', to: H(-2, 0) }));
    T.eq(T.snapshot(before), frozen, 'the input state changed');
    T.notOk(moved === before, 'apply returned the same object');
    T.deepEq(T.where(before, 'a1'), { q: -3, r: 0 }, 'the old state still has the old position');
    T.deepEq(T.where(moved, 'a1'), { q: -2, r: 0 });
  });

  T.test('nested state is copied, not shared', function () {
    const before = F.duel();
    const after = Apply.apply(before, T.find(before, { type: 'energize' }));
    T.notOk(after.units === before.units, 'units map shared');
    T.notOk(after.units.a1 === before.units.a1, 'unit object shared');
    T.notOk(after.timeline === before.timeline, 'timeline shared');
    T.notOk(after.timeline.rounds[0].stacks[0] === before.timeline.rounds[0].stacks[0], 'stack shared');
    T.notOk(after.log === before.log, 'log shared');
    T.eq(State.unit(before, 'a1').energy, 0, 'the old state kept its Energy count');
  });

  T.test('a whole run of activations leaves the starting state untouched', function () {
    const start = F.game({
      rules: { match: { phasesPerGame: 1 } },
      units: [
        F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(2, 0), { tl: 2 })
      ]
    });
    const frozen = T.snapshot(start);
    T.drain(start);
    T.eq(T.snapshot(start), frozen);
  });

  T.test('an illegal action throws rather than half-applying', function () {
    const s = F.duel();
    T.throws(function () { Apply.apply(s, { type: 'advance', uid: 'a1', to: H(3, 3) }); },
      'a destination out of range was accepted');
    T.throws(function () { Apply.apply(s, { type: 'end_activation', uid: 'a1' }); },
      'ending without a Primary Action was accepted');
    T.throws(function () { Apply.apply(s, { type: 'attack', uid: 'a1' }); },
      'an action type that does not exist yet was accepted');
    T.throws(function () { Apply.apply(s, { type: 'advance', uid: 'b1', to: H(2, 0) }); },
      'a unit that is not activating was allowed to move');
  });

  T.test('an action may be replayed from its key alone', function () {
    // The path is derived, so a caller -- a saved replay, a UI click -- only
    // has to name the type, the unit and the destination.
    const s = F.duel();
    const moved = Apply.applyAll(s, [
      { type: 'advance', uid: 'a1', to: { q: -2, r: 0 } },
      { type: 'dash', uid: 'a1', to: { q: 0, r: 0 } },
      { type: 'end_activation', uid: 'a1' }
    ]);
    T.deepEq(T.where(moved, 'a1'), { q: 0, r: 0 });
    T.eq(T.tokenRound(moved, 'a1'), 3, 'the Dash was paid for');
  });

  T.test('the same seed and the same actions give the same game', function () {
    const build = function () {
      return F.game({
        seed: 'replay',
        rules: { match: { phasesPerGame: 1 } },
        units: [
          F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 }),
          F.unit('b1', 'u06', 1, H(2, 0), { tl: 1 })
        ]
      });
    };
    const first = T.drain(build());
    const second = T.drain(build());
    T.deepEq(second.order, first.order, 'the same activation order');
    T.eq(T.snapshot(second.state), T.snapshot(first.state), 'the same final state');
    T.eq(first.state.rng, second.state.rng, 'the generator ended in the same place');
  });

  T.test('legalActions is stable in order', function () {
    const s = F.duel();
    T.deepEq(
      Actions.legalActions(s).map(Actions.actionKey),
      Actions.legalActions(s).map(Actions.actionKey)
    );
  });
});

// --- Invariants under random play -------------------------------------------

T.suite('invariants', function () {
  /**
   * Play a game out by picking legal actions with the seeded generator, and
   * check the things that must hold in every position. Hand-written tests only
   * reach the positions somebody thought of; this reaches the others.
   */
  function fuzz(seed, rules) {
    let s = F.game({
      seed: seed,
      rules: rules,
      units: [
        F.unit('a1', 'u01', 0, H(-4, 0), { tl: 1 }),
        F.unit('a2', 'u03', 0, H(-4, 2), { tl: 2 }),
        F.unit('a3', 'u05', 0, H(-3, -2), { tl: 3 }),
        F.unit('b1', 'u02', 1, H(4, 0), { tl: 1 }),
        F.unit('b2', 'u04', 1, H(3, 2), { tl: 2 }),
        F.unit('b3', 'u06', 1, H(4, -2), { tl: 3 })
      ],
      garrisons: [{ gid: 'g1', side: 0, hex: H(-2, 0) }, { gid: 'g2', side: 1, hex: H(2, 0) }],
      objectives: [{ oid: 'o1', hex: H(0, 0), vp: 2 }],
      board: F.arena({
        hexes: {
          '0,-1': { elevation: 1 }, '0,1': { elevation: 2 }, '1,0': { terrain: 'water' },
          '-1,0': { terrain: 'rough' }, '2,-2': { terrain: 'blocked' }
        }
      })
    });

    let rng = Rng.seedFrom(seed);
    let steps = 0;
    while (!Apply.isTerminal(s)) {
      if (++steps > 3000) T.fail('game from seed ' + seed + ' would not end');
      checkInvariants(s, seed);
      const legal = Actions.legalActions(s);
      T.ok(legal.length > 0, 'seed ' + seed + ': no legal action at phase ' +
        s.phase + ' round ' + s.round);
      const pickIndex = Rng.int(rng, legal.length);
      rng = pickIndex.state;
      s = Apply.apply(s, legal[pickIndex.value]);
    }
    checkInvariants(s, seed);
    return s;
  }

  function checkInvariants(s, seed) {
    const tag = 'seed ' + seed + ' phase ' + s.phase + ' round ' + s.round;

    // One unit per hex, and every unit on the board.
    const occupied = {};
    for (let i = 0; i < s.unitOrder.length; i++) {
      const u = s.units[s.unitOrder[i]];
      if (!u.alive) continue;
      const k = Hex.key(u.hex);
      T.notOk(occupied[k], tag + ': two units on ' + k);
      occupied[k] = true;
      T.ok(State.onBoard(s, u.hex), tag + ': ' + u.uid + ' is off the board at ' + k);
      T.notOk(State.terrainAt(s, u.hex).impassable, tag + ': ' + u.uid + ' stands in a wall');
    }

    // Every living unit has exactly one token, and no token is orphaned.
    T.eq(Timeline.tokenCount(s.timeline), State.livingUnits(s).length,
      tag + ': token count does not match the living units');

    if (!Apply.isTerminal(s)) {
      T.ok(s.round >= 1 && s.round <= s.rules.timeline.rounds, tag + ': tracker off the track');
      T.ok(s.activation, tag + ': a live game with nobody activating');
      // Rule 3: whoever is activating is the top of their stack -- until they
      // spend their Primary Action, which is what pushes their token off the
      // round they are standing on.
      if (!s.activation.slots.primary) {
        T.eq(T.stack(s, s.round, s.activation.side)[0], s.activation.uid,
          tag + ': the activating unit is not the top of its stack');
      }
    }
  }

  T.test('random play never deadlocks or corrupts the board', function () {
    for (let i = 0; i < 25; i++) fuzz('fuzz-' + i);
  });

  T.test('random play holds up under the alternative rules readings too', function () {
    const variants = [
      { timeline: { overflow: 'reset' } },
      { timeline: { alternateWithinRound: false } },
      { movement: { engagementPenalty: 0, engagementSameElevation: false } },
      { movement: { noEndOnStartHex: false } },
      { movement: { enemyGarrisonBlocks: false, engagementFromEnemyGarrison: false } },
      { match: { phasesPerGame: 5 } },
      { actions: { maxEnergy: 0 } },
      { timeline: { rounds: 4 } }
    ];
    for (let i = 0; i < variants.length; i++) fuzz('variant-' + i, variants[i]);
  });

  T.test('a random game is reproducible from its seed', function () {
    T.eq(T.snapshot(fuzz('repeat-me')), T.snapshot(fuzz('repeat-me')));
  });
});
