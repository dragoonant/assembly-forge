/**
 * Game state: the shape, how one is built, and the small queries everything
 * else asks of it.
 *
 * State is a plain data tree -- no functions, no class instances, no Maps --
 * so `structuredClone` copies it whole. `apply` clones and mutates the copy;
 * the state handed in is never touched. Every reference between parts of the
 * tree is by id (`uid`, `gid`, `oid`, hex key) rather than by object, so a
 * clone stays internally consistent for free.
 *
 * The seeded generator's position lives at `state.rng`, so a state carries
 * its own future: clone it, replay the same actions, get the same game.
 *
 * The engine never imports the content layer. Units arrive as plain stat
 * lines; display names live in `src/content/names.js` and are the UI's problem.
 */

import * as Hex from './hex.js';
import * as Rng from './rng.js';
import * as Rules from './rules.js';
import * as Timeline from './timeline.js';

/** @typedef {0|1} Side */

/**
 * @typedef {Object} Unit
 * @property {string} uid       instance id, unique within the match
 * @property {string} defId     which unit definition this is an instance of
 * @property {Side} side
 * @property {{q: number, r: number}} hex
 * @property {number} hp
 * @property {number} maxHp
 * @property {number} tl        starting Timeline round, from the unit card
 * @property {number} vp        bounty for destroying it
 * @property {number} energy
 * @property {string[]} statuses
 * @property {string[]} upgrades
 * @property {boolean} alive     on the battlefield. A unit off the board is not alive in this sense.
 * @property {boolean} inReserve off the board and waiting to deploy from a Base: every unit at the
 *           start of a game that has Bases, and every unit defeated since (rulebook 2026-10-30,
 *           "Deploying your Units"). `hex` is null while in Reserve.
 */

/**
 * @typedef {Object} Activation
 * @property {string} uid
 * @property {Side} side
 * @property {{advance: boolean, primary: ?string, command: boolean, tactics: boolean}} slots
 *           The A/B/C/D record. `primary` holds the id of the Primary Action
 *           taken, because exactly one is allowed and it is mandatory.
 * @property {boolean} moved            has any movement been taken this activation
 * @property {boolean} movementClosed   has the movement block been shut by a
 *           non-movement action -- movement is one block, so once it is closed
 *           neither Advance nor Dash may move this unit again
 * @property {{q: number, r: number}} startHex where the activation began
 * @property {boolean} tacticsLocked    locked out by a defensive card last turn
 */

/** Both sides, for iteration. */
export const SIDES = Object.freeze([0, 1]);

/**
 * @param {Side} side
 * @returns {Side}
 */
export function opponent(side) {
  return side === 0 ? 1 : 0;
}

/**
 * A deep copy. `apply` uses this and then mutates the copy, which is how the
 * engine gets value semantics without writing a bespoke cloner per sub-tree.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function clone(value) {
  return structuredClone(value);
}

// --- Boards ------------------------------------------------------------------

/**
 * Build a board.
 *
 * A board is a map from hex key to `{q, r, terrain, elevation}`. Membership in
 * that map *is* the playable area: a hex that is not in it is off the board.
 *
 * @param {Object} spec
 * @param {number} [spec.cols] rectangular map width, in offset columns
 * @param {number} [spec.rows] rectangular map height, in offset rows
 * @param {boolean} [spec.shortRows] drop the last hex of every odd row, so odd
 *        rows sit inset half a hex at both ends. This is the shape of the
 *        retail starter board: 14 columns by 15 rows, alternating 14 and 13,
 *        203 hexes in all (measured 2026-11-03; see PLAN.md D6).
 * @param {number} [spec.radius] hex-shaped map radius, as an alternative to cols/rows
 * @param {string} [spec.terrain] default terrain kind, defaults to 'open'
 * @param {Object<string, {terrain?: string, elevation?: number}>} [spec.hexes]
 *        per-hex overrides, keyed by axial key ("2,-1")
 * @returns {{hexes: Object, shape: Object}}
 */
