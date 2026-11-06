// The HUD: DOM over the canvas, never drawn in three (PLAN.md D4). Every button is a legal action, filtered; nothing here
// knows a rule the engine has not already applied.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { actionHex, affordances, hexKey } from '../affordances'
import {
  abilitiesOf,
  ability,
  conditionHolds,
  deciderSide,
  displayName,
  isEngaged,
  roleName,
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
import { humanTurn, newGame, setSpeed, take, takeOver } from '../game'
import { setStore, useGame, type Speed } from '../store'
import { viewApi } from '../board/viewApi'
import { describe } from './feed'
import { setMuted } from '../audio/sound'

const SIDE_CLASS = ['s0', 's1'] as const

/** Short label for a Timeline chip: the first letter of each word, letters and digits only, at most four. */
function initials(defId: string): string {
  return displayName(defId)
    .split(/[^A-Za-z0-9]+/)
    .filter((w: string) => w.length > 0)
    .map((w: string) => w.charAt(0))
    .join('')
    .slice(0, 4)
    .toUpperCase()
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
  const watching = useGame((s) => s.watching)
  const act = game.activation
  const actor = act ? game.units[act.uid] : null
  return (
    <header className={'topbar' + (watching ? ' watch' : '')} data-testid="topbar">
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
        {watching && (
          <>
            <span className="watching" data-testid="watching">Watching</span>
            <button className="take-over" data-testid="take-over" onClick={takeOver} title="Play your side from here">
              Take over
            </button>
          </>
        )}
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

// --- folding panels ------------------------------------------------------------------------------------------------------

const NARROW = '(max-width: 899px)'

function isNarrow(): boolean {
  try {
    return window.matchMedia(NARROW).matches
  } catch {
    return false
  }
}

/** Whether a panel is open, remembered per panel in this browser (a convenience only; the default applies without it). */
function useFold(id: string, defaultOpen: boolean): [boolean, () => void] {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('af-fold:' + id)
      return v === null ? defaultOpen : v === '1'
    } catch {
      return defaultOpen
    }
  })
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem('af-fold:' + id, o ? '0' : '1')
      } catch {
        // storage unavailable: the panel still folds for this session
      }
      return !o
    })
  return [open, toggle]
}

/** A panel whose header minimizes it to one line. */
function Fold({ id, title, className, testid, defaultOpen = true, children }: { id: string; title: ReactNode; className?: string; testid?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, toggle] = useFold(id, defaultOpen)
  return (
    <section className={'panel fold ' + (className ?? '') + (open ? '' : ' closed')} data-testid={testid}>
      <button className="fold-head" onClick={toggle} aria-expanded={open} title={open ? 'Minimize' : 'Expand'} data-testid={testid ? testid + '-fold' : undefined}>
        <span className="fold-title">{title}</span>
        <span className="fold-icon">{open ? '–' : '+'}</span>
      </button>
      {open && <div className="fold-body">{children}</div>}
    </section>
  )
}

// --- the Timeline --------------------------------------------------------------------------------------------------------

function Track({ game }: { game: GameState }) {
  const rows = game.timeline.rounds
  return (
    <Fold id="timeline" className="track" testid="track" title={<><span className="tl-long">{UI.timeline} </span><span className="dim">{UI.round} {game.round}</span></>}>
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
    </Fold>
  )
}

// --- the action bar ------------------------------------------------------------------------------------------------------
//
// One row of small buttons along the bottom: the acting machine's weapons, Commands and plain actions, then the Tactics
// hand. A tap opens the button's description above the bar with its Use or Play button, so nothing acts by accident and
// the descriptions stay out of the way until asked for. A weapon or an Attack card arms on the tap (the target click on the
// board is the confirmation). A button with nothing to explain (Pass, Decline) acts at once.

const WINDOW_LABEL: Record<string, string> = {
  beforeRoll: 'Before the attack roll',
  afterRoll: 'After the attack roll',
  afterDamage: 'After the attack deals damage',
  wouldBeDefeated: 'Your machine would be destroyed',
  enemyMoved: 'An enemy ended its move in range',
}

