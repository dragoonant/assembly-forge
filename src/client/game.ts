// The controller: the only code that changes the engine state. Every player action goes through `take`, which applies it
// with the engine and hands over to the AI when it is the AI's turn. Attacks show their dice before the new state is
// committed, so damage lands with the roll (the 2D game's rule, kept).
import { apply, displayName, isTerminal, newSkirmish, TEAM_ORDER, aiChoose, type Action, type GameState } from './engine'
import { getStore, setStore, type Speed } from './store'

/** Pause between AI actions, so a person can see what happened. Instant is for tests and spectating. */
const STEP_MS: Record<Speed, number> = { normal: 420, fast: 140, instant: 0 }

let aiTimer: ReturnType<typeof setTimeout> | null = null
let diceDone: (() => void) | null = null

function stopAI(): void {
  if (aiTimer) clearTimeout(aiTimer)
  aiTimer = null
}

function commit(next: GameState): void {
  setStore((s) => ({ game: next, rev: s.rev + 1, busy: false, dice: null, armed: null }))
}

/** Back to squad select. */
export function newGame(): void {
  stopAI()
  diceDone = null
  setStore({ screen: 'select', myTeam: null, foeTeam: null, game: null, armed: null, selected: null, busy: false, dice: null })
}

/** Pick the player's squad; the opponent draws one of the four at random (an interface choice, so Math.random is fine). */
export function chooseTeam(tid: string): void {
  const foe = TEAM_ORDER[Math.floor(Math.random() * TEAM_ORDER.length)]!
  setStore({ myTeam: tid, foeTeam: foe })
}

export function toBrief(): void {
  if (getStore().myTeam) setStore({ screen: 'brief' })
}

export function toSelect(): void {
  setStore({ screen: 'select' })
}

/** Build the match and start playing. */
export function deploy(seed?: string): void {
  const { myTeam, foeTeam } = getStore()
  const game = newSkirmish(seed ?? 'game-' + Date.now(), myTeam ?? undefined, foeTeam ?? undefined)
  setStore((s) => ({ screen: 'play', game, rev: s.rev + 1, armed: null, selected: null, busy: false, dice: null }))
  maybeRunAI()
}

/** Is it a human's turn right now? */
export function humanTurn(): boolean {
  const { game, ai, busy } = getStore()
  return Boolean(game && game.activation && !ai[game.activation.side] && !busy && !isTerminal(game))
}

function lastAttack(s: GameState) {
  for (let i = s.log.length - 1; i >= 0; i--) if (s.log[i]!.t === 'attack') return s.log[i]!
  return null
}

/** Show the dice for an attack already resolved in `next`, then commit it. */
function showDice(next: GameState, auto: boolean): Promise<void> {
  const o = lastAttack(next)
  const { speed } = getStore()
  if (!o || speed === 'instant') return Promise.resolve()
  const attacker = next.units[o.uid as string]!
  const target = o.target.kind === 'unit' ? displayName(next.units[o.target.id]!.defId) : 'Garrison'
  return new Promise((resolve) => {
    diceDone = resolve
    setStore({ busy: true, dice: { outcome: o, attacker: displayName(attacker.defId), target, weapon: displayName(o.wid as string), auto } })
  })
}

/** Called by the dice panel when the player (or the auto timer) dismisses it. */
export function closeDice(): void {
  const done = diceDone
  diceDone = null
  setStore({ dice: null })
  if (done) done()
}

/** Apply a player's action. */
export function take(action: Action): void {
  const { game, busy } = getStore()
  if (!game || busy || isTerminal(game)) return
  const next = apply(game, action)
  if (action.type === 'attack') {
    setStore({ busy: true, armed: null })
    void showDice(next, false).then(() => {
      commit(next)
      maybeRunAI()
    })
    return
  }
  commit(next)
  maybeRunAI()
}

/** If the AI is up, play its activation one action at a time. */
export function maybeRunAI(): void {
  stopAI()
  const tick = (): void => {
    const { game, ai, speed } = getStore()
    if (!game || isTerminal(game) || !game.activation || !ai[game.activation.side]) {
      setStore({ busy: false })
      return
    }
    setStore({ busy: true })
    const action = aiChoose(game)
    if (!action) {
      setStore({ busy: false })
      return
    }
    const next = apply(game, action)
    if (action.type === 'attack') {
      void showDice(next, true).then(() => {
        commit(next)
        setStore({ busy: true })
        aiTimer = setTimeout(tick, STEP_MS[getStore().speed])
      })
      return
    }
    commit(next)
    setStore({ busy: true })
    aiTimer = setTimeout(tick, STEP_MS[speed])
  }
  const { game, ai, speed } = getStore()
  if (game && game.activation && ai[game.activation.side] && !isTerminal(game)) {
    setStore({ busy: true })
    aiTimer = setTimeout(tick, STEP_MS[speed])
  }
}

export function setSpeed(speed: Speed): void {
  setStore({ speed })
}
