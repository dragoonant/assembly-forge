/**
 * Push and Pull as the acting player's choice (rulebook 2026-10-30, "Push" and "Pull").
 *
 * The target moves one hex at a time, up to the effect's number. At each step the player whose effect it is picks any
 * neighbouring hex strictly further from the source (Push) or strictly closer to it (Pull). Terrain and Engagement cost
 * nothing. Choosing a hex that is higher ground, impassable, or occupied by a unit or Garrison is a collision: the
 * movement ends and everything involved takes 2 damage (non-combat, so Shields stop it and Fracture does not). The
 * board edge is simply not a choice. The player may stop early, because the effect moves "up to" its number; an enemy
 * already adjacent to the source at the same elevation cannot be Pulled at all.
 *
 * While the choice is open, `state.pending` is `{kind: 'displace', ...}`. Whatever was resolving when the push began
 * (the rest of an ability's effects, or an attack paused before its roll) carries on once it ends.
 */

import * as Hex from './hex.js';
import * as State from './state.js';

/**
 * Begin a Push or Pull. Opens a decision when the target has somewhere to go; otherwise nothing happens.
 *
 * @param {Object} state
 * @param {Object} source the unit doing the pushing
 * @param {string} targetUid
 * @param {number} n
 * @param {'push'|'pull'} mode
 * @param {?Object} cont what to resume afterwards: `{uid, effects, targetUid}` (the rest of an ability), or null
 * @param {?Array<string>} queue further targets of the same weapon effect, pushed one after another
 * @returns {boolean} whether a decision was opened
 */
export function begin(state, source, targetUid, n, mode, cont, queue) {
  const t = state.units[targetUid];
  if (!t || !t.alive || !t.hex || !source.hex || n <= 0) return false;
  if (mode === 'pull' && Hex.distance(source.hex, t.hex) === 1 &&
      State.elevationAt(state, source.hex) === State.elevationAt(state, t.hex)) return false;
  const p = {
    kind: 'displace', mode: mode, side: source.side, source: source.uid, uid: t.uid,
    left: n, moved: 0, from: { q: t.hex.q, r: t.hex.r }, cont: cont || null, queue: queue || null
  };
  if (!stepOptions(state, p).length) return false;
  state.pending = p;
  return true;
}

/**
 * The hexes the target may be moved to on this step: `{to, collide}` each.
 * @param {Object} state
 * @param {Object} p the pending displacement
 * @returns {Array<{to: {q: number, r: number}, collide: boolean}>}
 */
export function stepOptions(state, p) {
  const t = state.units[p.uid];
  const s = state.units[p.source];
  if (!t || !t.alive || !t.hex || !s || !s.hex) return [];
  const d = Hex.distance(s.hex, t.hex);
  const out = [];
  for (const h of Hex.neighbours(t.hex)) {
    const nd = Hex.distance(s.hex, h);
    if (p.mode === 'push' ? nd <= d : nd >= d || Hex.equals(h, s.hex)) continue;
    const cell = State.cellAt(state, h);
    if (!cell) continue; // the board edge: not a collision, just nowhere to go
    const kind = state.rules.terrain[cell.terrain];
    const blocked = cell.elevation > State.elevationAt(state, t.hex) || kind.impassable ||
      Boolean(State.unitAt(state, h)) || Boolean(State.garrisonAt(state, h));
    out.push({ to: { q: h.q, r: h.r }, collide: blocked });
  }
  out.sort(function (a, b) { return Hex.key(a.to) < Hex.key(b.to) ? -1 : 1; });
  return out;
}

/** The pending displacement's options, as actions for the deciding side. */
export function options(state) {
  const p = state.pending;
  return stepOptions(state, p).map(function (o) {
    return { type: 'displace', side: p.side, uid: p.uid, to: o.to, collide: o.collide };
  }).concat([{ type: 'displace_stop', side: p.side, uid: p.uid }]);
}

/**
 * Apply one step, or stop. Returns true when the displacement has finished (the caller then resumes whatever it
 * interrupted).
 *
 * @param {Object} state
 * @param {Object} action
 * @param {Object} combat injected combat module
 * @returns {boolean}
 */
export function decide(state, action, combat) {
  const p = state.pending;
  const t = state.units[p.uid];
  let done = action.type === 'displace_stop';
  if (action.type === 'displace') {
    if (action.collide) {
      const dmg = state.rules.movement.collisionDamage;
      const other = State.unitAt(state, action.to);
      const g = State.garrisonAt(state, action.to);
      state.log.push({ t: 'collision', uid: t.uid, at: { q: action.to.q, r: action.to.r }, with: other ? other.uid : g ? g.gid : 'terrain', sound: 'hit', notice: true });
      combat.dealDamage(state, { kind: 'unit', id: t.uid }, dmg, p.side, false);
      if (other) combat.dealDamage(state, { kind: 'unit', id: other.uid }, dmg, p.side, false);
      if (g) combat.dealDamage(state, { kind: 'garrison', id: g.gid }, dmg, p.side, false);
      done = true;
    } else {
      t.hex = { q: action.to.q, r: action.to.r };
      p.moved++;
      p.left--;
      if (p.left <= 0 || !stepOptions(state, p).length) done = true;
    }
  }
  if (!done) return false;
  if (p.moved) {
    state.log.push({ t: p.mode, uid: p.uid, by: p.source, from: p.from, to: t && t.hex ? { q: t.hex.q, r: t.hex.r } : null, hexes: p.moved });
  }
  state.pending = null;
  // further targets of the same weapon effect, one after another
  if (p.queue && p.queue.length) {
    const source = state.units[p.source];
    const rest = p.queue.slice();
    while (rest.length && !state.pending) {
      const next = rest.shift();
      begin(state, source, next, p.queueN, p.mode, p.cont, rest);
      if (state.pending) state.pending.queueN = p.queueN;
    }
    if (state.pending) return false;
  }
  return true;
}
