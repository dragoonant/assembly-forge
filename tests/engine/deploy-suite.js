/**
 * Deployment from Reserve and Bases (rulebook 2026-10-30, "Deploying your Units" and "Defeated
 * Units"). Every unit starts off the board, deploys onto its side's Base on its first activation,
 * must move off the Base, and returns to Reserve when defeated.
 */

import * as T from './harness.js';
import * as F from './fixtures.js';

import * as Actions from '../../src/engine/actions.js';
import * as Apply from '../../src/engine/apply.js';
import * as Combat from '../../src/engine/combat.js';
import * as Hex from '../../src/engine/hex.js';
import * as State from '../../src/engine/state.js';
import * as Timeline from '../../src/engine/timeline.js';

const H = Hex.hex;
const BASES = [
  { bid: 'base0', side: 0, hex: H(-4, 0) },
  { bid: 'base1', side: 1, hex: H(4, 0) }
];

function types(state) {
  return Actions.legalActions(state).map(function (a) { return a.type; });
}

function reserveGame(extra) {
  const e = extra || {};
  return F.game({
    units: e.units || [
      F.unit('a1', 'u02', 0, null),
      F.unit('b1', 'u06', 1, null)
    ],
    bases: e.bases || BASES,
    arena: e.arena,
    rules: e.rules
  });
}

