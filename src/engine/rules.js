/**
 * The rules configuration -- every number and every judgement call the engine
 * depends on, in one place.
 *
 * Two jobs:
 *
 * 1. **Constants.** Nothing else in the engine hard-codes a magic number, so a
 *    rules revision is a one-file edit rather than a grep.
 *
 * 2. **House rules.** The ruleset was reconstructed from public sources ahead
 *    of the printed rulebook (see `docs/rules-reconstruction.md`). Some rules
 *    are unverified (marked there with a warning) and seven are genuinely
 *    unresolved (marked there with a question mark). *Every one of those seven
 *    is a named, documented value below*, with our best guess as its default
 *    and a comment saying why. `OPEN_QUESTIONS` maps each one back to its
 *    numbered question. When the rulebook lands in October, the work is
 *    correcting values here, not excavating the engine.
 *
 * A few values that the sources agree on are still exposed here, because a
 * config that only holds the doubtful values reads as if everything else were
 * beyond question, and because scenarios will want to vary some of them.
 *
 * Everything here is plain data: it is copied into `state.rules`, and the state
 * has to survive `structuredClone`.
 */

/**
 * @typedef {Object} TerrainKind
 * @property {number} moveExtra      extra movement cost to enter, beyond the base 1
 * @property {number} accuracy       accuracy shift applied to attacks, once combat exists
 * @property {boolean} blocksLos     does a hex of this kind block line of sight
 * @property {boolean} impassable    can a unit enter it at all
 */

