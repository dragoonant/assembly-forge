// A board object's model (an objective pylon, a garrison, a base pad, a pickup, a wreck): the generated GLB in
// public/assets/models/props/<name>.glb when it is listed below, otherwise the primitive fallback it was given. Each model
// is normalised once on load, fitted to the requested width or height, centred, with its foot on y = 0 (docs/figures.md,
// "Board objects"). A model that fails to load falls back too, so the board always draws.
import { useGLTF } from '@react-three/drei'
import { Component, Suspense, useMemo, type ReactNode } from 'react'
import { Box3, Vector3, type Object3D } from 'three'

/** Props with a finished model. Add a name here in the same commit as its GLB. */
export const ENABLED_PROPS: readonly string[] = ['objective', 'garrison', 'base', 'crate', 'energy', 'wreck_a', 'wreck_b']

const propUrl = (name: string): string => import.meta.env.BASE_URL + 'assets/models/props/' + name + '.glb'

function PropModel({ name, width, height }: { name: string; width?: number; height?: number }) {
  const gltf = useGLTF(propUrl(name))
  const node = useMemo(() => {
    const root: Object3D = gltf.scene.clone(true)
    const size = new Box3().setFromObject(root).getSize(new Vector3())
    const across = Math.max(size.x, size.z)
    const k = height !== undefined ? height / Math.max(size.y, 1e-6) : (width ?? 0.8) / Math.max(across, 1e-6)
    root.scale.setScalar(k)
    const box = new Box3().setFromObject(root)
    const c = box.getCenter(new Vector3())
    root.position.set(-c.x, -box.min.y, -c.z)
    root.traverse((o) => {
      o.castShadow = true
      o.receiveShadow = true
    })
    return root
  }, [gltf, width, height])
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

/**
 * @param width fit the model's widest horizontal extent to this many world units (a hex is 1 across the flats)
 * @param height fit its height instead
 */
export function Prop({ name, width, height, fallback }: { name: string; width?: number; height?: number; fallback: ReactNode }) {
  if (!ENABLED_PROPS.includes(name)) return <>{fallback}</>
  return (
    <Fallback fallback={fallback}>
      <Suspense fallback={fallback}>
        <PropModel name={name} width={width} height={height} />
      </Suspense>
    </Fallback>
  )
}
