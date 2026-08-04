// Makes the Caretaker robot gently float — a continuous up/down bob around its
// placed position, so it always looks like it's hovering.

import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { EntityNames } from '../../assets/scene/entity-names'

const FLOAT_AMPLITUDE = 0.15 // metres up/down from the base position
const FLOAT_SPEED = 1.8 // radians/sec (period ≈ 3.5s)

export function setupCaretakerFloat(): void {
  let base: Vector3 | null = null // the Caretaker's placed position (captured once)
  let t = 0

  engine.addSystem((dt: number) => {
    const e = engine.getEntityOrNullByName(EntityNames.Caretaker)
    if (!e || !Transform.has(e)) return // not loaded yet
    const tr = Transform.getMutable(e)
    if (!base) base = Vector3.create(tr.position.x, tr.position.y, tr.position.z)
    t += dt
    tr.position = Vector3.create(base.x, base.y + Math.sin(t * FLOAT_SPEED) * FLOAT_AMPLITUDE, base.z)
  })
}
