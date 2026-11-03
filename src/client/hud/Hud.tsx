// The HUD: DOM over the canvas, never drawn in three (PLAN.md D4). Every button is a legal action, filtered; nothing here
// knows a rule the engine has not already applied.
import { useEffect, useMemo } from 'react'
import { affordances, hexKey } from '../affordances'
import {
  abilitiesOf,
  ability,
  conditionHolds,
  displayName,
  isEngaged,
  isTerminal,
  Names,
  sideName,
  terrainKind,
  Text,
  UI,
  weaponsOf,
  type Action,
  type EngineUnit,
  type GameState,
  type Side,
} from '../engine'
import { humanTurn, newGame, setSpeed, take } from '../game'
import { setStore, useGame, type Speed } from '../store'
import { viewApi } from '../board/viewApi'
import { describe } from './feed'
import { setMuted } from '../audio/sound'

const SIDE_CLASS = ['s0', 's1'] as const

function initials(defId: string): string {
  return displayName(defId)
    .split(' ')
    .map((w: string) => w.charAt(0))
    .join('')
}

function useAffordances() {
  const game = useGame((s) => s.game)
  const armed = useGame((s) => s.armed)
  const busy = useGame((s) => s.busy)
  const ai = useGame((s) => s.ai)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => affordances(game, armed, humanTurn()), [game, armed, busy, ai])
}

// --- top bar -----------------------------------------------------------------------------------------------------------

function TopBar({ game }: { game: GameState }) {
  const speed = useGame((s) => s.speed)
  const act = game.activation
  const actor = act ? game.units[act.uid] : null
  return (
    <header className="topbar" data-testid="topbar">
      <h1>{UI.title}</h1>
      <div className="score">
        <span className="s0">{sideName(0)} {game.players[0]!.vp}</span>
        <span className="dim"> – </span>
        <span className="s1">{game.players[1]!.vp} {sideName(1)}</span>
      </div>
      <div className="clock" data-testid="clock">
        {UI.phase} {game.phase}/{game.rules.match.phasesPerGame} · {UI.round} {game.round}/{game.rules.timeline.rounds}
        {actor && (
          <span className={'turn ' + SIDE_CLASS[actor.side]}> · {displayName(actor.defId)}</span>
        )}
      </div>
      <div className="tools">
        {(['normal', 'fast', 'instant'] as Speed[]).map((s) => (
          <button key={s} className={'speed' + (speed === s ? ' on' : '')} onClick={() => setSpeed(s)} title={'Opponent speed: ' + s}>
            {s === 'normal' ? '1×' : s === 'fast' ? '3×' : '»'}
          </button>
        ))}
        <MuteButton />
        <button data-testid="reset-view" onClick={() => viewApi.reset()} title="Reset view (R)">⌖</button>
        <button onClick={newGame} title={UI.newGame}>↺</button>
      </div>
    </header>
  )
}

function MuteButton() {
  const muted = useGame((s) => s.muted)
  return (
    <button onClick={() => setMuted(!muted)} title={muted ? 'Sound off' : 'Sound on'}>
      {muted ? '🔇' : '🔊'}
    </button>
  )
}

function Banner() {
  const banner = useGame((s) => s.banner)
  if (!banner) return null
  return <div className="banner" key={banner.born} data-testid="banner">{banner.text}</div>
}

// --- the Timeline --------------------------------------------------------------------------------------------------------

function Track({ game }: { game: GameState }) {
  const rows = game.timeline.rounds
  return (
    <aside className="track" data-testid="track">
      <div className="track-head">{UI.timeline}</div>
      {rows.map((r, i) => (
        <div key={i} className={'tr' + (i + 1 === game.round ? ' now' : '')}>
          {([0, 1] as Side[]).map((side) => (
            <div key={side} className={'tr-side ' + SIDE_CLASS[side]}>
              {r.stacks[side].map((uid) => {
                const u = game.units[uid]
                if (!u) return null
                return (
                  <span
                    key={uid}
                    className={'chip ' + SIDE_CLASS[side] + (game.activation?.uid === uid ? ' active' : '') + (u.inReserve ? ' reserve' : '')}
                    title={displayName(u.defId) + (u.inReserve ? ' (in reserve)' : '')}
                    onMouseEnter={() => setStore({ hoverUnit: uid })}
                    onMouseLeave={() => setStore({ hoverUnit: null })}
                  >
                    {initials(u.defId)}
                  </span>
                )
              })}
            </div>
          ))}
          <div className="tr-num">{i + 1}</div>
        </div>
      ))}
    </aside>
  )
}

