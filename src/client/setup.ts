// Client bootstrap: seed a local player (so the HUD always renders), register
// server handlers, run the local simulation, and request persisted state. The
// server corrects us via snapshots when it answers; if it never does, the
// client simulates the whole game locally.

import { engine } from '@dcl/sdk/ecs'
import { room } from '../shared/messages'
import type { PlayerSnapshot, PresenceEntry } from '../shared/types'
import type { SpinReward } from '../shared/config'
import { actions, applyPresence, applySnapshot, clientState, markServerAlive, pushToast, resolveMyAddress } from './state'
import { evaluateStreak, seedLocalPlayer, simTick } from './sim'
import { setupUi, ui } from './ui'
import { openCaretakerIntro } from './ui/dialog'
import { setupInput } from './input'
import { setupPetSystems } from './pet'
import { setupPlay } from './play'
import { setupMeteor } from './meteor'
import { setupSkybox } from './skybox'
import { setupPlane } from './plane'
import { setupCaretakerFloat } from './caretaker'

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
    try {
      const snap = JSON.parse(data.json) as PlayerSnapshot
      applySnapshot(snap)
      // Decide the "Choose Location!" modal on the FIRST snapshot only: a player
      // who ALREADY had a pet on entry is "returning" -> show it. A first-timer
      // (no pet at load) gets the tutorial instead, and must NOT get the modal
      // later when they adopt this session.
      if (!firstSnapshotSeen) {
        firstSnapshotSeen = true
        if (snap.activePet) ui.openLocation()
      }
      // Returning player already has a pet -> skip the tutorial.
      if (snap.activePet) introTriggered = true
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

  // Breeding result — the offspring's rolled rarity (reveal comes later).
  room.onMessage('breedResult', (data) => {
    markServerAlive()
    pushToast(`Offspring rarity: ${data.rarity.toUpperCase()}!`)
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
  setupPlane() // placeholder plane in the middle of the scene (reposition later)
  setupCaretakerFloat() // Caretaker robot gently hovers up/down
  setupMeteor() // meteor reward drop (falls, settles, clickable)
  evaluateStreak() // advance / reset the 7-day login streak
  registerHandlers()
  setupUi()
  setupInput()
  setupPetSystems() // renders + simulates remote pets from server `presence`
  setupPlay() // Play action: throw an animated meteorite forward

  // Try to load persisted state from the server (retry until it answers).
  let sinceReq = 99
  let elapsed = 0
  actions.requestState()
  engine.addSystem((dt: number) => {
    elapsed += dt
    simTick(dt) // local game simulation

    // Keep asking the server for our saved progress for a while.
    if (elapsed < 30) {
      sinceReq += dt
      if (sinceReq >= 2) {
        sinceReq = 0
        resolveMyAddress()
        actions.requestState()
      }
    }

    // Greet first-time players (give the server ~2.5s to load an existing pet).
    if (!introTriggered && elapsed >= 2.5 && !clientState.activePet) {
      showIntro()
    }

    // Daily reward is suspended for now — the meteor covers the daily drop.
  })

  console.log('[Client] MyDearPet client ready')
}
