/**
 * The second wave's mechanics: Remote Weapon Systems, Challenge, changing dice, extra targets, the two new area
 * patterns, Upgrades gained, moved, taken and destroyed, Timeline delays, drawing, out-of-turn attacks, and the
 * conditional bonuses. Units and cards here are invented for the test, except where a test names a built-in unit
 * (u07 to u15) to check that its data does what its card does.
 */

import * as T from './harness.js';
import * as F from './fixtures.js';

import * as Actions from '../../src/engine/actions.js';
import * as AI from '../../src/ai/ai.js';
import * as Apply from '../../src/engine/apply.js';
import * as Attack from '../../src/engine/attack.js';
import * as Combat from '../../src/engine/combat.js';
import * as Effects from '../../src/engine/effects.js';
import * as Hex from '../../src/engine/hex.js';
import * as Rng from '../../src/engine/rng.js';
import * as State from '../../src/engine/state.js';
import * as Squad from '../../src/ai/squad.js';
import * as Sk from '../../src/content/scenarios/skirmish.js';
import * as Text from '../../src/content/abilitytext.js';
import * as Units from '../../src/content/units.js';
import * as Tac from '../../src/content/tactics.js';

const H = Hex.hex;
const SURE = { wid: 'sure', tlCost: 2, range: 6, strength: 14, ignoreLos: true };

function lastAttack(s) {
  return s.log.filter(function (e) { return e.t === 'attack'; }).pop();
}

function legal(s, type) {
  return Actions.legalActions(s).filter(function (a) { return a.type === type; });
}

/** A unit spec with abilities and remotes, built on the fixture stat line. */
function unit(uid, side, hex, o) {
  const opts = o || {};
  return Object.assign(F.unit(uid, side === 0 ? 'u02' : 'u06', side, hex, opts), {
    abilities: opts.abilities || [], remotes: opts.remotes || [], energy: opts.energy || 0
  });
}

/** A game with given units and hands, the first unit (lowest TL) activating. */
function setup(units, hands, extra) {
  const g = F.game(Object.assign({ units: units }, extra || {}));
  const s = State.clone(g);
  if (hands) {
    for (let side = 0; side < 2; side++) s.players[side].tactics.hand = (hands[side] || []).map(function (c) { return JSON.parse(JSON.stringify(c)); });
  }
  return s;
}

/** Pass every open decision with the AI until nothing is pending. */
function settle(s) {
  let guard = 0;
  while (s.pending) {
    if (++guard > 50) T.fail('decisions did not settle');
    s = Apply.apply(s, AI.chooseAction(s));
  }
  return s;
}

const DRONE = { defId: 'drone', hp: 1, vp: 2, abilities: [{ aid: 'shield', timing: 'ongoing', effects: [{ k: 'auraReduceDamage', n: 1 }] }] };
const DEPLOY = { aid: 'dep', timing: 'command', target: 'emptyHex', range: 3, los: true, effects: [{ k: 'placeRemote', remote: 'drone' }] };

