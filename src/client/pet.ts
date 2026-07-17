// Client-side pet rendering, follow / wander navigation, and animation.
// Pets share a clip set: idle, walk, run, eat, dance, gesture-positive,
// gesture-negative. We pick idle when still, walk/run when moving, and a
// specific clip during care interactions. The pet is owned + animated locally
// for smooth feel; authoritative stats come from the server snapshot.

import {
  engine,
  Entity,
  Transform,
  GltfContainer,
  ColliderLayer,
  Animator,
  TextShape,
  Billboard,
  pointerEventsSystem,
  InputAction,
  PlayerIdentityData
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import * as C from '../shared/config'
import { modelForSpecies } from '../shared/config'
import { clientState, actions, switchActivePet } from './state'

type Mode = 'follow' | 'goto' | 'interact' | 'wander'

const ANIM_CLIPS = ['idle', 'walk', 'run', 'eat', 'dance', 'gesture-positive', 'gesture-negative']

let localPet: Entity | null = null
let localSpecies = ''
let mode: Mode = 'follow'
let target = Vector3.create(199.2, 0, 231.8)
let onArrive: (() => void) | null = null
let interactTimer = 0
let interactClip = 'idle'
const curClip = new Map<Entity, string>()

// Wander state (used while the pet is dismissed / told to stay).
let wanderHome = Vector3.create(199.2, 0, 231.8)
let wanderTarget: Vector3 | null = null
let wanderPause = 0

const remotePets = new Map<string, Entity>()
const remoteSpecies = new Map<string, string>()

// The player's NON-active stored pets roam the care area on their own.
type Roamer = { entity: Entity; species: string; tag: Entity; tagName: string; home: Vector3; target: Vector3 | null; pause: number }
const inactivePets = new Map<string, Roamer>()

// Pick a random point inside the care area (objects sit ~x195-214, z235-249).
function careAreaPoint(): Vector3 {
  return Vector3.create(197.2 + Math.random() * 14, C.PET_BASE_Y, 235.8 + Math.random() * 18)
}

// Floating name tags (billboard) above each pet.
const TAG_HEIGHT = 1.5
let localTag: Entity | null = null
let localTagName = ''
const remoteTags = new Map<string, Entity>()
const remoteTagNames = new Map<string, string>()

function makeTag(): Entity {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(0, TAG_HEIGHT, 0) })
  Billboard.create(e, {})
  TextShape.create(e, {
    text: '',
    fontSize: 2.2,
    textColor: { r: 1, g: 0.95, b: 0.8, a: 1 },
    outlineColor: { r: 0.1, g: 0.07, b: 0.04 },
    outlineWidth: 0.25
  })
  return e
}

function updateTag(tag: Entity, pos: Vector3, size: number, name: string, last: string): string {
  const t = Transform.getMutable(tag)
  t.position = Vector3.create(pos.x, TAG_HEIGHT + size, pos.z)
  if (name !== last) TextShape.getMutable(tag).text = name
  return name
}

// ---------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------
function ensureAnimator(e: Entity): void {
  if (Animator.has(e)) return
  Animator.create(e, {
    states: ANIM_CLIPS.map((clip) => ({ clip, playing: clip === 'idle', loop: true, speed: 1, weight: 1 }))
  })
  curClip.set(e, 'idle')
}

