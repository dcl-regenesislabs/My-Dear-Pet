// Play action (Fetch): as soon as Fetch mode is opened, a ball (a plain
// yellow sphere for now — see applyBallShape(), a placeholder for a real
// tennis-ball texture later) appears attached to the player's right hand
// (same AvatarAttach trick pet.ts uses to carry the egg). Tapping the Fetch
// button plays a throw emote — the ball stays in the hand through the
// wind-up — and right as the throw is finishing, the held ball is swapped
// for a free-flying one that arcs out ahead of the avatar while tumbling and
// lands. Then the pet runs to it, grabs it, carries it back to the player and
// drops it — which applies the normal "play" reward, and a fresh ball
// reappears in the hand for the next throw. (The old play action — pet walks
// to the ball — is suspended; see input.ts / ui.tsx.)

import { engine, Entity, Transform, MeshRenderer, Material, AvatarMask, AvatarAttach, AvatarAnchorPointType } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import { triggerSceneEmote } from '~system/RestrictedActions'
import * as C from '../shared/config'
import { getLocalPet, sendPetTo } from './pet'
import { applyCareLocal } from './sim'
import { actions, clientState } from './state'

const TENNIS_YELLOW = Color4.create(0.85, 0.98, 0.2, 1)

/** Placeholder ball look: a plain tennis-yellow sphere. Swap for a textured
 *  sphere (Material.Texture.Common) once real ball art lands. */
function applyBallShape(entity: Entity): void {
  MeshRenderer.setSphere(entity)
  Material.setPbrMaterial(entity, { albedoColor: TENNIS_YELLOW })
}

// Scene emotes must end in '_emote.glb' (Unity enforces this naming
// convention — see pet.ts's HOLD_EMOTE comment); a differently-named file
// silently gets rejected (triggerSceneEmote resolves success:false, no
// error). This clip (no mesh, same Avatar_* skeleton as the real avatar) is a
// single 0.67s wind-up-and-throw action. Played masked AM_UPPER_BODY like
// every other scene emote in this codebase (holdEmote.ts) — an unmasked
// full-body trigger was rejected the same way (success:false), so masked is
// the only version that actually plays.
const THROW_EMOTE = 'models/throw_ball_emote.glb'
// These are `let`, not `const` — see debugBall* below, a runtime calibration
// panel (toggle with the "1" hotkey, input.ts) for exactly the values that
// are hardest to get right without seeing them in-client: where the ball
// sits in the hand, where it launches from, and when. Values below are
// calibrated in-client via that panel; if they ever need retuning, use the
// panel's "Print values" button and hardcode the numbers back here.
let THROW_RELEASE_DELAY = 0.2 // seconds from triggering the emote to release
let HAND_BALL_X = 0.07 // held-ball offset in the hand anchor's local space — same idea as pet.ts's EGG_HAND_OFFSET
let HAND_BALL_Y = 0.07
let HAND_BALL_Z = -0.01
// Launch point approximation: forward + to the RIGHT of center (a real right
// hand isn't on the centerline) + roughly hand/shoulder height, so the
// released ball reads as leaving the hand instead of popping out of the
// chest. There's no way to read the AvatarAttach hand bone's actual world
// position back out of ECS state, so this is a hand-tuned estimate.
let HAND_FORWARD_OFFSET = 0.17
let HAND_RIGHT_OFFSET = 0.26
let HAND_HEIGHT = 1.68
const FLIGHT_TIME = 1.1 // seconds in the air
const THROW_DISTANCE = 9 // metres forward from the avatar
const ARC_HEIGHT = 3.2 // peak height of the throw arc
const SPIN_SPEED = 540 // deg/sec tumble while flying
const LINGER = 2.0 // seconds resting on the ground if there's no pet to fetch
const SCALE = 0.14 // ball diameter in metres — was 0.35 (tuned for the old meteorite mesh), way too big for a primitive sphere at scale 1 = 1m
const CARRY_HEIGHT = 0.45 // how high off the pet the carried meteorite floats
const CARRY_FORWARD = 0.6 // how far in front of the pet (a bit past its face)
// Decaying bounces after the primary landing, before the pet is sent to
// fetch it — each bounce keeps BOUNCE_DECAY of the previous one's height,
// forward travel and duration, continuing in the same throw direction.
const BOUNCE_COUNT = 2
const BOUNCE_DECAY = 0.4
const FIRST_BOUNCE_HEIGHT = 0.6 // metres
const FIRST_BOUNCE_FORWARD = 1.0 // metres
const FIRST_BOUNCE_DURATION = 0.35 // seconds

