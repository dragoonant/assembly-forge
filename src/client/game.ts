// The controller: the only code that changes the engine state. Every action, the player's or the AI's, goes through
// `perform`: apply it with the engine, play the blocking animation beats (a walk, a deploy, a shot), show the dice for an
// attack, then commit the new state and start the effects (bursts, wrecks, labels, banners). The board therefore never
// jumps to a result before the motion that caused it, and damage lands with the dice (the 2D game's rule, kept).
import { apply, deciderSide, displayName, isTerminal, newSkirmish, aiChoose, type Action, type GameState } from './engine'
import { canAdd, cpuSquad, squadSize, type Difficulty } from './squads'
import { preloadSquads } from './board/preload'
import { battleMusic, music } from './audio/sound'
import { clearEffects, runBeats, runEffects, SPEED_FACTOR } from './presentation/director'
import { newEntries, plan } from './presentation/plan'
import { getStore, saveDifficulty, setStore, type Speed } from './store'

/** Pause between AI actions, so a person can see what happened. Instant is for tests and spectating. */
const STEP_MS: Record<Speed, number> = { normal: 380, fast: 140, instant: 0 }

let aiTimer: ReturnType<typeof setTimeout> | null = null
let diceDone: (() => void) | null = null
/** Bumped on every new game, so a pending animation from the old game cannot commit into the new one. */
let epoch = 0

function stopAI(): void {
  if (aiTimer) clearTimeout(aiTimer)
  aiTimer = null
}

function commit(next: GameState): void {
  setStore((s) => ({ game: next, rev: s.rev + 1, dice: null, armed: null, openItem: null, picks: null }))
}

/** Back to squad select. */
export function newGame(): void {
  stopAI()
  epoch++
  diceDone = null
  clearEffects()
  setStore({ screen: 'select', mySquad: [], foeSquad: null, myDeck: null, game: null, armed: null, openItem: null, picks: null, selected: null, busy: false, dice: null })
  battleMusic(false)
  music(true)
}

/** Add a machine to the player's squad (the select screen checks it may join). Any change re-opens the CPU's pick. */
export function addToSquad(defId: string): void {
  const { mySquad } = getStore()
  if (!canAdd(mySquad, defId)) return
  setStore({ mySquad: mySquad.concat([defId]), foeSquad: null, myDeck: null })
  music(true)
}

export function removeFromSquad(i: number): void {
  const next = getStore().mySquad.filter((_, j) => j !== i)
  setStore({ mySquad: next, foeSquad: null, myDeck: null })
}

export function clearSquads(): void {
  setStore({ mySquad: [], foeSquad: null, myDeck: null })
}

export function setDifficulty(d: Difficulty): void {
  saveDifficulty(d)
  setStore({ difficulty: d, foeSquad: null })
}

/** The CPU picks its squad against the player's full squad, at the chosen difficulty. */
export function rollCpuSquad(seed?: string): void {
  const { mySquad, difficulty } = getStore()
  if (mySquad.length < squadSize()) return
  setStore({ foeSquad: cpuSquad(mySquad, difficulty, seed ?? 'squad-' + Date.now()) })
}

/** Set both squads at once (URL switches and tests). */
export function setSquads(mine: string[], foe: string[]): void {
  setStore({ mySquad: mine.slice(), foeSquad: foe.slice(), myDeck: null })
}

export function toBrief(): void {
  const { mySquad, foeSquad } = getStore()
  if (mySquad.length >= squadSize() && foeSquad) {
    preloadSquads([...mySquad, ...foeSquad])
    setStore({ screen: 'brief' })
  }
}

/** Toggle a card in the player's deck, starting from the suggested nine. */
export function toggleDeckCard(cid: string, suggested: string[]): void {
  const cur = getStore().myDeck ?? suggested
  const next = cur.indexOf(cid) === -1 ? cur.concat([cid]) : cur.filter((c) => c !== cid)
  setStore({ myDeck: next })
}

export function resetDeck(): void {
  setStore({ myDeck: null })
}

export function toSelect(): void {
  setStore({ screen: 'select' })
}

