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

import { ABILITY_NAMES, STATUSES, TACTICS_NAMES, TRAITS, UPGRADES, WEAPONS, displayName } from './names.js';
import { activePack } from './packs.js';

/** Ability names, by the ids in `src/content/units.js`. */
export const ABILITIES = Object.freeze({
  u01c: 'Haul Clear',       u01r: 'Salvage Rights',
  u02c: 'Fine Tuning',      u02r: 'Passing Blow',
  u03c: 'Overcharge',       u03o: 'Spotter Link',
  u04c: 'Mire',             u04o: 'In Close',
  u05c: 'Second Swing',     u05o1: 'Running Hot', u05o2: 'Redline',
  u06c: 'Jamming Field',    u06o: 'Dug In',
  ...ABILITY_NAMES
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
  t13: 'Slipstream',        t14: 'Lock Down',
  ...TACTICS_NAMES
});

/**
 * @param {string} cid
 * @returns {string}
 */
export function tacticsName(cid) {
  const pack = activePack();
  return (pack && pack.names[cid]) || TACTICS[cid] || cid;
}

/** How each timing is labelled. */
export const TIMINGS = Object.freeze({
  command: 'Command',
  ongoing: 'Ongoing',
  response: 'Response',
  attack: 'Attack'
});

/** When a response card can be played, in the player's terms. */
const WINDOWS = Object.freeze({
  beforeRoll: 'before the attack roll',
  afterRoll: 'after the attack roll',
  afterDamage: 'after the attack deals damage',
  wouldBeDefeated: 'when your unit would be defeated',
  enemyMoved: 'after an enemy ends its movement within range of this unit'
});

/** A granted additional action, as a phrase. */
function grantPhrase(g) {
  let p;
  if (g.kind === 'dash') p = 'make an additional Dash at no Timeline cost';
  else if (g.kind === 'move') p = 'Move ' + g.n + (g.ignoreEngagement ? ', ignoring Engagement' : '');
  else if (g.kind === 'attack') p = 'make an additional ' + displayName(g.wid) + ' attack at no Timeline cost';
  else throw new Error('No description for grant "' + g.kind + '".');
  return g.then ? p + ', then ' + grantPhrase(g.then) : p;
}

/** What each response event is called, in the second person. */
const EVENTS = Object.freeze({
  rescue: 'after this unit rescues a garrison',
  destroy: 'after this unit destroys a target',
  damaged: 'after this unit takes damage',
  dash: 'after this unit dashes',
  moved: 'after this unit ends its movement',
  placed: 'after this is deployed or repositioned'
});

