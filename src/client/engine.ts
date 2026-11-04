// The one place the TypeScript client meets the plain-JS engine, content and AI. The engine's JSDoc types are loose
// (`Object`), so this module states the shapes the client relies on and casts once, here, instead of at every call site.
// Nothing outside this file imports from src/engine, src/content or src/ai.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as AIJs from '../ai/ai.js'
import * as TextJs from '../content/abilitytext.js'
import * as NamesJs from '../content/names.js'
import * as SkirmishJs from '../content/scenarios/skirmish.js'
import * as TeamsJs from '../content/teams.js'
import * as PacksJs from '../content/packs.js'
import * as UnitsJs from '../content/units.js'
import * as ActionsJs from '../engine/actions.js'
import * as ApplyJs from '../engine/apply.js'
import * as CombatJs from '../engine/combat.js'
import * as EffectsJs from '../engine/effects.js'
import * as LosJs from '../engine/los.js'
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

export interface Weapon {
  wid: string
  tlCost: number
  range: number
  strength: number
  ignoreLos: boolean
  crit: Record<string, unknown> | null
}

export interface Ability {
  aid: string
  timing: string
  energy?: number
  when?: unknown
  effects: { k: string; n?: number; s?: string }[]
}

export interface EngineUnit {
  uid: string
  defId: string
  side: Side
  /** null while the unit is in Reserve, off the board. */
  hex: Axial | null
  hp: number
  maxHp: number
  vp: number
  tl: number
  energy: number
  statuses: string[]
  upgrades: string[]
  weapons: Weapon[]
  abilities: Ability[]
  alive: boolean
  inReserve: boolean
}

export interface EngineBase {
  bid: string
  side: Side
  hex: Axial
}

export interface Garrison {
  gid: string
  side: Side | null
  hex: Axial
  alive: boolean
}

export interface Objective {
  oid: string
  hex: Axial
  vp: number
  controlledBy: Side | null
}

export interface Pickup {
  pid: string
  kind: 'upgrade' | 'energy'
  upgrade: string | null
  hex: Axial
}

export interface TacticsCard {
  cid: string
  timing: string
  target?: string
  effects: { k: string; n?: number; s?: string }[]
}

export interface Activation {
  uid: string
  side: Side
  slots: { advance: boolean; primary: string | null; command: boolean; tactics: boolean }
  deployed: boolean
  defeated: boolean
}

export interface LogEntry {
  t: string
  [k: string]: any
}

export interface Pending {
  kind: 'window' | 'react_move' | 'react_attack'
  window?: string
  role?: string
  side?: Side
  uid?: string
  wid?: string
}

export interface AttackInProgress {
  uid: string
  dice: number
  faces: number[] | null
  preview?: { ref: { kind: string; id: string }; hits: number }[]
}

export interface GameState {
  board: { hexes: Record<string, EngineCell> }
  units: Record<string, EngineUnit>
  unitOrder: string[]
  bases: EngineBase[]
  garrisons: Record<string, Garrison>
  garrisonOrder: string[]
  objectives: Record<string, Objective>
  objectiveOrder: string[]
  pickups: Pickup[]
  players: { vp: number; tactics: { hand: TacticsCard[]; deck: TacticsCard[] } }[]
  timeline: { rounds: { stacks: [string[], string[]] }[] }
  rules: any
  phase: number
  round: number
  activation: Activation | null
  pending?: Pending | null
  attacks?: AttackInProgress[]
  over: boolean
  winner: Side | null
  log: LogEntry[]
}

export interface Action {
  type: string
  uid: string
  to?: Axial
  path?: Axial[]
  cost?: number
  wid?: string
  target?: { kind: 'unit' | 'garrison'; id: string }
  gid?: string
  aid?: string
  targetUid?: string
  cid?: string
  free?: boolean
  tlCost?: number
  slowed?: boolean
  side?: Side
  area?: number
  areaHexes?: Axial[]
  targets?: { kind: 'unit' | 'garrison'; id: string }[]
  grant?: number
}

const State = StateJs as any
const Actions = ActionsJs as any
const Apply = ApplyJs as any
const Combat = CombatJs as any
const Effects = EffectsJs as any
const Los = LosJs as any
const AI = AIJs as any
const Skirmish = SkirmishJs as any

