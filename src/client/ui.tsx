// Mobile-first HUD + panels for MyDearPet, modeled on the cozy-farm IO layout:
//  - TOP: player profile bar (Caretaker level + XP) -> taps to Goals
//  - TOP (when a pet is selected): pet stat bars + care actions
//  - BOTTOM: 3 big nav buttons (Pets / Inventory / Goals)
//  - SIDES: Spin + Shop (right), Whistle (left)
// Reads the client mirror of authoritative server state.

import ReactEcs, { ReactEcsRenderer, Label, UiEntity, Input } from '@dcl/sdk/react-ecs'
import { movePlayerTo } from '~system/RestrictedActions'
import * as Cfg from '../shared/config'
import type { CareAction } from '../shared/types'
import { actions, clientState, discardHatchling, dismissBubble, keepHatchling, pushToast, serverConnected, showBubble, switchActivePet } from './state'
import { setFollow, startPetting, cancelPetting, petTap, hatchTap, startCarryEgg, beginHatchFromCarry, startCarryPet, placePetAtStation, cancelCarryPet } from './pet'
import { throwMeteor } from './play'
import { triggerCare, careActive, queueLength } from './input'
import { buyItemLocal, buySlotLocal, claimStreak, spinLocal, streakClaimable, streakWeekDay, useItemLocal } from './sim'
import { sway, startAnimSystem } from './ui/anim'
import { C, Color, mobile, OutlineLabel, PanelShell, resolveRuntimePlatform, S, Sbtn, TactileButton, useCompactCanvas } from './ui/theme'
import { DialogBox, openCaretakerIntro, openCaretakerTips, playerName } from './ui/dialog'

type Panel = 'none' | 'adopt' | 'shop' | 'roster' | 'inventory' | 'spin' | 'goals' | 'daily' | 'meteor'

const uiState = {
  panel: 'none' as Panel,
  shopTab: 'food' as 'food' | 'slots',
  adoptStep: 'pick' as 'pick' | 'name',
  adoptSpecies: Cfg.SPECIES[0],
  adoptName: '',
  // "Choose Location!" modal — opened on entry for RETURNING players only
  // (first-timers get the tutorial instead). Wired from setup.ts.
  locationOpen: false
}

export const ui = {
  openAdopt(): void {
    // One hatchling at a time: finish (keep/discard) the current one first.
    if (clientState.player?.hatchling) {
      pushToast('Place or discard your current pet first.')
      return
    }
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
    const p = clientState.player
    const hasFreeSlot = !!p && p.pets.length < p.petSlots
    if (!clientState.activePet) {
      // First adoption: intro dialog, then the picker.
      openCaretakerIntro(() => {
        ui.goCareCenter()
        ui.openAdopt()
      })
    } else if (hasFreeSlot) {
      // Already have a pet + a free unlocked slot: go straight to the picker.
      ui.openAdopt()
    } else {
      // Have a pet but no room: just the caretaker tips.
      openCaretakerTips()
    }
  },
  close(): void {
    uiState.panel = 'none'
  },
  openLocation(): void {
    uiState.locationOpen = true
  },
  /** Teleport the player to the Care Center (where adoption happens). */
  goCareCenter(): void {
    void movePlayerTo({ newRelativePosition: CARE_CENTER })
  }
}

// Care Center spawn — the adoption area. Shared by the "Choose Location!" modal
// and the tutorial's Adopt step.
const CARE_CENTER = { x: 174.272, y: 0, z: 249.377 }