/** The head line for each kind of choice a card or ability asks for (`pending.kind === 'choose'`). */
const CHOOSE_LABEL: Record<string, string> = {
  gainUpgrade: 'Choose an Upgrade to gain',
  spreadUpgrades: 'Give each machine a different Upgrade',
  transfer: 'Move Upgrades between the two machines',
  takeUpgrade: 'Choose an Upgrade to take',
  destroyUpgrade: 'Choose an Upgrade to destroy',
  repositionRemotes: 'Move each remote weapon',
  remoteStrike: 'Choose what each remote weapon strikes',
}

/** Who or where a targeted play is aimed at, for its button and its line in the description. */
function placeLabel(game: GameState, a: Action, verb: string): string {
  if (a.targetUid) return verb + ' on ' + displayName(game.units[a.targetUid]!.defId)
  if (a.gid) return verb + ' on the Garrison'
  if (a.to) return verb + ' at the highlighted hex'
  return verb
}

interface BarItem {
  key: string
  label: string
  sub?: string
  cls?: string
  testid?: string
  /** What the popover explains. Without it a tap runs the item at once. */
  info?: ReactNode
  /** What a second tap on the open button does (or the first tap, when there is no info). */
  run?: () => void
  runLabel?: string
  /** One play per target: a tap on the target's hex takes it (a second tap on the button does, when there is only one). */
  choices?: { label: string; run: () => void; act: Action; testid?: string }[]
  /** Arm-on-tap items (weapons and Attack cards): a tap arms, a tap on an enemy attacks. */
  arm?: () => void
  armed?: boolean
  /** For an armed item with a single target: a second tap attacks it. */
  quick?: () => void
  quickLabel?: string
  dim?: boolean
}

interface BarGroup {
  label: string
  items: BarItem[]
}

/** The attack being responded to: who is attacking, and the dice once they have landed. */
function rollSoFar(game: GameState): string {
  const a = game.attacks && game.attacks[game.attacks.length - 1]
  if (!a) return ''
  const attacker = game.units[a.uid]
  let s = (attacker ? displayName(attacker.defId) + ' is attacking' : 'An attack is under way') + (a.faces ? ' · rolled ' + a.faces.join(' ') : a.dice ? ' · ' + a.dice + ' dice to roll' : '')
  if (a.preview && a.preview.length) {
    s += ' · ' + a.preview.map((t) => (t.ref.kind === 'unit' ? displayName(game.units[t.ref.id]!.defId) : 'Garrison') + ': ' + t.hits + ' hit' + (t.hits === 1 ? '' : 's')).join(', ')
  }
  return s
}

/** Who an attack or targeted play is aimed at, for the popover's "tap again" line. */
function targetName(game: GameState, a: Action): string {
  const t = a.target
  if (t && t.kind === 'unit') return displayName(game.units[t.id]!.defId)
  if (t) return 'the Garrison'
  return a.targetUid ? displayName(game.units[a.targetUid]!.defId) : 'it'
}

