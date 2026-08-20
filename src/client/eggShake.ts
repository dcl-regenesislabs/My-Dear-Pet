// Subtle constant tremble for the eggs placed in the Creator Hub editor
// (assets/scene/main.composite). Each egg wobbles on its own local Z axis;
// phases are spread out so the eggs don't all shake in sync.

import { engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Quaternion } from '@dcl/sdk/math'
import { EntityNames } from '../../assets/scene/entity-names'

const EGG_NAMES: EntityNames[] = [
  EntityNames.egg_glb,
  EntityNames.egg_glb_2,
  EntityNames.egg_glb_3,
  EntityNames.egg_glb_4,
  EntityNames.egg_glb_5,
  EntityNames.egg_glb_6,
  EntityNames.egg_glb_7,
  EntityNames.egg_glb_8
]

const SHAKE_AMPLITUDE_DEG = 2.5 // small — a tremble, not a wiggle
const SHAKE_SPEED = 5 // radians/sec — constant, not accelerating

interface ShakingEgg {
  entity: Entity
  baseRotation: Quaternion
  phase: number
}

export function setupEggShake(): void {
  const eggs: ShakingEgg[] = []

  EGG_NAMES.forEach((name, i) => {
    const entity = engine.getEntityOrNullByName(name)
    if (!entity || !Transform.has(entity)) return
    eggs.push({
      entity,
      baseRotation: Transform.get(entity).rotation,
      phase: (i / EGG_NAMES.length) * Math.PI * 2 // evenly spread starting phase
    })
  })

  if (eggs.length === 0) return

  let elapsed = 0
  engine.addSystem((dt: number) => {
    elapsed += dt
    for (const egg of eggs) {
      const wobbleDeg = Math.sin(elapsed * SHAKE_SPEED + egg.phase) * SHAKE_AMPLITUDE_DEG
      const t = Transform.getMutable(egg.entity)
      t.rotation = Quaternion.multiply(egg.baseRotation, Quaternion.fromEulerDegrees(0, 0, wobbleDeg))
    }
  })
}
