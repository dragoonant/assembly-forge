// Models are loaded before they are shown, so no machine is ever drawn as its stand-in while it loads (tabletop-kb
// rules.md rule 26). With fifteen machines (about 26 MB) the app no longer fetches every one at startup: it starts on the
// board objects, and each match's six machines start downloading the moment both squads are known, while the player reads
// the briefing. Deploy waits on those loads (useModelsReady). A model that fails to load still falls back to its stand-in
// in Figure.tsx and Prop.tsx.
import { useGLTF, useProgress } from '@react-three/drei'
import { ENABLED_MODELS, modelUrl } from './Figure'
import { ENABLED_PROPS, propUrl } from './Prop'

export const PROP_URLS: readonly string[] = ENABLED_PROPS.map(propUrl)

/** At startup: the board objects every match uses. */
export function preloadModels(): void {
  for (const url of PROP_URLS) useGLTF.preload(url)
}

/** As soon as both squads are known: the machines in this match. */
export function preloadSquads(defIds: string[]): void {
  for (const d of new Set(defIds)) if (ENABLED_MODELS.includes(d)) useGLTF.preload(modelUrl(d))
}

/** Whether every requested model is in, and how far along the loads are. */
export function useModelsReady(): { ready: boolean; loaded: number; total: number } {
  const { active, loaded, total } = useProgress()
  return { ready: !active && loaded >= total, loaded, total }
}
