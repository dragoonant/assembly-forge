/**
 * Card mechanics: the resumable attack with response windows, area attacks, crit thresholds, timed weapon effects,
 * crits that move or repeat, granted actions, conditional bonuses, Attack cards, and a unit that survives defeat and
 * strikes back. Every card and unit here is invented for the test.
 */

import * as T from './harness.js';
import * as F from './fixtures.js';

import * as Actions from '../../src/engine/actions.js';
import * as Apply from '../../src/engine/apply.js';
import * as Attack from '../../src/engine/attack.js';
import * as Combat from '../../src/engine/combat.js';
import * as AI from '../../src/ai/ai.js';
import * as Hex from '../../src/engine/hex.js';
import * as State from '../../src/engine/state.js';
import * as Sk from '../../src/content/scenarios/skirmish.js';
import * as Tac from '../../src/content/tactics.js';
import * as Units from '../../src/content/units.js';

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
    T.eq(s.pending && s.pending.kind, 'displace', 'the attacker chooses where the pull takes it');
    T.notOk(lastAttack(s), 'and the attack waits for that choice');
    s = Apply.apply(s, legal(s, 'displace').filter(function (d) { return !d.collide; })[0]);
    T.eq(Hex.distance(s.units.a1.hex, s.units.b1.hex), 2, 'pulled one hex closer');
    T.ok(lastAttack(s), 'then the attack resolves');
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

T.suite('push and pull choices', function () {
  function pusher(extra) {
    const s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(1, 0), { tl: 5, hp: 40 })], null, extra);
    s.units.a1.abilities = [{ aid: 'he', timing: 'command', target: 'adjacentEnemy', effects: [{ k: 'push', n: 2 }, { k: 'damage', n: 1 }] }];
    return Apply.apply(s, { type: 'command', uid: 'a1', aid: 'he', targetUid: 'b1' });
  }

  T.test('the pushing player chooses each hex, among every hex strictly further away', function () {
    const s = pusher();
    T.eq(s.pending.kind, 'displace');
    const steps = legal(s, 'displace');
    T.ok(steps.length >= 2, 'more than one choice');
    for (const d of steps) T.ok(Hex.distance(H(0, 0), d.to) === 2, 'each step goes further from the source');
    T.ok(legal(s, 'displace_stop').length === 1, 'and stopping early is allowed');
  });

  T.test('the effects after a push wait for it, then resolve', function () {
    let s = pusher();
    const hp = s.units.b1.hp;
    T.eq(hp, 40, 'no damage yet');
    s = Apply.apply(s, legal(s, 'displace').filter(function (d) { return !d.collide; })[0]);
    s = Apply.apply(s, legal(s, 'displace').filter(function (d) { return !d.collide; })[0]);
    T.notOk(s.pending, 'the push has ended');
    T.eq(Hex.distance(s.units.a1.hex, s.units.b1.hex), 3, 'two hexes further');
    T.eq(s.units.b1.hp, 39, 'then the ability dealt its 1 damage');
  });

  T.test('stopping early still resolves the rest of the ability', function () {
    let s = pusher();
    s = Apply.apply(s, legal(s, 'displace_stop')[0]);
    T.ok(Hex.equals(s.units.b1.hex, H(1, 0)), 'not moved');
    T.eq(s.units.b1.hp, 39);
  });

  T.test('choosing a blocked hex is a collision for 2 damage, and the push ends', function () {
    let s = pusher({ arena: { hexes: { '2,0': { elevation: 1 } } } });
    const into = legal(s, 'displace').find(function (d) { return d.collide && Hex.equals(d.to, H(2, 0)); });
    T.ok(into, 'the higher hex is offered as a collision');
    s = Apply.apply(s, into);
    T.notOk(s.pending, 'the push ended');
    T.ok(Hex.equals(s.units.b1.hex, H(1, 0)), 'the target stayed put');
    T.eq(s.units.b1.hp, 40 - 2 - 1, 'collision damage, then the ability damage');
  });

  T.test('a pull never moves onto the source and goes strictly closer', function () {
    const s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(3, 0), { tl: 5, hp: 40 })]);
    s.units.a1.abilities = [{ aid: 'pl', timing: 'command', target: 'enemyInRange', range: 3, effects: [{ k: 'pull', n: 2 }] }];
    const after = Apply.apply(s, { type: 'command', uid: 'a1', aid: 'pl', targetUid: 'b1' });
    for (const d of legal(after, 'displace')) T.eq(Hex.distance(H(0, 0), d.to), 2);
  });

  T.test('the AI makes push choices and finishes games with them', function () {
    for (let seed = 0; seed < 4; seed++) {
      let s = setup([F.unit('a1', 'u02', 0, H(-2, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(2, 0), { tl: 2 })], null, { seed: 'push-ai-' + seed });
      for (const id of ['a1', 'b1']) s.units[id].abilities = [{ aid: 'p' + id, timing: 'command', target: 'adjacentEnemy', effects: [{ k: 'push', n: 2 }, { k: 'damage', n: 1 }] }];
      const out = AI.playOut(s);
      T.ok(out.state.over, 'finished');
    }
  });
});