function upgradeName(k) { return UPGRADES[k] || k; }
function traitName(k) { return TRAITS[k] || k; }
function plural(n, one, many) { return n === 1 ? one : many; }

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
    case 'energy':      return (e.ifFullHp ? 'then, if it has full HP, ' : '') + 'gain ' + e.n + ' Energy';
    case 'heal':        return 'repair ' + e.n + ' damage';
    case 'damage':      return e.per === 'upgrades' ? 'deal damage equal to the upgrades on this unit' : 'deal ' + e.n + ' damage';
    case 'status':      return 'apply ' + (STATUSES[e.s] || e.s);
    case 'push':        return 'push the target ' + e.n + (e.n === 1 ? ' hex' : ' hexes');
    case 'pull':        return 'pull the target ' + e.n + (e.n === 1 ? ' hex' : ' hexes');
    case 'extraAttack':
      return 'make ' + (e.n === 1 ? 'an additional attack' : e.n + ' additional attacks') +
        ' at no Timeline cost';
    case 'weaponStrength':
      return signed(e.n) + ' strength to ' + displayName(e.wid) + scope +
        (e.per === 'rescued' ? ' for each garrison you have rescued' : '');
    case 'grant':       return grantPhrase(e.grant);
    case 'upgrade':     return 'gain a ' + (UPGRADES[e.s] || e.s);
    case 'damageSelf':  return 'take ' + e.n + ' damage';
    case 'stripOnAttack':
      return 'destroy ' + e.n + (e.n === 1 ? ' upgrade' : ' upgrades') + ' on each target after the attack roll' + scope;
    case 'critFrom':    return 'attack rolls of ' + e.n + ' or more are critical hits';
    case 'dashBonus':   return 'Dash moves ' + e.n + (e.n === 1 ? ' more hex' : ' more hexes');
    case 'strengthVsStatus': return signed(e.n) + ' strength against a target with a status effect';
    case 'attackStrength':
      if (e.per === 'ownUpgrade') return signed(e.n) + ' strength on this attack for each ' + upgradeName(e.kind) + ' on this unit';
      if (e.per === 'alliesInRange') return signed(e.n) + ' strength on this attack for each other allied unit within ' + e.range + ' hexes';
      if (e.per === 'remotesAdjTarget') return signed(e.n) + ' more strength for each allied remote weapon next to the target';
      return signed(e.n) + ' strength on this attack';
    case 'attackDamage': return signed(e.n) + ' damage on this attack';
    case 'reduceDamage':
      return 'reduce the damage to your unit by ' + e.n +
        (e.perRemote ? ', and ' + e.perRemote + ' more for each allied remote weapon within ' + (e.range || 2) + ' hexes of it' : '');
    case 'stripTargetUpgrade': return 'destroy ' + e.n + (e.n === 1 ? ' upgrade' : ' upgrades') + ' on each target';
    case 'stripAttackerUpgrade': return 'destroy ' + e.n + (e.n === 1 ? ' upgrade' : ' upgrades') + ' on the attacker';
    case 'damageAttackerAndTargets': return 'deal ' + e.n + ' damage to the attacker and to each target';
    case 'surviveDefeat':
      return 'it stays at 1 HP instead' + (e.move ? ', Moves ' + e.move : '') +
        (e.attackWid ? ', then makes a ' + displayName(e.attackWid) + ' attack at no Timeline cost' : '');
    // --- the second wave ---
    case 'speed':       return 'Advance ' + e.n + plural(e.n, ' more hex', ' more hexes') + scope;
    case 'hover':       return timing === 'ongoing' ? 'it has Hover' : 'gain Hover' + scope;
    case 'rescue':      return 'rescue';
    case 'upgradeChoice': return 'gain ' + e.n + plural(e.n, ' upgrade', ' upgrades') + ' of your choice';
    case 'upgradeSpread':
      return 'up to ' + e.n + ' of your ' + (e.trait ? traitName(e.trait) + ' ' : '') +
        'units on the battlefield each gain a different upgrade of your choice';
    case 'transfer':    return 'hand upgrades back and forth, one at a time, between this unit and';
    case 'steal':       return 'take ' + (e.energy || 0) + ' Energy and ' + (e.upgrades || 0) + plural(e.upgrades || 0, ' upgrade', ' upgrades') + ' from';
    case 'destroyUpgrades': return 'destroy ' + (e.n === 'all' ? 'all upgrades' : 'up to ' + e.n + plural(e.n, ' upgrade', ' upgrades')) + ' on';
    case 'statusAll':   return 'apply ' + (STATUSES[e.s] || e.s) + ' to each enemy unit within ' + e.range + ' hexes';
    case 'delayNearRemote': return "each enemy unit next to this unit's remote weapon moves " + e.n + ' Timeline later';
    case 'repositionSelf': return "reposition this unit next to its remote weapon";
    case 'damageBonus': return signed(e.n) + ' damage on its attacks' + scope;
    case 'nextAttackStrength': return signed(e.n) + ' strength on its next attack' + scope;
    case 'remotesStrike':
      return (e.all ? 'each remote weapon on the battlefield' : 'each allied remote weapon') + ' deals ' + e.n + ' damage to an enemy unit next to it';
    case 'repositionAllRemotes': return "reposition every remote weapon on the battlefield, yours and the enemy's, onto empty hexes";
    case 'placeRemote': return 'deploy or reposition its ' + displayName(e.remote) + ' onto';
    case 'moveNow':     return 'move ' + e.n + ' at once';
    case 'rescueMovedAdjacent': return 'then rescue each allied garrison it moved next to';
    case 'damageMovedAdjacent': return 'deal ' + e.n + ' damage to each enemy it moved next to';
    case 'draw':        return 'draw ' + e.n + plural(e.n, ' card', ' cards');
    case 'noEnemyResponses': return "enemies can't use Response abilities or cards while this unit is attacking or being attacked";
    case 'auraReduceDamage': return 'allies next to this take ' + e.n + ' less damage from enemy attacks';
    case 'auraAccuracy': return signed(e.n) + ' accuracy for allies attacking an enemy next to this';
    case 'attackAccuracy': return signed(e.n) + ' accuracy on this attack';
    case 'setCrit':     return 'set ' + e.n + plural(e.n, ' die', ' dice') + ' to a critical';
    case 'rerollMisses':
      return (e.n ? 'reroll up to ' + e.n + ' misses' : 'reroll every miss') +
        (e.drawIf ? ', and draw ' + (e.draw || 1) + ' card if ' + e.drawIf + ' or more were rerolled' : '');
    case 'pushTarget':  return 'push the target ' + e.n + plural(e.n, ' hex', ' hexes');
    case 'delayTargets': return 'each target unit moves ' + e.n + ' Timeline later';
    case 'slowTargetsNearRemote': return "apply " + (STATUSES.slow || 'slow') + " to each target next to this unit's remote weapon";
    case 'energyTo':    return 'that unit gains ' + e.n + ' Energy';
    case 'challenge':
      return 'a unit that is not under attack swaps places with an attacked ally within ' + (e.range || 2) + ' hexes and becomes the target';
    case 'counterAttack':
      return 'that unit attacks the attacker for ' + Math.abs(e.tl || 0) + ' Timeline ' + ((e.tl || 0) < 0 ? 'less than' : 'more than') + " its weapon's cost";
    case 'reactAttack':
      return 'this unit makes a ' + displayName(e.wid) + ' attack against it for ' + (e.tl || 0) + ' Timeline';
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
    } else if (k === 'rescued') {
      parts.push('you have rescued ' + when.rescued + ' or more garrisons');
    } else if (k === 'attackedWith') {
      parts.push('this unit has attacked with ' + displayName(when.attackedWith) + ' this activation');
    } else if (k === 'hasUpgrade') {
      parts.push('this unit holds a ' + upgradeName(when.hasUpgrade));
    } else if (k === 'garrisonsDestroyed') {
      parts.push('you have destroyed ' + when.garrisonsDestroyed + ' or more enemy garrisons');
    } else if (k === 'notMoved') {
      parts.push("this unit hasn't moved this activation");
    } else if (k === 'ownRemoteDeployed') {
      parts.push("this unit's remote weapon is on the battlefield");
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
  const r = a.range === undefined ? 1 : a.range;
  if (a.target === 'enemyInRange') return 'an enemy within ' + r + ' hexes';
  if (a.target === 'allyInRange') return 'another allied unit within ' + r + ' hexes';
  if (a.target === 'unitInRange') return 'another unit within ' + r + ' hexes';
  if (a.target === 'enemyNearOwnRemote') return 'an enemy unit next to an allied remote weapon';
  if (a.target === 'allyGarrisonInRange') return 'an allied garrison within ' + r + ' hexes';
  if (a.target === 'emptyHex') return 'an empty hex within ' + r + ' hexes';
  if (a.target === 'hexNearOwnRemote') return '';
  throw new Error('No description for target "' + a.target + '".');
}

