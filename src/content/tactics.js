/**
 * Tactics cards.
 *
 * Each player builds a deck of nine (three more for each Phase beyond two), one
 * copy of each card, shuffles it blind, and draws three. Each player may play
 * up to one card per activation.
 *
 * Cards carry the SAME effect data as abilities and are resolved by the same
 * code in `src/engine/effects.js`. A card is an ability that lives in a hand
 * instead of on a unit, which is why there is no second effect system here.
 *
 * `requires` is the deckbuilding restriction: a card may only be included if
 * at least one unit in the squad matches. A trait, or a specific unit id.
 * Nothing enforces this at runtime beyond `buildDeck`, because a deck is fixed
 * at setup and never changes mid-game.
 */

/**
 * @typedef {Object} TacticsCard
 * @property {string} cid
 * @property {'command'|'response'|'attack'} timing
 * @property {?Object} requires  `{trait}` or `{defId}`; null means any squad
 * @property {string} [target]   as for abilities: 'self' | 'enemyInRange'
 * @property {number} [range]
 * @property {Object} [when]
 * @property {Array<Object>} effects
 */

import { activePack } from './packs.js';

export const CARDS = Object.freeze({
  // --- Open to any squad ---------------------------------------------------
  t01: Object.freeze({
    cid: 't01', timing: 'command', requires: null, target: 'self',
    effects: [{ k: 'strength', n: 2 }]
  }),
  t02: Object.freeze({
    cid: 't02', timing: 'command', requires: null, target: 'self',
    effects: [{ k: 'accuracy', n: 2 }]
  }),
  t03: Object.freeze({
    cid: 't03', timing: 'command', requires: null, target: 'self',
    effects: [{ k: 'move', n: 2 }]
  }),
  t04: Object.freeze({
    cid: 't04', timing: 'command', requires: null, target: 'self',
    effects: [{ k: 'energy', n: 2 }]
  }),
  t05: Object.freeze({
    cid: 't05', timing: 'command', requires: null, target: 'self',
    effects: [{ k: 'heal', n: 3 }]
  }),
  t06: Object.freeze({
    cid: 't06', timing: 'command', requires: null, target: 'enemyInRange', range: 3,
    effects: [{ k: 'status', s: 'slow' }]
  }),
  t07: Object.freeze({
    cid: 't07', timing: 'command', requires: null, target: 'enemyInRange', range: 2,
    effects: [{ k: 'damage', n: 2 }]
  }),
  t08: Object.freeze({
    cid: 't08', timing: 'command', requires: null, target: 'enemyInRange', range: 3,
    effects: [{ k: 'status', s: 'blinded' }]
  }),

  // --- Gated on what the squad actually is ---------------------------------
  t09: Object.freeze({
    cid: 't09', timing: 'command', requires: { trait: 'durable' }, target: 'self',
    effects: [{ k: 'heal', n: 5 }]
  }),
  t10: Object.freeze({
    cid: 't10', timing: 'command', requires: { trait: 'assault' }, target: 'self',
    effects: [{ k: 'extraAttack', n: 1 }]
  }),
  t11: Object.freeze({
    cid: 't11', timing: 'command', requires: { trait: 'artillery' }, target: 'self',
    effects: [{ k: 'strength', n: 3 }, { k: 'accuracy', n: 1 }]
  }),
  t12: Object.freeze({
    cid: 't12', timing: 'command', requires: { trait: 'support' }, target: 'self',
    effects: [{ k: 'energy', n: 1 }, { k: 'move', n: 2 }]
  }),
  t13: Object.freeze({
    cid: 't13', timing: 'command', requires: { trait: 'high-maneuver' }, target: 'self',
    effects: [{ k: 'move', n: 3 }]
  }),
  t14: Object.freeze({
    cid: 't14', timing: 'command', requires: { trait: 'installation' }, target: 'enemyInRange', range: 4,
    effects: [{ k: 'status', s: 'disarm' }]
  }),

  // --- The second wave (u07 to u15): the published cards' mechanics, our names -------------------------------------
  // Signature cards name their unit; the trait-gated ones need a squad member with the trait, and the cards that say
  // "your active <trait> unit" also need the activating unit to carry it (`activeTrait`).
  t15: card15({ cid: 't15', timing: 'command', requires: { defId: 'u07' }, target: 'enemyInRange', range: 2, los: true,
    when: { upgrades: 1 }, effects: [{ k: 'damage', n: 1, per: 'upgrades' }] }),
  t16: card15({ cid: 't16', timing: 'command', requires: { defId: 'u08' }, target: 'self',
    effects: [{ k: 'moveNow', n: 5 }, { k: 'rescueMovedAdjacent' }] }),
  t17: card15({ cid: 't17', timing: 'command', requires: { defId: 'u09' }, target: 'unitInRange', range: 3, los: true,
    effects: [{ k: 'steal', energy: 1, upgrades: 1 }] }),
  t18: card15({ cid: 't18', timing: 'command', requires: { trait: 'task-force' }, activeTrait: 'task-force', target: 'self',
    effects: [{ k: 'speed', n: 3 }, { k: 'hover' }] }),
  t19: card15({ cid: 't19', timing: 'command', requires: { trait: 'task-force' }, target: 'self',
    effects: [{ k: 'upgradeChoice', n: 1 }] }),
  t20: card15({ cid: 't20', timing: 'command', requires: { trait: 'task-force' }, target: 'self',
    effects: [{ k: 'heal', n: 3 }, { k: 'energy', n: 1, ifFullHp: true }] }),
  t21: card15({ cid: 't21', timing: 'command', requires: { trait: 'task-force' }, target: 'self',
    effects: [{ k: 'upgradeSpread', n: 3, trait: 'task-force' }] }),
  t22: card15({ cid: 't22', timing: 'response', window: 'afterRoll', role: 'attacker', requires: { trait: 'task-force' },
    effects: [{ k: 'rerollMisses', drawIf: 3, draw: 1 }] }),
  t23: card15({ cid: 't23', timing: 'response', window: 'afterRoll', role: 'defender', pick: 'one', pickWhen: 'lessVp', requires: null,
    effects: [{ k: 'reduceDamage', n: 4 }] }),
  t24: card15({ cid: 't24', timing: 'command', requires: { defId: 'u10' }, target: 'self',
    effects: [{ k: 'repositionAllRemotes' }, { k: 'remotesStrike', n: 1, all: true }] }),
  t25: card15({ cid: 't25', timing: 'command', requires: { defId: 'u11' }, target: 'self', when: { ownRemoteDeployed: true },
    effects: [{ k: 'delayNearRemote', n: 1 }] }),
  t26: card15({ cid: 't26', timing: 'command', requires: { defId: 'u12' }, target: 'hexNearOwnRemote', remote: 'u12x',
    effects: [{ k: 'repositionSelf' }, { k: 'damageBonus', n: 2 }] }),
  t27: card15({ cid: 't27', timing: 'command', requires: { trait: 'remote-link' }, target: 'enemyNearOwnRemote',
    effects: [{ k: 'destroyUpgrades', n: 'all' }] }),
  t28: card15({ cid: 't28', timing: 'command', requires: { trait: 'remote-link' }, target: 'self',
    effects: [{ k: 'remotesStrike', n: 1 }] }),
  t29: card15({ cid: 't29', timing: 'command', requires: { trait: 'remote-link' }, activeTrait: 'remote-link', target: 'self',
    effects: [{ k: 'statusAll', s: 'disarm', range: 3, los: true }] }),
  t30: card15({ cid: 't30', timing: 'response', window: 'afterRoll', role: 'defender', pick: 'one', requires: { trait: 'remote-link' },
    effects: [{ k: 'reduceDamage', n: 3, perRemote: 1, range: 2 }] }),
  t31: card15({ cid: 't31', timing: 'response', window: 'beforeRoll', role: 'attacker', requires: { trait: 'remote-link' },
    effects: [{ k: 'attackStrength', n: 3 }, { k: 'attackStrength', n: 1, per: 'remotesAdjTarget' }] }),
  t32: card15({ cid: 't32', timing: 'response', window: 'beforeRoll', role: 'defender', requires: null,
    effects: [{ k: 'challenge', range: 2 }] }),
  t33: card15({ cid: 't33', timing: 'response', window: 'enemyMoved', role: 'defender', requires: { defId: 'u13' },
    effects: [{ k: 'reactAttack', wid: 'u13b', tl: 1, range: 3 }] }),
  t34: card15({ cid: 't34', timing: 'command', requires: { defId: 'u14' }, target: 'self',
    effects: [{ k: 'grant', grant: { kind: 'attack', wid: 'u14a' } }] }),
  t35: card15({ cid: 't35', timing: 'command', requires: { defId: 'u15' }, target: 'self',
    effects: [{ k: 'moveNow', n: 2 }, { k: 'statusAll', s: 'fracture', range: 2, los: true }] }),
  t36: card15({ cid: 't36', timing: 'response', window: 'beforeRoll', role: 'attacker', requires: { trait: 'regular' },
    attackWhen: { attackerNearAlly: 3 }, effects: [{ k: 'attackAccuracy', n: 2 }, { k: 'attackStrength', n: 2 }] }),
  t37: card15({ cid: 't37', timing: 'response', window: 'afterDamage', role: 'defender', pick: 'one', pickWhen: 'damaged',
    requires: { trait: 'regular' }, effects: [{ k: 'energyTo', n: 2 }] }),
  t38: card15({ cid: 't38', timing: 'command', requires: null, target: 'enemyInRange', range: 2, los: true,
    effects: [{ k: 'destroyUpgrades', n: 2 }] }),
  t39: card15({ cid: 't39', timing: 'command', requires: null, target: 'self', when: { garrisonsDestroyed: 3 },
    effects: [{ k: 'nextAttackStrength', n: 4 }] }),
  t40: card15({ cid: 't40', timing: 'response', window: 'afterDamage', role: 'defender', pick: 'one', pickWhen: 'counter', requires: null,
    effects: [{ k: 'counterAttack', tl: -1 }] }),
  t41: card15({ cid: 't41', timing: 'response', window: 'beforeRoll', role: 'defender', requires: null,
    effects: [{ k: 'attackAccuracy', n: -2 }] })
});