export const Names = NamesJs as any
export const Text = TextJs as any
/** The active pack's team ids, in menu order. A function, because the active pack is chosen at startup. */
export const teamOrder = (): string[] => (TeamsJs as any).teamOrder()
export const roleName = (defId: string): string => Names.roleName(defId)
export const teamName = (tid: string): string => Names.teamName(tid)
export const teamNote = (tid: string): string => Names.teamNote(tid)
/** Which built-in stand-in figure a unit uses: its own id for our cast, the pack's choice for a pack unit. */
export const standInFor = (defId: string): string => (UnitsJs as any).standInFor(defId)

export interface PackInfo {
  id: string
  label: string
}
export const Packs = {
  register: (p: unknown): void => (PacksJs as any).registerPack(p),
  activate: (id: string | null): void => (PacksJs as any).activate(id),
  list: (): PackInfo[] => (PacksJs as any).listPacks(),
  activeId: (): string => ((PacksJs as any).activePack()?.id as string | undefined) ?? (PacksJs as any).BUILT_IN,
}
export const SCENARIO_ID: string = Skirmish.SCENARIO_ID

export function newSkirmish(seed: string, playerTeam?: string, enemyTeam?: string): GameState {
  return State.createGame(Skirmish.skirmish({ seed, playerTeam, enemyTeam })) as GameState
}

export function squadsFor(playerTeam: string | null, enemyTeam: string | null): [string[], string[]] {
  return Skirmish.squadsFor(playerTeam || undefined, enemyTeam || undefined)
}

export function teamUnits(tid: string): string[] {
  return (TeamsJs as any).team(tid).units.slice()
}

export const livingUnits = (s: GameState, side?: Side): EngineUnit[] => State.livingUnits(s, side)
export const cellsOf = (s: GameState): EngineCell[] => Object.values(s.board.hexes)
export const legalActions = (s: GameState): Action[] => (s.over ? [] : Actions.legalActions(s))
export const apply = (s: GameState, a: Action): GameState => Apply.apply(s, a)
export const isTerminal = (s: GameState): boolean => Apply.isTerminal(s)
export const actionKey = (a: Action): string => Actions.actionKey(a)
export const aiChoose = (s: GameState): Action | null => AI.chooseAction(s)
export const weaponsOf = (u: EngineUnit): Weapon[] => Combat.weaponsOf(u)
export const targetHex = (s: GameState, ref: { kind: string; id: string }): Axial | null => Combat.targetHex(s, ref)
export const accuracyShift = (s: GameState, u: EngineUnit, w: Weapon, h: Axial): number => Combat.accuracyShift(s, u, w, h)
export const strengthOf = (s: GameState, u: EngineUnit, w: Weapon): number => Combat.strengthOf(s, u, w)
export const expectedHits = (s: GameState, dice: number, shift: number): number => Combat.expectedHits(s.rules, dice, shift)
export const abilitiesOf = (u: EngineUnit): Ability[] => Effects.abilitiesOf(u)
export const ability = (u: EngineUnit, aid: string): Ability => Effects.ability(u, aid)
export const conditionHolds = (s: GameState, u: EngineUnit, when: unknown): boolean => Effects.conditionHolds(s, u, when)
export const losTrace = (s: GameState, from: Axial, to: Axial, side: Side, targetUid: string | null): { clear: boolean; blockedAt: Axial | null } =>
  Los.trace(s, from, to, { side, targetUid })
export const unitAt = (s: GameState, h: Axial): EngineUnit | null => State.unitAt(s, h)
export const garrisonAt = (s: GameState, h: Axial): Garrison | null => State.garrisonAt(s, h)
export const terrainKind = (s: GameState, kind: string): any => s.rules.terrain[kind]
export const isEngaged = (s: GameState, side: Side, h: Axial): boolean => State.isEngaged(s, side, h)

/** Who must act now: the side a paused attack is waiting on, otherwise the activating side. */
export function deciderSide(s: GameState): Side | null {
  if (s.pending) {
    if (s.pending.side !== undefined && s.pending.side !== null) return s.pending.side
    if (s.pending.uid && s.units[s.pending.uid]) return s.units[s.pending.uid]!.side
  }
  return s.activation ? s.activation.side : null
}

export function displayName(id: string): string {
  return Names.displayName(id)
}

export function sideName(side: Side): string {
  return Names.sideName(side)
}

export const UI = Names.UI as Record<string, string>
