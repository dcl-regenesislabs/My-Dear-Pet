// Sets up the Caretaker: a click collider (a simple invisible box parented to
// the model, same pattern used for NPCs elsewhere — the GLTF mesh's own
// collision isn't reliable to click on) and Idle/Talk animation clip switching
// based on whether its dialog is currently open.

import { engine, Entity, Transform, Animator, MeshCollider, ColliderLayer, pointerEventsSystem, InputAction } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
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
