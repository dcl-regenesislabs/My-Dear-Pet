// Martian space scene — ported from the `skybox-test` project.
//
// Everything here is created by code (not placed in the Creator Hub): the ground,
// the skybox sphere, the "here" anchor marker, the 4 boundary planes, and the
// system that makes the sphere follow the camera 1:1 (so the sky feels infinite
// instead of close) plus a slow rotation.
//
// The gameplay area (Bowl/Bed/Ball/Pond/Caretaker/Shop) was moved in
// `main.composite` to sit around the "here" anchor below — see `shared/config.ts`.

import {
  engine,
  Transform,
  MeshCollider,
  GltfContainer,
  ColliderLayer,
  Entity,
  inputSystem,
  InputAction,
  PointerEventType
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'

// --- Configuration (positions copied verbatim from skybox-test's main.composite —
// My Dear Pet now uses the same 30x30 parcel layout, so no translation is needed). ---

const GROUND_POSITION = Vector3.create(220.5, 14, 235.75)
const GROUND_SCALE = Vector3.create(1.3, 1.3, 1.3)
const SKYBOX_POSITION = Vector3.create(200.5, -3.5, 232.25)

// The empty "here" anchor entity — the center of the relocated gameplay area.
const HERE_POSITION = Vector3.create(204.5, 1, 241)

interface PlaneDef {
  x: number
  y: number
  z: number
  scale: Vector3
  rotation: Quaternion
}

const BOUNDARY_PLANES: PlaneDef[] = [
  { x: 217.25, y: 18, z: 371.25, scale: Vector3.create(300, 30, 1), rotation: Quaternion.Identity() },
  { x: 67.25, y: 18, z: 221.5, scale: Vector3.create(30, 300, 1), rotation: Quaternion.create(-0.5, -0.5, 0.5, 0.5) },
  { x: 217.25, y: 18, z: 71.5, scale: Vector3.create(300, 30, 1), rotation: Quaternion.Identity() },
  { x: 367.25, y: 18, z: 221.5, scale: Vector3.create(30, 300, 1), rotation: Quaternion.create(-0.5, -0.5, 0.5, 0.5) }
]

const SKYBOX_ROTATION_DEG_PER_SEC = 360 / (4 * 60 * 60)

let skyboxRoot: Entity | null = null

export function setupSkybox() {
  createGroundAndSkybox()
  createHereMarker()
  createBoundaryPlanes()

  engine.addSystem(skyboxAnimSystem, 1, 'SkyboxAnimSystem')
  engine.addSystem(heightTeleportSystem, 1, 'HeightTeleportSystem')
}

// Key "1" (InputAction.IA_ACTION_3) -> teleport to 5m height, at the same X/Z
// you're standing on. Dev shortcut while the mars ground can't be walked on
// properly / to quickly get up and test the skybox.
const TELEPORT_HEIGHT = 5

function heightTeleportSystem() {
  if (inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN)) {
    const currentPosition = Transform.get(engine.PlayerEntity).position
    movePlayerTo({
      newRelativePosition: Vector3.create(currentPosition.x, TELEPORT_HEIGHT, currentPosition.z)
    })
  }
}

function createGroundAndSkybox() {
  const ground = engine.addEntity()
  Transform.create(ground, { position: GROUND_POSITION, scale: GROUND_SCALE })
  GltfContainer.create(ground, {
    src: 'assets/scene/Models/mars_ground/mars_ground.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS,
    invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS
  })

  const sky = engine.addEntity()
  Transform.create(sky, { position: SKYBOX_POSITION })
  GltfContainer.create(sky, { src: 'assets/scene/Models/skybox_80m/skybox_80m.glb' })

  skyboxRoot = sky
}

// Just a reference point for the offset math in shared/config.ts — no visual,
// no collider, so it doesn't block the player walking through the care area.
function createHereMarker() {
  const here = engine.addEntity()
  Transform.create(here, { position: HERE_POSITION })
}

function createBoundaryPlanes() {
  for (const def of BOUNDARY_PLANES) {
    const plane = engine.addEntity()
    Transform.create(plane, {
      position: Vector3.create(def.x, def.y, def.z),
      scale: def.scale,
      rotation: def.rotation
    })
    MeshCollider.setPlane(plane, ColliderLayer.CL_PHYSICS)
  }
}

function skyboxAnimSystem(dt: number) {
  if (!skyboxRoot) return

  const rootTransform = Transform.getMutable(skyboxRoot)

  const cameraTransform = Transform.getOrNull(engine.CameraEntity)
  if (cameraTransform) {
    rootTransform.position = cameraTransform.position
  }

  const spin = Quaternion.fromAngleAxis(SKYBOX_ROTATION_DEG_PER_SEC * dt, Vector3.Up())
  rootTransform.rotation = Quaternion.multiply(rootTransform.rotation, spin)
}
