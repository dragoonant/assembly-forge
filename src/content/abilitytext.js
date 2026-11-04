/**
 * English, generated from ability data.
 *
 * No ability description is stored anywhere in this project. Every sentence a
 * player reads about what an ability does is produced here, from the same
 * `{timing, energy, when, target, effects}` structure the engine resolves.
 * That is what makes it impossible to paste published wording into a unit
 * definition: there is no field to paste it into.
 *
 * THE RULE THIS FILE LIVES UNDER. Every describer below has a counterpart in
 * `src/engine/effects.js`, and the two must stay in step. The failure when
 * they drift is SILENT and it points one way: the engine enforces something
 * this file never learned to say, so the player reads an ability that seems
 * unconditional, or weaker than it is, or -- worst -- a sentence with a hole
 * where a clause should be. In the sibling project that exact drift produced
 * four separate user-visible bugs: nine unspoken target filters, six unspoken
 * modifier fields, six unspoken conditions, and a keyword described as always
 * applying when it applied in one branch only.
 *
 * `tests/content-suite.js` renders every ability in the roster and fails on
 * empty output, a doubled space, or a lowercase sentence start. If you add an
 * effect kind or a condition key to the engine, add it here in the same commit
 * or that test will tell you off.
 */

import { STATUSES, WEAPONS, displayName } from './names.js';
import { activePack } from './packs.js';

/** Ability names, by the ids in `src/content/units.js`. */
export const ABILITIES = Object.freeze({
  u01c: 'Haul Clear',       u01r: 'Salvage Rights',
  u02c: 'Fine Tuning',      u02r: 'Passing Blow',
  u03c: 'Overcharge',       u03o: 'Spotter Link',
  u04c: 'Mire',             u04o: 'In Close',
  u05c: 'Second Swing',     u05o1: 'Running Hot', u05o2: 'Redline',
  u06c: 'Jamming Field',    u06o: 'Dug In'
});

/**
 * Tactics card names, by the ids in `src/content/tactics.js`. A card is an
 * ability that lives in a hand, so it is described by the same generator.
 */
export const TACTICS = Object.freeze({
  t01: 'Load Bearing',      t02: 'Range Finding',   t03: 'Burn Reserve',
  t04: 'Power Siphon',      t05: 'Field Repair',    t06: 'Fouling Charge',
  t07: 'Opportunist',       t08: 'Sensor Flood',    t09: 'Hold Fast',
  t10: 'Follow Through',    t11: 'Fire For Effect', t12: 'Relief Column',
  t13: 'Slipstream',        t14: 'Lock Down'
});

/**
 * @param {string} cid
 * @returns {string}
 */
export function tacticsName(cid) {
  return TACTICS[cid] || cid;
}

/** How each timing is labelled. */
export const TIMINGS = Object.freeze({
  command: 'Command',
  ongoing: 'Ongoing',
  response: 'Response'
});

/** What each response event is called, in the second person. */
const EVENTS = Object.freeze({
  rescue: 'after this unit rescues a garrison',
  destroy: 'after this unit destroys a target',
  damaged: 'after this unit takes damage',
  dash: 'after this unit dashes'
});

/**
 * One effect, as a phrase with no leading capital and no full stop.
 *
 * Throws on an unknown kind rather than returning an empty string. A silent
 * blank here is precisely the hole in a sentence this file exists to prevent,
 * and it would be invisible until someone read the card.
 *
 * @param {Object} e
 * @returns {string}
 */
