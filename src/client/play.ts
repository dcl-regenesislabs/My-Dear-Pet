// Play action (Fetch): as soon as Fetch mode is opened, a meteorite appears
// attached to the player's right hand (same AvatarAttach trick pet.ts uses to
// carry the egg). Tapping the Fetch button plays a throw emote — the ball
// stays in the hand through the wind-up — and right as the throw is
// finishing, the held ball is swapped for a free-flying one that arcs out
// ahead of the avatar while tumbling and lands. Then the pet runs to it,
// grabs it, carries it back to the player and drops it — which applies the
// normal "play" reward, and a fresh ball reappears in the hand for the next
// throw. (The old play action — pet walks to the ball — is suspended; see
// input.ts / ui.tsx.)

import { engine, Entity, Transform, GltfContainer, AvatarMask, AvatarAttach, AvatarAnchorPointType } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { triggerSceneEmote } from '~system/RestrictedActions'
import * as C from '../shared/config'
import { getLocalPet, sendPetTo } from './pet'
import { applyCareLocal } from './sim'
import { actions, clientState } from './state'

const MODEL = 'models/meteorite_animated.glb'
// Scene emotes must end in '_emote.glb' (Unity enforces this naming
// convention — see pet.ts's HOLD_EMOTE comment); a differently-named file
// silently gets rejected (triggerSceneEmote resolves success:false, no
// error). This clip (no mesh, same Avatar_* skeleton as the real avatar) is a
// single 0.67s wind-up-and-throw action. Played masked AM_UPPER_BODY like
// every other scene emote in this codebase (holdEmote.ts) — an unmasked
// full-body trigger was rejected the same way (success:false), so masked is
// the only version that actually plays.
const THROW_EMOTE = 'models/throw_ball_emote.glb'
const THROW_RELEASE_DELAY = 0.5 // seconds from triggering the emote to release — near the end of the 0.67s clip, just past the arm's forward-most point (read off the clip's own keyframes) — when the held ball is swapped for the free-flying one
const FLIGHT_TIME = 1.1 // seconds in the air
const THROW_DISTANCE = 9 // metres forward from the avatar
const ARC_HEIGHT = 3.2 // peak height of the throw arc
const SPIN_SPEED = 540 // deg/sec tumble while flying
const LINGER = 2.0 // seconds resting on the ground if there's no pet to fetch
const SCALE = 0.35
const CARRY_HEIGHT = 0.45 // how high off the pet the carried meteorite floats
const CARRY_FORWARD = 0.6 // how far in front of the pet (a bit past its face)
// Held-ball local offset in the hand anchor's space — approximate, same idea as
// pet.ts's EGG_HAND_OFFSET; likely needs a visual tuning pass once seen in-client.
const HAND_BALL_OFFSET = Vector3.create(0.12, 0.05, 0.05)

// 'fly' = arcing through the air. 'wait' = grounded, pet running to it.
// 'carry' = pet bringing it back. 'dropped' = left on the floor by the avatar,
// lingering before it disappears. Only one fetch runs at a time.
type Phase = 'fly' | 'wait' | 'carry' | 'dropped'
type Flight = { entity: Entity; from: Vector3; to: Vector3; t: number; phase: Phase; spin: number }
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
  const from = Vector3.create(pt.position.x + dir.x * 0.7, pt.position.y + 1.4, pt.position.z + dir.z * 0.7)
  const to = Vector3.create(pt.position.x + dir.x * THROW_DISTANCE, C.PET_BASE_Y + 0.35, pt.position.z + dir.z * THROW_DISTANCE)

  const entity = engine.addEntity()
  Transform.createOrReplace(entity, { position: from, scale: Vector3.scale(Vector3.One(), SCALE) })
  GltfContainer.createOrReplace(entity, { src: MODEL })
  flight = { entity, from, to, t: 0, phase: 'fly', spin: 0 }
}

/** Avatar forward, flattened to the ground plane and normalized. */
function flatForward(rotation: Quaternion): Vector3 {
  const fwd = Vector3.rotate(Vector3.create(0, 0, 1), rotation)
  return Vector3.normalize(Vector3.create(fwd.x, 0, fwd.z))
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
    if (u >= 1) landed()
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
    Transform.createOrReplace(handBall, { parent: handAnchor, position: HAND_BALL_OFFSET, scale: Vector3.scale(Vector3.One(), SCALE) })
    GltfContainer.createOrReplace(handBall, { src: MODEL })
  } else if (!wantBall && handBall) {
    engine.removeEntity(handBall)
    handBall = null
  }
}

export function setupPlay(): void {
  engine.addSystem(flightSystem)
  engine.addSystem(carryBallSystem)
}
