// A figure turntable for checking models and their clips: `?viewer=<defId>`, with optional `&clip=<name>` (default
// idle), `&t=<seconds>` to freeze the clip at a moment (for screenshots) and `&yaw=<degrees>`. It renders the real
// Figure component, so what it shows is what the board plays. Opened by the e2e figure test; not linked from the game.
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import { Box3, Vector3, type Group, type PerspectiveCamera } from 'three'
import { Figure, ENABLED_MODELS } from './Figure'
import { MotionContext } from './motionCue'

const CLIPS = ['idle', 'walk', 'jump', 'fly', 'melee', 'shoot', 'hit', 'destroyed']

/**
 * Portrait mode, `?viewer=<id>&portrait=bust|full`: the figure alone on a transparent background under a warm key light
 * and a cool rim light, framed on the head and chest (bust, for the squad-select grid) or the whole machine (full, for
 * the unit card's art). `tools/render-portraits.mjs` screenshots it into `public/assets/portraits/`.
 */
function Portrait({ defId, framing, clip, frozen, yaw }: { defId: string; framing: string; clip: string; frozen: number | null; yaw: number }) {
  const cue = useMemo(() => ({ current: { clip, beatS: 0 } }), [clip])
  const bust = framing === 'bust'
  const group = useRef<Group>(null)
  useEffect(() => {
    // the app's own page background would show through the transparent canvas
    for (const el of [document.documentElement, document.body, document.getElementById('root')]) if (el) el.style.background = 'transparent'
  }, [])
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'transparent' }}>
      <Canvas
        gl={{ alpha: true, preserveDrawingBuffer: true, antialias: true }}
        camera={{ position: [0, 0.6, 3], fov: 30 }}
        onCreated={({ gl, camera }) => {
          gl.setClearColor(0x000000, 0)
          camera.lookAt(0, 0.5, 0)
        }}
        data-testid="viewer-canvas"
      >
        <hemisphereLight args={['#dfe8ff', '#2a2420', 0.7]} />
        <directionalLight position={[2.2, 3, 2.6]} intensity={2.4} color="#fff1dc" />
        <directionalLight position={[-2.6, 1.6, -1.8]} intensity={2.2} color="#7fc4ff" />
        <directionalLight position={[0, -1, 2]} intensity={0.35} color="#ffb070" />
        <group ref={group} rotation={[0, yaw, 0]}>
          <MotionContext.Provider value={cue}>
            <Figure defId={defId} side={0} frozenAt={frozen} />
          </MotionContext.Provider>
        </group>
        <FitCamera group={group} bust={bust} />
      </Canvas>
    </div>
  )
}

/**
 * Frames the posed model from its real bounds once it has loaded: the whole machine with a margin (full), or the top
 * 45% of it, head and chest (bust). Sets `window.__portraitFramed` for the render script.
 */
function FitCamera({ group, bust }: { group: React.RefObject<Group | null>; bust: boolean }) {
  const { camera, size } = useThree()
  const frames = useRef(0)
  useFrame(() => {
    const g = group.current
    if (!g || frames.current > 40) return
    frames.current++
    if (frames.current < 8) return // let the clip pose settle
    const box = new Box3().setFromObject(g, true)
    if (box.isEmpty()) return
    const lo = box.min.clone()
    const hi = box.max.clone()
    if (bust) lo.y = hi.y - (hi.y - box.min.y) * 0.45
    const centre = lo.clone().add(hi).multiplyScalar(0.5)
    const span = hi.clone().sub(lo)
    const cam = camera as PerspectiveCamera
    const vfov = (cam.fov * Math.PI) / 180
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (size.width / size.height))
    const margin = bust ? 1.08 : 1.12
    // width from the sideways extent only: a weapon pointing at the camera must not push it back
    const dist = Math.max((span.y * margin) / 2 / Math.tan(vfov / 2), (span.x * margin) / 2 / Math.tan(hfov / 2)) + 0.25
    const dir = new Vector3(0.12, bust ? 0.08 : 0.12, 1).normalize()
    cam.position.copy(centre).addScaledVector(dir, dist)
    cam.lookAt(centre)
    cam.updateProjectionMatrix()
    const w = window as unknown as { __portraitFramed?: boolean; __portraitBox?: number[] }
    w.__portraitBox = [...box.min.toArray(), ...box.max.toArray()]
    if (frames.current > 30) w.__portraitFramed = true
  })
  return null
}

export function FigureViewer({ params }: { params: URLSearchParams }) {
  if (params.has('portrait')) {
    return (
      <Portrait
        defId={params.get('viewer') ?? 'u02'}
        framing={params.get('portrait') ?? 'bust'}
        clip={params.get('clip') ?? 'idle'}
        frozen={params.has('t') ? Number(params.get('t')) : 0.4}
        yaw={(Number(params.get('yaw') ?? 24) * Math.PI) / 180}
      />
    )
  }
  const defId = params.get('viewer') ?? 'u02'
  const clip = params.get('clip') ?? 'idle'
  const frozen = params.has('t') ? Number(params.get('t')) : null
  const yaw = (Number(params.get('yaw') ?? 30) * Math.PI) / 180
  const cue = useMemo(() => ({ current: { clip, beatS: 0 } }), [clip])
  const link = (c: string) => `?viewer=${defId}&clip=${c}`
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1a1d22' }}>
      <Canvas shadows camera={{ position: [0, 0.75, 2.3], fov: 35 }} data-testid="viewer-canvas">
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 4, 3]} intensity={1.6} castShadow />
        <directionalLight position={[-3, 2, -2]} intensity={0.5} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[0.9, 48]} />
          <meshStandardMaterial color="#3a3f47" />
        </mesh>
        <group rotation={[0, yaw, 0]}>
          <MotionContext.Provider value={cue}>
            <Figure defId={defId} side={0} pose={clip === 'destroyed' ? 'destroyed' : undefined} frozenAt={frozen} />
          </MotionContext.Provider>
        </group>
        <OrbitControls target={[0, 0.5, 0]} />
      </Canvas>
      <div style={{ position: 'absolute', top: 8, left: 8, color: '#ddd', font: '13px sans-serif' }}>
        {defId} {ENABLED_MODELS.includes(defId) ? '(model)' : '(stand-in)'} · {clip}
        {frozen !== null ? ` at ${frozen}s` : ''}
        <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
          {CLIPS.map((c) => (
            <a key={c} href={link(c)} style={{ color: c === clip ? '#f0c040' : '#9ab' }}>
              {c}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
