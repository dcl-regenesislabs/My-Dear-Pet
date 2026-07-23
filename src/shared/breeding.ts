// Breeding logic. For now: rolling an offspring's cosmetic rarity. Care raises
// the odds (both parents' condition at breeding time), and a random d10 is the
// surprise factor that crowns the tier — so max stats + luck = legendary, but
// neither alone guarantees it. Tuning lives in config (BREEDING_*).
//
// Pure and self-contained: the rest of breeding (the `breed` message, creating
// the offspring, applying the rarity) plugs in on top of this later.

import type { PetData, Rarity } from './types'
import * as C from './config'

/** A pet's overall condition (0-100) — the average of its four care stats. */
export function petCondition(pet: PetData): number {
  return (pet.hunger + pet.hygiene + pet.energy + pet.happiness) / 4
}

/**
 * Roll the rarity of an offspring from two parents.
 * score = d10 (1-10) + careBonus (0..BREEDING_CARE_BONUS_MAX), mapped to a tier
 * via BREEDING_RARITY_THRESHOLDS.
 */
export function rollRarity(parentA: PetData, parentB: PetData): Rarity {
  const avgCondition = (petCondition(parentA) + petCondition(parentB)) / 2 // 0-100
  const careBonus = (avgCondition / 100) * C.BREEDING_CARE_BONUS_MAX // 0..max
  const dice = 1 + Math.floor(Math.random() * 10) // 1..10
  const score = dice + careBonus

  for (const [tier, min] of C.BREEDING_RARITY_THRESHOLDS) {
    if (score >= min) return tier
  }
  return 'common'
}
