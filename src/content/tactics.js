/**
 * Tactics cards.
 *
 * Each player builds a deck of exactly nine, shuffles it blind, and draws
 * three. A card may be played during one of your units' activations, one card
 * per unit turn, and playing one defensively locks you out of playing another
 * on your next activation.
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
 * @property {'command'|'response'} timing
 * @property {?Object} requires  `{trait}` or `{defId}`; null means any squad
 * @property {string} [target]   as for abilities: 'self' | 'enemyInRange'
 * @property {number} [range]
 * @property {Object} [when]
 * @property {Array<Object>} effects
 */

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
  })
});

export const POOL = Object.freeze(Object.keys(CARDS));

/**
 * @param {string} cid
 * @returns {TacticsCard}
 */
export function card(cid) {
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
  const eligible = POOL.filter(function (cid) { return allowedFor(card(cid), defs); });

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