/**
 * The whole ability, as one sentence.
 *
 * @param {Object} a
 * @returns {string}
 */
export function abilityText(a) {
  // An Attack card is a weapon line, generated from its numbers.
  if (a.timing === 'attack' && a.weapon) {
    const w = a.weapon;
    const parts = ['Attack with ' + (displayName(a.cid + 'w') !== a.cid + 'w' ? displayName(a.cid + 'w') : 'a special weapon') +
      ': ' + w.tlCost + ' Timeline, ' + (w.area ? 'an area of ' + w.area.length + ' hexes' : 'range ' + w.range) + ', ' + w.strength + ' dice'];
    if (w.strengthPerAlly) parts.push(signed(w.strengthPerAlly.n) + ' strength for each other ally within ' + w.strengthPerAlly.range + ' hexes');
    for (const e of w.effects || []) parts.push(weaponEffectPhrase(e));
    if (w.crit) parts.push('critical: ' + critPhrase(w.crit));
    return capitalise(join(parts)) + '.';
  }
  const effects = a.effects.map(function (e) { return effectPhrase(e, a.timing); });
  let body = join(effects);

  const target = targetPhrase(a);
  // phrases that end on their object ("take 1 Energy from", "rescue") take the target directly; the rest take "to"
  if (target) body = body + (/( on| from| onto| and|^rescue)$/.test(body) ? ' ' : ' to ') + target;

  const clauses = [];
  if (a.timing === 'response' && a.on) clauses.push(EVENTS[a.on] || 'when triggered');
  if (a.timing === 'response' && a.window === 'enemyMoved') {
    const e = a.effects.find(function (x) { return x.k === 'reactAttack'; });
    clauses.push('after an enemy ends its movement within ' + ((e && e.range) || 3) + ' hexes of this unit');
  } else if (a.timing === 'response' && a.window) {
    clauses.push(WINDOWS[a.window] + whoPhrase(a));
  }
  const cond = conditionPhrase(a.when);
  if (cond) clauses.push(a.timing === 'ongoing' ? 'while ' + cond : 'if ' + cond);
  const attackCond = attackConditionPhrase(a.attackWhen);
  if (attackCond) clauses.push('if ' + attackCond);
  if (a.pickWhen) clauses.push({ lessVp: 'for a defender worth less VP than the attacker', damaged: 'for an ally the attack damaged', counter: 'for a defender that survives and can strike back' }[a.pickWhen]);

  let sentence = clauses.length ? capitalise(join(clauses)) + ', ' + body : capitalise(body);
  sentence = sentence.replace(/\s+/g, ' ').trim() + '.';
  if (a.activeTrait) sentence += ' Only a ' + traitName(a.activeTrait) + ' unit can play this.';
  return sentence;
}

