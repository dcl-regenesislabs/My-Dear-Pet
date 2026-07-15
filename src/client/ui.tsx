// Mobile-first HUD + panels for MyDearPet, modeled on the cozy-farm IO layout:
//  - TOP: player profile bar (Caretaker level + XP) -> taps to Goals
//  - TOP (when a pet is selected): pet stat bars + care actions
//  - BOTTOM: 3 big nav buttons (Pets / Inventory / Goals)
//  - SIDES: Spin + Shop (right), Whistle (left)
// Reads the client mirror of authoritative server state.

import ReactEcs, { ReactEcsRenderer, Label, UiEntity, Input } from '@dcl/sdk/react-ecs'
import * as Cfg from '../shared/config'
import type { CareAction } from '../shared/types'
import { actions, adoptPet, clientState, pushToast, serverConnected, switchActivePet } from './state'
import { setFollow } from './pet'
import { triggerCare, careActive, queueLength } from './input'
import { buyItemLocal, buySlotLocal, claimStreak, spinLocal, streakClaimable, streakWeekDay, useItemLocal } from './sim'
import { startAnimSystem } from './ui/anim'
import { C, Color, OutlineLabel, PanelShell, S, StatBar, TactileButton } from './ui/theme'
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
// Art for the pet panel. Bar fills map to the stat colors: orange = Hunger,
// celest = Hygiene, yellow = Energy, pink = Happy.
// Every bar is drawn with the same 12px rounded cap, but the art ships at
// different lengths — so each one's cap is a different fraction of its width.
// Nine-slicing on that exact fraction keeps all four radii identical on screen.
const CAP_PX = 12
const bar = (file: string, srcWidth: number) => ({
  src: `assets/images/petPanelUi/${file}`,
  slice: CAP_PX / srcWidth
})

const PET_UI = {
  bg: 'assets/images/petPanelUi/panel-bg.png',
  track: bar('bar_track.png', 600),
  fillHunger: bar('bar_fill_orange.png', 372),
  fillHygiene: bar('bar_fill_celest.png', 510),
  fillEnergy: bar('bar_fill_yllow.png', 288),
  fillHappy: bar('bar_fill_pink.png', 432),
  iconHunger: 'assets/images/petPanelUi/stat_hunger.png',
  iconHygiene: 'assets/images/petPanelUi/stat_hygiene.png',
  iconEnergy: 'assets/images/petPanelUi/stat_energy.png',
  iconHappy: 'assets/images/petPanelUi/stat_happy.png',
  feed: 'assets/images/petPanelUi/feed.png',
  bath: 'assets/images/petPanelUi/bath.png',
  sleep: 'assets/images/petPanelUi/sleep.png',
  play: 'assets/images/petPanelUi/play.png'
}

