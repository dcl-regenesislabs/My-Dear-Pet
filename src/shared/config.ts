// Central tuning + content tables. Everything tweakable lives here so the
// "tuning pass" in mvp.md never has to hunt through logic files.

import { Vector3 } from '@dcl/sdk/math'
import type { CareAction, StatKey } from './types'

export const DAY_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Pet roster — the 11 species already modeled under assets/scene/Models/.
// ---------------------------------------------------------------------------
export const SPECIES: string[] = [
  'PetPanda',
  'PetTiger',
  'PetLion',
  'PetGiraffe',
  'PetPenguin',
  'PetPolar',
  'PetPig',
  'PetMonkey',
  'PetParrot',
  'PetKoala',
  'PetHog'
]

export function modelForSpecies(species: string): string {
  return `assets/scene/Models/${species}/${species}.glb`
}

// ---------------------------------------------------------------------------
// Scene object world positions (read from assets/scene/main.composite).
// Used for pet navigation targets and care-action object click handlers.
// ---------------------------------------------------------------------------
export const OBJECTS = {
  Bowl: Vector3.create(18.3, 0, 25.0),
  Bed: Vector3.create(9.8, 0, 21.3),
  Ball: Vector3.create(13.8, 0, 17.3),
  Pond: Vector3.create(22.5, 0, 16.8),
  Caretaker: Vector3.create(11.5, 0, 10.8),
  Shop: Vector3.create(4.0, 0, 12.0)
}

/** Which object a care action navigates to. */
export const ACTION_OBJECT: Record<CareAction, Vector3> = {
  feed: OBJECTS.Bowl,
  clean: OBJECTS.Pond,
  sleep: OBJECTS.Bed,
  play: OBJECTS.Ball
}

// ---------------------------------------------------------------------------
// Stat decay — points lost per real second. Hunger fastest, happiness slowest.
// (Generous starting values; tune live.)
// ---------------------------------------------------------------------------
export const DECAY_PER_SEC: Record<StatKey, number> = {
  hunger: 0.06, // ~28 min to empty from full
  hygiene: 0.035,
  energy: 0.03,
  happiness: 0.02
}

/** Extra happiness penalty per second when another stat sits at/near zero. */
export const HAPPINESS_NEGLECT_PENALTY = 0.04
export const NEGLECT_THRESHOLD = 15 // a stat below this counts as "neglected"

/** How much each care action refills. Energy is drained by play. */
export const ACTION_EFFECT: Record<CareAction, Partial<Record<StatKey, number>>> = {
  feed: { hunger: 35 },
  clean: { hygiene: 45 },
  sleep: { energy: 50 },
  play: { happiness: 30, energy: -12 }
}

/** Server-side per-action cooldown (ms) to stop spam. */
export const ACTION_COOLDOWN_MS: Record<CareAction, number> = {
  feed: 8000,
  clean: 12000,
  sleep: 15000,
  play: 8000
}

/** Sleeping somewhere other than the Bed refills at this fraction (quality). */
export const SLEEP_OFF_BED_FACTOR = 0.5

// Petting (own pet): instant small happiness, lightly rate-limited.
export const PET_SELF_HAPPINESS = 4
export const PET_SELF_COOLDOWN_MS = 1500

// Treating / petting other players' pets.
export const PET_OTHER_HAPPINESS = 5
export const PET_OTHER_GIVING_POINTS = 2
export const PET_OTHER_DAILY_CAP = 3 // per giver->pet pair per day
export const PET_OTHER_COOLDOWN_MS = 4000

// ---------------------------------------------------------------------------
// Currency — passive income scaled by happiness, accrued per second.
// ---------------------------------------------------------------------------
export const CURRENCY_BASE_PER_SEC = 0.05
export const CURRENCY_HAPPINESS_BONUS_PER_SEC = 0.15 // multiplied by happiness/100
export const STARTING_CURRENCY = 50

// ---------------------------------------------------------------------------
// Shop — 2 food tiers.
// ---------------------------------------------------------------------------
export interface ShopItem {
  tier: 1 | 2
  label: string
  price: number
  hunger: number
  happiness: number
}
export const SHOP_ITEMS: ShopItem[] = [
  { tier: 1, label: 'Basic Kibble', price: 15, hunger: 35, happiness: 0 },
  { tier: 2, label: 'Premium Feast', price: 40, hunger: 100, happiness: 10 }
]

// ---------------------------------------------------------------------------
// Pet storage slots.
// ---------------------------------------------------------------------------
export const STARTING_SLOTS = 1
export const MAX_SLOTS = 5
export const SLOT_PRICE = 250 // currency to buy an extra slot directly

// ---------------------------------------------------------------------------
// XP & leveling — data-driven so unlock rewards can grow post-MVP.
// ---------------------------------------------------------------------------
export const PET_XP_PER_ACTION = 8
export const PET_XP_PASSIVE_PER_SEC = 0.05 // scaled by happiness/100
export const CARETAKER_XP_PER_ACTION = 5
export const CARETAKER_XP_PER_GIVING = 3

/** XP needed to reach level n (1-indexed). Quadratic-ish idle curve. */
export function xpForLevel(level: number): number {
  return Math.floor(50 * level * level)
}
export function levelForXp(xp: number): number {
  let lvl = 1
  while (xp >= xpForLevel(lvl + 1)) lvl++
  return lvl
}

