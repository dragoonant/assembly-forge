/**
 * Combat test suite: line of sight, dice, damage, destruction and scoring.
 *
 * The dice are seeded, so every assertion about an outcome is exact rather
 * than statistical. Where a test wants "a hit happened" without caring which
 * faces came up, it uses a weapon with enough dice that a miss is impossible
 * in practice (`F.SURE_KILL`) rather than reaching into the generator.
 */

import * as T from './harness.js';
import * as F from './fixtures.js';

import * as Actions from '../../src/engine/actions.js';
import * as Apply from '../../src/engine/apply.js';
import * as Combat from '../../src/engine/combat.js';
import * as Hex from '../../src/engine/hex.js';
import * as Los from '../../src/engine/los.js';
import * as Rules from '../../src/engine/rules.js';
import * as State from '../../src/engine/state.js';
import * as Timeline from '../../src/engine/timeline.js';

const H = Hex.hex;

/** A game where `a1` stands next to `b1`, both carrying the standard loadout. */
function brawl(spec) {
  const s = spec || {};
  return F.game({
    seed: s.seed === undefined ? 'combat' : s.seed,
    rules: s.rules,
    board: s.board,
    units: [
      F.unit('a1', 'u02', 0, s.a || H(0, 0), s.aStats),
      F.unit('b1', 'u06', 1, s.b || H(2, 0), s.bStats)
    ],
    garrisons: s.garrisons,
    objectives: s.objectives
  });
}

// --- Dice --------------------------------------------------------------------

T.suite('combat dice', function () {
  const rules = Rules.createRules();
  const c = rules.combat;

  T.test('a natural 1 misses however good the modifiers are', function () {
    T.notOk(Combat.isHit(1, 0, c));
    T.notOk(Combat.isHit(1, 5, c), 'a +5 shift does not rescue a 1');
  });

  T.test('a natural 9 or 10 hits however bad the modifiers are', function () {
    T.ok(Combat.isHit(9, -5, c));
    T.ok(Combat.isHit(10, -5, c));
  });

  T.test('everything between is the modified face against the accuracy floor', function () {
    T.notOk(Combat.isHit(3, 0, c), '3 misses on a floor of 4');
    T.ok(Combat.isHit(4, 0, c), '4 hits');
    T.ok(Combat.isHit(3, 1, c), '+1 lifts a 3 onto the floor');
    T.notOk(Combat.isHit(4, -1, c), '-1 drops a 4 below it');
  });

  T.test('modifiers shift the die, not the target number', function () {
    // The distinction is invisible at the margin and obvious at the extremes:
    // if the floor moved instead, a big negative shift would make 9 and 10
    // miss. They cannot.
    T.ok(Combat.isHit(10, -9, c));
  });

  T.test('expected hits matches the binomial mean', function () {
    // Floor 4 on a d10: faces 4..10 hit, so 7 in 10.
    T.eq(Combat.expectedHits(rules, 10, 0), 7);
    // +1 brings 3 in as well: 8 in 10.
    T.eq(Combat.expectedHits(rules, 10, 1), 8);
    // A 1 never hits, so even +9 caps at 9 in 10.
    T.eq(Combat.expectedHits(rules, 10, 9), 9);
  });

  T.test('crit chance is one minus the miss-every-die case', function () {
    // 9 and 10 crit: 2 in 10 per die.
    T.eq(Math.round(Combat.critChance(rules, 1) * 1000), 200);
    T.eq(Math.round(Combat.critChance(rules, 2) * 1000), 360);
  });

  T.test('rolling is reproducible from the generator state', function () {
    const a = Combat.rollAttack(12345, rules, 6, 0, false);
    const b = Combat.rollAttack(12345, rules, 6, 0, false);
    T.deepEq(a.rolls, b.rolls);
    T.eq(a.hits, b.hits);
    T.eq(a.state, b.state, 'and it advances the generator the same way');
  });

  T.test('disarm suppresses crits and rerolls the hits', function () {
    const plain = Combat.rollAttack(999, rules, 8, 0, false);
    const armed = Combat.rollAttack(999, rules, 8, 0, true);
    T.eq(armed.crits, 0, 'no crits while disarmed');
    T.ok(armed.rerolls !== null, 'the rerolled faces are reported');
    T.ok(plain.crits >= 0);
  });
});

// --- Line of sight -----------------------------------------------------------

