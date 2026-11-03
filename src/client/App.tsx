// M0 shell: builds a real match from the engine and shows its board in 3D under the ported camera. No game interface yet (M2).
import { useMemo } from 'react'
import { BoardCanvas, type BoardUnit } from './board/BoardCanvas'
import { viewApi } from './board/viewApi'
import { UI, cellsOf, livingUnits, newSkirmish } from './engine'

declare global {
  interface Window {
    __game?: { ready: boolean; cells: number; units: number; camera: typeof viewApi.camera; setView: typeof viewApi.setView; resetView: () => void }
  }
}

export function App() {
  const game = useMemo(() => newSkirmish('m0'), [])
  const cells = useMemo(() => cellsOf(game), [game])
  // living units are the ones on the battlefield; a unit in Reserve has no hex and is not drawn
  const units = useMemo<BoardUnit[]>(() => livingUnits(game).filter((u) => u.hex).map((u) => ({ uid: u.uid, side: u.side, hex: u.hex! })), [game])

  // test hooks for the e2e suite and headless screenshots
  window.__game = {
    ready: true,
    cells: cells.length,
    units: units.length,
    camera: () => viewApi.camera(),
    setView: (p) => viewApi.setView(p),
    resetView: () => viewApi.reset(),
  }

  return (
    <div className="app">
      <BoardCanvas cells={cells} units={units} bases={game.bases} />
      <header className="topbar">
        <h1>{UI.title}</h1>
        <button className="reset" data-testid="reset-view" onClick={() => viewApi.reset()} title="Reset view (R)">
          ⌖
        </button>
      </header>
    </div>
  )
}
