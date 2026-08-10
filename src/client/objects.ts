// Live positions of named scene objects (Bowl, Bed, Ball, Pond...), placed in
// the Creator Hub editor (assets/scene/main.composite). Read straight from each
// entity's Transform every time, instead of a hardcoded copy in config.ts, so
// moving an object in the editor can never silently desync from where the pet
// walks / where "am I close enough" checks fire.

import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { EntityNames } from '../../assets/scene/entity-names'
import type { CareAction } from '../shared/types'

/** Current world position of a named scene object. Zero() + a console warning
 *  if the entity isn't in the scene (shouldn't happen — these are static). */
export function objectPosition(name: EntityNames): Vector3 {
  const e = engine.getEntityOrNullByName(name)
  if (!e || !Transform.has(e)) {
    console.log('[Client] scene object not found:', name)
    return Vector3.Zero()
  }
  return Transform.get(e).position
}

const ACTION_ENTITY: Record<CareAction, EntityNames> = {
  feed: EntityNames.Bowl,
  clean: EntityNames.Pond,
  sleep: EntityNames.Bed,
  play: EntityNames.Ball
}

/** Which object a care action navigates to, read live from the scene. */
export function actionObjectPosition(action: CareAction): Vector3 {
  return objectPosition(ACTION_ENTITY[action])
}
