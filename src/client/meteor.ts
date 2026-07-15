// Daily meteor reward — Mars reskin of the old "spin". A couple of seconds after
// the scene loads, a meteor falls from the sky (landing anim) and settles into a
// struck idle. Clicking it cracks it open: you get a reward from the spin pool,
// the reward UI shows what you won, and the meteor disappears. Once per day.

import {
  engine,
  Transform,
  GltfContainer,
  Animator,
  VisibilityComponent,
  ColliderLayer,
  pointerEventsSystem,
  InputAction
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { clientState } from './state'
import { meteorAvailable, openMeteor } from './sim'
import { ui } from './ui'

const MODEL = 'assets/scene/Models/meteor_gold.glb'
const LANDING_CLIP = 'meteorLanding'
const IDLE_CLIP = 'meteorStruckIdle'
const FALL_DELAY = 2 // seconds after the scene loads before it falls
const LANDING_DURATION = 4.9 // seconds — from the GLB (meteorLanding ~4.83s)

// Where the meteor lands. Tune freely (meters; scene is 160x160, base 0,0).
const SPAWN = {
  position: Vector3.create(12, 0, 6),
  rotationDeg: Vector3.create(0, 0, 0),
  scale: Vector3.create(0.7, 0.7, 0.7)
}

export function setupMeteor(): void {
  // Only drop the meteor if today's reward hasn't been claimed yet.
  if (!meteorAvailable()) return

  const meteor = engine.addEntity()
  Transform.create(meteor, {
    position: SPAWN.position,
    rotation: Quaternion.fromEulerDegrees(SPAWN.rotationDeg.x, SPAWN.rotationDeg.y, SPAWN.rotationDeg.z),
    scale: SPAWN.scale
  })
  GltfContainer.create(meteor, { src: MODEL, visibleMeshesCollisionMask: ColliderLayer.CL_POINTER })

  // Hidden until it starts falling — otherwise it would sit on the ground during
  // the delay before the landing animation kicks in.
  VisibilityComponent.create(meteor, { visible: false })

  // Nothing plays yet; both clips are staged.
  Animator.create(meteor, {
    states: [
      { clip: LANDING_CLIP, playing: false, loop: false, shouldReset: true },
      { clip: IDLE_CLIP, playing: false, loop: true }
    ]
  })

  let removed = false

  // Click to crack it open: roll the daily reward, show it, remove the meteor.
  pointerEventsSystem.onPointerDown(
    { entity: meteor, opts: { button: InputAction.IA_POINTER, hoverText: 'Explore', maxDistance: 12 } },
    () => {
      if (removed) return
      const res = openMeteor()
      if (!res) return // already claimed today
      removed = true
      clientState.lastSpin = { reward: res.reward, index: res.index, at: Date.now() }
      ui.openMeteorReward()
      engine.removeEntity(meteor)
    }
  )

  // Timeline: wait FALL_DELAY -> reveal + fall -> after landing, settle to idle.
  let t = 0
  let phase = 0 // 0 = waiting, 1 = falling, 2 = settled
  engine.addSystem((dt: number) => {
    if (removed || phase === 2) return
    t += dt
    if (phase === 0 && t >= FALL_DELAY) {
      phase = 1
      t = 0
      VisibilityComponent.getMutable(meteor).visible = true
      Animator.playSingleAnimation(meteor, LANDING_CLIP, true)
    } else if (phase === 1 && t >= LANDING_DURATION) {
      phase = 2
      Animator.playSingleAnimation(meteor, IDLE_CLIP, false)
    }
  })
}
