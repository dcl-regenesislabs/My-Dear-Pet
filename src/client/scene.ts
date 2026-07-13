// Static scene decor: models placed once on client load. These are not pets and
// are not networked — just fixed set-dressing. Tweak the constants below to
// reposition / resize without touching the spawn logic.

import { engine, Transform, GltfContainer, ColliderLayer } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'

// Pigeon dome — adjust to taste (meters; scene is 160x160, base 0,0).
const PIGEON_DOME = {
  src: 'assets/scene/Models/PetPig/pigeon_dome_scene.glb',
  position: Vector3.create(16, 0, 16),
  rotationDeg: Vector3.create(0, 0, 0),
  scale: Vector3.create(1, 1, 1)
}

export function setupScene(): void {
  const dome = engine.addEntity()
  Transform.create(dome, {
    position: PIGEON_DOME.position,
    rotation: Quaternion.fromEulerDegrees(PIGEON_DOME.rotationDeg.x, PIGEON_DOME.rotationDeg.y, PIGEON_DOME.rotationDeg.z),
    scale: PIGEON_DOME.scale
  })
  GltfContainer.create(dome, {
    src: PIGEON_DOME.src,
    // Solid walls/floor so the player collides with the structure.
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS
  })
}
