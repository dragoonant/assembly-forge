/**
 * Card mechanics: the resumable attack with response windows, area attacks, crit thresholds, timed weapon effects,
 * crits that move or repeat, granted actions, conditional bonuses, Attack cards, and a unit that survives defeat and
 * strikes back. Every card and unit here is invented for the test.
 */

import * as T from './harness.js';
import * as F from './fixtures.js';

import * as Actions from '../../src/engine/actions.js';
import * as Apply from '../../src/engine/apply.js';
import * as Combat from '../../src/engine/combat.js';
import * as Hex from '../../src/engine/hex.js';
import * as State from '../../src/engine/state.js';

const H = Hex.hex;

function lastAttack(s) {
  return s.log.filter(function (e) { return e.t === 'attack'; }).pop();
}

function legal(s, type) {
  return Actions.legalActions(s).filter(function (a) { return a.type === type; });
}

/** A game with given units and each side's hand, the first unit activating. */
function setup(units, hands, extra) {
  const g = F.game(Object.assign({ units: units }, extra || {}));
  const s = State.clone(g);
  if (hands) {
    for (let side = 0; side < 2; side++) s.players[side].tactics.hand = (hands[side] || []).map(function (c) { return JSON.parse(JSON.stringify(c)); });
  }
  return s;
}

const SURE = { wid: 'sure', tlCost: 2, range: 6, strength: 12, ignoreLos: true };

T.suite('hex rotation', function () {
  T.test('rotating a direction by k gives the k-th direction', function () {
    for (let k = 0; k < 6; k++) T.deepEq(Hex.rotate(Hex.DIRECTIONS[0], k), { q: Hex.DIRECTIONS[k].q, r: Hex.DIRECTIONS[k].r });
    T.deepEq(Hex.rotate({ q: 2, r: -1 }, 6), { q: 2, r: -1 });
  });
});

T.suite('response windows', function () {
  const strengthCard = { cid: 'rs1', timing: 'response', window: 'beforeRoll', role: 'attacker', effects: [{ k: 'attackStrength', n: 3 }] };
  const blockCard = { cid: 'rs2', timing: 'response', window: 'afterRoll', role: 'defender', effects: [{ k: 'reduceDamage', n: 3 }] };

  T.test('with no playable card the attack resolves without stopping', function () {
    let s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [SURE] }), F.unit('b1', 'u06', 1, H(2, 0), { tl: 5, hp: 40 })]);
    s = Apply.apply(s, legal(s, 'attack')[0]);
    T.notOk(s.pending, 'nothing paused');
    T.ok(lastAttack(s), 'resolved');
  });

  T.test('the attacker is offered its before-roll card, and the bonus reaches the dice', function () {
    let s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [SURE] }), F.unit('b1', 'u06', 1, H(2, 0), { tl: 5, hp: 40 })], [[strengthCard]]);
    s = Apply.apply(s, legal(s, 'attack')[0]);
    T.ok(s.pending && s.pending.window === 'beforeRoll' && s.pending.side === 0, 'paused for the attacker');
    T.deepEq(Actions.legalActions(s).map(function (a) { return a.type; }).sort(), ['pass', 'respond']);
    s = Apply.apply(s, { type: 'respond', side: 0, cid: 'rs1' });
    T.eq(lastAttack(s).dice, 15, '12 dice plus 3');
    T.eq(s.players[0].tactics.hand.length, 0, 'the card is spent');
  });

  T.test('the defender can cut damage after seeing the roll', function () {
    let s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [SURE] }), F.unit('b1', 'u06', 1, H(2, 0), { tl: 5, hp: 40 })], [[], [blockCard]]);
    s = Apply.apply(s, legal(s, 'attack')[0]);
    T.ok(s.pending && s.pending.window === 'afterRoll' && s.pending.side === 1, 'paused for the defender after the roll');
    const passed = Apply.apply(s, { type: 'pass', side: 1 });
    const blocked = Apply.apply(s, { type: 'respond', side: 1, cid: 'rs2' });
    T.eq(lastAttack(blocked).damage, lastAttack(passed).damage - 3, 'three less damage with the card');
  });

  T.test('one Tactics card per player per activation', function () {
    let s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [SURE] }), F.unit('b1', 'u06', 1, H(2, 0), { tl: 5, hp: 40 })],
      [[strengthCard, Object.assign({}, strengthCard, { cid: 'rs3', window: 'afterRoll', effects: [{ k: 'attackDamage', n: 1 }] })]]);
    s = Apply.apply(s, legal(s, 'attack')[0]);
    s = Apply.apply(s, { type: 'respond', side: 0, cid: 'rs1' });
    T.notOk(s.pending, 'the after-roll card is not offered once a card has been played');
  });
});

