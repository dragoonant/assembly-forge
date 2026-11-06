// Squad select and the mission briefing, ported from the 2D game. Both are one flow and share one overlay.
import { Decks, Names, Packs, SCENARIO_ID, sideName } from '../engine'
import { choosePack } from '../packs'
import { deploy, resetDeck, toggleDeckCard, toSelect } from '../game'
import { TacticsCardFace, UnitCardFace } from './Cards'
import { SquadSelect } from './SquadSelect'
import { useModelsReady } from '../board/preload'
import { HUMAN, useGame } from '../store'

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
          return <TacticsCardFace key={cid} cid={cid} card={c} on={on} disabled={!on && full} onClick={() => toggleDeckCard(cid, suggested)} />
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
  const mySquad = useGame((s) => s.mySquad)
  const foeSquad = useGame((s) => s.foeSquad)
  const myDeck = useGame((s) => s.myDeck)
  const watching = useGame((s) => s.watching)
  const S = Names.SETUP
  const brief = Names.SCENARIOS[SCENARIO_ID]
  const squads: [string[], string[]] = [mySquad, foeSquad ?? []]
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
            <h4>{watching ? 'CPU' : side === HUMAN ? S.yourSquad : S.enemySquad} · {sideName(side)}</h4>
            <div className="brief-cards">
              {squads[side].map((d, i) => (
                <UnitCardFace key={d + i} defId={d} side={side} size="mini" />
              ))}
            </div>
          </div>
        ))}
      </div>
      {!watching && <DeckPicker squad={squads[HUMAN]} />}
      <div className="setup-foot">
        <button onClick={toSelect}>{S.back}</button>
        <button className="setup-go" data-testid="deploy" disabled={!deckOk || !models.ready} onClick={() => deploy()}>
          {models.ready ? (watching ? 'Watch' : S.deploy) : 'Loading models ' + models.loaded + '/' + models.total}
        </button>
      </div>
    </div>
  )
}

/** The character select, with the roster toggle when a local pack is present. */
function SelectScreen() {
  const packs = Packs.list()
  const current = Packs.activeId()
  return (
    <>
      <SquadSelect />
      {packs.length > 1 && (
        <div className="pack-toggle floating" data-testid="pack-toggle">
          <span className="dim">Roster:</span>
          {packs.map((p) => (
            <button key={p.id} className={p.id === current ? 'on' : ''} data-testid={'pack-' + p.id} onClick={() => choosePack(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

export function Setup() {
  const screen = useGame((s) => s.screen)
  if (screen === 'play') return null
  return <div className={'overlay' + (screen === 'select' ? ' select-screen' : '')}>{screen === 'select' ? <SelectScreen /> : <Brief />}</div>
}
