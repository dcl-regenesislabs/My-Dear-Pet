// Placeholder plane — a flat quad dropped in the middle of the play area so you
// can position it wherever it needs to go. Tweak POSITION / SCALE / ROTATION
// below (or move it in the Creator Hub once placed).

import { engine, Transform, MeshRenderer, Material } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'

const PLANE_POSITION = Vector3.create(167.899, 2.4, 250)
const PLANE_SCALE = Vector3.create(7, 3.4, 1)
const PLANE_ROTATION = Quaternion.fromEulerDegrees(0, 78.396, 0)
const PLANE_COLOR = Color4.create(0.08, 0.08, 0.09, 1) // very dark grey

export function setupPlane(): void {
  const plane = engine.addEntity()
  Transform.create(plane, { position: PLANE_POSITION, scale: PLANE_SCALE, rotation: PLANE_ROTATION })
  MeshRenderer.setPlane(plane)
  Material.setPbrMaterial(plane, { albedoColor: PLANE_COLOR })
}
