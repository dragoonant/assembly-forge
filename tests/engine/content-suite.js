/**
 * Content suite: the guard against generated text drifting from the engine.
 *
 * The engine can enforce a condition or an effect field that the text
 * generator never learned to say. The player then reads an ability that looks
 * unconditional, or weaker than it is, or a sentence with a hole in it. It
 * fails SILENTLY -- nothing throws, nothing logs, the card just quietly lies
 * -- and in the sibling project it produced four separate user-visible bugs
 * before anyone noticed.
 *
 * So: render every ability, every crit and every weapon line in the roster,
 * and fail on empty output, a doubled space, or a lowercase sentence start.
 * All four of those bugs would have been caught here before a human saw them.
 */

import * as T from './harness.js';

import * as AbilityText from '../../src/content/abilitytext.js';
import * as Effects from '../../src/engine/effects.js';
import * as Names from '../../src/content/names.js';
import * as Rules from '../../src/engine/rules.js';
import * as Units from '../../src/content/units.js';

/**
 * Every rule a generated sentence has to satisfy.
 * @param {string} text
 * @param {string} what
 */
function wellFormed(text, what) {
  T.ok(typeof text === 'string' && text.length > 0, what + ': produced nothing');
  T.ok(text.indexOf('  ') === -1, what + ': doubled space in "' + text + '"');
  T.ok(text.trim() === text, what + ': untrimmed "' + text + '"');
  T.ok(/^[A-Z0-9+]/.test(text), what + ': does not start with a capital — "' + text + '"');
  T.ok(/[.!]$/.test(text), what + ': does not end with a full stop — "' + text + '"');
  T.ok(text.indexOf('undefined') === -1, what + ': leaked undefined — "' + text + '"');
  T.ok(text.indexOf('NaN') === -1, what + ': leaked NaN — "' + text + '"');
}

