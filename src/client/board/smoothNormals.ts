// Hunyuan's texture layout gives every triangle its own three vertices, so the exported normals are per face and a
// machine reads as faceted up close. This recomputes them smoothly: each vertex takes the area-weighted average of the
// face normals around its position, but only from faces within `crease` degrees of its own face, so panel edges and
// armour corners stay hard. Runs once per loaded model; the geometry is changed in place.
import { BufferAttribute, Vector3, type BufferGeometry, type Object3D } from 'three'

export function smoothGeometryNormals(geo: BufferGeometry, crease = 50): void {
  const pos = geo.getAttribute('position')
  if (!pos) return
  const index = geo.getIndex()
  const n = pos.count
  const tri = index ? index.count / 3 : n / 3
  const at = (k: number) => (index ? index.getX(k) : k)
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  // face normals (unnormalised, so their length is twice the area) and each vertex's own face
  const faceN = new Float32Array(tri * 3)
  const vertFace = new Int32Array(n).fill(-1)
  for (let f = 0; f < tri; f++) {
    const i0 = at(f * 3)
    const i1 = at(f * 3 + 1)
    const i2 = at(f * 3 + 2)
    a.fromBufferAttribute(pos, i0)
    b.fromBufferAttribute(pos, i1).sub(a)
    c.fromBufferAttribute(pos, i2).sub(a)
    b.cross(c)
    faceN[f * 3] = b.x
    faceN[f * 3 + 1] = b.y
    faceN[f * 3 + 2] = b.z
    vertFace[i0] = vertFace[i1] = vertFace[i2] = f
  }
  // group vertices by position (quantised to 1e-5 of a unit)
  const groups = new Map<string, number[]>()
  for (let i = 0; i < n; i++) {
    const key = Math.round(pos.getX(i) * 1e5) + ',' + Math.round(pos.getY(i) * 1e5) + ',' + Math.round(pos.getZ(i) * 1e5)
    const g = groups.get(key)
    if (g) g.push(i)
    else groups.set(key, [i])
  }
  const cos = Math.cos((crease * Math.PI) / 180)
  const out = new Float32Array(n * 3)
  const own = new Vector3()
  const other = new Vector3()
  const sum = new Vector3()
  for (const verts of groups.values()) {
    for (const i of verts) {
      const f = vertFace[i]!
      if (f < 0) continue
      own.set(faceN[f * 3]!, faceN[f * 3 + 1]!, faceN[f * 3 + 2]!)
      const ownUnit = own.clone().normalize()
      sum.set(0, 0, 0)
      for (const j of verts) {
        const g = vertFace[j]!
        if (g < 0) continue
        other.set(faceN[g * 3]!, faceN[g * 3 + 1]!, faceN[g * 3 + 2]!)
        if (other.clone().normalize().dot(ownUnit) >= cos) sum.add(other)
      }
      if (sum.lengthSq() === 0) sum.copy(own)
      sum.normalize()
      out[i * 3] = sum.x
      out[i * 3 + 1] = sum.y
      out[i * 3 + 2] = sum.z
    }
  }
  geo.setAttribute('normal', new BufferAttribute(out, 3))
}

/** Smooth every mesh under `root` once (marks the geometry so a shared one is done once). */
export function smoothNormals(root: Object3D, crease = 50): void {
  root.traverse((o) => {
    const geo = (o as { geometry?: BufferGeometry }).geometry
    if (!geo || geo.userData.smoothed) return
    smoothGeometryNormals(geo, crease)
    geo.userData.smoothed = true
  })
}