/** The head line and buttons for a paused attack or effect waiting on this player. */
function decisionBar(game: GameState, legal: Action[]): { title: string; hint: string; groups: BarGroup[] } {
  const p = game.pending!
  const pass = legal.find((a) => a.type === 'pass')
  const passItem: BarItem[] = pass ? [{ key: 'pass', label: 'Pass', cls: 'end', testid: 'act-pass', run: () => take(pass) }] : []
  const who = p.uid ? displayName(game.units[p.uid]!.defId) : ''
  if (p.kind === 'window') {
    const hand = game.players[p.side!]!.tactics.hand
    const cards = legal.filter((a) => a.type === 'respond')
    return {
      title: WINDOW_LABEL[p.window!] ?? 'Respond',
      hint: [rollSoFar(game), 'Play a response card, or pass.'].filter(Boolean).join(' · '),
      groups: [
        {
          label: 'Respond',
          items: [
            ...cards.map((a): BarItem => {
              if (!a.cid) {
                // a machine's own Response ability: Challenge names the ally it swaps with
                const u = game.units[a.uid]!
                const ab = u.abilities.find((x) => x.aid === a.aid)
                const on = a.targetUid ? displayName(game.units[a.targetUid]!.defId) : ''
                return {
                  key: 'ra' + a.uid + a.aid + (a.targetUid ?? ''),
                  label: Text.abilityName(a.aid),
                  sub: displayName(u.defId) + (on ? ' · ' + on : ''),
                  cls: 'ability',
                  testid: 'respond-' + a.aid + (a.targetUid ? '-' + a.targetUid : ''),
                  info: ab ? Text.abilityText(ab) : '',
                  run: () => take(a),
                  runLabel: on ? 'use it with ' + on : 'use it',
                }
              }
              const c = hand.find((x) => x.cid === a.cid)!
              const on = a.targetUid ? displayName(game.units[a.targetUid]!.defId) : ''
              return {
                key: 'r' + a.cid + (a.targetUid ?? ''),
                label: Text.tacticsName(a.cid),
                sub: on || undefined,
                cls: 'card playable',
                testid: 'respond-' + a.cid + (a.targetUid ? '-' + a.targetUid : ''),
                info: Text.abilityText(c),
                run: () => take(a),
                runLabel: on ? 'Play on ' + on : 'Play',
              }
            }),
            ...passItem,
          ],
        },
      ],
    }
  }
  if ((p.kind as string) === 'choose') {
    const what = (p as unknown as { what: string }).what
    const opts = legal.filter((a) => a.type === 'choose')
    const placed = opts.filter((a) => actionHex(game, a))
    const keys = new Set(placed.map((a) => hexKey(actionHex(game, a)!)))
    // on the board when every option has its own hex; otherwise one button each
    const onBoard = placed.length === opts.length && keys.size === opts.length
    const skip = legal.find((a) => a.type === 'pass')
    return {
      title: CHOOSE_LABEL[what] ?? 'Choose',
      hint: onBoard ? 'Tap a cyan-ringed hex or machine.' : 'Pick one below.',
      groups: [
        {
          label: 'Choose',
          items: [
            ...(onBoard
              ? []
              : opts.map((a, i): BarItem => ({
                  key: 'ch' + i,
                  label: (a.aid ? displayName(a.aid) : 'Option ' + (i + 1)) + (a.targetUid ? ' · ' + displayName(game.units[a.targetUid]!.defId) : ''),
                  cls: 'ability',
                  testid: 'choose-' + i,
                  run: () => take(a),
                }))),
            ...(skip ? [{ key: 'pass', label: 'Done', cls: 'end', testid: 'act-pass', run: () => take(skip) }] : []),
          ],
        },
      ],
    }
  }
  if (p.kind === 'trigger') {
    const ab = game.units[p.uid!]!.abilities.find((x) => x.aid === p.aid)
    const skip = legal.find((a) => a.type === 'trigger_skip')
    return {
      title: who + ': ' + Text.abilityName(p.aid),
      hint: ab ? Text.abilityText(ab) : '',
      groups: [
        {
          label: 'Response',
          items: [
            ...legal
              .filter((a) => a.type === 'trigger')
              .map((a): BarItem => ({
                key: 't' + (a.targetUid ?? 'self'),
                label: a.targetUid ? 'Use on ' + displayName(game.units[a.targetUid]!.defId) : 'Use it',
                cls: 'ability',
                testid: 'act-trigger-' + (a.targetUid ?? 'self'),
                run: () => take(a),
              })),
            ...(skip ? [{ key: 'skip', label: 'Decline', cls: 'end', testid: 'act-trigger_skip', run: () => take(skip) }] : []),
          ],
        },
      ],
    }
  }
  if (p.kind === 'displace') {
    const stop = legal.find((a) => a.type === 'displace_stop')
    return {
      title: (p.mode === 'pull' ? 'Pull ' : 'Push ') + who,
      hint: 'Click a violet hex to move it (' + p.left + ' left). A red hex is a collision: 2 damage to everything involved, and the ' + p.mode + ' ends.',
      groups: stop ? [{ label: p.mode === 'pull' ? 'Pull' : 'Push', items: [{ key: 'stop', label: 'Stop here', cls: 'end', testid: 'act-displace_stop', run: () => take(stop) }] }] : [],
    }
  }
  return {
    title: who,
    hint: p.kind === 'react_move' ? 'Still standing: click a glowing hex to move, or pass.' : 'Click an enemy to strike back, or pass.',
    groups: passItem.length ? [{ label: 'React', items: passItem }] : [],
  }
}

