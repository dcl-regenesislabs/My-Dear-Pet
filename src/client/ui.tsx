// Mobile-first HUD + panels for MyDearPet, modeled on the cozy-farm IO layout:
//  - TOP: player profile bar (Caretaker level + XP) -> taps to Goals
//  - TOP (when a pet is selected): pet stat bars + care actions
//  - BOTTOM: 3 big nav buttons (Pets / Inventory / Goals)
//  - SIDES: Spin + Shop (right), Whistle (left)
// Reads the client mirror of authoritative server state.

import ReactEcs, { ReactEcsRenderer, Label, UiEntity, Input } from '@dcl/sdk/react-ecs'
import * as Cfg from '../shared/config'
import type { CareAction } from '../shared/types'
import { actions, adoptPet, clientState, everConnected, pushToast, serverConnected, switchActivePet } from './state'
import { setFollow, startPetting, cancelPetting } from './pet'
import { throwMeteor } from './play'
import { triggerCare, careActive, queueLength } from './input'
import { buyItemLocal, buySlotLocal, claimStreak, spinLocal, streakClaimable, streakWeekDay, useItemLocal } from './sim'
import { sway, startAnimSystem } from './ui/anim'
import { C, CareButton, CloseButton, Color, mobile, OutlineLabel, PanelShell, resolveRuntimePlatform, RoundedBadge, S, Sbtn, StatBar, TactileButton, useCompactCanvas } from './ui/theme'
import { DialogBox, openCaretakerIntro, openCaretakerTips, playerName } from './ui/dialog'

type Panel = 'none' | 'adopt' | 'shop' | 'roster' | 'inventory' | 'spin' | 'goals' | 'daily' | 'meteor'

const uiState = {
  panel: 'none' as Panel,
  shopTab: 'food' as 'food' | 'slots',
  adoptStep: 'pick' as 'pick' | 'name',
  adoptSpecies: Cfg.SPECIES[0],
  adoptName: ''
}

export const ui = {
  openAdopt(): void {
    uiState.panel = 'adopt'
    uiState.adoptStep = 'pick'
  },
  openShop(): void {
    uiState.panel = 'shop'
  },
  openRoster(): void {
    uiState.panel = 'roster'
  },
  openInventory(): void {
    uiState.panel = 'inventory'
  },
  openSpin(): void {
    uiState.panel = 'spin'
  },
  openGoals(): void {
    uiState.panel = 'goals'
  },
  openDaily(): void {
    uiState.panel = 'daily'
  },
  openMeteorReward(): void {
    uiState.panel = 'meteor'
  },
  // Auto-open the daily reward only when the screen is idle (no clashing popup).
  tryAutoOpenDaily(): void {
    if (uiState.panel === 'none' && !clientState.dialog.open) uiState.panel = 'daily'
  },
  openCaretaker(): void {
    if (!clientState.activePet) openCaretakerIntro(() => ui.openAdopt())
    else openCaretakerTips()
  },
  close(): void {
    uiState.panel = 'none'
  }
}

