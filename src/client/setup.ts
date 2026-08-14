// Client bootstrap: seed a local player, register server handlers, run the
// local simulation, and request persisted state.
//
// INTENTIONAL: this is NOT playable offline. The loading gate in ui.tsx
// (Root, gated on clientState.serverReady) blocks all UI/input until the
// FIRST stateSnapshot answers requestState() below. If the server never
// answers, the player is stuck on "Loading server..." forever — there is no
// local-only fallback anymore. seedLocalPlayer()/simTick() still run so the
// data is ready the instant the gate lifts, but nothing is shown or usable
// before that.

import { engine, InputModifier } from '@dcl/sdk/ecs'
import { room } from '../shared/messages'
import type { PlayerSnapshot, PresenceEntry } from '../shared/types'
import type { SpinReward } from '../shared/config'
import { actions, applyPresence, applySnapshot, clientState, markServerAlive, pushToast, resolveMyAddress } from './state'
import { evaluateStreak, seedLocalPlayer, simTick } from './sim'
import { setupUi, ui } from './ui'
import { openCaretakerIntro } from './ui/dialog'
import { setupInput } from './input'
import { setupPetSystems, startCarryEgg } from './pet'
import { setupPlay } from './play'
import { setupMeteor } from './meteor'
import { setupSkybox } from './skybox'
import { setupCaretaker } from './caretaker'

let introTriggered = false
let firstSnapshotSeen = false // decide the "Choose Location!" modal on the FIRST snapshot only

function showIntro(): void {
  if (introTriggered) return
  introTriggered = true
  clientState.introShown = true
  // First run with no pet: the Caretaker speaks first, then sends the player to
  // the Care Center to adopt.
  if (!clientState.activePet) {
    openCaretakerIntro(() => {
      ui.goCareCenter()
      ui.openAdopt()
    })
  }
}

function registerHandlers(): void {
  room.onMessage('stateSnapshot', (data) => {
    markServerAlive()
    clientState.serverReady = true // lifts the loading gate in ui.tsx (Root)
    try {
      const snap = JSON.parse(data.json) as PlayerSnapshot
      applySnapshot(snap)
      // Decide intro-vs-"Choose Location!" on the FIRST snapshot ONLY, and only
      // here — this used to also be guessed from a timer (elapsed >= 2.5s) in case
      // the server was slow, but that guess could fire showIntro() BEFORE this
      // snapshot arrived and then get contradicted by it, leaving both the
      // Caretaker intro AND the Location modal open at once. Now that the loading
      // gate (clientState.serverReady) already blocks all UI until this snapshot
      // lands, there's no need to guess early — decide once, for real.
      if (!firstSnapshotSeen) {
        firstSnapshotSeen = true
        if (snap.activePet) {
          introTriggered = true // returning player already has a pet -> skip the tutorial
          ui.openLocation()
        } else {
          showIntro()
        }
      }
    } catch (e) {
      console.log('[Client] bad snapshot', e)
    }
  })

  room.onMessage('presence', (data) => {
    markServerAlive()
    try {
      applyPresence(JSON.parse(data.json) as PresenceEntry[])
    } catch (e) {
      console.log('[Client] bad presence', e)
    }
  })

  // Shared colony population — same number for every player.
  room.onMessage('colony', (data) => {
    markServerAlive()
    clientState.colonyPopulation = data.population
  })

  room.onMessage('notify', (data) => {
    markServerAlive()
    pushToast(data.message)
  })

  // Breeding result — the offspring is an egg (server hatchling). Carry it home
  // and hatch it, just like a fresh adoption; the rarity is the surprise inside.
  room.onMessage('breedResult', (data) => {
    markServerAlive()
    pushToast(`You bred a ${data.rarity.toUpperCase()} egg — carry it home!`)
    if (data.species) startCarryEgg(data.species, data.name, true)
  })

  // Daily meteor: the server rolled and persisted it — show what we got.
  room.onMessage('meteorResult', (data) => {
    markServerAlive()
    try {
      const reward = JSON.parse(data.json) as SpinReward
      clientState.lastSpin = { reward, index: data.index, at: Date.now() }
      ui.openMeteorReward()
    } catch (e) {
      console.log('[Client] bad meteor result', e)
    }
  })

  room.onMessage('spinResult', (data) => {
    markServerAlive()
    try {
      const reward = JSON.parse(data.json) as SpinReward
      clientState.lastSpin = { reward, index: data.index, at: Date.now() }
    } catch (e) {
      console.log('[Client] bad spin result', e)
    }
  })
}

export function setupClient(): void {
  resolveMyAddress()
  seedLocalPlayer() // HUD renders immediately, no waiting on the network
  setupSkybox() // Mars ground + boundary colliders
  setupCaretaker() // click collider + Idle/Talk animation
  setupMeteor() // meteor reward drop (falls, settles, clickable)
  evaluateStreak() // advance / reset the 7-day login streak
  registerHandlers()
  setupUi()
  setupInput()
  setupPetSystems() // renders + simulates remote pets from server `presence`
  setupPlay() // Play action: throw an animated meteorite forward

  // Freeze the player (movement + camera input) while the loading gate is up —
  // ui.tsx only blocks pointer/UI, InputModifier is what stops the avatar from
  // walking off before the server has answered.
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  let inputFrozen = true

  // Try to load persisted state from the server (retry until it answers).
  let sinceReq = 99
  let elapsed = 0
  actions.requestState()
  engine.addSystem((dt: number) => {
    elapsed += dt
    simTick(dt) // local game simulation

    if (inputFrozen && clientState.serverReady) {
      inputFrozen = false
      InputModifier.deleteFrom(engine.PlayerEntity)
    }

    // Keep asking the server for our saved progress for a while.
    if (elapsed < 30) {
      sinceReq += dt
      if (sinceReq >= 2) {
        sinceReq = 0
        resolveMyAddress()
        actions.requestState()
      }
    }

    // Daily reward is suspended for now — the meteor covers the daily drop.
  })

  console.log('[Client] MyDearPet client ready')
}