/** The head line and buttons for the acting machine's own turn. */
function turnBar(game: GameState, u: EngineUnit, legal: Action[], armed: string | null): { title: string; hint: string; groups: BarGroup[] } {
  const one = (t: string) => legal.find((a) => a.type === t)
  const engaged = u.hex ? isEngaged(game, u.side, u.hex) : false
  // the Primary Action already taken this activation (a Dash, an attack, Energize or a rescue): no further attack
  const spent = game.activation?.slots.primary ?? null
  const spentName = spent ? (spent === 'dash' ? 'a Dash' : spent === 'attack' ? 'an attack' : Names.ACTIONS[spent] ?? spent) : ''
  const canAttack = legal.some((a) => a.type === 'attack')
  const hints: string[] = []
  if (spent && !canAttack) hints.push('Primary Action used on ' + spentName + ': no attack this activation.')
  if (legal.some((a) => a.type === 'deploy')) hints.push('In reserve: click the glowing hex on your base to deploy, then move off it.')
  if (u.hex && one('advance')?.slowed) hints.push('Mired: this Advance goes nowhere, but clears the status.')
  if (engaged) hints.push('Engaged: moves go one hex less, and attacks must include an adjacent enemy.')
  if (!hints.length && legal.some((a) => a.type === 'advance' || a.type === 'dash')) hints.push('Green hexes are a free Advance; amber hexes are a Dash, which uses your Primary Action (no attack after it).')

  const weapons = weaponsOf(u).map((w): BarItem => {
    const shots = legal.filter((a) => a.type === 'attack' && a.wid === w.wid)
    return {
      key: 'w' + w.wid,
      label: displayName(w.wid),
      sub: (shots[0]?.free ? 'free' : w.tlCost + ' TL') + ' · ' + ((w as typeof w & { area?: unknown }).area ? 'area' : '◇' + w.range) + ' · ⬢' + w.strength,
      cls: 'weapon',
      testid: 'weapon-' + w.wid,
      dim: !shots.length,
      armed: armed === w.wid,
      arm: shots.length ? () => setStore({ armed: w.wid }) : undefined,
      quick: shots.length === 1 ? () => take(shots[0]!) : undefined,
      quickLabel: shots.length === 1 ? 'attack ' + targetName(game, shots[0]!) : undefined,
      info: (
        <>
          <div>
            {shots[0]?.free ? 'Free' : w.tlCost + ' TL'} · {(w as typeof w & { area?: unknown }).area ? 'area pattern' : 'range ' + w.range} · {w.strength} dice{w.ignoreLos ? ' · ignores line of sight' : ''}
          </div>
          {w.crit && <div>Crit: {Names.critText(w.crit)}</div>}
          <div className="dim">
            {shots.length && shots[0]!.areaHexes
              ? 'A pattern attack: hover or tap a red-ringed target to see every hex it hits, then tap it again to fire.'
              : shots.length
              ? shots.length === 1
                ? 'One target in range.'
                : shots.length + ' targets: tap one on the board.'
              : spent
                ? 'Not this activation: its Primary Action went on ' + spentName + ', and an attack is a Primary Action too.'
                : engaged
                  ? 'No target: while Engaged, an attack must include an adjacent enemy, and none is in range and line of sight.'
                  : 'No enemy in range and line of sight.'}
          </div>
        </>
      ),
    }
  })

  const byAid = new Map<string, Action[]>()
  for (const a of legal.filter((x) => x.type === 'command')) byAid.set(a.aid!, [...(byAid.get(a.aid!) ?? []), a])
  const commands = [...byAid.entries()].map(([aid, acts]): BarItem => {
    const def = ability(u, aid)
    const targeted = acts.length > 1 || Boolean(acts[0]!.targetUid || acts[0]!.to || acts[0]!.gid)
    return {
      key: 'c' + aid,
      label: Text.abilityName(aid),
      sub: Text.abilityCost(def),
      cls: 'ability',
      testid: 'cmd-' + aid,
      info: Text.abilityText(def),
      run: targeted ? undefined : () => take(acts[0]!),
      runLabel: 'Use',
      choices: targeted ? acts.map((a) => ({ label: placeLabel(game, a, 'Use'), run: () => take(a), act: a })) : undefined,
    }
  })

  const plain = legal
    .filter((a) => a.type === 'energize' || a.type === 'rescue' || a.type === 'end_activation')
    .map((a): BarItem => ({
      key: a.type + (a.gid ?? ''),
      label: Names.ACTIONS[a.type] ?? a.type,
      cls: a.type === 'end_activation' ? 'end' : '',
      testid: 'act-' + a.type,
      info: Names.ACTION_HINTS[a.type] ?? '',
      run: () => take(a),
      runLabel: Names.ACTIONS[a.type] ?? 'Use',
    }))

  return {
    title: displayName(u.defId) + ' · ' + roleName(u.defId),
    hint: hints.join(' '),
    groups: [
      { label: 'Weapons', items: weapons },
      ...(commands.length ? [{ label: 'Commands', items: commands }] : []),
      ...(plain.length ? [{ label: 'Actions', items: plain }] : []),
    ],
  }
}