export const DEFAULTS = {

  // --- The Timeline --------------------------------------------------------

  timeline: {
    /** Rounds on the track. Authoritative. */
    rounds: 10,

    /**
     * What happens to a token pushed past the last round. The sources say only
     * that it "does not activate again until the next Phase" and do not say
     * where it lands when that Phase starts.
     *
     *   'wrap'  -- round 12 becomes round 2 of the next Phase. Preserves the
     *              difference between a 2-cost and a 4-cost overrun, which is
     *              the whole point of variable Timeline costs, so this is the
     *              default.
     *   'reset' -- the token starts the next Phase on round 1 regardless.
     */
    overflow: 'wrap',

    /**
     * Within one round held by both players, activation "begins with the
     * opponent of whoever acted last". The sources say *begins* and stop
     * there, leaving the rest of the round unspecified.
     *
     *   true  -- read the rule as continuous: sides alternate for as long as
     *            both have tokens left on the round, then the survivor
     *            finishes its stack. This is the only reading that makes the
     *            rule mean anything after the first activation.
     *   false -- read it as a first-activation rule only: whoever starts the
     *            round empties their stack before the other side moves.
     */
    alternateWithinRound: true,

    /** "Roll one attack die" for initiative -- attack dice are d10. */
    initiativeDieSides: 10,

    /** Ties on the initiative roll are rerolled rather than broken by seat. */
    initiativeRerollTies: true
  },

  // --- Match shape ---------------------------------------------------------

  match: {
    /**
     * Two Phases of ten rounds, twenty rounds in all. Rulebook (2026-10-30),
     * "Object of the Game" and "Ending a Phase". Scenarios may play longer,
     * in which case each extra Phase adds three Tactics cards to the deck.
     */
    phasesPerGame: 2,

    /** Units per side. The starter format; larger sets go to 5. */
    squadSize: 3
  },

  // --- Movement ------------------------------------------------------------

  movement: {
    /** Hexes granted by an Advance. Authoritative. */
    advanceHexes: 3,

    /** Extra hexes granted by a Dash. Authoritative. */
    dashHexes: 2,

    /** Cost to enter an ordinary hex before terrain and engagement. */
    baseHexCost: 1,

    /** Extra cost per level of elevation *ascended*. Descending is free. */
    elevationCostPerLevel: 1,

    /**
     * Entering a hex adjacent to an enemy unit, or to an enemy Garrison,
     * costs this much on top of the base cost.
     *
     * The source phrasing is "costs -1 hex of movement", which can be read
     * either as a penalty of one hex or as a discount of one hex. We read it
     * as a penalty: a discount would make closing with the enemy *cheaper*
     * than walking in the open, which inverts the zone-of-control idea the
     * rule plainly exists to express. Set to -1 to take the other reading.
     */
    engagementCost: 1,

    /** Do enemy Garrisons project engagement the way enemy units do? */
    engagementFromEnemyGarrison: true,

    /**
     * A unit may not finish a movement action on the hex it began that action
     * on -- so it cannot spend an Advance walking in a circle to dodge the
     * "movement is one block" rule. Unverified, but harmless if wrong.
     */
    noEndOnStartHex: true,

    /**
     * Movement is one unsplittable block: once the unit has stopped and done
     * something else, it cannot move again this activation. Advance and Dash
     * together form one block, in either order.
     */
    oneBlock: true,

    /** A unit may pass through friendly units and friendly Garrisons... */
    passThroughFriendly: true,

    /** ...but may not finish its movement on one. */
    endOnFriendly: false,

    /** A unit may not pass through an enemy unit and must detour. */
    passThroughEnemy: false,

    /**
     * The sources say enemy *units* block movement and say nothing about
     * enemy Garrisons. We treat a Garrison as a physical object on the board
     * and block movement through an enemy one. House decision.
     */
    enemyGarrisonBlocks: true,

    /** One unit per hex, maximum. Authoritative. */
    onePerHex: true,

    /** Floor on the cost of entering a hex, after all modifiers. */
    minHexCost: 0
  },

  /**
   * OPEN QUESTION 6. The full terrain catalogue is not published. These four
   * kinds cover everything the sources actually describe -- open ground,
   * water (costs a hex and hurts accuracy), and impassable scenery -- plus
   * `rough` as a cheap hook for the "costs a hex, no accuracy effect" slot the
   * catalogue almost certainly contains. Elevation is a per-hex number rather
   * than a terrain kind, because the sources treat it as an independent axis.
   *
   * @type {Object<string, TerrainKind>}
   */
  terrain: {
    open:    { moveExtra: 0, accuracy: 0,  blocksLos: false, impassable: false },
    rough:   { moveExtra: 1, accuracy: 0,  blocksLos: false, impassable: false },
    water:   { moveExtra: 1, accuracy: -1, blocksLos: false, impassable: false },
    blocked: { moveExtra: 0, accuracy: 0,  blocksLos: true,  impassable: true }
  },

  // --- Actions -------------------------------------------------------------

  actions: {
    /**
     * Exactly one Primary Action per activation, and it is mandatory. The
     * engine still lets a unit end its activation if literally no Primary is
     * available to it, rather than deadlocking the Timeline.
     */
    primaryMandatory: true,

    /** Advance, Command abilities and Tactics cards cost no Timeline. */
    advance: { tlCost: 0 },

    /** Dash: two more hexes, before or after Advancing. */
    dash: { tlCost: 2 },

    /** Energize: one Energy token. */
    energize: { tlCost: 2, gain: 1 },

    /** Rescue: claim an adjacent friendly Garrison. Implemented in a later milestone. */
    rescue: { tlCost: 2 },

    /**
     * Ceiling on Energy held by one unit. No source mentions one, so there is
     * none; a number here would cap it.
     */
    maxEnergy: null,

    /**
     * How far a unit's token moves when it ends an activation without taking a
     * Primary Action. That is not a legal turn, and the engine only allows it
     * when the unit has no Primary available at all -- boxed in with nowhere to
     * Dash and Energy capped out. The token still has to move, or the round
     * would never empty. Two, matching the cheapest Primary.
     */
    forcedPassTlCost: 2
  },

  // --- Combat (declared now, resolved in a later milestone) ----------------

  combat: {
    /** Minimum die face that hits, before modifiers. */
    defaultAccuracy: 4,

    /** Attack dice are d10. */
    dieSides: 10,

    /** A natural 1 misses regardless of modifiers. */
    naturalMiss: 1,

    /** A natural 9 or 10 hits and crits regardless of modifiers. */
    critFrom: 9,

    /**
     * OPEN QUESTION 4. Is there unit-level damage reduction? The publisher's
     * own guide describes none -- damage equals hits -- and the one source
     * that mentions a "shield value" appears to be describing the Shield
     * Upgrade token. Default: no such stat exists.
     */
    unitDamageReduction: false,

    /** Line of sight is only checked at range 2 and beyond. */
    losMinRange: 2,

    /**
     * Elevation "affects accuracy based on level differences". The sources say
     * that much and no more, so one pip per level, in the higher shooter's
     * favour, is the smallest reading that honours the sentence.
     */
    elevationAccuracyPerLevel: 1,

    /**
     * OPEN QUESTION 3. A line of sight traced centre to centre can run exactly
     * along the boundary between two hexes, and the sources do not say how to
     * resolve it.
     *
     *   'permissive' -- the line is blocked only if *both* boundary hexes
     *                   block it. Favours the shooter, and matches the
     *                   convention most hex games settle on.
     *   'strict'     -- either hex blocks.
     *   'nudge'      -- take the single line `hex.line` draws and ask only
     *                   those hexes. Cheapest, and already deterministic
     *                   because of `hex.LINE_NUDGE`, but the answer depends on
     *                   an arbitrary epsilon, which is unpleasant in a rule.
     */
    losBoundary: 'permissive',

    /**
     * What an intervening hex must hold to stop a shot. The sources name
     * "any enemy unit, base, objective or unit token other than the intended
     * target", which conspicuously does NOT include the shooter's own units --
     * so friendly fire lanes stay open. That asymmetry is deliberate and is
     * the kind of thing a reader assumes is a bug, hence this note.
     */
    losBlockers: {
      enemyUnits: true,
      friendlyUnits: false,
      garrisons: true,
      objectives: true
    },

    /**
     * A weapon may raise or lower the number of dice, and separately shift the
     * face each die must beat. Keeping the two apart matters: `strength`
     * changes how many dice, accuracy changes what each needs, and abilities
     * exist for both. Collapsing them would make several published abilities
     * inexpressible.
     */
    maxAccuracyShift: 5
  },

  // --- Statuses and upgrades -----------------------------------------------

  /**
   * Section 8 of the rules reconstruction. A unit may carry several different
   * statuses but never two of the same, which is enforced where they are
   * applied rather than here.
   */
  statuses: {
    /** `fracture` fires the next time the unit takes at least this much. */
    fractureThreshold: 3,
    /** ...and adds this much when it does, then clears itself. */
    fractureBonus: 3,
    /** Statuses a unit can carry. Anything outside this list is a bug. */
    known: ['slow', 'fracture', 'disarm', 'blinded']
  },

  upgrades: {
    /** Board pickups, collected by moving onto or through their hex. */
    known: ['shield', 'speed', 'strength', 'accuracy'],
    /** The Shield upgrade absorbs this much once per activation of its holder. */
    shieldAbsorb: 1,
    /** Speed adds this many hexes to an Advance. */
    speedBonusHexes: 1,
    /** Upgrades are kept for the rest of the game once picked up. */
    permanent: true
  },

  // --- Destruction ---------------------------------------------------------

  destruction: {
    /** A destroyed unit's token moves this many rounds forward. Authoritative. */
    tokenPushRounds: 2,

    /**
     * OPEN QUESTION 2. A destroyed unit reportedly redeploys at an allied base
     * when its token's round comes round again. Whether that is universal or
     * something a scenario grants is unresolved.
     *
     *   'scenario' -- allowed only where the scenario provides a base to
     *                 redeploy at, which is the reading that cannot break a
     *                 scenario that never anticipated it. Default.
     *   'always' / 'never' -- the two unambiguous readings.
     */
    redeploy: 'scenario'
  },

  // --- Scoring -------------------------------------------------------------

  scoring: {
    /**
     * OPEN QUESTION 5. VP for holding an Objective at the end of a Phase is
     * scenario-specified and no published number is available. One point per
     * Objective per Phase is the default a scenario inherits if it says
     * nothing; scenarios should set their own.
     */
    objectiveControlVp: 1,

    /** VP for rescuing a friendly Garrison. Unverified. */
    garrisonRescueVp: 2,

    /** VP for destroying an enemy Garrison. Unverified. */
    garrisonDestroyVp: 2,

    /** Objective control is recalculated at the end of every round... */
    objectiveControlPerRound: true,

    /** ...but only the controller at the end of a Phase banks the points. */
    objectiveScoreAtPhaseEnd: true
  },

  // --- Tactics cards (declared now, resolved in a later milestone) ---------

  tactics: {
    /** Exactly nine cards in a deck. Authoritative. */
    deckSize: 9,

    /** Three drawn for an opening hand. Authoritative. */
    openingHand: 3,

    /**
     * Three more cards at the end of every Phase but the last. Rulebook
     * (2026-10-30), "Ending a Phase" and "Other Tactics Deck Rules": in the
     * standard two-Phase game that is one draw, at the end of Phase 1, and
     * a longer game adds three cards to the deck per extra Phase.
     */
        drawPerPhase: 3,
    drawOnlyAfterFirstPhase: false,

    /** One card per unit turn. Unverified. */
    onePerUnitTurn: true,

    /**
     * Off. A community wiki described a lockout after playing a card
     * defensively, but neither issue of the rulebook (2026-08-28, 2026-10-30)
     * has one. The switch stays so the behaviour can be tested.
     */
    lockoutAfterDefensivePlay: false
  }
};

