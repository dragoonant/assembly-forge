// Which attack animation each weapon plays. One entry per weapon id; a weapon with no entry gets a kind from its stats
// (fxKindFor), so a new machine always has a sensible effect before anyone writes its line here.
//
//   beam      a charge at the muzzle, then a sustained glowing beam and a flash at the target
//   ballistic a quick burst of rounds: muzzle flashes, tracers and sparks where they land
//   missile   several missiles out of the back or shoulder pods, arcing in on smoke trails
//   melee     a dash in, a blade arc, a heavy impact, and back
//   blast     an area weapon: the blast rolls out across every hex the pattern catches
//   mortar    an indirect weapon: one shell lobbed high, a big burst where it comes down

export type FxKind = 'beam' | 'ballistic' | 'missile' | 'melee' | 'blast' | 'mortar'

export const WEAPON_FX: Record<string, FxKind> = {
  u01a: 'ballistic',
  u01b: 'ballistic',
  u02a: 'missile',
  u02b: 'melee',
  u03a: 'beam',
  u03b: 'beam',
  u04a: 'melee',
  u04b: 'melee',
  u05a: 'ballistic',
  u05b: 'melee',
  u06a: 'ballistic',
  u06b: 'mortar',
}

/** The weapon facts the fallback reads (a unit's weapon in the engine state has them all). */
export interface WeaponStats {
  wid: string
  range: number
  ignoreLos?: boolean
  area?: unknown[] | null
}

/**
 * The effect a weapon plays: its entry in WEAPON_FX, otherwise from its stats. Range 1 is melee, ignoring line of sight is
 * a mortar, an area pattern is a blast; any other gun is a beam when it reaches 4 hexes or more (the long, hard-hitting
 * guns) and ballistic below that.
 */
export function fxKindFor(w: WeaponStats): FxKind {
  const named = WEAPON_FX[w.wid]
  if (named) return named
  if (w.area && w.area.length) return 'blast'
  if (w.ignoreLos) return 'mortar'
  if (w.range <= 1) return 'melee'
  return w.range >= 4 ? 'beam' : 'ballistic'
}
