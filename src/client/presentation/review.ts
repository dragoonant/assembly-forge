// Review hooks for the attack effects (the e2e suite's window.__game.fx): play any kind of shot, or a wreck flying off,
// between the closest pair of opposing machines on the board, and hold either at a chosen moment for a screenshot. They
// only drive the presentation: the engine state is never touched.
import { frameFor, hexToWorld } from '../board/hexLayout'
import { viewApi } from '../board/viewApi'
import { cellsOf, type Axial } from '../engine'
import { getStore, setStore } from '../store'
import { runBeats, runEffects } from './director'
import { FX_DUR } from './fxTiming'
import type { FxKind } from './weaponFx'

const NEIGHBOURS: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
const key = (h: Axial): string => h.q + ',' + h.r
const dist = (a: Axial, b: Axial): number => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2

/** The closest attacker (side 0) and target (side 1) on the board, or null. */
export function closestPair(): { attacker: string; target: string; from: Axial; to: Axial } | null {
  const g = getStore().game
  if (!g) return null
  const on = Object.values(g.units).filter((u) => u.alive && u.hex)
  let best: { attacker: string; target: string; from: Axial; to: Axial } | null = null
  for (const a of on.filter((u) => u.side === 0)) {
    for (const t of on.filter((u) => u.side === 1)) {
      if (!best || dist(a.hex!, t.hex!) < dist(best.from, best.to)) best = { attacker: a.uid, target: t.uid, from: a.hex!, to: t.hex! }
    }
  }
  return best
}

/** A machine on the board by its definition id (u01...), or by its uid. */
function onBoard(id: string): string | null {
  const g = getStore().game
  if (!g) return null
  if (g.units[id]?.hex) return id
  return Object.values(g.units).find((u) => u.alive && u.hex && u.defId === id)?.uid ?? null
}

/** The closest enemy on the board to a unit. */
function nearestFoe(uid: string): string | null {
  const g = getStore().game
  const me = g?.units[uid]
  if (!g || !me?.hex) return null
  const foes = Object.values(g.units).filter((u) => u.alive && u.hex && u.side !== me.side)
  foes.sort((a, b) => dist(me.hex!, a.hex!) - dist(me.hex!, b.hex!))
  return foes[0]?.uid ?? null
}

/**
 * Play a shot of `kind` (with `area`, over the target and its neighbours). `attacker` is a uid or a definition id; the
 * default is the closest pair on the board, and the target defaults to the attacker's nearest enemy.
 */
export function demoShot(kind: FxKind, opts: { area?: boolean; miss?: boolean; attacker?: string; target?: string } = {}): Promise<void> {
  const g = getStore().game
  const pair = closestPair()
  if (!g || !pair) return Promise.resolve()
  const uid = (opts.attacker && onBoard(opts.attacker)) || pair.attacker
  const tid = (opts.target && onBoard(opts.target)) || nearestFoe(uid) || pair.target
  frameShot(uid, tid)
  const to = g.units[tid]?.hex ?? pair.to
  const area = opts.area ? [to, ...NEIGHBOURS.map(([q, r]) => ({ q: to.q + q, r: to.r + r })).filter((h) => g.board.hexes[key(h)])] : null
  return runBeats([{ kind: 'shot', uid, to, fx: kind, hits: [to], area, struck: opts.miss ? [] : [tid], miss: Boolean(opts.miss), dur: FX_DUR[kind] }])
}

/** A wreck of the closest target flying off from an empty hex beside it (the machine itself stays put). */
export function demoWreck(): void {
  const g = getStore().game
  const pair = closestPair()
  if (!g || !pair) return
  const taken = new Set(Object.values(g.units).filter((u) => u.alive && u.hex).map((u) => key(u.hex!)))
  const at = NEIGHBOURS.map(([q, r]) => ({ q: pair.to.q + q, r: pair.to.r + r })).find((h) => g.board.hexes[key(h)] && !taken.has(key(h)))
  const u = g.units[pair.target]!
  frameShot(pair.attacker, pair.target)
  runEffects([{ kind: 'wreck', uid: u.uid, defId: u.defId, side: u.side, at: at ?? pair.to }], g, 0)
}

/** Hold the beat now playing at fraction `t` of the way through (best with a large ?slowmo, which nearly freezes it). */
export function seekBeat(t: number): void {
  const s = getStore()
  setStore({ beatStart: performance.now() - t * s.beatMs })
}

/** Hold every wreck now flying at fraction `k` of the way through. */
export function seekWreck(k: number): void {
  const now = performance.now()
  setStore((s) => ({ wrecks: s.wrecks.map((w) => ({ ...w, born: now - k * w.ms })) }))
}

let lastPair: [string, string] | null = null

/** Point the camera across the line from one unit to another, close enough to see the effect. */
export function frameShot(a: string, b: string): void {
  lastPair = [a, b]
  focus('pair', 0.45)
}

/** Centre the camera on the last shot's attacker, its target, or the middle of the line between them, at `zoom`. */
export function focus(on: 'attacker' | 'target' | 'pair', zoom: number): void {
  const g = getStore().game
  if (!g || !lastPair) return
  const ha = g.units[lastPair[0]]?.hex
  const hb = g.units[lastPair[1]]?.hex
  if (!ha || !hb) return
  const frame = frameFor(cellsOf(g))
  const pa = hexToWorld(ha, frame)
  const pb = hexToWorld(hb, frame)
  const dx = pb.x - pa.x
  const dz = pb.z - pa.z
  const k = on === 'attacker' ? 0.15 : on === 'target' ? 0.85 : 0.5
  viewApi.setView({ x: pa.x + dx * k, z: pa.z + dz * k, az: -Math.atan2(dz, dx), zoom, tilt: 0.12 })
}
