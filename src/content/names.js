/**
 * Every name a player reads.
 *
 * The engine knows units, actions, terrain, statuses and upgrades only by
 * internal id and never imports this file; the interface looks names up here.
 * That is the whole of the renaming story: change this file and the game is
 * renamed, with no other edit anywhere.
 *
 * Nothing here may be a name from any other game. See `NOTICE.md`.
 */

/** The roster. Ids are this project's own numbering. */
export const UNITS = Object.freeze({
  u01: 'Vanguard Titan',
  u02: 'Comet Raider',
  u03: 'Radiant Apogee',
  u04: 'Zealot Lance',
  u05: 'Bloodhound Relic',
  u06: 'Aegis Paragon'
});

/** What each unit is for, in one phrase. Shown on the unit card. */
export const ROLES = Object.freeze({
  u01: 'Objective runner',
  u02: 'Skirmisher',
  u03: 'Glass cannon',
  u04: 'Debuff bruiser',
  u05: 'Berserker',
  u06: 'Zone controller'
});

/**
 * Weapons, by the positional ids in `src/content/units.js`. `a` is each unit's
 * cheap short-ranged weapon, `b` its heavy one.
 */
export const WEAPONS = Object.freeze({
  u01a: 'Rivet gun',          u01b: 'Grapple harpoon',
  u02a: 'Dart pod',           u02b: 'Beam glaive',
  u03a: 'Scatter emitter',    u03b: 'Dorsal beam cannon',
  u04a: 'Wrist hook',         u04b: 'Barbed lance',
  u05a: 'Scrap pistol',       u05b: 'Wrecking claw',
  u06a: 'Pepperbox gun',      u06b: 'Suppression mortar'
});

/** Actions, by action id. */
export const ACTIONS = Object.freeze({
  advance: 'Advance',
  dash: 'Dash',
  energize: 'Energize',
  rescue: 'Rescue',
  deploy: 'Deploy',
  attack: 'Attack',
  end_activation: 'End turn'
});

/** One line explaining each action, for a tooltip or a prompt. */
export const ACTION_HINTS = Object.freeze({
  advance: 'Move up to three hexes. Free.',
  dash: 'Move two more hexes, before or after Advancing.',
  energize: 'Bank one Energy token.',
  rescue: 'Claim an adjacent friendly garrison.',
  deploy: 'Bring this machine onto the board at your base. It must then move off the base.',
  attack: 'Fire a weapon at a target in range.',
  end_activation: 'Finish this unit\'s turn.'
});

/** Terrain kinds, by the ids used in `rules.terrain`. */
export const TERRAIN = Object.freeze({
  open: 'Open ground',
  rough: 'Broken ground',
  water: 'Shallows',
  blocked: 'Impassable'
});

/** Statuses, by status id. Every id in `rules.statuses.known` needs one. */
export const STATUSES = Object.freeze({
  slow: 'Mired',
  fracture: 'Fractured',
  disarm: 'Jammed',
  blinded: 'Blinded'
});

/** Board upgrades, by upgrade id. Every id in `rules.upgrades.known` needs one. */
export const UPGRADES = Object.freeze({
  shield: 'Barrier core',
  speed: 'Thruster core',
  strength: 'Payload core',
  accuracy: 'Targeting core'
});

/** The two sides. Board-side colours, not factions. */
export const SIDES = Object.freeze(['Crimson', 'Azure']);

/**
 * Scenario briefings, by scenario id.
 *
 * Prose rather than names, but it lives here for the same reason everything
 * else does: it is text a player reads, so it must be renameable in one place
 * and must never leak a name from anywhere else. The `goals` lists are written
 * from the scoring rules the engine actually applies -- if `rules.scoring`
 * changes, these sentences are wrong and nothing will tell you.
 */