/** Freeze a card definition all the way down. */
function card15(c) {
  const freeze = function (o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const k of Object.keys(o)) freeze(o[k]);
    }
    return o;
  };
  return freeze(c);
}

export const POOL = Object.freeze(Object.keys(CARDS));

/**
 * @param {string} cid
 * @returns {TacticsCard}
 */
export function card(cid) {
  const pack = activePack();
  if (pack && pack.tactics && pack.tactics[cid]) return pack.tactics[cid];
  const c = CARDS[cid];
  if (!c) throw new Error('No tactics card: ' + cid);
  return c;
}

/**
 * May a squad include this card?
 *
 * @param {TacticsCard} c
 * @param {Array<Object>} defs unit definitions in the squad
 * @returns {boolean}
 */
export function allowedFor(c, defs) {
  if (!c.requires) return true;
  for (let i = 0; i < defs.length; i++) {
    if (c.requires.defId && defs[i].defId === c.requires.defId) return true;
    if (c.requires.trait && (defs[i].traits || []).indexOf(c.requires.trait) !== -1) return true;
  }
  return false;
}

/**
 * Every card a squad may put in its deck, in the pool's order: signature cards it qualifies for, then open cards.
 * @param {Array<Object>} defs
 * @returns {string[]}
 */
export function deckPool(defs) {
  const pack = activePack();
  const pool = pack && pack.tactics ? (pack.tacticsOrder || Object.keys(pack.tactics)) : POOL.slice();
  return pool.filter(function (cid) { return allowedFor(card(cid), defs); });
}

