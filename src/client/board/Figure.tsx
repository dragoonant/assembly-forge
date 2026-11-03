// A machine's figure: the generated model when one is enabled for its id, otherwise the procedural stand-in. Models are
// normalised once on load (docs/figures.md): scaled to the machine height, feet on y = 0, centred over the hex, facing +z.
// A model that fails to load falls back to the stand-in, so a half-finished set of GLBs still plays.
import { useGLTF } from '@react-three/drei'
import { Component, Suspense, useMemo, type ReactNode } from 'react'
import { Box3, Vector3, type Object3D } from 'three'
import { Rig, MACHINE_HEIGHT } from './Machine'

/**
 * Definition ids with a finished model in `public/assets/models/<id>.glb`. Empty until M4: add an id here in the same
 * commit as its GLB. Listing them explicitly means the game never requests a file that is not there.
 */
export const ENABLED_MODELS: readonly string[] = []

const modelUrl = (defId: string): string => import.meta.env.BASE_URL + 'assets/models/' + defId + '.glb'

function Model({ defId }: { defId: string }) {
  const gltf = useGLTF(modelUrl(defId))
  const node = useMemo(() => {
    const root: Object3D = gltf.scene.clone(true)
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
  }, [gltf])
  return <primitive object={node} />
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

export function Figure({ defId, side }: { defId: string; side: 0 | 1 }) {
  const standIn = <Rig defId={defId} side={side} />
  if (!ENABLED_MODELS.includes(defId)) return standIn
  return (
    <Fallback fallback={standIn}>
      <Suspense fallback={standIn}>
        <Model defId={defId} />
      </Suspense>
    </Fallback>
  )
}