// ---------------------------------------------------------------------------
// Top profile bar (Caretaker level + XP + coins) -> tap opens Goals
// ---------------------------------------------------------------------------
function ProfileBar() {
  const p = clientState.player
  if (!p) return <UiEntity />
  const isM = mobile()
  const lvl = p.caretakerLevel
  const base = Cfg.xpForLevel(lvl)
  const next = Cfg.xpForLevel(lvl + 1)
  const frac = next > base ? Math.max(0, Math.min(1, (p.caretakerXp - base) / (next - base))) : 1

  // Mobile: a big top-left pill (Roblox-style corner HUD) — huge level badge
  // and coin count, name/XP bar tucked underneath so it stays thumb-clear.
  if (isM) {
    const W = S(430)
    const badgeD = S(64)
    return (
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: S(130), left: S(32) }, width: W, height: S(96), flexDirection: 'row', alignItems: 'center', padding: { left: S(10), right: S(16) }, borderRadius: S(40), pointerFilter: 'block' }}
        uiBackground={{ color: C.panelBg }}
        onMouseDown={() => ui.openGoals()}
      >
        <RoundedBadge text={`${lvl}`} size={badgeD} bg={C.green} fontSize={S(30)} />
        <UiEntity uiTransform={{ flex: 1, height: '100%', flexDirection: 'column', justifyContent: 'center', margin: { left: S(14) } }}>
          <Label value={playerName()} fontSize={S(20)} color={C.text} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: '100%', height: S(26) }} />
          <UiEntity uiTransform={{ width: '100%', height: S(16), borderRadius: S(8), margin: { top: S(4), bottom: S(4) } }} uiBackground={{ color: C.trackBg }}>
            <UiEntity uiTransform={{ width: `${Math.round(frac * 100)}%`, height: '100%', borderRadius: S(8) }} uiBackground={{ color: C.gold }} />
          </UiEntity>
          <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', alignItems: 'center' }}>
            <RoundedBadge text="C" size={S(24)} bg={C.gold} fontSize={S(13)} />
            <Label value={`${Math.floor(p.currency)}`} fontSize={S(19)} color={C.gold} textAlign="middle-left" uiTransform={{ width: S(120), height: S(24), margin: { left: S(6) } }} />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    )
  }

  const W = S(360)
  // Explicit middle width so the flex column never collapses (which would wrap
  // the label vertically and shove the coins around).
  const midW = W - S(8) - S(12) - S(48) - S(10) - S(86) - S(8)

  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: S(10), left: '50%' }, margin: { left: -W / 2 }, width: W, height: S(64), flexDirection: 'row', alignItems: 'center', padding: { left: S(8), right: S(12) }, borderRadius: S(32), pointerFilter: 'block' }}
      uiBackground={{ color: C.panelBg }}
      onMouseDown={() => ui.openGoals()}
    >
      {/* level badge */}
      <RoundedBadge text={`${lvl}`} size={S(48)} bg={C.green} fontSize={S(24)} />
      {/* name + xp bar */}
      <UiEntity uiTransform={{ width: midW, height: '100%', flexDirection: 'column', justifyContent: 'center', margin: { left: S(10) } }}>
        <Label value={`${playerName()}  ·  Lv ${lvl}`} fontSize={S(15)} color={C.text} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: midW, height: S(18) }} />
        <UiEntity uiTransform={{ width: '100%', height: S(12), borderRadius: S(6), margin: { top: S(2) } }} uiBackground={{ color: C.trackBg }}>
          <UiEntity uiTransform={{ width: `${Math.round(frac * 100)}%`, height: '100%', borderRadius: S(6) }} uiBackground={{ color: C.gold }} />
        </UiEntity>
      </UiEntity>
      {/* coins */}
      <UiEntity uiTransform={{ width: S(86), height: S(40), flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', margin: { left: S(8) } }}>
        <RoundedBadge text="C" size={S(26)} bg={C.gold} fontSize={S(14)} />
        <Label value={`${Math.floor(p.currency)}`} fontSize={S(17)} color={C.text} textAlign="middle-right" uiTransform={{ width: S(50), height: S(40), margin: { left: S(5) } }} />
      </UiEntity>
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Colony meter (top, right of the profile) — the shared Mars population and the
// milestone we're all building toward. Broadcast by the server, so every player
// sees the same number.
// ---------------------------------------------------------------------------
function ColonyBar() {
  const pop = clientState.colonyPopulation
  const goal = Cfg.COLONY_GOAL
  const frac = goal > 0 ? Math.max(0, Math.min(1, pop / goal)) : 0
  const isM = mobile()
  const W = isM ? S(300) : S(190)
  const position = isM ? { top: S(130), right: S(32) } : { top: S(10), left: '50%' as any }
  const margin = isM ? undefined : { left: S(360) / 2 + S(10) }
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position,
        margin,
        width: W,
        height: isM ? S(80) : S(64),
        flexDirection: 'column',
        justifyContent: 'center',
        padding: { left: S(16), right: S(16) },
        borderRadius: S(32),
        pointerFilter: 'none'
      }}
      uiBackground={{ color: C.panelBg }}
    >
      <Label
        value="Mars Colony"
        fontSize={isM ? S(15) : S(12)}
        color={C.dim}
        textAlign="middle-left"
        textWrap="nowrap"
        uiTransform={{ width: '100%', height: isM ? S(20) : S(16) }}
      />
      <Label
        value={`${pop} / ${goal} pets`}
        fontSize={isM ? S(21) : S(17)}
        color={C.text}
        textAlign="middle-left"
        textWrap="nowrap"
        uiTransform={{ width: '100%', height: isM ? S(26) : S(22) }}
      />
      <UiEntity
        uiTransform={{ width: '100%', height: isM ? S(12) : S(9), borderRadius: S(6), margin: { top: S(3) } }}
        uiBackground={{ color: C.trackBg }}
      >
        <UiEntity
          uiTransform={{ width: `${Math.round(frac * 100)}%`, height: '100%', borderRadius: S(5) }}
          uiBackground={{ color: C.green }}
        />
      </UiEntity>
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Selected-pet panel (top): stats + care actions
// ---------------------------------------------------------------------------
// Stat bars use a 1-2 letter colored badge instead of an icon PNG.
// Desktop: compact card above the HUD. Mobile: a wide, chunky bottom-anchored
// sheet with big circular care buttons — thumb-reachable, Roblox-style.
function PetPanel() {
  const pet = clientState.activePet
  if (!pet || !clientState.petPanelOpen) return <UiEntity />
  const care = (a: CareAction) => triggerCare(a)
  const isM = mobile()

  const doSleep = () => {
    // Waking is instant — no walk back to the bed first.
    if (pet.sleeping) {
      pet.sleeping = false
      actions.care('sleep', true)
    } else care('sleep')
  }

  // "Play" enters Fetch mode (throw-and-retrieve minigame in play.ts) instead
  // of applying the care action directly — it hides the panel and shows the
  // centered Fetch button (see FetchOverlay below).
  const doPlay = () => {
    clientState.fetch.active = true
    clientState.petPanelOpen = false
  }

  const unlocked = pet.petLevel >= Cfg.BREEDING_UNLOCK_LEVEL
  const partner = clientState.player?.pets.find((x) => x.id !== pet.id)
  const doBreed = () => {
    if (!unlocked) {
      pushToast(`Breeding unlocks at level ${Cfg.BREEDING_UNLOCK_LEVEL}.`)
      return
    }
    if (!partner) {
      pushToast('You need a second pet to breed with.')
      return
    }
    actions.breed(partner.id)
  }

  // Background 40% smaller on mobile (it overflowed the safe area) — care
  // button circles are scaled down to match so the row still fits without
  // overlapping the edges; every fontSize below is independent of these
  // dimensions, so none of the text/glyphs shrink.
  const PW = isM ? S(456) : S(480)
  const careSize = isM ? Sbtn(58) : S(56)
  const halfW = Math.round((PW - S(40) - S(8)) / 2)

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: isM ? { bottom: S(150), left: '50%' } : { top: S(84), left: '50%' },
        margin: { left: -PW / 2 },
        width: PW,
        flexDirection: 'column',
        alignItems: 'center',
        padding: { top: S(16), bottom: S(16), left: S(20), right: S(20) },
        borderRadius: isM ? S(28) : S(24),
        pointerFilter: 'block'
      }}
      uiBackground={{ color: C.panelBg }}
    >
      {/* Close */}
      <UiEntity uiTransform={{ positionType: 'absolute', position: { top: S(10), right: S(10) } }}>
        <CloseButton onClick={() => (clientState.petPanelOpen = false)} size={isM ? S(48) : S(36)} />
      </UiEntity>

      <UiEntity uiTransform={{ width: '100%', height: isM ? S(34) : S(24), flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
        <OutlineLabel value={`${pet.name}   Lv ${pet.petLevel}`} fontSize={isM ? S(24) : S(17)} color={C.gold} width={isM ? S(340) : S(220)} height={isM ? S(30) : S(22)} textAlign="middle-center" />
        {careActive() && <Label value={`busy${queueLength() > 0 ? ` +${queueLength()}` : ''}`} fontSize={isM ? S(17) : S(13)} color={C.dim} textAlign="middle-left" uiTransform={{ width: S(90), height: S(26), margin: { left: S(8) } }} />}
      </UiEntity>

      {/* Four full-width stat bars */}
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', margin: { top: S(8) } }}>
        <StatBar label="Hunger" value={pet.hunger} color={C.hunger} width={PW - S(40)} badge="H" thickness={isM ? S(20) : S(15)} />
        <StatBar label="Hygiene" value={pet.hygiene} color={C.hygiene} width={PW - S(40)} badge="Hy" thickness={isM ? S(20) : S(15)} />
        <StatBar label="Energy" value={pet.energy} color={C.energy} width={PW - S(40)} badge="E" thickness={isM ? S(20) : S(15)} />
        <StatBar label="Happy" value={pet.happiness} color={C.happy} width={PW - S(40)} badge="Ha" thickness={isM ? S(20) : S(15)} />
      </UiEntity>

      {/* Care actions — big circular tap targets, always rounded */}
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { top: S(10) } }}>
        <CareButton id="care_feed" caption="Feed" glyph="F" bg={C.hunger} size={careSize} onClick={() => care('feed')} />
        <CareButton id="care_bath" caption="Bath" glyph="B" bg={C.hygiene} size={careSize} onClick={() => care('clean')} />
        <CareButton id="care_sleep" caption={pet.sleeping ? 'Wake' : 'Sleep'} glyph={pet.sleeping ? 'W' : 'S'} bg={C.energy} size={careSize} onClick={doSleep} />
        <CareButton id="care_play" caption="Play" glyph="P" bg={C.happy} size={careSize} onClick={doPlay} />
      </UiEntity>

      {/* Pet + Breed, side by side and equal size. Pet is the affection gesture
          (raises Happy, via the swipe-to-pet overlay); Breed is locked until
          Lv X and crosses with the first other owned pet (cross-player
          registry is the follow-up). */}
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { top: S(10) } }}>
        <TactileButton
          id="pet_gesture"
          label="Pet  ·  +Happy"
          width={halfW}
          height={isM ? S(64) : S(38)}
          bg={C.happy}
          textColor={C.outline}
          fontSize={isM ? S(19) : S(15)}
          radius={S(20)}
          margin={{ right: S(4) }}
          onClick={() => startPetting()}
        />
        <TactileButton
          id="breed_teaser"
          label={unlocked ? 'Breed' : `Breed  ·  Lv ${Cfg.BREEDING_UNLOCK_LEVEL}`}
          width={halfW}
          height={isM ? S(64) : S(38)}
          bg={unlocked ? C.pink : C.cardAlt}
          textColor={unlocked ? C.outline : C.dim}
          fontSize={isM ? S(19) : S(15)}
          radius={S(20)}
          margin={{ left: S(4) }}
          pulse={unlocked}
          onClick={doBreed}
        />
      </UiEntity>
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Bottom nav: 3 big buttons (cozy-farm style)
// ---------------------------------------------------------------------------
function BottomNav() {
  const p = clientState.player
  // Hidden while a dialog is open — the dialog sits where these buttons are.
  // Also hidden in Fetch mode, which owns the bottom-center of the screen.
  if (!p || clientState.dialog.open || clientState.fetch.active) return <UiEntity />
  const isM = mobile()
  // Mobile: rounded-square tiles filling the bottom edge — a completely
  // different, thumb-first layout vs. the compact desktop pills. Sized down
  // from the original big tiles (they overflowed the safe area); the font
  // size stays the same so the labels don't shrink along with the buttons.
  const bw = isM ? S(210) : Sbtn(160)
  const bh = isM ? S(84) : Sbtn(72)
  const font = isM ? S(24) : S(20)
  const active = C.green
  const inactive = C.card
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: isM ? S(28) : S(18), left: 0 }, width: '100%', height: bh, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
      <TactileButton
        id="nav_pets"
        label="My Pets"
        bg={uiState.panel === 'roster' ? active : inactive}
        textColor={uiState.panel === 'roster' ? C.outline : C.text}
        width={bw}
        height={bh}
        fontSize={font}
        radius={isM ? S(28) : S(18)}
        margin={{ left: S(8), right: S(8) }}
        onClick={() => ui.openRoster()}
      />
      <TactileButton
        id="nav_inv"
        label="Inventory"
        bg={uiState.panel === 'inventory' ? active : inactive}
        textColor={uiState.panel === 'inventory' ? C.outline : C.text}
        width={bw}
        height={bh}
        fontSize={font}
        radius={isM ? S(28) : S(18)}
        margin={{ left: S(8), right: S(8) }}
        onClick={() => ui.openInventory()}
      />
      <TactileButton
        id="nav_goals"
        label="Goals"
        bg={uiState.panel === 'goals' ? active : inactive}
        textColor={uiState.panel === 'goals' ? C.outline : C.text}
        width={bw}
        height={bh}
        fontSize={font}
        radius={isM ? S(28) : S(18)}
        margin={{ left: S(8), right: S(8) }}
        onClick={() => ui.openGoals()}
      />
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Side buttons: Spin + Shop (right), Whistle (left)
// ---------------------------------------------------------------------------
function SideButtons() {
  const p = clientState.player
  if (!p || clientState.fetch.active) return <UiEntity />
  const isM = mobile()
  const hasPet = !!clientState.activePet
  const spins = p.spinTickets > 0
  // Mobile: big round floating-action buttons anchored in the corners
  // (classic mobile-game placement) instead of the desktop's thin side rail.
  if (isM) {
    const fab = Sbtn(120)
    return (
      <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 }, pointerFilter: 'none' }}>
        <UiEntity uiTransform={{ positionType: 'absolute', position: { right: S(24), bottom: S(300) }, pointerFilter: 'none' }}>
          <CareButton id="side_spin" caption="Spin" glyph="S" bg={spins ? C.pink : C.cardAlt} size={fab} pulse={spins} onClick={() => ui.openSpin()} />
        </UiEntity>
        {hasPet && (
          <UiEntity uiTransform={{ positionType: 'absolute', position: { left: S(24), bottom: S(300) }, pointerFilter: 'none' }}>
            <CareButton id="side_whistle" caption={clientState.followEnabled ? 'Stay' : 'Whistle'} glyph={clientState.followEnabled ? 'X' : 'W'} bg={C.cardAlt} size={fab} onClick={() => setFollow(!clientState.followEnabled)} />
          </UiEntity>
        )}
      </UiEntity>
    )
  }
  const w = Sbtn(112)
  const h = Sbtn(58)
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 }, pointerFilter: 'none' }}>
      {/* right side */}
      <UiEntity uiTransform={{ positionType: 'absolute', position: { right: S(12), top: 0 }, width: w, height: '100%', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', pointerFilter: 'none' }}>
        {/* Daily reward is suspended for now — the meteor is the daily drop. */}
        <TactileButton id="side_spin" label="Spin" width={w} height={h} bg={spins ? C.pink : C.cardAlt} textColor={spins ? C.outline : C.text} radius={S(20)} margin={{ bottom: S(10) }} pulse={spins} fontSize={S(18)} onClick={() => ui.openSpin()} />
        {/* Shop is suspended for now — the panel still exists, just unreachable. */}
      </UiEntity>
      {/* left side */}
      {hasPet && (
        <UiEntity uiTransform={{ positionType: 'absolute', position: { left: S(12), top: 0 }, width: w, height: '100%', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', pointerFilter: 'none' }}>
          <TactileButton id="side_whistle" label={clientState.followEnabled ? 'Stay' : 'Whistle'} width={w} height={h} bg={C.cardAlt} radius={S(20)} fontSize={S(18)} onClick={() => setFollow(!clientState.followEnabled)} />
        </UiEntity>
      )}
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Shared row
// ---------------------------------------------------------------------------
function Row(props: { key?: string | number; children?: any; h?: number }) {
  return (
    <UiEntity
      uiTransform={{ width: '100%', height: props.h ?? S(60), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', margin: { bottom: S(8) }, padding: { left: S(12), right: S(12) }, borderRadius: S(14) }}
      uiBackground={{ color: C.card }}
    >
      {props.children}
    </UiEntity>
  )
}

function CoinIcon(props: { accent?: Color; size?: number }) {
  const d = props.size ?? S(26)
  return (
    <UiEntity uiTransform={{ width: d, height: d, borderRadius: d / 2, alignItems: 'center', justifyContent: 'center' }} uiBackground={{ color: props.accent ?? C.gold }}>
      <Label value="C" fontSize={Math.round(d * 0.55)} color={C.outline} textAlign="middle-center" uiTransform={{ width: d, height: d }} />
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Adoption (stepped wizard: pick -> name -> confirm)
// ---------------------------------------------------------------------------
const SPECIES_COLORS: Color[] = [C.hunger, C.hygiene, C.energy, C.happy, C.green, C.gold, C.pink, C.blue, C.greenDark, C.cardAlt, C.pink]
function speciesColor(s: string): Color {
  const i = Cfg.SPECIES.indexOf(s)
  return SPECIES_COLORS[(i < 0 ? 0 : i) % SPECIES_COLORS.length]
}

function SpeciesCard(props: { key?: string; species: string }) {
  const selected = uiState.adoptSpecies === props.species
  const disc = S(60)
  return (
    <UiEntity
      uiTransform={{ width: S(150), height: S(136), flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: S(6), borderRadius: S(16), padding: S(4) }}
      uiBackground={{ color: selected ? C.green : C.card }}
      onMouseDown={() => {
        uiState.adoptSpecies = props.species
      }}
    >
      <UiEntity uiTransform={{ width: disc, height: disc, borderRadius: disc / 2, margin: { bottom: S(8) } }} uiBackground={{ color: speciesColor(props.species) }} />
      <Label value={props.species.replace('Pet', '')} fontSize={S(16)} color={selected ? C.outline : C.text} textAlign="middle-center" uiTransform={{ width: '100%', height: S(22) }} />
    </UiEntity>
  )
}

function AdoptPanel() {
  const p = clientState.player
  const slotsFree = p ? p.pets.length < p.petSlots : true
  const sp = uiState.adoptSpecies

  if (uiState.adoptStep === 'pick') {
    return (
      <PanelShell title="Choose a Pet" width={S(720)} height={S(740)} onClose={() => ui.close()}>
        <Label value="Tap a friend to choose, then Next." fontSize={S(16)} color={C.dim} uiTransform={{ width: '100%', height: S(26), margin: { bottom: S(6) } }} />
        <UiEntity uiTransform={{ width: '100%', flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'flex-start', overflow: 'scroll' }}>
          {Cfg.SPECIES.map((s) => (
            <SpeciesCard key={s} species={s} />
          ))}
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', justifyContent: 'center', margin: { top: S(8) } }}>
          <TactileButton id="adopt_next" label={`Next: ${sp.replace('Pet', '')}  >`} width={S(320)} height={S(62)} bg={C.green} textColor={C.outline} fontSize={S(22)} pulse onClick={() => (uiState.adoptStep = 'name')} />
        </UiEntity>
      </PanelShell>
    )
  }

  // Name + confirm step
  const disc = S(120)
  return (
    <PanelShell title="Name your Pet" width={S(620)} height={S(620)} onClose={() => ui.close()}>
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
        <UiEntity uiTransform={{ width: disc, height: disc, borderRadius: disc / 2, margin: { top: S(10), bottom: S(8) } }} uiBackground={{ color: speciesColor(sp) }} />
        <Label value={sp.replace('Pet', '')} fontSize={S(22)} color={C.gold} textAlign="middle-center" uiTransform={{ width: '100%', height: S(30) }} />
        <Input
          placeholder="Type a name..."
          fontSize={S(18)}
          color={C.text}
          placeholderColor={C.dim}
          uiTransform={{ width: S(420), height: S(54), margin: { top: S(14), bottom: S(10) } }}
          uiBackground={{ color: C.card }}
          onChange={(v) => {
            uiState.adoptName = v
          }}
        />
        {!slotsFree && <Label value="No free pet slots — buy one first." fontSize={S(15)} color={C.hunger} uiTransform={{ width: '100%', height: S(24) }} />}
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { top: S(6) } }}>
        <TactileButton id="adopt_back" label="< Back" width={S(150)} height={S(60)} bg={C.cardAlt} fontSize={S(18)} margin={{ right: S(12) }} onClick={() => (uiState.adoptStep = 'pick')} />
        {slotsFree ? (
          <TactileButton
            id="adopt_confirm"
            label="Adopt!"
            width={S(240)}
            height={S(60)}
            bg={C.green}
            textColor={C.outline}
            fontSize={S(24)}
            pulse
            onClick={() => {
              adoptPet(sp, uiState.adoptName)
              uiState.adoptName = ''
              ui.close()
            }}
          />
        ) : (
          <TactileButton id="adopt_buyslot" label={`Buy Slot ${Cfg.SLOT_PRICE}`} width={S(240)} height={S(60)} bg={C.gold} textColor={C.outline} fontSize={S(20)} onClick={() => actions.buySlot()} />
        )}
      </UiEntity>
    </PanelShell>
  )
}

// ---------------------------------------------------------------------------
// Shop (tabbed: Food / Slots)
// ---------------------------------------------------------------------------
function ShopTab(props: { id: 'food' | 'slots'; label: string }) {
  const active = uiState.shopTab === props.id
  return (
    <TactileButton
      id={`shoptab_${props.id}`}
      label={props.label}
      width={S(150)}
      height={S(50)}
      bg={active ? C.green : C.card}
      textColor={active ? C.outline : C.text}
      fontSize={S(17)}
      radius={S(14)}
      margin={{ left: S(6), right: S(6) }}
      onClick={() => {
        uiState.shopTab = props.id
      }}
    />
  )
}

// One product card in the shop grid.
function ShopCard(props: { key?: string; title: string; desc: string; price: number; color: Color; onBuy: () => void; id: string; disabled?: boolean }) {
  const cardW = S(296)
  const icon = S(64)
  return (
    <UiEntity uiTransform={{ width: cardW, height: S(196), flexDirection: 'column', alignItems: 'center', margin: S(6), padding: S(12), borderRadius: S(16) }} uiBackground={{ color: C.card }}>
      <UiEntity uiTransform={{ width: icon, height: icon, borderRadius: S(14), margin: { top: S(4), bottom: S(8) } }} uiBackground={{ color: props.color }} />
      <Label value={props.title} fontSize={S(17)} color={C.text} textAlign="middle-center" uiTransform={{ width: '100%', height: S(24) }} />
      <Label value={props.desc} fontSize={S(13)} color={C.dim} textAlign="middle-center" uiTransform={{ width: '100%', height: S(34) }} />
      <TactileButton id={props.id} label={`Buy  ${props.price}`} width={S(170)} height={S(48)} bg={props.disabled ? C.cardAlt : C.greenDark} fontSize={S(16)} disabled={props.disabled} margin={{ top: S(6) }} onClick={props.onBuy} />
    </UiEntity>
  )
}

function ShopPanel() {
  const p = clientState.player
  return (
    <PanelShell title="Shop" width={S(700)} onClose={() => ui.close()}>
      <UiEntity uiTransform={{ width: '100%', height: S(34), flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', margin: { bottom: S(8) } }}>
        <CoinIcon />
        <Label value={`${p ? Math.floor(p.currency) : 0}`} fontSize={S(18)} color={C.gold} textAlign="middle-left" uiTransform={{ width: S(90), height: S(34), margin: { left: S(6) } }} />
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { bottom: S(12) } }}>
        <ShopTab id="food" label="Food" />
        <ShopTab id="slots" label="Pet Slots" />
      </UiEntity>

      {uiState.shopTab === 'food' && (
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
          {Cfg.SHOP_ITEMS.map((item) => (
            <ShopCard
              key={`shop-${item.tier}`}
              id={`buy_${item.tier}`}
              title={item.label}
              desc={`+${item.hunger} hunger${item.happiness ? `, +${item.happiness} happy` : ''}`}
              price={item.price}
              color={item.tier === 2 ? C.happy : C.hunger}
              onBuy={() => {
                if (buyItemLocal(item.tier)) pushToast(`Bought ${item.label}`)
                else pushToast('Not enough coins')
                actions.buyItem(item.tier)
              }}
            />
          ))}
        </UiEntity>
      )}

      {uiState.shopTab === 'slots' && (
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', alignItems: 'center' }}>
          <Label value={`Pet slots used: ${p ? p.pets.length : 0} / ${p ? p.petSlots : 1}`} fontSize={S(16)} color={C.text} uiTransform={{ width: '100%', height: S(34), margin: { bottom: S(12) } }} textAlign="middle-center" />
          <ShopCard
            id="buy_slot"
            title="Extra Pet Slot"
            desc="Raise more pets at once"
            price={Cfg.SLOT_PRICE}
            color={C.gold}
            disabled={!!p && p.petSlots >= Cfg.MAX_SLOTS}
            onBuy={() => {
              if (buySlotLocal()) pushToast('Unlocked a pet slot!')
              else pushToast('Not enough coins')
              actions.buySlot()
            }}
          />
        </UiEntity>
      )}
    </PanelShell>
  )
}

// ---------------------------------------------------------------------------
// Inventory (use food on the active pet)
// ---------------------------------------------------------------------------
// One slot in the inventory grid (count badge on the icon).
function InvCard(props: { key?: string; id: string; title: string; count: number; color: Color; onUse: () => void }) {
  const icon = S(64)
  return (
    <UiEntity uiTransform={{ width: S(296), height: S(196), flexDirection: 'column', alignItems: 'center', margin: S(6), padding: S(12), borderRadius: S(16) }} uiBackground={{ color: C.card }}>
      <UiEntity uiTransform={{ width: icon, height: icon, borderRadius: S(14), margin: { top: S(4), bottom: S(8) }, alignItems: 'center', justifyContent: 'center' }} uiBackground={{ color: props.color }}>
        <Label value={`x${props.count}`} fontSize={S(22)} color={C.outline} textAlign="middle-center" uiTransform={{ width: icon, height: icon }} />
      </UiEntity>
      <Label value={props.title} fontSize={S(17)} color={C.text} textAlign="middle-center" uiTransform={{ width: '100%', height: S(28) }} />
      <TactileButton id={props.id} label="Use" width={S(170)} height={S(48)} bg={props.count > 0 ? C.greenDark : C.cardAlt} fontSize={S(16)} disabled={props.count <= 0} margin={{ top: S(8) }} onClick={() => props.onUse()} />
    </UiEntity>
  )
}

function InventoryPanel() {
  const p = clientState.player
  const t1 = p?.inventory.tier1 ?? 0
  const t2 = p?.inventory.tier2 ?? 0
  return (
    <PanelShell title="Inventory" width={S(700)} onClose={() => ui.close()}>
      <Label value="Tap Use to feed your active pet." fontSize={S(15)} color={C.dim} uiTransform={{ width: '100%', height: S(26), margin: { bottom: S(8) } }} textAlign="middle-center" />
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
        <InvCard key="inv-1" id="use_1" title={Cfg.SHOP_ITEMS[0].label} count={t1} color={C.hunger} onUse={() => { if (useItemLocal(1)) pushToast('Fed your pet!'); actions.useItem(1) }} />
        <InvCard key="inv-2" id="use_2" title={Cfg.SHOP_ITEMS[1].label} count={t2} color={C.happy} onUse={() => { if (useItemLocal(2)) pushToast('Fed your pet!'); actions.useItem(2) }} />
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', justifyContent: 'center', margin: { top: S(10) } }}>
        {/* Shop is suspended for now. */}
      </UiEntity>
    </PanelShell>
  )
}

// ---------------------------------------------------------------------------
// Roster (Pets) — selection system
// ---------------------------------------------------------------------------
function RosterPanel() {
  const p = clientState.player
  const pets = p?.pets ?? []
  const slotsFree = p ? pets.length < p.petSlots : false
  return (
    <PanelShell title="My Pets" width={S(680)} onClose={() => ui.close()}>
      <Label value={`Select your active pet — slots ${pets.length}/${p?.petSlots ?? 1}`} fontSize={S(15)} color={C.dim} uiTransform={{ width: '100%', height: S(26) }} />
      <UiEntity uiTransform={{ width: '100%', flex: 1, flexDirection: 'column', overflow: 'scroll' }}>
        {pets.map((pet) => {
          const isActive = pet.id === p?.activePetId
          return (
            <Row key={pet.id} h={S(64)}>
              <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center' }}>
                <UiEntity uiTransform={{ width: S(44), height: S(44), borderRadius: S(22), margin: { right: S(12) } }} uiBackground={{ color: isActive ? C.green : C.cardAlt }} />
                <Label value={`${pet.name}  ·  ${pet.species.replace('Pet', '')}  ·  Lv ${pet.petLevel}`} fontSize={S(16)} color={isActive ? C.green : C.text} textAlign="middle-left" uiTransform={{ width: S(300), height: S(40) }} />
              </UiEntity>
              <TactileButton id={`switch_${pet.id}`} label={isActive ? 'Active' : 'Select'} width={S(120)} height={S(46)} bg={isActive ? C.greenDark : C.cardAlt} fontSize={S(15)} disabled={isActive} onClick={() => switchActivePet(pet.id)} />
            </Row>
          )
        })}
      </UiEntity>
      {slotsFree && (
        <UiEntity uiTransform={{ width: '100%', justifyContent: 'center' }}>
          <TactileButton id="roster_adopt" label="Adopt Another Pet" width={S(300)} height={S(56)} bg={C.green} textColor={C.outline} fontSize={S(18)} onClick={() => ui.openAdopt()} />
        </UiEntity>
      )}
    </PanelShell>
  )
}

// ---------------------------------------------------------------------------
// Spin
// ---------------------------------------------------------------------------
function SpinPanel() {
  const p = clientState.player
  const last = clientState.lastSpin
  return (
    <PanelShell title="Spin Wheel" width={S(640)} onClose={() => ui.close()}>
      <Label value={`Spin tickets: ${p?.spinTickets ?? 0}`} fontSize={S(18)} color={C.gold} uiTransform={{ width: '100%', height: S(30) }} />
      <UiEntity uiTransform={{ width: '100%', flex: 1, flexDirection: 'column', margin: { top: S(6) } }}>
        {Cfg.SPIN_REWARDS.map((r, i) => (
          <UiEntity
            key={`spin-${i}`}
            uiTransform={{ width: '100%', height: S(38), flexDirection: 'row', alignItems: 'center', padding: { left: S(14) }, margin: { bottom: S(5) }, borderRadius: S(10) }}
            uiBackground={{ color: r.rarity === 'jackpot' ? { r: 0.4, g: 0.2, b: 0.34, a: 1 } : r.rarity === 'rare' ? { r: 0.34, g: 0.3, b: 0.16, a: 1 } : C.card }}
          >
            <Label value={`${r.rarity.toUpperCase()}  -  ${r.label}`} fontSize={S(15)} color={r.rarity === 'jackpot' ? C.happy : r.rarity === 'rare' ? C.energy : C.dim} textAlign="middle-left" uiTransform={{ width: '100%', height: S(32) }} />
          </UiEntity>
        ))}
      </UiEntity>
      {last && <Label value={`You won: ${last.reward.label}!`} fontSize={S(20)} color={C.green} uiTransform={{ width: '100%', height: S(32) }} textAlign="middle-center" />}
      <UiEntity uiTransform={{ width: '100%', justifyContent: 'center', margin: { top: S(6) } }}>
        <TactileButton
          id="do_spin"
          label="SPIN!"
          width={S(300)}
          height={S(64)}
          bg={C.pink}
          textColor={C.outline}
          fontSize={S(26)}
          disabled={(p?.spinTickets ?? 0) <= 0}
          pulse={(p?.spinTickets ?? 0) > 0}
          onClick={() => {
            const res = spinLocal()
            if (res) {
              clientState.lastSpin = { reward: res.reward, index: res.index, at: Date.now() }
              pushToast(`Spin: ${res.reward.label}!`)
            }
            actions.spin()
          }}
        />
      </UiEntity>
    </PanelShell>
  )
}

// ---------------------------------------------------------------------------
// Server connection indicator — dev/debug. Green while the authoritative server
// is answering; a red warning when it goes quiet (we're on local sim only, so
// nothing persists).
// ---------------------------------------------------------------------------
const WARN_RED: Color = { r: 0.9, g: 0.26, b: 0.2, a: 1 }

function ServerStatus() {
  const ok = serverConnected()
  const isM = mobile()
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        // Pulled in further from the edge on mobile — it was rendering
        // partially off-screen at the old right: S(12) inset.
        position: isM ? { bottom: S(10), right: S(70) } : { bottom: S(10), right: S(12) },
        height: S(30),
        flexDirection: 'row',
        alignItems: 'center',
        padding: { left: S(8), right: S(12) },
        borderRadius: S(15),
        pointerFilter: 'none'
      }}
      uiBackground={{ color: ok ? C.panelBg : WARN_RED }}
    >
      <UiEntity
        uiTransform={{ width: S(10), height: S(10), borderRadius: S(5), margin: { right: S(7) } }}
        uiBackground={{ color: ok ? C.green : C.text }}
      />
      <Label
        value={ok ? 'Server' : 'Server offline — not saving'}
        fontSize={S(12)}
        color={C.text}
        textAlign="middle-left"
        textWrap="nowrap"
        uiTransform={{ height: S(20) }}
      />
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Meteor reward — the daily meteor cracked open (reuses the spin reward pool)
// ---------------------------------------------------------------------------
function MeteorRewardPanel() {
  const last = clientState.lastSpin
  if (!last) return <UiEntity />
  const r = last.reward
  const accent = r.rarity === 'jackpot' ? C.happy : r.rarity === 'rare' ? C.energy : C.gold
  return (
    <PanelShell title="Meteor Cracked Open!" width={S(520)} onClose={() => ui.close()}>
      <Label value="A meteor struck the colony — inside you found:" fontSize={S(17)} color={C.dim} textAlign="middle-center" uiTransform={{ width: '100%', height: S(28) }} />
      <Label value={r.rarity.toUpperCase()} fontSize={S(15)} color={accent} textAlign="middle-center" uiTransform={{ width: '100%', height: S(24), margin: { top: S(10) } }} />
      <OutlineLabel value={r.label} fontSize={S(30)} color={accent} width={'100%'} height={S(46)} textAlign="middle-center" />
      <UiEntity uiTransform={{ width: '100%', justifyContent: 'center', margin: { top: S(16) } }}>
        <TactileButton id="meteor_collect" label="Collect" width={S(260)} height={S(60)} bg={C.green} textColor={C.outline} fontSize={S(22)} onClick={() => ui.close()} />
      </UiEntity>
    </PanelShell>
  )
}

// ---------------------------------------------------------------------------
// Goals / achievements
// ---------------------------------------------------------------------------
function GoalsPanel() {
  const p = clientState.player
  return (
    <PanelShell title="Goals & Achievements" width={S(680)} onClose={() => ui.close()}>
      <UiEntity uiTransform={{ width: '100%', flex: 1, flexDirection: 'column', overflow: 'scroll' }}>
        {Cfg.ACHIEVEMENTS.map((a) => {
          const done = (p?.achievements.indexOf(a.id) ?? -1) !== -1
          const prog = Math.min(p?.counters[a.counter] ?? 0, a.goal)
          const pct = Math.round((prog / a.goal) * 100)
          return (
            <UiEntity key={a.id} uiTransform={{ width: '100%', height: S(66), flexDirection: 'column', margin: { bottom: S(6) }, padding: S(8), borderRadius: S(12) }} uiBackground={{ color: C.card }}>
              <Label value={`${done ? '[done] ' : ''}${a.label}`} fontSize={S(16)} color={done ? C.green : C.text} textAlign="middle-left" uiTransform={{ width: '100%', height: S(22) }} />
              <UiEntity uiTransform={{ width: '100%', height: S(10), borderRadius: S(5), margin: { top: S(4), bottom: S(2) } }} uiBackground={{ color: C.trackBg }}>
                <UiEntity uiTransform={{ width: `${pct}%`, height: '100%', borderRadius: S(5) }} uiBackground={{ color: done ? C.green : C.gold }} />
              </UiEntity>
              <Label value={`${a.description}  (${prog}/${a.goal})`} fontSize={S(13)} color={C.dim} textAlign="middle-left" uiTransform={{ width: '100%', height: S(18) }} />
            </UiEntity>
          )
        })}
      </UiEntity>
    </PanelShell>
  )
}

// ---------------------------------------------------------------------------
// Daily reward — 7-day login streak calendar
// ---------------------------------------------------------------------------
function StreakCell(props: { key?: string; day: number; state: 'claimed' | 'today' | 'future' }) {
  const r = Cfg.STREAK_WEEK_REWARDS[props.day - 1]
  const jackpot = props.day === 7
  const cellW = jackpot ? S(150) : S(96)
  const bg = props.state === 'today' ? C.gold : props.state === 'claimed' ? C.greenDark : C.card
  const disc = jackpot ? C.pink : C.gold
  return (
    <UiEntity
      uiTransform={{ width: cellW, height: S(132), flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', margin: S(5), padding: S(8), borderRadius: S(14) }}
      uiBackground={{ color: bg }}
    >
      <Label value={jackpot ? 'DAY 7' : `Day ${props.day}`} fontSize={S(13)} color={props.state === 'future' ? C.dim : C.outline} textAlign="middle-center" uiTransform={{ width: '100%', height: S(18) }} />
      <UiEntity uiTransform={{ width: S(40), height: S(40), borderRadius: S(20), margin: { top: S(6), bottom: S(4) }, alignItems: 'center', justifyContent: 'center' }} uiBackground={{ color: disc }}>
        <Label value={props.state === 'claimed' ? 'OK' : 'C'} fontSize={S(16)} color={C.outline} textAlign="middle-center" uiTransform={{ width: S(40), height: S(40) }} />
      </UiEntity>
      <Label value={`${r.currency}`} fontSize={S(14)} color={props.state === 'future' ? C.dim : C.text} textAlign="middle-center" uiTransform={{ width: '100%', height: S(18) }} />
      {r.spins > 0 && <Label value={`+${r.spins} spin`} fontSize={S(11)} color={props.state === 'future' ? C.dim : C.pink} textAlign="middle-center" uiTransform={{ width: '100%', height: S(16) }} />}
    </UiEntity>
  )
}

function DailyRewardPanel() {
  const weekDay = streakWeekDay()
  const claimable = streakClaimable()
  const cells = [1, 2, 3, 4, 5, 6, 7].map((d) => {
    let state: 'claimed' | 'today' | 'future' = 'future'
    if (d < weekDay) state = 'claimed'
    else if (d === weekDay) state = claimable ? 'today' : 'claimed'
    return { d, state }
  })
  return (
    <PanelShell title="Daily Rewards" width={S(720)} height={S(520)} onClose={() => ui.close()}>
      <Label value={`Day ${clientState.streak.count} streak — log in daily, don't break it!`} fontSize={S(16)} color={C.dim} uiTransform={{ width: '100%', height: S(28), margin: { bottom: S(10) } }} textAlign="middle-center" />
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
        {cells.map((c) => (
          <StreakCell key={`sc-${c.d}`} day={c.d} state={c.state} />
        ))}
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', justifyContent: 'center', margin: { top: S(12) } }}>
        {claimable ? (
          <TactileButton
            id="streak_claim"
            label={`Claim Day ${weekDay}`}
            width={S(320)}
            height={S(64)}
            bg={C.green}
            textColor={C.outline}
            fontSize={S(24)}
            pulse
            onClick={() => {
              const r = claimStreak()
              if (r) pushToast(`Day ${r.day} reward: +${r.currency} coins${r.spins ? ` +${r.spins} spins` : ''}!`)
            }}
          />
        ) : (
          <TactileButton id="streak_done" label="Come back tomorrow!" width={S(320)} height={S(64)} bg={C.cardAlt} fontSize={S(20)} disabled onClick={() => {}} />
        )}
      </UiEntity>
    </PanelShell>
  )
}

// ---------------------------------------------------------------------------
// Toasts (screen center)
// ---------------------------------------------------------------------------
function Toasts() {
  const now = Date.now()
  const active = clientState.toasts.filter((t) => t.until > now)
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: '42%', left: '50%' }, margin: { left: -S(180) }, width: S(360), flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
      {active.map((t, i) => (
        <UiEntity key={`toast-${i}`} uiTransform={{ width: S(360), height: S(42), justifyContent: 'center', alignItems: 'center', margin: { bottom: S(5) }, borderRadius: S(21) }} uiBackground={{ color: { r: 0.12, g: 0.1, b: 0.09, a: 0.96 } }}>
          <Label value={t.message} fontSize={S(15)} color={C.text} textAlign="middle-center" uiTransform={{ width: S(344), height: S(34) }} />
        </UiEntity>
      ))}
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Pet gesture overlay — the camera is locked on the pet (rendered underneath),
// so this is a transparent layer: a BACK button, a hand that sways left/right to
// hint the swipe, and a progress bar. The hand is a placeholder (disc + emoji)
// until the designer's hand image lands.
// ---------------------------------------------------------------------------
function PettingOverlay() {
  const st = clientState.petting
  if (!st.active) return <UiEntity />
  const isM = mobile()
  const pct = Math.round(st.progress * 100)
  const handD = isM ? S(140) : S(96)
  const swayX = Math.round(sway() * S(150)) // left/right travel around center
  const backW = isM ? S(200) : S(150)
  const backH = isM ? S(76) : S(56)
  return (
    // Full-screen blocker (transparent) so touches drive the swipe and never
    // reach the avatar. The pet shows through from the fixed camera.
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', pointerFilter: 'block' }}
      uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0 } }}
      onMouseDown={() => {}}
    >
      {/* BACK button (top, horizontally centered) */}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: S(20), left: '50%' }, margin: { left: -backW / 2 }, width: backW, height: backH, alignItems: 'center', justifyContent: 'center', borderRadius: backH / 2, pointerFilter: 'block' }}
        uiBackground={{ color: C.pink }}
        onMouseDown={() => cancelPetting()}
      >
        <OutlineLabel value="BACK" fontSize={isM ? S(28) : S(24)} color={C.text} width={'100%'} height={S(30)} textAlign="middle-center" />
      </UiEntity>
      {/* Swipe hint: a hand that drifts side to side across the middle (over the
          centered pet). Placeholder disc + emoji until the hand art arrives. */}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: '34%', left: '50%' }, width: handD, height: handD, margin: { left: -handD / 2 + swayX }, alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}
      >
        <UiEntity
          uiTransform={{ width: handD, height: handD, borderRadius: Math.round(handD), alignItems: 'center', justifyContent: 'center' }}
          uiBackground={{ color: { r: 0.8, g: 0.8, b: 0.8, a: 0.28 } }}
        >
          <Label value="✋" fontSize={Math.round(handD * 0.5)} color={{ r: 1, g: 1, b: 1, a: 0.5 }} textAlign="middle-center" uiTransform={{ width: handD, height: handD }} />
        </UiEntity>
      </UiEntity>
      {/* Prompt + progress bar (bottom-center) */}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { bottom: isM ? S(120) : S(90), left: '50%' }, margin: { left: -S(190) }, width: S(380), flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}
      >
        <OutlineLabel value="Swipe left & right to pet!" fontSize={isM ? S(24) : S(20)} color={C.text} width={'100%'} height={S(30)} textAlign="middle-center" />
        <UiEntity uiTransform={{ width: S(360), height: isM ? S(28) : S(22), borderRadius: S(14), margin: { top: S(10) } }} uiBackground={{ color: C.trackBg }}>
          <UiEntity uiTransform={{ width: `${pct}%`, height: '100%', borderRadius: S(14) }} uiBackground={{ color: C.happy }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Fetch (Play) mode — a big centered "Fetch" button. Tapping it throws the ball
// and disables the button (busy); it re-enables once the pet drops the ball back
// at the player. BACK exits (only when not mid-throw).
// ---------------------------------------------------------------------------
function FetchOverlay() {
  if (!clientState.fetch.active) return <UiEntity />
  const isM = mobile()
  const busy = clientState.fetch.busy
  const bw = isM ? S(380) : S(300)
  const bh = isM ? S(120) : S(92)
  const backW = isM ? S(200) : S(150)
  const backH = isM ? S(76) : S(56)
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }}>
      {/* BACK (top-left) — disabled while a throw is in progress */}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: S(20), left: S(20) }, width: backW, height: backH, alignItems: 'center', justifyContent: 'center', borderRadius: backH / 2, pointerFilter: 'block' }}
        uiBackground={{ color: busy ? C.cardAlt : C.pink }}
        onMouseDown={() => {
          if (!clientState.fetch.busy) clientState.fetch.active = false
        }}
      >
        <OutlineLabel value="BACK" fontSize={isM ? S(28) : S(24)} color={busy ? C.dim : C.text} width={'100%'} height={S(30)} textAlign="middle-center" />
      </UiEntity>
      {/* Fetch button (bottom-center) */}
      <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: isM ? S(110) : S(80), left: '50%' }, margin: { left: -bw / 2 }, width: bw, height: bh, alignItems: 'center', justifyContent: 'center' }}>
        <TactileButton
          id="fetch_throw"
          label={busy ? 'Fetching…' : 'Fetch'}
          width={bw}
          height={bh}
          bg={busy ? C.cardAlt : C.green}
          textColor={busy ? C.dim : C.outline}
          fontSize={isM ? S(36) : S(32)}
          radius={bh / 2}
          disabled={busy}
          pulse={!busy}
          onClick={() => throwMeteor()}
        />
      </UiEntity>
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Connecting screen — shown instead of the whole HUD until the authoritative
// server answers for the first time (the initial stateSnapshot), so nothing
// (profile bar, panels, nav) flashes on screen before there's real data to show.
// ---------------------------------------------------------------------------
function ConnectingScreen() {
  const isM = mobile()
  const w = isM ? S(420) : S(320)
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', pointerFilter: 'block' }}>
      <UiEntity
        uiTransform={{ width: w, height: isM ? S(90) : S(64), alignItems: 'center', justifyContent: 'center', borderRadius: isM ? S(45) : S(32) }}
        uiBackground={{ color: C.panelBg }}
      >
        <Label value="Connecting to server..." fontSize={isM ? S(22) : S(17)} color={C.text} textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
      </UiEntity>
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
const Root = () => {
  // Nothing renders — no HUD, no panels, no dialog — until the server has
  // answered at least once. Avoids flashing default/empty state on screen.
  if (!everConnected()) {
    return (
      <UiEntity uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}>
        <ConnectingScreen />
      </UiEntity>
    )
  }
  // In petting mode the camera is locked on the pet — hide the whole HUD so
  // nothing covers it, leaving only the petting overlay (BACK + swipe hint).
  if (clientState.petting.active) {
    return (
      <UiEntity uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}>
        <PettingOverlay />
      </UiEntity>
    )
  }
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}>
      <ServerStatus />
      <ProfileBar />
      <ColonyBar />
      <PetPanel />
      <SideButtons />
      <BottomNav />
      <Toasts />
      <FetchOverlay />
      {uiState.panel === 'adopt' && <AdoptPanel />}
      {uiState.panel === 'shop' && <ShopPanel />}
      {uiState.panel === 'roster' && <RosterPanel />}
      {uiState.panel === 'inventory' && <InventoryPanel />}
      {uiState.panel === 'spin' && <SpinPanel />}
      {uiState.panel === 'meteor' && <MeteorRewardPanel />}
      {uiState.panel === 'goals' && <GoalsPanel />}
      {uiState.panel === 'daily' && <DailyRewardPanel />}
      <DialogBox />
    </UiEntity>
  )
}

// Mobile uses a smaller virtual canvas so the HUD occupies more of the screen
// (fixes tiny UIs on mobile / the Bevy client). virtualWidth/Height are locked
// in at setUiRenderer time, so we re-apply this once mobile detection resolves.
function applyUiRenderer(): void {
  const compact = useCompactCanvas() // mobile OR the Bevy explorer
  ReactEcsRenderer.setUiRenderer(Root, {
    virtualWidth: compact ? 1600 : 1920,
    virtualHeight: compact ? 720 : 1080
  })
}

export function setupUi(): void {
  // Re-apply the renderer once the async platform lookup settles, so mobile gets
  // the smaller virtual canvas even though detection resolves after first render.
  resolveRuntimePlatform(applyUiRenderer)
  startAnimSystem()
  applyUiRenderer()
}