/** Who must be attacking (or attacked) for a response to fire, as a trailing clause. */
function whoPhrase(a) {
  if (a.window === 'wouldBeDefeated') return '';
  if (a.role === 'defender') return ', when your unit is attacked';
  if (a.role !== 'attacker') return '';
  if (a.who === 'self') return ', when this unit attacks';
  if (a.who === 'other') return ', when another allied unit within ' + (a.range || 0) + ' hexes attacks';
  if (a.who === 'any') return ', when this unit or an allied unit within ' + (a.range || 0) + ' hexes attacks';
  return ', when your unit attacks';
}

/**
 * A condition on the attack in progress, as a clause.
 * @param {?Object} c
 * @returns {string}
 */
export function attackConditionPhrase(c) {
  if (!c) return '';
  const parts = [];
  for (const k of Object.keys(c)) {
    if (k === 'attackerNearAlly') parts.push('the attacker is within ' + c[k] + ' hexes of another allied unit');
    else if (k === 'alliesInRange') parts.push('another allied unit is within ' + c[k] + ' hexes');
    else if (k === 'ownUpgrade') parts.push('this unit holds a ' + upgradeName(c[k]));
    else if (k === 'damagedEnemies') parts.push('it damaged ' + c[k] + ' or more enemies');
    else if (k === 'targetNearOwnRemote') parts.push("a target is next to this unit's remote weapon");
    else if (k === 'unitTarget' || k === 'unitTargets') continue;
    else throw new Error('No description for attack condition "' + k + '".');
  }
  return join(parts);
}

