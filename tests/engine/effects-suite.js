/**
 * Abilities and Tactics cards.
 *
 * Both are the same structure resolved by the same code, so most of what is
 * asserted here holds for either. Where they differ -- a card is a finite
 * resource that leaves the hand, an ability is not -- there are separate tests.
 */

import * as T from './harness.js';
import * as F from './fixtures.js';

import * as Actions from '../../src/engine/actions.js';
import * as Apply from '../../src/engine/apply.js';
import * as Combat from '../../src/engine/combat.js';
import * as Effects from '../../src/engine/effects.js';
import * as Hex from '../../src/engine/hex.js';
import * as State from '../../src/engine/state.js';
import * as Timeline from '../../src/engine/timeline.js';
import * as Units from '../../src/content/units.js';

const H = Hex.hex;

/** A one-unit game where that unit carries exactly the abilities given. */
function withAbilities(abilities, opts) {
  const o = opts || {};
  const g = F.game({
    seed: o.seed || 'fx',
    rules: o.rules,
    units: [
      F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: o.weapons }),
      F.unit('b1', 'u06', 1, o.enemyAt || H(2, 0), { tl: 9, hp: o.enemyHp })
    ],
    objectives: o.objectives,
    garrisons: o.garrisons,
    tactics: o.tactics
  });
  State.unit(g, 'a1').abilities = abilities;
  State.unit(g, 'a1').energy = o.energy === undefined ? 3 : o.energy;
  return g;
}

T.suite('command abilities', function () {
  T.test('a command ability is free and spends its Energy', function () {
    const g = withAbilities([
      { aid: 'x', timing: 'command', energy: 1, target: 'self', effects: [{ k: 'strength', n: 3 }] }
    ]);
    const before = Timeline.locate(g.timeline, 'a1').round;
    const after = T.act(g, function (a) { return a.type === 'command'; });
    T.eq(State.unit(after, 'a1').energy, 2, 'one Energy spent');
    T.eq(Timeline.locate(after.timeline, 'a1').round, before, 'no Timeline cost');
    T.eq(after.activation.slots.primary, null, 'and it is not the Primary Action');
  });

  T.test('without the Energy it is not offered at all', function () {
    const g = withAbilities([
      { aid: 'x', timing: 'command', energy: 2, target: 'self', effects: [{ k: 'strength', n: 3 }] }
    ], { energy: 1 });
    T.eq(T.findAll(g, function (a) { return a.type === 'command'; }).length, 0);
  });

  T.test('it may be used once per activation, not twice', function () {
    const g = withAbilities([
      { aid: 'x', timing: 'command', energy: 1, target: 'self', effects: [{ k: 'energy', n: 0 }] }
    ]);
    const after = T.act(g, function (a) { return a.type === 'command'; });
    T.eq(T.findAll(after, function (a) { return a.type === 'command' && a.aid === 'x'; }).length, 0);
  });

  T.test('a strength buff really does add dice', function () {
    const g = withAbilities([
      { aid: 'x', timing: 'command', energy: 1, target: 'self', effects: [{ k: 'strength', n: 3 }] }
    ]);
    const u = State.unit(g, 'a1');
    const w = Combat.weapon(u, 'light');
    const before = Combat.strengthOf(g, u, w);
    const after = T.act(g, function (a) { return a.type === 'command'; });
    T.eq(Combat.strengthOf(after, State.unit(after, 'a1'), w), before + 3);
  });

  T.test('a buff expires with the activation', function () {
    const g = withAbilities([
      { aid: 'x', timing: 'command', energy: 1, target: 'self', effects: [{ k: 'strength', n: 3 }] }
    ]);
    let s = T.act(g, function (a) { return a.type === 'command'; });
    s = T.pass(s);
    // Whoever activates next, a1's activation-scoped modifier is gone with it.
    T.ok(!s.activation || s.activation.uid !== 'a1' || s.activation.mods.strength === 0);
  });

  T.test('"move" is an additional Move, usable after the Advance', function () {
    // Movement from cards and abilities is in addition to the Advance (rulebook 2026-10-30, "Advance").
    const g = withAbilities([
      { aid: 'x', timing: 'command', energy: 1, target: 'self', effects: [{ k: 'move', n: 2 }] }
    ]);
    let s = T.act(g, function (a) { return a.type === 'advance'; });
    s = T.act(s, function (a) { return a.type === 'command'; });
    const moves = T.findAll(s, function (a) { return a.type === 'move'; });
    T.ok(moves.length > 0, 'a granted Move after the Advance');
    T.ok(moves.every(function (m) { return m.cost <= 2; }), 'of up to two hexes');
  });

  T.test('a targeted ability lists one action per enemy in range', function () {
    const g = withAbilities([
      { aid: 'x', timing: 'command', energy: 1, target: 'enemyInRange', range: 3,
        effects: [{ k: 'status', s: 'slow' }] }
    ]);
    const opts = T.findAll(g, function (a) { return a.type === 'command'; });
    T.eq(opts.length, 1);
    T.eq(opts[0].targetUid, 'b1');
    const after = Apply.apply(g, opts[0]);
    T.ok(State.unit(after, 'b1').statuses.indexOf('slow') !== -1);
  });

  T.test('extraAttack grants an attack that costs no Timeline', function () {
    const g = withAbilities([
      { aid: 'x', timing: 'command', energy: 1, target: 'self', effects: [{ k: 'extraAttack', n: 1 }] }
    ]);
    let s = T.act(g, function (a) { return a.type === 'attack'; });   // spends the Primary
    T.eq(s.activation.slots.primary, 'attack');
    T.eq(T.findAll(s, function (a) { return a.type === 'attack'; }).length, 0, 'no more attacks');
    s = T.act(s, function (a) { return a.type === 'command'; });
    const free = T.findAll(s, function (a) { return a.type === 'attack'; });
    T.ok(free.length > 0, 'the ability granted one');
    const at = Timeline.locate(s.timeline, 'a1').round;
    const after = Apply.apply(s, free[0]);
    T.eq(Timeline.locate(after.timeline, 'a1').round, at, 'and it cost no Timeline');
  });
});

