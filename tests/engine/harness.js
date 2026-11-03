/**
 * Test harness: a small assertion framework plus helpers for putting a match
 * into a specific position.
 *
 * Tests build the board they need directly rather than playing toward it, so
 * each test states its premise in two or three lines and a failure message
 * points at one mechanic.
 *
 * The same file runs in both places the suite runs: `tests.html` in a browser
 * and `tests/run.js` under Node. Nothing here may touch the DOM.
 */

import * as Actions from '../../src/engine/actions.js';
import * as Apply from '../../src/engine/apply.js';
import * as Hex from '../../src/engine/hex.js';
import * as State from '../../src/engine/state.js';

const suites = [];
let current = null;

/**
 * @param {string} name
 * @param {Function} body
 */
export function suite(name, body) {
  current = { name: name, tests: [] };
  suites.push(current);
  body();
  current = null;
}

/**
 * @param {string} name
 * @param {Function} fn
 */
export function test(name, fn) {
  if (!current) throw new Error('test() called outside a suite');
  current.tests.push({ name: name, fn: fn });
}

// --- Assertions --------------------------------------------------------------

export function fail(message) {
  throw new Error(message);
}

export function ok(value, message) {
  if (!value) fail(message || 'Expected a truthy value, got ' + describe(value));
}

export function notOk(value, message) {
  if (value) fail(message || 'Expected a falsy value, got ' + describe(value));
}

export function eq(actual, expected, message) {
  if (actual !== expected) {
    fail((message ? message + ': ' : '') +
      'expected ' + describe(expected) + ', got ' + describe(actual));
  }
}

/** Structural equality, by JSON. Good enough for the plain data the engine holds. */
export function deepEq(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) fail((message ? message + ': ' : '') + 'expected ' + b + ', got ' + a);
}

export function throws(fn, message) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (!threw) fail(message || 'Expected the call to throw');
}

export function describe(value) {
  if (typeof value === 'string') return '"' + value + '"';
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return '[' + value.map(describe).join(', ') + ']';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// --- Game helpers ------------------------------------------------------------

/**
 * Find the single legal action matching `matcher`, or null.
 * @param {Object} state
 * @param {Object|Function} matcher
 * @returns {?Object}
 */
export function find(state, matcher) {
  const actions = Actions.legalActions(state);
  for (let i = 0; i < actions.length; i++) {
    if (matches(actions[i], matcher)) return actions[i];
  }
  return null;
}

/**
 * Every legal action matching `matcher`.
 * @param {Object} state
 * @param {Object|Function} matcher
 * @returns {Object[]}
 */
export function findAll(state, matcher) {
  return Actions.legalActions(state).filter(function (a) { return matches(a, matcher); });
}

/**
 * Find one legal action and apply it.
 * @param {Object} state
 * @param {Object|Function} matcher
 * @returns {Object} the resulting state
 */
export function act(state, matcher) {
  const action = find(state, matcher);
  if (!action) {
    fail('No legal action matched ' + describe(matcher) + '. Available: ' +
      Actions.legalActions(state).map(Actions.actionKey).join(' | '));
  }
  return Apply.apply(state, action);
}

function matches(action, matcher) {
  if (typeof matcher === 'function') return matcher(action);
  const keys = Object.keys(matcher);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k === 'to') {
      if (!action.to || !Hex.equals(action.to, matcher.to)) return false;
      continue;
    }
    if (action[k] !== matcher[k]) return false;
  }
  return true;
}

/**
 * End the current activation, taking a cheap Primary Action first if the unit
 * still owes one. Used by tests that care about the Timeline rather than about
 * what a unit did with its turn.
 * @param {Object} state
 * @returns {Object}
 */
export function pass(state) {
  let s = state;
  if (s.activation && !s.activation.slots.primary) {
    const energize = find(s, { type: 'energize' });
    if (energize) s = Apply.apply(s, energize);
  }
  return act(s, { type: 'end_activation' });
}

/**
 * Pass activations until `predicate(state)` holds or the game ends.
 * @param {Object} state
 * @param {Function} predicate
 * @param {number} [limit]
 * @returns {Object}
 */
export function passUntil(state, predicate, limit) {
  let s = state;
  let guard = 0;
  const cap = limit === undefined ? 500 : limit;
  while (!predicate(s) && !Apply.isTerminal(s)) {
    if (++guard > cap) fail('passUntil ran ' + cap + ' activations without the condition holding');
    s = pass(s);
  }
  return s;
}

/**
 * Run a whole match out by passing every activation. Returns the final state
 * and the order units activated in.
 * @param {Object} state
 * @param {number} [limit]
 * @returns {{state: Object, order: Array<{uid: string, side: 0|1, round: number, phase: number}>}}
 */
export function drain(state, limit) {
  let s = state;
  const order = [];
  let guard = 0;
  const cap = limit === undefined ? 500 : limit;
  while (!Apply.isTerminal(s) && s.activation) {
    if (++guard > cap) fail('drain ran ' + cap + ' activations without the game ending');
    order.push({ uid: s.activation.uid, side: s.activation.side, round: s.round, phase: s.phase });
    s = pass(s);
  }
  return { state: s, order: order };
}

/**
 * A JSON snapshot, for proving `apply` left its input alone.
 * @param {Object} state
 * @returns {string}
 */
export function snapshot(state) {
  return JSON.stringify(state);
}

/**
 * The uids on a round's stack for one side, top first.
 * @param {Object} state
 * @param {number} round
 * @param {0|1} side
 * @returns {string[]}
 */
export function stack(state, round, side) {
  return state.timeline.rounds[round - 1].stacks[side].slice();
}

/**
 * @param {Object} state
 * @param {string} uid
 * @returns {?number} the round holding this unit's token
 */
export function tokenRound(state, uid) {
  const at = Apply.tokenAt(state, uid);
  return at ? at.round : null;
}

/**
 * @param {Object} state
 * @param {string} uid
 * @returns {{q: number, r: number}}
 */
export function where(state, uid) {
  return State.unit(state, uid).hex;
}

// --- Runner ------------------------------------------------------------------

/**
 * Run every registered suite.
 * @param {Function} [report] called with each result as it completes
 * @returns {{passed: number, failed: number, results: Array}}
 */
export function run(report) {
  let passed = 0;
  let failed = 0;
  const results = [];

  for (let i = 0; i < suites.length; i++) {
    const s = suites[i];
    for (let j = 0; j < s.tests.length; j++) {
      const t = s.tests[j];
      const result = { suite: s.name, name: t.name, ok: true, error: null, ms: 0 };
      const started = now();
      try {
        t.fn();
        passed++;
      } catch (e) {
        result.ok = false;
        result.error = e && e.stack ? e.stack : String(e);
        failed++;
      }
      result.ms = Math.round(now() - started);
      results.push(result);
      if (report) report(result);
    }
  }
  return { passed: passed, failed: failed, results: results };
}

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