export function createBoard(spec) {
  const defaultTerrain = spec.terrain || 'open';
  const hexes = {};

  if (typeof spec.radius === 'number') {
    const all = Hex.range({ q: 0, r: 0 }, spec.radius);
    for (let i = 0; i < all.length; i++) {
      hexes[Hex.key(all[i])] = {
        q: all[i].q, r: all[i].r, terrain: defaultTerrain, elevation: 0
      };
    }
  } else {
    const cols = spec.cols === undefined ? 8 : spec.cols;
    const rows = spec.rows === undefined ? 8 : spec.rows;
    for (let row = 0; row < rows; row++) {
      const rowCols = spec.shortRows && (row & 1) ? cols - 1 : cols;
      for (let col = 0; col < rowCols; col++) {
        const h = Hex.fromOffset(col, row);
        hexes[Hex.key(h)] = { q: h.q, r: h.r, terrain: defaultTerrain, elevation: 0 };
      }
    }
  }

  const overrides = spec.hexes || {};
  const keys = Object.keys(overrides);
  for (let i = 0; i < keys.length; i++) {
    const cell = hexes[keys[i]];
    if (!cell) throw new Error('Terrain given for a hex that is not on the board: ' + keys[i]);
    if (overrides[keys[i]].terrain !== undefined) cell.terrain = overrides[keys[i]].terrain;
    if (overrides[keys[i]].elevation !== undefined) cell.elevation = overrides[keys[i]].elevation;
  }

  return {
    hexes: hexes,
    shape: {
      radius: spec.radius === undefined ? null : spec.radius,
      cols: spec.cols === undefined ? null : spec.cols,
      rows: spec.rows === undefined ? null : spec.rows,
      shortRows: Boolean(spec.shortRows)
    }
  };
}

/**
 * The board cell at a hex, or null if that hex is off the board.
 * @param {Object} state
 * @param {{q: number, r: number}} h
 * @returns {?Object}
 */
export function cellAt(state, h) {
  const cell = state.board.hexes[Hex.key(h)];
  return cell || null;
}

/**
 * @param {Object} state
 * @param {{q: number, r: number}} h
 * @returns {boolean}
 */
export function onBoard(state, h) {
  return Boolean(state.board.hexes[Hex.key(h)]);
}

/**
 * @param {Object} state
 * @param {{q: number, r: number}} h
 * @returns {number}
 */
export function elevationAt(state, h) {
  const cell = cellAt(state, h);
  return cell ? cell.elevation : 0;
}

/**
 * @param {Object} state
 * @param {{q: number, r: number}} h
 * @returns {?Object} the terrain definition from the rules
 */
export function terrainAt(state, h) {
  const cell = cellAt(state, h);
  return cell ? Rules.terrain(state.rules, cell.terrain) : null;
}

// --- Occupancy ---------------------------------------------------------------

/**
 * Does a unit Hover? Hover ignores terrain and elevation penalties while moving and may cross
 * impassable terrain (rulebook 2026-10-30, "Hover"). Carried as a trait.
 * @param {Object} u
 * @returns {boolean}
 */
export function hasHover(u) {
  return Boolean(u.traits && u.traits.indexOf('hover') !== -1);
}

/**
 * How many of an Upgrade a unit holds. Upgrades stack: each Speed adds a hex, each Strength a die,
 * each Shield prevents a point (rulebook 2026-10-30, "Upgrades").
 * @param {Object} u
 * @param {string} kind
 * @returns {number}
 */
export function upgradeCount(u, kind) {
  let n = 0;
  for (let i = 0; i < u.upgrades.length; i++) if (u.upgrades[i] === kind) n++;
  return n;
}

/**
 * The map pickup on a hex, or null: an Upgrade or an Energy token waiting to be collected.
 * @param {Object} state
 * @param {?{q: number, r: number}} h
 * @returns {?Object}
 */
export function pickupAt(state, h) {
  if (!h) return null;
  const list = state.pickups || [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].hex.q === h.q && list[i].hex.r === h.r) return list[i];
  }
  return null;
}

/**
 * The Base on a hex, or null. Bases are structures: no unit may end a move on one, and an enemy
 * Base blocks movement and line of sight (rulebook 2026-10-30, "Moving", "Line of Sight").
 * @param {Object} state
 * @param {?{q: number, r: number}} h
 * @returns {?Object}
 */
export function baseAt(state, h) {
  if (!h) return null;
  const bases = state.bases || [];
  for (let i = 0; i < bases.length; i++) {
    if (bases[i].hex.q === h.q && bases[i].hex.r === h.r) return bases[i];
  }
  return null;
}

/**
 * A side's Bases, in declaration order.
 * @param {Object} state
 * @param {Side} side
 * @returns {Object[]}
 */
export function basesOf(state, side) {
  return (state.bases || []).filter(function (b) { return b.side === side; });
}

