/**
 * Hex geometry: axial coordinates, distance, neighbours, lines.
 *
 * Coordinates are axial `{q, r}` everywhere in the project. The maths that
 * wants three axes -- distance, rounding, line drawing -- converts to cube
 * internally and converts straight back, so no other module ever sees a cube.
 *
 * Orientation is **pointy-top**, which only matters for `toPixel`, `fromPixel`
 * and the offset helpers; the combinatorial functions are orientation-free.
 *
 * This is the only module allowed to know how a hex grid works. Anything
 * elsewhere that adds 1 to `q` and calls it a neighbour is a bug in waiting.
 */

/** @typedef {{q: number, r: number}} Hex */
/** @typedef {{x: number, y: number, z: number}} Cube */

/**
 * The six directions, pointy-top, starting east and running anticlockwise.
 * Index order is stable and may be relied on (the UI draws in this order).
 */
export const DIRECTIONS = Object.freeze([
  Object.freeze({ q: 1, r: 0 }),   // east
  Object.freeze({ q: 1, r: -1 }),  // north-east
  Object.freeze({ q: 0, r: -1 }),  // north-west
  Object.freeze({ q: -1, r: 0 }),  // west
  Object.freeze({ q: -1, r: 1 }),  // south-west
  Object.freeze({ q: 0, r: 1 })    // south-east
]);

/**
 * The tie-break for `line`. A line traced centre to centre can pass exactly
 * along a hex boundary, in which case rounding is a coin flip and, worse, a
 * coin flip that can land differently for A->B than for B->A. Shifting both
 * endpoints by the same hair-thin vector makes the choice deterministic and
 * symmetric. The three components must sum to zero to stay on the cube plane.
 *
 * `rules.combat.losBoundary` documents the rules-level consequence of this
 * choice; see `src/engine/rules.js`.
 */
export const LINE_NUDGE = Object.freeze({ x: 1e-6, y: 1e-6, z: -2e-6 });

/**
 * @param {number} q
 * @param {number} r
 * @returns {Hex}
 */
export function hex(q, r) {
  return { q: q, r: r };
}

/**
 * Stable string form, used as a map key for boards and occupancy.
 * @param {Hex} h
 * @returns {string}
 */
export function key(h) {
  return h.q + ',' + h.r;
}

/**
 * Inverse of `key`.
 * @param {string} k
 * @returns {Hex}
 */
export function parseKey(k) {
  const parts = String(k).split(',');
  return { q: Number(parts[0]), r: Number(parts[1]) };
}

/**
 * @param {?Hex} a
 * @param {?Hex} b
 * @returns {boolean}
 */
export function equals(a, b) {
  return Boolean(a) && Boolean(b) && a.q === b.q && a.r === b.r;
}

/**
 * @param {Hex} a
 * @param {Hex} b
 * @returns {Hex}
 */
export function add(a, b) {
  return { q: a.q + b.q, r: a.r + b.r };
}

/**
 * @param {Hex} a
 * @param {Hex} b
 * @returns {Hex}
 */
export function subtract(a, b) {
  return { q: a.q - b.q, r: a.r - b.r };
}

/**
 * @param {Hex} a
 * @param {number} k
 * @returns {Hex}
 */
export function scale(a, k) {
  return { q: a.q * k, r: a.r * k };
}

/**
 * @param {Hex} h
 * @param {number} direction index into DIRECTIONS
 * @returns {Hex}
 */
export function neighbour(h, direction) {
  const d = DIRECTIONS[((direction % 6) + 6) % 6];
  return { q: h.q + d.q, r: h.r + d.r };
}

/**
 * All six neighbours, in DIRECTIONS order.
 * @param {Hex} h
 * @returns {Hex[]}
 */
export function neighbours(h) {
  return DIRECTIONS.map(function (d) { return { q: h.q + d.q, r: h.r + d.r }; });
}

/**
 * @param {Hex} a
 * @param {Hex} b
 * @returns {boolean}
 */
export function isAdjacent(a, b) {
  return distance(a, b) === 1;
}

/**
 * @param {Hex} h
 * @returns {Cube}
 */
export function toCube(h) {
  return { x: h.q, y: -h.q - h.r, z: h.r };
}

/**
 * @param {Cube} c
 * @returns {Hex}
 */
export function fromCube(c) {
  return { q: c.x, r: c.z };
}

/**
 * Round a fractional cube coordinate to the nearest hex, correcting whichever
 * axis drifted furthest so the three components still sum to zero.
 * @param {Cube} c
 * @returns {Cube}
 */
