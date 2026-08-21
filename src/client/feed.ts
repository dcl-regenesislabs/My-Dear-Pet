// Feed task (new flow). Feeding no longer sends the pet walking to the bowl:
// pressing Feed starts a small errand for the PLAYER. The same ground arrow the
// egg carry uses (pet.ts showArrowTo/hideArrow) points at the tree; once you're
// standing at it the tree becomes clickable, and clicking it clears the arrow
// and hands off to the feeding mini-game.

import { engine, Entity, Transform, pointerEventsSystem, InputAction } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { hideArrow, showArrowTo } from './pet'
import { clientState, pushToast } from './state'
import { ui } from './ui'

// Placed in the editor (models/tree.glb). Not read from EntityNames because that
// enum is regenerated from the composite and this entity is newer than the copy
// on disk — the Name in the hierarchy is the contract either way.
const TREE_NAME = 'tree'
const TREE_RADIUS = 12 // metres: how close you must be for the tree to accept a click
const TREE_CLICK_DISTANCE = TREE_RADIUS + 4 // pointer maxDistance, slightly looser than the gate

let active = false
let clickable = false

function treeEntity(): Entity | null {
  const e = engine.getEntityOrNullByName(TREE_NAME)
  if (!e || !Transform.has(e)) return null
  return e
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
  if (active) {
    pushToast('Head to the tree — follow the arrow!')
    return
  }
  const tree = treeEntity()
  if (!tree) {
    console.log('[Client] feed task: tree not found in scene:', TREE_NAME)
    return
  }
  active = true
  showArrowTo(Transform.get(tree).position)
  clientState.petPanelOpen = false // the panel covers the screen; the errand is out in the world
  pushToast('Follow the arrow to the tree!')
}

/** Drop the errand (arrow off, tree no longer clickable). */
export function cancelFeedTask(): void {
  if (!active) return
  active = false
  setClickable(false)
  hideArrow()
}

export function feedTaskActive(): boolean {
  return active
}

/** The tree only carries a pointer handler while the errand is live AND you're
 *  standing at it — otherwise its hover text would show at all times. */
function setClickable(on: boolean): void {
  if (on === clickable) return
  const tree = treeEntity()
  if (!tree) return
  clickable = on
  if (on) {
    pointerEventsSystem.onPointerDown({ entity: tree, opts: { button: InputAction.IA_POINTER, hoverText: 'Collect fruits!', maxDistance: TREE_CLICK_DISTANCE } }, onTreeClicked)
  } else {
    pointerEventsSystem.removeOnPointerDown(tree)
  }
}

function onTreeClicked(): void {
  if (!active) return
  const petId = clientState.activePet ? clientState.activePet.id : ''
  active = false
  setClickable(false)
  hideArrow() // errand done — the indicator goes away on the click
  startFeedingGame(petId)
}

/** Hand-off point for the feeding mini-game (not built yet). */
export function startFeedingGame(mascotaId: string): void {
  console.log(`feed game started for ${mascotaId}`)
}

export function setupFeedTask(): void {
  engine.addSystem(() => {
    if (!active) return
    const tree = treeEntity()
    if (!tree) return
    const pos = Transform.get(tree).position
    showArrowTo(pos) // re-assert each frame, same as the egg carry does
    setClickable(distFlat(playerPos(), pos) <= TREE_RADIUS)
  })
}