/**
 * Is this a legal deck for the squad: exactly `size` cards, one copy of each, every one allowed?
 * @param {string[]} cids
 * @param {Array<Object>} defs
 * @param {number} [size]
 * @returns {boolean}
 */
export function isLegalDeck(cids, defs, size) {
  const want = size === undefined ? 9 : size;
  if (!Array.isArray(cids) || cids.length !== want) return false;
  const pool = deckPool(defs);
  const seen = {};
  for (const cid of cids) {
    if (seen[cid] || pool.indexOf(cid) === -1) return false;
    seen[cid] = true;
  }
  return true;
}

/**
 * Build a legal nine-card deck for a squad.
 *
 * Takes every card the squad qualifies for, in pool order, and pads with the
 * unrestricted ones if the gated cards do not reach nine. Deterministic on
 * purpose -- the shuffle is the engine's job, using the seeded generator, so
 * that a game replays exactly.
 *
 * @param {Array<Object>} defs
 * @param {number} [size]
 * @returns {string[]}
 */
export function buildDeck(defs, size) {
  const want = size === undefined ? 9 : size;
  const pack = activePack();
  if (pack && pack.tactics) {
    // A pack's deck: every signature card the squad qualifies for, then the pack's open cards in its order.
    const pool = pack.tacticsOrder || Object.keys(pack.tactics);
    // signature cards first, then every other card the squad may take (open or trait-gated) in the pack's order
    const picked = pool.filter(function (cid) {
      const c = pack.tactics[cid];
      return c.requires && c.requires.defId && allowedFor(c, defs);
    });
    for (const cid of pool) {
      if (picked.length >= want) break;
      if (picked.indexOf(cid) === -1 && allowedFor(pack.tactics[cid], defs)) picked.push(cid);
    }
    return picked.slice(0, want);
  }
  // the squad's own cards first: signature cards, then cards gated on a trait it has, then open cards, each in pool order
  const rank = function (cid) {
    const r = card(cid).requires;
    return r && r.defId ? 0 : r && r.trait ? 1 : 2;
  };
  const eligible = POOL.filter(function (cid) { return allowedFor(card(cid), defs); })
    .map(function (cid, i) { return { cid: cid, i: i }; })
    .sort(function (x, y) { return rank(x.cid) - rank(y.cid) || x.i - y.i; })
    .map(function (x) { return x.cid; });

  const deck = [];
  for (let i = 0; i < eligible.length && deck.length < want; i++) deck.push(eligible[i]);

  // Normally one copy per deck; a second copy is only reached if the squad
  // qualifies for fewer than nine distinct cards, which the six-unit roster
  // never does but a smaller scenario squad could.
  let i = 0;
  while (deck.length < want && eligible.length) {
    deck.push(eligible[i % eligible.length]);
    i++;
  }
  return deck;
}