/**
 * The seven unresolved rules from `docs/rules-reconstruction.md` section 9,
 * each bound to the config value that decides it. The test suite walks this
 * list and fails if a question has no value behind it, which is what stops the
 * config from quietly falling out of step with the reconstruction.
 */
export const OPEN_QUESTIONS = Object.freeze([
  Object.freeze({
    n: 1,
    question: 'How many Phases does a game last, and is it always scenario-specified?',
    path: 'match.phasesPerGame',
    decision: 'RESOLVED (rulebook 2026-10-30): two Phases; scenarios may play longer.'
  }),
  Object.freeze({
    n: 2,
    question: 'Is redeployment at an allied base universal, or scenario-gated?',
    path: 'destruction.redeploy',
    decision: 'Scenario-gated.'
  }),
  Object.freeze({
    n: 3,
    question: 'Line of sight along an exact hex boundary.',
    path: 'combat.losBoundary',
    decision: 'Permissive: blocked only if both boundary hexes block.'
  }),
  Object.freeze({
    n: 4,
    question: 'Is there any unit-level damage reduction, or only the Shield Upgrade?',
    path: 'combat.unitDamageReduction',
    decision: 'None. Damage equals hits.'
  }),
  Object.freeze({
    n: 5,
    question: 'Exact VP for objective control, per scenario.',
    path: 'scoring.objectiveControlVp',
    decision: 'One, unless the scenario says otherwise.'
  }),
  Object.freeze({
    n: 6,
    question: "Full terrain catalogue and each type's movement and accuracy effect.",
    path: 'terrain',
    decision: 'Four kinds covering everything the sources describe, plus a spare.'
  }),
  Object.freeze({
    n: 7,
    question: 'Whether Tactics draw is 3 per Phase or only after the first.',
    path: 'tactics.drawPerPhase',
    decision: 'RESOLVED (rulebook 2026-10-30): three at the start, three more at the end of every Phase but the last.'
  })
]);

