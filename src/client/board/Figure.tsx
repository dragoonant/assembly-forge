// A machine's figure: the generated model when one is enabled for its id, otherwise the procedural stand-in. A model that
// fails to load falls back to the stand-in, so a half-finished set of GLBs still plays.
//
// Two kinds of model (docs/figures.md):
//   - a rigged model (it carries animation clips) is already at game scale, feet on y = 0, facing +z. It plays its clips:
//     the unit mover says which through MotionContext, and the figure cross-fades to it.
//   - a static model is normalised once on load: scaled to the machine height, feet on y = 0, centred over the hex.
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Component, Suspense, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { AnimationMixer, Box3, LoopOnce, LoopRepeat, Vector3, type AnimationAction, type Object3D } from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { Rig, MACHINE_HEIGHT } from './Machine'
import { MotionContext } from './motionCue'
import { smoothNormals } from './smoothNormals'

/**
 * Definition ids with a finished model in `public/assets/models/<id>.glb`. Add an id here in the same commit as its GLB.
 * Listing them explicitly means the game never requests a file that is not there.
 */
export const ENABLED_MODELS: readonly string[] = ['u01', 'u02', 'u03', 'u04', 'u05', 'u06', 'u07', 'u08', 'u09', 'u10', 'u11', 'u12', 'u13', 'u14', 'u15']

/** Clips that loop; every other clip plays once and holds its last pose. */
const LOOPING = new Set(['idle', 'walk', 'fly'])
const FADE_S = 0.15
/** A once-only clip is sped up to fit its beat, but never more than this. */
const MAX_SPEED = 1.8

export const modelUrl = (defId: string): string => import.meta.env.BASE_URL + 'assets/models/' + defId + '.glb'

function StaticModel({ scene }: { scene: Object3D }) {
  const node = useMemo(() => {
    const root: Object3D = scene.clone(true)
    const box = new Box3().setFromObject(root)
    const size = box.getSize(new Vector3())
    const k = size.y > 0 ? MACHINE_HEIGHT / size.y : 1
    root.scale.setScalar(k)
    const scaled = new Box3().setFromObject(root)
    const c = scaled.getCenter(new Vector3())
    root.position.set(-c.x, -scaled.min.y, -c.z)
    root.traverse((o) => {
      o.castShadow = true
      o.receiveShadow = true
    })
    return root
  }, [scene])
  return <primitive object={node} />
}

function RiggedModel({ scene, clips, pose, frozenAt }: { scene: Object3D; clips: import('three').AnimationClip[]; pose?: string; frozenAt?: number | null }) {
  const cue = useContext(MotionContext)
  const { root, mixer, actions } = useMemo(() => {
    const root = cloneSkinned(scene)
    root.traverse((o) => {
      o.castShadow = true
      o.receiveShadow = true
      // a skinned mesh's bounds are its rest pose; an animated limb can leave them
      o.frustumCulled = false
    })
    const mixer = new AnimationMixer(root)
    const actions = new Map<string, AnimationAction>()
    for (const c of clips) {
      const a = mixer.clipAction(c)
      a.setLoop(LOOPING.has(c.name) ? LoopRepeat : LoopOnce, Infinity)
      a.clampWhenFinished = true
      actions.set(c.name, a)
    }
    return { root, mixer, actions }
  }, [scene, clips])
  const playing = useRef<{ name: string; action: AnimationAction } | null>(null)
  useEffect(() => {
    ;(window as unknown as { __figureReady?: boolean }).__figureReady = true
    // let the attack effects find this model's bones (only a figure under a unit mover has a cue to write to)
    if (cue && !pose) cue.model = root
    return () => {
      mixer.stopAllAction()
      if (cue && cue.model === root) cue.model = null
    }
  }, [mixer, cue, root, pose])

  useFrame((_, dt) => {
    const want = pose ?? cue?.current.clip ?? 'idle'
    const beatS = pose ? 0 : cue?.current.beatS ?? 0
    const next = actions.get(want) ?? actions.get('idle')
    if (next && playing.current?.action !== next) {
      const prev = playing.current?.action
      next.reset()
      const len = next.getClip().duration
      next.timeScale = !LOOPING.has(want) && beatS > 0 ? Math.min(MAX_SPEED, Math.max(1, len / beatS)) : 1
      next.play()
      if (prev && frozenAt == null) prev.crossFadeTo(next, FADE_S, false)
      else if (prev) prev.stop()
      playing.current = { name: want, action: next }
    }
    const at = pose ? undefined : cue?.current.at
    if (at !== undefined && next) {
      // driven by the beat: hold the clip where the beat says, still cross-fading in from the last one
      next.timeScale = 0
      next.time = Math.min(at, next.getClip().duration)
      mixer.update(Math.min(dt, 0.1))
      return
    }
    if (frozenAt != null && next) {
      // hold one moment of the clip, for screenshots
      next.time = Math.min(frozenAt, next.getClip().duration)
      mixer.update(0)
      return
    }
    mixer.update(Math.min(dt, 0.1))
  })
  return <primitive object={root} />
}

function Model({ defId, pose, frozenAt }: { defId: string; pose?: string; frozenAt?: number | null }) {
  const gltf = useGLTF(modelUrl(defId))
  // the models carry per-face normals (smoothNormals.ts); smooth them once per loaded file, before any clone
  useMemo(() => smoothNormals(gltf.scene), [gltf.scene])
  return gltf.animations.length ? (
    <RiggedModel scene={gltf.scene} clips={gltf.animations} pose={pose} frozenAt={frozenAt} />
  ) : (
    <StaticModel scene={gltf.scene} />
  )
}

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * @param pose a clip to hold regardless of the current beat: 'destroyed' for a wreck, 'fly' for a machine dropping in.
 * @param frozenAt hold the clip at this many seconds instead of playing it (the figure viewer's screenshots).
 */
export function Figure({ defId, side, pose, frozenAt }: { defId: string; side: 0 | 1; pose?: string; frozenAt?: number | null }) {
  const standIn = <Rig defId={defId} side={side} />
  if (!ENABLED_MODELS.includes(defId)) return standIn
  return (
    <Fallback fallback={standIn}>
      {/* nothing while the model loads (it is preloaded at startup, preload.ts); the stand-in only if it fails */}
      <Suspense fallback={null}>
        <Model defId={defId} pose={pose} frozenAt={frozenAt} />
      </Suspense>
    </Fallback>
  )
}
