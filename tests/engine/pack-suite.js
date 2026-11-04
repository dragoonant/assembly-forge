/**
 * Content packs: a pack swaps the roster, names and teams; switching back restores our cast exactly. Uses an invented
 * test pack, so nothing here depends on the git-ignored local pack.
 */

import * as T from './harness.js';

import * as AI from '../../src/ai/ai.js';
import * as Names from '../../src/content/names.js';
import * as Packs from '../../src/content/packs.js';
import * as Teams from '../../src/content/teams.js';
import * as Units from '../../src/content/units.js';
import * as State from '../../src/engine/state.js';
import { skirmish } from '../../src/content/scenarios/skirmish.js';

function testPack() {
  const unit = function (id, hp, vp, tl, standIn) {
    return {
      defId: id, hp: hp, vp: vp, tl: tl, traits: ['assault'], standIn: standIn,
      weapons: [
        { wid: id + 'a', tlCost: 2, range: 2, strength: 3, crit: { damage: 1 } },
        { wid: id + 'b', tlCost: 3, range: 3, strength: 5, crit: { status: 'slow' } }
      ],
      abilities: [{ aid: id + 'c', timing: 'command', energy: 1, target: 'self', effects: [{ k: 'accuracy', n: 1 }] }]
    };
  };
  const ids = ['p1', 'p2', 'p3', 'p4'];
  const units = {};
  const names = {};
  ids.forEach(function (id, i) {
    units[id] = unit(id, 12 + i, 5 + i, 1 + (i % 3), 'u0' + (i + 1));
    names[id] = 'Test Unit ' + (i + 1);
    names[id + 'a'] = 'Test light ' + (i + 1);
    names[id + 'b'] = 'Test heavy ' + (i + 1);
    names[id + 'c'] = 'Test focus ' + (i + 1);
  });
  return {
    id: 'test-pack', label: 'Test pack', units: units, names: names,
    teams: { tp_a: { units: ['p1', 'p2', 'p3'] }, tp_b: { units: ['p2', 'p3', 'p4'] } },
    teamOrder: ['tp_a', 'tp_b'],
    teamNames: { tp_a: 'Test squad A', tp_b: 'Test squad B' }
  };
}

T.suite('content packs', function () {
  Packs.registerPack(testPack());

  T.test('the built-in cast is active until a pack is chosen', function () {
    Packs.activate(null);
    T.deepEq(Teams.teamOrder(), Teams.TEAM_ORDER.slice());
    T.eq(Names.displayName('u01'), Names.UNITS.u01);
  });

  T.test('a pack swaps the roster, names, teams and stand-ins', function () {
    Packs.activate('test-pack');
    try {
      T.deepEq(Teams.teamOrder(), ['tp_a', 'tp_b']);
      T.eq(Names.displayName('p1'), 'Test Unit 1');
      T.eq(Names.teamName('tp_b'), 'Test squad B');
      T.eq(Units.def('p2').hp, 13);
      T.eq(Units.standInFor('p3'), 'u03');
      const s = State.createGame(skirmish({ seed: 'pack', playerTeam: 'tp_a', enemyTeam: 'tp_b' }));
      const defs = Object.keys(s.units).map(function (k) { return s.units[k].defId; }).sort();
      T.deepEq(defs, ['p1', 'p2', 'p2', 'p3', 'p3', 'p4']);
    } finally {
      Packs.activate(null);
    }
  });

  T.test('a whole AI game plays on a pack roster', function () {
    Packs.activate('test-pack');
    try {
      const out = AI.playOut(State.createGame(skirmish({ seed: 'pack-ai', playerTeam: 'tp_a', enemyTeam: 'tp_b' })));
      T.ok(out.state.over, 'the game finished');
    } finally {
      Packs.activate(null);
    }
  });

  T.test('switching back restores our cast exactly', function () {
    Packs.activate('test-pack');
    Packs.activate('ours');
    T.eq(Names.displayName('p1'), 'p1', 'pack names are gone');
    T.eq(Units.def('u05').defId, 'u05');
    T.throws(function () { Units.def('p1'); });
  });

  T.test('a malformed pack is rejected loudly', function () {
    T.throws(function () { Packs.registerPack({ id: 'bad', units: {}, teams: { x: { units: ['nope'] } }, teamOrder: ['x'], names: {} }); });
    T.throws(function () { Packs.registerPack({ id: 'ours', units: {}, teams: {}, teamOrder: [], names: {} }); });
    const p = testPack();
    p.id = 'dupes';
    p.teams.tp_a.units = ['p1', 'p1', 'p2'];
    T.throws(function () { Packs.registerPack(p); }, 'a repeated unit that is not mass-produced');
    p.units.p1.traits = ['assault', 'mass-produced'];
    Packs.registerPack(p);
  });
});
