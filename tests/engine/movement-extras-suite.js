/**
 * Map pickups, stacking Upgrades, Hover, and Push / Pull with collisions (rulebook 2026-10-30).
 */

import * as T from './harness.js';
import * as F from './fixtures.js';

import * as Actions from '../../src/engine/actions.js';
import * as Apply from '../../src/engine/apply.js';
import * as Combat from '../../src/engine/combat.js';
import * as Displace from '../../src/engine/displace.js';
import * as Hex from '../../src/engine/hex.js';
import * as State from '../../src/engine/state.js';

const H = Hex.hex;

T.suite('map pickups', function () {
  T.test('ending a move on an Upgrade collects it; passing through does not', function () {
    const pickups = [
      { pid: 'p1', kind: 'upgrade', upgrade: 'speed', hex: H(-2, 0) },
      { pid: 'p2', kind: 'energy', hex: H(-1, 0) }
    ];
    const g = F.game({ units: [F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 })], pickups: pickups });
    const past = Apply.apply(g, T.find(g, { type: 'advance', to: H(0, 0) }));
    T.eq(past.pickups.length, 2, 'walked past both, collected neither');
    const onto = Apply.apply(g, T.find(g, { type: 'advance', to: H(-2, 0) }));
    T.deepEq(onto.units.a1.upgrades, ['speed']);
    T.eq(onto.pickups.length, 1);
    const energy = Apply.apply(g, T.find(g, { type: 'advance', to: H(-1, 0) }));
    T.eq(energy.units.a1.energy, 1);
  });

  T.test('deploying onto a pickup collects it', function () {
    const g = F.game({
      units: [F.unit('a1', 'u02', 0, null)],
      bases: [{ bid: 'b0', side: 0, hex: H(-4, 0) }, { bid: 'b1', side: 1, hex: H(4, 0) }],
      pickups: [{ pid: 'p1', kind: 'energy', hex: H(-4, 0) }]
    });
    const s = Apply.apply(g, { type: 'deploy', uid: 'a1', to: H(-4, 0) });
    T.eq(s.units.a1.energy, 1);
  });

  T.test('Upgrades stack: two Speed add two hexes, two Shields stop two points', function () {
    const g = F.game({ units: [F.unit('a1', 'u02', 0, H(-5, 0), { tl: 1, upgrades: ['speed', 'speed'] })] });
    T.ok(T.find(g, { type: 'advance', to: H(0, 0) }), 'five hexes');
    const s = State.clone(F.game({
      units: [F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(3, 0), { upgrades: ['shield', 'shield'] })]
    }));
    const hp = s.units.b1.hp;
    const r = Combat.dealDamage(s, { kind: 'unit', id: 'b1' }, 3, 0, true);
    T.eq(r.absorbed, 2);
    T.eq(s.units.b1.hp, hp - 1);
  });
});

T.suite('hover', function () {
  T.test('a hovering unit ignores terrain and climb costs and crosses impassable hexes', function () {
    const hexes = { '-2,0': { elevation: 2 }, '-1,0': { terrain: 'blocked' } };
    const g = F.game({
      arena: { hexes: hexes },
      units: [F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1, traits: ['hover'] })]
    });
    const across = T.find(g, { type: 'advance', to: H(0, 0) });
    T.ok(across, 'up the cliff and over the wreck');
    T.eq(across.cost, 3);
    T.notOk(T.find(g, { type: 'advance', to: H(-1, 0) }), 'but never ending on impassable');
    const walker = F.game({ arena: { hexes: hexes }, units: [F.unit('a1', 'u02', 0, H(-3, 0), { tl: 1 })] });
    T.notOk(T.find(walker, { type: 'advance', to: H(0, 0) }), 'without Hover the route is closed');
  });
});

/** Push or Pull, always taking the lowest-keyed hex (collision or not), as the old deterministic rule did. */
function displaceAuto(s, source, uid, n, mode) {
  if (!Displace.begin(s, source, uid, n, mode, null, null)) return false;
  while (s.pending && s.pending.kind === 'displace') {
    const o = Displace.stepOptions(s, s.pending)[0];
    Displace.decide(s, { type: 'displace', side: s.pending.side, uid: uid, to: o.to, collide: o.collide }, Combat);
  }
  return true;
}

T.suite('push and pull', function () {
  function setup(extra) {
    return State.clone(F.game(Object.assign({
      units: [F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(1, 0), { tl: 5, hp: 20 })]
    }, extra || {})));
  }

  T.test('push moves the target away, hex by hex', function () {
    const s = setup();
    displaceAuto(s, s.units.a1, 'b1', 2, 'push');
    T.eq(Hex.distance(s.units.a1.hex, s.units.b1.hex), 3);
  });

  T.test('a push into higher ground is a collision for 2 damage', function () {
    const s = setup({ arena: { hexes: { '2,0': { elevation: 1 }, '2,-1': { elevation: 1 }, '1,1': { elevation: 1 } } } });
    const hp = s.units.b1.hp;
    displaceAuto(s, s.units.a1, 'b1', 2, 'push');
    T.ok(Hex.equals(s.units.b1.hex, H(1, 0)), 'it stays put');
    T.eq(s.units.b1.hp, hp - 2);
  });

  T.test('a push into another unit hurts both', function () {
    const s = State.clone(F.game({
      units: [
        F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }),
        F.unit('b1', 'u06', 1, H(1, 0), { tl: 5, hp: 20 }),
        F.unit('b2', 'u04', 1, H(2, -1), { tl: 5, hp: 20 }),
        F.unit('b3', 'u04', 1, H(2, 0), { tl: 5, hp: 20 }),
        F.unit('b4', 'u04', 1, H(1, 1), { tl: 5, hp: 20 })
      ]
    }));
    displaceAuto(s, s.units.a1, 'b1', 1, 'push');
    T.eq(s.units.b1.hp, 18, 'the pushed unit');
    const hurt = ['b2', 'b3', 'b4'].filter(function (id) { return s.units[id].hp === 18; });
    T.eq(hurt.length, 1, 'and exactly the one it hit');
  });

  T.test('pull brings a target closer, but not one already adjacent on the same level', function () {
    const s = State.clone(F.game({
      units: [F.unit('a1', 'u02', 0, H(0, 0), { tl: 1 }), F.unit('b1', 'u06', 1, H(3, 0), { tl: 5 })]
    }));
    displaceAuto(s, s.units.a1, 'b1', 1, 'pull');
    T.eq(Hex.distance(s.units.a1.hex, s.units.b1.hex), 2);
    const adj = setup();
    T.notOk(displaceAuto(adj, adj.units.a1, 'b1', 1, 'pull'));
  });

  T.test('push and pull ignore terrain and Engagement, and only the pushed unit moves', function () {
    const s = setup({ arena: { hexes: { '2,0': { terrain: 'water' }, '3,0': { terrain: 'water' } } } });
    displaceAuto(s, s.units.a1, 'b1', 2, 'push');
    T.eq(Hex.distance(s.units.a1.hex, s.units.b1.hex), 3);
    T.ok(Hex.equals(s.units.a1.hex, H(0, 0)));
    T.ok(Actions.legalActions(s).length > 0);
  });
});
