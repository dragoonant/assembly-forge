// Squad select and the mission briefing, ported from the 2D game. Both are one flow and share one overlay.
import { Decks, displayName, Names, Packs, roleName, SCENARIO_ID, sideName, squadsFor, teamName, teamNote, teamOrder, teamUnits, Text } from '../engine'
import { choosePack } from '../packs'
import { chooseTeam, deploy, resetDeck, toBrief, toggleDeckCard, toSelect } from '../game'
import { useModelsReady } from '../board/preload'
import { HUMAN, useGame } from '../store'

function Select() {
  const myTeam = useGame((s) => s.myTeam)
  const S = Names.SETUP
  const packs = Packs.list()
  const current = Packs.activeId()
  return (
    <div className="setup-panel" data-testid="select">
      <h2>{S.chooseTitle}</h2>
      <p className="dim">{S.chooseHint}</p>
      {packs.length > 1 && (
        <div className="pack-toggle" data-testid="pack-toggle">
          <span className="dim">Roster:</span>
          {packs.map((p) => (
            <button key={p.id} className={p.id === current ? 'on' : ''} data-testid={'pack-' + p.id} onClick={() => choosePack(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      <div className="team-grid">
        {teamOrder().map((tid) => (
          <button key={tid} className={'team' + (myTeam === tid ? ' chosen' : '')} data-testid={'team-' + tid} onClick={() => chooseTeam(tid)}>
            <strong>{teamName(tid)}</strong>
            <span className="dim">{teamNote(tid)}</span>
            <ul>
              {teamUnits(tid).map((d) => (
                <li key={d}>
                  {displayName(d)} <span className="dim">· {roleName(d)}</span>
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>
      <div className="setup-foot">
        <button className="setup-go" disabled={!myTeam} data-testid="confirm" onClick={toBrief}>
          {S.confirm}
        </button>
      </div>
    </div>
  )
}

/** The player's nine Tactics cards, picked from what the squad may take; starts on the suggested deck. */
function DeckPicker({ squad }: { squad: string[] }) {
  const myDeck = useGame((s) => s.myDeck)
  const pool = Decks.pool(squad)
  const suggested = Decks.suggested(squad)
  const deck = myDeck ?? suggested
  const full = deck.length >= Decks.size
  return (
    <div className="deck-picker" data-testid="deck-picker">
      <h3>
        Tactics deck <span className={deck.length === Decks.size ? 'dim' : 'warn'} data-testid="deck-count">{deck.length} / {Decks.size}</span>
      </h3>
      <p className="dim">Pick {Decks.size} cards, one of each. Signature cards need their unit in the squad.</p>
      <div className="deck-grid">
        {pool.map((cid) => {
          const on = deck.indexOf(cid) !== -1
          const c = Decks.card(cid)
          return (
            <button
              key={cid}
              className={'deck-card' + (on ? ' on' : '')}
              data-testid={'deck-' + cid}
              disabled={!on && full}
              onClick={() => toggleDeckCard(cid, suggested)}
            >
              <strong>{Text.tacticsName(cid)}</strong>
              {c.requires && c.requires.defId && <span className="sig">{displayName(c.requires.defId)}</span>}
              <span className="dim">{Text.abilityText(c)}</span>
            </button>
          )
        })}
      </div>
      {myDeck && (
        <button className="deck-reset" onClick={resetDeck}>
          Use the suggested deck
        </button>
      )}
    </div>
  )
}

function Brief() {
  const myTeam = useGame((s) => s.myTeam)
  const foeTeam = useGame((s) => s.foeTeam)
  const myDeck = useGame((s) => s.myDeck)
  const S = Names.SETUP
  const brief = Names.SCENARIOS[SCENARIO_ID]
  const squads = squadsFor(myTeam, foeTeam)
  const deckOk = !myDeck || Decks.legal(myDeck, squads[HUMAN])
  const models = useModelsReady()
  return (
    <div className="setup-panel brief" data-testid="brief">
      <div className="dim kicker">{S.briefTitle}</div>
      <h2>{brief.title}</h2>
      <p>{brief.situation}</p>
      <h3>{S.goals}</h3>
      <ul>
        {brief.goals.map((g: string, i: number) => <li key={i}>{g}</li>)}
      </ul>
      <h3>{S.victory}</h3>
      <p>{brief.victory}</p>
      <p className="warn">{brief.warning}</p>
      <div className="forces">
        {([0, 1] as const).map((side) => (
          <div key={side} className={'force s' + side}>
            <h4>{side === HUMAN ? S.yourSquad : S.enemySquad} · {sideName(side)}</h4>
            <div className="dim">{teamName(side === HUMAN ? myTeam! : foeTeam!)}</div>
            {squads[side].map((d) => (
              <div key={d}>
                {displayName(d)} <span className="dim">· {roleName(d)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {myTeam && myTeam === foeTeam && <p className="dim">{S.mirror}</p>}
      <DeckPicker squad={squads[HUMAN]} />
      <div className="setup-foot">
        <button onClick={toSelect}>{S.back}</button>
        <button className="setup-go" data-testid="deploy" disabled={!deckOk || !models.ready} onClick={() => deploy()}>
          {models.ready ? S.deploy : 'Loading models ' + models.loaded + '/' + models.total}
        </button>
      </div>
    </div>
  )
}

export function Setup() {
  const screen = useGame((s) => s.screen)
  if (screen === 'play') return null
  return <div className="overlay">{screen === 'select' ? <Select /> : <Brief />}</div>
}
