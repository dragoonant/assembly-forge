import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './client/App'
import { FigureViewer } from './client/board/FigureViewer'
import { preloadModels } from './client/board/preload'
import { loadPacks } from './client/packs'
import './client/theme.css'

// the roster pack must be chosen before anything reads a name or a unit definition
loadPacks()
// every model starts downloading now, so none is ever drawn as its stand-in while it loads
preloadModels()

const params = new URLSearchParams(window.location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {params.has('viewer') ? <FigureViewer params={params} /> : <App />}
  </StrictMode>,
)
