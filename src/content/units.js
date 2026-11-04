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
    hp: 12, vp: 6, tl: 1,
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
    hp: 11, vp: 7, tl: 3,
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
    hp: 14, vp: 7, tl: 3,
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
    hp: 17, vp: 8, tl: 2,
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
  })
});

/** Roster order, for menus and for anything that needs a stable sequence. */
export const ROSTER = Object.freeze(['u01', 'u02', 'u03', 'u04', 'u05', 'u06']);

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
      return {
        wid: w.wid, tlCost: w.tlCost, range: w.range, strength: w.strength,
        accuracy: w.accuracy || 0, ignoreLos: Boolean(w.ignoreLos),
        crit: w.crit ? JSON.parse(JSON.stringify(w.crit)) : null
      };
    }),
    // Deep-copied for the same reason as weapons: two instances of one
    // definition must never share a mutable object.
    abilities: (d.abilities || []).map(function (a) {
      return JSON.parse(JSON.stringify(a));
    })
  };
}