/**
 * The living unit standing on a hex, or null.
 * @param {Object} state
 * @param {{q: number, r: number}} h
 * @returns {?Unit}
 */
export function unitAt(state, h) {
  for (let i = 0; i < state.unitOrder.length; i++) {
    const u = state.units[state.unitOrder[i]];
    if (u.alive && u.hex.q === h.q && u.hex.r === h.r) return u;
  }
  return null;
}

/**
 * The standing garrison on a hex, or null.
 * @param {Object} state
 * @param {{q: number, r: number}} h
 * @returns {?Object}
 */
export function garrisonAt(state, h) {
  for (let i = 0; i < state.garrisonOrder.length; i++) {
    const g = state.garrisons[state.garrisonOrder[i]];
    if (g.alive && g.hex.q === h.q && g.hex.r === h.r) return g;
  }
  return null;
}

/**
 * The objective marker on a hex, or null.
 * @param {Object} state
 * @param {{q: number, r: number}} h
 * @returns {?Object}
 */
export function objectiveAt(state, h) {
  for (let i = 0; i < state.objectiveOrder.length; i++) {
    const o = state.objectives[state.objectiveOrder[i]];
    if (o.hex.q === h.q && o.hex.r === h.r) return o;
  }
  return null;
}

/**
 * The enemies a unit of `side` standing on `h` is Engaged with: enemy units and enemy Garrisons on
 * adjacent hexes at the same elevation (rulebook 2026-10-30, "Engagement").
 *
 * @param {Object} state
 * @param {Side} side
 * @param {?{q: number, r: number}} h
 * @returns {Array<{kind: string, id: string}>}
 */
export function engagedWith(state, side, h) {
  const out = [];
  if (!h) return out;
  const m = state.rules.movement;
  const level = elevationAt(state, h);
  const around = Hex.neighbours(h);
  for (let i = 0; i < around.length; i++) {
    if (m.engagementSameElevation && elevationAt(state, around[i]) !== level) continue;
    const u = unitAt(state, around[i]);
    if (u && u.side !== side) out.push({ kind: 'unit', id: u.uid });
    if (m.engagementFromEnemyGarrison) {
      const g = garrisonAt(state, around[i]);
      if (g && g.side !== null && g.side !== side) out.push({ kind: 'garrison', id: g.gid });
    }
  }
  return out;
}

/**
 * Would a unit of `side` standing on `h` be Engaged?
 *
 * @param {Object} state
 * @param {Side} side
 * @param {?{q: number, r: number}} h
 * @returns {boolean}
 */
export function isEngaged(state, side, h) {
  return engagedWith(state, side, h).length > 0;
}

/**
 * @param {Object} state
 * @param {string} uid
 * @returns {Unit}
 */
export function unit(state, uid) {
  const u = state.units[uid];
  if (!u) throw new Error('Unknown unit: ' + uid);
  return u;
}

/**
 * Every living unit of a side, in declaration order.
 * @param {Object} state
 * @param {Side} side
 * @returns {Unit[]}
 */
export function livingUnits(state, side) {
  const out = [];
  for (let i = 0; i < state.unitOrder.length; i++) {
    const u = state.units[state.unitOrder[i]];
    if (u.alive && (side === undefined || u.side === side)) out.push(u);
  }
  return out;
}

// --- Construction ------------------------------------------------------------

/**
 * Build a match.
 *
 * @param {Object} spec
 * @param {string|number} [spec.seed]
 * @param {Object} [spec.rules] overrides merged over the rules defaults
 * @param {Object} spec.board board spec (see `createBoard`) or an already-built board
 * @param {Array<Object>} spec.units `{uid, defId, side, hex, hp, tl, vp}`
 * @param {Array<Object>} [spec.garrisons] `{gid, side, hex}`
 * @param {Array<Object>} [spec.objectives] `{oid, hex, vp}`
 * @param {[string[], string[]]} [spec.setupOrder] each side's chosen stack
 *        order, top first. Stacking rule 1: this is the only moment a player
 *        may order their tokens.
 * @returns {Object} a state sitting on the first unit's activation
 */
