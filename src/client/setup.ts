// Client bootstrap: seed a local player (so the HUD always renders), register
// server handlers, run the local simulation, and request persisted state. The
// server corrects us via snapshots when it answers; if it never does, the
// client simulates the whole game locally.

import { engine } from '@dcl/sdk/ecs'
import { room } from '../shared/messages'
import type { PlayerSnapshot, PresenceEntry } from '../shared/types'
import type { SpinReward } from '../shared/config'
import { actions, applyPresence, applySnapshot, clientState, pushToast, resolveMyAddress } from './state'
import { evaluateStreak, seedLocalPlayer, simTick } from './sim'
import { setupUi, ui } from './ui'
import { openCaretakerIntro } from './ui/dialog'
import { setupInput } from './input'
import { setupPetSystems } from './pet'
import { setupMeteor } from './meteor'

let introTriggered = false

function showIntro(): void {
  if (introTriggered) return
  introTriggered = true
  clientState.introShown = true
  // First run with no pet: the Caretaker speaks first, then invites adoption.
  if (!clientState.activePet) {
    openCaretakerIntro(() => ui.openAdopt())
  }
}

function registerHandlers(): void {
  room.onMessage('stateSnapshot', (data) => {
    try {
      const snap = JSON.parse(data.json) as PlayerSnapshot
      applySnapshot(snap)
      // Returning player already has a pet -> never auto-open the intro.
      if (snap.activePet) introTriggered = true
    } catch (e) {
      console.log('[Client] bad snapshot', e)
    }
  })

  room.onMessage('presence', (data) => {
    try {
      applyPresence(JSON.parse(data.json) as PresenceEntry[])
    } catch (e) {
      console.log('[Client] bad presence', e)
    }
  })

  room.onMessage('notify', (data) => {
    pushToast(data.message)
  })

  room.onMessage('spinResult', (data) => {
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
  setupMeteor() // meteor reward drop (falls, settles, clickable)
  evaluateStreak() // advance / reset the 7-day login streak
  registerHandlers()
  setupUi()
  setupInput()
  setupPetSystems() // renders + simulates remote pets from server `presence`

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
