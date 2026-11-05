import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './client/App'
import { FigureViewer } from './client/board/FigureViewer'
import { loadPacks } from './client/packs'
import './client/theme.css'

// the roster pack must be chosen before anything reads a name or a unit definition
loadPacks()

const params = new URLSearchParams(window.location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {params.has('viewer') ? <FigureViewer params={params} /> : <App />}
  </StrictMode>,
)
