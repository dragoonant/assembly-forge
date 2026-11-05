// Start downloading every enabled machine and board-object model as soon as the app opens, so no model is ever drawn as
// its stand-in while it loads (tabletop-kb rules.md rule 26). The briefing's Deploy button waits on the same loads
// (useModelsReady). A model that fails to load still falls back to its stand-in in Figure.tsx and Prop.tsx.
import { useGLTF, useProgress } from '@react-three/drei'
import { ENABLED_MODELS, modelUrl } from './Figure'
import { ENABLED_PROPS, propUrl } from './Prop'

export const MODEL_URLS: readonly string[] = [...ENABLED_MODELS.map(modelUrl), ...ENABLED_PROPS.map(propUrl)]

export function preloadModels(): void {
  for (const url of MODEL_URLS) useGLTF.preload(url)
}

/** Whether every preloaded model is in, and how far along the loads are. */
export function useModelsReady(): { ready: boolean; loaded: number; total: number } {
  const { active, loaded, total } = useProgress()
  return { ready: !active && loaded >= total, loaded, total }
}