T.suite('remote weapon systems', function () {
  T.test('a unit deploys its RWS onto an empty hex within range, then repositions it', function () {
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, abilities: [DEPLOY], remotes: [DRONE] }), unit('b1', 1, H(5, 0), { tl: 5 })],
      null, { objectives: [{ oid: 'o1', hex: H(1, 0) }] });
    T.ok(s.remotes['a1.drone'] && s.remotes['a1.drone'].hex === null, 'it starts in the supply');
    const opts = legal(s, 'command').filter(function (a) { return a.aid === 'dep'; });
    T.ok(opts.length > 0 && opts.every(function (a) { return a.to && Hex.distance(a.to, H(0, 0)) <= 3; }), 'one option per hex in range');
    T.notOk(opts.some(function (a) { return Hex.equals(a.to, H(1, 0)); }), 'not onto an Objective: that hex is not empty');
    T.notOk(opts.some(function (a) { return Hex.equals(a.to, H(0, 0)); }), 'nor onto a unit');
    s = Apply.apply(s, opts.find(function (a) { return Hex.equals(a.to, H(0, 2)); }));
    T.deepEq(s.remotes['a1.drone'].hex, H(0, 2));
    T.ok(s.log.some(function (e) { return e.t === 'remote_deployed'; }));
    // next activation it can move it
    s.activation.commandsUsed = [];
    s = Apply.apply(s, legal(s, 'command').find(function (a) { return a.aid === 'dep' && Hex.equals(a.to, H(-2, 0)); }));
    T.deepEq(s.remotes['a1.drone'].hex, H(-2, 0));
  });

  T.test('an RWS blocks nothing, causes no Engagement, but no move may end on it', function () {
    const s = setup([unit('a1', 0, H(0, 0), { tl: 1 }), unit('b1', 1, H(4, 0), { tl: 5 })]);
    s.remotes = { 'b1.drone': { rid: 'b1.drone', defId: 'drone', owner: 'b1', side: 1, hex: H(1, 0), hp: 1, maxHp: 1, vp: 2, abilities: [] } };
    s.remoteOrder = ['b1.drone'];
    T.notOk(State.isEngaged(s, 0, H(0, 0)), 'no Engagement from an enemy RWS');
    const adv = legal(s, 'advance');
    T.notOk(adv.some(function (a) { return Hex.equals(a.to, H(1, 0)); }), 'cannot end on it');
    T.ok(adv.some(function (a) { return Hex.equals(a.to, H(2, 0)) && a.path.some(function (h) { return Hex.equals(h, H(1, 0)); }); }), 'but can pass through it');
    T.ok(Combat.targetsFor(s, 'a1', F.FIXTURE_WEAPONS[1]).some(function (t) { return t.kind === 'unit' && t.id === 'b1'; }), 'and it does not block Line of Sight');
  });

  T.test('an RWS can be attacked: destroyed, it scores its VP and returns to its supply', function () {
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, weapons: [SURE] }), unit('b1', 1, H(4, 0), { tl: 5, remotes: [DRONE] })]);
    s.remotes['b1.drone'].hex = H(2, 0);
    const shot = legal(s, 'attack').find(function (a) { return a.target.kind === 'remote'; });
    T.ok(shot, 'the RWS is a target');
    s = Apply.apply(s, shot);
    T.eq(s.remotes['b1.drone'].hex, null, 'back in the supply');
    T.eq(s.players[0].vp, 2, 'its 2 VP to the attacker');
  });

  T.test('an RWS returns to the supply when its unit is defeated, and nobody scores it', function () {
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, weapons: [SURE] }), unit('b1', 1, H(3, 0), { tl: 5, hp: 3, vp: 4, remotes: [DRONE] })]);
    s.remotes['b1.drone'].hex = H(5, 0);
    s = Apply.apply(s, legal(s, 'attack').find(function (a) { return a.target.kind === 'unit'; }));
    T.notOk(s.units.b1.alive);
    T.eq(s.remotes['b1.drone'].hex, null);
    T.eq(s.players[0].vp, 4, 'only the unit scored');
  });

  T.test('a unit pushed into an RWS collides with it, and the RWS is destroyed', function () {
    const shove = { aid: 'sh', timing: 'command', target: 'adjacentEnemy', effects: [{ k: 'push', n: 2 }] };
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, abilities: [shove] }), unit('b1', 1, H(1, 0), { tl: 5, hp: 40, remotes: [DRONE] })]);
    s.remotes['b1.drone'].hex = H(2, 0);
    s = Apply.apply(s, legal(s, 'command')[0]);
    const hit = legal(s, 'displace').find(function (d) { return Hex.equals(d.to, H(2, 0)); });
    T.ok(hit && hit.collide, 'stepping onto the RWS is a collision');
    s = Apply.apply(s, hit);
    T.eq(s.remotes['b1.drone'].hex, null, 'the RWS is destroyed');
    T.eq(s.units.b1.hp, 38, 'and the unit takes 2');
    T.deepEq(s.units.b1.hex, H(1, 0), 'and stays put');
  });

  T.test('a damage aura: allies next to the RWS take 1 less damage from attacks', function () {
    const make = function (near) {
      let s = setup([unit('a1', 0, H(0, 0), { tl: 1, weapons: [SURE] }), unit('b1', 1, H(3, 0), { tl: 5, hp: 400, remotes: [DRONE] })], null, { seed: 'aura' });
      if (near) s.remotes['b1.drone'].hex = H(4, 0);
      s = Apply.apply(s, legal(s, 'attack').find(function (a) { return a.target.kind === 'unit'; }));
      return lastAttack(s).damage;
    };
    T.eq(make(true), make(false) - 1);
  });

  T.test('an accuracy aura: allies attacking an enemy next to it are +1', function () {
    const s = setup([unit('a1', 0, H(0, 0), { tl: 1 }), unit('b1', 1, H(3, 0), { tl: 5 })]);
    const w = F.FIXTURE_WEAPONS[1];
    const before = Combat.accuracyShift(s, s.units.a1, w, s.units.b1.hex);
    s.remotes = { 'a1.spot': { rid: 'a1.spot', defId: 'spot', owner: 'a1', side: 0, hex: H(3, 1), hp: 1, maxHp: 1, vp: 2,
      abilities: [{ aid: 'x', timing: 'ongoing', effects: [{ k: 'auraAccuracy', n: 1 }] }] } };
    s.remoteOrder = ['a1.spot'];
    T.eq(Combat.accuracyShift(s, s.units.a1, w, s.units.b1.hex), before + 1);
  });

  T.test('an RWS that strikes when placed: one adjacent enemy is hit at once, two ask which', function () {
    const blades = { defId: 'blades', hp: 1, vp: 2, abilities: [{ aid: 'slash', timing: 'response', on: 'placed', target: 'adjacentEnemy', effects: [{ k: 'damage', n: 1 }] }] };
    const dep = { aid: 'dep', timing: 'command', target: 'emptyHex', range: 3, effects: [{ k: 'placeRemote', remote: 'blades' }] };
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, abilities: [dep], remotes: [blades] }), unit('b1', 1, H(2, 0), { tl: 5 }), unit('b2', 1, H(2, -2), { tl: 5 })]);
    const one = Apply.apply(s, legal(s, 'command').find(function (a) { return Hex.equals(a.to, H(3, 0)); }));
    T.notOk(one.pending, 'one target: no question');
    T.eq(one.units.b1.hp, s.units.b1.hp - 1);
    const two = Apply.apply(s, legal(s, 'command').find(function (a) { return Hex.equals(a.to, H(2, -1)); }));
    T.eq(two.pending && two.pending.kind, 'choose', 'two targets: the player picks');
    const picks = legal(two, 'choose');
    T.deepEq(picks.map(function (p) { return p.targetUid; }).sort(), ['b1', 'b2']);
    const done = Apply.apply(two, picks.find(function (p) { return p.targetUid === 'b2'; }));
    T.eq(done.units.b2.hp, s.units.b2.hp - 1);
    T.eq(done.units.b1.hp, s.units.b1.hp);
  });
});

