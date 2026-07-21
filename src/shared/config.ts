// Central tuning + content tables. Everything tweakable lives here so the
// "tuning pass" in mvp.md never has to hunt through logic files.

import { Vector3 } from '@dcl/sdk/math'
import type { CareAction, StatKey } from './types'

export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * No message from the authoritative server in this long -> treat the connection
 * as down. The server pushes a snapshot every ~3s and presence every ~5s, so
 * this allows a couple of missed beats before warning.
 */
export const SERVER_TIMEOUT_MS = 10000

// ---------------------------------------------------------------------------
// Colony — the shared Mars population everyone is building toward. Teaser for
// now: the server counts pets across the players it knows about and broadcasts
// the total, so every client shows the same number. Real persistent aggregation
// (Storage.world) comes with the colony ring.
// ---------------------------------------------------------------------------
export const COLONY_GOAL = 100 // target population for the current milestone

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
// Relocated around the "here" anchor brought in from skybox-test (see
// client/skybox.ts) — offset from the original cluster near the map origin.
// ---------------------------------------------------------------------------
export const OBJECTS = {
  Bowl: Vector3.create(209.5, 0.5, 248.8),
  Bed: Vector3.create(201.0, 0.5, 245.1),
  Ball: Vector3.create(205.0, 0.5, 241.1),
  Pond: Vector3.create(213.7, 0.5, 240.6),
  Caretaker: Vector3.create(202.7, 0.5, 234.6),
  Shop: Vector3.create(195.2, 0.5, 235.8)
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
// Tuned for a relaxed cadence: the player is expected back every 2-3 days, so a
// pet left alone that long is hungry and sad but still recoverable.
// ---------------------------------------------------------------------------
export const DECAY_PER_SEC: Record<StatKey, number> = {
  hunger: 0.0004, // ~2.9 days to empty from full
  hygiene: 0.0003, // ~3.9 days
  energy: 0.00033, // ~3.5 days
  happiness: 0.00023 // ~5 days
}

/**
 * Extra happiness penalty per second, per neglected stat. Kept in scale with the
 * decay rates above: fully neglected (3 stats down) drains happiness in ~28h —
 * a real consequence, but not an instant wipe.
 */
export const HAPPINESS_NEGLECT_PENALTY = 0.00025
export const NEGLECT_THRESHOLD = 15 // a stat below this counts as "neglected"

/** How much each care action refills. Energy is drained by play. */
export const ACTION_EFFECT: Record<CareAction, Partial<Record<StatKey, number>>> = {
  feed: { hunger: 35 },
  clean: { hygiene: 45 },
  sleep: {}, // sleep is a State, not an instant effect — see SLEEP_FILL_PER_SEC
  play: { happiness: 30, energy: -12 }
}

/** Server-side per-action cooldown (ms) to stop spam. */
export const ACTION_COOLDOWN_MS: Record<CareAction, number> = {
  feed: 8000,
  clean: 12000,
  sleep: 2000, // just a toggle now (sleep/wake), so keep it responsive
  play: 8000
}

// ---------------------------------------------------------------------------
// Sleep — a duration state. The pet stays asleep and energy refills in real
// time; you wake it (or it wakes itself once rested). Leaving it asleep before
// you log off is the intended play: come back to a rested pet.
// ---------------------------------------------------------------------------
/** Energy refilled per second while asleep on the Bed: 0 -> 100 in ~1 hour. */
export const SLEEP_FILL_PER_SEC = 100 / 3600
/** Sleeping somewhere other than the Bed refills at this fraction (~2h). */
export const SLEEP_OFF_BED_FACTOR = 0.5
/** Everything else decays at this fraction while the pet sleeps. */
export const SLEEP_DECAY_FACTOR = 0.5

// Petting (own pet): instant small happiness, lightly rate-limited.
export const PET_SELF_HAPPINESS = 4
export const PET_SELF_COOLDOWN_MS = 1500

// Treating / petting other players' pets.
export const PET_OTHER_HAPPINESS = 5
export const PET_OTHER_GIVING_POINTS = 2
export const PET_OTHER_DAILY_CAP = 3 // per giver->pet pair per day
export const PET_OTHER_COOLDOWN_MS = 4000

// ---------------------------------------------------------------------------
// Currency — passive income, accrued per second. Happiness is the ONLY source:
// a neglected pet earns nothing ("caring well IS the economy"). Since happiness
// decays while you're away, a long absence self-limits what you earn.
// Calibrated against the shop scale (kibble 15 / feast 40 / slot 250).
// ---------------------------------------------------------------------------
export const CURRENCY_BASE_PER_SEC = 0 // no floor: an unhappy pet earns zero
export const CURRENCY_HAPPINESS_BONUS_PER_SEC = 0.0028 // multiplied by happiness/100

/** Max seconds of passive income paid out for a single absence (anti-hoarding). */
export const CURRENCY_OFFLINE_CAP_SEC = 8 * 3600 // 8h
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

/** Pet level at which breeding unlocks. Teaser only for now — no breeding logic
 *  yet (see issue #10); the pet panel shows a locked "Breed" gated on this. */
export const BREEDING_UNLOCK_LEVEL = 5
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
export const PET_BASE_Y = 0.5

// ---------------------------------------------------------------------------
// Analytics (PostHog) — see dev-docs/posthog-analytics-integration.md.
// The project API key is a write-only public capture token: safe to ship.
// ---------------------------------------------------------------------------
// Master on/off switch. OFF by default so local dev / preview runs never
// pollute the stats. Flip to `true` to test tracking locally, AND remember to
// set it `true` for the production deploy — otherwise production sends nothing.
export const ANALYTICS_ENABLED = false
export const GAME_ID = 'mydearpet' // deadsurge | cozyfarm | mydearpet
export const POSTHOG_HOST = 'eu.i.posthog.com' // EU Cloud
export const POSTHOG_PROJECT_API_KEY = 'phc_vnCGXbvJSyfA5qVW7QKGLnMipCMpqUhTZkMFRBKayKUp'
