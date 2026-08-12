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
  MeshRenderer,
  Material,
  VisibilityComponent,
  pointerEventsSystem,
  inputSystem,
  InputAction,
  PlayerIdentityData,
  PrimaryPointerInfo,
  UiCanvasInformation,
  VirtualCamera,
  MainCamera,
  InputModifier,
  AvatarAttach,
  AvatarAnchorPointType,
  AvatarMask
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import * as C from '../shared/config'
import { modelForSpecies, petStage, scaleForSpecies, speciesLabel, stageScaleFor, yawOffsetForSpecies } from '../shared/config'
import { petCondition } from '../shared/breeding'
import type { PetData } from '../shared/types'
import { triggerSceneEmote, stopEmote } from '~system/RestrictedActions'
import { clientState, actions, adoptPet, openDialog, pushToast, switchActivePet } from './state'
import { applyCareLocal } from './sim'
import { EntityNames } from '../../assets/scene/entity-names'
import { objectPosition } from './objects'
import { mobile } from './ui/theme'

type Mode = 'follow' | 'goto' | 'interact' | 'wander' | 'bathhop'

const ANIM_CLIPS = ['idle', 'walk', 'run', 'eat', 'dance', 'gesture-positive', 'gesture-negative']

let localPet: Entity | null = null
let localSpecies = ''
let mode: Mode = 'follow'
let target = Vector3.create(199.2, 0, 231.8)
let onArrive: (() => void) | null = null
let interactTimer = 0
let interactClip = 'idle'
const curClip = new Map<Entity, string>()

// Bath exit hop — placePetAtStation teleports the pet straight into the tub, which
// sits above/inside walled geometry. Walking straight out afterward (normal 'follow'
// stepToward) would clip through the tub's rim, so we set this flag to detour through
// a short hop (horizontal step + vertical arc) instead of returning to follow/wander directly.
let justBathed = false
let bathHopT = 0 // seconds remaining in the hop; >0 while mode === 'bathhop'
let bathHopFrom = Vector3.Zero()
const BATH_HOP_DURATION = 0.45 // seconds
const BATH_HOP_DISTANCE = 1.2 // metres covered horizontally while hopping out
const BATH_HOP_HEIGHT = 0.6 // metres, peak arc height

// Wander state (used while the pet is dismissed / told to stay).
let wanderHome = Vector3.create(199.2, 0, 231.8)
let wanderTarget: Vector3 | null = null
let wanderPause = 0

const remotePets = new Map<string, Entity>()
const remoteSpecies = new Map<string, string>()

// Floating tag above each pet: name + a health bar whose celeste fill shows how
// full the pet's condition is (dark track behind it = the empty part), with the
// growth stage (JUNIOR / TEEN / ADULT) written across it. A billboard root
// faces the camera. IMPORTANT: on a Billboard, local +Z points AWAY from the
// camera, so nearer-camera = SMALLER z. The stack, front (camera) -> back:
//   text (z<0)  >  fill (0)  >  track (>0)  >  frame (largest z).
const TAG_HEIGHT = 1.5
const BAR_W = 1.0 // health-bar width (metres)
const BAR_H = 0.24
const BAR_Y = -0.3 // bar sits just below the name
const FRAME_COLOR = Color4.create(0.06, 0.09, 0.13, 1) // dark border rim
const TRACK_COLOR = Color4.create(0.16, 0.2, 0.26, 0.95) // empty-bar background
const FILL_COLOR = Color4.create(0.45, 0.78, 0.98, 1) // celeste health fill
type HealthTag = { root: Entity; label: Entity; frame: Entity; track: Entity; fill: Entity; stageLabel: Entity; name: string; frac: number; stage: string }

// The player's NON-active stored pets roam the care area on their own.
type Roamer = { entity: Entity; species: string; tag: HealthTag; home: Vector3; target: Vector3 | null; pause: number }
const inactivePets = new Map<string, Roamer>()

// Each owned pet gets its OWN home slot so up-to-4 pets never pile up on the same
// spot. Slots are spread across the care area (objects sit ~x195-214, z235-249);
// a stored pet roams a little around its slot, and the active pet parks on its
// slot while you carry/hatch a new egg so the newborn won't overlap it.
const PET_SLOT_HOMES: Vector3[] = [
  Vector3.create(200, C.PET_BASE_Y, 239),
  Vector3.create(206, C.PET_BASE_Y, 239),
  Vector3.create(200, C.PET_BASE_Y, 245),
  Vector3.create(206, C.PET_BASE_Y, 245)
]
function slotHome(index: number): Vector3 {
  const s = PET_SLOT_HOMES[((index % PET_SLOT_HOMES.length) + PET_SLOT_HOMES.length) % PET_SLOT_HOMES.length]
  return Vector3.create(s.x, s.y, s.z)
}
/** Index of the currently-shown active pet within the roster (-1 if none). */
function activePetSlotIndex(): number {
  const p = clientState.player
  const id = clientState.activePet?.id
  return p && id ? p.pets.findIndex((x) => x.id === id) : -1
}

let localTag: HealthTag | null = null
const remoteTags = new Map<string, HealthTag>()

/** Average of the four stats, normalized 0..1 (the pet's "health"). */
function healthFrac(pet: PetData): number {
  return Math.max(0, Math.min(1, petCondition(pet) / 100))
}