function PetPanel() {
  const pet = clientState.activePet
  if (!pet) return <UiEntity />
  const care = (a: CareAction) => triggerCare(a)
  // Content sizing — deliberately independent of the panel art below, so the
  // background can grow to frame the content without scaling it too.
  // Rows get an explicit width: '100%' inside a padded parent resolves to the
  // parent's FULL width and would spill past the art on the right.
  const rowW = S(430) - S(26) * 2
  const chipW = Math.round((rowW - S(18)) / 4)
  const chipH = Math.round((chipW * 100) / 178) // action art is 1.78:1
  // Panel art — drawn larger than the content so it fully frames it.
  const PW = S(520)
  const PH = Math.round((PW * 524) / 944) // keep the art's aspect (1.80:1)

  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: S(84), left: '50%' }, margin: { left: -PW / 2 }, width: PW, height: PH, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerFilter: 'block' }}
      uiBackground={{ texture: { src: PET_UI.bg }, textureMode: 'stretch' }}
    >
      <UiEntity uiTransform={{ width: rowW, height: S(24), flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
        <OutlineLabel value={`${pet.name}   Lv ${pet.petLevel}`} fontSize={S(17)} color={C.gold} width={S(220)} height={S(22)} textAlign="middle-center" />
        {careActive() && <Label value={`busy${queueLength() > 0 ? ` +${queueLength()}` : ''}`} fontSize={S(13)} color={C.dim} textAlign="middle-left" uiTransform={{ width: S(70), height: S(22), margin: { left: S(8) } }} />}
      </UiEntity>
      {/* Four full-width bars, stacked (matches the panel art). */}
      <UiEntity uiTransform={{ width: rowW, flexDirection: 'column', margin: { top: S(6) } }}>
        <StatBar label="Hunger" value={pet.hunger} color={C.hunger} width={rowW} icon={PET_UI.iconHunger} track={PET_UI.track} fill={PET_UI.fillHunger} />
        <StatBar label="Hygiene" value={pet.hygiene} color={C.hygiene} width={rowW} icon={PET_UI.iconHygiene} track={PET_UI.track} fill={PET_UI.fillHygiene} />
        <StatBar label="Energy" value={pet.energy} color={C.energy} width={rowW} icon={PET_UI.iconEnergy} track={PET_UI.track} fill={PET_UI.fillEnergy} />
        <StatBar label="Happy" value={pet.happiness} color={C.happy} width={rowW} icon={PET_UI.iconHappy} track={PET_UI.track} fill={PET_UI.fillHappy} />
      </UiEntity>
      <UiEntity uiTransform={{ width: rowW, flexDirection: 'row', justifyContent: 'center', margin: { top: S(6) } }}>
        <TactileButton id="care_feed" label="Feed" texture={PET_UI.feed} width={chipW} height={chipH} margin={{ left: S(2), right: S(2) }} onClick={() => care('feed')} />
        <TactileButton id="care_bath" label="Bath" texture={PET_UI.bath} width={chipW} height={chipH} margin={{ left: S(2), right: S(2) }} onClick={() => care('clean')} />
        <TactileButton
          id="care_sleep"
          label={pet.sleeping ? 'Wake' : 'Sleep'}
          texture={PET_UI.sleep}
          width={chipW}
          height={chipH}
          margin={{ left: S(2), right: S(2) }}
          onClick={() => {
            // Waking is instant — no walk back to the bed first.
            if (pet.sleeping) {
              pet.sleeping = false
              actions.care('sleep', true)
            } else care('sleep')
          }}
        />
        <TactileButton id="care_play" label="Play" texture={PET_UI.play} width={chipW} height={chipH} margin={{ left: S(2), right: S(2) }} onClick={() => care('play')} />
      </UiEntity>
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Bottom nav: 3 big buttons (cozy-farm style)
// ---------------------------------------------------------------------------
function BottomNav() {
  const p = clientState.player
  if (!p) return <UiEntity />
  const bw = S(160)
  const bh = S(72)
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: S(18), left: 0 }, width: '100%', height: bh, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
      <TactileButton
        id="nav_pets"
        label="My Pets"
        texture={uiState.panel === 'roster' ? 'assets/images/navButtonUi/mypets_selected.png' : 'assets/images/navButtonUi/mypets_unselected.png'}
        width={bw}
        height={bh}
        fontSize={S(20)}
        margin={{ left: S(8), right: S(8) }}
        onClick={() => ui.openRoster()}
      />
      <TactileButton
        id="nav_inv"
        label="Inventory"
        texture={uiState.panel === 'inventory' ? 'assets/images/navButtonUi/inventory_selected.png' : 'assets/images/navButtonUi/inventory_unselected.png'}
        width={bw}
        height={bh}
        fontSize={S(20)}
        margin={{ left: S(8), right: S(8) }}
        onClick={() => ui.openInventory()}
      />
      <TactileButton
        id="nav_goals"
        label="Goals"
        texture={uiState.panel === 'goals' ? 'assets/images/navButtonUi/goals_selected.png' : 'assets/images/navButtonUi/goals_unselected.png'}
        width={bw}
        height={bh}
        fontSize={S(20)}
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
  if (!p) return <UiEntity />
  const hasPet = !!clientState.activePet
  const w = S(112)
  const h = S(58)
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
        <UiEntity uiTransform={{ width: '100%', flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'flex-start', overflow: 'hidden' }}>
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
      <UiEntity uiTransform={{ width: '100%', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
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
      <UiEntity uiTransform={{ width: '100%', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
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
// Root
// ---------------------------------------------------------------------------
const Root = () => (
  <UiEntity uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}>
    <ServerStatus />
    <ProfileBar />
    <ColonyBar />
    <PetPanel />
    <SideButtons />
    <BottomNav />
    <Toasts />
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

export function setupUi(): void {
  startAnimSystem()
  ReactEcsRenderer.setUiRenderer(Root, { virtualWidth: 1920, virtualHeight: 1080 })
}