// --- actions -------------------------------------------------------------------------------------------------------------

function ActionPanel({ game }: { game: GameState }) {
  const armed = useGame((s) => s.armed)
  const ai = useGame((s) => s.ai)
  const af = useAffordances()
  const act = game.activation
  if (!act) return null
  const u = game.units[act.uid]!
  const mine = !ai[act.side]
  if (!mine) {
    return (
      <section className="panel actions" data-testid="actions">
        <div className="panel-head">{sideName(act.side)} is acting</div>
        <p className="dim">{displayName(u.defId)} is taking its turn.</p>
      </section>
    )
  }
  const legal = af.legal
  const has = (t: string) => legal.some((a) => a.type === t)
  const one = (t: string) => legal.find((a) => a.type === t)
  const moves = legal.filter((a) => a.type === 'advance' || a.type === 'dash').length
  const plain = legal.filter((a) => a.type === 'energize' || a.type === 'rescue' || a.type === 'end_activation')
  const commands = legal.filter((a) => a.type === 'command')
  const engaged = u.hex ? isEngaged(game, u.side, u.hex) : false

  return (
    <section className="panel actions" data-testid="actions">
      <div className="panel-head">
        {displayName(u.defId)} <span className="dim">· {Names.ROLES[u.defId] ?? ''}</span>
      </div>
      {has('deploy') && <p className="hint">In reserve. Click the glowing hex on your base to deploy, then move off it.</p>}
      {u.hex && one('advance')?.slowed && <p className="hint">Mired: this Advance goes nowhere, but clears the status.</p>}
      {engaged && <p className="hint">Engaged: moves go one hex less, and attacks must include an adjacent enemy.</p>}
      {weaponsOf(u).map((w) => {
        const shots = legal.filter((a) => a.type === 'attack' && a.wid === w.wid)
        return (
          <button
            key={w.wid}
            className={'act weapon' + (armed === w.wid ? ' armed' : '')}
            disabled={!shots.length}
            data-testid={'weapon-' + w.wid}
            onClick={() => setStore({ armed: armed === w.wid ? null : w.wid })}
          >
            <strong>{displayName(w.wid)}</strong>
            <span className="dim">
              {shots[0]?.free ? 'free' : w.tlCost + ' TL'} · range {w.range} · {w.strength} dice{w.ignoreLos ? ' · ignores LoS' : ''}
            </span>
            {w.crit && <span className="dim">Crit: {Names.critText(w.crit)}</span>}
            <span className="dim">{shots.length ? shots.length + ' target' + (shots.length > 1 ? 's' : '') + ' — arm, then click one' : 'no target'}</span>
          </button>
        )
      })}
      {commands.map((a) => {
        const def = ability(u, a.aid!)
        return (
          <button key={a.aid! + (a.targetUid ?? '')} className="act ability" onClick={() => take(a)}>
            <strong>{Text.abilityName(a.aid)}</strong>
            <span className="dim">{Text.abilityCost(def)}</span>
            <span className="dim">{Text.abilityText(def)}</span>
            {a.targetUid && <span className="dim">on {displayName(game.units[a.targetUid]!.defId)}</span>}
          </button>
        )
      })}
      {plain.map((a: Action) => (
        <button key={a.type + (a.gid ?? '')} className={'act' + (a.type === 'end_activation' ? ' end' : '')} data-testid={'act-' + a.type} onClick={() => take(a)}>
          <strong>{Names.ACTIONS[a.type] ?? a.type}</strong>
          <span className="dim">{Names.ACTION_HINTS[a.type] ?? ''}</span>
        </button>
      ))}
      {moves > 0 && <p className="hint">Green hexes are a free Advance; amber hexes are a Dash, which uses your Primary Action.</p>}
    </section>
  )
}

