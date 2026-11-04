// Loads content packs at startup and remembers which one the player picked. Packs are found in
// src/content/packs/local/, which git ignores: a pack there exists only on the machine that holds it, so the public build
// (made by CI from the repository) never contains one. See docs/packs.md.
import { Packs } from './engine'

const PACK_KEY = 'assembly-forge.pack'

/** Register every local pack, then activate the remembered choice (or our names). Call once, before the first render. */
export function loadPacks(): void {
  const found = import.meta.glob('../content/packs/local/*.js', { eager: true }) as Record<string, { default?: unknown }>
  for (const path of Object.keys(found)) {
    const mod = found[path]
    if (!mod || !mod.default) continue
    try {
      Packs.register(mod.default)
    } catch (e) {
      // a broken local pack must not take the game down with it; it is reported and skipped
      console.warn('Skipping content pack ' + path + ': ' + (e as Error).message)
    }
  }
  let wanted: string | null = null
  try {
    wanted = window.localStorage.getItem(PACK_KEY)
  } catch {
    wanted = null
  }
  const ids = Packs.list().map((p) => p.id)
  Packs.activate(wanted && ids.includes(wanted) ? wanted : null)
}

/** Switch rosters. Reloads, because every name and definition is read once per game from the active pack. */
export function choosePack(id: string): void {
  try {
    window.localStorage.setItem(PACK_KEY, id)
  } catch {
    // storage unavailable: the choice cannot be remembered, so stay where we are
    return
  }
  window.location.reload()
}