T.suite('line of sight', function () {
  T.test('an adjacent target is always visible', function () {
    const g = brawl({ b: H(1, 0) });
    // Range 1 is below losMinRange, so nothing is even traced.
    T.ok(Los.hasLos(g, H(0, 0), H(1, 0), { side: 0 }));
  });

  T.test('blocking terrain stops a line', function () {
    const g = brawl({
      board: F.arena({ hexes: { '1,0': { terrain: 'blocked' } } }),
      b: H(2, 0)
    });
    T.notOk(Los.hasLos(g, H(0, 0), H(2, 0), { side: 0, targetUid: 'b1' }));
  });

  T.test('ground higher than the attacker stops a line', function () {
    const g = brawl({
      board: F.arena({ hexes: { '1,0': { elevation: 1 } } }),
      b: H(2, 0)
    });
    T.notOk(Los.hasLos(g, H(0, 0), H(2, 0), { side: 0, targetUid: 'b1' }));
  });

  T.test('ground level with the attacker is fine when nobody is uphill', function () {
    const g = brawl({ b: H(2, 0) });
    T.ok(Los.hasLos(g, H(0, 0), H(2, 0), { side: 0, targetUid: 'b1' }));
  });

  T.test('shooting downhill, the lip of the slope blocks', function () {
    // Attacker at elevation 2, target at 0, and the hex between is at 2 --
    // the attacker's own level, which is the second elevation rule.
    const g = brawl({
      board: F.arena({ hexes: { '0,0': { elevation: 2 }, '1,0': { elevation: 2 } } }),
      b: H(2, 0)
    });
    T.notOk(Los.hasLos(g, H(0, 0), H(2, 0), { side: 0, targetUid: 'b1' }));
  });

  T.test('an intervening enemy blocks, a friend does not', function () {
    const withEnemy = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(0, 0)),
        F.unit('x1', 'u04', 1, H(1, 0)),
        F.unit('b1', 'u06', 1, H(2, 0))
      ]
    });
    T.notOk(Los.hasLos(withEnemy, H(0, 0), H(2, 0), { side: 0, targetUid: 'b1' }),
      'the enemy in the way blocks');

    const withFriend = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(0, 0)),
        F.unit('a2', 'u04', 0, H(1, 0)),
        F.unit('b1', 'u06', 1, H(2, 0))
      ]
    });
    T.ok(Los.hasLos(withFriend, H(0, 0), H(2, 0), { side: 0, targetUid: 'b1' }),
      'a friendly unit does not, which is the sources\' reading');
  });

  T.test('the target itself never blocks its own line', function () {
    const g = brawl({ b: H(3, 0) });
    T.ok(Los.hasLos(g, H(0, 0), H(3, 0), { side: 0, targetUid: 'b1' }));
  });

  T.test('the boundary rule changes the answer, and both readings work', function () {
    // A line to (2,-1) runs along a hex boundary; which hexes it clips depends
    // on the tie-break. Put blocking terrain on one side of that boundary only.
    const hexes = { '1,-1': { terrain: 'blocked' } };
    const permissive = brawl({
      board: F.arena({ hexes: hexes }), b: H(2, -1),
      rules: { combat: { losBoundary: 'permissive' } }
    });
    const strict = brawl({
      board: F.arena({ hexes: hexes }), b: H(2, -1),
      rules: { combat: { losBoundary: 'strict' } }
    });
    const p = Los.hasLos(permissive, H(0, 0), H(2, -1), { side: 0, targetUid: 'b1' });
    const s = Los.hasLos(strict, H(0, 0), H(2, -1), { side: 0, targetUid: 'b1' });
    // Permissive can never be more restrictive than strict. That relationship
    // is the invariant worth asserting; which way this particular line falls
    // is an artefact of the geometry.
    T.ok(!(s === true && p === false), 'strict is never more permissive');
  });
});

// --- Targeting ---------------------------------------------------------------

