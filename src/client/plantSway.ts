// Subtle wind sway for the plants placed in the Creator Hub editor
// (assets/scene/main.composite). Every plant moves, but is randomly assigned
// one of two sway styles (a quicker flutter or a slower, gentler rock) so the
// scene doesn't read as one uniform wall of identical motion. Each plant also
// gets its own phase and slight speed variance on top of its style.

import { engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Quaternion } from '@dcl/sdk/math'
import { EntityNames } from '../../assets/scene/entity-names'

const PLANT_NAMES: EntityNames[] = [
  EntityNames.Plant01_glb,
  EntityNames.Plant01_glb_2,
  EntityNames.Plant01_glb_3,
  EntityNames.Plant01_glb_4,
  EntityNames.Plant01_glb_5,
  EntityNames.Plant01_glb_6,
  EntityNames.Plant01_glb_7,
  EntityNames.Plant01_glb_8,
  EntityNames.Plant01_glb_9,
  EntityNames.Plant01_glb_10,
  EntityNames.Plant01_glb_11,
  EntityNames.Plant01_glb_12,
  EntityNames.Plant02_glb,
  EntityNames.Plant02_glb_2,
  EntityNames.Plant02_glb_3,
  EntityNames.Plant03_glb,
  EntityNames.Plant03_glb_2,
  EntityNames.Plant03_glb_3,
  EntityNames.Plant03_glb_4,
  EntityNames.Plant03_glb_5,
  EntityNames.Plant03_glb_6,
  EntityNames.Plant03_glb_7,
  EntityNames.Plant04_glb,
  EntityNames.Plant04_glb_2,
  EntityNames.Plant05_glb,
  EntityNames.Plant05_glb_2,
  EntityNames.Plant06_glb,
  EntityNames.Plant06_glb_2,
  EntityNames.Plant06_glb_3,
  EntityNames.Plant07_glb,
  EntityNames.Plant07_glb_2,
  EntityNames.Plant07_glb_3,
  EntityNames.Plant07_glb_4,
  EntityNames.Plant07_glb_5,
  EntityNames.Plant07_glb_6,
  EntityNames.Plant07_glb_7
]

interface SwayStyle {
  ampDeg: number
  speed: number
}

// Quicker, slightly wider flutter — the original sway.
const FLUTTER_STYLE: SwayStyle = { ampDeg: 3, speed: 1.2 }
// Slower, gentler rock — roughly a third the speed and half the amplitude.
const ROCK_STYLE: SwayStyle = { ampDeg: 1.5, speed: 0.4 }
const STYLES = [FLUTTER_STYLE, ROCK_STYLE]

interface SwayingPlant {
  entity: Entity
  baseRotation: Quaternion
  style: SwayStyle
  phase: number
  speedScale: number // slight per-plant variance so they don't all move in lockstep
}

export function setupPlantSway(): void {
  const candidates: Entity[] = []
  for (const name of PLANT_NAMES) {
    const entity = engine.getEntityOrNullByName(name)
    if (entity && Transform.has(entity)) candidates.push(entity)
  }

  const plants: SwayingPlant[] = candidates.map((entity) => ({
    entity,
    baseRotation: Transform.get(entity).rotation,
    style: STYLES[Math.floor(Math.random() * STYLES.length)],
    phase: Math.random() * Math.PI * 2,
    speedScale: 0.85 + Math.random() * 0.3 // 0.85x - 1.15x
  }))

  if (plants.length === 0) return

  let elapsed = 0
  engine.addSystem((dt: number) => {
    elapsed += dt
    for (const plant of plants) {
      const t = elapsed * plant.style.speed * plant.speedScale + plant.phase
      const tiltX = Math.sin(t) * plant.style.ampDeg
      const tiltZ = Math.cos(t * 0.7) * plant.style.ampDeg * 0.6
      const tr = Transform.getMutable(plant.entity)
      tr.rotation = Quaternion.multiply(plant.baseRotation, Quaternion.fromEulerDegrees(tiltX, 0, tiltZ))
    }
  })
}
