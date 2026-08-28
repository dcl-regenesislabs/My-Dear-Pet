// Sets up the Caretaker: a click collider (a simple invisible box parented to
// the model, same pattern used for NPCs elsewhere — the GLTF mesh's own
// collision isn't reliable to click on) and Idle/Talk animation clip switching
// based on whether its dialog is currently open.

import { engine, Entity, Transform, Animator, MeshCollider, ColliderLayer, pointerEventsSystem, InputAction, InputModifier } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { EntityNames } from '../../assets/scene/entity-names'
import { clientState } from './state'
import { ui } from './ui'

// Clip names as authored on the Caretaker.glb / auto-populated by the Creator
// Hub's Animator (assets/scene/main.composite) — case-sensitive.
const CLIP_IDLE = 'Idle'
const CLIP_TALK = 'Talk'

let curClip: string | null = null

function setClip(e: Entity, clip: string): void {
  if (curClip === clip) return
  curClip = clip
  const a = Animator.getMutable(e)
  for (const s of a.states) s.playing = s.clip === clip
}

let colliderSet = false

// Desired collider size/offset in WORLD units (roughly wraps a standing
// character). The collider is a CHILD of the Caretaker, so its local
// position/scale get multiplied by the Caretaker's own Transform.scale —
// divided out below so the box stays this size regardless of how the model
// itself is scaled in the composite.
const COLLIDER_WORLD_OFFSET_Y = 1.0
const COLLIDER_WORLD_SIZE = Vector3.create(0.6, 2.0, 0.6)

/** Click collider — a plain invisible box parented to the Caretaker, same as the
 *  NPC click-collider pattern (cozy-farm's npcSystem.ts). The GLTF's own
 *  visibleMeshesCollisionMask is physics-only (see main.composite) so this box
 *  is the only CL_POINTER collider — otherwise the pointer raycast hits the
 *  (handler-less) mesh first and the click never reaches this collider at all.
 *  showHighlight is off: the default hover outline follows this box's own shape
 *  (not the model), which looked wrong, so it's disabled rather than styled. */
function ensureClickCollider(caretaker: Entity): void {
  if (colliderSet) return
  colliderSet = true
  const parentScale = Transform.get(caretaker).scale
  const collider = engine.addEntity()
  Transform.create(collider, {
    parent: caretaker,
    position: Vector3.create(0, COLLIDER_WORLD_OFFSET_Y / parentScale.y, 0),
    scale: Vector3.create(COLLIDER_WORLD_SIZE.x / parentScale.x, COLLIDER_WORLD_SIZE.y / parentScale.y, COLLIDER_WORLD_SIZE.z / parentScale.z)
  })
  MeshCollider.setBox(collider, ColliderLayer.CL_POINTER)
  pointerEventsSystem.onPointerDown(
    { entity: collider, opts: { button: InputAction.IA_POINTER, hoverText: 'Talk to Caretaker', maxDistance: 16, showHighlight: false } },
    () => ui.openCaretaker()
  )
}

// Mandatory placement for the first-time intro: the native SceneMetadata
// spawn point only orients the CAMERA (cameraTarget), not the avatar's own
// facing — the two can end up pointing different ways, and the random
// position range means it's not the exact same spot every reload either.
// movePlayerTo's cameraTarget rotates both, so this deterministically drops
// the player at the spawn area's center facing the Caretaker (matching the
// spawn point's own cameraTarget in main.composite) every single time, then
// freezes them until they've finished talking (setup.ts's showIntro).
const INTRO_SPAWN_POS = Vector3.create(155.9199981689453, 0, 247.05999755859375)
// The Caretaker's OLD position (before it got moved further along its own
// facing direction) — kept as the look-at anchor on purpose, per request.
const INTRO_LOOK_AT = Vector3.create(153.5, 1.5, 247.25)

let introLockActive = false

export function startCaretakerIntroLock(): void {
  void movePlayerTo({ newRelativePosition: INTRO_SPAWN_POS, cameraTarget: INTRO_LOOK_AT })
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  introLockActive = true
}

/** Release the freeze once the intro dialog closes. */
export function endCaretakerIntroLock(): void {
  introLockActive = false
  if (InputModifier.has(engine.PlayerEntity)) InputModifier.deleteFrom(engine.PlayerEntity)
}

/** setup.ts's loading-gate unfreeze fires the moment serverReady flips true —
 *  the SAME message handler that starts this lock — so it must check this
 *  before blindly deleting InputModifier, or it wipes the freeze we just set
 *  a few lines earlier in the same handler. */
export function isCaretakerIntroLocked(): boolean {
  return introLockActive
}

export function setupCaretaker(): void {
  engine.addSystem(() => {
    const e = engine.getEntityOrNullByName(EntityNames.Caretaker_glb)
    if (!e || !Transform.has(e)) return // not loaded yet
    ensureClickCollider(e)
    if (Animator.has(e)) {
      const talking = clientState.dialog.open && clientState.dialog.npcName === 'Caretaker'
      setClip(e, talking ? CLIP_TALK : CLIP_IDLE)
    }
  })
}