T.suite('challenge', function () {
  const CH = { aid: 'ch', timing: 'response', window: 'beforeRoll', role: 'defender', effects: [{ k: 'challenge', range: 2 }] };

  T.test('a unit not under attack swaps with a defending ally within 2 and becomes the target', function () {
    let s = setup([
      unit('a1', 0, H(-3, 0), { tl: 1, weapons: [SURE] }),
      unit('b1', 1, H(1, 0), { tl: 5, hp: 400 }),
      unit('b2', 1, H(2, 0), { tl: 5, hp: 400, abilities: [CH] })
    ]);
    s = Apply.apply(s, legal(s, 'attack').find(function (a) { return a.target.id === 'b1'; }));
    T.ok(s.pending && s.pending.window === 'beforeRoll' && s.pending.side === 1, 'the defender may Challenge');
    const opt = Actions.legalActions(s).find(function (a) { return a.type === 'respond' && a.aid === 'ch'; });
    T.eq(opt.uid, 'b2');
    T.eq(opt.targetUid, 'b1');
    s = settle(Apply.apply(s, opt));
    T.deepEq(s.units.b2.hex, H(1, 0), 'swapped in');
    T.deepEq(s.units.b1.hex, H(2, 0), 'swapped out');
    T.eq(s.units.b1.hp, 400, 'the original target took nothing');
    T.ok(s.units.b2.hp < 400, 'the Challenger took the hit');
  });

  T.test('a Challenge card gives any allied unit the ability for one attack', function () {
    const card = { cid: 'ic', timing: 'response', window: 'beforeRoll', role: 'defender', effects: [{ k: 'challenge', range: 2 }] };
    let s = setup([
      unit('a1', 0, H(-3, 0), { tl: 1, weapons: [SURE] }),
      unit('b1', 1, H(1, 0), { tl: 5, hp: 400 }),
      unit('b2', 1, H(1, 1), { tl: 5, hp: 400 })
    ], [[], [card]]);
    s = Apply.apply(s, legal(s, 'attack').find(function (a) { return a.target.id === 'b1'; }));
    const opt = Actions.legalActions(s).find(function (a) { return a.type === 'respond' && a.cid === 'ic'; });
    T.ok(opt && opt.uid === 'b2' && opt.targetUid === 'b1');
  });
});

T.suite('changing the dice', function () {
  T.test('set a die to a critical: the lowest non-critical die becomes a 10', function () {
    const burst = { aid: 'pb', timing: 'response', window: 'afterRoll', role: 'attacker', who: 'any', range: 3, energy: 1, effects: [{ k: 'setCrit', n: 1 }] };
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, energy: 1, abilities: [burst], weapons: [{ wid: 'w', tlCost: 2, range: 3, strength: 4 }] }), unit('b1', 1, H(2, 0), { tl: 5, hp: 400 })]);
    s = Apply.apply(s, legal(s, 'attack')[0]);
    T.ok(s.pending && s.pending.window === 'afterRoll');
    const faces = Attack.current(s).faces.slice();
    s = Apply.apply(s, { type: 'respond', side: 0, uid: 'a1', aid: 'pb' });
    T.eq(s.units.a1.energy, 0, 'it paid its Energy');
    const e = s.log.filter(function (x) { return x.t === 'reroll' && x.setCrit; }).pop();
    T.ok(e, 'a die was set');
    T.deepEq(e.before, faces);
    const low = Math.min.apply(null, faces.filter(function (f) { return f < 9; }));
    T.eq(e.after[e.dice[0]], 10);
    T.eq(e.before[e.dice[0]], low, 'the lowest die that was not a critical');
    s = settle(s);
    T.ok(lastAttack(s).crits >= 1, 'the attack has a critical');
  });

  T.test('another ally within range can reroll up to 3 misses', function () {
    const insp = { aid: 'ip', timing: 'response', window: 'afterRoll', role: 'attacker', who: 'other', range: 2, effects: [{ k: 'rerollMisses', n: 3 }] };
    let s = setup([
      unit('a1', 0, H(0, 0), { tl: 1, weapons: [{ wid: 'w', tlCost: 2, range: 4, strength: 12, accuracy: -5 }] }),
      unit('a2', 0, H(-1, 0), { tl: 5, abilities: [insp] }),
      unit('b1', 1, H(3, 0), { tl: 5, hp: 400 })
    ], null, { seed: 'reroll' });
    s = Apply.apply(s, legal(s, 'attack')[0]);
    const opt = Actions.legalActions(s).find(function (a) { return a.aid === 'ip'; });
    T.ok(opt && opt.uid === 'a2', 'the ally offers it');
    s = Apply.apply(s, opt);
    const e = s.log.filter(function (x) { return x.t === 'reroll'; }).pop();
    T.ok(e && e.dice.length === 3, 'three misses rerolled');
    T.notOk(Actions.legalActions(s).some(function (a) { return a.aid === 'ip'; }), 'once per trigger');
  });

  T.test('reroll every miss, and draw a card when three or more were rerolled', function () {
    const card = { cid: 'tr', timing: 'response', window: 'afterRoll', role: 'attacker', effects: [{ k: 'rerollMisses', drawIf: 3, draw: 1 }] };
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, weapons: [{ wid: 'w', tlCost: 2, range: 4, strength: 12, accuracy: -5 }] }), unit('b1', 1, H(3, 0), { tl: 5, hp: 400 })],
      [[card]], { seed: 'reroll' });
    s.players[0].tactics.deck = [{ cid: 'spare', timing: 'command', effects: [{ k: 'energy', n: 1 }] }];
    s = Apply.apply(s, legal(s, 'attack')[0]);
    s = Apply.apply(s, { type: 'respond', side: 0, cid: 'tr' });
    T.ok(s.players[0].tactics.hand.some(function (c) { return c.cid === 'spare'; }), 'drew a card');
  });

  T.test('a critical can roll extra dice', function () {
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, weapons: [{ wid: 'w', tlCost: 2, range: 3, strength: 20, crit: { dice: 2 } }] }), unit('b1', 1, H(2, 0), { tl: 5, hp: 400 })]);
    s = Apply.apply(s, legal(s, 'attack')[0]);
    T.eq(lastAttack(s).critRolls.length, 2);
  });
});