T.suite('ongoing abilities', function () {
  T.test('an ongoing modifier only applies while its condition holds', function () {
    const g = withAbilities([
      { aid: 'o', timing: 'ongoing', when: { damageTaken: 5 }, effects: [{ k: 'strength', n: 2 }] }
    ]);
    const u = State.unit(g, 'a1');
    const w = Combat.weapon(u, 'light');
    T.eq(Combat.strengthOf(g, u, w), w.strength, 'undamaged, no bonus');

    const hurt = State.clone(g);
    hurt.units.a1.hp = hurt.units.a1.maxHp - 5;
    T.eq(Combat.strengthOf(hurt, State.unit(hurt, 'a1'), w), w.strength + 2, 'and it switches on');
  });

  T.test('two ongoing abilities stack', function () {
    const g = withAbilities([
      { aid: 'o1', timing: 'ongoing', when: { damageTaken: 2 }, effects: [{ k: 'strength', n: 1 }] },
      { aid: 'o2', timing: 'ongoing', when: { damageTaken: 4 }, effects: [{ k: 'strength', n: 1 }] }
    ]);
    const w = Combat.weapon(State.unit(g, 'a1'), 'light');
    const hurt = State.clone(g);
    hurt.units.a1.hp = hurt.units.a1.maxHp - 4;
    T.eq(Combat.strengthOf(hurt, State.unit(hurt, 'a1'), w), w.strength + 2);
  });

  T.test('an ongoing ability is never offered as an action', function () {
    const g = withAbilities([
      { aid: 'o', timing: 'ongoing', effects: [{ k: 'strength', n: 2 }] }
    ]);
    T.eq(T.findAll(g, function (a) { return a.type === 'command'; }).length, 0);
  });

  T.test('the objectives condition reads real control', function () {
    const g = withAbilities([
      { aid: 'o', timing: 'ongoing', when: { objectives: 1 }, effects: [{ k: 'strength', n: 1 }] }
    ], { objectives: [{ oid: 'o1', hex: H(0, 3), vp: 1 }] });
    const u = State.unit(g, 'a1');
    T.notOk(Effects.conditionHolds(g, u, { objectives: 1 }), 'nothing held yet');
    const held = State.clone(g);
    held.objectives.o1.controlledBy = 0;
    T.ok(Effects.conditionHolds(held, State.unit(held, 'a1'), { objectives: 1 }));
  });
});

