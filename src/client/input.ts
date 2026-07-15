// Clickable scene objects + the care-action QUEUE. Care actions don't fire
// instantly: clicking enqueues them, and the pet performs ONE at a time —
// walk to the object, do the animation for a beat, then a short rest before
// the next. This stops the pet from teleport-spamming between stations.

import { engine, pointerEventsSystem, InputAction } from '@dcl/sdk/ecs'
import { EntityNames } from '../../assets/scene/entity-names'
import type { CareAction } from '../shared/types'
import { ACTION_OBJECT } from '../shared/config'
import { isBusy, sendPetTo } from './pet'
import { applyCareLocal } from './sim'
import { actions, clientState, pushToast } from './state'
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
  const dest = ACTION_OBJECT[action]
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

function onClick(name: string, hoverText: string, cb: () => void): void {
  const ent = engine.getEntityOrNullByName(name)
  if (!ent) {
    console.log('[Client] entity not found:', name)
    return
  }
  pointerEventsSystem.onPointerDown({ entity: ent, opts: { button: InputAction.IA_POINTER, hoverText, maxDistance: 16 } }, cb)
}

export function setupInput(): void {
  onClick(EntityNames.Bowl, 'Feed', () => triggerCare('feed'))
  onClick(EntityNames.Pond, 'Bath', () => triggerCare('clean'))
  onClick(EntityNames.Bed, 'Sleep', () => triggerCare('sleep'))
  onClick(EntityNames.Ball, 'Play', () => triggerCare('play'))
  onClick(EntityNames.Caretaker, 'Talk to Caretaker', () => ui.openCaretaker())
  // Shop is suspended for now — the object stays in the scene but isn't clickable.
  setupCareQueue()
}