T.suite('area attacks', function () {
  const cone = { wid: 'cone', tlCost: 3, range: 0, strength: 12, ignoreLos: false, area: [[1, 0], [1, -1], [0, 1], [2, 0], [2, -1], [1, 1]] };

  T.test('one roll hits every enemy in the pattern, aimed in any of six directions', function () {
    let s = setup([
      F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [cone] }),
      F.unit('b1', 'u06', 1, H(1, 0), { tl: 5, hp: 40 }),
      F.unit('b2', 'u04', 1, H(2, -1), { tl: 5, hp: 40 }),
      F.unit('b3', 'u03', 1, H(-2, 0), { tl: 5, hp: 40 })
    ]);
    const aims = legal(s, 'attack');
    T.ok(aims.length >= 2, 'several aims');
    const east = aims.find(function (a) { return a.area === 0; });
    T.eq(east.targets.length, 2, 'east catches the two enemies there');
    s = Apply.apply(s, east);
    const e = lastAttack(s);
    T.eq(e.results.length, 2);
    T.ok(e.results.every(function (r) { return r.damage > 0; }), 'both took damage from one roll');
    T.eq(s.units.b3.hp, 40, 'the enemy behind was not caught');
  });

  T.test('an area attack ignores units for line of sight', function () {
    const s = setup([
      F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [cone] }),
      F.unit('b1', 'u06', 1, H(1, 0), { tl: 5, hp: 40 }),
      F.unit('b2', 'u04', 1, H(2, 0), { tl: 5, hp: 40 })
    ]);
    const east = legal(s, 'attack').find(function (a) { return a.area === 0; });
    T.eq(east.targets.length, 2, 'the enemy behind the first is still caught');
  });
});

T.suite('weapon and crit mechanics', function () {
  T.test('an ongoing ability can widen the crit range', function () {
    const u = F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 });
    const g = F.game({ units: [u, F.unit('b1', 'u06', 1, H(3, 0), { tl: 5 })] });
    const s = State.clone(g);
    s.units.a1.abilities = [{ aid: 'z', timing: 'ongoing', effects: [{ k: 'critFrom', n: 7 }] }];
    T.eq(Combat.critFromFor(s, s.units.a1), 7);
    T.ok(Combat.isHit(7, -5, s.rules.combat, 7), 'a 7 hits regardless of accuracy');
  });

  T.test('a weapon can pull its target before the roll, and switch off its Shields after', function () {
    const w = { wid: 'hook', tlCost: 2, range: 3, strength: 6, effects: [{ when: 'beforeRoll', k: 'pull', n: 1 }, { when: 'afterRoll', k: 'shieldsOff' }] };
    let s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [w] }), F.unit('b1', 'u06', 1, H(3, 0), { tl: 5, hp: 40, upgrades: ['shield'] })]);
    s = Apply.apply(s, legal(s, 'attack')[0]);
    T.eq(Hex.distance(s.units.a1.hex, s.units.b1.hex), 2, 'pulled one hex closer');
    T.ok(!lastAttack(s).absorbed, 'the Shield did not absorb anything');
  });

  T.test('after damage a weapon can grant a free Dash, usable after attacking', function () {
    const w = { wid: 'zook', tlCost: 4, range: 4, strength: 6, effects: [{ when: 'afterDamage', k: 'grantDash' }] };
    let s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [w] }), F.unit('b1', 'u06', 1, H(3, 0), { tl: 5, hp: 40 })]);
    s = Apply.apply(s, legal(s, 'attack')[0]);
    const dashes = legal(s, 'dash');
    T.ok(dashes.length > 0 && dashes.every(function (d) { return d.free; }), 'a free Dash is on offer');
    const tl = Apply.tokenAt(s, 'a1').round;
    s = Apply.apply(s, dashes[0]);
    T.eq(Apply.tokenAt(s, 'a1').round, tl, 'and it cost no Timeline');
  });

  T.test('a crit can repeat the attack once, and the repeat cannot repeat again', function () {
    const w = { wid: 'twin', tlCost: 2, range: 3, strength: 20, crit: { repeat: true } };
    let s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [w] }), F.unit('b1', 'u06', 1, H(2, 0), { tl: 5, hp: 400 })]);
    s = Apply.apply(s, legal(s, 'attack')[0]);
    const attacks = s.log.filter(function (e) { return e.t === 'attack'; });
    T.eq(attacks.length, 2, 'the attack and exactly one repeat');
  });

  T.test('a crit can grant a Move that ignores Engagement', function () {
    const w = { wid: 'saber', tlCost: 2, range: 1, strength: 20, crit: { move: 2, ignoreEngagement: true } };
    let s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [w] }), F.unit('b1', 'u06', 1, H(1, 0), { tl: 5, hp: 400 })]);
    s = Apply.apply(s, legal(s, 'attack')[0]);
    const moves = legal(s, 'move');
    T.ok(moves.some(function (m) { return Hex.distance(m.to, H(0, 0)) === 2; }), 'two full hexes despite being Engaged');
  });

  T.test('damage per crit is capped', function () {
    const w = { wid: 'rifle', tlCost: 4, range: 4, strength: 30, crit: { damagePerCrit: 1, max: 4 } };
    let s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [w] }), F.unit('b1', 'u06', 1, H(3, 0), { tl: 5, hp: 400 })]);
    s = Apply.apply(s, legal(s, 'attack')[0]);
    const e = lastAttack(s);
    T.eq(e.damage, e.hits + Math.min(4, e.crits));
  });
});