T.suite('response abilities', function () {
  T.test('a rescue response fires when the garrison is claimed', function () {
    const g = withAbilities([
      { aid: 'r', timing: 'response', on: 'rescue', effects: [{ k: 'energy', n: 2 }] }
    ], { energy: 0, garrisons: [{ gid: 'g1', side: 0, hex: H(1, 0) }] });
    const after = T.act(g, function (a) { return a.type === 'rescue'; });
    T.eq(State.unit(after, 'a1').energy, 2, 'the response paid out');
  });

  T.test('a response for a different event does not fire', function () {
    const g = withAbilities([
      { aid: 'r', timing: 'response', on: 'destroy', effects: [{ k: 'energy', n: 2 }] }
    ], { energy: 0, garrisons: [{ gid: 'g1', side: 0, hex: H(1, 0) }] });
    const after = T.act(g, function (a) { return a.type === 'rescue'; });
    T.eq(State.unit(after, 'a1').energy, 0);
  });
});

T.suite('statuses from abilities', function () {
  T.test('the same status does not stack', function () {
    const g = withAbilities([
      { aid: 'x', timing: 'command', energy: 1, target: 'enemyInRange', range: 3,
        effects: [{ k: 'status', s: 'slow' }] },
      { aid: 'y', timing: 'command', energy: 1, target: 'enemyInRange', range: 3,
        effects: [{ k: 'status', s: 'slow' }] }
    ]);
    let s = T.act(g, function (a) { return a.type === 'command' && a.aid === 'x'; });
    s = T.act(s, function (a) { return a.type === 'command' && a.aid === 'y'; });
    const statuses = State.unit(s, 'b1').statuses.filter(function (x) { return x === 'slow'; });
    T.eq(statuses.length, 1);
  });

  T.test('an unknown status is rejected rather than silently stored', function () {
    const g = withAbilities([]);
    T.throws(function () { Combat.applyStatus(g, 'b1', 'confused'); });
  });

  T.test('slow makes the next Advance move nothing, then clears', function () {
    const g = F.game({
      units: [F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(5, 0), { tl: 9 })]
    });
    State.unit(g, 'a1').statuses.push('slow');
    const advances = Actions.legalActions(g).filter(function (a) { return a.type === 'advance'; });
    T.eq(advances.length, 1, 'one Advance on offer');
    T.ok(advances[0].slowed && advances[0].cost === 0, 'and it goes nowhere');
    T.ok(Actions.legalActions(g).some(function (a) { return a.type === 'dash'; }), 'Dash is unaffected');
    const after = Apply.apply(g, advances[0]);
    T.eq(State.unit(after, 'a1').statuses.indexOf('slow'), -1, 'the status is spent');
    T.ok(Hex.equals(State.unit(after, 'a1').hex, H(0, 0)), 'and the unit has not moved');
  });

  T.test('a slowed unit that never Advances keeps the status', function () {
    const g = F.game({
      units: [F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(5, 0), { tl: 9 })]
    });
    State.unit(g, 'a1').statuses.push('slow');
    const s = Apply.apply(Apply.apply(g, { type: 'energize', uid: 'a1' }), { type: 'end_activation', uid: 'a1' });
    T.ok(State.unit(s, 'a1').statuses.indexOf('slow') !== -1);
  });
});

