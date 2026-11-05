// Assembly Forge's own card faces for units and Tactics cards (NOTICE.md: no published frame, layout or text). A unit card
// is a gunmetal plate with a clipped corner: the machine's render as art over a glow in its side colour, the name and
// role over the art, a column of hexagonal stat badges (HP, VP, starting Timeline), the two weapons as rows of numbers,
// and the abilities with a timing chip. Every word comes from the content data through `Text` and `Names`.
import type { ReactNode } from 'react'
import { displayName, Names, roleName, Text, unitDef, type Ability, type TacticsCard, type Weapon } from '../engine'

const BASE = import.meta.env.BASE_URL

export const portraitUrl = (defId: string, framing: 'bust' | 'full'): string => BASE + 'assets/portraits/' + defId + '-' + framing + '.webp'

const TIMING_LABEL: Record<string, string> = { command: 'Command', response: 'Response', ongoing: 'Ongoing', attack: 'Attack', setup: 'Setup' }

function Hex({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className={'fc-hex ' + tone}>
      <span className="fc-hex-v">{value}</span>
      <span className="fc-hex-l">{label}</span>
    </div>
  )
}

function Timing({ timing, energy }: { timing: string; energy?: number }) {
  return (
    <span className="fc-chips">
      <span className={'fc-timing t-' + timing}>{TIMING_LABEL[timing] ?? timing}</span>
      {energy ? <span className="fc-energy">⚡{energy}</span> : null}
    </span>
  )
}

function WeaponRow({ w }: { w: Weapon }) {
  const extra = (w as Weapon & { effects?: unknown[] }).effects
  return (
    <div className="fc-weapon">
      <div className="fc-wname">{displayName(w.wid)}</div>
      <div className="fc-wnums">
        <span title="Timeline cost">
          <em>TL</em>
          {w.tlCost}
        </span>
        <span title="Range">
          <em>RNG</em>
          {(w as Weapon & { area?: unknown }).area ? 'AREA' : w.range}
        </span>
        <span title="Dice">
          <em>DICE</em>
          {w.strength}
        </span>
      </div>
      {Array.isArray(extra) && extra.length > 0 && <div className="fc-wtext">{extra.map((e) => Text.weaponEffectPhrase(e)).join(' ')}</div>}
      {w.ignoreLos && <div className="fc-wtext">Ignores line of sight.</div>}
      {w.crit && (
        <div className="fc-wtext">
          <b className="fc-crit">CRIT</b> {Names.critText(w.crit)}
        </div>
      )}
    </div>
  )
}

function AbilityRow({ a, compact }: { a: Ability; compact?: boolean }) {
  return (
    <div className="fc-ability">
      <div className="fc-aname">
        {Text.abilityName(a.aid)} <Timing timing={a.timing} energy={(a as Ability & { energy?: number }).energy} />
      </div>
      {!compact && <div className="fc-atext">{Text.abilityText(a)}</div>}
    </div>
  )
}

/** The art window: the full render over a glow, with a fallback monogram when the render is missing. */
function Art({ defId, framing, side, children }: { defId: string; framing: 'bust' | 'full'; side: 0 | 1; children?: ReactNode }) {
  return (
    <div className={'fc-art s' + side}>
      <img
        src={portraitUrl(defId, framing)}
        alt=""
        draggable={false}
        onError={(e) => {
          ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
        }}
      />
      {children}
    </div>
  )
}

/**
 * A unit's card.
 * @param size 'full' shows every rule; 'mini' keeps the art, stats and names (abilities by name only).
 */
export function UnitCardFace({ defId, side = 0, size = 'full' }: { defId: string; side?: 0 | 1; size?: 'full' | 'mini' }) {
  const d = unitDef(defId)
  const mini = size === 'mini'
  const traits = (d.traits ?? []).map((t) => Names.TRAITS?.[t] ?? t.replace(/-/g, ' '))
  return (
    <div className={'forge-card unit ' + size + ' s' + side} data-testid={'card-' + defId}>
      <Art defId={defId} framing="full" side={side}>
        <div className="fc-title">
          <div className="fc-role">{roleName(defId)}</div>
          <div className="fc-name">{displayName(defId)}</div>
        </div>
        <div className="fc-stats">
          <Hex label="HP" value={d.hp} tone="hp" />
          <Hex label="VP" value={d.vp} tone="vp" />
          <Hex label="TL" value={d.tl} tone="tl" />
        </div>
      </Art>
      <div className="fc-body">
        <div className="fc-weapons">
          {d.weapons.map((w) => (
            <WeaponRow key={w.wid} w={w} />
          ))}
        </div>
        <div className="fc-abilities">
          {d.abilities.map((a) => (
            <AbilityRow key={a.aid} a={a} compact={mini} />
          ))}
        </div>
      </div>
      {traits.length > 0 && !mini && (
        <div className="fc-traits">
          {traits.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/** A Tactics card: name, timing and cost, who may take it, and its rule, on a plate tinted by its timing. */
export function TacticsCardFace({ cid, card, onClick, on, disabled }: { cid: string; card: TacticsCard; onClick?: () => void; on?: boolean; disabled?: boolean }) {
  const c = card as TacticsCard & { requires?: { defId?: string; trait?: string }; energy?: number; timing: string }
  const req = c.requires?.defId ? displayName(c.requires.defId) : c.requires?.trait ? Names.TRAITS?.[c.requires.trait] ?? c.requires.trait.replace(/-/g, ' ') : null
  const body = (
    <>
      <div className="tc-head">
        <Timing timing={c.timing} energy={c.energy} />
        {req && <span className="tc-req">{req}</span>}
      </div>
      <div className="tc-name">{Text.tacticsName(cid)}</div>
      <div className="tc-text">{Text.abilityText(c)}</div>
    </>
  )
  const cls = 'forge-card tactics t-' + c.timing + (on ? ' on' : '')
  return onClick ? (
    <button className={cls} data-testid={'deck-' + cid} onClick={onClick} disabled={disabled}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}