function makeTag(): HealthTag {
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.create(0, TAG_HEIGHT, 0) })
  Billboard.create(root, {})

  const label = engine.addEntity()
  Transform.create(label, { position: Vector3.create(0, 0.16, 0), parent: root })
  TextShape.create(label, {
    text: '',
    fontSize: 2.2,
    textColor: { r: 1, g: 0.95, b: 0.8, a: 1 },
    outlineColor: { r: 0.1, g: 0.07, b: 0.04 },
    outlineWidth: 0.25
  })

  // Dark border rim (furthest from camera -> largest z).
  const frame = engine.addEntity()
  Transform.create(frame, { position: Vector3.create(0, BAR_Y, 0.03), scale: Vector3.create(BAR_W + 0.06, BAR_H + 0.06, 1), parent: root })
  MeshRenderer.setPlane(frame)
  Material.setPbrMaterial(frame, { albedoColor: FRAME_COLOR })

  // Empty-bar background (the "not filled" part shows through here).
  const track = engine.addEntity()
  Transform.create(track, { position: Vector3.create(0, BAR_Y, 0.02), scale: Vector3.create(BAR_W, BAR_H, 1), parent: root })
  MeshRenderer.setPlane(track)
  Material.setPbrMaterial(track, { albedoColor: TRACK_COLOR })

  // Celeste health fill (shrinks from the left as condition drops).
  const fill = engine.addEntity()
  Transform.create(fill, { position: Vector3.create(0, BAR_Y, 0.01), scale: Vector3.create(BAR_W, BAR_H, 1), parent: root })
  MeshRenderer.setPlane(fill)
  Material.setPbrMaterial(fill, { albedoColor: FILL_COLOR })

  // Growth-stage text (JUNIOR / TEEN / ADULT) across the bar: white with a
  // black outline. NEGATIVE z so it sits in FRONT of the bar (toward camera).
  const stageLabel = engine.addEntity()
  Transform.create(stageLabel, { position: Vector3.create(0, BAR_Y, -0.05), parent: root })
  TextShape.create(stageLabel, {
    text: '',
    fontSize: 1.4,
    textColor: { r: 1, g: 1, b: 1, a: 1 },
    outlineColor: { r: 0, g: 0, b: 0 },
    outlineWidth: 0.3
  })

  return { root, label, frame, track, fill, stageLabel, name: '', frac: -1, stage: '' }
}

/** Reposition the tag over the pet, refresh its name + health fill + stage text. */
function updateTag(tag: HealthTag, pos: Vector3, size: number, name: string, frac: number, stage: string): void {
  Transform.getMutable(tag.root).position = Vector3.create(pos.x, TAG_HEIGHT + size, pos.z)
  if (name !== tag.name) {
    TextShape.getMutable(tag.label).text = name
    tag.name = name
  }
  if (stage !== tag.stage) {
    TextShape.getMutable(tag.stageLabel).text = stage
    tag.stage = stage
  }
  const f = Math.max(0, Math.min(1, frac))
  if (Math.abs(f - tag.frac) > 0.01) {
    tag.frac = f
    // Plane is centered, so anchor the fill to the left edge as it shrinks.
    Transform.getMutable(tag.fill).scale = Vector3.create(BAR_W * f, BAR_H, 1)
    Transform.getMutable(tag.fill).position = Vector3.create((-BAR_W * (1 - f)) / 2, BAR_Y, 0.01)
  }
}

/** Remove a tag and all its child entities. */
function removeTag(tag: HealthTag): void {
  engine.removeEntity(tag.stageLabel)
  engine.removeEntity(tag.fill)
  engine.removeEntity(tag.track)
  engine.removeEntity(tag.frame)
  engine.removeEntity(tag.label)
  engine.removeEntity(tag.root)
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

/** World scale for a pet = grown size × its species multiplier. */
function petScale(species: string, size: number): Vector3 {
  return Vector3.scale(Vector3.One(), size * scaleForSpecies(species))
}
function distFlat(a: Vector3, b: Vector3): number {
  return Vector3.distance(flat(a), flat(b))
}
function yawToward(from: Vector3, to: Vector3, offsetDeg = 0): Quaternion {
  const dx = to.x - from.x
  const dz = to.z - from.z
  if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return Quaternion.Identity()
  const yaw = (Math.atan2(dx, dz) * 180) / Math.PI
  return Quaternion.fromEulerDegrees(0, yaw + offsetDeg, 0)
}

/** Move entity toward dest; returns the distance actually moved this frame.
 *  `yawOffset` corrects models whose forward axis isn't the walk direction. */
function stepToward(entity: Entity, dest: Vector3, dt: number, yawOffset = 0): number {
  const t = Transform.getMutable(entity)
  const cur = t.position
  const d = distFlat(cur, dest)
  if (d <= C.PET_ARRIVE_DISTANCE) return 0
  const dir = Vector3.normalize(Vector3.subtract(flat(dest), flat(cur)))
  const step = Math.min(d, C.PET_MOVE_SPEED * dt)
  t.position = Vector3.add(flat(cur), Vector3.scale(dir, step))
  t.rotation = yawToward(cur, dest, yawOffset)
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
  return mode === 'goto' || mode === 'interact' || mode === 'bathhop'
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
      removeTag(localTag)
      localTag = null
    }
    return
  }
  if (!localPet) {
    localPet = engine.addEntity()
    Transform.create(localPet, { position: Vector3.create(197.2, C.PET_BASE_Y, 229.8), scale: petScale(pet.species, stageScaleFor(pet.size)) })
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
  const s = petScale(pet.species, stageScaleFor(pet.size))
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

// ---------------------------------------------------------------------------
// Pet gesture (Adopt-Me style): lock the camera on the pet, then swipe left/right
// across the screen (the pet is centered, so it reads as petting it) for a few
// seconds. A dedicated virtual camera frames the pet; the avatar is frozen.
// ---------------------------------------------------------------------------
let petCam: Entity | null = null

/** Enter petting mode: frame the pet, face it to camera, freeze the avatar. */
export function startPetting(): void {
  if (!clientState.activePet || !localPet) return
  clientState.petting.active = true
  clientState.petting.progress = 0

  const petPos = Transform.get(localPet).position
  // Camera sits a few metres out and slightly up, looking straight at the pet.
  const camPos = Vector3.create(petPos.x, petPos.y + 1.15, petPos.z + 2.8)
  if (!petCam) petCam = engine.addEntity()
  Transform.createOrReplace(petCam, { position: camPos })
  VirtualCamera.createOrReplace(petCam, { lookAtEntity: localPet })
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: petCam })

  // Turn the pet to face the camera so we see its front, and freeze it there.
  Transform.getMutable(localPet).rotation = yawToward(petPos, camPos, yawOffsetForSpecies(clientState.activePet.species))
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
}

