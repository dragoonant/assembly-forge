/**
 * Seeded, purely-functional random number generator.
 *
 * Every random decision in the game flows through here, and the generator's
 * position is a plain integer stored inside the game state (`state.rng`).
 * Nothing in this project may call `Math.random()`.
 *
 * The contract every caller must honour: a function that consumes randomness
 * takes the generator state in and returns the **advanced** generator state
 * out, alongside its result. `apply` threads it through and puts the advanced
 * value on the new state. That is what makes a match replay identically from
 * its seed -- which the test suite depends on, and which the AI search will
 * depend on when it starts speculating about futures.
 */

/** @typedef {{state: number, value: number}} RngStep */

/**
 * Advance the generator one step. mulberry32, rewritten to thread its state
 * explicitly instead of holding it in a closure.
 * @param {number} rngState
 * @returns {RngStep} `value` is in [0, 1)
 */
export function step(rngState) {
  const a = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { state: a, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/**
 * Random integer in [0, bound).
 * @param {number} rngState
 * @param {number} bound
 * @returns {RngStep}
 */
export function int(rngState, bound) {
  const r = step(rngState);
  return { state: r.state, value: Math.floor(r.value * bound) };
}

/**
 * One die roll, in [1, sides].
 * @param {number} rngState
 * @param {number} sides
 * @returns {RngStep}
 */
export function roll(rngState, sides) {
  const r = int(rngState, sides);
  return { state: r.state, value: r.value + 1 };
}

/**
 * `count` die rolls, each in [1, sides]. An attack rolls its whole handful in
 * one call so the sequence is unambiguous.
 * @param {number} rngState
 * @param {number} count
 * @param {number} sides
 * @returns {{state: number, value: number[]}}
 */
export function rollN(rngState, count, sides) {
  const out = [];
  let s = rngState;
  for (let i = 0; i < count; i++) {
    const r = roll(s, sides);
    s = r.state;
    out.push(r.value);
  }
  return { state: s, value: out };
}

/**
 * Pick one element of a non-empty array.
 * @template T
 * @param {number} rngState
 * @param {T[]} list
 * @returns {{state: number, value: T}}
 */
export function pick(rngState, list) {
  const r = int(rngState, list.length);
  return { state: r.state, value: list[r.value] };
}

/**
 * Fisher-Yates. Returns a new array; the input is left alone.
 * @template T
 * @param {number} rngState
 * @param {T[]} list
 * @returns {{state: number, value: T[]}}
 */
export function shuffle(rngState, list) {
  const out = list.slice();
  let s = rngState;
  for (let i = out.length - 1; i > 0; i--) {
    const r = int(s, i + 1);
    s = r.state;
    const j = r.value;
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return { state: s, value: out };
}

/**
 * Turn any seed (string or number) into a generator state, so humans can use
 * memorable seeds like "skirmish-1" when reporting a bug.
 * @param {string|number} seed
 * @returns {number}
 */
export function seedFrom(seed) {
  if (typeof seed === 'number') return seed | 0;
  let h = 2166136261;
  const str = String(seed);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}