T.suite('triggered unit responses', function () {
  /** a1 has a response to its own Dash: 1 damage to an adjacent enemy. */
  function kicker(optional, enemies) {
    const units = [F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 })].concat(enemies.map(function (e, i) {
      return F.unit('b' + (i + 1), 'u06', 1, e, { tl: 5 + i, hp: 40 });
    }));
    const s = setup(units);
    s.units.a1.abilities = [{ aid: 'kick', timing: 'response', on: 'dash', target: 'adjacentEnemy', optional: optional, effects: [{ k: 'damage', n: 1 }] }];
    return s;
  }
  function dashNextTo(s, at) {
    return legal(s, 'dash').find(function (d) { return Hex.equals(d.to, at); });
  }

  T.test('an optional response is offered after the event, and declining it does nothing', function () {
    let s = kicker(true, [H(3, 0)]);
    s = Apply.apply(s, dashNextTo(s, H(2, 0)));
    T.ok(s.pending && s.pending.kind === 'trigger' && s.pending.side === 0, 'the owner decides');
    T.deepEq(Actions.legalActions(s).map(function (a) { return a.type; }).sort(), ['trigger', 'trigger_skip']);
    const used = Apply.apply(s, legal(s, 'trigger')[0]);
    const declined = Apply.apply(s, legal(s, 'trigger_skip')[0]);
    T.eq(used.units.b1.hp, 39, 'used: 1 damage');
    T.eq(declined.units.b1.hp, 40, 'declined: none');
    T.notOk(declined.pending, 'the activation carries on');
    T.ok(legal(declined, 'end_activation').length, 'and can end');
  });

  T.test('with two possible targets the owner picks one, even when the response is mandatory', function () {
    let s = kicker(false, [H(3, 0), H(2, 1)]);
    s = Apply.apply(s, dashNextTo(s, H(2, 0)));
    T.ok(s.pending && s.pending.kind === 'trigger', 'a choice of target');
    T.eq(legal(s, 'trigger_skip').length, 0, 'mandatory: no decline');
    const onB2 = legal(s, 'trigger').find(function (a) { return a.targetUid === 'b2'; });
    s = Apply.apply(s, onB2);
    T.eq(s.units.b2.hp, 39);
    T.eq(s.units.b1.hp, 40);
  });

  T.test('a mandatory response with one target still fires on its own', function () {
    let s = kicker(false, [H(3, 0)]);
    s = Apply.apply(s, dashNextTo(s, H(2, 0)));
    T.notOk(s.pending, 'no prompt');
    T.eq(s.units.b1.hp, 39);
  });

  T.test('with nobody adjacent the response is not offered', function () {
    let s = kicker(true, [H(5, 0)]);
    s = Apply.apply(s, dashNextTo(s, H(1, 0)));
    T.notOk(s.pending);
  });
});

