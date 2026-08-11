// Live positions of named scene objects (PetFeeder, PetBed, PetPool...), placed
// in the Creator Hub editor (assets/scene/main.composite). Read straight from each
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

const ACTION_ENTITY: Partial<Record<CareAction, EntityNames>> = {
  feed: EntityNames.PetFeeder_glb,
  clean: EntityNames.PetPool_glb,
  sleep: EntityNames.PetBed_glb
  // play has no station — it's a thrown-meteorite action (client/play.ts), not a walk-to.
}

/** Which object a care action navigates to, read live from the scene.
 *  Vector3.Zero() for actions with no station (currently: play). */
export function actionObjectPosition(action: CareAction): Vector3 {
  const name = ACTION_ENTITY[action]
  return name ? objectPosition(name) : Vector3.Zero()
}
