/**
 * The roster: six machines, six archetypes.
 *
 * Stat lines only. Every name a player reads -- of a unit or of a weapon --
 * lives in `src/content/names.js` and is looked up by the id used here, so
 * this file can be read and edited as pure balance without touching a single
 * piece of display text.
 *
 * Weapon ids are positional (`a` is the cheap one, `b` the heavy one) rather
 * than descriptive, for the same reason.
 *
 * THE SHAPE EVERY UNIT SHARES, from section 5 of the rules reconstruction:
 * one cheap short-ranged weapon at 2 Timeline and strength 2-4, and one
 * expensive heavy weapon at 3-4 Timeline and strength 5-8. Cost and strength
 * track each other closely, and a higher VP marks the more dangerous machine
 * -- the bounty is a self-balancing handicap, so a glass cannon that wins the
 * fight still hands the loser points.
 *
 * Observed ranges the published set stays inside, used here as guardrails:
 * hp 9-18, vp 5-10, starting Timeline 1-3, weapon range 1-5. Values here were
 * re-tuned by self-play after the rules reconciliation of 2026-11-03.
 *
 * u07 to u15 carry the published numbers of the units they stand for, unchanged; see WAVE_TWO below.
 */

/**
 * @typedef {Object} UnitDef
 * @property {string} defId
 * @property {number} hp
 * @property {number} vp
 * @property {number} tl        starting Timeline round
 * @property {string[]} traits
 * @property {Array<Object>} weapons
 */

/**
 * Crit effects are DATA, never prose. The interface generates the English from
 * these at display time, so no published wording can ever be pasted into a
 * definition -- there is nowhere to put it.
 *
 *   {damage: n}        n extra damage on a critical
 *   {status: 'id'}     apply a status to the target
 *   {dice: n}          roll n more dice, resolved before damage
 */

import { activePack } from './packs.js';

/*
 * The second wave, u07 to u15: nine machines built on the same numbers and mechanics as the nine units that joined the
 * published roster in November 2026, with this project's own names (names.js) and roles. Several bring Remote Weapon
 * Systems: small board pieces of their own (HP 1, VP 2) that the unit deploys and repositions with a Command ability.
 *
 * Area patterns, as [q, r] offsets aimed east (DIRECTIONS[0]) and rotated to all six:
 *   AREA_T      -- the hex in front, then the three hexes beyond it that touch it: four hexes in a T.
 *   AREA_FLOWER -- a hex and its six neighbours, its centre two hexes out between two directions, so two petals
 *                  touch the attacker.
 */
export const AREA_T = Object.freeze([[1, 0], [2, 0], [2, -1], [1, 1]]);
export const AREA_FLOWER = Object.freeze([[1, 0], [1, -1], [2, -1], [2, 0], [3, -1], [3, -2], [2, -2]]);

/** "This unit can Challenge": swap with a defending ally within 2 hexes and become the defender. */
function challenge(aid) {
  return { aid: aid, timing: 'response', window: 'beforeRoll', role: 'defender', effects: [{ k: 'challenge', range: 2 }] };
}

/** Deploy or reposition this unit's Remote Weapon System on an empty hex within range. */
function deployRemote(aid, remote, range) {
  return { aid: aid, timing: 'command', target: 'emptyHex', range: range, los: true, effects: [{ k: 'placeRemote', remote: remote }] };
}