export function createGame(spec) {
  const rules = Rules.createRules(spec.rules);
  // A built board carries `shape`; a spec does not. Both have a `hexes` key --
  // one holds cells, the other holds per-hex overrides -- so `hexes` alone
  // cannot tell them apart.
  const board = spec.board && spec.board.shape
    ? clone(spec.board)
    : createBoard(spec.board || {});

  const state = {
    version: 1,
    seed: spec.seed === undefined ? 'game' : spec.seed,
    rng: Rng.seedFrom(spec.seed === undefined ? 'game' : spec.seed),
    rules: rules,
    board: board,

    units: {},
    unitOrder: [],
    garrisons: {},
    garrisonOrder: [],
    objectives: {},
    objectiveOrder: [],
    /**
     * Deployment tiles. Only consulted by the redeployment rule, which is
     * gated on a scenario actually providing one -- see
     * `rules.destruction.redeploy` and open question 2.
     */
    bases: (spec.bases || []).map(function (b) {
      return { bid: b.bid, side: b.side, hex: { q: b.hex.q, r: b.hex.r } };
    }),
    /**
     * Upgrades and Energy tokens on the map. A unit collects one by ENDING a move on its hex, or
     * by deploying onto it; passing through is not enough (rulebook 2026-10-30, "Collecting
     * Upgrades and Energy on the Map").
     */
    pickups: (spec.pickups || []).map(function (p) {
      return { pid: p.pid, kind: p.kind, upgrade: p.upgrade || null, hex: { q: p.hex.q, r: p.hex.r } };
    }),

    players: [emptyPlayer(0), emptyPlayer(1)],

    timeline: Timeline.createTimeline(rules),
    phase: 1,
    round: 1,
    lastActedSide: null,
    lastActedRound: null,
    initiativeSide: null,

    activation: null,
    over: false,
    result: null,
    winner: null,
    log: []
  };

  // Terrain ids have to name something the rules know about, or movement costs
  // silently become NaN three modules away.
  const cellKeys = Object.keys(board.hexes);
  for (let i = 0; i < cellKeys.length; i++) {
    const kind = board.hexes[cellKeys[i]].terrain;
    if (!Rules.terrain(rules, kind)) {
      throw new Error('Unknown terrain kind "' + kind + '" at ' + cellKeys[i]);
    }
  }

  const units = spec.units || [];
  for (let i = 0; i < units.length; i++) addUnit(state, units[i]);

  const garrisons = spec.garrisons || [];
  for (let i = 0; i < garrisons.length; i++) addGarrison(state, garrisons[i]);

  const objectives = spec.objectives || [];
  for (let i = 0; i < objectives.length; i++) addObjective(state, objectives[i]);

  // Tokens go onto the round each unit's card names, in declaration order...
  for (let i = 0; i < state.unitOrder.length; i++) {
    const u = state.units[state.unitOrder[i]];
    Timeline.place(state.timeline, u.side, u.uid, u.tl, rules);
  }
  // ...and then the player's chosen order rearranges the stacks. Setup only.
  if (spec.setupOrder) {
    for (let side = 0; side < 2; side++) {
      if (spec.setupOrder[side]) {
        Timeline.setSetupOrder(state.timeline, /** @type {Side} */ (side), spec.setupOrder[side]);
      }
    }
  }

  // Tactics decks arrive as card DATA, not ids -- the engine never imports the
  // content layer, exactly as it never imports unit definitions. Shuffled with
  // the seeded generator so a game replays identically.
  const decks = spec.tactics || [[], []];
  for (let side = 0; side < 2; side++) {
    const deck = (decks[side] || []).map(clone);
    if (deck.length) {
      const shuffled = Rng.shuffle(state.rng, deck);
      state.rng = shuffled.state;
      state.players[side].tactics.deck = shuffled.value;
      drawTactics(state, /** @type {Side} */ (side), rules.tactics.openingHand);
    }
  }

  const first = Timeline.firstActiveRound(state.timeline, 1);
  state.round = first === null ? 1 : first;

  // Initiative, but only where the rule says it is needed: both players
  // holding a token on the first active round.
  if (first !== null) {
    const stacks = state.timeline.rounds[first - 1].stacks;
    if (stacks[0].length && stacks[1].length) {
      const roll = Timeline.rollInitiative(state.rng, rules);
      state.rng = roll.state;
      state.initiativeSide = roll.value;
      // The next-activation rule picks "the opponent of whoever acted last",
      // so seeding the loser as the last actor makes the winner go first
      // without a second code path.
      state.lastActedSide = opponent(roll.value);
      state.lastActedRound = null;
      state.log.push({ t: 'initiative', side: roll.value, rolls: roll.rolls });
    }
  }

  state.log.push({ t: 'phase', phase: 1 });
  beginNextActivation(state);
  return state;
}