// 'fly' = arcing through the air. 'bounce' = decaying bounces after landing
// (see BOUNCE_COUNT). 'wait' = grounded (settled), pet running to it.
// 'carry' = pet bringing it back. 'dropped' = left on the floor by the avatar,
// lingering before it disappears. Only one fetch runs at a time.
type Phase = 'fly' | 'bounce' | 'wait' | 'carry' | 'dropped'
type Flight = {
  entity: Entity
  from: Vector3
  to: Vector3
  t: number
  phase: Phase
  spin: number
  dir: Vector3 // throw direction, reused to keep bouncing forward in a straight line
  bounceIndex: number // how many bounces have completed so far
  bounceHeight: number // current/next bounce's peak height
  bounceForward: number // current/next bounce's forward travel
  bounceDuration: number // current/next bounce's duration
}
let flight: Flight | null = null
let handAnchor: Entity | null = null // empty attached to the right-hand bone, alive while Fetch mode is open
let handBall: Entity | null = null // the visible held meteorite, child of handAnchor; absent while one is in flight

/** Fetch button tapped: play the throw emote right away — the ball stays in
 *  the hand through the wind-up (see carryBallSystem) — and swap it for a
 *  free-flying one once the emote is finishing (THROW_RELEASE_DELAY later).
 *  The pet fetches it once it lands. */
export function throwMeteor(): void {
  if (flight) return // a fetch is already in progress — ignore extra throws
  const pt = Transform.getOrNull(engine.PlayerEntity)
  if (!pt) return
  const dir = flatForward(pt.rotation)
  clientState.fetch.busy = true // block the Fetch button until the pet drops it
  void triggerSceneEmote({ src: THROW_EMOTE, loop: false, mask: AvatarMask.AM_UPPER_BODY })
    .then((res) => {
      if (!res.success) console.log('[Client] throw emote: triggerSceneEmote resolved with success:false')
    })
    .catch((err) => console.log('[Client] throw emote: triggerSceneEmote threw', err))

  let t = 0
  const fire = (dt: number): void => {
    t += dt
    if (t >= THROW_RELEASE_DELAY) {
      launchMeteor(dir)
      engine.removeSystem(fire)
    }
  }
  engine.addSystem(fire)
}

/** Actually spawns the meteorite and starts its flight, in the given (flat,
 *  normalized) direction — split out from throwMeteor() so the spawn can be
 *  delayed to match the throw emote's release point. */
function launchMeteor(dir: Vector3): void {
  if (flight) return
  const pt = Transform.getOrNull(engine.PlayerEntity)
  if (!pt) return
  const right = flatRight(pt.rotation)
  const from = Vector3.create(
    pt.position.x + dir.x * HAND_FORWARD_OFFSET + right.x * HAND_RIGHT_OFFSET,
    pt.position.y + HAND_HEIGHT,
    pt.position.z + dir.z * HAND_FORWARD_OFFSET + right.z * HAND_RIGHT_OFFSET
  )
  const to = Vector3.create(pt.position.x + dir.x * THROW_DISTANCE, C.PET_BASE_Y + 0.35, pt.position.z + dir.z * THROW_DISTANCE)

  const entity = engine.addEntity()
  Transform.createOrReplace(entity, { position: from, scale: Vector3.scale(Vector3.One(), SCALE) })
  applyBallShape(entity)
  flight = { entity, from, to, t: 0, phase: 'fly', spin: 0, dir, bounceIndex: 0, bounceHeight: FIRST_BOUNCE_HEIGHT, bounceForward: FIRST_BOUNCE_FORWARD, bounceDuration: FIRST_BOUNCE_DURATION }
}