// ---------------------------------------------------------------------------
// Top profile bar (Caretaker level + XP + coins) -> tap opens Goals
// ---------------------------------------------------------------------------
function ProfileBar() {
  const p = clientState.player
  if (!p) return <UiEntity />
  const W = S(360)
  const lvl = p.caretakerLevel
  const base = Cfg.xpForLevel(lvl)
  const next = Cfg.xpForLevel(lvl + 1)
  const frac = next > base ? Math.max(0, Math.min(1, (p.caretakerXp - base) / (next - base))) : 1
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
      <UiEntity uiTransform={{ width: S(48), height: S(48), borderRadius: S(24), alignItems: 'center', justifyContent: 'center', margin: { right: S(10) } }} uiBackground={{ color: C.green }}>
        <OutlineLabel value={`${lvl}`} fontSize={S(24)} color={C.text} outlineColor={C.outline} width={S(48)} height={S(48)} />
      </UiEntity>
      {/* name + xp bar */}
      <UiEntity uiTransform={{ width: midW, height: '100%', flexDirection: 'column', justifyContent: 'center' }}>
        <Label value={`${playerName()}  ·  Lv ${lvl}`} fontSize={S(15)} color={C.text} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: midW, height: S(18) }} />
        <UiEntity uiTransform={{ width: '100%', height: S(12), borderRadius: S(6), margin: { top: S(2) } }} uiBackground={{ color: C.trackBg }}>
          <UiEntity uiTransform={{ width: `${Math.round(frac * 100)}%`, height: '100%', borderRadius: S(6) }} uiBackground={{ color: C.gold }} />
        </UiEntity>
      </UiEntity>
      {/* coins */}
      <UiEntity uiTransform={{ width: S(86), height: S(40), flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', margin: { left: S(8) } }}>
        <UiEntity uiTransform={{ width: S(26), height: S(26), borderRadius: S(13), margin: { right: S(5) }, alignItems: 'center', justifyContent: 'center' }} uiBackground={{ color: C.gold }}>
          <Label value="C" fontSize={S(14)} color={C.outline} textAlign="middle-center" uiTransform={{ width: S(26), height: S(26) }} />
        </UiEntity>
        <Label value={`${Math.floor(p.currency)}`} fontSize={S(17)} color={C.text} textAlign="middle-right" uiTransform={{ width: S(50), height: S(40) }} />
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
  const W = S(190)
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: S(10), left: '50%' },
        margin: { left: S(360) / 2 + S(10) },
        width: W,
        height: S(64),
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
        fontSize={S(12)}
        color={C.dim}
        textAlign="middle-left"
        textWrap="nowrap"
        uiTransform={{ width: '100%', height: S(16) }}
      />
      <Label
        value={`${pop} / ${goal} pets`}
        fontSize={S(17)}
        color={C.text}
        textAlign="middle-left"
        textWrap="nowrap"
        uiTransform={{ width: '100%', height: S(22) }}
      />
      <UiEntity
        uiTransform={{ width: '100%', height: S(9), borderRadius: S(5), margin: { top: S(3) } }}
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
// One stat row: label + a light track with a colored fill (flat, no art).
function StatRow(props: { label: string; value: number; color: Color; width: number }) {
  const v = Math.max(0, Math.min(100, props.value))
  const labelW = S(80)
  const trackW = props.width - labelW - S(10)
  return (
    <UiEntity uiTransform={{ width: props.width, height: S(32), flexDirection: 'row', alignItems: 'center', margin: { bottom: S(8) } }}>
      <Label value={props.label} fontSize={S(15)} color={LOC.body} textAlign="middle-left" uiTransform={{ width: labelW, height: S(24) }} />
      <UiEntity uiTransform={{ width: trackW, height: S(16), borderRadius: S(8) }} uiBackground={{ color: LOC.neutral }}>
        <UiEntity uiTransform={{ width: `${v}%`, height: '100%', borderRadius: S(8) }} uiBackground={{ color: props.color }} />
      </UiEntity>
    </UiEntity>
  )
}

function PetPanel() {
  const pet = clientState.activePet
  if (!pet || !clientState.petPanelOpen) return <UiEntity />
  const care = (a: CareAction) => triggerCare(a)
  const contentW = S(700) - S(30) * 2 // LightModal inner width (card minus padding)
  const chipW = Math.floor((contentW - S(30)) / 4) // 4 care buttons across, with slack
  const chipH = S(60)
  const halfW = Math.round((contentW - S(8)) / 2)
  const unlocked = Cfg.petStage(pet.size) === 'ADULT'
  const partner = clientState.player?.pets.find((x) => x.id !== pet.id)

  return (
    <LightModal title={`${pet.name}  ·  Lv ${pet.petLevel}`} width={S(700)} height={S(560)} onClose={() => (clientState.petPanelOpen = false)}>
      {careActive() && (
        <Label value={`Busy${queueLength() > 0 ? ` +${queueLength()}` : ''}`} fontSize={S(14)} color={LOC.dim} textAlign="middle-center" uiTransform={{ width: '100%', height: S(20), margin: { bottom: S(6) } }} />
      )}
      {/* Stats */}
      <UiEntity uiTransform={{ width: contentW, flexDirection: 'column', margin: { top: S(4) } }}>
        <StatRow label="Hunger" value={pet.hunger} color={C.hunger} width={contentW} />
        <StatRow label="Hygiene" value={pet.hygiene} color={C.hygiene} width={contentW} />
        <StatRow label="Energy" value={pet.energy} color={C.energy} width={contentW} />
        <StatRow label="Happy" value={pet.happiness} color={C.happy} width={contentW} />
      </UiEntity>
      {/* Care actions (flat, colored per stat) */}
      <UiEntity uiTransform={{ width: contentW, flexDirection: 'row', justifyContent: 'center', margin: { top: S(12) } }}>
        <TactileButton id="care_feed" label="Feed" width={chipW} height={chipH} bg={C.hunger} textColor={C.outline} fontSize={S(16)} radius={S(14)} margin={{ left: S(3), right: S(3) }} onClick={() => care('feed')} />
        <TactileButton
          id="care_bath"
          label="Bath"
          width={chipW}
          height={chipH}
          bg={C.hygiene}
          textColor={C.outline}
          fontSize={S(16)}
          radius={S(14)}
          margin={{ left: S(3), right: S(3) }}
          onClick={() => {
            // Pick the pet up and carry it to the tub (place it there to bathe).
            startCarryPet()
            clientState.petPanelOpen = false
          }}
        />
        <TactileButton
          id="care_sleep"
          label={pet.sleeping ? 'Wake' : 'Sleep'}
          width={chipW}
          height={chipH}
          bg={C.energy}
          textColor={C.outline}
          fontSize={S(16)}
          radius={S(14)}
          margin={{ left: S(3), right: S(3) }}
          onClick={() => {
            // Waking is instant — no walk back to the bed first.
            if (pet.sleeping) {
              pet.sleeping = false
              actions.care('sleep', true)
            } else care('sleep')
          }}
        />
        <TactileButton
          id="care_play"
          label="Play"
          width={chipW}
          height={chipH}
          bg={C.happy}
          textColor={C.outline}
          fontSize={S(16)}
          radius={S(14)}
          margin={{ left: S(3), right: S(3) }}
          onClick={() => {
            // Enter Fetch mode: hide the panel and show the centered Fetch button.
            clientState.fetch.active = true
            clientState.petPanelOpen = false
          }}
        />
      </UiEntity>
      {/* Pet + Breed, side by side and equal size. */}
      <UiEntity uiTransform={{ width: contentW, flexDirection: 'row', justifyContent: 'center', margin: { top: S(12) } }}>
        <TactileButton id="pet_gesture" label="Pet  ·  +Happy" width={halfW} height={S(54)} bg={C.happy} textColor={C.outline} fontSize={S(16)} radius={S(16)} margin={{ right: S(4) }} onClick={() => startPetting()} />
        <TactileButton
          id="breed_teaser"
          label={unlocked ? 'Breed' : 'Breed  ·  Adult'}
          width={halfW}
          height={S(54)}
          bg={unlocked ? LOC.blue : LOC.neutral}
          textColor={unlocked ? LOC.white : LOC.dim}
          fontSize={S(16)}
          radius={S(16)}
          margin={{ left: S(4) }}
          pulse={unlocked}
          onClick={() => {
            if (!unlocked) {
              showBubble('Grow your pet to Adult to unlock breeding!')
              return
            }
            if (!partner) {
              pushToast('You need a second pet to breed with.')
              return
            }
            actions.breed(partner.id)
          }}
        />
      </UiEntity>
    </LightModal>
  )
}

// ---------------------------------------------------------------------------
// Bottom nav: 3 big buttons (cozy-farm style)
// ---------------------------------------------------------------------------
function BottomNav() {
  const p = clientState.player
  // Hidden while a dialog is open — the dialog sits where these buttons are.
  // Also hidden in Fetch mode / while carrying an egg or the pet (they own the screen).
  if (!p || clientState.dialog.open || clientState.fetch.active || clientState.carryEgg.active || clientState.carryPet.active) return <UiEntity />
  const bw = Sbtn(160)
  const bh = Sbtn(72)

  // Just hatched: a new pet is waiting on a Keep/Discard decision. It takes over
  // the nav bar — Keep places it (nav returns), Discard sends it to the Care
  // Center (nothing kept). Until then the 3 nav buttons stay hidden.
  if (p.hatchling) {
    return (
      <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: S(18), left: 0 }, width: '100%', height: bh, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
        <TactileButton id="nav_keep" label="Keep" width={bw} height={bh} bg={LOC.violet} textColor={LOC.white} fontSize={S(20)} radius={S(20)} margin={{ left: S(8), right: S(8) }} pulse onClick={() => keepHatchling()} />
        <TactileButton id="nav_discard" label="Discard" width={bw} height={bh} bg={LOC.rose} textColor={LOC.white} fontSize={S(20)} radius={S(20)} margin={{ left: S(8), right: S(8) }} onClick={() => discardHatchling()} />
      </UiEntity>
    )
  }

  // The nav buttons only appear once you actually own a pet (kept at least one).
  if (p.pets.length === 0) return <UiEntity />

  // Flat button style (same look as the modals): blue when its panel is open,
  // white otherwise. Replaces the old navButtonUi PNGs.
  const nav = (id: string, label: string, panel: Panel, onClick: () => void) => {
    const sel = uiState.panel === panel
    return (
      <TactileButton
        id={id}
        label={label}
        width={bw}
        height={bh}
        bg={sel ? LOC.blue : LOC.tile}
        textColor={sel ? LOC.white : LOC.body}
        fontSize={S(20)}
        radius={S(20)}
        margin={{ left: S(8), right: S(8) }}
        onClick={onClick}
      />
    )
  }
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: S(18), left: 0 }, width: '100%', height: bh, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
      {nav('nav_pets', 'My Pets', 'roster', () => ui.openRoster())}
      {nav('nav_inv', 'Inventory', 'inventory', () => ui.openInventory())}
      {nav('nav_goals', 'Goals', 'goals', () => ui.openGoals())}
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Side buttons: Spin + Shop (right), Whistle (left)
// ---------------------------------------------------------------------------
function SideButtons() {
  const p = clientState.player
  if (!p || clientState.fetch.active || clientState.carryEgg.active || clientState.carryPet.active) return <UiEntity />
  const hasPet = !!clientState.activePet
  const w = Sbtn(112)
  const h = Sbtn(58)
  const spins = p.spinTickets > 0
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
  const disc = S(96)
  const img = Cfg.speciesImage(props.species)
  return (
    <UiEntity
      uiTransform={{ width: S(280), height: S(168), flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: S(8), borderRadius: S(18), padding: S(8) }}
      uiBackground={{ color: selected ? LOC.blue : LOC.tile }}
      onMouseDown={() => {
        uiState.adoptSpecies = props.species
      }}
    >
      <UiEntity
        uiTransform={{ width: disc, height: disc, borderRadius: disc / 2, margin: { bottom: S(10) } }}
        uiBackground={img ? { texture: { src: img }, textureMode: 'stretch' } : { color: speciesColor(props.species) }}
      />
      <Label value={Cfg.speciesLabel(props.species)} fontSize={S(18)} color={selected ? LOC.white : LOC.body} textAlign="middle-center" uiTransform={{ width: '100%', height: S(26) }} />
    </UiEntity>
  )
}

