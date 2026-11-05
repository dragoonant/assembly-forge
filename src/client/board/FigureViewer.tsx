// A figure turntable for checking models and their clips: `?viewer=<defId>`, with optional `&clip=<name>` (default
// idle), `&t=<seconds>` to freeze the clip at a moment (for screenshots) and `&yaw=<degrees>`. It renders the real
// Figure component, so what it shows is what the board plays. Opened by the e2e figure test; not linked from the game.
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useMemo } from 'react'
import { Figure, ENABLED_MODELS } from './Figure'
import { MotionContext } from './motionCue'

const CLIPS = ['idle', 'walk', 'jump', 'fly', 'melee', 'shoot', 'hit', 'destroyed']

export function FigureViewer({ params }: { params: URLSearchParams }) {
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
