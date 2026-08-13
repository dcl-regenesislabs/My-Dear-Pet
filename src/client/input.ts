// Clickable scene objects + the care-action QUEUE. Care actions don't fire
// instantly: clicking enqueues them, and the pet performs ONE at a time —
// walk to the object, do the animation for a beat, then a short rest before
// the next. This stops the pet from teleport-spamming between stations.

import { engine, pointerEventsSystem, inputSystem, InputAction, PointerEventType } from '@dcl/sdk/ecs'
import { EntityNames } from '../../assets/scene/entity-names'
import type { CareAction } from '../shared/types'
import { actionObjectPosition } from './objects'
import { isBusy, sendPetTo } from './pet'
import { applyCareLocal } from './sim'
import { actions, clientState, debugGrowAdultLocal, pushToast } from './state'
import { ui } from './ui'

const ACTION_CLIP: Record<CareAction, string> = {
  feed: 'eat',
  clean: 'gesture-positive',
  sleep: 'idle',
  play: 'dance'
}

const MAX_QUEUE = 4
const REST_AFTER_ACTION_MS = 1500 // pause between consecutive care actions

const queue: CareAction[] = []
let restUntil = 0
let prevBusy = false

export function queueLength(): number {
  return queue.length
}
export function careActive(): boolean {
  return isBusy() || queue.length > 0
}

/** Enqueue a care action (does not run immediately). */
export function triggerCare(action: CareAction): void {
  if (!clientState.activePet) {
    pushToast('Adopt a pet first!')
    ui.openAdopt()
    return
  }
  if (queue.length >= MAX_QUEUE) {
    pushToast('Your pet is busy — wait a moment!')
    return
  }
  queue.push(action)
}

function startCare(action: CareAction): void {
  const dest = actionObjectPosition(action)
  const onBed = action === 'sleep'
  sendPetTo(
    dest,
    () => {
      applyCareLocal(action, onBed) // optimistic local effect
      actions.care(action, onBed) // tell the server (it corrects via snapshot)
    },
    ACTION_CLIP[action]
  )
}

function setupCareQueue(): void {
  engine.addSystem(() => {
    const now = Date.now()
    const busy = isBusy()
    // When an action just finished, enforce a short rest before the next.
    if (prevBusy && !busy) restUntil = now + REST_AFTER_ACTION_MS
    prevBusy = busy

    if (queue.length > 0 && !busy && now >= restUntil) {
      const next = queue.shift()!
      startCare(next)
    }
  })
}

// DEBUG hotkey: press "4" to grow the active pet to Adult + Lv5 (unlock breeding).
// NOTE: DCL exposes only number keys 1-4 (IA_ACTION_3..6); there is no key "5",
// so this testing shortcut lives on 4 (IA_ACTION_6).
function setupDebugHotkeys(): void {
  engine.addSystem(() => {
    if (inputSystem.isTriggered(InputAction.IA_ACTION_6, PointerEventType.PET_DOWN)) {
      if (!clientState.activePet) {
        pushToast('DEBUG: no active pet to grow')
        return
      }
      debugGrowAdultLocal()
      pushToast('DEBUG: pet grown to Adult (Lv 5) — breeding unlocked')
    }
  })
}

function onClick(name: string, hoverText: string, cb: () => void): void {
  const ent = engine.getEntityOrNullByName(name)
  if (!ent) {
    console.log('[Client] entity not found:', name)
    return
  }
  pointerEventsSystem.onPointerDown({ entity: ent, opts: { button: InputAction.IA_POINTER, hoverText, maxDistance: 16 } }, cb)
}

export function setupInput(): void {
  onClick(EntityNames.PetFeeder_glb, 'Feed', () => triggerCare('feed'))
  onClick(EntityNames.PetPool_glb, 'Bath', () => triggerCare('clean'))
  onClick(EntityNames.PetBed_glb, 'Sleep', () => triggerCare('sleep'))
  // Old play action (pet walks to the ball) is suspended — Play now throws a
  // meteorite forward (see play.ts, wired to the Play button in ui.tsx).
  // onClick(EntityNames.Ball, 'Play', () => triggerCare('play'))
  // Caretaker click is handled in caretaker.ts (click collider, not the raw GLTF).
  // Shop is suspended for now — the object stays in the scene but isn't clickable.
  setupCareQueue()
  setupDebugHotkeys()
}