function AdoptPanel() {
  const p = clientState.player
  const slotsFree = p ? p.pets.length < p.petSlots : true
  const sp = uiState.adoptSpecies

  if (uiState.adoptStep === 'pick') {
    return (
      <LightModal title="Choose a Pet" width={S(720)} height={S(620)} onClose={() => ui.close()}>
        <Label value="Tap a friend to choose, then Next." fontSize={S(16)} color={LOC.dim} textAlign="middle-center" uiTransform={{ width: '100%', height: S(24), margin: { bottom: S(6) } }} />
        <UiEntity uiTransform={{ width: '100%', flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'flex-start', overflow: 'hidden' }}>
          {Cfg.SPECIES.map((s) => (
            <SpeciesCard key={s} species={s} />
          ))}
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', justifyContent: 'center', margin: { top: S(10) } }}>
          <TactileButton id="adopt_next" label={`Next: ${Cfg.speciesLabel(sp)}  >`} width={S(340)} height={S(70)} bg={LOC.blue} textColor={LOC.white} fontSize={S(24)} radius={S(18)} pulse onClick={() => (uiState.adoptStep = 'name')} />
        </UiEntity>
      </LightModal>
    )
  }

  // Name + confirm step
  const disc = S(120)
  return (
    <LightModal title="Name your Pet" width={S(680)} height={S(660)} onClose={() => ui.close()}>
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
        <UiEntity uiTransform={{ width: disc, height: disc, borderRadius: disc / 2, margin: { top: S(12), bottom: S(10) } }} uiBackground={{ color: speciesColor(sp) }} />
        <OutlineLabel value={Cfg.speciesLabel(sp)} fontSize={S(26)} color={LOC.title} outlineColor={LOC.titleOutline} width={'100%'} height={S(36)} textAlign="middle-center" />
        <Input
          placeholder="Type a name..."
          fontSize={S(20)}
          color={LOC.body}
          placeholderColor={LOC.dim}
          uiTransform={{ width: S(440), height: S(60), margin: { top: S(16), bottom: S(12) } }}
          uiBackground={{ color: LOC.tile }}
          onChange={(v) => {
            uiState.adoptName = v
          }}
        />
        {!slotsFree && <Label value="No free pet slots — buy one first." fontSize={S(16)} color={LOC.red} uiTransform={{ width: '100%', height: S(26) }} />}
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { top: S(6) } }}>
        <TactileButton id="adopt_back" label="< Back" width={S(160)} height={S(66)} bg={LOC.neutral} textColor={LOC.body} fontSize={S(20)} radius={S(18)} margin={{ right: S(12) }} onClick={() => (uiState.adoptStep = 'pick')} />
        {slotsFree ? (
          <TactileButton
            id="adopt_confirm"
            label="Adopt!"
            width={S(260)}
            height={S(66)}
            bg={LOC.green}
            textColor={LOC.white}
            fontSize={S(26)}
            radius={S(18)}
            pulse
            onClick={() => {
              // Adoption gives an egg to carry home; you hatch it there (rub/tap).
              startCarryEgg(sp, uiState.adoptName)
              uiState.adoptName = ''
              ui.close()
            }}
          />
        ) : (
          <TactileButton id="adopt_buyslot" label={`Buy Slot ${Cfg.SLOT_PRICE}`} width={S(260)} height={S(66)} bg={LOC.orange} textColor={LOC.white} fontSize={S(22)} radius={S(18)} onClick={() => actions.buySlot()} />
        )}
      </UiEntity>
    </LightModal>
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
    <UiEntity uiTransform={{ width: S(296), height: S(196), flexDirection: 'column', alignItems: 'center', margin: S(6), padding: S(12), borderRadius: S(16) }} uiBackground={{ color: LOC.tile }}>
      <UiEntity uiTransform={{ width: icon, height: icon, borderRadius: S(14), margin: { top: S(4), bottom: S(8) }, alignItems: 'center', justifyContent: 'center' }} uiBackground={{ color: props.color }}>
        <Label value={`x${props.count}`} fontSize={S(22)} color={LOC.white} textAlign="middle-center" uiTransform={{ width: icon, height: icon }} />
      </UiEntity>
      <Label value={props.title} fontSize={S(17)} color={LOC.body} textAlign="middle-center" uiTransform={{ width: '100%', height: S(28) }} />
      <TactileButton id={props.id} label="Use" width={S(170)} height={S(48)} bg={props.count > 0 ? LOC.green : LOC.neutral} textColor={props.count > 0 ? LOC.white : LOC.dim} fontSize={S(16)} radius={S(14)} disabled={props.count <= 0} margin={{ top: S(8) }} onClick={() => props.onUse()} />
    </UiEntity>
  )
}

