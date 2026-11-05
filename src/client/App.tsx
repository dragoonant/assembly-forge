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
import { cellsOf, isTerminal, legalActions, teamOrder, type Action, type GameState } from './engine'
import { deploy, maybeRunAI, take } from './game'
import { battleMusic, loadMuted, music } from './audio/sound'
import { skipBeat } from './presentation/director'
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
      over: () => boolean
      busy: () => boolean
      beat: () => string | null
      effects: () => { bursts: number; wrecks: number; floats: number; banner: string | null }
      camera: typeof viewApi.camera
      setView: typeof viewApi.setView
      resetView: () => void
      hexToScreen: (q: number, r: number) => { x: number; y: number } | null
    }
  }
}

function readParams(): void {
  const p = new URLSearchParams(window.location.search)
  const ai = p.get('ai')
  if (ai === 'both') setStore({ ai: [true, true] })
  else if (ai === 'none') setStore({ ai: [false, false] })
  const speed = p.get('speed')
  if (speed === 'fast' || speed === 'instant') setStore({ speed: speed as Speed })
  const team = p.get('team')
  const foe = p.get('foe')
  const order = teamOrder()
  if (team && order.includes(team)) setStore({ myTeam: team, foeTeam: foe && order.includes(foe) ? foe : team })
  if (p.get('auto') === '1' && getStore().myTeam) deploy(p.get('seed') ?? undefined)
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
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerdown', onFirst)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerdown', onFirst)
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