/** Build the match and start playing. */
export function deploy(seed?: string): void {
  const { mySquad, foeSquad, myDeck } = getStore()
  preloadSquads([...mySquad, ...(foeSquad ?? [])])
  stopAI()
  epoch++
  clearEffects()
  music(false)
  battleMusic(true)
  const game = newSkirmish(seed ?? 'game-' + Date.now(), mySquad.length ? mySquad : undefined, foeSquad ?? undefined, [myDeck, null])
  setStore((s) => ({ screen: 'play', game, rev: s.rev + 1, armed: null, openItem: null, picks: null, selected: null, busy: false, dice: null }))
  // the opening banner and anything else the setup logged
  const opening = plan(game, game, game.log)
  runEffects(opening.effects.filter((e) => e.kind === 'banner'), game, 0)
  maybeRunAI()
}

/** Is it a human's turn right now? */
export function humanTurn(): boolean {
  const { game, ai, busy } = getStore()
  if (!game || !game.activation || busy || isTerminal(game)) return false
  const d = deciderSide(game)
  return d !== null && !ai[d]
}

function lastAttack(s: GameState) {
  for (let i = s.log.length - 1; i >= 0; i--) if (s.log[i]!.t === 'attack') return s.log[i]!
  return null
}

/** Show the dice for an attack already resolved in `next`. Resolves when the panel is dismissed. */
function showDice(next: GameState, auto: boolean): Promise<void> {
  const o = lastAttack(next)
  if (!o || getStore().speed === 'instant') return Promise.resolve()
  const attacker = next.units[o.uid as string]!
  const target = o.target.kind === 'unit' ? displayName(next.units[o.target.id]!.defId) : 'Garrison'
  return new Promise((resolve) => {
    diceDone = resolve
    setStore({ dice: { outcome: o, attacker: displayName(attacker.defId), target, weapon: displayName(o.wid as string), auto } })
  })
}

/** Called by the dice panel when the player (or the auto timer) dismisses it. */
export function closeDice(): void {
  const done = diceDone
  diceDone = null
  setStore({ dice: null })
  if (done) done()
}

/**
 * Apply an action and present it. Resolves, after the effects have had time to read, with how long to wait before the
 * next action (the AI uses that for pacing).
 */
async function perform(action: Action, byAI: boolean): Promise<number> {
  const game = getStore().game!
  const mine = epoch
  const next = apply(game, action)
  const entries = newEntries(game, next)
  const p = plan(game, next, entries)
  setStore({ busy: true, armed: null, openItem: null, picks: null })
  await runBeats(p.beats)
  // dice whenever this step completed an attack, whatever kind of action finished it (a response, a pass)
  if (entries.some((e) => e.t === 'attack')) await showDice(next, byAI)
  if (mine !== epoch) return 0
  commit(next)
  return runEffects(p.effects, next, p.settle)
}

/** Apply a player's action. */
export function take(action: Action): void {
  const { game, busy } = getStore()
  if (!game || busy || isTerminal(game)) return
  void perform(action, false).then(() => {
    setStore({ busy: false })
    maybeRunAI()
  })
}

/** If the AI is up, play its activation one action at a time. */
export function maybeRunAI(): void {
  stopAI()
  const mine = epoch
  const tick = (): void => {
    const { game, ai } = getStore()
    if (mine !== epoch) return
    const d = game ? deciderSide(game) : null
    if (!game || isTerminal(game) || !game.activation || d === null || !ai[d]) {
      setStore({ busy: false })
      return
    }
    const action = aiChoose(game)
    if (!action) {
      setStore({ busy: false })
      return
    }
    void perform(action, true).then((settle) => {
      if (mine !== epoch) return
      setStore({ busy: true })
      aiTimer = setTimeout(tick, Math.max(STEP_MS[getStore().speed], settle))
    })
  }
  const { game, ai, speed } = getStore()
  const d = game ? deciderSide(game) : null
  if (game && game.activation && d !== null && ai[d] && !isTerminal(game)) {
    setStore({ busy: true })
    aiTimer = setTimeout(tick, STEP_MS[speed] * (SPEED_FACTOR[speed] > 0 ? 1 : 0))
  }
}

export function setSpeed(speed: Speed): void {
  setStore({ speed })
}