function InventoryPanel() {
  const p = clientState.player
  const t1 = p?.inventory.tier1 ?? 0
  const t2 = p?.inventory.tier2 ?? 0
  return (
    <LightModal title="Inventory" width={S(700)} height={S(520)} onClose={() => ui.close()}>
      <Label value="Tap Use to feed your active pet." fontSize={S(16)} color={LOC.dim} uiTransform={{ width: '100%', height: S(28), margin: { bottom: S(10) } }} textAlign="middle-center" />
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
        <InvCard key="inv-1" id="use_1" title={Cfg.SHOP_ITEMS[0].label} count={t1} color={C.hunger} onUse={() => { if (useItemLocal(1)) pushToast('Fed your pet!'); actions.useItem(1) }} />
        <InvCard key="inv-2" id="use_2" title={Cfg.SHOP_ITEMS[1].label} count={t2} color={C.happy} onUse={() => { if (useItemLocal(2)) pushToast('Fed your pet!'); actions.useItem(2) }} />
      </UiEntity>
    </LightModal>
  )
}

// ---------------------------------------------------------------------------
// Roster (Pets) — selection system
// ---------------------------------------------------------------------------
// One slot in the My Pets 2x2 grid: a pet, an empty "+" (add), or locked (price).
function SlotCard(props: { key?: number; index: number }) {
  const p = clientState.player
  if (!p) return <UiEntity />
  const cardW = S(280)
  const cardH = S(168)
  const disc = S(90)
  const unlocked = props.index < p.petSlots
  const pet = p.pets[props.index]

  // Locked slot — shows the unlock price. Only the NEXT slot is buyable.
  if (!unlocked) {
    const canUnlock = props.index === p.petSlots
    return (
      <UiEntity uiTransform={{ width: cardW, height: cardH, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: S(8), borderRadius: S(18), padding: S(8) }} uiBackground={{ color: LOC.neutral }}>
        <Label value="🔒" fontSize={S(40)} color={LOC.dim} textAlign="middle-center" uiTransform={{ width: '100%', height: S(48) }} />
        {canUnlock ? (
          <TactileButton
            id={`unlock_${props.index}`}
            label={`Unlock  ${Cfg.SLOT_PRICE}`}
            width={S(190)}
            height={S(52)}
            bg={LOC.orange}
            textColor={LOC.white}
            fontSize={S(17)}
            radius={S(14)}
            pulse
            onClick={() => {
              if (buySlotLocal()) pushToast('Slot unlocked!')
              else pushToast('Not enough coins')
              actions.buySlot()
            }}
          />
        ) : (
          <Label value={`Unlock: ${Cfg.SLOT_PRICE}`} fontSize={S(16)} color={LOC.dim} textAlign="middle-center" uiTransform={{ width: '100%', height: S(24) }} />
        )}
      </UiEntity>
    )
  }

  // Empty unlocked slot. The FIRST empty slot holds a just-hatched pet (if any),
  // which the player keeps or discards; otherwise it's a "+" to adopt.
  if (!pet) {
    const isFirstEmpty = props.index === p.pets.length
    const hatch = p.hatchling
    if (isFirstEmpty && hatch) {
      const img = Cfg.speciesImage(hatch.species)
      return (
        <UiEntity uiTransform={{ width: cardW, height: cardH, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: S(8), borderRadius: S(18), padding: S(8) }} uiBackground={{ color: LOC.card }}>
          <UiEntity uiTransform={{ width: S(70), height: S(70), borderRadius: S(35), margin: { bottom: S(6) } }} uiBackground={img ? { texture: { src: img }, textureMode: 'stretch' } : { color: speciesColor(hatch.species) }} />
          <Label value={`${hatch.name} hatched!`} fontSize={S(15)} color={LOC.body} textAlign="middle-center" uiTransform={{ width: '100%', height: S(22) }} />
          <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { top: S(6) } }}>
            <TactileButton id="hatch_keep" label="Keep" width={S(120)} height={S(46)} bg={LOC.violet} textColor={LOC.white} fontSize={S(16)} radius={S(12)} margin={{ right: S(4) }} pulse onClick={() => keepHatchling()} />
            <TactileButton id="hatch_discard" label="Discard" width={S(120)} height={S(46)} bg={LOC.rose} textColor={LOC.white} fontSize={S(16)} radius={S(12)} margin={{ left: S(4) }} onClick={() => discardHatchling()} />
          </UiEntity>
        </UiEntity>
      )
    }
    return (
      <UiEntity
        uiTransform={{ width: cardW, height: cardH, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: S(8), borderRadius: S(18), padding: S(8) }}
        uiBackground={{ color: LOC.tile }}
        onMouseDown={() => pushToast('Go to the Care Center to adopt a pet!')}
      >
        <Label value="+" fontSize={S(72)} color={LOC.blue} textAlign="middle-center" uiTransform={{ width: '100%', height: S(80) }} />
        <Label value="Add a pet" fontSize={S(17)} color={LOC.dim} textAlign="middle-center" uiTransform={{ width: '100%', height: S(24) }} />
      </UiEntity>
    )
  }

  // Filled slot — the pet. Tap to make it the active pet.
  const isActive = pet.id === p.activePetId
  const img = Cfg.speciesImage(pet.species)
  return (
    <UiEntity
      uiTransform={{ width: cardW, height: cardH, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: S(8), borderRadius: S(18), padding: S(8) }}
      uiBackground={{ color: isActive ? LOC.blue : LOC.tile }}
      onMouseDown={() => switchActivePet(pet.id)}
    >
      <UiEntity uiTransform={{ width: disc, height: disc, borderRadius: disc / 2, margin: { bottom: S(8) } }} uiBackground={img ? { texture: { src: img }, textureMode: 'stretch' } : { color: speciesColor(pet.species) }} />
      <Label value={`${pet.name}  ·  Lv ${pet.petLevel}`} fontSize={S(17)} color={isActive ? LOC.white : LOC.body} textAlign="middle-center" uiTransform={{ width: '100%', height: S(24) }} />
      <Label value={isActive ? 'Active' : 'Tap to select'} fontSize={S(13)} color={isActive ? LOC.white : LOC.dim} textAlign="middle-center" uiTransform={{ width: '100%', height: S(20) }} />
    </UiEntity>
  )
}