/** Hand the camera + avatar control back to the player. */
function releasePettingView(): void {
  if (MainCamera.has(engine.CameraEntity)) MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
  if (InputModifier.has(engine.PlayerEntity)) InputModifier.deleteFrom(engine.PlayerEntity)
}

/** Leave petting mode without completing (BACK button). */
export function cancelPetting(): void {
  clientState.petting.active = false
  clientState.petting.progress = 0
  releasePettingView()
}

/** Finish petting: reward happiness, restore the view, exit petting mode. */
function completePetting(): void {
  const st = clientState.petting
  st.active = false
  st.progress = 0
  releasePettingView()
  const pet = clientState.activePet
  if (pet) pet.happiness = Math.min(100, pet.happiness + C.PET_SELF_HAPPINESS)
  actions.petSelf() // server is authoritative; this is the "happiness" action
  petReact()
  pushToast('Your pet loved that!  +Happy')
}

/**
 * Register a tap on the pet (mobile fill). Called from the overlay's onMouseDown
 * because quick taps don't reliably register via isPressed polling.
 */
export function petTap(): void {
  const st = clientState.petting
  if (!st.active) return
  st.progress += C.PET_TAP_FILL
  if (st.progress >= 1) completePetting()
}

/**
 * Shared gesture fill (petting + hatching). Desktop/Bevy fills by swiping
 * (screenDelta); mobile only ebbs here — taps are added by the UI (petTap /
 * hatchTap) because quick taps don't register via isPressed polling.
 */
function gestureFill(progress: number, dt: number): number {
  const rate = dt / C.PET_GESTURE_SECONDS
  if (mobile()) {
    progress -= rate * C.PET_GESTURE_DECAY_FACTOR
  } else {
    const pressed = inputSystem.isPressed(InputAction.IA_POINTER)
    const info = PrimaryPointerInfo.getOrNull(engine.RootEntity)
    const dx = Math.abs(info?.screenDelta?.x ?? 0)
    const dpr = UiCanvasInformation.getOrNull(engine.RootEntity)?.devicePixelRatio || 1
    const swiping = pressed && dx > C.PET_SWIPE_EPS * dpr
    progress += swiping ? rate : -rate * C.PET_GESTURE_DECAY_FACTOR
  }
  return Math.max(0, Math.min(1, progress))
}

/** Per-frame petting update. Completing rewards happiness. */
function updatePetting(dt: number): void {
  const st = clientState.petting
  if (!st.active) return
  if (!clientState.activePet || !localPet) {
    cancelPetting()
    return
  }
  st.progress = gestureFill(st.progress, dt)
  if (st.progress >= 1) completePetting()
}

// ---------------------------------------------------------------------------
// Hatching — on adoption an egg appears; rubbing/tapping it (same gesture as
// petting) hatches the pet. The server isn't told until the egg hatches, so a
// snapshot can't reveal the pet early.
// ---------------------------------------------------------------------------
const EGG_MODEL = 'models/stylized_dino_egg.glb'
// Timings synced to the egg's `Hatch` clip (2.0s one-shot): the shell opens and
// reveals the interior at ~1.4s, and is fully gone at 2.0s.
const HATCH_ANIM_SECONDS = 2.0 // total Hatch clip length -> when the egg is removed
const PET_EMERGE_AT = 1.4 // when the pet pops out (egg is open)
const HATCH_POP_SECONDS = HATCH_ANIM_SECONDS - PET_EMERGE_AT // pop lasts until the egg is gone
const HATCH_ADMIRE_SECONDS = 1.2 // camera lingers on the newborn before handing back control
let egg: Entity | null = null
let hatchSpecies = ''
let hatchName = ''
let hatchPopT = 0 // >0 while the freshly-hatched pet is popping in
let hatchRevealPos: Vector3 | null = null // where the pet emerges (the egg's spot)
let hatchAnimT = 0 // elapsed time since the Hatch clip started
let hatchRevealed = false // pet already popped out this hatch?
let hatchEggRemoved = false // egg entity already removed this hatch?
let hatchFocus: Entity | null = null // invisible, fixed point at the egg's spot the camera stays locked on