T.suite('chosen decks', function () {
  T.test('a legal chosen deck is used, an illegal one falls back to the suggestion', function () {
    const squads = Sk.squadsFor();
    const defs = squads[0].map(function (d) { return Units.def(d); });
    const pool = Tac.deckPool(defs);
    T.ok(pool.length >= 9, 'enough cards to choose from');
    const mine = pool.slice(pool.length - 9);
    const g = State.createGame(Sk.skirmish({ seed: 'deck', decks: [mine, ['nope']] }));
    const all0 = g.players[0].tactics.hand.concat(g.players[0].tactics.deck).map(function (c) { return c.cid; }).sort();
    T.deepEq(all0, mine.slice().sort(), 'side 0 plays its own nine');
    const all1 = g.players[1].tactics.hand.concat(g.players[1].tactics.deck).map(function (c) { return c.cid; }).sort();
    T.deepEq(all1, Tac.buildDeck(squads[1].map(function (d) { return Units.def(d); })).slice().sort(), 'side 1 gets the suggestion');
    T.notOk(Tac.isLegalDeck(mine.slice(0, 8).concat([mine[0]]), defs), 'duplicates are illegal');
    T.notOk(Tac.isLegalDeck(mine.slice(0, 8), defs), 'eight is too few');
  });
});

T.suite('card audit fixes', function () {
  // a 60-degree wedge out to distance 2, as the area cards draw it: d + 1 hexes at each distance d
  const wedge2 = { wid: 'wedge', tlCost: 3, range: 0, strength: 12, ignoreLos: false, area: [[1, 0], [1, -1], [2, 0], [2, -1], [2, -2]] };

  T.test('a wedge pattern covers d + 1 hexes at each distance and rotates to all six aims', function () {
    const s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [wedge2] }), F.unit('b1', 'u06', 1, H(5, -5), { tl: 5 })]);
    for (let dir = 0; dir < 6; dir++) {
      const hexes = Attack.areaHexes(s, s.units.a1, wedge2, dir);
      const byDist = [0, 0, 0];
      for (const h of hexes) byDist[Hex.distance(H(0, 0), h)]++;
      T.deepEq(byDist, [0, 2, 3], 'aim ' + dir);
    }
  });

  T.test('a card for "a defender" covers only the defender its player picks', function () {
    const block = { cid: 'qb', timing: 'response', window: 'afterRoll', role: 'defender', pick: 'one', effects: [{ k: 'reduceDamage', n: 3 }] };
    let s = setup([
      F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [wedge2] }),
      F.unit('b1', 'u06', 1, H(1, 0), { tl: 5, hp: 40 }),
      F.unit('b2', 'u04', 1, H(2, -1), { tl: 6, hp: 40 })
    ], [[], [block]]);
    s = Apply.apply(s, legal(s, 'attack').find(function (a) { return a.area === 0; }));
    T.ok(s.pending && s.pending.window === 'afterRoll' && s.pending.side === 1);
    const plays = legal(s, 'respond');
    T.deepEq(plays.map(function (a) { return a.targetUid; }).sort(), ['b1', 'b2'], 'one option per defender');
    const passed = lastAttack(Apply.apply(s, { type: 'pass', side: 1 }));
    const onB2 = lastAttack(Apply.apply(s, plays.find(function (a) { return a.targetUid === 'b2'; })));
    const dmg = function (e, id) { return e.results.find(function (r) { return r.ref.id === id; }).damage; };
    T.eq(dmg(onB2, 'b1'), dmg(passed, 'b1'), 'b1 unprotected');
    T.eq(dmg(onB2, 'b2'), Math.max(0, dmg(passed, 'b2') - 3), 'b2 protected');
  });

  T.test('a chained grant whose first part has nowhere to go offers its next part', function () {
    let s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(1, 0), { tl: 5, hp: 40 })],
      null, { arena: { hexes: { '0,-1': { terrain: 'blocked' }, '1,-1': { terrain: 'blocked' }, '-1,0': { terrain: 'blocked' }, '-1,1': { terrain: 'blocked' }, '0,1': { terrain: 'blocked' } } } });
    s.units.a1.abilities = [{ aid: 'ce', timing: 'command', target: 'self', effects: [{ k: 'grant', grant: { kind: 'dash', then: { kind: 'attack', wid: 'light' } } }] }];
    s = Apply.apply(s, { type: 'command', uid: 'a1', aid: 'ce' });
    T.notOk(legal(s, 'dash').some(function (d) { return d.free; }), 'boxed in: no free Dash');
    const atk = legal(s, 'attack').find(function (a) { return a.grant !== undefined; });
    T.ok(atk && atk.skipped === 1, 'the granted attack is offered directly');
    s = Apply.apply(s, atk);
    T.eq(s.activation.grants.length, 0, 'the whole chain is spent');
  });

  T.test('ability damage that would defeat a unit opens the save, and the ability then finishes', function () {
    const save = { cid: 'sv2', timing: 'response', window: 'wouldBeDefeated', role: 'defender', requires: { defId: 'u02' },
      effects: [{ k: 'surviveDefeat', move: 2, attackWid: 'light' }] };
    let s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, hp: 3 }), F.unit('b1', 'u06', 1, H(2, 0), { tl: 5, hp: 40 })], [[save]]);
    s.units.a1.abilities = [{ aid: 'ex', timing: 'command', target: 'self', effects: [{ k: 'damageSelf', n: 3 }, { k: 'grant', grant: { kind: 'move', n: 2 } }] }];
    s = Apply.apply(s, { type: 'command', uid: 'a1', aid: 'ex' });
    T.ok(s.pending && s.pending.window === 'wouldBeDefeated' && s.pending.side === 0, 'its player is asked');
    T.eq(s.units.a1.hp, 1, 'held at 1 HP while deciding');

    const passed = Apply.apply(s, { type: 'pass', side: 0 });
    T.notOk(passed.units.a1.alive, 'passing: defeated');
    T.eq(passed.players[1].vp, s.units.a1.vp, 'the enemy scores it');

    s = Apply.apply(s, { type: 'respond', side: 0, cid: 'sv2' });
    T.eq(s.pending && s.pending.kind, 'react_move', 'saved: it moves');
    s = Apply.apply(s, { type: 'pass', side: 0 });
    T.eq(s.pending && s.pending.kind, 'react_attack', 'then strikes');
    s = Apply.apply(s, { type: 'pass', side: 0 });
    T.notOk(s.pending);
    T.ok(s.units.a1.alive && s.units.a1.hp === 1);
    T.ok(s.activation.grants.some(function (g) { return g.kind === 'move'; }), 'the rest of the ability resolved');
  });
});