export function effectPhrase(e, timing) {
  // "this activation" is true of a Command ability or a Tactics card, which
  // grant a modifier that expires with the turn. It is NOT true of an Ongoing
  // ability, which is continuously in force for as long as its condition
  // holds -- saying otherwise tells the player the buff is about to lapse when
  // it never does. The engine has always modelled these differently; only the
  // sentence conflated them.
  const scope = timing === 'ongoing' ? '' : ' this activation';

  switch (e.k) {
    case 'strength':    return signed(e.n) + ' strength' + scope;
    case 'accuracy':    return signed(e.n) + ' accuracy' + scope;
    case 'move':        return 'move ' + e.n;
    case 'energy':      return 'gain ' + e.n + ' Energy';
    case 'heal':        return 'repair ' + e.n + ' damage';
    case 'damage':      return 'deal ' + e.n + ' damage';
    case 'status':      return 'apply ' + (STATUSES[e.s] || e.s);
    case 'push':        return 'push the target ' + e.n + (e.n === 1 ? ' hex' : ' hexes');
    case 'pull':        return 'pull the target ' + e.n + (e.n === 1 ? ' hex' : ' hexes');
    case 'extraAttack':
      return 'make ' + (e.n === 1 ? 'an additional attack' : e.n + ' additional attacks') +
        ' at no Timeline cost';
    default:
      throw new Error('No description for effect kind "' + e.k +
        '". Add one here in the same commit as the engine change.');
  }
}

/**
 * A condition, as a clause beginning "while" or "if".
 *
 * Unspoken conditions were the single largest source of the drift bug in the
 * sibling project, so an unrecognised key throws rather than being skipped.
 *
 * @param {?Object} when
 * @returns {string} '' when genuinely unconditional
 */
export function conditionPhrase(when) {
  if (!when) return '';
  const parts = [];
  const keys = Object.keys(when);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k === 'damageTaken') {
      parts.push('this unit has taken ' + when.damageTaken + ' or more damage');
    } else if (k === 'objectives') {
      parts.push('you control ' + when.objectives + ' or more objectives');
    } else if (k === 'upgrades') {
      parts.push('this unit holds ' + when.upgrades + ' or more upgrades');
    } else if (k === 'alliesInRange') {
      parts.push('an ally is within ' + when.alliesInRange.range + ' hexes');
    } else if (k === 'enemyAdjacent') {
      parts.push(when.enemyAdjacent ? 'an enemy is adjacent' : 'no enemy is adjacent');
    } else {
      throw new Error('No description for condition "' + k +
        '". Add one here in the same commit as the engine change.');
    }
  }
  return join(parts);
}

/**
 * Who an ability is used on.
 * @param {Object} a
 * @returns {string}
 */
export function targetPhrase(a) {
  if (!a.target || a.target === 'self') return '';
  if (a.target === 'adjacentEnemy') return 'an adjacent enemy';
  if (a.target === 'enemyInRange') {
    return 'an enemy within ' + (a.range === undefined ? 1 : a.range) + ' hexes';
  }
  throw new Error('No description for target "' + a.target + '".');
}

/**
 * The whole ability, as one sentence.
 *
 * @param {Object} a
 * @returns {string}
 */
export function abilityText(a) {
  const effects = a.effects.map(function (e) { return effectPhrase(e, a.timing); });
  let body = join(effects);

  const target = targetPhrase(a);
  if (target) body = body + ' to ' + target;

  const clauses = [];
  if (a.timing === 'response' && a.on) clauses.push(EVENTS[a.on] || 'when triggered');
  const cond = conditionPhrase(a.when);
  if (cond) clauses.push(a.timing === 'ongoing' ? 'while ' + cond : 'if ' + cond);

  let sentence = clauses.length ? capitalise(join(clauses)) + ', ' + body : capitalise(body);
  return sentence.replace(/\s+/g, ' ').trim() + '.';
}

/**
 * The cost line: timing, and Energy if it takes any.
 * @param {Object} a
 * @returns {string}
 */
export function abilityCost(a) {
  const timing = TIMINGS[a.timing] || a.timing;
  if (!a.energy) return timing;
  return timing + ' · ' + a.energy + ' Energy';
}

/**
 * @param {string} aid
 * @returns {string}
 */
export function abilityName(aid) {
  const pack = activePack();
  return (pack && pack.names[aid]) || ABILITIES[aid] || aid;
}

// --- Small helpers -----------------------------------------------------------

function signed(n) { return (n >= 0 ? '+' : '') + n; }

function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/**
 * Join a list into readable prose: "a", "a and b", "a, b and c".
 * @param {string[]} parts
 * @returns {string}
 */
function join(parts) {
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

export { WEAPONS, displayName };