// --- Carrying the egg home ------------------------------------------------
// On adoption the egg is attached above the avatar; the player walks it home,
// where a Hatch button starts the rub-to-hatch flow below.
let carriedEgg: Entity | null = null // the egg mesh (child)
let carriedEggAnchor: Entity | null = null // empty attached to the hand bone
// Offset of the egg from the hand bone origin, and its scale in hand. Tune these.
const EGG_HAND_OFFSET = Vector3.create(0.14, 0.1, 0.03)
const EGG_HAND_SCALE = 0.6 // back to the previous size (looks big in hand, that's fine)
// Rotation of the egg in hand (euler degrees). Tune to point the tip up (^).
const EGG_HAND_ROTATION = Quaternion.fromEulerDegrees(90, 0, 0)
// Looping "hold" emote played while carrying (poses the arms as if cradling the
// egg). Masked to the upper body so the legs keep using normal walk/run
// locomotion — the emote is not cancelled by movement.
// Scene emotes must end in '_emote.glb' (Unity enforces this naming convention).
const HOLD_EMOTE = 'models/hold_emote.glb'

function playHoldEmote(): void {
  void triggerSceneEmote({ src: HOLD_EMOTE, loop: true, mask: AvatarMask.AM_UPPER_BODY }).catch(() => {})
}

// ---------------------------------------------------------------------------
// Holding the pet in hand — attached to the player's lower-spine bone
// (AvatarAttach), same approach as the carried egg. A manually-computed world
// position (read from the player's Transform each frame) lagged behind the
// avatar and looked jittery/stuck at running speed; bone attachment is
// resolved by the renderer every render frame, so it stays smooth. The name/
// health tag is just hidden for the duration — its absolute world-unit size
// reads huge up close on the player's chest, and there's no good spot for it
// there. It reappears (at its normal position/scale) as soon as the pet is
// back in world space. Tune the bone-local offset below (approximate — verify
// against the actual rig in-world and nudge as needed).
// ---------------------------------------------------------------------------
const HOLD_PET_EMOTE = 'models/hold_pet_emote.glb'
const PET_HOLD_OFFSET = Vector3.create(0, -0.15, 0.22) // local offset from the spine bone, out in front and down toward the belly
const PET_HOLD_YAW = 0 // extra yaw if the model faces the wrong way (0/90/180/270)
const PET_HAND_SCALE = 0.4
const BATH_RADIUS = 3 // how close to the tub before the Bath button appears

let carriedPetAnchor: Entity | null = null

function playHoldPetEmote(): void {
  void triggerSceneEmote({ src: HOLD_PET_EMOTE, loop: true, mask: AvatarMask.AM_UPPER_BODY }).catch(() => {})
}

/** Parent the pet to the player's spine bone, offset out in front (carrying pose); hide its tag. */
function attachPetToHands(species: string): void {
  if (!localPet) return
  if (!carriedPetAnchor) carriedPetAnchor = engine.addEntity()
  Transform.createOrReplace(carriedPetAnchor, {})
  AvatarAttach.createOrReplace(carriedPetAnchor, { anchorPointId: AvatarAnchorPointType.AAPT_SPINE })
  const t = Transform.getMutable(localPet)
  t.parent = carriedPetAnchor
  t.position = PET_HOLD_OFFSET
  t.rotation = Quaternion.fromEulerDegrees(0, yawOffsetForSpecies(species) + PET_HOLD_YAW, 0)
  // Scale is re-applied every frame in the carryPet branch below — ensureLocalPet()
  // runs first each tick and would otherwise snap it back to the grown size.
  if (localTag) {
    VisibilityComponent.createOrReplace(localTag.root, { visible: false, propagateToChildren: true })
    // The bar's plane meshes (frame/track/fill) respect the propagated visibility, but
    // TextShape doesn't — clear the text directly, and reset the cache so updateTag's
    // diff-check (name !== tag.name) is forced to re-write it once the tag reappears.
    TextShape.getMutable(localTag.label).text = ''
    TextShape.getMutable(localTag.stageLabel).text = ''
    localTag.name = ''
    localTag.stage = ''
  }
}

/** Detach the pet back into world space (place at the tub, or cancel the carry); restore its tag. */
function detachPetFromHands(): void {
  if (localPet) Transform.getMutable(localPet).parent = engine.RootEntity
  if (localTag) VisibilityComponent.createOrReplace(localTag.root, { visible: true, propagateToChildren: true })
}

/** Bath step 1: pick the pet up into the player's hands to carry it to the tub. */
export function startCarryPet(): void {
  if (!clientState.activePet || !localPet) return
  clientState.carryPet = { active: true, atStation: false }
  attachPetToHands(clientState.activePet.species)
  playHoldPetEmote()
  showArrowTo(objectPosition(EntityNames.PetPool_glb))
}

/** Cancel the bath carry (BACK): drop the flow, the pet just resumes following. */
export function cancelCarryPet(): void {
  if (!clientState.carryPet.active) return
  clientState.carryPet = { active: false, atStation: false }
  detachPetFromHands()
  void stopEmote({}).catch(() => {}) // drop the hold pose, pet is no longer in hand
  hideArrow()
}

/** Bath step 2: place the pet in the tub and run the clean action. */
export function placePetAtStation(): void {
  if (!clientState.carryPet.active) return
  clientState.carryPet = { active: false, atStation: false }
  detachPetFromHands()
  void stopEmote({}).catch(() => {}) // drop the hold pose, pet is no longer in hand
  hideArrow()
  if (localPet) {
    const t = Transform.getMutable(localPet)
    t.position = flat(objectPosition(EntityNames.PetPool_glb))
    t.rotation = Quaternion.Identity()
  }
  petReact() // happy splash at the tub
  justBathed = true // hop out of the tub instead of walking straight through its rim
  applyCareLocal('clean', false) // optimistic local effect
  actions.care('clean', false) // server is authoritative
  pushToast('Bath time!  +Hygiene')
}