function setClip(e: Entity, clip: string): void {
  if (curClip.get(e) === clip) return
  curClip.set(e, clip)
  const a = Animator.getMutable(e)
  for (const s of a.states) s.playing = s.clip === clip
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------
function flat(v: Vector3): Vector3 {
  return Vector3.create(v.x, C.PET_BASE_Y, v.z)
}
function distFlat(a: Vector3, b: Vector3): number {
  return Vector3.distance(flat(a), flat(b))
}
function yawToward(from: Vector3, to: Vector3): Quaternion {
  const dx = to.x - from.x
  const dz = to.z - from.z
  if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return Quaternion.Identity()
  const yaw = (Math.atan2(dx, dz) * 180) / Math.PI
  return Quaternion.fromEulerDegrees(0, yaw, 0)
}

/** Move entity toward dest; returns the distance actually moved this frame. */
function stepToward(entity: Entity, dest: Vector3, dt: number): number {
  const t = Transform.getMutable(entity)
  const cur = t.position
  const d = distFlat(cur, dest)
  if (d <= C.PET_ARRIVE_DISTANCE) return 0
  const dir = Vector3.normalize(Vector3.subtract(flat(dest), flat(cur)))
  const step = Math.min(d, C.PET_MOVE_SPEED * dt)
  t.position = Vector3.add(flat(cur), Vector3.scale(dir, step))
  t.rotation = yawToward(cur, dest)
  return step
}

// ---------------------------------------------------------------------------
// Local pet lifecycle
// ---------------------------------------------------------------------------
export function getLocalPet(): Entity | null {
  return localPet
}

/** True while the pet is walking to / performing a care action. */
export function isBusy(): boolean {
  return mode === 'goto' || mode === 'interact'
}

function ensureLocalPet(): void {
  const pet = clientState.activePet
  if (!pet) {
    if (localPet) {
      engine.removeEntity(localPet)
      curClip.delete(localPet)
      localPet = null
      localSpecies = ''
    }
    if (localTag) {
      engine.removeEntity(localTag)
      localTag = null
      localTagName = ''
    }
    return
  }
  if (!localPet) {
    localPet = engine.addEntity()
    Transform.create(localPet, { position: Vector3.create(197.2, C.PET_BASE_Y, 229.8), scale: Vector3.scale(Vector3.One(), pet.size) })
    pointerEventsSystem.onPointerDown(
      { entity: localPet, opts: { button: InputAction.IA_POINTER, hoverText: 'Open', maxDistance: 8 } },
      () => {
        // Clicking the pet opens its control panel. (The "pet for happiness"
        // action is suspended for now — was: actions.petSelf() + petReact().)
        clientState.petPanelOpen = true
      }
    )
    localTag = makeTag()
  }
  if (localSpecies !== pet.species) {
    localSpecies = pet.species
    GltfContainer.createOrReplace(localPet, { src: modelForSpecies(pet.species), visibleMeshesCollisionMask: ColliderLayer.CL_POINTER })
    ensureAnimator(localPet)
  }
  // Keep visual scale synced to growth.
  const t = Transform.getMutable(localPet)
  const s = Vector3.scale(Vector3.One(), pet.size)
  if (t.scale.x !== s.x) t.scale = s
}

/** Send the pet to a world position; play `clip` on arrival, then run cb. */
export function sendPetTo(dest: Vector3, cb: () => void, clip = 'eat'): void {
  if (!localPet) return
  target = flat(dest)
  onArrive = cb
  interactClip = clip
  mode = 'goto'
}

/** Quick affection reaction (used when petting). */
export function petReact(): void {
  if (!localPet) return
  if (mode === 'goto') return
  mode = 'interact'
  interactClip = 'gesture-positive'
  interactTimer = 0.9
}

export function setFollow(enabled: boolean): void {
  clientState.followEnabled = enabled
  actions.setFollow(enabled) // tell the server so others mirror our follow/stay
  if (enabled) {
    mode = 'follow'
  } else {
    mode = 'wander'
    wanderHome = localPet ? Transform.get(localPet).position : wanderHome
    wanderTarget = null
    wanderPause = 1
  }
}

function playerPos(): Vector3 {
  if (!Transform.has(engine.PlayerEntity)) return Vector3.create(199.2, 0, 231.8)
  return Transform.get(engine.PlayerEntity).position
}

function followTarget(): Vector3 {
  const pp = playerPos()
  return Vector3.create(pp.x - C.PET_FOLLOW_DISTANCE, C.PET_BASE_Y, pp.z - C.PET_FOLLOW_DISTANCE)
}

function updateWander(dt: number): number {
  if (wanderPause > 0) {
    wanderPause -= dt
    return 0
  }
  if (!wanderTarget || (localPet && distFlat(Transform.get(localPet).position, wanderTarget) <= C.PET_ARRIVE_DISTANCE)) {
    if (wanderTarget) {
      // Arrived: idle for a moment before choosing a new spot.
      wanderTarget = null
      wanderPause = 1.5 + Math.random() * 2.5
      return 0
    }
    const r = 3 + Math.random() * 3
    const ang = Math.random() * Math.PI * 2
    wanderTarget = Vector3.create(wanderHome.x + Math.cos(ang) * r, C.PET_BASE_Y, wanderHome.z + Math.sin(ang) * r)
  }
  return localPet ? stepToward(localPet, wanderTarget, dt) : 0
}

function updateLocalPet(dt: number): void {
  ensureLocalPet()
  if (!localPet) return
  let moved = 0
  let moveClip = 'walk'

  switch (mode) {
    case 'follow': {
      const dest = followTarget()
      if (distFlat(playerPos(), Transform.get(localPet).position) > C.PET_FOLLOW_DISTANCE + 0.5) {
        moved = stepToward(localPet, dest, dt)
      }
      break
    }
    case 'wander': {
      moved = updateWander(dt)
      break
    }
    case 'goto': {
      moveClip = 'run'
      moved = stepToward(localPet, target, dt)
      if (distFlat(Transform.get(localPet).position, target) <= C.PET_ARRIVE_DISTANCE) {
        mode = 'interact'
        interactTimer = 1.1
        if (onArrive) {
          onArrive()
          onArrive = null
        }
      }
      break
    }
    case 'interact': {
      interactTimer -= dt
      if (interactTimer <= 0) mode = clientState.followEnabled ? 'follow' : 'wander'
      break
    }
  }

  // Decide animation: interaction clip > movement > idle.
  if (mode === 'interact') setClip(localPet, interactClip)
  else if (moved > 0.003) setClip(localPet, moveClip)
  else setClip(localPet, 'idle')

  // Floating name tag follows the pet.
  if (localTag) {
    const pet2 = clientState.activePet
    localTagName = updateTag(localTag, Transform.get(localPet).position, pet2 ? pet2.size : 0.55, pet2 ? pet2.name : '', localTagName)
  }
}

// ---------------------------------------------------------------------------
// Remote pets (social layer)
// ---------------------------------------------------------------------------
function remotePlayerPositions(): Map<string, Vector3> {
  const out = new Map<string, Vector3>()
  for (const [entity, id] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (!Transform.has(entity)) continue
    out.set(id.address.toLowerCase(), Transform.get(entity).position)
  }
  return out
}

function updateRemotePets(dt: number): void {
  const me = clientState.myAddress.toLowerCase()
  const positions = remotePlayerPositions()
  const seen = new Set<string>()

  for (const entry of clientState.presence) {
    const addr = entry.address.toLowerCase()
    if (addr === me) continue
    const ownerPos = positions.get(addr)
    if (!ownerPos) continue
    seen.add(addr)

    let ent = remotePets.get(addr)
    if (!ent) {
      ent = engine.addEntity()
      Transform.create(ent, { position: Vector3.create(ownerPos.x - 2, C.PET_BASE_Y, ownerPos.z - 2), scale: Vector3.scale(Vector3.One(), entry.size) })
      remotePets.set(addr, ent)
      remoteTags.set(addr, makeTag())
      const targetAddr = entry.address
      pointerEventsSystem.onPointerDown(
        { entity: ent, opts: { button: InputAction.IA_POINTER, hoverText: 'Pet (give a treat)', maxDistance: 8 } },
        () => actions.petOther(targetAddr)
      )
    }
    if (remoteSpecies.get(addr) !== entry.species) {
      remoteSpecies.set(addr, entry.species)
      GltfContainer.createOrReplace(ent, { src: modelForSpecies(entry.species), visibleMeshesCollisionMask: ColliderLayer.CL_POINTER })
      ensureAnimator(ent)
    }
    const t = Transform.getMutable(ent)
    const s = Vector3.scale(Vector3.One(), entry.size)
    if (t.scale.x !== s.x) t.scale = s
    // Follow the owner only if their pet is currently following them; otherwise
    // it stays put (mirrors the owner having dismissed it).
    const following = entry.following !== false
    let moved = 0
    if (following) {
      const dest = Vector3.create(ownerPos.x - 2, C.PET_BASE_Y, ownerPos.z - 2)
      moved = distFlat(t.position, dest) > 0.5 ? stepToward(ent, dest, dt) : 0
    }
    setClip(ent, moved > 0.003 ? 'walk' : 'idle')

    const tag = remoteTags.get(addr)
    if (tag) remoteTagNames.set(addr, updateTag(tag, t.position, entry.size, entry.name, remoteTagNames.get(addr) ?? ''))
  }

  for (const [addr, ent] of remotePets) {
    if (!seen.has(addr)) {
      engine.removeEntity(ent)
      remotePets.delete(addr)
      remoteSpecies.delete(addr)
      curClip.delete(ent)
      const tag = remoteTags.get(addr)
      if (tag) {
        engine.removeEntity(tag)
        remoteTags.delete(addr)
        remoteTagNames.delete(addr)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Inactive (stored, non-selected) pets — roam the care area on their own.
// ---------------------------------------------------------------------------
function updateInactivePets(dt: number): void {
  const p = clientState.player
  const wanted = new Set<string>()

  if (p) {
    for (const pet of p.pets) {
      if (pet.id === p.activePetId) continue
      wanted.add(pet.id)

      let st = inactivePets.get(pet.id)
      if (!st) {
        const e = engine.addEntity()
        const home = careAreaPoint()
        Transform.create(e, { position: home, scale: Vector3.scale(Vector3.One(), pet.size) })
        GltfContainer.createOrReplace(e, { src: modelForSpecies(pet.species), visibleMeshesCollisionMask: ColliderLayer.CL_POINTER })
        ensureAnimator(e)
        const petId = pet.id
        pointerEventsSystem.onPointerDown(
          { entity: e, opts: { button: InputAction.IA_POINTER, hoverText: `Select ${pet.name}`, maxDistance: 8 } },
          () => switchActivePet(petId)
        )
        st = { entity: e, species: pet.species, tag: makeTag(), tagName: '', home, target: null, pause: Math.random() * 2 }
        inactivePets.set(pet.id, st)
      }
      if (st.species !== pet.species) {
        st.species = pet.species
        GltfContainer.createOrReplace(st.entity, { src: modelForSpecies(pet.species), visibleMeshesCollisionMask: ColliderLayer.CL_POINTER })
      }

      // Wander: walk to a random nearby point, idle a beat, repeat.
      let moved = 0
      if (st.pause > 0) {
        st.pause -= dt
      } else if (!st.target || distFlat(Transform.get(st.entity).position, st.target) <= C.PET_ARRIVE_DISTANCE) {
        if (st.target) {
          st.target = null
          st.pause = 1.5 + Math.random() * 3
        } else {
          const r = 2 + Math.random() * 4
          const ang = Math.random() * Math.PI * 2
          st.target = Vector3.create(st.home.x + Math.cos(ang) * r, C.PET_BASE_Y, st.home.z + Math.sin(ang) * r)
        }
      } else {
        moved = stepToward(st.entity, st.target, dt)
      }
      setClip(st.entity, moved > 0.003 ? 'walk' : 'idle')

      const t = Transform.getMutable(st.entity)
      const s = Vector3.scale(Vector3.One(), pet.size)
      if (t.scale.x !== s.x) t.scale = s
      st.tagName = updateTag(st.tag, t.position, pet.size, pet.name, st.tagName)
    }
  }

  for (const [id, st] of inactivePets) {
    if (!wanted.has(id)) {
      engine.removeEntity(st.entity)
      engine.removeEntity(st.tag)
      curClip.delete(st.entity)
      inactivePets.delete(id)
    }
  }
}

export function setupPetSystems(): void {
  engine.addSystem((dt: number) => {
    updateLocalPet(dt)
    updateInactivePets(dt)
    updateRemotePets(dt)
  })
}
