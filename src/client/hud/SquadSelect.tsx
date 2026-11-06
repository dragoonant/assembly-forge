// Squad select as a fighting-game character select: every machine as a portrait tile, the focused one's full card
// beside the grid, and three slots a side under a VS banner. Hover (or a first tap) focuses a machine; a second tap on it
// picks it, the same tap-again rule as the action bar. With three picked, the CPU picks at the chosen difficulty and its
// squad is revealed; then on to the briefing.
import { useState } from 'react'
import { displayName, roleName } from '../engine'
import { addToSquad, clearSquads, removeFromSquad, rollCpuSquad, setDifficulty, toBrief, watchBots } from '../game'
import { DIFFICULTIES, DIFFICULTY_HINT, DIFFICULTY_LABEL, canAdd, pool, squadSize } from '../squads'
import { useGame } from '../store'
import { portraitUrl, UnitCardFace } from './Cards'

function Bust({ defId }: { defId: string }) {
  return (
    <img
      className="ss-bust"
      src={portraitUrl(defId, 'bust')}
      alt=""
      draggable={false}
      onError={(e) => {
        ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
      }}
    />
  )
}

function Slots({ side, squad, onRemove, reveal }: { side: 0 | 1; squad: string[]; onRemove?: (i: number) => void; reveal: boolean }) {
  return (
    <div className={'ss-slots s' + side} data-testid={side === 0 ? 'my-slots' : 'cpu-slots'}>
      {Array.from({ length: squadSize() }, (_, i) => {
        const d = squad[i]
        return (
          <button key={i} className={'ss-slot' + (d ? ' full' : '')} disabled={!d || !onRemove} onClick={() => d && onRemove?.(i)} title={d && onRemove ? 'Remove' : undefined}>
            {d && reveal ? (
              <>
                <Bust defId={d} />
                <span className="ss-slot-name">{displayName(d)}</span>
              </>
            ) : (
              <span className="ss-slot-empty">{side === 0 ? i + 1 : '?'}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function SquadSelect() {
  const mine = useGame((s) => s.mySquad)
  const cpu = useGame((s) => s.foeSquad)
  const difficulty = useGame((s) => s.difficulty)
  const all = pool()
  const [focus, setFocus] = useState<string>(all[0] ?? 'u01')
  const full = mine.length >= squadSize()

  const tap = (d: string) => {
    if (focus !== d) {
      setFocus(d)
      return
    }
    if (canAdd(mine, d)) addToSquad(d)
  }

  return (
    <div className="squad-select" data-testid="select">
      <header className="ss-top">
        <div className="ss-title">
          <span className="kicker">Squad select</span>
          <strong>{full ? (cpu ? 'Ready for battle' : 'Squad locked in') : 'Pick ' + (squadSize() - mine.length) + ' more'}</strong>
        </div>
        <div className="ss-diff" data-testid="difficulty">
          <span className="dim">CPU</span>
          {DIFFICULTIES.map((k) => (
            <button key={k} className={k === difficulty ? 'on' : ''} data-testid={'difficulty-' + k} onClick={() => setDifficulty(k)} title={DIFFICULTY_HINT[k]}>
              {DIFFICULTY_LABEL[k]}
            </button>
          ))}
        </div>
      </header>

      <div className="ss-main">
        <div className="ss-grid" data-testid="roster">
          {all.map((d) => {
            const count = mine.filter((x) => x === d).length
            const ok = canAdd(mine, d)
            return (
              <button
                key={d}
                className={'ss-tile' + (focus === d ? ' focus' : '') + (count ? ' picked' : '') + (!ok && !count ? ' locked' : '')}
                data-testid={'pick-' + d}
                onPointerEnter={(e) => e.pointerType === 'mouse' && setFocus(d)}
                onClick={() => tap(d)}
              >
                <Bust defId={d} />
                <span className="ss-tile-name">{displayName(d)}</span>
                <span className="ss-tile-role">{roleName(d)}</span>
                {count > 0 && <span className="ss-badge">P1{count > 1 ? ' ×' + count : ''}</span>}
              </button>
            )
          })}
        </div>
        <div className="ss-preview" data-testid="preview">
          <UnitCardFace defId={focus} side={0} />
          <div className="ss-hint dim">
            {full ? 'Squad full: tap a slot below to swap a machine out.' : canAdd(mine, focus) ? 'Tap ' + displayName(focus) + ' again to add it.' : 'Already in your squad.'}
          </div>
        </div>
      </div>

      <footer className="ss-foot">
        <Slots side={0} squad={mine} onRemove={removeFromSquad} reveal />
        <div className="ss-vs">VS</div>
        <Slots side={1} squad={cpu ?? []} reveal={Boolean(cpu)} />
        <div className="ss-actions">
          <button onClick={() => watchBots()} data-testid="watch-bots" title={full ? 'The CPU plays your squad against its own pick' : 'The CPU picks and plays both squads'}>
            Watch CPU vs CPU
          </button>
          {mine.length > 0 && (
            <button onClick={clearSquads} data-testid="clear-squad">
              Clear
            </button>
          )}
          {!cpu ? (
            <button className="setup-go" disabled={!full} data-testid="lock-in" onClick={() => rollCpuSquad()}>
              Lock in
            </button>
          ) : (
            <>
              <button onClick={() => rollCpuSquad()} data-testid="reroll">
                New CPU squad
              </button>
              <button className="setup-go" data-testid="confirm" onClick={toBrief}>
                Briefing
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  )
}