T.suite('content text', function () {
  T.test('every ability in the roster renders to a well-formed sentence', function () {
    for (let i = 0; i < Units.ROSTER.length; i++) {
      const d = Units.def(Units.ROSTER[i]);
      const list = d.abilities || [];
      T.ok(list.length > 0, d.defId + ' has no abilities at all');
      for (let j = 0; j < list.length; j++) {
        wellFormed(AbilityText.abilityText(list[j]), d.defId + '/' + list[j].aid);
      }
    }
  });

  T.test('every ability has a name, and no two share one', function () {
    const seen = {};
    for (let i = 0; i < Units.ROSTER.length; i++) {
      const d = Units.def(Units.ROSTER[i]);
      const list = d.abilities || [];
      for (let j = 0; j < list.length; j++) {
        const name = AbilityText.abilityName(list[j].aid);
        T.ok(name !== list[j].aid, list[j].aid + ' has no display name');
        T.ok(!seen[name], 'two abilities are both called "' + name + '"');
        seen[name] = true;
      }
    }
  });

  T.test('every ability has a cost line', function () {
    for (let i = 0; i < Units.ROSTER.length; i++) {
      const d = Units.def(Units.ROSTER[i]);
      const list = d.abilities || [];
      for (let j = 0; j < list.length; j++) {
        const cost = AbilityText.abilityCost(list[j]);
        T.ok(cost.length > 0, list[j].aid + ' has no cost line');
        T.ok(cost.indexOf('undefined') === -1, list[j].aid + ': "' + cost + '"');
      }
    }
  });

  T.test('every crit effect renders, and every weapon has a stat line', function () {
    for (let i = 0; i < Units.ROSTER.length; i++) {
      const d = Units.def(Units.ROSTER[i]);
      for (let j = 0; j < d.weapons.length; j++) {
        const w = d.weapons[j];
        T.ok(Names.WEAPONS[w.wid] !== undefined, w.wid + ' has no display name');
        const line = Names.weaponLine(w);
        T.ok(line.indexOf('undefined') === -1, w.wid + ': "' + line + '"');
        if (w.crit) {
          const text = Names.critText(w.crit);
          T.ok(text.length > 0, w.wid + ': crit data with no description');
          T.ok(/^[A-Z+]/.test(text), w.wid + ': crit text not capitalised — "' + text + '"');
        }
      }
    }
  });

  T.test('every effect kind the engine knows can be described', function () {
    // The drift test proper. If someone adds a kind to the engine and not to
    // the describer, this fails here rather than on a card nobody reads.
    const samples = {
      strength: { k: 'strength', n: 1 },
      accuracy: { k: 'accuracy', n: 1 },
      move: { k: 'move', n: 2 },
      energy: { k: 'energy', n: 1 },
      damage: { k: 'damage', n: 1 },
      status: { k: 'status', s: 'slow' },
      heal: { k: 'heal', n: 1 },
      extraAttack: { k: 'extraAttack', n: 1 }
    };
    for (let i = 0; i < Effects.EFFECT_KINDS.length; i++) {
      const kind = Effects.EFFECT_KINDS[i];
      T.ok(samples[kind] !== undefined,
        'effect kind "' + kind + '" has no sample here; add one');
      const phrase = AbilityText.effectPhrase(samples[kind], 'command');
      T.ok(phrase.length > 0, kind + ' described as nothing');
    }
  });

  T.test('an ongoing modifier is not described as expiring with the activation', function () {
    // Ongoing abilities are continuously in force while their condition holds.
    // Saying "this activation" tells the player a permanent buff is about to
    // lapse. The engine always modelled the two differently; the sentence did
    // not, and it shipped that way until someone read a card.
    const ongoing = AbilityText.abilityText({
      aid: 'probe', timing: 'ongoing', when: { damageTaken: 6 },
      effects: [{ k: 'strength', n: 1 }]
    });
    T.ok(ongoing.indexOf('this activation') === -1,
      'ongoing text must not claim to expire: "' + ongoing + '"');

    const command = AbilityText.abilityText({
      aid: 'probe2', timing: 'command', target: 'self',
      effects: [{ k: 'strength', n: 1 }]
    });
    T.ok(command.indexOf('this activation') !== -1,
      'but a command buff must say so: "' + command + '"');
  });

  T.test('every response event the engine raises can be described', function () {
    for (let i = 0; i < Effects.EVENTS.length; i++) {
      const text = AbilityText.abilityText({
        aid: 'probe', timing: 'response', on: Effects.EVENTS[i],
        effects: [{ k: 'energy', n: 1 }]
      });
      wellFormed(text, 'event ' + Effects.EVENTS[i]);
      T.ok(text.indexOf('when triggered') === -1,
        'event "' + Effects.EVENTS[i] + '" fell through to the generic phrase');
    }
  });

  T.test('every status and upgrade the rules allow has a name', function () {
    const rules = Rules.createRules();
    for (let i = 0; i < rules.statuses.known.length; i++) {
      const id = rules.statuses.known[i];
      T.ok(Names.STATUSES[id] !== undefined, 'status "' + id + '" has no display name');
    }
    for (let i = 0; i < rules.upgrades.known.length; i++) {
      const id = rules.upgrades.known[i];
      T.ok(Names.UPGRADES[id] !== undefined, 'upgrade "' + id + '" has no display name');
    }
  });

  T.test('every status and upgrade has a glossary entry, not just a name', function () {
    // The tooltips describe rules the ENGINE enforces, so they cannot be
    // generated from card data the way ability text is. Nothing can check that
    // a sentence is still true -- but this at least catches the case where a
    // new status ships with no explanation at all, which is the failure a
    // player actually notices.
    const rules = Rules.createRules();
    const ids = rules.statuses.known.concat(rules.upgrades.known);
    for (let i = 0; i < ids.length; i++) {
      const text = Names.keywordText(ids[i]);
      T.ok(text && text.length > 20,
        'keyword "' + ids[i] + '" has no glossary entry');
      T.ok(/[.!]$/.test(text), 'glossary entry for "' + ids[i] + '" is not a sentence');
    }
  });

  T.test('every ability timing can be explained', function () {
    const timings = ['command', 'ongoing', 'response'];
    for (let i = 0; i < timings.length; i++) {
      T.ok(Names.keywordText(timings[i]), 'timing "' + timings[i] + '" has no glossary entry');
    }
  });

  T.test('an unknown effect kind is loud, not silently blank', function () {
    T.throws(function () { AbilityText.effectPhrase({ k: 'teleport', n: 1 }); },
      'an undescribed effect must throw rather than render as nothing');
  });

  T.test('an unknown condition is loud too', function () {
    T.throws(function () { AbilityText.conditionPhrase({ phaseOfTheMoon: 3 }); });
  });
});
