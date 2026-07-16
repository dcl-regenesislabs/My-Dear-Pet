// Martian space scene — ported from the `skybox-test` project.
//
// Everything here is created by code (not placed in the Creator Hub): the ground,
// the skybox sphere, the "here" anchor marker, the 4 boundary planes, the nebula
// cloud billboards, the invisible player-bubble collider, and the systems that
// make the sphere + clouds follow the camera 1:1 (so the sky feels infinite
// instead of close) plus a slow rotation.
//
// The gameplay area (Bowl/Bed/Ball/Pond/Caretaker/Shop) was moved in
// `main.composite` to sit around the "here" anchor below — see `shared/config.ts`.

import {
  engine,
  Transform,
  MeshRenderer,
  MeshCollider,
  Material,
  Billboard,
  BillboardMode,
  MaterialTransparencyMode,
  GltfContainer,
  ColliderLayer,
  VisibilityComponent,
  Entity,
  inputSystem,
  InputAction,
  PointerEventType
} from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'

// --- Configuration (positions copied verbatim from skybox-test's main.composite —
// My Dear Pet now uses the same 30x30 parcel layout, so no translation is needed). ---

const GROUND_POSITION = Vector3.create(220.5, 14, 235.75)
const GROUND_SCALE = Vector3.create(1.3, 1.3, 1.3)
const SKYBOX_POSITION = Vector3.create(200.5, -3.5, 232.25)

// The empty "here" anchor entity — the center of the relocated gameplay area.
const HERE_POSITION = Vector3.create(204.5, 1, 241)

// The player-bubble collider is centered on "here" (the real ground/gameplay
// center) — skybox-test itself had this pointing at a stale (160,0,160), which
// didn't match its actual ground position. Fixed here.
const BUBBLE_CENTER = HERE_POSITION

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

const SKYBOX_RADIUS = 40
const BLENDER_REFERENCE_RADIUS = 500
const SCALE_RATIO = SKYBOX_RADIUS / BLENDER_REFERENCE_RADIUS

const PLAYER_BUBBLE_RADIUS = 30

const SKYBOX_ROTATION_DEG_PER_SEC = 360 / (4 * 60 * 60)

const BILLBOARD_SIZE_FACTOR = 0.22

const TINT_COLORS: Record<string, { r: number; g: number; b: number }> = {
  purple: { r: 0.55, g: 0.30, b: 0.68 },
  teal: { r: 0.20, g: 0.45, b: 0.60 },
  pink: { r: 0.70, g: 0.35, b: 0.55 },
  blue: { r: 0.25, g: 0.35, b: 0.75 }
}

interface BillboardDef {
  x: number
  y: number
  z: number
  size: number
  tint: string
}