T.suite('extra targets and the new area patterns', function () {
  T.test('"also targets each enemy adjacent to the target"', function () {
    const w = { wid: 'w', tlCost: 4, range: 4, strength: 14, alsoAdjacent: true };
    const s = setup([unit('a1', 0, H(0, 0), { tl: 1, weapons: [w] }), unit('b1', 1, H(3, 0), { tl: 5, hp: 400 }),
      unit('b2', 1, H(4, 0), { tl: 5, hp: 400 }), unit('b3', 1, H(6, -2), { tl: 5, hp: 400 })]);
    const shot = legal(s, 'attack').find(function (a) { return a.target.id === 'b1'; });
    T.deepEq(shot.targets.map(function (r) { return r.id; }), ['b1', 'b2'], 'the target and its neighbour');
    const after = Apply.apply(s, shot);
    T.eq(lastAttack(after).results.length, 2, 'one roll, two targets');
  });

  T.test('the T pattern: the hex in front and the three beyond it', function () {
    const d = Units.def('u14');
    T.deepEq(d.weapons[0].area.map(function (o) { return Hex.distance({ q: 0, r: 0 }, { q: o[0], r: o[1] }); }).sort(), [1, 2, 2, 2]);
    // every distance-2 hex touches the distance-1 hex
    const front = d.weapons[0].area[0];
    T.ok(d.weapons[0].area.slice(1).every(function (o) { return Hex.distance({ q: front[0], r: front[1] }, { q: o[0], r: o[1] }) === 1; }));
  });

  T.test('the flower: a hex and its six neighbours, two of them touching the attacker', function () {
    const area = Units.def('u15').weapons[1].area;
    T.eq(area.length, 7);
    const centre = { q: 2, r: -1 };
    T.ok(area.every(function (o) { return Hex.distance(centre, { q: o[0], r: o[1] }) <= 1; }), 'all within one of the centre');
    T.eq(area.filter(function (o) { return Hex.distance({ q: 0, r: 0 }, { q: o[0], r: o[1] }) === 1; }).length, 2);
  });
});