// ---------------------------------------------------------------------------
// Ground arrow guide — a flowing arrow on the floor that points from the player
// toward a destination (e.g. home while carrying the egg). Reusable: set a target
// with showArrowTo(), clear it with hideArrow().
// ---------------------------------------------------------------------------
const ARROW_MODEL = 'models/arrow_indicator.glb'
const ARROW_LEAD = 1 // metres ahead of the player, toward the target
const ARROW_LOCAL_Y = 0.05 // just above the player's feet (local, since it's parented to the player)
const ARROW_YAW_OFFSET = 180 // model points backwards; flip it to point at the target
const ARROW_SCALE = 1 // tune the arrow size
let arrow: Entity | null = null
let arrowTarget: Vector3 | null = null

export function showArrowTo(target: Vector3): void {
  arrowTarget = target
}
export function hideArrow(): void {
  arrowTarget = null
}

// Parented to the player (body-fixed, same trick as AvatarAttach) instead of
// positioned each frame from a world-space read of the player's Transform — that
// read lags behind the avatar's actual (render-smooth) movement and looked
// jittery/stuck while running, same root cause the carried pet had before it was
// switched to AvatarAttach. With native parenting the renderer supplies the
// player's *current* position every render frame; we only ever compute the
// (slowly-changing) bearing to the target, expressed as a small local offset/yaw.
function updateArrow(): void {
  if (!arrow) {
    arrow = engine.addEntity()
    Transform.create(arrow, { parent: engine.PlayerEntity, scale: Vector3.scale(Vector3.One(), ARROW_SCALE) })
    GltfContainer.create(arrow, { src: ARROW_MODEL })
    Animator.create(arrow, { states: [{ clip: 'flow', playing: true, loop: true }] })
    VisibilityComponent.create(arrow, { visible: false })
  }
  const vis = VisibilityComponent.getMutable(arrow)

  if (!arrowTarget) {
    if (vis.visible) vis.visible = false
    return
  }
  const pt = Transform.getOrNull(engine.PlayerEntity)
  if (!pt) return
  const dx = arrowTarget.x - pt.position.x
  const dz = arrowTarget.z - pt.position.z
  if (dx * dx + dz * dz < 0.01) {
    if (vis.visible) vis.visible = false
    return
  }
  // World bearing to the target, then the player's own current facing — both via
  // atan2(x,z), DCL's yaw convention — so we can express the arrow's pose in the
  // PLAYER's local frame (localYaw = worldYaw - playerYaw). Parented, that local
  // pose combines with the renderer's own current (smooth) player transform.
  const worldYaw = (Math.atan2(dx, dz) * 180) / Math.PI
  const fwd = Vector3.rotate(Vector3.create(0, 0, 1), pt.rotation)
  const playerYaw = (Math.atan2(fwd.x, fwd.z) * 180) / Math.PI
  const localYaw = worldYaw - playerYaw
  const rad = (localYaw * Math.PI) / 180
  const t = Transform.getMutable(arrow)
  t.position = Vector3.create(Math.sin(rad) * ARROW_LEAD, ARROW_LOCAL_Y, Math.cos(rad) * ARROW_LEAD)
  t.rotation = Quaternion.fromEulerDegrees(0, localYaw + ARROW_YAW_OFFSET, 0)
  t.scale = Vector3.scale(Vector3.One(), ARROW_SCALE)
  if (!vis.visible) vis.visible = true
}

/** Adopt handoff: give the player an egg to carry home (held in the hand). */
export function startCarryEgg(species: string, name: string): void {
  clientState.carryEgg = { active: true, species, name, atHome: false }

  // An empty follows the right hand; the egg is a child offset into the palm.
  if (!carriedEggAnchor) carriedEggAnchor = engine.addEntity()
  Transform.createOrReplace(carriedEggAnchor, {})
  AvatarAttach.createOrReplace(carriedEggAnchor, { anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND })

  if (!carriedEgg) carriedEgg = engine.addEntity()
  Transform.createOrReplace(carriedEgg, { parent: carriedEggAnchor, position: EGG_HAND_OFFSET, rotation: EGG_HAND_ROTATION, scale: Vector3.scale(Vector3.One(), EGG_HAND_SCALE) })
  GltfContainer.createOrReplace(carriedEgg, { src: EGG_MODEL })
  Animator.createOrReplace(carriedEgg, { states: [{ clip: 'Idle', playing: true, loop: true }] })

  playHoldEmote() // pose the arms as if holding the egg

  openDialog('Your Egg', ['Take it home and hatch it! Walk back to your house, then tap Hatch.'], 'Got it!')
}

/** Per-frame while carrying: flag whether the player is home (drives the button). */
function updateCarryEgg(): void {
  const st = clientState.carryEgg
  if (!st.active) return
  const pp = playerPos()
  const home = objectPosition(EntityNames.Dome01_glb)
  st.atHome = distFlat(pp, home) <= C.HOME_RADIUS
  // Guide arrow points home until you're there (where the Hatch button shows).
  if (st.atHome) hideArrow()
  else showArrowTo(home)
}