const NEBULA_BILLBOARDS: BillboardDef[] = [
  { x: 62.84, y: 319.68, z: 236.37, size: 111.75, tint: 'teal' },
  { x: -35.3, y: 161.22, z: -175.6, size: 90.61, tint: 'purple' },
  { x: -271.0, y: 191.36, z: -246.58, size: 76.5, tint: 'blue' },
  { x: -292.9, y: 72.33, z: 209.1, size: 46.0, tint: 'pink' },
  { x: -192.68, y: 272.97, z: 40.87, size: 36.86, tint: 'teal' },
  { x: -65.57, y: 153.88, z: 199.03, size: 38.53, tint: 'teal' },
  { x: 97.66, y: 126.3, z: -226.65, size: 97.51, tint: 'purple' },
  { x: -44.36, y: 178.0, z: 54.96, size: 122.7, tint: 'blue' },
  { x: -34.61, y: 188.93, z: -33.83, size: 81.02, tint: 'pink' },
  { x: 77.16, y: 102.79, z: 185.01, size: 82.12, tint: 'blue' },
  { x: -185.52, y: 175.24, z: -98.2, size: 65.27, tint: 'purple' },
  { x: 203.33, y: 332.86, z: 33.18, size: 67.93, tint: 'pink' },
  { x: 67.39, y: 38.36, z: 181.49, size: 75.73, tint: 'teal' },
  { x: 206.71, y: 196.59, z: 232.69, size: 73.67, tint: 'teal' },
  { x: 161.27, y: 64.72, z: -152.39, size: 70.68, tint: 'teal' },
  { x: 158.36, y: 209.67, z: -128.94, size: 73.71, tint: 'blue' },
  { x: 283.43, y: 72.72, z: 119.75, size: 38.3, tint: 'teal' },
  { x: -220.53, y: 106.34, z: -323.33, size: 128.43, tint: 'blue' },
  { x: -257.43, y: 117.67, z: 304.37, size: 80.51, tint: 'teal' },
  { x: 121.27, y: 62.68, z: -306.58, size: 108.41, tint: 'blue' },
  { x: 296.03, y: 227.62, z: 34.17, size: 61.22, tint: 'purple' },
  { x: -179.4, y: 210.05, z: 155.58, size: 65.99, tint: 'teal' },
  { x: 20.72, y: 236.25, z: 97.12, size: 126.08, tint: 'teal' },
  { x: 246.92, y: 181.38, z: -75.51, size: 77.45, tint: 'teal' },
  { x: -106.77, y: 195.23, z: -103.39, size: 124.5, tint: 'blue' },
  { x: -28.79, y: 174.63, z: 135.65, size: 70.89, tint: 'purple' },
  { x: -147.16, y: 216.61, z: -49.91, size: 123.27, tint: 'blue' },
  { x: -9.74, y: 58.33, z: 190.44, size: 102.59, tint: 'pink' },
  { x: 75.29, y: 285.7, z: -143.77, size: 49.84, tint: 'pink' },
  { x: -331.42, y: 196.23, z: 159.36, size: 86.81, tint: 'purple' }
]

let skyboxRoot: Entity | null = null

export function setupSkybox() {
  createGroundAndSkybox()
  createHereMarker()
  createBoundaryPlanes()
  // createPlayerBubbleCollider() disabled — the dome mesh blocks the player from
  // outside-in instead of just containing them inside, so it walls off the whole
  // care area instead of only capping how far out you can wander.
  createSkyboxAndClouds()

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

function createPlayerBubbleCollider() {
  const scale = PLAYER_BUBBLE_RADIUS / 0.5
  const dome = engine.addEntity()
  GltfContainer.create(dome, {
    src: 'assets/asset-packs/invisible_dome/invisible_semisphere.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })
  VisibilityComponent.create(dome, { visible: false })
  Transform.create(dome, {
    position: BUBBLE_CENTER,
    scale: Vector3.create(scale, scale, scale)
  })
}

function createSkyboxAndClouds() {
  if (!skyboxRoot) return
  const root = skyboxRoot

  for (let i = 0; i < NEBULA_BILLBOARDS.length; i++) {
    const def = NEBULA_BILLBOARDS[i]
    const cloud = engine.addEntity()

    MeshRenderer.setPlane(cloud)

    const s = def.size * BILLBOARD_SIZE_FACTOR * SCALE_RATIO
    Transform.create(cloud, {
      position: Vector3.create(def.x * SCALE_RATIO, def.y * SCALE_RATIO, def.z * SCALE_RATIO),
      scale: Vector3.create(s, s, s),
      parent: root
    })

    const tint = TINT_COLORS[def.tint] ?? TINT_COLORS.purple

    Material.setPbrMaterial(cloud, {
      texture: Material.Texture.Common({ src: 'assets/skybox/cloud_sprite.png' }),
      albedoColor: Color4.create(tint.r, tint.g, tint.b, 1),
      emissiveColor: Color3.create(tint.r, tint.g, tint.b),
      emissiveIntensity: 2.6,
      metallic: 0,
      roughness: 1,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
    })

    Billboard.create(cloud, { billboardMode: BillboardMode.BM_ALL })
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