export const SCENARIOS = Object.freeze({
  skirmish: Object.freeze({
    title: 'Contested Crossing',
    situation:
      'A supply basin with a raised spine of high ground across the middle, ' +
      'shallow streams on both flanks and wreckage breaking up the firing ' +
      'lanes. Each side has two garrisons stranded on its flanks, and three ' +
      'objective markers lie between the lines. Neither force is big enough to ' +
      'hold everything.',
    goals: Object.freeze([
      'Destroy an enemy machine to score the victory points printed on its card. The bigger the threat, the bigger the bounty.',
      'Rescue your own garrison by ending a Primary Action next to it. Destroy the enemy\'s by landing a single point of damage on it.',
      'Your machines start off the board and deploy from your base on their first turn. A destroyed machine goes back to reserve, is repaired, and deploys again two rounds later.',
      'End a machine\'s turn on or next to an objective to contest it: with more of your machines there than theirs, a neutral objective becomes yours and one of theirs goes neutral. Control lasts until they win it back, and each objective you hold pays its points at the end of every Phase.'
    ]),
    victory:
      'Two Phases of ten rounds each. Most victory points at the end wins.',
    warning:
      'Your Timeline token moves every time you take a Primary Action, and the ' +
      'heavier the action the longer until you act again. Fighting is not free.'
  })
});

/**
 * What every keyword actually does, for the hover glossary.
 *
 * These are DESCRIPTIONS of rules the engine enforces elsewhere, which makes
 * them the same hazard as generated ability text: the engine can change and
 * leave a sentence here quietly lying to the player. Unlike ability text these
 * cannot be generated, because they describe engine behaviour rather than card
 * data -- so a test asserts that every status and upgrade the rules know about
 * has an entry, and the rest is down to reading them when the rule changes.
 *
 * Keyed by the same ids the engine uses, so a tooltip is one lookup with no
 * mapping to keep in step.
 */
export const KEYWORDS = Object.freeze({
  slow: "Prevents this unit's next Advance. Spent when its activation opens, whether or not it wanted to move — standing still does not save it for a better turn.",
  fracture: "The next time this unit takes 3 or more damage, it takes 3 more. Then the status clears.",
  disarm: "This unit's attacks trigger no critical effects, and every die that would have hit is rerolled once, keeping the new face.",
  blinded: "Every die this unit rolls is one worse.",
  shield: "Absorbs 1 damage, then recharges when this unit next activates — so it stops one point per activation, not one per game.",
  speed: "Adds one hex to this unit's Advance.",
  strength: "Adds one die to this unit's attacks.",
  accuracy: "Every die this unit rolls is one better.",
  timeline: "The ten-round track that decides who acts next. Only Primary Actions move your token, and the heavier the action the further it moves — so the more you do, the longer until you act again.",
  primary: "Exactly one per activation, and it is mandatory: Attack, Dash, Energize or Rescue. Everything else in a turn is free.",
  advance: "Move up to three hexes. Free, once per activation, and taken as one unbroken block — once the unit stops and does something else it cannot move again.",
  dash: "Move two more hexes for 2 Timeline. A Primary Action, so a unit that dashes cannot also attack.",
  energize: "Bank one Energy for 2 Timeline. Energy pays for Command abilities.",
  rescue: "Claim a friendly garrison from an adjacent hex for 2 Timeline, scoring its victory points.",
  critical: "A natural 9 or 10. Triggers the weapon's critical effect once per attack, however many are rolled.",
  accuracyStat: "What each die must beat to hit — 4 by default. Modifiers shift the die face, not the target, which is why an unmodified 1 always misses and an unmodified 9 or 10 always hits.",
  strengthStat: "How many dice an attack rolls.",
  engagement: "Next to an enemy machine or garrison on the same level, a machine is engaged: any move it starts goes one hex less, and its attacks must include an enemy it is engaged with.",
  objective: "Contested by a machine that ends its turn on or next to it. More of your machines there than theirs wins: neutral becomes yours, theirs becomes neutral. Control lasts until lost, and pays at the end of each Phase.",
  garrison: "A stranded position. Rescue your own from an adjacent hex; destroy the enemy's by landing a single point of damage. Either scores 2 victory points.",
  command: "Usable at any point during this unit's activation, once each. Free in Timeline, though most cost Energy.",
  ongoing: "Always in force while its condition holds. Never used, never spent.",
  response: "Fires by itself when its trigger happens, whether or not this unit is activating."
});

/**
 * @param {string} id
 * @returns {?string}
 */
export function keywordText(id) {
  return KEYWORDS[id] || null;
}

/** Preset squads, by the ids in `src/content/teams.js`. */
export const TEAMS = Object.freeze({
  t_lance:  'Lance Doctrine',
  t_hammer: 'Hammer Doctrine',
  t_anvil:  'Anvil Doctrine',
  t_spear:  'Spear Doctrine'
});