/** Hatch button pressed at home: drop the carried egg and start the rub flow. */
export function beginHatchFromCarry(): void {
  const st = clientState.carryEgg
  if (!st.active) return
  const { species, name } = st
  if (carriedEgg) {
    engine.removeEntity(carriedEgg)
    carriedEgg = null
  }
  if (carriedEggAnchor) {
    engine.removeEntity(carriedEggAnchor)
    carriedEggAnchor = null
  }
  clientState.carryEgg = { active: false, species: '', name: '', atHome: false }
  void stopEmote({}).catch(() => {}) // drop the hold pose, egg is no longer in hand
  hideArrow() // stop guiding home, the egg is no longer being carried
  startHatch(species, name)
}

/** Begin the adoption hatch: spawn the egg (Idle loop), frame it, freeze avatar. */
export function startHatch(species: string, name: string): void {
  hatchSpecies = species
  hatchName = name
  clientState.hatch.active = true
  clientState.hatch.progress = 0
  hatchAnimT = 0
  hatchRevealed = false
  hatchEggRemoved = false

  // Egg a bit in front of the player, framed by a dedicated camera.
  const pp = playerPos()
  const pt = Transform.getOrNull(engine.PlayerEntity)
  const fwd = pt ? Vector3.rotate(Vector3.create(0, 0, 1), pt.rotation) : Vector3.create(0, 0, 1)
  const dir = Vector3.normalize(Vector3.create(fwd.x, 0, fwd.z))
  const eggPos = Vector3.create(pp.x + dir.x * 1.6, C.PET_BASE_Y, pp.z + dir.z * 1.6)
  hatchRevealPos = eggPos

  if (!egg) egg = engine.addEntity()
  Transform.createOrReplace(egg, { position: eggPos, scale: Vector3.One() })
  GltfContainer.createOrReplace(egg, { src: EGG_MODEL })
  Animator.createOrReplace(egg, {
    states: [
      { clip: 'Idle', playing: true, loop: true },
      { clip: 'Hatch', playing: false, loop: false, shouldReset: true }
    ]
  })

  // Invisible focus fixed at the egg's spot (raised to the pet's body). The
  // camera locks onto THIS, not the egg — so when the egg is removed the shot
  // stays put and you watch the pet appear right where the egg opened.
  if (!hatchFocus) hatchFocus = engine.addEntity()
  Transform.createOrReplace(hatchFocus, { position: Vector3.create(eggPos.x, eggPos.y + 0.4, eggPos.z) })

  const camPos = Vector3.create(eggPos.x, eggPos.y + 1.2, eggPos.z + 2.6)
  if (!petCam) petCam = engine.addEntity()
  Transform.createOrReplace(petCam, { position: camPos })
  VirtualCamera.createOrReplace(petCam, { lookAtEntity: hatchFocus })
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: petCam })
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
}

/** Bar full: play the Hatch clip and start the reveal timeline. */
function startHatchAnim(): void {
  clientState.hatch.progress = 1
  hatchAnimT = 0
  if (egg) {
    const a = Animator.getMutable(egg)
    for (const s of a.states) s.playing = s.clip === 'Hatch' // Idle -> Hatch (one-shot)
  }
}

/** Reveal the pet (~when the egg opens): tell the server, pop it in at the egg. */
function revealHatchedPet(): void {
  hatchRevealed = true
  adoptPet(hatchSpecies, hatchName) // pet now exists + the server is told
  hatchPopT = HATCH_POP_SECONDS
  pushToast(`Your ${speciesLabel(hatchSpecies)} hatched!`)
}

/** Admire beat over: hand the camera + avatar control back to the player. */
function finishHatch(): void {
  clientState.hatch.active = false
  clientState.hatch.progress = 0
  if (egg) {
    engine.removeEntity(egg)
    egg = null
  }
  if (hatchFocus) {
    engine.removeEntity(hatchFocus)
    hatchFocus = null
  }
  releasePettingView() // release camera + avatar (shared helper)
  hatchRevealPos = null
}

/** Register a tap on the egg (mobile fill) — see petTap for the why. */
export function hatchTap(): void {
  const st = clientState.hatch
  if (!st.active || st.progress >= 1) return // ignore taps once it's hatching
  st.progress += C.PET_TAP_FILL
  if (st.progress >= 1) startHatchAnim()
}

/** Per-frame hatch update: rub to fill (progress<1), then run the Hatch timeline. */
function updateHatch(dt: number): void {
  const st = clientState.hatch
  if (!st.active) return

  if (st.progress < 1) {
    // Still rubbing — Idle loops on the egg; fill the bar.
    st.progress = gestureFill(st.progress, dt)
    if (st.progress >= 1) startHatchAnim()
    return
  }

  // Hatching timeline: reveal the pet as the egg opens, remove the egg once the
  // Hatch clip ends (camera is already on the pet, so no jump), then let the
  // camera linger on the newborn before handing control back.
  hatchAnimT += dt
  if (!hatchRevealed && hatchAnimT >= PET_EMERGE_AT) revealHatchedPet()
  if (!hatchEggRemoved && hatchAnimT >= HATCH_ANIM_SECONDS) {
    hatchEggRemoved = true
    if (egg) {
      engine.removeEntity(egg)
      egg = null
    }
  }
  if (hatchAnimT >= HATCH_ANIM_SECONDS + HATCH_ADMIRE_SECONDS) finishHatch()
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
  return localPet ? stepToward(localPet, wanderTarget, dt, yawOffsetForSpecies(clientState.activePet?.species ?? '')) : 0
}

