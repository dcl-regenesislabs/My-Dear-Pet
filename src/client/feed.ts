// Feed task (new flow). Feeding no longer sends the pet walking to the bowl:
// pressing Feed starts a small errand for the PLAYER. The same ground arrow the
// egg carry uses (pet.ts showArrowTo/hideArrow) points at the tree placed in the
// Creator Hub composite (assets/scene/main.composite, entity "tree.glb"); walking
// within range of it hands off straight to the feeding mini-game (fruitGame.ts) —
// no click needed, it triggers on arrival.

import { engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { hideArrow, showArrowTo, canStartPetInteraction } from './pet'
import { EntityNames } from '../../assets/scene/entity-names'
import { clientState, pushToast, hasPendingHatchling } from './state'
import { ui } from './ui'
import { startFruitGame } from './fruitGame'

const TREE_RADIUS = 9 // metres: how close you must be before the minigame auto-starts (fruitGame.ts's own arrival cam covers the last few metres of the walk-in)

let active = false
/** Single writer for the errand flag: mirrors it onto clientState so
 *  switchActivePet can refuse a roster swap while the errand is running. */
function setErrandActive(on: boolean): void {
  active = on
  clientState.feedErrandActive = on
}

/** The tree as placed in the composite — not a duplicate spawned in code. */
function getTree(): Entity | null {
  return engine.getEntityOrNullByName(EntityNames.tree_glb)
}

function playerPos(): Vector3 {
  const t = Transform.getOrNull(engine.PlayerEntity)
  return t ? t.position : Vector3.Zero()
}

function distFlat(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

/** Feed pressed: light up the guide arrow and send the player to the tree. */
export function startFeedTask(): void {
  if (!clientState.activePet) {
    pushToast('Adopt a pet first!')
    ui.openAdopt()
    return
  }
  if (!canStartPetInteraction()) {
    pushToast(
      hasPendingHatchling()
        ? 'Keep or discard your new pet first!'
        : clientState.activePet.sleeping
          ? 'Your pet is asleep!'
          : 'Your pet is busy — wait a moment!'
    )
    return
  }
  if (active) {
    pushToast('Head to the tree — follow the arrow!')
    return
  }
  const tree = getTree()
  if (!tree) {
    console.log('[Client] feed task: tree not found in scene')
    return
  }
  setErrandActive(true)
  showArrowTo(Transform.get(tree).position)
  clientState.petPanelOpen = false // the panel covers the screen; the errand is out in the world
  pushToast('Follow the arrow to the tree!')
}

/** Drop the errand (arrow off). */
export function cancelFeedTask(): void {
  if (!active) return
  setErrandActive(false)
  hideArrow()
}

export function feedTaskActive(): boolean {
  return active
}

export function setupFeedTask(): void {
  engine.addSystem(() => {
    if (!active) return
    // Yield the shared guide arrow to a carry flow (egg / bath): those also drive
    // pet.ts's arrow, so if the player starts Feed then Bath, the errand must bow
    // out instead of fighting to keep the arrow pointed at the tree.
    if (clientState.carryEgg.active || clientState.carryPet.active) {
      cancelFeedTask()
      return
    }
    const tree = getTree()
    if (!tree) return
    const pos = Transform.get(tree).position
    showArrowTo(pos) // re-assert each frame, same as the egg carry does
    if (distFlat(playerPos(), pos) <= TREE_RADIUS) {
      const petId = clientState.activePet ? clientState.activePet.id : ''
      setErrandActive(false)
      hideArrow() // errand done — the cinematic takes over from here
      startFruitGame(petId)
    }
  })
}