T.suite('grants, conditions and new effects', function () {
  T.test('a weapon-specific bonus can scale with Garrisons rescued', function () {
    const s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(3, 0), { tl: 5 })]);
    s.players[0].rescued = 2;
    s.units.a1.abilities = [{ aid: 'fc', timing: 'command', target: 'self', effects: [{ k: 'weaponStrength', wid: 'heavy', n: 1, per: 'rescued' }] }];
    const after = Apply.apply(s, { type: 'command', uid: 'a1', aid: 'fc' });
    T.eq(Combat.strengthOf(after, after.units.a1, Combat.weapon(after.units.a1, 'heavy')), 6 + 2);
    T.eq(Combat.strengthOf(after, after.units.a1, Combat.weapon(after.units.a1, 'light')), 3, 'the other weapon is unchanged');
  });

  T.test('a condition can require having attacked with a named weapon this activation', function () {
    let s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [SURE, { wid: 'claw', tlCost: 2, range: 1, strength: 3 }] }), F.unit('b1', 'u06', 1, H(3, 0), { tl: 5, hp: 400 })]);
    s.units.a1.abilities = [{ aid: 'an', timing: 'command', target: 'self', when: { attackedWith: 'sure' }, effects: [{ k: 'grant', grant: { kind: 'attack', wid: 'claw' } }] }];
    T.notOk(Actions.legalActions(s).some(function (a) { return a.type === 'command'; }), 'not before attacking with it');
    s = Apply.apply(s, legal(s, 'attack').find(function (a) { return a.wid === 'sure'; }));
    T.ok(Actions.legalActions(s).some(function (a) { return a.type === 'command'; }), 'available after');
  });

  T.test('a granted chain opens its follow-up only once the first part is used', function () {
    let s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(4, 0), { tl: 5, hp: 40 })]);
    s.units.a1.abilities = [{ aid: 'ce', timing: 'command', target: 'self', effects: [{ k: 'grant', grant: { kind: 'dash', then: { kind: 'attack', wid: 'light' } } }] }];
    s = Apply.apply(s, { type: 'command', uid: 'a1', aid: 'ce' });
    T.ok(legal(s, 'dash').some(function (d) { return d.free; }), 'the free Dash first');
    T.notOk(legal(s, 'attack').some(function (a) { return a.grant !== undefined; }), 'no granted attack yet');
    s = Apply.apply(s, legal(s, 'dash').filter(function (d) { return d.free; }).sort(function (x, y) { return Hex.distance(x.to, H(4, 0)) - Hex.distance(y.to, H(4, 0)); })[0]);
    T.ok(legal(s, 'attack').some(function (a) { return a.grant !== undefined; }), 'then the granted attack');
  });

  T.test('an ongoing Dash bonus adds hexes to a Dash', function () {
    const s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(6, -6), { tl: 5 })]);
    s.units.a1.abilities = [{ aid: 'tt', timing: 'ongoing', effects: [{ k: 'dashBonus', n: 1 }] }];
    T.ok(legal(s, 'dash').some(function (d) { return Hex.distance(d.to, H(0, 0)) === 3; }));
  });

  T.test('a bonus against status-affected targets', function () {
    const s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(3, 0), { tl: 5 })]);
    s.units.a1.abilities = [{ aid: 'ew', timing: 'ongoing', effects: [{ k: 'strengthVsStatus', n: 2 }] }];
    const w = Combat.weapon(s.units.a1, 'heavy');
    T.eq(Combat.strengthOf(s, s.units.a1, w, undefined, [{ kind: 'unit', id: 'b1' }]), 6);
    s.units.b1.statuses.push('slow');
    T.eq(Combat.strengthOf(s, s.units.a1, w, undefined, [{ kind: 'unit', id: 'b1' }]), 8);
  });

  T.test('an ability can cost its own unit hit points, and gain an Upgrade', function () {
    const s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(3, 0), { tl: 5 })]);
    s.units.a1.abilities = [{ aid: 'ex', timing: 'command', target: 'self', effects: [{ k: 'damageSelf', n: 3 }, { k: 'upgrade', s: 'speed' }] }];
    const after = Apply.apply(s, { type: 'command', uid: 'a1', aid: 'ex' });
    T.eq(after.units.a1.hp, s.units.a1.hp - 3);
    T.deepEq(after.units.a1.upgrades, ['speed']);
  });
});