// --- the hand ------------------------------------------------------------------------------------------------------------

function Hand({ game }: { game: GameState }) {
  const ai = useGame((s) => s.ai)
  const af = useAffordances()
  const side: Side = ai[0] && !ai[1] ? 1 : 0
  if (ai[0] && ai[1]) return null
  const p = game.players[side]!
  return (
    <section className="hand" data-testid="hand">
      <div className="hand-head">
        Tactics · {p.tactics.hand.length} in hand, {p.tactics.deck.length} in deck
      </div>
      <div className="cards">
        {p.tactics.hand.map((c) => {
          const plays = af.legal.filter((a) => a.type === 'tactics' && a.cid === c.cid)
          return (
            <div key={c.cid} className={'tcard' + (plays.length ? ' playable' : '')} onClick={() => plays.length === 1 && take(plays[0]!)}>
              <div className="tcard-name">{Text.tacticsName(c.cid)}</div>
              <div className="tcard-text">{Text.abilityText(c)}</div>
              {plays.length > 1 && (
                <div className="tcard-targets">
                  {plays.map((a) => (
                    <button key={a.targetUid} onClick={(e) => { e.stopPropagation(); take(a) }}>
                      {displayName(game.units[a.targetUid!]!.defId)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {!p.tactics.hand.length && <div className="dim">No cards in hand. Three more are drawn at the end of Phase 1.</div>}
      </div>
    </section>
  )
}

// --- unit card -----------------------------------------------------------------------------------------------------------

function UnitCard({ game, u }: { game: GameState; u: EngineUnit }) {
  return (
    <section className={'panel ucard ' + SIDE_CLASS[u.side]} data-testid="unit-card">
      <div className="ucard-name">{displayName(u.defId)}</div>
      <div className="dim">{Names.ROLES[u.defId] ?? ''} · {sideName(u.side)}{u.inReserve ? ' · in reserve' : ''}</div>
      <div className="ucard-stats">
        <span><em>{UI.hp}</em>{u.hp}/{u.maxHp}</span>
        <span><em>{UI.vp}</em>{u.vp}</span>
        <span><em>TL</em>{u.tl}</span>
        <span><em>{UI.energy}</em>{u.energy}</span>
      </div>
      {weaponsOf(u).map((w) => (
        <div key={w.wid} className="ucard-weapon">
          <strong>{displayName(w.wid)}</strong>
          <span className="dim"> {w.tlCost} TL · ◇{w.range} · ⬢{w.strength}{w.ignoreLos ? ' · ignores LoS' : ''}</span>
          {w.crit && <div className="dim">Crit: {Names.critText(w.crit)}</div>}
        </div>
      ))}
      {abilitiesOf(u).map((a) => {
        const live = a.timing === 'ongoing' && conditionHolds(game, u, a.when)
        return (
          <div key={a.aid} className={'ucard-ability' + (live ? ' live' : '')}>
            <strong>{Text.abilityName(a.aid)}</strong> <span className="dim">{Text.abilityCost(a)}{live ? ' · active' : ''}</span>
            <div className="dim">{Text.abilityText(a)}</div>
          </div>
        )
      })}
      {(u.statuses.length > 0 || u.upgrades.length > 0) && (
        <div className="chips">
          {u.statuses.map((s) => <span key={s} className="chip-s">{Names.STATUSES[s] ?? s}</span>)}
          {u.upgrades.map((s, i) => <span key={s + i} className="chip-u">{Names.UPGRADES[s] ?? s}</span>)}
        </div>
      )}
    </section>
  )
}

// --- hovered hex ---------------------------------------------------------------------------------------------------------

function HexInfo({ game }: { game: GameState }) {
  const hover = useGame((s) => s.hoverHex)
  const af = useAffordances()
  if (!hover) return null
  const cell = game.board.hexes[hexKey(hover)]
  if (!cell) return null
  const kind = terrainKind(game, cell.terrain)
  const facts: string[] = [Names.TERRAIN[cell.terrain] ?? cell.terrain]
  if (cell.elevation) facts.push('height ' + cell.elevation)
  if (kind?.startPenalty) facts.push('moves started here go ' + kind.startPenalty + ' hex less')
  if (kind?.accuracyInto) facts.push(kind.accuracyInto + ' accuracy against a target here')
  if (kind?.field) facts.push('-2 accuracy on ranged attacks in or out')
  if (kind?.impassable) facts.push('impassable')
  const move = af.moveTo.get(hexKey(hover))
  if (move) facts.push((move.type === 'dash' ? 'Dash' : 'Advance') + ' here: ' + move.cost + ' movement')
  const base = game.bases.find((b) => b.hex.q === hover.q && b.hex.r === hover.r)
  if (base) facts.push(sideName(base.side) + ' base')
  const obj = game.objectiveOrder.map((o) => game.objectives[o]!).find((o) => o.hex.q === hover.q && o.hex.r === hover.r)
  if (obj) facts.push('objective, ' + obj.vp + ' VP a Phase, ' + (obj.controlledBy === null ? 'neutral' : 'held by ' + sideName(obj.controlledBy)))
  const pk = game.pickups.find((p) => p.hex.q === hover.q && p.hex.r === hover.r)
  if (pk) facts.push(pk.kind === 'energy' ? 'Energy token' : (Names.UPGRADES[pk.upgrade!] ?? pk.upgrade) + ' upgrade')
  return <div className="hexinfo" data-testid="hexinfo">{facts.join(' · ')}</div>
}

// --- feed ----------------------------------------------------------------------------------------------------------------

function Feed({ game }: { game: GameState }) {
  const lines: string[] = []
  for (let i = game.log.length - 1; i >= 0 && lines.length < 5; i--) {
    const d = describe(game, game.log[i]!)
    if (d) lines.push(d)
  }
  return (
    <div className="feed" data-testid="feed">
      {lines.reverse().map((l, i) => <div key={i}>{l}</div>)}
    </div>
  )
}

// --- game over -----------------------------------------------------------------------------------------------------------

function GameOver({ game }: { game: GameState }) {
  const w = game.winner
  return (
    <div className="overlay" data-testid="game-over">
      <div className="setup-panel">
        <h2>{UI.gameOver}</h2>
        <p className="big">{w === null ? UI.draw : sideName(w) + ' ' + UI.wins}</p>
        <p>
          <span className="s0">{sideName(0)} {game.players[0]!.vp}</span> – <span className="s1">{game.players[1]!.vp} {sideName(1)}</span>
        </p>
        <div className="setup-foot">
          <button className="setup-go" onClick={newGame}>{UI.newGame}</button>
        </div>
      </div>
    </div>
  )
}

// --- the whole HUD -------------------------------------------------------------------------------------------------------

export function Hud() {
  const game = useGame((s) => s.game)
  const selected = useGame((s) => s.selected)
  const hoverUnit = useGame((s) => s.hoverUnit)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStore({ armed: null, selected: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!game) return null
  const cardUid = hoverUnit ?? selected ?? game.activation?.uid ?? null
  const cardUnit = cardUid ? game.units[cardUid] : null
  return (
    <>
      <TopBar game={game} />
      <Track game={game} />
      <div className="rightcol">
        <ActionPanel game={game} />
        {/* the hand sits in the right column so a phone can scroll to it; on a desktop CSS pins it along the bottom */}
        <Hand game={game} />
        {cardUnit && <UnitCard game={game} u={cardUnit} />}
      </div>
      <HexInfo game={game} />
      <Feed game={game} />
      <Banner />
      {isTerminal(game) && <GameOver game={game} />}
    </>
  )
}
