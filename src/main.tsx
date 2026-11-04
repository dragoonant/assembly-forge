import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './client/App'
import { loadPacks } from './client/packs'
import './client/theme.css'

// the roster pack must be chosen before anything reads a name or a unit definition
loadPacks()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