/** Avatar forward, flattened to the ground plane and normalized. */
function flatForward(rotation: Quaternion): Vector3 {
  const fwd = Vector3.rotate(Vector3.create(0, 0, 1), rotation)
  return Vector3.normalize(Vector3.create(fwd.x, 0, fwd.z))
}

/** Avatar right, flattened to the ground plane and normalized. */
function flatRight(rotation: Quaternion): Vector3 {
  const r = Vector3.rotate(Vector3.create(1, 0, 0), rotation)
  return Vector3.normalize(Vector3.create(r.x, 0, r.z))
}

/** Position the carried meteorite at the pet's "mouth" (in front + up a bit). */
function carryPose(pet: Entity): Vector3 {
  const t = Transform.get(pet)
  const fwd = Vector3.rotate(Vector3.create(0, 0, 1), t.rotation)
  const flat = Vector3.normalize(Vector3.create(fwd.x, 0, fwd.z))
  return Vector3.create(
    t.position.x + flat.x * CARRY_FORWARD,
    t.position.y + CARRY_HEIGHT,
    t.position.z + flat.z * CARRY_FORWARD
  )
}

/** Pet reached the player: drop the ball on the floor, grant the play reward,
 *  and re-enable the Fetch button. The ball lingers a moment, then disappears. */
function dropFetch(): void {
  if (!flight) return
  const pet = getLocalPet()
  const at = pet ? Transform.get(pet).position : flight.to
  Transform.getMutable(flight.entity).position = Vector3.create(at.x, C.PET_BASE_Y + 0.2, at.z)
  flight.phase = 'dropped'
  flight.t = 0
  clientState.fetch.busy = false // ready to throw again
  applyCareLocal('play', false) // optimistic local effect (+happiness, -energy)
  actions.care('play', false) // tell the server (it corrects via snapshot)
}

function flightSystem(dt: number): void {
  if (!flight) return
  flight.t += dt

  if (flight.phase === 'fly') {
    flight.spin += SPIN_SPEED * dt
    const u = Math.min(1, flight.t / FLIGHT_TIME)
    const p = Vector3.lerp(flight.from, flight.to, u)
    p.y += 4 * ARC_HEIGHT * u * (1 - u) // parabolic arc: 0 at ends, peak at u=0.5
    const t = Transform.getMutable(flight.entity)
    t.position = p
    t.rotation = Quaternion.fromEulerDegrees(flight.spin, flight.spin * 0.6, 0)
    if (u >= 1) {
      // Primary arc landed — start decaying forward bounces from here instead
      // of stopping dead (see BOUNCE_COUNT).
      flight.phase = 'bounce'
      flight.t = 0
      flight.from = flight.to
      flight.to = Vector3.create(flight.to.x + flight.dir.x * flight.bounceForward, flight.to.y, flight.to.z + flight.dir.z * flight.bounceForward)
    }
  } else if (flight.phase === 'bounce') {
    flight.spin += SPIN_SPEED * dt // keep "rolling" through the bounces
    const u = Math.min(1, flight.t / flight.bounceDuration)
    const p = Vector3.lerp(flight.from, flight.to, u)
    p.y += 4 * flight.bounceHeight * u * (1 - u)
    const t = Transform.getMutable(flight.entity)
    t.position = p
    t.rotation = Quaternion.fromEulerDegrees(flight.spin, flight.spin * 0.6, 0)
    if (u >= 1) {
      flight.bounceIndex++
      if (flight.bounceIndex >= BOUNCE_COUNT) {
        landed() // settled — send the pet to fetch it from here
      } else {
        // Set up the next, smaller bounce.
        flight.t = 0
        flight.bounceHeight *= BOUNCE_DECAY
        flight.bounceForward *= BOUNCE_DECAY
        flight.bounceDuration *= BOUNCE_DECAY
        flight.from = flight.to
        flight.to = Vector3.create(flight.to.x + flight.dir.x * flight.bounceForward, flight.to.y, flight.to.z + flight.dir.z * flight.bounceForward)
      }
    }
  } else if (flight.phase === 'carry') {
    const pet = getLocalPet()
    if (pet) Transform.getMutable(flight.entity).position = carryPose(pet)
  } else if (flight.phase === 'dropped') {
    if (flight.t >= LINGER) {
      engine.removeEntity(flight.entity)
      flight = null
    }
  }
}