function emptyPlayer(side) {
  return {
    side: side,
    vp: 0,
    /** Set when a Tactics card was played defensively; consumed next activation. */
    tacticsLockout: false,
    /** Garrisons this player has Rescued, for abilities that scale with it. */
    rescued: 0,
    tactics: { deck: [], hand: [], discard: [] }
  };
}

/**
 * Register a unit. Exported so tests and scenarios can build positions
 * directly rather than playing toward them.
 *
 * @param {Object} state
 * @param {Object} spec
 * @returns {Unit}
 */
export function addUnit(state, spec) {
  if (!spec.uid) throw new Error('A unit needs a uid');
  if (state.units[spec.uid]) throw new Error('Duplicate unit uid: ' + spec.uid);
  // A unit with no hex starts in Reserve and deploys from its side's Base on its first activation.
  // Tests and hand-built positions still place units directly by giving a hex.
  const reserve = !spec.hex;
  if (!reserve && !onBoard(state, spec.hex)) {
    throw new Error('Unit ' + spec.uid + ' placed off the board at ' + Hex.key(spec.hex));
  }
  if (!reserve && unitAt(state, spec.hex)) {
    throw new Error('Two units on ' + Hex.key(spec.hex) + '; one unit per hex');
  }
  const maxHp = spec.hp === undefined ? 10 : spec.hp;
  const u = {
    uid: spec.uid,
    defId: spec.defId === undefined ? spec.uid : spec.defId,
    side: spec.side,
    hex: reserve ? null : { q: spec.hex.q, r: spec.hex.r },
    hp: maxHp,
    maxHp: maxHp,
    tl: spec.tl === undefined ? 1 : spec.tl,
    vp: spec.vp === undefined ? 0 : spec.vp,
    energy: spec.energy === undefined ? 0 : spec.energy,
    statuses: [],
    upgrades: spec.upgrades ? spec.upgrades.slice() : [],
    // Every unit carries the same weapon shape: a cheap short-ranged one and
    // an expensive heavy one. Copied rather than referenced, because a unit's
    // weapons can be modified in play and two instances of the same definition
    // must not share an object.
    weapons: (spec.weapons || []).map(function (w) {
      return {
        wid: w.wid,
        tlCost: w.tlCost,
        range: w.range,
        strength: w.strength,
        accuracy: w.accuracy === undefined ? 0 : w.accuracy,
        ignoreLos: Boolean(w.ignoreLos),
        cone: Boolean(w.cone),
        crit: w.crit === undefined ? null : clone(w.crit),
        effect: w.effect === undefined ? null : clone(w.effect),
        // timed weapon effects, an area pattern, and a per-ally strength bonus (card mechanics; see attack.js)
        effects: w.effects ? clone(w.effects) : [],
        area: w.area ? clone(w.area) : null,
        strengthPerAlly: w.strengthPerAlly ? clone(w.strengthPerAlly) : null
      };
    }),
    abilities: (spec.abilities || []).map(function (a) { return clone(a); }),
    traits: (spec.traits || []).slice(),
    /** The Shield upgrade's charge, spent on damage and refreshed on activation. */
    shieldSpent: false,
    alive: !reserve,
    inReserve: reserve
  };
  if (u.tl < 1) throw new Error('Unit ' + u.uid + ' has a starting Timeline below 1');
  state.units[u.uid] = u;
  state.unitOrder.push(u.uid);
  return u;
}

/**
 * @param {Object} state
 * @param {Object} spec `{gid, side, hex}`; `side: null` means neutral
 * @returns {Object}
 */
export function addGarrison(state, spec) {
  if (!spec.gid) throw new Error('A garrison needs a gid');
  if (state.garrisons[spec.gid]) throw new Error('Duplicate garrison gid: ' + spec.gid);
  if (!onBoard(state, spec.hex)) {
    throw new Error('Garrison ' + spec.gid + ' placed off the board at ' + Hex.key(spec.hex));
  }
  const g = {
    gid: spec.gid,
    side: spec.side === undefined ? null : spec.side,
    hex: { q: spec.hex.q, r: spec.hex.r },
    alive: true
  };
  state.garrisons[g.gid] = g;
  state.garrisonOrder.push(g.gid);
  return g;
}

/**
 * @param {Object} state
 * @param {Object} spec `{oid, hex, vp}`
 * @returns {Object}
 */
