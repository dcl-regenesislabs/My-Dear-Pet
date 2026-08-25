// Feed tree minigame (hand-off from feed.ts once the walk-to-tree errand
// reaches the tree — no click needed). Short cinematic (freeze, camera cut,
// "hands up" pose) then fruit fall from the canopy one per slot; walk
// left/right to catch them before they land. Hunger restored at the end
// scales with how many were caught (sim.ts's applyFeedMinigameLocal /
// server/state.ts's feedFromMinigame).

import {
  engine,
  Entity,
  Transform,
  GltfContainer,
  ColliderLayer,
  VisibilityComponent,
  Tween,
  tweenSystem,
  EasingFunction,
  VirtualCamera,
  MainCamera,
  InputModifier,
  AvatarMask,
  AvatarAttach,
  AvatarAnchorPointType
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { movePlayerTo, triggerSceneEmote } from '~system/RestrictedActions'
import * as RestrictedActions from '~system/RestrictedActions'
import { EntityNames } from '../../assets/scene/entity-names'
import { actions, clientState, pushToast } from './state'
import { applyFeedMinigameLocal } from './sim'

const FRUIT_MODELS = [
  'assets/Models/Fruit01.glb',
  'assets/Models/Fruit02.glb',
  'assets/Models/Fruit03.glb',
  'assets/Models/Fruit04.glb',
  'assets/Models/Fruit05.glb'
]
const NUM_FRUIT_SLOTS = 5

// Invisible walls placed in the composite (assets/asset-packs/invisible_wall)
// penning the player into the catch lane: lane_1/lane_2 are the long front/back
// walls (block wandering toward/away from the camera), lane_3/lane_4 are the
// short end-caps (block wandering past the left/right extremes). They ship
// with collision off in the composite — toggled on only while catching.
const LANE_ENTITY_NAMES = [EntityNames.lane_1, EntityNames.lane_2, EntityNames.lane_3, EntityNames.lane_4]

// GltfContainer defaults to CL_POINTER | CL_PHYSICS when unset — without this,
// every fruit (and the held drawer, which follows the player everywhere) is a
// solid physics body, which for the drawer means a collider wall glued to the
// avatar that blocks its own movement.
const NO_COLLISION = { visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE }

const GAME_DURATION_S = 30
const FALL_DURATION_MS = 1800
const MIN_HANG_S = 1.2
const MAX_HANG_S = 2.5
const RESPAWN_DELAY_S = 0.8
const CATCH_RADIUS = 1.1 // metres, flat XZ
const CATCH_MIN_Y = 0.2 // above ground
const CATCH_MAX_Y = 2.4

// Freeze -> emote -> release timeline (seconds since the intro began). Copied
// from the prototype's tuned pacing.
const INTRO_EMOTE_AT_S = 0.9
const INTRO_RELEASE_AT_S = 3.1

// Geometry: invisible marker entities placed in the Creator Hub composite
// (next to the tree) drive all of this — no geometry is derived from the
// tree's own transform/rotation:
//  - "cinematic_point": the camera's fixed position.
//  - "cinematic_play_spawnpoint": where the player is snapped to stand, and
//    the ground anchor the fruit canopy is centered above (NOT the tree's
//    trunk — the canopy follows the spawnpoint).
//  - "lane_3"/"lane_4": the lane's short end-cap walls — the line between
//    them IS the true walkable width, so the canopy's left/right span and
//    center are measured directly from their real positions instead of a
//    guessed constant (a fixed guess kept landing fruit outside the actual
//    lane on one side).
// The player is turned to face cinematic_point on arrival (movePlayerTo's
// cameraTarget); the camera looks up at the canopy area above the spawnpoint,
// not at ground level, so both the avatar and the falling fruit stay framed.
const CANOPY_HEIGHT = 8.75 // above the spawnpoint — where fruit hangs/falls from
const CAMERA_LOOK_HEIGHT = 4.2 // above the spawnpoint — independent of CANOPY_HEIGHT, so raising the drop height doesn't tilt the shot up too
const LANE_END_MARGIN = 1.0 // metres inset from each end-cap wall, so fruit don't spawn right against them
const CANOPY_DEPTH = 0.6 // half-depth, narrow so it reads as one lane

// Same "hold" pose/asset pet.ts uses for carrying the pet to the bath — a
// two-handed cradling pose, better suited to holding the drawer than the
// egg-carry emote.
const HOLD_EMOTE = 'models/hold_pet_emote.glb'

// Crate held in both hands for the round, same AvatarAttach approach pet.ts
// uses for carrying the pet (a two-handed object cradled at the belly). Offset
// and scale are eyeballed — nudge against the actual rig in-world as needed.
const DRAWER_MODEL = 'assets/asset-packs/drawer_2/Drawer 2.glb'
const DRAWER_HOLD_OFFSET = Vector3.create(0.22, 0, 0.2)
const DRAWER_HOLD_SCALE = 0.9

type FruitPhase = 'idle' | 'falling' | 'resolved'
interface FruitRuntime {
  entity: Entity
  phase: FruitPhase
  nextDropAt: number
  resolvedAt: number
}

type Phase = 'idle' | 'intro' | 'catching'
let phase: Phase = 'idle'
let phaseAt = 0
let clock = 0
let introEmotePlayed = false

const fruits: FruitRuntime[] = []
let gameCam: Entity | null = null
let drawerAnchor: Entity | null = null
let drawerEntity: Entity | null = null

let groundY = 0
let canopyCenter = Vector3.Zero()
let canopyHalfWidth = 4.0 // overwritten from the lane_3/lane_4 gap each game
let localRight = Vector3.create(1, 0, 0)
let localForward = Vector3.create(0, 0, 1)

// Movement-tolerant re-apply for the masked "hold" emote — some clients cancel
// a masked emote on movement with no lifecycle event to detect it. Same fix
// pet.ts uses for the egg-carry pose: re-trigger right when the player
// transitions from moving to stopped.
let carryPrevPos: Vector3 | null = null
let carryMoving = false

function playerPos(): Vector3 {
  const t = Transform.getOrNull(engine.PlayerEntity)
  return t ? t.position : Vector3.Zero()
}

function distFlat(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

function playHoldEmote(): void {
  void triggerSceneEmote({ src: HOLD_EMOTE, loop: true, mask: AvatarMask.AM_UPPER_BODY }).catch(() => {})
}

/** Guarded: not every client implements stopEmote (see pet.ts's stopHoldEmote). */
function stopHoldEmote(): void {
  if (typeof RestrictedActions.stopEmote === 'function') {
    void RestrictedActions.stopEmote({}).catch(() => {})
  }
}

/** Turn the lane's invisible walls solid (catching) or back off (everywhere else). */
function setLaneColliders(on: boolean): void {
  for (const name of LANE_ENTITY_NAMES) {
    const e = engine.getEntityOrNullByName(name)
    if (!e || !GltfContainer.has(e)) continue
    GltfContainer.getMutable(e).visibleMeshesCollisionMask = on ? ColliderLayer.CL_PHYSICS : ColliderLayer.CL_NONE
  }
}

function randomFruitModel(): string {
  return FRUIT_MODELS[Math.floor(Math.random() * FRUIT_MODELS.length)]
}

function randomCanopySpot(): Vector3 {
  const rightOff = (Math.random() * 2 - 1) * canopyHalfWidth
  const fwdOff = (Math.random() * 2 - 1) * CANOPY_DEPTH
  return Vector3.create(
    canopyCenter.x + localRight.x * rightOff + localForward.x * fwdOff,
    canopyCenter.y,
    canopyCenter.z + localRight.z * rightOff + localForward.z * fwdOff
  )
}

function armFruit(f: FruitRuntime): void {
  f.phase = 'idle'
  f.nextDropAt = clock + MIN_HANG_S + Math.random() * (MAX_HANG_S - MIN_HANG_S)
}

function startFall(f: FruitRuntime): void {
  const start = Transform.get(f.entity).position
  const end = Vector3.create(start.x, groundY, start.z)
  Tween.createOrReplace(f.entity, {
    mode: Tween.Mode.Move({ start, end }),
    duration: FALL_DURATION_MS,
    easingFunction: EasingFunction.EF_EASEINQUAD
  })
  f.phase = 'falling'
}

function resolveFruit(f: FruitRuntime, caught: boolean): void {
  Tween.deleteFrom(f.entity)
  VisibilityComponent.createOrReplace(f.entity, { visible: false })
  if (caught) {
    clientState.feedGame.caught += 1
    clientState.feedGame.catchFlashUntil = Date.now() + 350
  }
  f.phase = 'resolved'
  f.resolvedAt = clock
}

function fruitTick(): void {
  const pp = playerPos()
  for (const f of fruits) {
    if (f.phase === 'idle') {
      if (clock >= f.nextDropAt) startFall(f)
      continue
    }
    if (f.phase === 'falling') {
      const pos = Transform.get(f.entity).position
      const inCatchBand = pos.y >= groundY + CATCH_MIN_Y && pos.y <= groundY + CATCH_MAX_Y
      if (inCatchBand && distFlat(pp, pos) <= CATCH_RADIUS) {
        resolveFruit(f, true)
      } else if (tweenSystem.tweenCompleted(f.entity)) {
        resolveFruit(f, false)
      }
      continue
    }
    if (f.phase === 'resolved' && clock - f.resolvedAt >= RESPAWN_DELAY_S) {
      Transform.getMutable(f.entity).position = randomCanopySpot()
      GltfContainer.createOrReplace(f.entity, { src: randomFruitModel(), ...NO_COLLISION })
      VisibilityComponent.createOrReplace(f.entity, { visible: true })
      armFruit(f)
    }
  }
}

function updateHoldPose(): void {
  const pp = playerPos()
  if (carryPrevPos) {
    const moving = distFlat(pp, carryPrevPos) > 0.02
    if (carryMoving && !moving) playHoldEmote() // just stopped -> re-apply the pose
    carryMoving = moving
  }
  carryPrevPos = Vector3.create(pp.x, pp.y, pp.z)
}

function introTick(): void {
  const elapsed = clock - phaseAt
  if (!introEmotePlayed && elapsed >= INTRO_EMOTE_AT_S) {
    playHoldEmote()
    introEmotePlayed = true
  }
  if (elapsed >= INTRO_RELEASE_AT_S) {
    // Swap the full freeze for a lighter lock: free to walk/run the lane, but
    // no jumping or gliding out of it.
    InputModifier.createOrReplace(engine.PlayerEntity, {
      mode: InputModifier.Mode.Standard({ disableJump: true, disableDoubleJump: true, disableGliding: true })
    })
    setLaneColliders(true) // pen the player into the catch lane now that they can move
    for (const f of fruits) armFruit(f)
    phase = 'catching'
    phaseAt = clock
    clientState.feedGame.phase = 'catching'
  }
}

function endFruitGame(): void {
  const caught = clientState.feedGame.caught
  if (MainCamera.has(engine.CameraEntity)) MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
  if (InputModifier.has(engine.PlayerEntity)) InputModifier.deleteFrom(engine.PlayerEntity)
  stopHoldEmote()
  setLaneColliders(false)
  if (drawerEntity) VisibilityComponent.getMutable(drawerEntity).visible = false
  for (const f of fruits) {
    Tween.deleteFrom(f.entity)
    VisibilityComponent.createOrReplace(f.entity, { visible: false })
    f.phase = 'idle'
  }
  clientState.feedGame.active = false
  phase = 'idle'
  carryPrevPos = null
  carryMoving = false
  if (caught > 0) {
    applyFeedMinigameLocal(caught) // optimistic local effect
    actions.feedResult(caught) // tell the server (it corrects via snapshot)
    pushToast(`Caught ${caught} fruit${caught === 1 ? '' : 's'}!`)
  }
}

/** Bail out early (Back button) — submits whatever was caught so far, same as a natural timeout. */
export function cancelFruitGame(): void {
  if (phase === 'idle') return
  endFruitGame()
}

function tick(dt: number): void {
  clock += dt
  if (phase === 'intro') {
    introTick()
  } else if (phase === 'catching') {
    fruitTick()
    updateHoldPose()
    const st = clientState.feedGame
    st.timeLeft = Math.max(0, st.timeLeft - dt)
    if (st.timeLeft <= 0) endFruitGame()
  }
}

/** Spawn the (initially hidden) fruit pool once and start the module's system. */
export function setupFruitGame(): void {
  for (let i = 0; i < NUM_FRUIT_SLOTS; i++) {
    const entity = engine.addEntity()
    Transform.create(entity, { position: Vector3.Zero() })
    GltfContainer.create(entity, { src: FRUIT_MODELS[i % FRUIT_MODELS.length], ...NO_COLLISION })
    VisibilityComponent.create(entity, { visible: false })
    fruits.push({ entity, phase: 'idle', nextDropAt: 0, resolvedAt: 0 })
  }

  drawerAnchor = engine.addEntity()
  Transform.create(drawerAnchor, {})
  AvatarAttach.create(drawerAnchor, { anchorPointId: AvatarAnchorPointType.AAPT_SPINE })
  drawerEntity = engine.addEntity()
  Transform.create(drawerEntity, { parent: drawerAnchor, position: DRAWER_HOLD_OFFSET, scale: Vector3.scale(Vector3.One(), DRAWER_HOLD_SCALE) })
  GltfContainer.create(drawerEntity, { src: DRAWER_MODEL, ...NO_COLLISION })
  VisibilityComponent.create(drawerEntity, { visible: false })

  engine.addSystem(tick)
}

/** Hand-off once the walk-to-tree errand arrives: freeze + camera cut + "hands
 *  up" reveal, then the timed fruit-catching round. mascotaId is accepted for
 *  parity with the errand's hand-off signature; the effect always targets the
 *  current active pet. */
export function startFruitGame(mascotaId: string): void {
  if (phase !== 'idle') return
  if (clientState.petting.active || clientState.hatch.active || clientState.carryPet.active) return
  // Fixed camera spot placed in the Creator Hub composite, next to the tree.
  const cinePoint = engine.getEntityOrNullByName(EntityNames.cinematic_point)
  if (!cinePoint || !Transform.has(cinePoint)) {
    console.log('[Client] fruit game: cinematic_point not found in scene')
    return
  }
  // Where the player stands; the canopy's depth-center follows this too.
  const spawnPoint = engine.getEntityOrNullByName(EntityNames.cinematic_play_spawnpoint)
  if (!spawnPoint || !Transform.has(spawnPoint)) {
    console.log('[Client] fruit game: cinematic_play_spawnpoint not found in scene')
    return
  }
  // The lane's end-cap walls — the real, measured left/right bounds.
  const lane3 = engine.getEntityOrNullByName(EntityNames.lane_3)
  const lane4 = engine.getEntityOrNullByName(EntityNames.lane_4)
  if (!lane3 || !lane4 || !Transform.has(lane3) || !Transform.has(lane4)) {
    console.log('[Client] fruit game: lane end-cap markers not found in scene')
    return
  }
  console.log('[Client] fruit game started for', mascotaId)

  const camPos = Transform.get(cinePoint).position
  const spawnPos = Transform.get(spawnPoint).position
  const p3 = Transform.get(lane3).position
  const p4 = Transform.get(lane4).position
  groundY = spawnPos.y

  // "Forward" (the narrow depth axis) still comes from the camera's own view
  // direction — that's what reads as "toward/away from camera" on screen.
  // "Right" (the wide axis fruit actually spread along) comes from the real
  // line between the two end-cap walls, so the canopy's width and center are
  // measured, not guessed.
  const viewDir = Vector3.normalize(Vector3.create(spawnPos.x - camPos.x, 0, spawnPos.z - camPos.z))
  localForward = viewDir
  const rightRef = Vector3.create(-viewDir.z, 0, viewDir.x)
  let laneSpan = Vector3.create(p4.x - p3.x, 0, p4.z - p3.z)
  if (Vector3.dot(laneSpan, rightRef) < 0) laneSpan = Vector3.create(-laneSpan.x, 0, -laneSpan.z)
  const laneWidth = Vector3.length(laneSpan)
  localRight = Vector3.normalize(laneSpan)
  canopyHalfWidth = Math.max(0.5, laneWidth / 2 - LANE_END_MARGIN)

  canopyCenter = Vector3.create(
    (p3.x + p4.x) / 2,
    groundY + CANOPY_HEIGHT,
    (p3.z + p4.z) / 2
  )

  // Snap the player to the spawnpoint and face them at cinematic_point (so
  // their front — not their back — is what the camera sees).
  void movePlayerTo({ newRelativePosition: spawnPos, cameraTarget: camPos })

  if (!gameCam) gameCam = engine.addEntity()
  // Look toward the play area (avatar + catch zone), not straight down at
  // ground level — but not all the way up at the fruit's hang height either.
  const lookTarget = Vector3.create(spawnPos.x, groundY + CAMERA_LOOK_HEIGHT, spawnPos.z)
  Transform.createOrReplace(gameCam, { position: camPos, rotation: Quaternion.fromLookAt(camPos, lookTarget) })
  VirtualCamera.createOrReplace(gameCam, {})
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: gameCam })

  // Movement-only lock, NOT disableAll: disableAll also blocks scene-triggered
  // emotes, which would silently no-op the hold_emote reveal below.
  InputModifier.createOrReplace(engine.PlayerEntity, {
    mode: InputModifier.Mode.Standard({
      disableWalk: true,
      disableJog: true,
      disableRun: true,
      disableJump: true,
      disableDoubleJump: true,
      disableGliding: true
    })
  })

  if (drawerEntity) VisibilityComponent.getMutable(drawerEntity).visible = true

  for (const f of fruits) {
    Tween.deleteFrom(f.entity)
    GltfContainer.createOrReplace(f.entity, { src: randomFruitModel(), ...NO_COLLISION })
    Transform.getMutable(f.entity).position = randomCanopySpot()
    VisibilityComponent.createOrReplace(f.entity, { visible: true })
    f.phase = 'idle'
  }

  clientState.feedGame = { active: true, phase: 'intro', caught: 0, timeLeft: GAME_DURATION_S, catchFlashUntil: 0 }
  introEmotePlayed = false
  phase = 'intro'
  phaseAt = clock
}