/**
 * Additional judgement calls that are not on the reconstruction's numbered
 * list but are still ours rather than the publisher's. Kept alongside the
 * numbered questions so that an October rulebook pass has one checklist.
 */
export const HOUSE_DECISIONS = Object.freeze([
  Object.freeze({
    path: 'timeline.overflow',
    decision: 'A token pushed past round 10 wraps into the next Phase.'
  }),
  Object.freeze({
    path: 'timeline.alternateWithinRound',
    decision: 'Sides alternate for the whole round, not only its first activation.'
  }),
  Object.freeze({
    path: 'movement.engagementCost',
    decision: 'Engagement is a one-hex penalty, not a one-hex discount.'
  }),
  Object.freeze({
    path: 'movement.enemyGarrisonBlocks',
    decision: 'An enemy Garrison blocks movement the way an enemy unit does.'
  }),
  Object.freeze({
    path: 'movement.noEndOnStartHex',
    decision: 'A movement action may not finish where it started.'
  }),
  Object.freeze({
    path: 'movement.engagementFromEnemyGarrison',
    decision: 'An enemy Garrison projects engagement the way an enemy unit does.'
  }),
  Object.freeze({
    path: 'tactics.lockoutAfterDefensivePlay',
    decision: 'RESOLVED (rulebook 2026-10-30): no such rule; the lockout is off.'
  }),
  Object.freeze({
    path: 'combat.losBlockers',
    decision: 'Enemy units, garrisons and objectives block line of sight; friendly units do not.'
  }),
  Object.freeze({
    path: 'combat.elevationAccuracyPerLevel',
    decision: 'Elevation shifts accuracy one pip per level, favouring the higher shooter.'
  }),
  Object.freeze({
    path: 'combat.maxAccuracyShift',
    decision: 'Accuracy modifiers are capped at plus or minus five. No source suggests a cap.'
  }),
  Object.freeze({
    path: 'statuses.fractureThreshold',
    decision: 'Fracture fires at three damage, per the community glossary.'
  }),
  Object.freeze({
    path: 'statuses.fractureBonus',
    decision: 'Fracture adds three damage, per the community glossary.'
  }),
  Object.freeze({
    path: 'upgrades.shieldAbsorb',
    decision: 'The Shield upgrade absorbs one point, refreshed when its holder activates.'
  }),
  Object.freeze({
    path: 'actions.maxEnergy',
    decision: 'Energy has no cap. No source mentions one.'
  }),
  Object.freeze({
    path: 'actions.forcedPassTlCost',
    decision: 'INVENTED. A unit with no available Primary may pass, pushing its token 2 anyway. ' +
      'Nothing in any source covers this; without it the Timeline deadlocks. See docs/open-rules.md.'
  })
]);

