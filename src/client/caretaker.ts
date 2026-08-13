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

/** Click collider — a plain invisible box parented to the Caretaker, same as the
 *  NPC click-collider pattern (cozy-farm's npcSystem.ts). showHighlight is off:
 *  the default hover outline follows this box's own shape (not the model), which
 *  looked wrong, so it's disabled rather than styled. Tune position/scale once
 *  you see the box against the actual model. */
function ensureClickCollider(caretaker: Entity): void {
  if (colliderSet) return
  colliderSet = true
  const collider = engine.addEntity()
  Transform.create(collider, { parent: caretaker, position: Vector3.create(0, 1.0, 0), scale: Vector3.create(0.6, 2.0, 0.6) })
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