T.suite('upgrades: gained, moved, taken and destroyed', function () {
  T.test('gain an Upgrade of your choice', function () {
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1 }), unit('b1', 1, H(4, 0), { tl: 5 })],
      [[{ cid: 'osi', timing: 'command', target: 'self', effects: [{ k: 'upgradeChoice', n: 1 }] }]]);
    s = Apply.apply(s, legal(s, 'tactics')[0]);
    const opts = legal(s, 'choose');
    T.deepEq(opts.map(function (o) { return o.aid; }).sort(), ['accuracy', 'shield', 'speed', 'strength']);
    s = Apply.apply(s, opts.find(function (o) { return o.aid === 'speed'; }));
    T.deepEq(s.units.a1.upgrades, ['speed']);
    T.notOk(s.pending);
  });

  T.test('up to three units each gain a different Upgrade', function () {
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, traits: ['tf'] }), unit('a2', 0, H(-1, 0), { tl: 5, traits: ['tf'] }),
      unit('a3', 0, H(-2, 0), { tl: 5 }), unit('b1', 1, H(4, 0), { tl: 5 })],
    [[{ cid: 'sop', timing: 'command', target: 'self', effects: [{ k: 'upgradeSpread', n: 3, trait: 'tf' }] }]]);
    s = Apply.apply(s, legal(s, 'tactics')[0]);
    T.notOk(legal(s, 'choose').some(function (o) { return o.targetUid === 'a3'; }), 'only units with the trait');
    s = Apply.apply(s, legal(s, 'choose').find(function (o) { return o.targetUid === 'a1' && o.aid === 'shield'; }));
    T.notOk(legal(s, 'choose').some(function (o) { return o.aid === 'shield' || o.targetUid === 'a1'; }), 'a different Upgrade, a different unit');
    s = Apply.apply(s, legal(s, 'choose').find(function (o) { return o.targetUid === 'a2' && o.aid === 'speed'; }));
    T.notOk(s.pending, 'no third unit qualifies, so it ends');
    T.deepEq([s.units.a1.upgrades, s.units.a2.upgrades], [['shield'], ['speed']]);
  });

  T.test('redistribute Upgrades between two allies, one at a time, until the player stops', function () {
    const md = { aid: 'mt', timing: 'command', target: 'allyInRange', range: 3, effects: [{ k: 'transfer' }] };
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, abilities: [md], upgrades: ['shield', 'speed'] }), unit('a2', 0, H(-1, 0), { tl: 5 }), unit('b1', 1, H(4, 0), { tl: 5 })]);
    s = Apply.apply(s, legal(s, 'command')[0]);
    s = Apply.apply(s, legal(s, 'choose').find(function (o) { return o.targetUid === 'a2' && o.aid === 'shield'; }));
    T.ok(legal(s, 'choose').some(function (o) { return o.targetUid === 'a1' && o.aid === 'shield'; }), 'it can move back too');
    s = Apply.apply(s, { type: 'pass', side: 0 });
    T.deepEq([s.units.a1.upgrades, s.units.a2.upgrades], [['speed'], ['shield']]);
  });

  T.test('take Energy and an Upgrade from a unit in range', function () {
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1 }), unit('b1', 1, H(2, 0), { tl: 5, energy: 2, upgrades: ['strength'] })],
      [[{ cid: 'sa', timing: 'command', target: 'unitInRange', range: 3, los: true, effects: [{ k: 'steal', energy: 1, upgrades: 1 }] }]]);
    s = Apply.apply(s, legal(s, 'tactics')[0]);
    s = Apply.apply(s, legal(s, 'choose')[0]);
    T.eq(s.units.a1.energy, 1);
    T.eq(s.units.b1.energy, 1);
    T.deepEq(s.units.a1.upgrades, ['strength']);
    T.deepEq(s.units.b1.upgrades, []);
  });

  T.test('destroy all Upgrades, or up to two of the player\'s choosing', function () {
    const all = { cid: 'dm', timing: 'command', target: 'enemyInRange', range: 3, effects: [{ k: 'destroyUpgrades', n: 'all' }] };
    const two = { cid: 'bs', timing: 'command', target: 'enemyInRange', range: 3, effects: [{ k: 'destroyUpgrades', n: 2 }] };
    const base = [unit('a1', 0, H(0, 0), { tl: 1 }), unit('b1', 1, H(2, 0), { tl: 5, upgrades: ['shield', 'shield', 'speed'] })];
    const a = Apply.apply(setup(base, [[all]]), { type: 'tactics', uid: 'a1', cid: 'dm', targetUid: 'b1' });
    T.deepEq(a.units.b1.upgrades, []);
    let b = Apply.apply(setup(base, [[two]]), { type: 'tactics', uid: 'a1', cid: 'bs', targetUid: 'b1' });
    b = Apply.apply(b, legal(b, 'choose').find(function (o) { return o.aid === 'speed'; }));
    b = Apply.apply(b, legal(b, 'choose').find(function (o) { return o.aid === 'shield'; }));
    T.notOk(b.pending, 'two destroyed, done');
    T.deepEq(b.units.b1.upgrades, ['shield']);
  });

  T.test('Hover while holding a Speed Upgrade', function () {
    const jet = { aid: 'jt', timing: 'ongoing', when: { hasUpgrade: 'speed' }, effects: [{ k: 'hover' }] };
    const s = setup([unit('a1', 0, H(0, 0), { tl: 1, abilities: [jet] }), unit('b1', 1, H(5, 0), { tl: 5 })]);
    T.notOk(State.hasHover(s.units.a1, s));
    s.units.a1.upgrades.push('speed');
    T.ok(State.hasHover(s.units.a1, s));
  });

  T.test('a critical can grant an Upgrade after combat damage, and count Upgrades as damage', function () {
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, upgrades: ['speed', 'shield'], weapons: [{ wid: 'w', tlCost: 2, range: 3, strength: 30, crit: { damagePerUpgrade: 'any', max: 4, upgrade: 'strength', afterDamage: true } }] }),
      unit('b1', 1, H(2, 0), { tl: 5, hp: 400 })]);
    s = Apply.apply(s, legal(s, 'attack')[0]);
    const e = lastAttack(s);
    T.eq(e.damage, e.hits + 2, '+1 per Upgrade held when the crit resolved');
    T.deepEq(s.units.a1.upgrades, ['speed', 'shield', 'strength']);
  });
});