T.suite('deployment', function () {
  T.test('a unit given no hex starts in Reserve: off the board, token on the track', function () {
    const s = reserveGame();
    const a = s.units.a1;
    T.notOk(a.alive, 'not on the battlefield');
    T.ok(a.inReserve, 'in Reserve');
    T.eq(a.hex, null);
    T.ok(Apply.tokenAt(s, 'a1') !== null, 'token is on the Timeline');
    T.eq(State.unitAt(s, BASES[0].hex), null, 'nothing stands on the Base yet');
  });

  T.test('its first activation offers only deploying onto its own Base', function () {
    const s = reserveGame();
    T.eq(s.activation.uid, 'a1');
    const legal = Actions.legalActions(s);
    T.eq(legal.length, 1);
    T.eq(legal[0].type, 'deploy');
    T.ok(Hex.equals(legal[0].to, BASES[0].hex), 'onto side 0 Base');
  });

  T.test('a deployed unit must move off the Base before anything else', function () {
    let s = reserveGame();
    s = Apply.apply(s, { type: 'deploy', uid: 'a1', to: BASES[0].hex });
    T.ok(s.units.a1.alive, 'on the battlefield');
    T.notOk(s.units.a1.inReserve);
    T.ok(Hex.equals(s.units.a1.hex, BASES[0].hex), 'standing on the Base');
    const kinds = types(s);
    T.ok(kinds.length > 0);
    for (let i = 0; i < kinds.length; i++) {
      T.ok(kinds[i] === 'advance' || kinds[i] === 'dash', 'only movement while on the Base, got ' + kinds[i]);
    }
    const step = Actions.legalActions(s).filter(function (a) { return a.type === 'advance'; })[0];
    s = Apply.apply(s, step);
    const after = types(s);
    T.ok(after.indexOf('energize') !== -1, 'a full turn opens up once off the Base');
    T.ok(after.indexOf('advance') === -1, 'and the Advance is spent');
  });

  T.test('no move may end on a Base, and an enemy Base cannot be moved through', function () {
    // a1 stands next to its own Base and just behind the enemy Base on a narrow strip
    const s = F.game({
      units: [F.unit('a1', 'u02', 0, H(3, 0)), F.unit('b1', 'u06', 1, H(-5, 0))],
      bases: BASES
    });
    const to = Actions.legalActions(s).filter(function (a) { return a.type === 'advance'; });
    for (let i = 0; i < to.length; i++) {
      T.notOk(State.baseAt(s, to[i].to), 'never ends on a Base');
      for (let j = 0; j < to[i].path.length; j++) {
        T.notOk(Hex.equals(to[i].path[j], BASES[1].hex), 'never paths through the enemy Base');
      }
    }
    // the allied Base may be passed through
    const own = F.game({
      units: [F.unit('a1', 'u02', 0, H(-3, 0)), F.unit('b1', 'u06', 1, H(5, -3))],
      bases: BASES
    });
    T.ok(Actions.canPassThrough(own, own.units.a1, BASES[0].hex), 'allied Base is passable');
    T.notOk(Actions.canEndOn(own, own.units.a1, BASES[0].hex), 'but not a place to stop');
  });

  T.test('defeat sends a unit to Reserve, repaired, keeping Energy and Upgrades', function () {
    let s = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(0, 0), { weapons: [F.SURE_KILL] }),
        F.unit('b1', 'u06', 1, H(2, 0), { upgrades: ['speed'] })
      ],
      bases: BASES
    });
    s.units.b1.energy = 2;
    s.units.b1.statuses = ['slow'];
    s.units.b1.hp = 5;
    const before = Apply.tokenAt(s, 'b1').round;
    s = Apply.apply(s, { type: 'attack', uid: 'a1', wid: 'surekill', target: { kind: 'unit', id: 'b1' } });
    const b = s.units.b1;
    T.notOk(b.alive);
    T.ok(b.inReserve, 'back in Reserve');
    T.eq(b.hex, null);
    T.eq(b.hp, b.maxHp, 'hit points reset');
    T.eq(b.statuses.length, 0, 'statuses cleared');
    T.eq(b.energy, 2, 'Energy kept');
    T.deepEq(b.upgrades, ['speed'], 'Upgrades kept');
    T.eq(Apply.tokenAt(s, 'b1').round, before + 2, 'token pushed two rounds');
    T.eq(s.players[0].vp, F.FIXTURE_UNITS.u06.vp, 'the killer scores its VP');
  });

  T.test('a defeated unit redeploys from its Base on its next activation', function () {
    let s = F.game({
      units: [
        F.unit('a1', 'u02', 0, H(0, 0), { weapons: [F.SURE_KILL] }),
        F.unit('b1', 'u06', 1, H(2, 0))
      ],
      bases: BASES
    });
    s = Apply.apply(s, { type: 'attack', uid: 'a1', wid: 'surekill', target: { kind: 'unit', id: 'b1' } });
    s = Apply.apply(s, { type: 'end_activation', uid: 'a1' });
    let guard = 0;
    while (s.activation && s.activation.uid !== 'b1' && guard++ < 50) {
      s = Apply.apply(s, Actions.legalActions(s).filter(function (a) { return a.type === 'energize'; })[0] ||
        Actions.legalActions(s)[0]);
      if (s.activation && s.activation.slots.primary) s = Apply.apply(s, { type: 'end_activation', uid: s.activation.uid });
    }
    T.eq(s.activation.uid, 'b1', 'b1 comes up again');
    T.deepEq(types(s), ['deploy'], 'and its only choice is to redeploy');
  });

  T.test('with no way off its Base a unit Energizes and stays in Reserve', function () {
    // Wall the Base in with impassable terrain on every side.
    const hexes = {};
    const around = Hex.neighbours(BASES[0].hex);
    for (let i = 0; i < around.length; i++) hexes[Hex.key(around[i])] = { terrain: 'blocked' };
    let s = reserveGame({ arena: { hexes: hexes } });
    T.deepEq(types(s), ['energize']);
    s = Apply.apply(s, { type: 'energize', uid: 'a1' });
    T.ok(s.units.a1.inReserve, 'still in Reserve');
    T.eq(s.units.a1.energy, 1);
    T.deepEq(types(s), ['end_activation']);
  });

  T.test('a unit defeated during its own activation ends it at once, with no extra Timeline', function () {
    let s = F.game({
      units: [F.unit('a1', 'u02', 0, H(0, 0)), F.unit('b1', 'u06', 1, H(3, 0))],
      bases: BASES
    });
    s = State.clone(s);
    const before = Apply.tokenAt(s, 'a1').round;
    Combat.destroyUnit(s, s.units.a1, 1);
    T.deepEq(types(s), ['end_activation']);
    s = Apply.apply(s, { type: 'end_activation', uid: 'a1' });
    T.eq(Timeline.locate(s.timeline, 'a1').round, before + 2, 'only the defeat penalty, no forced pass on top');
  });
});