/** Size growth: pet scales up with cumulative care, capped. */
export const SIZE_BASE = 0.55 // pets start small & cute, grow with care
export const SIZE_PER_CARE = 0.008
export const SIZE_MAX = 1.1
export function sizeForCareCount(careCount: number): number {
  return Math.min(SIZE_MAX, SIZE_BASE + careCount * SIZE_PER_CARE)
}

// Caretaker level -> reward table (data-driven; stubbed rewards).
export interface LevelReward {
  level: number
  kind: 'currency' | 'slot' | 'spinTicket' | 'foodTier1' | 'foodTier2'
  amount: number
  label: string
}
export const CARETAKER_LEVEL_REWARDS: LevelReward[] = [
  { level: 2, kind: 'currency', amount: 50, label: '+50 coins' },
  { level: 3, kind: 'spinTicket', amount: 1, label: '+1 spin ticket' },
  { level: 4, kind: 'foodTier2', amount: 2, label: '2x Premium Feast' },
  { level: 5, kind: 'slot', amount: 1, label: '+1 pet slot' },
  { level: 7, kind: 'currency', amount: 200, label: '+200 coins' },
  { level: 10, kind: 'slot', amount: 1, label: '+1 pet slot' }
]

// ---------------------------------------------------------------------------
// Achievements — system is MVP; this list is content and can grow.
// ---------------------------------------------------------------------------
export interface Achievement {
  id: string
  label: string
  description: string
  counter: string // which PlayerData.counters key it tracks
  goal: number
  rewardCurrency: number
  rewardSpins: number
}
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_feed', label: 'First Meal', description: 'Feed your pet once', counter: 'feedCount', goal: 1, rewardCurrency: 10, rewardSpins: 0 },
  { id: 'feed_50', label: 'Chef', description: 'Feed your pet 50 times', counter: 'feedCount', goal: 50, rewardCurrency: 100, rewardSpins: 1 },
  { id: 'clean_25', label: 'Squeaky Clean', description: 'Bathe your pet 25 times', counter: 'cleanCount', goal: 25, rewardCurrency: 80, rewardSpins: 1 },
  { id: 'play_25', label: 'Playful', description: 'Play with your pet 25 times', counter: 'playCount', goal: 25, rewardCurrency: 80, rewardSpins: 1 },
  { id: 'giver_10', label: 'Good Neighbor', description: 'Pet 10 other pets', counter: 'givingCount', goal: 10, rewardCurrency: 120, rewardSpins: 1 },
  { id: 'caretaker_5', label: 'Seasoned Caretaker', description: 'Reach Caretaker Level 5', counter: 'caretakerLevel', goal: 5, rewardCurrency: 200, rewardSpins: 2 }
]

// ---------------------------------------------------------------------------
// Daily streak milestones.
// ---------------------------------------------------------------------------
export interface StreakMilestone {
  day: number
  currency: number
  spins: number
}
export const STREAK_MILESTONES: StreakMilestone[] = [
  { day: 3, currency: 30, spins: 1 },
  { day: 7, currency: 100, spins: 2 },
  { day: 14, currency: 250, spins: 3 },
  { day: 30, currency: 600, spins: 5 }
]
export const STREAK_DAILY_BONUS = 10 // currency just for logging in

// 7-day login reward calendar. The streak cycles every 7 days; day 7 is the
// jackpot. Logging in on a new consecutive day advances it; missing a day
// resets the streak to day 1.
export interface StreakDayReward {
  day: number
  currency: number
  spins: number
  label: string
}
export const STREAK_WEEK_REWARDS: StreakDayReward[] = [
  { day: 1, currency: 20, spins: 0, label: '20' },
  { day: 2, currency: 35, spins: 0, label: '35' },
  { day: 3, currency: 50, spins: 1, label: '50 +1 spin' },
  { day: 4, currency: 75, spins: 0, label: '75' },
  { day: 5, currency: 110, spins: 1, label: '110 +1 spin' },
  { day: 6, currency: 150, spins: 1, label: '150 +1 spin' },
  { day: 7, currency: 300, spins: 2, label: '300 +2 spins' }
]

// ---------------------------------------------------------------------------
// Spin wheel — generic weighted reward pool. Reusable by streak/achievements.
// ---------------------------------------------------------------------------
export interface SpinReward {
  kind: 'currency' | 'spinTicket' | 'slotChance' | 'cosmetic' | 'foodTier2'
  amount: number
  weight: number
  rarity: 'common' | 'rare' | 'jackpot'
  label: string
}
export const SPIN_REWARDS: SpinReward[] = [
  { kind: 'currency', amount: 20, weight: 40, rarity: 'common', label: '20 coins' },
  { kind: 'currency', amount: 50, weight: 25, rarity: 'common', label: '50 coins' },
  { kind: 'foodTier2', amount: 1, weight: 15, rarity: 'common', label: 'Premium Feast' },
  { kind: 'spinTicket', amount: 1, weight: 10, rarity: 'rare', label: 'Free Spin' },
  { kind: 'currency', amount: 200, weight: 6, rarity: 'rare', label: '200 coins' },
  // cosmetics not built yet -> defaults to a currency-equivalent payout
  { kind: 'cosmetic', amount: 100, weight: 3, rarity: 'jackpot', label: 'Mystery Prize' },
  { kind: 'slotChance', amount: 1, weight: 1, rarity: 'jackpot', label: 'PET SLOT!' }
]

// Navigation / follow tuning (client-side).
export const PET_FOLLOW_DISTANCE = 2.2
export const PET_MOVE_SPEED = 4.0 // m/s
export const PET_ARRIVE_DISTANCE = 0.6
export const PET_BASE_Y = 0.0