T.suite('tactics cards', function () {
  const deck = [
    { cid: 'c1', timing: 'command', target: 'self', effects: [{ k: 'strength', n: 2 }] },
    { cid: 'c2', timing: 'command', target: 'self', effects: [{ k: 'energy', n: 1 }] },
    { cid: 'c3', timing: 'command', target: 'self', effects: [{ k: 'heal', n: 2 }] }
  ];

  function withDeck(size) {
    return withAbilities([], { tactics: [deck.slice(0, size === undefined ? 3 : size), []] });
  }

  T.test('an opening hand is drawn from the deck', function () {
    const g = withDeck();
    T.eq(g.players[0].tactics.hand.length, 3, 'three in hand');
    T.eq(g.players[0].tactics.deck.length, 0, 'and the deck is down by three');
  });

  T.test('playing a card moves it from hand to discard', function () {
    const g = withDeck();
    const after = T.act(g, function (a) { return a.type === 'tactics'; });
    T.eq(after.players[0].tactics.hand.length, 2);
    T.eq(after.players[0].tactics.discard.length, 1);
  });

  T.test('a card is free and is not the Primary Action', function () {
    const g = withDeck();
    const before = Timeline.locate(g.timeline, 'a1').round;
    const after = T.act(g, function (a) { return a.type === 'tactics'; });
    T.eq(Timeline.locate(after.timeline, 'a1').round, before);
    T.eq(after.activation.slots.primary, null);
  });

  T.test('only one card per unit turn', function () {
    const g = withDeck();
    const after = T.act(g, function (a) { return a.type === 'tactics'; });
    T.eq(T.findAll(after, function (a) { return a.type === 'tactics'; }).length, 0);
  });

  T.test('a card effect is the same machinery as an ability', function () {
    const g = withDeck();
    const u = State.unit(g, 'a1');
    const w = Combat.weapon(u, 'light');
    const before = Combat.strengthOf(g, u, w);
    const after = T.act(g, function (a) { return a.type === 'tactics' && a.cid === 'c1'; });
    T.eq(Combat.strengthOf(after, State.unit(after, 'a1'), w), before + 2);
  });

  T.test('an empty deck simply means an empty hand, not an error', function () {
    const g = withAbilities([], { tactics: [[], []] });
    T.eq(g.players[0].tactics.hand.length, 0);
    T.eq(T.findAll(g, function (a) { return a.type === 'tactics'; }).length, 0);
  });

  T.test('deckbuilding honours the trait requirement', function () {
    const Tactics = { allowedFor: null };
    // Imported lazily to keep this suite independent of content ordering.
    return import('../../src/content/tactics.js').then(function (mod) {
      const durable = [Units.def('u01')];          // durable, support
      const artillery = [Units.def('u03')];        // artillery
      T.ok(mod.allowedFor(mod.card('t09'), durable), 'durable squad gets the durable card');
      T.notOk(mod.allowedFor(mod.card('t09'), artillery), 'artillery squad does not');
      T.ok(mod.allowedFor(mod.card('t01'), artillery), 'unrestricted cards are open to all');
      T.eq(mod.buildDeck([Units.def('u01'), Units.def('u03'), Units.def('u05')]).length, 9);
    });
  });
});

T.suite('reserve and conditions', function () {
  T.test('a unit in Reserve has no position conditions, and asking does not throw', function () {
    const g = F.game({
      units: [F.unit('a1', 'u02', 0, null), F.unit('b1', 'u06', 1, H(3, 0))],
      bases: [{ bid: 'b0', side: 0, hex: H(-4, 0) }, { bid: 'b1', side: 1, hex: H(4, 0) }]
    });
    const u = State.unit(g, 'a1');
    T.notOk(Effects.conditionHolds(g, u, { enemyAdjacent: true }));
    T.notOk(Effects.conditionHolds(g, u, { alliesInRange: { n: 0, range: 3 } }));
    T.ok(Effects.conditionHolds(g, u, null), 'no condition still holds');
  });
});