const WAVE_TWO = {
  // An ace that grows with every Upgrade it carries and shuts out the enemy's responses while it fights.
  u07: {
    defId: 'u07', hp: 14, vp: 10, tl: 3, traits: ['assault', 'task-force', 'regular'],
    weapons: [
      { wid: 'u07a', tlCost: 2, range: 1, strength: 4, crit: { upgrade: 'strength', afterDamage: true } },
      { wid: 'u07b', tlCost: 4, range: 4, strength: 8, crit: { damagePerUpgrade: 'any', max: 4 } }
    ],
    abilities: [
      { aid: 'u07c', timing: 'response', window: 'beforeRoll', role: 'attacker', who: 'other', range: 3, energy: 1,
        attackWhen: { ownUpgrade: 'strength' }, effects: [{ k: 'attackStrength', n: 1, per: 'ownUpgrade', kind: 'strength' }] },
      { aid: 'u07o', timing: 'ongoing', effects: [{ k: 'noEnemyResponses' }] }
    ]
  },
  // The cheapest machine on the board and the only one a squad may field more than once: it rescues from range and
  // moves Upgrades to where they are needed.
  u08: {
    defId: 'u08', hp: 8, vp: 5, tl: 1, traits: ['support', 'mass-produced', 'regular'],
    weapons: [
      { wid: 'u08a', tlCost: 2, range: 1, strength: 3, crit: { damagePerUpgrade: 'shield', max: 4 } }
    ],
    abilities: [
      { aid: 'u08c', timing: 'command', energy: 1, target: 'allyGarrisonInRange', range: 3, los: true, effects: [{ k: 'rescue' }] },
      { aid: 'u08r', timing: 'response', on: 'rescue', effects: [{ k: 'upgrade', s: 'shield' }] },
      { aid: 'u08d', timing: 'command', target: 'allyInRange', range: 3, los: true, effects: [{ k: 'transfer' }] }
    ]
  },
  // Fast, and faster with every Thruster core: it Hovers while it holds one and cuts at everything it passes.
  u09: {
    defId: 'u09', hp: 11, vp: 7, tl: 2, traits: ['high-maneuver', 'task-force', 'regular'],
    weapons: [
      { wid: 'u09a', tlCost: 2, range: 3, strength: 3, crit: { status: 'slow' } },
      { wid: 'u09b', tlCost: 4, range: 5, strength: 6, strengthPerUpgrade: { kind: 'speed', n: 1 }, crit: { upgrade: 'speed' } }
    ],
    abilities: [
      { aid: 'u09r', timing: 'response', on: 'moved', energy: 1, effects: [{ k: 'damageMovedAdjacent', n: 1 }] },
      { aid: 'u09o', timing: 'ongoing', when: { hasUpgrade: 'speed' }, effects: [{ k: 'hover' }] }
    ]
  },
  // A guardian: its plate drone shields whoever stands beside it, and it steps in front of attacks aimed at allies.
  u10: {
    defId: 'u10', hp: 16, vp: 10, tl: 1, traits: ['durable', 'remote-link'],
    weapons: [
      { wid: 'u10a', tlCost: 2, range: 1, strength: 3, crit: { repeat: true } },
      { wid: 'u10b', tlCost: 4, range: 4, strength: 6, strengthPerRemoteAdj: 1, crit: { damage: 2 } }
    ],
    abilities: [
      { aid: 'u10c', timing: 'response', window: 'afterRoll', role: 'attacker', who: 'any', range: 3, energy: 1, effects: [{ k: 'setCrit', n: 1 }] },
      deployRemote('u10d', 'u10x', 3),
      challenge('u10e')
    ],
    remotes: [
      { defId: 'u10x', hp: 1, vp: 2, abilities: [{ aid: 'u10xo', timing: 'ongoing', effects: [{ k: 'auraReduceDamage', n: 1 }] }] }
    ]
  },
  // A sniper that Hovers, with a spotter drone that makes everything beside it easier to hit.
  u11: {
    defId: 'u11', hp: 12, vp: 7, tl: 2, traits: ['artillery', 'remote-link', 'hover'],
    weapons: [
      { wid: 'u11a', tlCost: 2, range: 3, strength: 3, crit: { dice: 2 } },
      { wid: 'u11b', tlCost: 4, range: 5, strength: 6, effects: [{ when: 'afterRoll', k: 'shieldsOff' }], crit: { move: 2, ignoreEngagement: true } }
    ],
    abilities: [
      { aid: 'u11c', timing: 'response', window: 'afterDamage', role: 'attacker', who: 'self', energy: 1,
        attackWhen: { targetNearOwnRemote: true }, effects: [{ k: 'slowTargetsNearRemote' }] },
      deployRemote('u11d', 'u11x', 4)
    ],
    remotes: [
      { defId: 'u11x', hp: 1, vp: 2, abilities: [{ aid: 'u11xo', timing: 'ongoing', effects: [{ k: 'auraAccuracy', n: 1 }] }] }
    ]
  },
  // A duelist that drags itself in on a chain and cuts everything near its blade drones on a critical.
  u12: {
    defId: 'u12', hp: 13, vp: 8, tl: 3, traits: ['assault', 'remote-link'],
    weapons: [
      { wid: 'u12a', tlCost: 2, range: 2, strength: 4, effects: [{ when: 'afterRoll', k: 'approach', n: 1 }], crit: { status: 'disarm' } },
      { wid: 'u12b', tlCost: 3, range: 1, strength: 7, crit: { damageNearRemote: 2 } }
    ],
    abilities: [
      { aid: 'u12c', timing: 'command', energy: 1, target: 'adjacentEnemy', effects: [{ k: 'status', s: 'fracture' }] },
      deployRemote('u12d', 'u12x', 2)
    ],
    remotes: [
      { defId: 'u12x', hp: 1, vp: 2, abilities: [{ aid: 'u12xr', timing: 'response', on: 'placed', target: 'adjacentEnemy', effects: [{ k: 'damage', n: 1 }] }] }
    ]
  },
  // The steadiest hull in the roster: it throws attackers back, steadies its allies' aim and takes hits for them.
  u13: {
    defId: 'u13', hp: 17, vp: 10, tl: 1, traits: ['durable', 'regular'],
    weapons: [
      { wid: 'u13a', tlCost: 2, range: 1, strength: 3, crit: { status: 'fracture', afterDamage: true } },
      { wid: 'u13b', tlCost: 3, range: 3, strength: 5, crit: { status: 'disarm' } }
    ],
    abilities: [
      { aid: 'u13c', timing: 'response', window: 'afterRoll', role: 'attacker', who: 'self', energy: 1,
        attackWhen: { unitTarget: true }, effects: [{ k: 'pushTarget', n: 2 }] },
      { aid: 'u13d', timing: 'response', window: 'afterRoll', role: 'attacker', who: 'other', range: 2, effects: [{ k: 'rerollMisses', n: 3 }] },
      challenge('u13e')
    ]
  },
  // A gunner that hits hardest standing still, and whose rifle catches everything next to its target.
  u14: {
    defId: 'u14', hp: 12, vp: 7, tl: 2, traits: ['artillery', 'regular'],
    weapons: [
      { wid: 'u14a', tlCost: 2, range: 0, strength: 3, area: AREA_T, crit: { status: 'fracture', afterDamage: true } },
      { wid: 'u14b', tlCost: 4, range: 4, strength: 7, alsoAdjacent: true, crit: { damage: 1 } }
    ],
    abilities: [
      { aid: 'u14c', timing: 'response', window: 'afterDamage', role: 'attacker', who: 'self', energy: 1,
        attackWhen: { unitTargets: true }, effects: [{ k: 'delayTargets', n: 1 }] },
      { aid: 'u14o', timing: 'ongoing', when: { notMoved: true }, effects: [{ k: 'accuracy', n: 1 }, { k: 'strength', n: 1 }] }
    ]
  },
  // A tracked bombard: an indirect gun that ignores Line of Sight and a missile box that blankets a whole cluster.
  u15: {
    defId: 'u15', hp: 13, vp: 7, tl: 2, traits: ['installation', 'regular'],
    weapons: [
      { wid: 'u15a', tlCost: 2, range: 4, strength: 2, ignoreLos: true, crit: { status: 'disarm' } },
      { wid: 'u15b', tlCost: 3, range: 0, strength: 5, area: AREA_FLOWER, alsoAdjacent: true, crit: { damage: 1 } }
    ],
    abilities: [
      { aid: 'u15c', timing: 'response', window: 'beforeRoll', role: 'attacker', who: 'self', energy: 1,
        attackWhen: { alliesInRange: 3 }, effects: [{ k: 'attackStrength', n: 2, per: 'alliesInRange', range: 3 }] },
      { aid: 'u15d', timing: 'response', window: 'afterDamage', role: 'attacker', who: 'self',
        attackWhen: { damagedEnemies: 2 }, effects: [{ k: 'draw', n: 1 }] }
    ]
  }
};