/** The meteorite touched down — send the pet to fetch it (or let it linger). */
function landed(): void {
  if (!flight) return
  const pet = getLocalPet()
  if (!pet) {
    // No pet to fetch it — leave it a moment, then remove it and free the button.
    flight.phase = 'wait'
    let t = 0
    const gone = (dt: number): void => {
      t += dt
      if (t >= LINGER) {
        if (flight) {
          engine.removeEntity(flight.entity)
          flight = null
        }
        clientState.fetch.busy = false
        engine.removeSystem(gone)
      }
    }
    engine.addSystem(gone)
    return
  }
  flight.phase = 'wait'
  const landingPos = flight.to
  // Leg 1: run to the meteorite and "grab" it (eat clip on arrival).
  sendPetTo(
    landingPos,
    () => {
      if (!flight) return
      flight.phase = 'carry'
      // Leg 2: carry it back to where the player is now, then drop it on the floor.
      const player = Transform.getOrNull(engine.PlayerEntity)
      const home = player ? Vector3.create(player.position.x, C.PET_BASE_Y, player.position.z) : landingPos
      sendPetTo(home, () => dropFetch(), 'gesture-positive')
    },
    'eat'
  )
}

/** Keeps a meteorite visibly in the player's right hand for the whole time
 *  Fetch mode is open and no ball is currently in flight/being fetched —
 *  same AvatarAttach(AAPT_RIGHT_HAND) approach pet.ts uses for the carried
 *  egg. `handAnchor` stays alive for the Fetch session; `handBall` (the
 *  visible model) comes and goes each throw. */
function carryBallSystem(): void {
  const wantAnchor = clientState.fetch.active
  if (wantAnchor && !handAnchor) {
    handAnchor = engine.addEntity()
    Transform.createOrReplace(handAnchor, {})
    AvatarAttach.createOrReplace(handAnchor, { anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND })
  } else if (!wantAnchor && handAnchor) {
    if (handBall) {
      engine.removeEntity(handBall)
      handBall = null
    }
    engine.removeEntity(handAnchor)
    handAnchor = null
  }

  const wantBall = wantAnchor && !flight
  if (wantBall && !handBall && handAnchor) {
    handBall = engine.addEntity()
    Transform.createOrReplace(handBall, { parent: handAnchor, scale: Vector3.scale(Vector3.One(), SCALE) })
    applyBallShape(handBall)
  } else if (!wantBall && handBall) {
    engine.removeEntity(handBall)
    handBall = null
  }
  // Re-applied every frame (not just on creation) so debugBallAdjust()'s
  // nudges show up on the held ball immediately, without a re-throw.
  if (handBall) Transform.getMutable(handBall).position = Vector3.create(HAND_BALL_X, HAND_BALL_Y, HAND_BALL_Z)
}

// ---------------------------------------------------------------------------
// DEBUG ball calibration panel. While Fetch mode is open, nudges the
// module-level position/timing constants above; the held ball (carryBallSystem)
// and a live marker at the computed launch point (debugBallPreviewSystem)
// both re-read them every frame, so changes are visible immediately — no
// re-throw needed to check the held-ball offset or the launch point, though
// the release delay and flight itself still need an actual throw to judge.
// Once the numbers feel right, call debugBallPrint() (logs to console) and
// hardcode them back into the `let`s above.
// ---------------------------------------------------------------------------
export type DebugBallKey = 'ballX' | 'ballY' | 'ballZ' | 'forward' | 'right' | 'height' | 'releaseDelay'
let debugMarker: Entity | null = null