/**
 * The weapon's numbers that are not on its stat line, as phrases: strength that grows, effects at a point in the
 * attack. Empty when there are none.
 * @param {Object} w
 * @returns {string[]}
 */
export function weaponExtras(w) {
  const out = [];
  if (w.strengthPerUpgrade) out.push(signed(w.strengthPerUpgrade.n) + ' strength for each ' + upgradeName(w.strengthPerUpgrade.kind) + ' on this unit');
  if (w.strengthPerRemoteAdj) out.push(signed(w.strengthPerRemoteAdj) + ' strength for each allied remote weapon next to the target');
  if (w.strengthPerAlly) out.push(signed(w.strengthPerAlly.n) + ' strength for each other ally within ' + w.strengthPerAlly.range + ' hexes');
  if (w.alsoAdjacent) out.push('also targets each enemy next to the target');
  for (const e of w.effects || []) out.push(weaponEffectPhrase(e));
  return out.map(capitalise);
}

/**
 * A weapon's timed effect, as a phrase.
 * @param {Object} e
 * @returns {string}
 */
export function weaponEffectPhrase(e) {
  const when = { beforeRoll: 'before the roll', afterRoll: 'after the roll', afterDamage: 'after damage' }[e.when] || '';
  switch (e.k) {
    case 'pull': return when + ', pull the target ' + e.n + (e.n === 1 ? ' hex' : ' hexes');
    case 'push': return when + ', push the target ' + e.n + (e.n === 1 ? ' hex' : ' hexes');
    case 'shieldsOff': return when + ", switch off the target's shields";
    case 'captureNear': return when + ', capture an objective the target is on or next to';
    case 'stripUpgrade': return when + ', destroy ' + (e.n || 1) + ' upgrade on the target';
    case 'grantDash': return when + ', make an additional Dash at no Timeline cost';
    case 'approach': return when + ', move ' + (e.n || 1) + ' toward the target, ignoring terrain penalties';
    default: throw new Error('No description for weapon effect "' + e.k + '".');
  }
}

/** A critical effect as a phrase, covering the fields names.js critText does not. */
function critPhrase(c) {
  const parts = [];
  if (c.damage) parts.push('+' + c.damage + ' damage');
  if (c.damagePerCrit) parts.push('+' + c.damagePerCrit + ' damage per critical' + (c.max ? ' (up to +' + c.max + ')' : ''));
  if (c.dice) parts.push('roll ' + c.dice + ' more ' + (c.dice === 1 ? 'die' : 'dice'));
  if (c.status) parts.push((c.afterDamage ? 'after damage, ' : '') + 'apply ' + (STATUSES[c.status] || c.status));
  if (c.damagePerUpgrade) parts.push('+1 damage per ' + (c.damagePerUpgrade === 'any' ? 'upgrade' : upgradeName(c.damagePerUpgrade)) + ' on this unit' + (c.max ? ' (up to +' + c.max + ')' : ''));
  if (c.upgrade) parts.push((c.afterDamage ? 'after damage, ' : '') + 'gain a ' + upgradeName(c.upgrade));
  if (c.damageNearRemote) parts.push('deal ' + c.damageNearRemote + " damage to each enemy next to this unit's remote weapon");
  if (c.move) parts.push('after damage, Move ' + c.move + (c.ignoreEngagement ? ', ignoring Engagement' : ''));
  if (c.repeat) parts.push('after damage, repeat the attack at no Timeline cost (the repeat cannot do this again)');
  return join(parts);
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