/** What each team is trying to do, in one line. */
export const TEAM_NOTES = Object.freeze({
  t_lance:  'Reach and burst. Kill something expensive before it ever arrives.',
  t_hammer: 'Everything hits hard up close, and nothing is in a hurry.',
  t_anvil:  'Stand on the objective and make leaving it their problem.',
  t_spear:  'Hits hardest in the roster, and concedes the most when it dies.'
});

/** Interface strings for the pre-game screens. */
export const SETUP = Object.freeze({
  chooseTitle: 'Choose your doctrine',
  chooseHint:
    'Pick a squad. Both sides draw from the same four, so the enemy may well ' +
    'bring the one you just passed over — or the same one back at you.',
  yourSquad: 'Your squad',
  enemySquad: 'They will field',
  confirm: 'Confirm squad',
  mirror: 'Mirror match — they picked the same doctrine.',
  briefTitle: 'Mission briefing',
  goals: 'How points are scored',
  victory: 'Winning',
  deploy: 'Deploy',
  back: 'Back',
  pickMore: 'Pick %n more'
});

/** Interface chrome, so no label is stranded in the UI code. */
export const UI = Object.freeze({
  title: 'Assembly Forge',
  timeline: 'Timeline',
  round: 'Round',
  phase: 'Phase',
  activating: 'Activating',
  actions: 'Actions',
  units: 'Units',
  energy: 'Energy',
  hp: 'HP',
  vp: 'VP',
  gameOver: 'Game over',
  draw: 'Draw',
  newGame: 'New game',
  wins: 'wins',
  notice:
    'An original game. Names, art and wording are this project\'s own; only ' +
    'the underlying rules system is shared with the game that inspired it. ' +
    'See NOTICE.md.',
  placeholder:
    'Milestone scaffold: the board and the clock. Advance, Dash and Energize ' +
    'only. The real interface arrives with the interface milestone.'
});

/**
 * Display name for any id this file knows about.
 * @param {string} id
 * @returns {string} the id itself if nothing is registered, so a missing name
 *          shows up as an obvious placeholder rather than as blank space
 */
export function displayName(id) {
  return UNITS[id] || WEAPONS[id] || ACTIONS[id] || TERRAIN[id] ||
    STATUSES[id] || UPGRADES[id] || id;
}

/**
 * The English for a critical effect, GENERATED from its effect data.
 *
 * Nothing in this project stores a sentence describing what a weapon does.
 * Abilities and crits are structured data and the prose is produced here, at
 * display time, which is what makes it impossible to paste published wording
 * into a unit definition -- there is no field to paste it into.
 *
 * It also means this function must stay in step with what the engine actually
 * resolves. That failure is silent: the engine happily enforces something this
 * function never learned to say, and the player sees a weapon that appears to
 * do nothing. A test renders every crit in the roster and fails on empty
 * output, so the gap cannot ship unnoticed.
 *
 * @param {?Object} crit
 * @returns {string} '' when there is genuinely no effect
 */
export function critText(crit) {
  if (!crit) return '';
  const parts = [];
  if (crit.damage) parts.push('+' + crit.damage + ' damage');
  if (crit.dice) parts.push('roll ' + crit.dice + ' more ' + (crit.dice === 1 ? 'die' : 'dice'));
  if (crit.status) parts.push(STATUSES[crit.status] || crit.status);
  if (!parts.length) return '';
  const joined = parts.length === 1
    ? parts[0]
    : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  return joined.charAt(0).toUpperCase() + joined.slice(1) + '.';
}

/**
 * A weapon's stat line as one readable string.
 * @param {Object} w
 * @returns {string}
 */
export function weaponLine(w) {
  return displayName(w.wid) + ' — ' + w.tlCost + ' TL, range ' + w.range +
    ', ' + w.strength + ' dice' + (w.ignoreLos ? ', ignores line of sight' : '');
}

/**
 * Label for an action from `legalActions`.
 * @param {Object} action
 * @returns {string}
 */
export function actionLabel(action) {
  const base = ACTIONS[action.type] || action.type;
  if (action.to) return base + ' to ' + action.to.q + ', ' + action.to.r;
  return base;
}

/**
 * @param {0|1} side
 * @returns {string}
 */
export function sideName(side) {
  return SIDES[side];
}