T.suite('timeline, cards and conditions', function () {
  T.test('targets move up the Timeline after the attack', function () {
    const ss = { aid: 'st', timing: 'response', window: 'afterDamage', role: 'attacker', who: 'self', energy: 1, attackWhen: { unitTargets: true }, effects: [{ k: 'delayTargets', n: 1 }] };
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, energy: 1, abilities: [ss], weapons: [SURE] }), unit('b1', 1, H(2, 0), { tl: 5, hp: 400 })]);
    const before = Apply.tokenAt(s, 'b1').round;
    s = Apply.apply(s, legal(s, 'attack')[0]);
    s = Apply.apply(s, { type: 'respond', side: 0, uid: 'a1', aid: 'st' });
    T.eq(Apply.tokenAt(s, 'b1').round, before + 1);
  });

  T.test('draw a card when the attack damaged two or more enemies', function () {
    const cc = { aid: 'cc', timing: 'response', window: 'afterDamage', role: 'attacker', who: 'self', attackWhen: { damagedEnemies: 2 }, effects: [{ k: 'draw', n: 1 }] };
    const w = { wid: 'w', tlCost: 4, range: 4, strength: 14, alsoAdjacent: true };
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, abilities: [cc], weapons: [w] }), unit('b1', 1, H(3, 0), { tl: 5, hp: 400 }), unit('b2', 1, H(4, 0), { tl: 5, hp: 400 })]);
    s.players[0].tactics.deck = [{ cid: 'spare', timing: 'command', effects: [{ k: 'energy', n: 1 }] }];
    s = Apply.apply(s, legal(s, 'attack').find(function (a) { return a.target.id === 'b1'; }));
    T.ok(Actions.legalActions(s).some(function (a) { return a.aid === 'cc'; }));
    s = Apply.apply(s, { type: 'respond', side: 0, uid: 'a1', aid: 'cc' });
    T.eq(s.players[0].tactics.hand.length, 1);
  });

  T.test('+1 accuracy and +1 strength while the unit has not moved this activation', function () {
    const fl = { aid: 'fl', timing: 'ongoing', when: { notMoved: true }, effects: [{ k: 'accuracy', n: 1 }, { k: 'strength', n: 1 }] };
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, abilities: [fl] }), unit('b1', 1, H(5, 0), { tl: 5 })]);
    const w = F.FIXTURE_WEAPONS[1];
    T.eq(Combat.strengthOf(s, s.units.a1, w), 7);
    s = Apply.apply(s, legal(s, 'advance')[0]);
    T.eq(Combat.strengthOf(s, s.units.a1, w), 6, 'gone once it moves');
  });

  T.test('a defender worth less VP than the attacker can cut the damage by 4', function () {
    const gg = { cid: 'gg', timing: 'response', window: 'afterRoll', role: 'defender', pick: 'one', pickWhen: 'lessVp', effects: [{ k: 'reduceDamage', n: 4 }] };
    const go = function (vp) {
      let s = setup([unit('a1', 0, H(0, 0), { tl: 1, vp: 6, weapons: [SURE] }), unit('b1', 1, H(2, 0), { tl: 5, vp: vp, hp: 400 })], [[], [gg]], { seed: 'gg' });
      s = Apply.apply(s, legal(s, 'attack')[0]);
      return Actions.legalActions(s).some(function (a) { return a.cid === 'gg'; });
    };
    T.ok(go(3), 'offered when cheaper');
    T.notOk(go(9), 'not when worth more');
  });

  T.test('after this unit ends its movement it damages each enemy it moved next to', function () {
    const bs = { aid: 'bs', timing: 'response', on: 'moved', energy: 1, effects: [{ k: 'damageMovedAdjacent', n: 1 }] };
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, energy: 1, abilities: [bs] }), unit('b1', 1, H(2, -2), { tl: 5 }), unit('b2', 1, H(5, 0), { tl: 5 })]);
    s = Apply.apply(s, legal(s, 'advance').find(function (a) { return Hex.equals(a.to, H(3, 0)); }));
    T.eq(s.pending && s.pending.kind, 'trigger', 'it costs Energy, so it asks');
    s = Apply.apply(s, Actions.legalActions(s).find(function (a) { return a.type === 'trigger'; }));
    T.eq(s.units.b2.hp, F.FIXTURE_UNITS.u06.hp, 'the enemy it never came near is untouched');
    const passed = s.log.filter(function (e) { return e.t === 'advance'; }).pop().path;
    const near = passed.slice(1).some(function (h) { return Hex.distance(h, H(2, -2)) === 1; });
    T.eq(s.units.b1.hp, F.FIXTURE_UNITS.u06.hp - (near ? 1 : 0), 'an enemy beside its path is hit');
    T.eq(s.units.a1.energy, 0);
  });

  T.test('move at once, then rescue each allied Garrison moved next to', function () {
    const cr = { cid: 'cr', timing: 'command', target: 'self', effects: [{ k: 'moveNow', n: 5 }, { k: 'rescueMovedAdjacent' }] };
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1 }), unit('b1', 1, H(-5, 5), { tl: 5 })], [[cr]],
      { garrisons: [{ gid: 'g1', side: 0, hex: H(2, -1) }, { gid: 'g2', side: 0, hex: H(4, -1) }] });
    s = Apply.apply(s, legal(s, 'tactics')[0]);
    T.eq(s.pending && s.pending.kind, 'react_move');
    s = Apply.apply(s, legal(s, 'react_move').find(function (a) { return Hex.equals(a.to, H(5, -1)); }));
    T.notOk(s.pending);
    T.eq(s.players[0].vp, 4, 'both Garrisons rescued');
    T.eq(s.players[0].rescued, 2);
  });

  T.test('a +4 strength card needs three enemy Garrisons destroyed, and lasts one attack', function () {
    const se = { cid: 'se', timing: 'command', target: 'self', when: { garrisonsDestroyed: 3 }, effects: [{ k: 'nextAttackStrength', n: 4 }] };
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, weapons: [{ wid: 'w', tlCost: 2, range: 3, strength: 3 }] }), unit('b1', 1, H(2, 0), { tl: 5, hp: 400 })], [[se]]);
    T.notOk(legal(s, 'tactics').length, 'not yet');
    s.players[0].garrisonsDestroyed = 3;
    s = Apply.apply(s, legal(s, 'tactics')[0]);
    s = Apply.apply(s, legal(s, 'attack')[0]);
    T.eq(lastAttack(s).dice, 7);
  });

  T.test("a unit that shuts out enemy responses: the defender's cards are not offered", function () {
    const nd = { aid: 'nd', timing: 'ongoing', effects: [{ k: 'noEnemyResponses' }] };
    const block = { cid: 'qb', timing: 'response', window: 'afterRoll', role: 'defender', effects: [{ k: 'reduceDamage', n: 3 }] };
    const go = function (abilities) {
      let s = setup([unit('a1', 0, H(0, 0), { tl: 1, abilities: abilities, weapons: [SURE] }), unit('b1', 1, H(2, 0), { tl: 5, hp: 400 })], [[], [block]]);
      s = Apply.apply(s, legal(s, 'attack')[0]);
      return Boolean(s.pending);
    };
    T.ok(go([]), 'offered normally');
    T.notOk(go([nd]), 'shut out');
  });

  T.test('a critical status marked after combat damage does not count against the same attack', function () {
    const w = { wid: 'w', tlCost: 2, range: 3, strength: 30, crit: { status: 'fracture', afterDamage: true } };
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, weapons: [w] }), unit('b1', 1, H(2, 0), { tl: 5, hp: 400 })]);
    s = Apply.apply(s, legal(s, 'attack')[0]);
    const e = lastAttack(s);
    T.eq(e.damage, e.hits, 'no Fracture bonus on this attack');
    T.ok(s.units.b1.statuses.indexOf('fracture') !== -1, 'but the target is Fractured now');
  });

  T.test('a weapon effect moves the attacker one hex toward its target after the roll', function () {
    const w = { wid: 'w', tlCost: 2, range: 3, strength: 4, effects: [{ when: 'afterRoll', k: 'approach', n: 1 }] };
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, weapons: [w] }), unit('b1', 1, H(3, 0), { tl: 5, hp: 400 })]);
    s = Apply.apply(s, legal(s, 'attack')[0]);
    T.eq(s.pending && s.pending.kind, 'react_move');
    const steps = legal(s, 'react_move');
    T.ok(steps.length && steps.every(function (m) { return Hex.distance(m.to, H(3, 0)) === 2; }), 'each step is closer');
    s = settle(Apply.apply(s, steps[0]));
    T.eq(Hex.distance(s.units.a1.hex, H(3, 0)), 2);
    T.ok(lastAttack(s), 'and the attack resolves');
  });
});

