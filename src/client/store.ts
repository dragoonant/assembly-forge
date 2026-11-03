// Client state. The engine state is the truth; everything else here is interface state (what is armed, selected, hovered,
// which screen is up). Components read it with `useGame`, and the controller in game.ts is the only writer of `game`.
import { create } from 'zustand'
import type { Axial, GameState, LogEntry, Side } from './engine'

export type Screen = 'select' | 'brief' | 'play'
export type Speed = 'normal' | 'fast' | 'instant'

export interface DiceView {
  outcome: LogEntry
  attacker: string
  target: string
  weapon: string
  auto: boolean
}

export interface GameStore {
  screen: Screen
  myTeam: string | null
  foeTeam: string | null
  game: GameState | null
  /** The weapon the player has picked and is choosing a target for. */
  armed: string | null
  /** The unit whose card is pinned open. */
  selected: string | null
  /** The unit under the pointer, for the hover card. */
  hoverUnit: string | null
  hoverHex: Axial | null
  /** True while dice are rolling or the AI is acting: the board takes no input. */
  busy: boolean
  dice: DiceView | null
  speed: Speed
  /** Which sides the AI plays. The human is side 0 unless both are AI (spectating, and the e2e test). */
  ai: [boolean, boolean]
  /** Bumped on every engine state change, so derived data can memo on it. */
  rev: number
}

export const HUMAN: Side = 0

export const useGame = create<GameStore>(() => ({
  screen: 'select',
  myTeam: null,
  foeTeam: null,
  game: null,
  armed: null,
  selected: null,
  hoverUnit: null,
  hoverHex: null,
  busy: false,
  dice: null,
  speed: 'normal',
  ai: [false, true],
  rev: 0,
}))

export const getStore = useGame.getState
export const setStore = useGame.setState