/**
 * Build a rules object: the defaults with `overrides` merged in, deeply, for
 * plain objects. Arrays and scalars replace rather than merge.
 *
 * Neither DEFAULTS nor `overrides` is modified.
 *
 * @param {Object} [overrides]
 * @returns {Object}
 */
export function createRules(overrides) {
  return merge(DEFAULTS, overrides || {});
}

/**
 * Read a dotted path out of a rules object. Returns `undefined` if any step is
 * missing, which is exactly what the open-questions test looks for.
 * @param {Object} rules
 * @param {string} path
 * @returns {*}
 */
export function valueAt(rules, path) {
  const steps = path.split('.');
  let node = rules;
  for (let i = 0; i < steps.length; i++) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[steps[i]];
  }
  return node;
}

/**
 * Terrain definition for a kind id, or `undefined` if the id is unknown.
 * @param {Object} rules
 * @param {string} kind
 * @returns {TerrainKind|undefined}
 */
export function terrain(rules, kind) {
  return rules.terrain[kind];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function merge(base, patch) {
  const out = {};
  const keys = Object.keys(base);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    out[k] = isPlainObject(base[k]) ? merge(base[k], {}) : copy(base[k]);
  }
  const patchKeys = Object.keys(patch);
  for (let i = 0; i < patchKeys.length; i++) {
    const k = patchKeys[i];
    if (isPlainObject(base[k]) && isPlainObject(patch[k])) out[k] = merge(base[k], patch[k]);
    else out[k] = copy(patch[k]);
  }
  return out;
}

function copy(value) {
  if (Array.isArray(value)) return value.map(copy);
  if (isPlainObject(value)) return merge(value, {});
  return value;
}