T.suite('attack cards and surviving defeat', function () {
  T.test('an Attack card fires its own weapon in place of the Primary Attack', function () {
    const card = { cid: 'ac1', timing: 'attack', requires: { defId: 'u02' }, weapon: { tlCost: 3, range: 5, strength: 7, strengthPerAlly: { n: 2, range: 3 }, crit: { damage: 2 } } };
    let s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }), F.unit('a2', 'u04', 0, H(-1, 0), { tl: 5 }), F.unit('b1', 'u06', 1, H(4, 0), { tl: 5, hp: 400 })], [[card]]);
    const plays = Actions.legalActions(s).filter(function (a) { return a.type === 'tactics' && a.cid === 'ac1'; });
    T.ok(plays.length === 1, 'offered against the one enemy in range');
    s = Apply.apply(s, plays[0]);
    T.eq(lastAttack(s).dice, 9, '7 dice plus 2 for the ally within 3');
    T.eq(s.activation.slots.primary, 'attack', 'it was the Primary Attack');
  });

  T.test('a unit that would be defeated can survive at 1 HP, move, and strike back', function () {
    const save = { cid: 'sv1', timing: 'response', window: 'wouldBeDefeated', role: 'defender', requires: { defId: 'u06' },
      effects: [{ k: 'surviveDefeat', move: 2, attackWid: 'light' }] };
    let s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [SURE] }), F.unit('b1', 'u06', 1, H(2, 0), { tl: 5, hp: 5 })], [[], [save]]);
    s = Apply.apply(s, legal(s, 'attack')[0]);
    T.ok(s.pending && s.pending.window === 'wouldBeDefeated' && s.pending.side === 1, 'the defender is asked first');
    s = Apply.apply(s, { type: 'respond', side: 1, cid: 'sv1' });
    T.eq(s.units.b1.hp, 1, 'standing at 1 HP');
    T.eq(s.pending && s.pending.kind, 'react_move', 'then it moves');
    const moves = Actions.legalActions(s).filter(function (a) { return a.type === 'react_move'; });
    const toward = moves.sort(function (x, y) { return Hex.distance(x.to, H(0, 0)) - Hex.distance(y.to, H(0, 0)); })[0];
    s = Apply.apply(s, toward);
    T.eq(s.pending && s.pending.kind, 'react_attack', 'then it attacks');
    const hpBefore = s.units.a1.hp;
    const shot = Actions.legalActions(s).find(function (a) { return a.type === 'react_attack'; });
    s = Apply.apply(s, shot);
    T.notOk(s.pending, 'everything resolved');
    T.ok(s.units.a1.hp <= hpBefore, 'the counter-attack was made');
    T.ok(s.units.b1.alive, 'and the defender is still standing');
  });

  T.test('random play with response cards in hand never wedges', function () {
    const cards = [
      { cid: 'r1', timing: 'response', window: 'beforeRoll', role: 'attacker', effects: [{ k: 'attackStrength', n: 2 }] },
      { cid: 'r2', timing: 'response', window: 'afterRoll', role: 'defender', effects: [{ k: 'reduceDamage', n: 2 }] },
      { cid: 'r3', timing: 'response', window: 'afterDamage', role: 'attacker', effects: [{ k: 'damageAttackerAndTargets', n: 1 }] }
    ];
    for (let seed = 0; seed < 6; seed++) {
      let s = setup([F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(2, 0), { tl: 2 })], [cards, cards], { seed: 'wedge-' + seed });
      let guard = 0;
      while (!Apply.isTerminal(s) && s.activation && guard++ < 4000) {
        const opts = Actions.legalActions(s);
        T.ok(opts.length > 0, 'always something to do');
        s = Apply.apply(s, opts[(guard * 7 + seed) % opts.length]);
      }
      T.ok(Apply.isTerminal(s), 'the game finished');
    }
  });
});