function updateLocalPet(dt: number): void {
  ensureLocalPet()
  if (!localPet) return

  // While carrying a new egg (or hatching it, before the newborn emerges), send
  // the CURRENT pet to its home slot and park it there. This clears the hatch
  // spot in front of the player so the new pet won't spawn on top of this one.
  if ((clientState.carryEgg.active || (clientState.hatch.active && !hatchRevealed)) && clientState.activePet) {
    const petP = clientState.activePet
    const idx = activePetSlotIndex()
    // Only walk to a slot if this pet actually has one; otherwise just idle in
    // place (never fall back to slot 0, which another pet may already occupy).
    const moved = idx >= 0 ? stepToward(localPet, slotHome(idx), dt, yawOffsetForSpecies(petP.species)) : 0
    setClip(localPet, moved > 0.003 ? 'walk' : 'idle')
    if (localTag) updateTag(localTag, Transform.get(localPet).position, stageScaleFor(petP.size), petP.name, healthFrac(petP), petStage(petP.size))
    return
  }

  // During the hatch sequence: keep the newborn at the egg's spot playing idle,
  // pop its scale in, and re-point the camera from the egg onto the pet so there's
  // no jump when the egg is removed. Normal behavior resumes once hatch ends.
  if (clientState.hatch.active && clientState.activePet) {
    const petH = clientState.activePet
    const full = petScale(petH.species, stageScaleFor(petH.size))
    if (hatchPopT > 0) hatchPopT -= dt
    const f = hatchPopT > 0 ? Math.max(0.05, 1 - hatchPopT / HATCH_POP_SECONDS) : 1 // 0 -> 1
    const t = Transform.getMutable(localPet)
    t.scale = Vector3.scale(full, f)
    if (hatchRevealPos) t.position = flat(hatchRevealPos)
    setClip(localPet, 'idle')
    // Camera stays locked on hatchFocus (the egg's spot) — no retarget needed.
    if (localTag) updateTag(localTag, t.position, stageScaleFor(petH.size), petH.name, healthFrac(petH), petStage(petH.size))
    return
  }

  // Carrying the pet to the bath: it's attached to the player's spine bone (see
  // attachPetToHands), so its pose is handled by the renderer. Its tag is hidden
  // for the duration (attachPetToHands/detachPetFromHands) — here we just flag
  // proximity to the tub.
  if (clientState.carryPet.active && clientState.activePet) {
    Transform.getMutable(localPet).scale = Vector3.scale(Vector3.One(), PET_HAND_SCALE)
    setClip(localPet, 'idle')
    const pp = playerPos()
    clientState.carryPet.atStation = distFlat(pp, objectPosition(EntityNames.PetPool_glb)) <= BATH_RADIUS
    return
  }

  // While the hold-to-pet overlay is up, the pet stays put and plays its happy
  // gesture — the whole focus is on petting it.
  if (clientState.petting.active) {
    setClip(localPet, 'gesture-positive')
    if (localTag) {
      const petT = clientState.activePet
      updateTag(
        localTag,
        Transform.get(localPet).position,
        petT ? stageScaleFor(petT.size) : 0.55,
        petT ? petT.name : '',
        petT ? healthFrac(petT) : 0,
        petT ? petStage(petT.size) : ''
      )
    }
    return
  }

  let moved = 0
  let moveClip = 'walk'

  switch (mode) {
    case 'follow': {
      const dest = followTarget()
      if (distFlat(playerPos(), Transform.get(localPet).position) > C.PET_FOLLOW_DISTANCE + 0.5) {
        moved = stepToward(localPet, dest, dt, yawOffsetForSpecies(clientState.activePet?.species ?? ''))
      }
      break
    }
    case 'wander': {
      moved = updateWander(dt)
      break
    }
    case 'goto': {
      moveClip = 'run'
      moved = stepToward(localPet, target, dt, yawOffsetForSpecies(clientState.activePet?.species ?? ''))
      if (distFlat(Transform.get(localPet).position, target) <= C.PET_ARRIVE_DISTANCE) {
        mode = 'interact'
        interactTimer = 1.1
        if (onArrive) {
          // Capture + clear BEFORE calling: the callback may chain another
          // sendPetTo (setting a new onArrive) that we must not clobber.
          const cb = onArrive
          onArrive = null
          cb()
        }
      }
      break
    }
    case 'interact': {
      interactTimer -= dt
      if (interactTimer <= 0) {
        if (justBathed) {
          justBathed = false
          bathHopT = BATH_HOP_DURATION
          bathHopFrom = Transform.get(localPet).position
          mode = 'bathhop'
        } else {
          mode = clientState.followEnabled ? 'follow' : 'wander'
        }
      }
      break
    }
    case 'bathhop': {
      bathHopT -= dt
      const hopT = Math.min(1, 1 - Math.max(0, bathHopT) / BATH_HOP_DURATION)
      const toward = Vector3.subtract(flat(followTarget()), flat(bathHopFrom))
      const away = Vector3.lengthSquared(toward) > 0.01 ? Vector3.normalize(toward) : Vector3.create(0, 0, 1)
      const horizontal = Vector3.add(flat(bathHopFrom), Vector3.scale(away, BATH_HOP_DISTANCE * hopT))
      const pt = Transform.getMutable(localPet)
      pt.position = Vector3.create(horizontal.x, C.PET_BASE_Y + Math.sin(hopT * Math.PI) * BATH_HOP_HEIGHT, horizontal.z)
      const awayYaw = (Math.atan2(away.x, away.z) * 180) / Math.PI
      pt.rotation = Quaternion.fromEulerDegrees(0, awayYaw + yawOffsetForSpecies(clientState.activePet?.species ?? ''), 0)
      moved = 1 // plays the walk clip below instead of idle
      if (bathHopT <= 0) mode = clientState.followEnabled ? 'follow' : 'wander'
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
    updateTag(
      localTag,
      Transform.get(localPet).position,
      pet2 ? stageScaleFor(pet2.size) : 0.55,
      pet2 ? pet2.name : '',
      pet2 ? healthFrac(pet2) : 0,
      pet2 ? petStage(pet2.size) : ''
    )
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
      Transform.create(ent, { position: Vector3.create(ownerPos.x - 2, C.PET_BASE_Y, ownerPos.z - 2), scale: petScale(entry.species, stageScaleFor(entry.size)) })
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
    const s = petScale(entry.species, stageScaleFor(entry.size))
    if (t.scale.x !== s.x) t.scale = s
    // Follow the owner only if their pet is currently following them; otherwise
    // it stays put (mirrors the owner having dismissed it).
    const following = entry.following !== false
    let moved = 0
    if (following) {
      const dest = Vector3.create(ownerPos.x - 2, C.PET_BASE_Y, ownerPos.z - 2)
      moved = distFlat(t.position, dest) > 0.5 ? stepToward(ent, dest, dt, yawOffsetForSpecies(entry.species)) : 0
    }
    setClip(ent, moved > 0.003 ? 'walk' : 'idle')

    const tag = remoteTags.get(addr)
    if (tag) updateTag(tag, t.position, stageScaleFor(entry.size), entry.name, entry.mood / 100, petStage(entry.size))
  }

  for (const [addr, ent] of remotePets) {
    if (!seen.has(addr)) {
      engine.removeEntity(ent)
      remotePets.delete(addr)
      remoteSpecies.delete(addr)
      curClip.delete(ent)
      const tag = remoteTags.get(addr)
      if (tag) {
        removeTag(tag)
        remoteTags.delete(addr)
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
    // Exclude the pet currently shown as the ACTIVE localPet (which may be the
    // pending hatchling, not yet in p.pets) — never by activePetId, or a pet
    // would vanish during the hatch window.
    const shownId = clientState.activePet?.id
    for (let index = 0; index < p.pets.length; index++) {
      const pet = p.pets[index]
      if (pet.id === shownId) continue
      wanted.add(pet.id)
      const home = slotHome(index) // this pet's fixed slot

      let st = inactivePets.get(pet.id)
      if (!st) {
        const e = engine.addEntity()
        Transform.create(e, { position: home, scale: petScale(pet.species, stageScaleFor(pet.size)) })
        GltfContainer.createOrReplace(e, { src: modelForSpecies(pet.species), visibleMeshesCollisionMask: ColliderLayer.CL_POINTER })
        ensureAnimator(e)
        const petId = pet.id
        pointerEventsSystem.onPointerDown(
          { entity: e, opts: { button: InputAction.IA_POINTER, hoverText: `Select ${pet.name}`, maxDistance: 8 } },
          () => switchActivePet(petId)
        )
        st = { entity: e, species: pet.species, tag: makeTag(), home, target: null, pause: Math.random() * 2 }
        inactivePets.set(pet.id, st)
      }
      st.home = home // keep anchored to its slot even if the roster reorders
      if (st.species !== pet.species) {
        st.species = pet.species
        GltfContainer.createOrReplace(st.entity, { src: modelForSpecies(pet.species), visibleMeshesCollisionMask: ColliderLayer.CL_POINTER })
      }

      // Wander in a SMALL radius around its slot, so it stays in its own spot.
      let moved = 0
      if (st.pause > 0) {
        st.pause -= dt
      } else if (!st.target || distFlat(Transform.get(st.entity).position, st.target) <= C.PET_ARRIVE_DISTANCE) {
        if (st.target) {
          st.target = null
          st.pause = 1.5 + Math.random() * 3
        } else {
          const r = 0.6 + Math.random() * 1.0
          const ang = Math.random() * Math.PI * 2
          st.target = Vector3.create(st.home.x + Math.cos(ang) * r, C.PET_BASE_Y, st.home.z + Math.sin(ang) * r)
        }
      } else {
        moved = stepToward(st.entity, st.target, dt, yawOffsetForSpecies(pet.species))
      }
      setClip(st.entity, moved > 0.003 ? 'walk' : 'idle')

      const t = Transform.getMutable(st.entity)
      const s = petScale(pet.species, stageScaleFor(pet.size))
      if (t.scale.x !== s.x) t.scale = s
      updateTag(st.tag, t.position, stageScaleFor(pet.size), pet.name, healthFrac(pet), petStage(pet.size))
    }
  }

  for (const [id, st] of inactivePets) {
    if (!wanted.has(id)) {
      engine.removeEntity(st.entity)
      removeTag(st.tag)
      curClip.delete(st.entity)
      inactivePets.delete(id)
    }
  }
}

export function setupPetSystems(): void {
  engine.addSystem((dt: number) => {
    updateCarryEgg()
    updateArrow()
    updateHatch(dt)
    updatePetting(dt)
    updateLocalPet(dt)
    updateInactivePets(dt)
    updateRemotePets(dt)
  })
}