export const UNITS = Object.freeze({
  // Tanky, fast enough to contest markers, and the only unit that wants to be
  // next to a garrison. Low VP: killing it is poor value.
  u01: Object.freeze({
    defId: 'u01',
    hp: 16, vp: 6, tl: 2,
    traits: ['durable', 'support'],
    weapons: Object.freeze([
      Object.freeze({ wid: 'u01a', tlCost: 2, range: 2, strength: 3, crit: { status: 'slow' } }),
      Object.freeze({ wid: 'u01b', tlCost: 3, range: 3, strength: 5, crit: { damage: 2 } })
    ]),
    abilities: Object.freeze([
      // Buys the reach to reach a garrison and still act, which is the whole
      // job. Costs Energy, and its own Response is where that Energy comes
      // from -- so the unit funds itself by doing what it is for.
      Object.freeze({
        aid: 'u01c', timing: 'command', energy: 1, target: 'self',
        effects: [{ k: 'move', n: 2 }, { k: 'strength', n: 1 }]
      }),
      Object.freeze({
        aid: 'u01r', timing: 'response', on: 'rescue',
        effects: [{ k: 'energy', n: 1 }]
      })
    ])
  }),

  // Cheap to activate and first onto the track. Its heavy weapon is melee, so
  // it has to close, which is what makes it a skirmisher rather than a sniper.
  u02: Object.freeze({
    defId: 'u02',
    hp: 13, vp: 6, tl: 1,
    traits: ['assault', 'high-maneuver'],
    weapons: Object.freeze([
      Object.freeze({ wid: 'u02a', tlCost: 2, range: 2, strength: 3, crit: { status: 'fracture' } }),
      Object.freeze({ wid: 'u02b', tlCost: 3, range: 1, strength: 7, crit: { damage: 2 } })
    ]),
    abilities: Object.freeze([
      Object.freeze({
        aid: 'u02c', timing: 'command', energy: 1, target: 'self',
        effects: [{ k: 'accuracy', n: 2 }]
      }),
      // Rewards the Dash it wants to take anyway, so closing to melee range
      // is not purely a cost.
      Object.freeze({
        aid: 'u02r', timing: 'response', on: 'dash', target: 'adjacentEnemy',
        effects: [{ k: 'damage', n: 1 }]
      })
    ])
  }),

  // The longest reach and the biggest handful of dice, on the thinnest hull.
  // Highest bounty in the roster: losing it swings the score twice.
  u03: Object.freeze({
    defId: 'u03',
    hp: 12, vp: 6, tl: 3,
    traits: ['artillery'],
    weapons: Object.freeze([
      Object.freeze({ wid: 'u03a', tlCost: 2, range: 1, strength: 2, crit: { status: 'disarm' } }),
      Object.freeze({ wid: 'u03b', tlCost: 4, range: 5, strength: 8, crit: { damage: 2 } })
    ]),
    abilities: Object.freeze([
      Object.freeze({
        aid: 'u03c', timing: 'command', energy: 1, target: 'self',
        effects: [{ k: 'strength', n: 3 }]
      }),
      // A spotter bonus: it shoots better with company, which pulls the glass
      // cannon toward the squad instead of off on its own.
      Object.freeze({
        aid: 'u03o', timing: 'ongoing', when: { alliesInRange: { n: 1, range: 3 } },
        effects: [{ k: 'accuracy', n: 1 }]
      })
    ])
  }),

  // Both weapons apply a status. It wins fights it does not finish, by making
  // the next attacker's job easier.
  u04: Object.freeze({
    defId: 'u04',
    hp: 13, vp: 7, tl: 3,
    traits: ['assault'],
    weapons: Object.freeze([
      Object.freeze({ wid: 'u04a', tlCost: 2, range: 1, strength: 3, crit: { status: 'disarm' } }),
      Object.freeze({ wid: 'u04b', tlCost: 3, range: 2, strength: 6, crit: { status: 'fracture' } })
    ]),
    abilities: Object.freeze([
      // Applies a status without having to roll for it, which is what makes
      // this unit a reliable setup piece rather than a gambler.
      Object.freeze({
        aid: 'u04c', timing: 'command', energy: 1, target: 'enemyInRange', range: 2,
        effects: [{ k: 'status', s: 'slow' }]
      }),
      Object.freeze({
        aid: 'u04o', timing: 'ongoing', when: { enemyAdjacent: true },
        effects: [{ k: 'strength', n: 1 }]
      })
    ])
  }),

  // The most hit points and the hardest single hit, at melee range and 4
  // Timeline a swing -- it is slow in the only sense this game measures.
  u05: Object.freeze({
    defId: 'u05',
    hp: 16, vp: 9, tl: 2,
    traits: ['durable', 'assault'],
    weapons: Object.freeze([
      Object.freeze({ wid: 'u05a', tlCost: 2, range: 3, strength: 2, crit: { status: 'slow' } }),
      Object.freeze({ wid: 'u05b', tlCost: 4, range: 1, strength: 8, crit: { damage: 2 } })
    ]),
    abilities: Object.freeze([
      // A second swing at no Timeline cost, which is the only way a 4-cost
      // melee weapon ever gets used twice in a Phase.
      Object.freeze({
        aid: 'u05c', timing: 'command', energy: 1, target: 'self',
        effects: [{ k: 'extraAttack', n: 1 }]
      }),
      // Two separate thresholds rather than one scaling rule, so the moment it
      // becomes dangerous is legible on the board rather than arithmetic.
      Object.freeze({
        aid: 'u05o1', timing: 'ongoing', when: { damageTaken: 6 },
        effects: [{ k: 'strength', n: 1 }]
      }),
      Object.freeze({
        aid: 'u05o2', timing: 'ongoing', when: { damageTaken: 12 },
        effects: [{ k: 'strength', n: 1 }]
      })
    ])
  }),

  // Ignores line of sight with its mortar, so it punishes anyone hiding on an
  // objective. Built to sit on one: once objectives paid several VP each it
  // held them too well, so self-play trimmed its hull and mortar (see
  // docs/rules-reconciliation.md, "Balance after reconciliation").
  u06: Object.freeze({
    defId: 'u06',
    hp: 13, vp: 7, tl: 3,
    traits: ['durable', 'installation'],
    weapons: Object.freeze([
      Object.freeze({ wid: 'u06a', tlCost: 2, range: 2, strength: 3, crit: { status: 'slow' } }),
      Object.freeze({ wid: 'u06b', tlCost: 4, range: 3, strength: 5, ignoreLos: true, crit: { status: 'slow' } })
    ]),
    abilities: Object.freeze([
      Object.freeze({
        aid: 'u06c', timing: 'command', energy: 1, target: 'enemyInRange', range: 3,
        effects: [{ k: 'status', s: 'disarm' }]
      }),
      // Rewards doing its job. Holding ground makes it hit harder, so the
      // zone controller is strongest exactly where you want it to stand.
      Object.freeze({
        aid: 'u06o', timing: 'ongoing', when: { objectives: 1 },
        effects: [{ k: 'strength', n: 1 }]
      })
    ])
  }),

  u07: deepFreeze(WAVE_TWO.u07),
  u08: deepFreeze(WAVE_TWO.u08),
  u09: deepFreeze(WAVE_TWO.u09),
  u10: deepFreeze(WAVE_TWO.u10),
  u11: deepFreeze(WAVE_TWO.u11),
  u12: deepFreeze(WAVE_TWO.u12),
  u13: deepFreeze(WAVE_TWO.u13),
  u14: deepFreeze(WAVE_TWO.u14),
  u15: deepFreeze(WAVE_TWO.u15)
});

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/** Roster order, for menus and for anything that needs a stable sequence. */
export const ROSTER = Object.freeze([
  'u01', 'u02', 'u03', 'u04', 'u05', 'u06', 'u07', 'u08', 'u09', 'u10', 'u11', 'u12', 'u13', 'u14', 'u15'
]);