function RosterPanel() {
  return (
    <LightModal title="My Pets" width={S(720)} height={S(620)} onClose={() => ui.close()}>
      <Label value="Your colony — tap a pet to select it, unlock slots to grow." fontSize={S(16)} color={LOC.dim} textAlign="middle-center" uiTransform={{ width: '100%', height: S(24), margin: { bottom: S(8) } }} />
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'flex-start' }}>
        {[0, 1, 2, 3].map((i) => (
          <SlotCard key={i} index={i} />
        ))}
      </UiEntity>
    </LightModal>
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
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { bottom: S(10), right: S(12) },
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
    <LightModal title="Meteor Cracked Open!" width={S(560)} height={S(460)} onClose={() => ui.close()}>
      <UiEntity uiTransform={{ width: '100%', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Label value="A meteor struck the colony — inside you found:" fontSize={S(18)} color={LOC.dim} textAlign="middle-center" uiTransform={{ width: '100%', height: S(30) }} />
        <Label value={r.rarity.toUpperCase()} fontSize={S(16)} color={accent} textAlign="middle-center" uiTransform={{ width: '100%', height: S(26), margin: { top: S(14) } }} />
        <OutlineLabel value={r.label} fontSize={S(34)} color={accent} outlineColor={LOC.titleOutline} width={'100%'} height={S(50)} textAlign="middle-center" />
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', justifyContent: 'center' }}>
        <TactileButton id="meteor_collect" label="Collect" width={S(280)} height={S(70)} bg={LOC.green} textColor={LOC.white} fontSize={S(26)} radius={S(18)} pulse onClick={() => ui.close()} />
      </UiEntity>
    </LightModal>
  )
}

