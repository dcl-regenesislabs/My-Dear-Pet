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
  VisibilityComponent,
  Tween,
  tweenSystem,
  EasingFunction,
  VirtualCamera,
  MainCamera,
  InputModifier,
  AvatarMask
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

// Geometry: two invisible marker entities placed in the Creator Hub composite
// (next to the tree) drive all of this — no geometry is derived from the
// tree's own transform/rotation:
//  - "cinematic_point": the camera's fixed position.
//  - "cinematic_play_spawnpoint": where the player is snapped to stand, and
//    the ground anchor the fruit canopy is centered above (NOT the tree's
//    trunk — the canopy follows the spawnpoint).
// The player is turned to face cinematic_point on arrival (movePlayerTo's
// cameraTarget); the camera looks up at the canopy area above the spawnpoint,
// not at ground level, so both the avatar and the falling fruit stay framed.
// left/right for the canopy spread is derived from the camera's own view
// direction (not any entity's authored rotation), so it always matches what
// actually reads as "left/right" on screen.
const CANOPY_HEIGHT = 8.75 // above the spawnpoint — where fruit hangs/falls from
const CAMERA_LOOK_HEIGHT = 4.2 // above the spawnpoint — independent of CANOPY_HEIGHT, so raising the drop height doesn't tilt the shot up too
const CANOPY_SPREAD = 1.3 // half-width, left/right as framed by the camera
const CANOPY_DEPTH = 0.6 // half-depth, narrow so it reads as one lane

// Same "hold" pose/asset pet.ts uses for carrying the egg — this project's
// existing "hands up, ready" clip.
const HOLD_EMOTE = 'models/hold_emote.glb'

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

let groundY = 0
let canopyCenter = Vector3.Zero()
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

function randomFruitModel(): string {
  return FRUIT_MODELS[Math.floor(Math.random() * FRUIT_MODELS.length)]
}

function randomCanopySpot(): Vector3 {
  const rightOff = (Math.random() * 2 - 1) * CANOPY_SPREAD
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
  if (caught) clientState.feedGame.caught += 1
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
      GltfContainer.createOrReplace(f.entity, { src: randomFruitModel() })
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
    InputModifier.deleteFrom(engine.PlayerEntity)
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
    GltfContainer.create(entity, { src: FRUIT_MODELS[i % FRUIT_MODELS.length] })
    VisibilityComponent.create(entity, { visible: false })
    fruits.push({ entity, phase: 'idle', nextDropAt: 0, resolvedAt: 0 })
  }
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
  // Where the player stands and the fruit canopy is centered.
  const spawnPoint = engine.getEntityOrNullByName(EntityNames.cinematic_play_spawnpoint)
  if (!spawnPoint || !Transform.has(spawnPoint)) {
    console.log('[Client] fruit game: cinematic_play_spawnpoint not found in scene')
    return
  }
  console.log('[Client] fruit game started for', mascotaId)

  const camPos = Transform.get(cinePoint).position
  const spawnPos = Transform.get(spawnPoint).position
  groundY = spawnPos.y
  canopyCenter = Vector3.create(spawnPos.x, groundY + CANOPY_HEIGHT, spawnPos.z)

  // Left/right for the canopy spread comes from the camera's own view
  // direction (camera -> spawnpoint), not any entity's authored rotation —
  // that's what actually reads as "left/right" on screen.
  const viewDir = Vector3.normalize(Vector3.create(spawnPos.x - camPos.x, 0, spawnPos.z - camPos.z))
  localForward = viewDir
  localRight = Vector3.create(-viewDir.z, 0, viewDir.x)

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

  for (const f of fruits) {
    Tween.deleteFrom(f.entity)
    GltfContainer.createOrReplace(f.entity, { src: randomFruitModel() })
    Transform.getMutable(f.entity).position = randomCanopySpot()
    VisibilityComponent.createOrReplace(f.entity, { visible: true })
    f.phase = 'idle'
  }

  clientState.feedGame = { active: true, phase: 'intro', caught: 0, timeLeft: GAME_DURATION_S }
  introEmotePlayed = false
  phase = 'intro'
  phaseAt = clock
}