T.suite('out-of-turn attacks', function () {
  T.test('after an enemy ends its movement within 3, a card makes an attack for 1 Timeline', function () {
    const ps = { cid: 'ps', timing: 'response', window: 'enemyMoved', role: 'defender', requires: { defId: 'u06' }, effects: [{ k: 'reactAttack', wid: 'light', tl: 1, range: 3 }] };
    let s = setup([unit('a1', 0, H(-5, 0), { tl: 1 }), unit('b1', 1, H(0, 0), { tl: 5, weapons: [{ wid: 'light', tlCost: 2, range: 3, strength: 14 }] })], [[], [ps]]);
    const before = Apply.tokenAt(s, 'b1').round;
    s = Apply.apply(s, legal(s, 'advance').find(function (a) { return Hex.equals(a.to, H(-2, 0)); }));
    T.ok(s.pending && s.pending.window === 'enemyMoved' && s.pending.side === 1, 'the enemy may answer');
    s = Apply.apply(s, Actions.legalActions(s).find(function (a) { return a.type === 'respond'; }));
    s = settle(s);
    const e = lastAttack(s);
    T.ok(e && e.uid === 'b1' && e.target.id === 'a1', 'it shot the mover');
    T.eq(Apply.tokenAt(s, 'b1').round, before + 1, 'for 1 Timeline');
    T.eq(s.activation.uid, 'a1', 'and the mover\'s activation carries on');
  });

  T.test('a surviving defender strikes back at its weapon\'s cost less one', function () {
    const ca = { cid: 'ca', timing: 'response', window: 'afterDamage', role: 'defender', pick: 'one', pickWhen: 'counter', effects: [{ k: 'counterAttack', tl: -1 }] };
    let s = setup([unit('a1', 0, H(0, 0), { tl: 1, weapons: [{ wid: 'w', tlCost: 2, range: 3, strength: 2 }] }),
      unit('b1', 1, H(2, 0), { tl: 5, hp: 400, weapons: [{ wid: 'big', tlCost: 4, range: 3, strength: 6 }] })], [[], [ca]]);
    s = Apply.apply(s, legal(s, 'attack')[0]);
    T.ok(s.pending && s.pending.window === 'afterDamage' && s.pending.side === 1, 'offered after damage');
    const before = Apply.tokenAt(s, 'b1').round;
    s = Apply.apply(s, { type: 'respond', side: 1, cid: 'ca', targetUid: 'b1' });
    T.eq(s.pending && s.pending.kind, 'react_attack');
    s = Apply.apply(s, legal(s, 'react_attack')[0]);
    s = settle(s);
    T.ok(s.log.some(function (e) { return e.t === 'attack' && e.uid === 'b1'; }), 'it struck back');
    T.eq(Apply.tokenAt(s, 'b1').round, before + 3, '4 less 1');
  });
});

