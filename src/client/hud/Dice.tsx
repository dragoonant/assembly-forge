// The dice panel. The engine has already rolled: the panel tumbles for a moment and then lands on the faces that exist,
// so the board updates with the damage when the player continues. The opponent's dice roll and close by themselves.
import { useEffect, useState } from 'react'
import { Names } from '../engine'
import { closeDice } from '../game'
import { useGame } from '../store'

const SPIN_MS = 620

function isHit(face: number, shift: number, accuracy: number, critFrom: number): boolean {
  if (face === 1) return false
  if (face >= critFrom) return true
  return face + shift >= accuracy
}

export function Dice() {
  const dice = useGame((s) => s.dice)
  const rules = useGame((s) => s.game?.rules)
  const [phase, setPhase] = useState<'ready' | 'spin' | 'done'>('ready')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setPhase('ready')
  }, [dice])

  useEffect(() => {
    if (!dice) return
    if (dice.auto && phase === 'ready') {
      const t = setTimeout(() => setPhase('spin'), 300)
      return () => clearTimeout(t)
    }
    if (phase === 'spin') {
      const iv = setInterval(() => setTick((n) => n + 1), 55)
      const t = setTimeout(() => setPhase('done'), SPIN_MS)
      return () => {
        clearInterval(iv)
        clearTimeout(t)
      }
    }
    if (phase === 'done' && dice.auto) {
      const t = setTimeout(closeDice, 1100)
      return () => clearTimeout(t)
    }
    return undefined
  }, [dice, phase])

  if (!dice || !rules) return null
  const o = dice.outcome
  const faces: number[] = o.rerolls || o.rolls
  const accuracy = rules.combat.defaultAccuracy
  const critFrom = rules.combat.critFrom
  const go = () => (phase === 'ready' ? setPhase('spin') : phase === 'done' ? closeDice() : undefined)

  return (
    <div className="overlay dice" data-testid="dice">
      <div className="dice-panel">
        <div className="dice-who">{dice.attacker} → {dice.target}</div>
        <div className="dim">{dice.weapon}</div>
        <div className="dice-terms">
          <span>{o.dice} dice</span>
          <span>hits on {accuracy}+</span>
          {o.shift !== 0 && <span className={o.shift > 0 ? 'good' : 'bad'}>{(o.shift > 0 ? '+' : '') + o.shift} to each die</span>}
          {o.disarmed && <span className="bad">{Names.STATUSES.disarm}</span>}
        </div>
        <div className="tray">
          {faces.map((f, i) => {
            const shown = phase === 'done' ? f : phase === 'spin' ? 1 + ((tick * 7 + i * 3) % 10) : '?'
            const cls = phase === 'done' ? (isHit(f, o.shift, accuracy, critFrom) ? ' hit' : ' miss') + (f >= critFrom ? ' crit' : '') : phase === 'spin' ? ' spin' : ''
            return <div key={i} className={'die' + cls}>{shown}</div>
          })}
        </div>
        {phase === 'done' && (
          <div className={'dice-result' + (o.destroyed ? ' kill' : o.damage > 0 ? ' good' : '')}>
            <strong>{o.hits}</strong> hit{o.hits === 1 ? '' : 's'}
            {o.crits > 0 && <> · <strong>{o.crits}</strong> critical{o.crits === 1 ? '' : 's'}</>}
            {o.absorbed > 0 && <> · {o.absorbed} absorbed</>}
            <div className="dice-damage">{o.damage > 0 ? o.damage + ' damage' : 'No damage'}{o.destroyed ? ' — destroyed' : ''}</div>
            {o.status && <div>{Names.STATUSES[o.status] ?? o.status} applied</div>}
          </div>
        )}
        {!dice.auto && (
          <button className="setup-go" data-testid="dice-go" disabled={phase === 'spin'} onClick={go}>
            {phase === 'ready' ? 'Roll' : phase === 'spin' ? 'Rolling…' : 'Continue'}
          </button>
        )}
      </div>
    </div>
  )
}
