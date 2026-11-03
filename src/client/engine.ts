// The one place the TypeScript client meets the plain-JS engine. The engine's JSDoc types are loose (`Object`), so this module
// states the shapes the client relies on and casts once, here, instead of at every call site.
import * as Names from '../content/names.js'
import { skirmish } from '../content/scenarios/skirmish.js'
import * as StateJs from '../engine/state.js'

export type Side = 0 | 1

export interface Axial {
  q: number
  r: number
}

export interface EngineCell extends Axial {
  terrain: string
  elevation: number
}

export interface EngineUnit {
  uid: string
  defId: string
  side: Side
  /** null while the unit is in Reserve, off the board. */
  hex: Axial | null
  hp: number
  maxHp: number
  alive: boolean
  inReserve: boolean
}

export interface EngineBase {
  bid: string
  side: Side
  hex: Axial
}

export interface GameState {
  board: { hexes: Record<string, EngineCell> }
  units: Record<string, EngineUnit>
  unitOrder: string[]
  bases: EngineBase[]
  phase: number
  round: number
  log: { t: string; [k: string]: unknown }[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const State = StateJs as any

export function newSkirmish(seed: string): GameState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return State.createGame((skirmish as any)({ seed })) as GameState
}

export function livingUnits(state: GameState, side?: Side): EngineUnit[] {
  return State.livingUnits(state, side) as EngineUnit[]
}

export function cellsOf(state: GameState): EngineCell[] {
  return Object.values(state.board.hexes)
}

export const UI = Names.UI as unknown as Record<string, string>
