// The app shell: the 3D board under the HUD, plus the setup overlay and the dice panel.
//
// URL switches, for spectating and for the e2e suite:
//   ?ai=both     the AI plays both sides (spectate)        ?ai=none   hotseat, both sides human
//   ?speed=fast|instant                                     opponent pacing
//   ?team=t_lance&foe=t_anvil&seed=x&auto=1                 skip setup and start that match
import { useEffect } from 'react'
import { BoardCanvas } from './board/BoardCanvas'
import { frameFor, hexToWorld, topOf } from './board/hexLayout'
import { viewApi } from './board/viewApi'
import { aiChoose, cellsOf, isTerminal, legalActions, type Action, type GameState } from './engine'
import { pool, squadSize } from './squads'
import { deploy, maybeRunAI, setSpeed, setSquads, take } from './game'
import { battleMusic, loadMuted, music } from './audio/sound'
import { setSlowmo, skipBeat } from './presentation/director'
import { closestPair, demoShot, demoWreck, focus, seekBeat, seekWreck } from './presentation/review'
import type { FxKind } from './presentation/weaponFx'
import { Dice } from './hud/Dice'
import { Hud } from './hud/Hud'
import { Setup } from './hud/Setup'
import { getStore, setStore, type Speed } from './store'

declare global {
  interface Window {
    __game?: {
      ready: boolean
      state: () => GameState | null
      screen: () => string
      legal: () => Action[]
      take: (a: Action) => void
      aiChoose: () => Action | null
      over: () => boolean
      busy: () => boolean
      beat: () => string | null
      effects: () => { bursts: number; wrecks: number; floats: number; banner: string | null }
      camera: typeof viewApi.camera
      setView: typeof viewApi.setView
      resetView: () => void
      hexToScreen: (q: number, r: number) => { x: number; y: number } | null
      setSpeed: (s: Speed) => void
      /** Review hooks for the attack effects (presentation/review.ts); they never touch the engine state. */
      fx: {
        pair: typeof closestPair
        shot: (kind: FxKind, opts?: { area?: boolean; miss?: boolean }) => Promise<void>
        wreck: () => void
        seek: (t: number) => void
        seekWreck: (k: number) => void
        skip: () => void
        focus: typeof focus
      }
    }
  }
}

/** The four preset squads the e2e suite and old links name. */
const PRESETS: Record<string, string[]> = {
  t_lance: ['u03', 'u02', 'u01'],
  t_hammer: ['u05', 'u04', 'u01'],
  t_anvil: ['u06', 'u01', 'u04'],
  t_spear: ['u05', 'u03', 'u02'],
}

function squadParam(v: string | null): string[] | null {
  if (!v) return null
  if (PRESETS[v]) return PRESETS[v]!.slice()
  const ids = v.split(',').filter((d) => pool().includes(d))
  return ids.length === squadSize() ? ids : null
}

function readParams(): void {
  const p = new URLSearchParams(window.location.search)
  const ai = p.get('ai')
  if (ai === 'both') setStore({ ai: [true, true], aiBase: [true, true] })
  else if (ai === 'none') setStore({ ai: [false, false], aiBase: [false, false] })
  const speed = p.get('speed')
  if (speed === 'fast' || speed === 'instant') setStore({ speed: speed as Speed })
  if (p.has('slowmo')) setSlowmo(Number(p.get('slowmo')))
  // squads: `?squad=u01,u02,u03&foe=u04,u05,u06`, or the old preset names (`?team=t_lance&foe=t_hammer`)
  const mine = squadParam(p.get('squad') ?? p.get('team'))
  const foe = squadParam(p.get('foe')) ?? mine
  if (mine && foe) setSquads(mine, foe)
  if (p.get('auto') === '1' && getStore().mySquad.length) deploy(p.get('seed') ?? undefined)
}

function installHooks(): void {
  window.__game = {
    ready: true,
    state: () => getStore().game,
    screen: () => getStore().screen,
    legal: () => {
      const g = getStore().game
      return g ? legalActions(g) : []
    },
    take: (a) => take(a),
    aiChoose: () => {
      const g = getStore().game
      return g ? aiChoose(g) : null
    },
    over: () => {
      const g = getStore().game
      return Boolean(g && isTerminal(g))
    },
    busy: () => getStore().busy,
    beat: () => getStore().beat?.kind ?? null,
    effects: () => {
      const s = getStore()
      return { bursts: s.bursts.length, wrecks: s.wrecks.length, floats: s.floats.length, banner: s.banner?.text ?? null }
    },
    camera: () => viewApi.camera(),
    setView: (v) => viewApi.setView(v),
    resetView: () => viewApi.reset(),
    setSpeed: (sp) => setSpeed(sp),
    fx: { pair: closestPair, shot: demoShot, wreck: demoWreck, seek: seekBeat, seekWreck, skip: skipBeat, focus },
    hexToScreen: (q, r) => {
      const g = getStore().game
      if (!g) return null
      const cell = g.board.hexes[q + ',' + r]
      if (!cell) return null
      const p = hexToWorld({ q, r }, frameFor(cellsOf(g)))
      return viewApi.project(p.x, topOf(cell), p.z)
    },
  }
}

export function App() {
  useEffect(() => {
    installHooks()
    loadMuted()
    readParams()
    maybeRunAI()
    // any click while an animation beat is playing skips to its end
    const onDown = (): void => {
      if (getStore().beat) skipBeat()
    }
    // browsers only allow audio after a gesture: start the setup music on the first one
    const onFirst = (): void => {
      if (getStore().screen !== 'play') music(true)
      else battleMusic(true)
      window.removeEventListener('pointerdown', onFirst)
    }
    // a long press must not select text or open the context menu (the CSS covers most browsers; this catches the rest)
    const typing = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
    const noSelect = (e: Event): void => {
      if (!typing(e.target)) e.preventDefault()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerdown', onFirst)
    document.addEventListener('selectstart', noSelect)
    document.addEventListener('contextmenu', noSelect)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerdown', onFirst)
      document.removeEventListener('selectstart', noSelect)
      document.removeEventListener('contextmenu', noSelect)
    }
  }, [])
  return (
    <div className="app">
      <BoardCanvas />
      <Hud />
      <Setup />
      <Dice />
    </div>
  )
}