export function cubeRound(c) {
  let rx = Math.round(c.x);
  let ry = Math.round(c.y);
  let rz = Math.round(c.z);
  const dx = Math.abs(rx - c.x);
  const dy = Math.abs(ry - c.y);
  const dz = Math.abs(rz - c.z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}

/**
 * Round a fractional axial coordinate to the nearest hex.
 * @param {Hex} h
 * @returns {Hex}
 */
export function round(h) {
  return fromCube(cubeRound(toCube(h)));
}

/**
 * Hex distance: the number of steps between two hexes, ignoring terrain.
 * @param {Hex} a
 * @param {Hex} b
 * @returns {number}
 */
export function distance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

/**
 * Every hex whose distance from `centre` is exactly `radius`.
 * Returns `[centre]` for radius 0.
 * @param {Hex} centre
 * @param {number} radius
 * @returns {Hex[]}
 */
export function ring(centre, radius) {
  if (radius <= 0) return [{ q: centre.q, r: centre.r }];
  const out = [];
  // Start on the south-west spoke and walk the ring anticlockwise.
  let h = add(centre, scale(DIRECTIONS[4], radius));
  for (let i = 0; i < 6; i++) {
    for (let step = 0; step < radius; step++) {
      out.push({ q: h.q, r: h.r });
      h = neighbour(h, i);
    }
  }
  return out;
}

/**
 * Every hex within `radius` of `centre`, centre included.
 * @param {Hex} centre
 * @param {number} radius
 * @returns {Hex[]}
 */
export function range(centre, radius) {
  const out = [];
  for (let dq = -radius; dq <= radius; dq++) {
    const lo = Math.max(-radius, -dq - radius);
    const hi = Math.min(radius, -dq + radius);
    for (let dr = lo; dr <= hi; dr++) {
      out.push({ q: centre.q + dq, r: centre.r + dr });
    }
  }
  return out;
}

/**
 * The hexes a straight centre-to-centre line passes through, `a` and `b`
 * included. Length is always `distance(a, b) + 1`, and each consecutive pair
 * is adjacent, so callers can walk it as a path.
 *
 * @param {Hex} a
 * @param {Hex} b
 * @param {{nudge?: Cube}} [options] override the boundary tie-break
 * @returns {Hex[]}
 */
export function line(a, b, options) {
  const n = distance(a, b);
  const out = [{ q: a.q, r: a.r }];
  if (n === 0) return out;

  const nudge = (options && options.nudge) || LINE_NUDGE;
  const ac = toCube(a);
  const bc = toCube(b);
  const ax = ac.x + nudge.x, ay = ac.y + nudge.y, az = ac.z + nudge.z;
  const bx = bc.x + nudge.x, by = bc.y + nudge.y, bz = bc.z + nudge.z;

  for (let i = 1; i <= n; i++) {
    const t = i / n;
    out.push(fromCube(cubeRound({
      x: ax + (bx - ax) * t,
      y: ay + (by - ay) * t,
      z: az + (bz - az) * t
    })));
  }
  return out;
}

// --- Rendering and rectangular maps -----------------------------------------

/**
 * Centre of a hex in pixels, pointy-top.
 * @param {Hex} h
 * @param {number} size distance from centre to a corner
 * @param {{x: number, y: number}} [origin]
 * @returns {{x: number, y: number}}
 */
export function toPixel(h, size, origin) {
  const ox = origin ? origin.x : 0;
  const oy = origin ? origin.y : 0;
  return {
    x: ox + size * Math.sqrt(3) * (h.q + h.r / 2),
    y: oy + size * (3 / 2) * h.r
  };
}

/**
 * Nearest hex to a pixel position, pointy-top. Inverse of `toPixel`.
 * @param {{x: number, y: number}} p
 * @param {number} size
 * @param {{x: number, y: number}} [origin]
 * @returns {Hex}
 */
export function fromPixel(p, size, origin) {
  const ox = origin ? origin.x : 0;
  const oy = origin ? origin.y : 0;
  const px = (p.x - ox) / size;
  const py = (p.y - oy) / size;
  const r = (2 / 3) * py;
  const q = (Math.sqrt(3) / 3) * px - py / 3;
  return round({ q: q, r: r });
}

/**
 * The six corner offsets of a pointy-top hex, for drawing.
 * @param {number} size
 * @returns {Array<{x: number, y: number}>}
 */
export function corners(size) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30);
    out.push({ x: size * Math.cos(angle), y: size * Math.sin(angle) });
  }
  return out;
}

/**
 * Rotate an axial offset about the origin by 60-degree steps (anticlockwise in DIRECTIONS order), so DIRECTIONS[0]
 * rotated by k is DIRECTIONS[k]. Used to aim an area weapon's pattern in any of the six directions.
 * @param {Hex} h
 * @param {number} steps
 * @returns {Hex}
 */
export function rotate(h, steps) {
  let x = h.q;
  let z = h.r;
  let y = -x - z;
  const n = ((steps % 6) + 6) % 6;
  for (let i = 0; i < n; i++) {
    // cube rotation by 60 degrees anticlockwise: (x, y, z) -> (-y, -z, -x), checked against DIRECTIONS in the tests
    const nx = -y;
    const ny = -z;
    const nz = -x;
    x = nx; y = ny; z = nz;
  }
  return { q: x + 0, r: z + 0 };
}

/**
 * Offset (column, row) to axial, pointy-top **odd-r**: odd rows shift right.
 * Scenario maps are authored as rectangles, so this is how they land on the
 * axial grid.
 * @param {number} col
 * @param {number} row
 * @returns {Hex}
 */
export function fromOffset(col, row) {
  return { q: col - ((row - (row & 1)) / 2), r: row };
}

/**
 * Axial to offset (column, row), pointy-top odd-r. Inverse of `fromOffset`.
 * @param {Hex} h
 * @returns {{col: number, row: number}}
 */
export function toOffset(h) {
  return { col: h.q + ((h.r - (h.r & 1)) / 2), row: h.r };
}