export function debugBallAvailableKeys(): DebugBallKey[] {
  return ['ballX', 'ballY', 'ballZ', 'forward', 'right', 'height', 'releaseDelay']
}

export function debugBallLabel(key: DebugBallKey): string {
  switch (key) {
    case 'ballX': return 'Held: out'
    case 'ballY': return 'Held: up'
    case 'ballZ': return 'Held: fwd'
    case 'forward': return 'Launch: fwd'
    case 'right': return 'Launch: right'
    case 'height': return 'Launch: height'
    case 'releaseDelay': return 'Release delay (s)'
  }
}

export function debugBallValue(key: DebugBallKey): number {
  switch (key) {
    case 'ballX': return HAND_BALL_X
    case 'ballY': return HAND_BALL_Y
    case 'ballZ': return HAND_BALL_Z
    case 'forward': return HAND_FORWARD_OFFSET
    case 'right': return HAND_RIGHT_OFFSET
    case 'height': return HAND_HEIGHT
    case 'releaseDelay': return THROW_RELEASE_DELAY
  }
}

export function debugBallAdjust(key: DebugBallKey, delta: number): void {
  switch (key) {
    case 'ballX': HAND_BALL_X += delta; break
    case 'ballY': HAND_BALL_Y += delta; break
    case 'ballZ': HAND_BALL_Z += delta; break
    case 'forward': HAND_FORWARD_OFFSET += delta; break
    case 'right': HAND_RIGHT_OFFSET += delta; break
    case 'height': HAND_HEIGHT += delta; break
    case 'releaseDelay': THROW_RELEASE_DELAY = Math.max(0, THROW_RELEASE_DELAY + delta); break
  }
}

export function debugBallPrint(): void {
  console.log(
    '[Client] ball debug values:',
    `HAND_BALL_X=${HAND_BALL_X.toFixed(2)}`,
    `HAND_BALL_Y=${HAND_BALL_Y.toFixed(2)}`,
    `HAND_BALL_Z=${HAND_BALL_Z.toFixed(2)}`,
    `HAND_FORWARD_OFFSET=${HAND_FORWARD_OFFSET.toFixed(2)}`,
    `HAND_RIGHT_OFFSET=${HAND_RIGHT_OFFSET.toFixed(2)}`,
    `HAND_HEIGHT=${HAND_HEIGHT.toFixed(2)}`,
    `THROW_RELEASE_DELAY=${THROW_RELEASE_DELAY.toFixed(2)}`
  )
}

/** Bright magenta marker at the current computed launch point — only while the
 *  debug panel is open and Fetch mode is active — so HAND_FORWARD_OFFSET/
 *  HAND_RIGHT_OFFSET/HAND_HEIGHT can be tuned by watching it move, without
 *  needing to actually throw each time. */
function debugBallPreviewSystem(): void {
  const want = clientState.debugBallPanelOpen && clientState.fetch.active
  if (!want) {
    if (debugMarker) {
      engine.removeEntity(debugMarker)
      debugMarker = null
    }
    return
  }
  const pt = Transform.getOrNull(engine.PlayerEntity)
  if (!pt) return
  const dir = flatForward(pt.rotation)
  const right = flatRight(pt.rotation)
  const pos = Vector3.create(
    pt.position.x + dir.x * HAND_FORWARD_OFFSET + right.x * HAND_RIGHT_OFFSET,
    pt.position.y + HAND_HEIGHT,
    pt.position.z + dir.z * HAND_FORWARD_OFFSET + right.z * HAND_RIGHT_OFFSET
  )
  if (!debugMarker) {
    debugMarker = engine.addEntity()
    MeshRenderer.setSphere(debugMarker)
    Material.setPbrMaterial(debugMarker, { albedoColor: Color4.create(1, 0, 1, 1) })
  }
  Transform.createOrReplace(debugMarker, { position: pos, scale: Vector3.scale(Vector3.One(), 0.08) })
}

export function setupPlay(): void {
  engine.addSystem(flightSystem)
  engine.addSystem(carryBallSystem)
  engine.addSystem(debugBallPreviewSystem)
}
