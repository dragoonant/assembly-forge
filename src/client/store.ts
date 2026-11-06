// Client state. The engine state is the truth; everything else here is interface state (what is armed, selected, hovered,
// which screen is up). Components read it with `useGame`, and the controller in game.ts is the only writer of `game`.
import { create } from 'zustand'
import type { Action, Axial, GameState, LogEntry, Side } from './engine'
import type { Beat } from './presentation/plan'
import type { Difficulty } from './squads'

const DIFFICULTY_KEY = 'assembly-forge.difficulty'
function savedDifficulty(): Difficulty {
  try {
    const v = localStorage.getItem(DIFFICULTY_KEY)
    return v === 'easy' || v === 'hard' || v === 'random' ? v : 'hard'
  } catch {
    return 'hard'
  }
}
export function saveDifficulty(d: Difficulty): void {
  try {
    localStorage.setItem(DIFFICULTY_KEY, d)
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}

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
  /** The player's squad as it is being picked, and the CPU's once it has picked (null until then). */
  mySquad: string[]
  foeSquad: string[] | null
  /** How the CPU picks its squad. */
  difficulty: Difficulty
  /** The player's chosen Tactics deck; null means the suggested one. */
  myDeck: string[] | null
  game: GameState | null
  /** The weapon the player has picked and is choosing a target for. */
  armed: string | null
  /** The action-bar button whose description is open (a second tap on it confirms). */
  openItem: string | null
  /** Targeted plays waiting on a tap: the open button's choices, one per target unit. A tap on that unit's hex takes it. */
  picks: Action[] | null
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
  /** What `ai` goes back to on a new game: the URL's `?ai=` choice, or the CPU on side 1. */
  aiBase: [boolean, boolean]
  /** Watching the CPU play both sides, started from the select screen; Take over hands side 0 back. */
  watching: boolean
  /** Bumped on every engine state change, so derived data can memo on it. */
  rev: number
  /** The blocking animation beat now playing, with its start time (performance.now) and length in ms. */
  beat: Beat | null
  beatStart: number
  beatMs: number
  /** Non-blocking effects, each with the time it was born. */
  bursts: { id: number; at: Axial; colour: string; born: number }[]
  /** A destroyed machine flying off the board, for `ms`. */
  wrecks: { id: number; defId: string; side: Side; at: Axial; born: number; ms: number }[]
  floats: { id: number; at: Axial; text: string; colour: string; born: number }[]
  scorches: { id: number; at: Axial; phase: number; round: number }[]
  banner: { text: string; born: number } | null
  /** When each unit last took damage (performance.now), so its figure can flinch. */
  hurt: Record<string, number>
  muted: boolean
}

export const HUMAN: Side = 0

export const useGame = create<GameStore>(() => ({
  screen: 'select',
  mySquad: [],
  foeSquad: null,
  difficulty: savedDifficulty(),
  myDeck: null,
  game: null,
  armed: null,
  openItem: null,
  picks: null,
  selected: null,
  hoverUnit: null,
  hoverHex: null,
  busy: false,
  dice: null,
  speed: 'normal',
  ai: [false, true],
  aiBase: [false, true],
  watching: false,
  rev: 0,
  beat: null,
  beatStart: 0,
  beatMs: 0,
  bursts: [],
  wrecks: [],
  floats: [],
  scorches: [],
  banner: null,
  hurt: {},
  muted: false,
}))

export const getStore = useGame.getState
export const setStore = useGame.setState