/** The Tactics hand as bar buttons; a card's text opens on tap, with its Play buttons when it can be played now. */
function handGroup(game: GameState, side: Side, legal: Action[], armed: string | null, hotseat: boolean): BarGroup {
  const p = game.players[side]!
  const items = p.tactics.hand.map((c): BarItem => {
    const plays = legal.filter((a) => a.type === 'tactics' && a.cid === c.cid)
    const isAttack = c.timing === 'attack'
    const key = 'card:' + c.cid
    const item: BarItem = {
      key,
      label: Text.tacticsName(c.cid),
      cls: 'card' + (plays.length ? ' playable' : ''),
      testid: 'card-' + c.cid,
      dim: !plays.length,
      info: (
        <>
          <div>{Text.abilityText(c)}</div>
          {!plays.length && <div className="dim">Not playable right now.</div>}
          {isAttack && plays.length > 0 && <div className="dim">Armed: tap a target on the board.</div>}
        </>
      ),
    }
    if (isAttack && plays.length) {
      item.arm = () => setStore({ armed: key })
      item.armed = armed === key
      if (plays.length === 1) {
        item.quick = () => take(plays[0]!)
        item.quickLabel = 'play it on ' + targetName(game, plays[0]!)
      }
    } else if (plays.length === 1 && !(plays[0]!.targetUid || plays[0]!.to || plays[0]!.gid)) {
      item.run = () => take(plays[0]!)
      item.runLabel = 'Play'
    } else if (plays.length >= 1) {
      item.choices = plays.map((a) => ({ label: placeLabel(game, a, 'Play'), run: () => take(a), act: a }))
    }
    return item
  })
  return { label: (hotseat ? sideName(side) + ' ' : '') + 'Tactics ' + p.tactics.hand.length + '·' + p.tactics.deck.length, items }
}

/** What a second tap on an open button does: run it, attack its only target, or play its only choice. */
function confirmOf(i: BarItem): (() => void) | null {
  return i.quick ?? i.run ?? (i.choices && i.choices.length === 1 ? i.choices[0]!.run : null)
}