export function addObjective(state, spec) {
  if (!spec.oid) throw new Error('An objective needs an oid');
  if (state.objectives[spec.oid]) throw new Error('Duplicate objective oid: ' + spec.oid);
  if (!onBoard(state, spec.hex)) {
    throw new Error('Objective ' + spec.oid + ' placed off the board at ' + Hex.key(spec.hex));
  }
  const o = {
    oid: spec.oid,
    hex: { q: spec.hex.q, r: spec.hex.r },
    vp: spec.vp === undefined ? state.rules.scoring.objectiveControlVp : spec.vp,
    controlledBy: null
  };
  state.objectives[o.oid] = o;
  state.objectiveOrder.push(o.oid);
  return o;
}

/**
 * Move cards from a player's deck to their hand.
 *
 * An empty deck simply yields fewer cards. Nine cards over three Phases is
 * three draws of three, so running dry is the expected end state rather than
 * an error.
 *
 * @param {Object} state
 * @param {Side} side
 * @param {number} n
 * @returns {number} how many were actually drawn
 */
export function drawTactics(state, side, n) {
  const t = state.players[side].tactics;
  let drawn = 0;
  for (let i = 0; i < n && t.deck.length; i++) {
    t.hand.push(t.deck.shift());
    drawn++;
  }
  if (drawn) state.log.push({ t: 'draw', side: side, n: drawn, hand: t.hand.length });
  return drawn;
}

// --- Activation --------------------------------------------------------------

/**
 * Open an activation record for a unit. The A/B/C/D slots start empty and the
 * Tactics lockout, if the player is carrying one, is consumed here.
 *
 * @param {Object} state
 * @param {string} uid
 * @param {Side} side
 * @returns {Activation}
 */
export function beginActivation(state, uid, side) {
  const u = unit(state, uid);
  const locked = state.players[side].tacticsLockout;
  state.players[side].tacticsLockout = false;
  // The Shield upgrade absorbs one point per activation, so its charge comes
  // back here rather than at end of round.
  u.shieldSpent = 0;

  // `slow` is NOT consumed here. The rulebook (2026-10-30, "Slow") spends it on the unit's next
  // Advance, which then moves 0 hexes; Dash and other movement are unaffected. A slowed unit that
  // never Advances keeps the status. `legalActions` offers the 0-hex Advance; see actions.js.
  const slowed = false;
  return {
    uid: uid,
    side: side,
    slots: { advance: false, primary: null, command: false, tactics: false },
    moved: false,
    movementClosed: false,
    startHex: u.hex ? { q: u.hex.q, r: u.hex.r } : null,
    /** Set when the unit deploys from Reserve this activation. */
    deployed: false,
    /** Set when the unit is defeated during its own activation, which then ends at once. */
    defeated: false,
    tacticsLocked: locked,
    slowed: slowed,
    /**
     * Modifiers granted by abilities and Tactics cards for this activation
     * only. Kept here rather than on the unit so they cannot outlive the turn
     * -- "this activation" is the wording on every published card, and a
     * modifier parked on the unit would need clearing from somewhere else.
     */
    mods: { strength: 0, accuracy: 0, move: 0 },
    /** Attacks granted beyond the one Primary Action, at no Timeline cost. */
    extraAttacks: 0,
    /**
     * Additional actions granted by abilities and cards, each taken once and at no Timeline cost (rulebook 2026-10-30,
     * "Additional Actions"): `{kind: 'dash'}`, `{kind: 'move', n, ignoreEngagement}`, `{kind: 'attack', wid}`. A grant
     * may carry `then`, a grant that opens once it is used ("an extra Dash, then an extra attack").
     */
    grants: [],
    /** Bonus strength for one named weapon this activation, by weapon id. */
    weaponMods: {},
    /** Weapon ids this unit has attacked with this activation, in order. */
    attacked: [],
    /** Which players have played a Tactics card during this activation (one each). */
    tacticsBy: {},
    /** Command abilities already used this activation, by id. Once each. */
    commandsUsed: []
  };
}

/**
 * Put the state on the next unit due to act, per the Timeline. Sets
 * `state.activation` to null and stops if there is nothing left on the round.
 *
 * @param {Object} state
 * @returns {boolean} whether an activation was opened
 */
export function beginNextActivation(state) {
  const next = Timeline.nextActivation(state);
  if (!next) {
    state.activation = null;
    return false;
  }
  state.activation = beginActivation(state, next.uid, next.side);
  state.log.push({ t: 'activate', uid: next.uid, side: next.side, round: state.round });
  return true;
}