// ---------------------------------------------------------------------------
// Goals / achievements
// ---------------------------------------------------------------------------
function GoalsPanel() {
  const p = clientState.player
  return (
    <LightModal title="Goals & Achievements" width={S(680)} height={S(700)} onClose={() => ui.close()}>
      <UiEntity uiTransform={{ width: '100%', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
        {Cfg.ACHIEVEMENTS.map((a) => {
          const done = (p?.achievements.indexOf(a.id) ?? -1) !== -1
          const prog = Math.min(p?.counters[a.counter] ?? 0, a.goal)
          const pct = Math.round((prog / a.goal) * 100)
          return (
            <UiEntity key={a.id} uiTransform={{ width: '100%', height: S(66), flexDirection: 'column', margin: { bottom: S(6) }, padding: S(8), borderRadius: S(12) }} uiBackground={{ color: LOC.tile }}>
              <Label value={`${done ? '[done] ' : ''}${a.label}`} fontSize={S(16)} color={done ? LOC.green : LOC.body} textAlign="middle-left" uiTransform={{ width: '100%', height: S(22) }} />
              <UiEntity uiTransform={{ width: '100%', height: S(10), borderRadius: S(5), margin: { top: S(4), bottom: S(2) } }} uiBackground={{ color: LOC.neutral }}>
                <UiEntity uiTransform={{ width: `${pct}%`, height: '100%', borderRadius: S(5) }} uiBackground={{ color: done ? LOC.green : LOC.orange }} />
              </UiEntity>
              <Label value={`${a.description}  (${prog}/${a.goal})`} fontSize={S(13)} color={LOC.dim} textAlign="middle-left" uiTransform={{ width: '100%', height: S(18) }} />
            </UiEntity>
          )
        })}
      </UiEntity>
    </LightModal>
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
// Speech bubble — a cozy dialogue balloon for contextual hints (one at a time).
// White balloon with a blue rim + a two-dot "thought" tail (UI can't rotate a
// triangle, so the shrinking-circles tail is what reads as a speech bubble).
// Tap it to dismiss; it also auto-expires. Rendered on top of everything.
// ---------------------------------------------------------------------------
function SpeechBubble() {
  const b = clientState.bubble
  if (!b || b.until <= Date.now()) return <UiEntity />
  const w = S(430)
  // A blue-ringed white dot (outer blue circle + inner white circle).
  const tail = (d: number, offsetRight: number) => (
    <UiEntity uiTransform={{ width: d, height: d, borderRadius: d, margin: { top: S(4), right: offsetRight }, alignItems: 'center', justifyContent: 'center' }} uiBackground={{ color: LOC.blue }}>
      <UiEntity uiTransform={{ width: d - S(5), height: d - S(5), borderRadius: d }} uiBackground={{ color: LOC.tile }} />
    </UiEntity>
  )
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: '24%', left: '50%' }, margin: { left: -w / 2 }, width: w, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
      {/* Balloon: blue rim wrapping a white body. */}
      <UiEntity
        uiTransform={{ width: w, height: S(96), justifyContent: 'center', alignItems: 'center', borderRadius: S(26), pointerFilter: 'block' }}
        uiBackground={{ color: LOC.blue }}
        onMouseDown={() => dismissBubble()}
      >
        <UiEntity uiTransform={{ width: w - S(8), height: S(88), justifyContent: 'center', alignItems: 'center', borderRadius: S(22) }} uiBackground={{ color: LOC.tile }}>
          <Label value={b.message} fontSize={S(20)} color={LOC.body} textAlign="middle-center" uiTransform={{ width: w - S(40), height: S(72) }} />
        </UiEntity>
      </UiEntity>
      {tail(S(26), S(70))}
      {tail(S(14), S(108))}
    </UiEntity>
  )
}

// Shared BACK button for full-screen action overlays (Petting / Fetch / Bath).
// Top-left, inset from the corner, pushed further in on mobile so the app's own
// corner UI doesn't cover it. One place so every action's BACK matches.
function BackButton(props: { onClick: () => void; disabled?: boolean }) {
  const isM = mobile()
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: isM ? S(120) : S(96), left: isM ? S(210) : S(130) }, width: S(150), height: S(56), alignItems: 'center', justifyContent: 'center', borderRadius: S(28), pointerFilter: 'block' }}
      uiBackground={{ color: props.disabled ? C.cardAlt : C.pink }}
      onMouseDown={() => {
        if (!props.disabled) props.onClick()
      }}
    >
      <OutlineLabel value="BACK" fontSize={S(24)} color={props.disabled ? C.dim : C.text} width={'100%'} height={S(30)} textAlign="middle-center" />
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
  const pct = Math.round(st.progress * 100)
  const handD = S(96)
  const isM = mobile()
  // Desktop/Bevy: a hand drifting side-to-side (swipe hint). Mobile: a centered
  // finger you tap (the app has no cursor-drag yet, so tapping fills the bar).
  const swayX = isM ? 0 : Math.round(sway() * S(150))
  const handIcon = isM ? '👆' : '✋'
  const hint = isM ? 'Tap your pet!' : 'Swipe left & right to pet!'
  return (
    // Full-screen blocker (transparent) so touches drive the gesture and never
    // reach the avatar. The pet shows through from the fixed camera. On mobile,
    // each tap here fills the bar (petTap); on desktop the swipe is polled.
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', pointerFilter: 'block' }}
      uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0 } }}
      onMouseDown={() => {
        if (isM) petTap()
      }}
    >
      <BackButton onClick={() => cancelPetting()} />
      {/* Swipe hint: a hand that drifts side to side across the middle (over the
          centered pet). Placeholder disc + emoji until the hand art arrives. */}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: '34%', left: '50%' }, width: handD, height: handD, margin: { left: -handD / 2 + swayX }, alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}
      >
        <UiEntity
          uiTransform={{ width: handD, height: handD, borderRadius: Math.round(handD), alignItems: 'center', justifyContent: 'center' }}
          uiBackground={{ color: { r: 0.8, g: 0.8, b: 0.8, a: 0.28 } }}
        >
          <Label value={handIcon} fontSize={Math.round(handD * 0.5)} color={{ r: 1, g: 1, b: 1, a: 0.5 }} textAlign="middle-center" uiTransform={{ width: handD, height: handD }} />
        </UiEntity>
      </UiEntity>
      {/* Prompt + progress bar (bottom-center) */}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { bottom: S(90), left: '50%' }, margin: { left: -S(190) }, width: S(380), flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}
      >
        <OutlineLabel value={hint} fontSize={S(20)} color={C.text} width={'100%'} height={S(30)} textAlign="middle-center" />
        <UiEntity uiTransform={{ width: S(360), height: S(22), borderRadius: S(11), margin: { top: S(10) } }} uiBackground={{ color: C.trackBg }}>
          <UiEntity uiTransform={{ width: `${pct}%`, height: '100%', borderRadius: S(11) }} uiBackground={{ color: C.happy }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Hatch overlay — the egg is framed by a fixed camera; rub (desktop) / tap
// (mobile) to fill the bar and hatch the pet. Same gesture as petting.
// ---------------------------------------------------------------------------
function HatchOverlay() {
  const st = clientState.hatch
  if (!st.active) return <UiEntity />
  const pct = Math.round(st.progress * 100)
  const handD = S(96)
  const isM = mobile()
  const hatching = st.progress >= 1 // bar full: the egg is now playing its Hatch clip
  const swayX = isM ? 0 : Math.round(sway() * S(150))
  const handIcon = isM ? '👆' : '✋'
  const hint = hatching ? 'Hatching!' : isM ? 'Tap the egg to hatch!' : 'Rub the egg to hatch!'
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', pointerFilter: 'block' }}
      uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0 } }}
      onMouseDown={() => {
        if (isM) hatchTap()
      }}
    >
      {/* Hand/finger hint over the centered egg (hidden once it's hatching) */}
      {!hatching && (
        <UiEntity
          uiTransform={{ positionType: 'absolute', position: { top: '34%', left: '50%' }, width: handD, height: handD, margin: { left: -handD / 2 + swayX }, alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}
        >
          <UiEntity
            uiTransform={{ width: handD, height: handD, borderRadius: Math.round(handD), alignItems: 'center', justifyContent: 'center' }}
            uiBackground={{ color: { r: 0.8, g: 0.8, b: 0.8, a: 0.28 } }}
          >
            <Label value={handIcon} fontSize={Math.round(handD * 0.5)} color={{ r: 1, g: 1, b: 1, a: 0.5 }} textAlign="middle-center" uiTransform={{ width: handD, height: handD }} />
          </UiEntity>
        </UiEntity>
      )}
      {/* Prompt + progress bar */}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { bottom: S(90), left: '50%' }, margin: { left: -S(190) }, width: S(380), flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}
      >
        <OutlineLabel value={hint} fontSize={S(20)} color={C.text} width={'100%'} height={S(30)} textAlign="middle-center" />
        <UiEntity uiTransform={{ width: S(360), height: S(22), borderRadius: S(11), margin: { top: S(10) } }} uiBackground={{ color: C.trackBg }}>
          <UiEntity uiTransform={{ width: `${pct}%`, height: '100%', borderRadius: S(11) }} uiBackground={{ color: C.gold }} />
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
  const busy = clientState.fetch.busy
  const bw = S(300)
  const bh = S(92)
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }}>
      {/* BACK — disabled mid-throw so you don't leave a ball in the air */}
      <BackButton disabled={busy} onClick={() => (clientState.fetch.active = false)} />
      {/* Fetch button (bottom-center) */}
      <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: S(80), left: '50%' }, margin: { left: -bw / 2 }, width: bw, height: bh, alignItems: 'center', justifyContent: 'center' }}>
        <TactileButton
          id="fetch_throw"
          label={busy ? 'Fetching…' : 'Fetch'}
          width={bw}
          height={bh}
          bg={busy ? C.cardAlt : C.green}
          textColor={busy ? C.dim : C.outline}
          fontSize={S(32)}
          radius={S(26)}
          disabled={busy}
          pulse={!busy}
          onClick={() => throwMeteor()}
        />
      </UiEntity>
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// "Choose Location!" modal — shown on scene entry (Adopt-Me style). Two options:
// Adoption Center (adopt a pet) and House (care for your pet). Centered, rounded,
// mobile-first. Uses its own bright palette to match the reference look.
// ---------------------------------------------------------------------------
const LOC = {
  card: { r: 1, g: 0.93, b: 0.95, a: 0.9 } as Color, // very light pink, slightly translucent
  title: { r: 0.29, g: 0.56, b: 0.95, a: 1 } as Color,
  titleOutline: { r: 1, g: 1, b: 1, a: 1 } as Color,
  tile: { r: 1, g: 1, b: 1, a: 1 } as Color,
  tileBorder: { r: 0.9, g: 0.91, b: 0.94, a: 1 } as Color,
  orange: { r: 0.95, g: 0.55, b: 0.16, a: 1 } as Color,
  blue: { r: 0.25, g: 0.66, b: 0.95, a: 1 } as Color,
  green: { r: 0.35, g: 0.75, b: 0.45, a: 1 } as Color,
  red: { r: 0.9, g: 0.24, b: 0.2, a: 1 } as Color,
  violet: { r: 0.6, g: 0.5, b: 0.86, a: 1 } as Color, // pastel violet (Keep)
  rose: { r: 0.9, g: 0.55, b: 0.72, a: 1 } as Color, // pastel rose (Discard)
  white: { r: 1, g: 1, b: 1, a: 1 } as Color,
  body: { r: 0.2, g: 0.22, b: 0.28, a: 1 } as Color, // dark text on the light card
  dim: { r: 0.5, g: 0.47, b: 0.53, a: 1 } as Color,
  neutral: { r: 0.85, g: 0.85, b: 0.88, a: 1 } as Color // back/secondary button
}