T.suite('squads and the second wave in play', function () {
  T.test('a squad is any three from the pool, a unit once unless Mass Produced', function () {
    T.ok(Units.isLegalSquad(['u07', 'u10', 'u15']));
    T.notOk(Units.isLegalSquad(['u07', 'u07', 'u15']));
    T.ok(Units.isLegalSquad(['u08', 'u08', 'u08']), 'the Mass Produced walker may repeat');
    T.notOk(Units.isLegalSquad(['u07', 'u10']), 'three, not two');
    T.ok(Units.canAdd(['u08'], 'u08'));
    T.notOk(Units.canAdd(['u01'], 'u01'));
    T.eq(Squad.legalSquads(Units.pool()).length, 470, 'C(15,3) plus the walker twice with each other unit, plus three walkers');
  });

  T.test('a scenario takes squads directly', function () {
    const s = State.createGame(Sk.skirmish({ seed: 'sq', playerSquad: ['u10', 'u11', 'u12'], enemySquad: ['u08', 'u08', 'u13'] }));
    T.deepEq(['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map(function (u) { return s.units[u].defId; }), ['u10', 'u11', 'u12', 'u08', 'u08', 'u13']);
    T.eq(Object.keys(s.remotes).length, 3, 'the three RWS start in their supplies');
  });

  T.test('pickSquad: random is legal and seeded; hard and easy follow the table', function () {
    const pool = Units.pool();
    const a = Squad.pickSquad(pool, ['u01', 'u02', 'u03'], 'random', Rng.seedFrom('x'));
    T.ok(Units.isLegalSquad(a.squad));
    T.deepEq(Squad.pickSquad(pool, ['u01', 'u02', 'u03'], 'random', Rng.seedFrom('x')).squad, a.squad, 'same seed, same squad');
    // a table where u15 beats everything and u08 loses to everything
    const vs = {};
    for (const x of pool) {
      vs[x] = {};
      for (const y of pool) vs[x][y] = { games: 100, wins: x === 'u15' ? 90 : x === 'u08' ? 10 : 50 };
    }
    const table = { vs: vs };
    for (let i = 0; i < 5; i++) {
      const hard = Squad.pickSquad(pool, ['u01', 'u02', 'u03'], 'hard', Rng.seedFrom('h' + i), table).squad;
      const easy = Squad.pickSquad(pool, ['u01', 'u02', 'u03'], 'easy', Rng.seedFrom('e' + i), table).squad;
      T.ok(hard.indexOf('u15') !== -1 && hard.indexOf('u08') === -1, 'hard counter-picks: ' + hard);
      T.ok(easy.indexOf('u08') !== -1 && easy.indexOf('u15') === -1, 'easy picks what the player beats: ' + easy);
      T.ok(Units.isLegalSquad(hard) && Units.isLegalSquad(easy));
    }
  });

  T.test('every new ability and card renders to a sentence', function () {
    for (const id of Units.ROSTER) {
      for (const r of Units.def(id).remotes || []) for (const a of r.abilities) T.ok(/\.$/.test(Text.abilityText(a)), a.aid);
    }
    for (const cid of Tac.POOL) {
      const t = Text.abilityText(Tac.card(cid));
      T.ok(t.length > 5 && /^[A-Z0-9+-]/.test(t) && /\.$/.test(t) && t.indexOf('undefined') === -1 && t.indexOf('  ') === -1, cid + ': ' + t);
      T.ok(Text.tacticsName(cid) !== cid, cid + ' has a name');
    }
  });

  T.test('a whole AI game on the second wave finishes, and apply never mutates its input', function () {
    let s = State.createGame(Sk.skirmish({ seed: 'wave-ai', playerSquad: ['u10', 'u11', 'u12'], enemySquad: ['u13', 'u14', 'u15'] }));
    let guard = 0;
    let checked = 0;
    while (!s.over) {
      if (++guard > 4000) T.fail('the game did not finish');
      const a = AI.chooseAction(s);
      if (guard % 25 === 0) {
        const snap = T.snapshot(s);
        const next = Apply.apply(s, a);
        T.eq(T.snapshot(s), snap, 'apply left its input alone');
        checked++;
        s = next;
      } else {
        s = Apply.apply(s, a);
      }
    }
    T.ok(checked > 3);
    T.ok(s.log.some(function (e) { return e.t === 'remote_deployed'; }), 'remote weapons were used');
    T.notOk(s.log.some(function (e) { return e.t === 'no_primary'; }), 'no forced passes');
  });

  T.test('a whole AI game with the first wave against the second finishes', function () {
    const out = AI.playOut(State.createGame(Sk.skirmish({ seed: 'wave-ai-2', playerSquad: ['u07', 'u08', 'u09'], enemySquad: ['u01', 'u05', 'u06'] })));
    T.ok(out.state.over);
  });
});

T.suite('effect kinds can all be described', function () {
  T.test('every response effect the attack resolves has a phrase', function () {
    for (const k of Attack.RESPONSE_EFFECTS) {
      const sample = { k: k, n: 1, wid: 'u01a', tl: -1, range: 3, s: 'slow' };
      T.ok(Text.effectPhrase(sample, 'response').length > 0, k);
    }
  });

  T.test('every target kind a command can use has a phrase', function () {
    for (const t of ['allyInRange', 'unitInRange', 'enemyNearOwnRemote', 'allyGarrisonInRange', 'emptyHex']) {
      T.ok(Text.targetPhrase({ target: t, range: 2 }).length > 0, t);
    }
  });

  T.test('the effect lists are kept in step', function () {
    T.ok(Effects.EFFECT_KINDS.indexOf('placeRemote') !== -1);
  });
});
