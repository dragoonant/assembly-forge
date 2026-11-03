// Squad select and the mission briefing, ported from the 2D game. Both are one flow and share one overlay.
import { displayName, Names, SCENARIO_ID, sideName, squadsFor, TEAM_ORDER, teamUnits } from '../engine'
import { chooseTeam, deploy, toBrief, toSelect } from '../game'
import { HUMAN, useGame } from '../store'

function Select() {
  const myTeam = useGame((s) => s.myTeam)
  const S = Names.SETUP
  return (
    <div className="setup-panel" data-testid="select">
      <h2>{S.chooseTitle}</h2>
      <p className="dim">{S.chooseHint}</p>
      <div className="team-grid">
        {TEAM_ORDER.map((tid) => (
          <button key={tid} className={'team' + (myTeam === tid ? ' chosen' : '')} data-testid={'team-' + tid} onClick={() => chooseTeam(tid)}>
            <strong>{Names.TEAMS[tid]}</strong>
            <span className="dim">{Names.TEAM_NOTES[tid]}</span>
            <ul>
              {teamUnits(tid).map((d) => (
                <li key={d}>
                  {displayName(d)} <span className="dim">· {Names.ROLES[d]}</span>
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

function Brief() {
  const myTeam = useGame((s) => s.myTeam)
  const foeTeam = useGame((s) => s.foeTeam)
  const S = Names.SETUP
  const brief = Names.SCENARIOS[SCENARIO_ID]
  const squads = squadsFor(myTeam, foeTeam)
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
            <div className="dim">{Names.TEAMS[side === HUMAN ? myTeam! : foeTeam!]}</div>
            {squads[side].map((d) => (
              <div key={d}>
                {displayName(d)} <span className="dim">· {Names.ROLES[d]}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {myTeam && myTeam === foeTeam && <p className="dim">{S.mirror}</p>}
      <div className="setup-foot">
        <button onClick={toSelect}>{S.back}</button>
        <button className="setup-go" data-testid="deploy" onClick={() => deploy()}>
          {S.deploy}
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