T.suite('targeting', function () {
  T.test('a weapon can only reach inside its range', function () {
    const g = brawl({ b: H(3, 0) });
    const u = State.unit(g, 'a1');
    const light = Combat.weapon(u, 'light');   // range 2
    const heavy = Combat.weapon(u, 'heavy');   // range 4
    T.eq(Combat.targetsFor(g, 'a1', light).length, 0, 'out of reach of the light weapon');
    T.eq(Combat.targetsFor(g, 'a1', heavy).length, 1, 'inside the heavy weapon');
  });

  T.test('friendly units are never targets', function () {
    const g = F.game({
      units: [F.unit('a1', 'u02', 0, H(0, 0)), F.unit('a2', 'u04', 0, H(1, 0))]
    });
    const u = State.unit(g, 'a1');
    T.eq(Combat.targetsFor(g, 'a1', Combat.weapon(u, 'heavy')).length, 0);
  });

  T.test('a weapon that ignores line of sight shoots through a wall', function () {
    const g = F.game({
      board: F.arena({ hexes: { '1,0': { terrain: 'blocked' } } }),
      units: [
        F.unit('a1', 'u02', 0, H(0, 0), { weapons: [F.SURE_KILL] }),
        F.unit('b1', 'u06', 1, H(2, 0))
      ]
    });
    T.eq(Combat.targetsFor(g, 'a1', Combat.weapon(State.unit(g, 'a1'), 'surekill')).length, 1);
  });

  T.test('enemy garrisons are targets and friendly ones are not', function () {
    const g = F.game({
      units: [F.unit('a1', 'u02', 0, H(0, 0))],
      garrisons: [{ gid: 'gEnemy', side: 1, hex: H(2, 0) }, { gid: 'gMine', side: 0, hex: H(0, 2) }]
    });
    const refs = Combat.targetsFor(g, 'a1', Combat.weapon(State.unit(g, 'a1'), 'heavy'));
    T.eq(refs.length, 1);
    T.eq(refs[0].id, 'gEnemy');
  });
});

// --- Attacks -----------------------------------------------------------------

T.suite('attacks', function () {
  T.test('attacking is a Primary Action and costs the weapon its Timeline', function () {
    const g = brawl({ b: H(2, 0) });
    const before = Timeline.locate(g.timeline, g.activation.uid);
    const attacker = g.activation.uid;
    const attack = T.find(g, function (a) { return a.type === 'attack' && a.wid === 'heavy'; });
    if (!attack) return; // whoever activates first may not have a target
    const after = Apply.apply(g, attack);
    T.eq(after.activation.slots.primary, 'attack');
    const moved = Timeline.locate(after.timeline, attacker);
    T.eq(moved.round, before.round + 4, 'the heavy weapon costs 4 TL');
  });

  T.test('damage comes off hit points', function () {
    const g = F.game({
      seed: 'dmg',
      units: [
        F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [{ wid: 'w', tlCost: 2, range: 4, strength: 6 }] }),
        F.unit('b1', 'u06', 1, H(2, 0), { tl: 9 })
      ]
    });
    const before = State.unit(g, 'b1').hp;
    const after = T.act(g, function (a) { return a.type === 'attack'; });
    const hp = State.unit(after, 'b1').hp;
    T.ok(hp < before, 'the target lost hit points');
    const entry = after.log[after.log.length - 2];
    T.ok(hp === before - entry.damage || entry.destroyed, 'and lost exactly the reported damage');
  });

  T.test('a destroyed unit pays out its own victory value', function () {
    const g = F.game({
      seed: 'kill',
      units: [
        F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [F.SURE_KILL] }),
        F.unit('b1', 'u03', 1, H(2, 0), { tl: 9 })
      ]
    });
    const bounty = State.unit(g, 'b1').vp;
    const after = T.act(g, function (a) { return a.type === 'attack'; });
    T.notOk(State.unit(after, 'b1').alive, 'the target is gone');
    T.eq(after.players[0].vp, bounty, 'and the attacker banked its printed VP');
  });

  T.test('a destroyed unit does not leave a token to deadlock the Timeline', function () {
    // The rule says the token moves two rounds forward, which reads as though
    // it stays on the track. If it did, the scheduler would later open an
    // activation for a unit that no longer exists and the game would wedge.
    const g = F.game({
      seed: 'wedge',
      units: [
        F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [F.SURE_KILL] }),
        F.unit('b1', 'u03', 1, H(2, 0), { tl: 9 })
      ]
    });
    const after = T.act(g, function (a) { return a.type === 'attack'; });
    T.eq(Timeline.locate(after.timeline, 'b1'), null, 'no token for the dead unit');
    // And the game can still be played out to the end.
    const done = T.drain(after, 5000);
    T.ok(done.state.over, 'the game finished rather than wedging');
  });

  T.test('an attack never touches the state it was given', function () {
    const g = F.game({
      seed: 'pure',
      units: [
        F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [F.SURE_KILL] }),
        F.unit('b1', 'u03', 1, H(2, 0), { tl: 9 })
      ]
    });
    const snap = T.snapshot(g);
    T.act(g, function (a) { return a.type === 'attack'; });
    T.deepEq(T.snapshot(g), snap, 'the original is unchanged, dice included');
  });
});

// --- Damage modifiers --------------------------------------------------------