// Shared light modal shell (pink card + blue title + designer close button) —
// the "Choose Location!"/tutorial look. Used by the adoption flow.
const LOC_CLOSE = 'assets/images/tutorialUi/btn_close.png'
function LightModal(props: { title: string; width: number; height: number; onClose: () => void; children?: any }) {
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', pointerFilter: 'block' }}
      uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0.5 } }}
      onMouseDown={() => {}}
    >
      <UiEntity
        uiTransform={{ width: props.width, height: props.height, flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', padding: { top: S(28), bottom: S(30), left: S(30), right: S(30) }, borderRadius: S(28), pointerFilter: 'block' }}
        uiBackground={{ color: LOC.card }}
      >
        <UiEntity
          uiTransform={{ positionType: 'absolute', position: { top: S(16), right: S(16) }, width: S(52), height: S(52), pointerFilter: 'block' }}
          uiBackground={{ texture: { src: LOC_CLOSE }, textureMode: 'stretch' }}
          onMouseDown={props.onClose}
        />
        <OutlineLabel value={props.title} fontSize={S(42)} color={LOC.title} outlineColor={LOC.titleOutline} width={'100%'} height={S(58)} textAlign="middle-center" />
        {/* Explicit height (NOT flex:1): Unity collapses flex-grow fill, piling the
            content up. height = card - paddings - title - margin. */}
        <UiEntity uiTransform={{ width: '100%', height: props.height - S(126), flexDirection: 'column', alignItems: 'center', margin: { top: S(10) }, overflow: 'hidden' }}>
          {props.children}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

function LocationTile(props: { icon: string; label: string; color: Color; onClick: () => void }) {
  const tileW = S(300)
  const iconH = S(210)
  return (
    <UiEntity
      uiTransform={{ width: tileW, flexDirection: 'column', alignItems: 'center', margin: { left: S(12), right: S(12) }, pointerFilter: 'block' }}
      onMouseDown={props.onClick}
    >
      {/* Icon area (white rounded card) */}
      <UiEntity
        uiTransform={{ width: tileW, height: iconH, alignItems: 'center', justifyContent: 'center', borderRadius: S(22) }}
        uiBackground={{ color: LOC.tile }}
      >
        <Label value={props.icon} fontSize={S(120)} color={props.color} textAlign="middle-center" uiTransform={{ width: tileW, height: iconH }} />
      </UiEntity>
      {/* Colored label banner */}
      <UiEntity
        uiTransform={{ width: tileW - S(30), height: S(64), alignItems: 'center', justifyContent: 'center', margin: { top: -S(14) }, borderRadius: S(16) }}
        uiBackground={{ color: props.color }}
      >
        <OutlineLabel value={props.label} fontSize={S(24)} color={LOC.white} outlineColor={{ r: 0, g: 0, b: 0, a: 0.35 }} width={'100%'} height={S(34)} textAlign="middle-center" />
      </UiEntity>
    </UiEntity>
  )
}

function LocationPanel() {
  if (!uiState.locationOpen) return <UiEntity />
  const MW = S(760)
  const MH = S(560)
  const close = () => (uiState.locationOpen = false)
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', pointerFilter: 'block' }}
      uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0.5 } }}
      onMouseDown={() => {}}
    >
      <UiEntity
        uiTransform={{ width: MW, height: MH, flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', padding: { top: S(28), bottom: S(28), left: S(24), right: S(24) }, borderRadius: S(28), pointerFilter: 'block' }}
        uiBackground={{ color: LOC.card }}
      >
        {/* Red X (top-right) */}
        <UiEntity
          uiTransform={{ positionType: 'absolute', position: { top: S(18), right: S(18) }, width: S(56), height: S(56), alignItems: 'center', justifyContent: 'center', borderRadius: S(14), pointerFilter: 'block' }}
          uiBackground={{ color: LOC.red }}
          onMouseDown={close}
        >
          <OutlineLabel value="X" fontSize={S(30)} color={LOC.white} outlineColor={{ r: 0, g: 0, b: 0, a: 0.3 }} width={S(56)} height={S(40)} textAlign="middle-center" />
        </UiEntity>
        {/* Title */}
        <OutlineLabel value="Choose Location!" fontSize={S(52)} color={LOC.title} outlineColor={LOC.titleOutline} width={'100%'} height={S(70)} textAlign="middle-center" />
        {/* Two options */}
        <UiEntity uiTransform={{ width: '100%', flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', margin: { top: S(20) } }}>
          <LocationTile
            icon="🏥"
            label="ADOPTION CENTER"
            color={LOC.orange}
            onClick={() => {
              close()
              ui.goCareCenter()
            }}
          />
          {/* House: stay put, just close the modal. */}
          <LocationTile icon="🏠" label="HOUSE" color={LOC.blue} onClick={close} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Carry-egg-home flow — while carrying an egg, a hint says "take it home"; once
// the player is home a big centered "Hatch" button starts the rub-to-hatch flow.
// ---------------------------------------------------------------------------
function CarryHatchButton() {
  const st = clientState.carryEgg
  if (!st.active) return <UiEntity />
  if (!st.atHome) {
    // Walking home — reminder banner (top-center).
    return (
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: S(90), left: '50%' }, margin: { left: -S(230) }, width: S(460), height: S(58), alignItems: 'center', justifyContent: 'center', borderRadius: S(29), pointerFilter: 'none' }}
        uiBackground={{ color: C.panelBg }}
      >
        <Label value="Take your egg home to hatch it!" fontSize={S(20)} color={C.text} textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: S(30) }} />
      </UiEntity>
    )
  }
  const bw = S(300)
  const bh = S(92)
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: S(80), left: '50%' }, margin: { left: -bw / 2 }, width: bw, height: bh, alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
      <TactileButton id="carry_hatch" label="Hatch" width={bw} height={bh} bg={C.green} textColor={C.outline} fontSize={S(34)} radius={S(26)} pulse onClick={() => beginHatchFromCarry()} />
    </UiEntity>
  )
}