T.suite('rulebook audit fixes', function () {
  T.test('a crit Fracture lands before damage and counts on the same attack', function () {
    const w = { wid: 'fx', tlCost: 2, range: 6, strength: 12, ignoreLos: true, crit: { status: 'fracture' } };
    for (let seed = 0; seed < 20; seed++) {
      let s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [w] }), F.unit('b1', 'u06', 1, H(2, 0), { tl: 5, hp: 400 })], null, { seed: 'fx' + seed });
      s = Apply.apply(s, legal(s, 'attack')[0]);
      const e = lastAttack(s);
      const r = e.results[0];
      if (!r.status) continue;
      T.ok(r.hits >= 3, 'twelve dice with a crit: plenty of hits');
      T.eq(r.damage, r.hits + 3, 'Fracture added on the attack that applied it');
      T.eq(s.units.b1.statuses.indexOf('fracture'), -1, 'and spent');
      return;
    }
    T.ok(false, 'no crit in twenty seeds');
  });

  T.test('Fracture is applied before Shields', function () {
    const s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(3, 0), { tl: 5, hp: 40 })]);
    s.units.b1.statuses.push('fracture');
    s.units.b1.upgrades.push('shield');
    const r = Combat.dealDamage(s, { kind: 'unit', id: 'b1' }, 3, 0, true);
    T.eq(r.damage, 5, '3 + 3 Fracture - 1 Shield');
  });

  T.test("a unit defeated by its own side's collision scores for the opponent; an own Garrison scores nobody", function () {
    const s = setup([
      F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }),
      F.unit('a2', 'u04', 0, H(2, 0), { tl: 6, hp: 2 }),
      F.unit('b1', 'u06', 1, H(1, 0), { tl: 5, hp: 40 })
    ], null, { garrisons: [{ gid: 'g0', side: 0, hex: H(1, 1) }] });
    s.units.a1.abilities = [{ aid: 'p', timing: 'command', target: 'adjacentEnemy', effects: [{ k: 'push', n: 1 }] }];
    let t = Apply.apply(s, { type: 'command', uid: 'a1', aid: 'p', targetUid: 'b1' });
    const intoAlly = legal(t, 'displace').find(function (d) { return Hex.equals(d.to, H(2, 0)); });
    const ally = Apply.apply(t, intoAlly);
    T.notOk(ally.units.a2.alive, 'the ally fell');
    T.eq(ally.players[0].vp, s.players[0].vp, 'the pusher scores nothing');
    T.eq(ally.players[1].vp, s.players[1].vp + s.units.a2.vp, 'its opponent scores it');
    const intoGarrison = legal(t, 'displace').find(function (d) { return Hex.equals(d.to, H(1, 1)); });
    const gar = Apply.apply(t, intoGarrison);
    T.notOk(gar.garrisons.g0.alive);
    T.eq(gar.players[0].vp + gar.players[1].vp, s.players[0].vp + s.players[1].vp, 'nobody scores an own Garrison');
  });

  T.test('a push into a Base is a collision', function () {
    const s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(1, 0), { tl: 5, hp: 40 })],
      null, { bases: [{ bid: 'x', side: 1, hex: H(2, 0) }] });
    s.units.a1.abilities = [{ aid: 'p', timing: 'command', target: 'adjacentEnemy', effects: [{ k: 'push', n: 2 }] }];
    const t = Apply.apply(s, { type: 'command', uid: 'a1', aid: 'p', targetUid: 'b1' });
    const into = legal(t, 'displace').find(function (d) { return Hex.equals(d.to, H(2, 0)); });
    T.ok(into && into.collide, 'offered as a collision');
    const after = Apply.apply(t, into);
    T.eq(after.units.b1.hp, 38);
    T.ok(Hex.equals(after.units.b1.hex, H(1, 0)));
  });

  T.test('a ranged ability with a stated range needs line of sight', function () {
    const s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, energy: 2 }), F.unit('b1', 'u06', 1, H(2, 0), { tl: 5 })],
      null, { arena: { hexes: { '1,0': { elevation: 2 } } } });
    s.units.a1.energy = 2;
    s.units.a1.abilities = [
      { aid: 'r', timing: 'command', energy: 1, target: 'enemyInRange', range: 2, los: true, effects: [{ k: 'status', s: 'slow' }] },
      { aid: 'h', timing: 'command', energy: 1, target: 'enemyInRange', range: 2, effects: [{ k: 'status', s: 'slow' }] }
    ];
    const cmds = legal(s, 'command').map(function (a) { return a.aid; });
    T.ok(cmds.indexOf('h') !== -1, '"within 2 hexes" ignores the hill');
    T.eq(cmds.indexOf('r'), -1, '"Range 2" is blocked by it');
  });

  T.test('a reaction move collects a pickup it ends on', function () {
    const save = { cid: 'sv3', timing: 'response', window: 'wouldBeDefeated', role: 'defender', effects: [{ k: 'surviveDefeat', move: 2 }] };
    let s = setup([F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [SURE] }), F.unit('b1', 'u06', 1, H(2, 0), { tl: 5, hp: 3 })],
      [[], [save]], { pickups: [{ pid: 'e1', kind: 'energy', hex: H(3, 0) }] });
    s = Apply.apply(s, legal(s, 'attack')[0]);
    s = Apply.apply(s, { type: 'respond', side: 1, cid: 'sv3' });
    const e0 = s.units.b1.energy;
    s = Apply.apply(s, legal(s, 'react_move').find(function (m) { return Hex.equals(m.to, H(3, 0)); }));
    T.eq(s.units.b1.energy, e0 + 1);
    T.eq(s.pickups.length, 0);
  });

  T.test('decks grow by three for each Phase beyond two', function () {
    const g = State.createGame(Sk.skirmish({ seed: 'long', rules: { match: { phasesPerGame: 3 } } }));
    T.eq(g.players[0].tactics.hand.length + g.players[0].tactics.deck.length, 12);
  });
});