/**
 * The units a squad may be built from, in menu order: the active pack's (`unitOrder`, or its definition order), or
 * the built-in roster.
 * @returns {string[]}
 */
export function pool() {
  const pack = activePack();
  return pack ? (pack.unitOrder || Object.keys(pack.units)).slice() : ROSTER.slice();
}

/** Units per squad in the skirmish (the starter format). */
export const SQUAD_SIZE = 3;

/**
 * May this unit join this (partial) squad? The squad has room, the unit is in the pool, and it is not already in the
 * squad unless it is Mass Produced (rulebook 2026-10-30, "Building a Squad").
 * @param {string[]} squad
 * @param {string} defId
 * @param {number} [size]
 * @returns {boolean}
 */
export function canAdd(squad, defId, size) {
  const max = size === undefined ? SQUAD_SIZE : size;
  if (!Array.isArray(squad) || squad.length >= max || pool().indexOf(defId) === -1) return false;
  if (squad.indexOf(defId) === -1) return true;
  return (def(defId).traits || []).indexOf('mass-produced') !== -1;
}

/**
 * Is this a complete, legal squad?
 * @param {string[]} squad
 * @param {number} [size]
 * @returns {boolean}
 */
export function isLegalSquad(squad, size) {
  const max = size === undefined ? SQUAD_SIZE : size;
  if (!Array.isArray(squad) || squad.length !== max) return false;
  const built = [];
  for (const d of squad) {
    if (!canAdd(built, d, max)) return false;
    built.push(d);
  }
  return true;
}