// Carry-pet-to-bath flow — a hint while walking to the tub, then a big "Bath"
// button once close; tapping it places the pet in the tub and bathes it.
function BathButton() {
  const st = clientState.carryPet
  if (!st.active) return <UiEntity />
  const bw = S(300)
  const bh = S(92)
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }}>
      {/* BACK — cancel the bath and just keep the pet following */}
      <BackButton onClick={() => cancelCarryPet()} />
      {!st.atStation ? (
        // Walking to the tub — reminder banner (top-center).
        <UiEntity
          uiTransform={{ positionType: 'absolute', position: { top: S(90), left: '50%' }, margin: { left: -S(240) }, width: S(480), height: S(58), alignItems: 'center', justifyContent: 'center', borderRadius: S(29), pointerFilter: 'none' }}
          uiBackground={{ color: C.panelBg }}
        >
          <Label value="Carry your pet to the bath!" fontSize={S(20)} color={C.text} textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: S(30) }} />
        </UiEntity>
      ) : (
        // At the tub — place the pet.
        <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: S(80), left: '50%' }, margin: { left: -bw / 2 }, width: bw, height: bh, alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
          <TactileButton id="place_bath" label="Bath" width={bw} height={bh} bg={C.hygiene} textColor={C.outline} fontSize={S(34)} radius={S(26)} pulse onClick={() => placePetAtStation()} />
        </UiEntity>
      )}
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
const Root = () => {
  // In petting mode the camera is locked on the pet — hide the whole HUD so
  // nothing covers it, leaving only the petting overlay (BACK + swipe hint).
  if (clientState.petting.active) {
    return (
      <UiEntity uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}>
        <PettingOverlay />
      </UiEntity>
    )
  }
  // Hatching also owns the whole screen (egg framed by a fixed camera).
  if (clientState.hatch.active) {
    return (
      <UiEntity uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}>
        <HatchOverlay />
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
    <FetchOverlay />
    <CarryHatchButton />
    <BathButton />
    {uiState.panel === 'adopt' && <AdoptPanel />}
    {uiState.panel === 'shop' && <ShopPanel />}
    {uiState.panel === 'roster' && <RosterPanel />}
    {uiState.panel === 'inventory' && <InventoryPanel />}
    {uiState.panel === 'spin' && <SpinPanel />}
    {uiState.panel === 'meteor' && <MeteorRewardPanel />}
    {uiState.panel === 'goals' && <GoalsPanel />}
    {uiState.panel === 'daily' && <DailyRewardPanel />}
    <DialogBox />
    <LocationPanel />
    {/* Bubble + toasts render LAST so they sit on top of any open panel/modal. */}
    <SpeechBubble />
    <Toasts />
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