function confirmLabel(i: BarItem): string {
  if (i.quick) return i.quickLabel ?? 'attack'
  const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1)
  if (i.run) return lower(i.runLabel ?? 'use')
  return i.choices && i.choices.length === 1 ? lower(i.choices[0]!.label) : ''
}

/** A targeted choice whose target stands on the board, so a tap on its hex can take it. */
function onBoard(game: GameState, c: { act: Action }): boolean {
  return Boolean(actionHex(game, c.act))
}

function ActionBar({ game }: { game: GameState }) {
  const armed = useGame((s) => s.armed)
  const ai = useGame((s) => s.ai)
  const af = useAffordances()
  const [barOpen, toggleBar] = useFold('actions', true)
  // the open button lives in the store, so a tap on the board can close it (game.ts clears it on every new state)
  const openKey = useGame((s) => s.openItem)
  const setOpenKey = (k: string | null) => setStore({ openItem: k })

  const act = game.activation
  const hotseat = !ai[0] && !ai[1]
  const d = deciderSide(game)
  const handSide: Side = hotseat && d !== null ? d : ai[0] && !ai[1] ? 1 : 0
  const spectating = ai[0] && ai[1]

  let title = ''
  let hint = ''
  let groups: BarGroup[] = []
  let deciding = false
  if (act && game.pending && d !== null && !ai[d]) {
    ;({ title, hint, groups } = decisionBar(game, af.legal))
    deciding = true
  } else if (act && game.pending) {
    title = sideName(d ?? act.side) + ' is responding'
  } else if (act && !ai[act.side]) {
    ;({ title, hint, groups } = turnBar(game, game.units[act.uid]!, af.legal, armed))
  } else if (act) {
    title = sideName(act.side) + ' is acting'
    hint = displayName(game.units[act.uid]!.defId) + ' is taking its turn.'
  }
  if (!spectating && (!deciding || game.pending?.kind !== 'window')) groups = [...groups, handGroup(game, handSide, af.legal, armed, hotseat)]
  const popNow = groups.flatMap((g) => g.items).find((i) => i.key === openKey) ?? null
  const pickKey = popNow && popNow.choices ? popNow.key + '|' + popNow.choices.length : null
  const choosing = deciding && (game.pending?.kind as string) === 'choose'
  useEffect(() => {
    if (popNow && popNow.choices) setStore({ picks: popNow.choices.filter((c) => onBoard(game, c)).map((c) => c.act) })
    else if (choosing) setStore({ picks: af.legal.filter((a) => a.type === 'choose' && actionHex(game, a)) })
    else setStore({ picks: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickKey, game, choosing])
  if (!title && !groups.length) return null

  const all = groups.flatMap((g) => g.items)
  const pop = all.find((i) => i.key === openKey) ?? null
  const tap = (i: BarItem) => {
    if (openKey === i.key) {
      // the second tap confirms; with nothing to confirm it closes (and disarms)
      const go = i.armed || !i.arm ? confirmOf(i) : null
      setStore({ openItem: null, picks: null, ...(i.arm ? { armed: null } : {}) })
      if (go) go()
      return
    }
    if (i.arm) {
      i.arm()
      setOpenKey(i.key)
    } else if (i.info) {
      setStore({ openItem: i.key, ...(armed ? { armed: null } : {}) })
    } else if (i.run) {
      i.run()
    }
  }
  const confirm = pop ? confirmOf(pop) : null

  return (
    <section className={'actionbar' + (deciding ? ' deciding' : '') + (barOpen ? '' : ' closed')} data-testid={deciding ? 'decision' : 'actions'}>
      {pop && barOpen && (
        <div className="bar-pop" data-testid="act-pop">
          <div className="pop-head">
            <strong>{pop.label}</strong>
            {pop.sub && <span className="dim"> · {pop.sub}</span>}
            <button className="pop-close" onClick={() => setOpenKey(null)} title="Close">×</button>
          </div>
          <div className="pop-body">{pop.info}</div>
          {pop.choices && pop.choices.length > 1 && (
            <div className="pop-confirm">
              Tap a cyan-ringed target on the board
              {pop.choices.some((c) => c.act.targetUid)
                ? ': ' +
                  pop.choices
                    .filter((c) => onBoard(game, c) && c.act.targetUid)
                    .map((c) => displayName(game.units[c.act.targetUid!]!.defId))
                    .join(', ')
                : ''}
              .
            </div>
          )}
          {confirm && (
            <div className="pop-confirm" data-testid="act-confirm-hint">
              {pop.quick || (pop.choices && pop.choices.length === 1) ? 'Tap the target, or tap ' : 'Tap '}
              <strong>{pop.label}</strong> again to {confirmLabel(pop)}.
            </div>
          )}
          {/* a target still in reserve has no hex to tap: it keeps a button */}
          {pop.choices && pop.choices.some((c) => !onBoard(game, c)) && (
            <div className="pop-actions">
              {pop.choices.map((c, i) =>
                onBoard(game, c) ? null : (
                  <button
                    key={i}
                    className="setup-go"
                    data-testid={c.testid ?? 'act-choice-' + i}
                    onClick={() => {
                      setOpenKey(null)
                      c.run()
                    }}
                  >
                    {c.label}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      )}
      <button className="fold-head bar-head" onClick={toggleBar} aria-expanded={barOpen} title={barOpen ? 'Minimize' : 'Expand'} data-testid="actions-fold">
        <span className="fold-title">
          {title}
          {hint && barOpen && <span className="bar-hint"> {hint}</span>}
        </span>
        <span className="fold-icon">{barOpen ? '–' : '+'}</span>
      </button>
      {barOpen && groups.some((g) => g.items.length) && (
        <div className="bar-row">
          {groups
            .filter((g) => g.items.length)
            .map((g) => (
              <div key={g.label} className="bar-group">
                <span className="bar-label">{g.label}</span>
                {g.items.map((i) => (
                  <button
                    key={i.key}
                    className={'bbtn ' + (i.cls ?? '') + (i.dim ? ' dimmed' : '') + (i.armed ? ' armed' : '') + (openKey === i.key ? ' open' : '') + (openKey === i.key && confirm ? ' confirm' : '')}
                    data-testid={i.testid}
                    onClick={() => tap(i)}
                  >
                    <strong>{i.label}</strong>
                    {openKey === i.key && confirm ? <span className="sub">tap to {confirmLabel(i)}</span> : i.sub && <span className="sub">{i.sub}</span>}
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}
    </section>
  )
}

// --- unit card -----------------------------------------------------------------------------------------------------------

function UnitCard({ game, u }: { game: GameState; u: EngineUnit }) {
  return (
    <Fold id="unit" className={'ucard ' + SIDE_CLASS[u.side]} testid="unit-card" defaultOpen={!isNarrow()} title={displayName(u.defId)}>
      <div className="dim">{roleName(u.defId)} · {sideName(u.side)}{u.inReserve ? ' · in reserve' : ''}</div>
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
    </Fold>
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
  for (let i = game.log.length - 1; i >= 0 && lines.length < 4; i--) {
    const d = describe(game, game.log[i]!)
    if (d) lines.push(d)
  }
  return (
    <Fold id="feed" className="feed" testid="feed" title={<span className="dim">{lines.length ? lines[0] : 'Log'}</span>}>
      {lines.slice(1).reverse().map((l, i) => <div key={i}>{l}</div>)}
    </Fold>
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
      <Feed game={game} />
      <div className="rightcol">{cardUnit && <UnitCard game={game} u={cardUnit} />}</div>
      <ActionBar game={game} />
      <HexInfo game={game} />
      <Banner />
      {isTerminal(game) && <GameOver game={game} />}
    </>
  )
}