/**
 * The built-in unit a matchup table knows this unit as: a pack unit's `counterpart` (the built-in unit with its
 * numbers) or its `standIn`, or the unit itself.
 * @param {string} defId
 * @returns {string}
 */
export function counterpartOf(defId) {
  const pack = activePack();
  const d = pack && pack.units[defId];
  return (d && (d.counterpart || d.standIn)) || defId;
}

/**
 * Which built-in machine's stand-in figure a unit borrows. A pack unit names one (`standIn`); our own units are their
 * own stand-ins.
 * @param {string} defId
 * @returns {string}
 */
export function standInFor(defId) {
  const pack = activePack();
  const d = pack && pack.units[defId];
  return (d && d.standIn) || defId;
}

/**
 * @param {string} defId
 * @returns {Object}
 */
export function def(defId) {
  const pack = activePack();
  const d = (pack && pack.units[defId]) || UNITS[defId];
  if (!d) throw new Error('No unit definition: ' + defId);
  return d;
}

/**
 * A unit spec ready for `State.createGame`, from a definition plus a position.
 *
 * @param {string} uid    instance id
 * @param {string} defId
 * @param {0|1} side
 * @param {{q: number, r: number}} hex
 * @returns {Object}
 */
export function instance(uid, defId, side, hex) {
  const d = def(defId);
  return {
    uid: uid,
    defId: defId,
    side: side,
    hex: hex,
    hp: d.hp,
    vp: d.vp,
    tl: d.tl,
    // Traits ride along on the instance: some are rules (a pack unit's 'hover'), not just deck gating.
    traits: (d.traits || []).slice(),
    weapons: d.weapons.map(function (w) {
      // a deep copy of the whole weapon, so every field the data carries reaches the engine
      return Object.assign(JSON.parse(JSON.stringify(w)), {
        accuracy: w.accuracy || 0, ignoreLos: Boolean(w.ignoreLos),
        crit: w.crit ? JSON.parse(JSON.stringify(w.crit)) : null
      });
    }),
    // Remote Weapon Systems start in the unit's supply
    remotes: (d.remotes || []).map(function (r) { return JSON.parse(JSON.stringify(r)); }),
    // Deep-copied for the same reason as weapons: two instances of one
    // definition must never share a mutable object.
    abilities: (d.abilities || []).map(function (a) {
      return JSON.parse(JSON.stringify(a));
    })
  };
}