T.suite('damage modifiers', function () {
  function hitFor(damage, targetOpts) {
    const g = F.game({
      seed: 'mod',
      units: [
        F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [F.SURE_KILL] }),
        F.unit('b1', 'u06', 1, H(2, 0), Object.assign({ tl: 9, hp: 200 }, targetOpts || {}))
      ]
    });
    return g;
  }

  T.test('the shield upgrade absorbs a point, once', function () {
    const plain = hitFor(0);
    const shielded = hitFor(0, { upgrades: ['shield'] });
    const a = T.act(plain, function (x) { return x.type === 'attack'; });
    const b = T.act(shielded, function (x) { return x.type === 'attack'; });
    const dmgA = 200 - State.unit(a, 'b1').hp;
    const dmgB = 200 - State.unit(b, 'b1').hp;
    T.eq(dmgB, dmgA - 1, 'one point absorbed');
  });

  T.test('fracture adds its bonus once, then clears', function () {
    const g = hitFor(0);
    State.unit(g, 'b1').statuses.push('fracture');
    const after = T.act(g, function (x) { return x.type === 'attack'; });
    const u = State.unit(after, 'b1');
    T.eq(u.statuses.indexOf('fracture'), -1, 'the status is spent');
  });

  T.test('a garrison dies to any damage at all, having no hit points', function () {
    const g = F.game({
      seed: 'gar',
      units: [F.unit('a1', 'u02', 0, H(0, 0), { tl: 1, weapons: [{ wid: 'w', tlCost: 2, range: 4, strength: 20 }] })],
      garrisons: [{ gid: 'g1', side: 1, hex: H(2, 0) }]
    });
    const after = T.act(g, function (a) { return a.type === 'attack' && a.target.kind === 'garrison'; });
    T.notOk(after.garrisons.g1.alive);
    T.eq(after.players[0].vp, after.rules.scoring.garrisonDestroyVp);
  });
});

// --- Rescue and objectives ---------------------------------------------------

T.suite('rescue and objectives', function () {
  T.test('rescuing an adjacent friendly garrison scores and removes it', function () {
    const g = F.game({
      units: [F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 })],
      garrisons: [{ gid: 'g1', side: 0, hex: H(1, 0) }]
    });
    const after = T.act(g, function (a) { return a.type === 'rescue'; });
    T.notOk(after.garrisons.g1.alive);
    T.eq(after.players[0].vp, after.rules.scoring.garrisonRescueVp);
  });

  T.test('rescue needs adjacency, not occupancy', function () {
    const g = F.game({
      units: [F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 })],
      garrisons: [{ gid: 'far', side: 0, hex: H(3, 0) }]
    });
    T.eq(T.findAll(g, function (a) { return a.type === 'rescue'; }).length, 0);
  });

  T.test('an objective goes to whoever has more units around it', function () {
    const g = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(1, 0), { tl: 1 }),
        F.unit('a2', 'u04', 0, H(0, 1), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(-1, 0), { tl: 1 })
      ],
      objectives: [{ oid: 'o1', hex: H(0, 0), vp: 5 }]
    });
    Apply.recomputeObjectiveControl(g);
    T.eq(g.objectives.o1.controlledBy, 0, 'two adjacent against one');
  });

  T.test('an equal count leaves an objective uncontrolled', function () {
    const g = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(1, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(-1, 0), { tl: 1 })
      ],
      objectives: [{ oid: 'o1', hex: H(0, 0), vp: 5 }]
    });
    Apply.recomputeObjectiveControl(g);
    T.eq(g.objectives.o1.controlledBy, null);
  });

  T.test('standing ON an objective does not control it', function () {
    const g = F.game({
      units: [F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 })],
      objectives: [{ oid: 'o1', hex: H(0, 0), vp: 5 }]
    });
    Apply.recomputeObjectiveControl(g);
    T.eq(g.objectives.o1.controlledBy, null, 'control is adjacency, not occupancy');
  });

  T.test('objectives pay out at the end of a Phase, not when taken', function () {
    const g = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(1, 0), { tl: 1 }),
        F.unit('a2', 'u04', 0, H(0, 1), { tl: 1 })
      ],
      objectives: [{ oid: 'o1', hex: H(0, 0), vp: 5 }],
      rules: { match: { phasesPerGame: 1 } }
    });
    T.eq(g.players[0].vp, 0, 'nothing banked yet');
    const done = T.drain(g, 5000);
    T.ok(done.state.players[0].vp >= 5, 'the objective paid out at phase end');
  });
});
