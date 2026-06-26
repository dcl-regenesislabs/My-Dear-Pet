// Client-side game simulation. The server stays authoritative WHEN it answers
// (snapshots snap us to its values), but messaging can be unreliable, so the
// client also seeds a default player and simulates locally — this guarantees
// the full HUD always renders and the game stays responsive/playable.

import * as Cfg from '../shared/config'
import type { CareAction, PlayerData, StatKey } from '../shared/types'
import { clientState } from './state'

const STAT_KEYS: StatKey[] = ['hunger', 'hygiene', 'energy', 'happiness']

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Overall mood: dominated by happiness, tanks if any stat bottoms out. */
export function deriveMood(pet: { hunger: number; hygiene: number; energy: number; happiness: number }): number {
  const min = Math.min(pet.hunger, pet.hygiene, pet.energy)
  return clamp(pet.happiness * 0.6 + min * 0.4)
}

/** Create a default player so the UI renders before/without a server snapshot. */
export function seedLocalPlayer(): void {
  if (clientState.player) return
  const t = Date.now()
  clientState.player = {
    address: clientState.myAddress || 'local',
    currency: Cfg.STARTING_CURRENCY,
    inventory: { tier1: 1, tier2: 0 },
    caretakerXp: 0,
    caretakerLevel: 1,
    givingScore: 0,
    spinTickets: 1,
    streakCount: 1,
    lastLoginDay: Math.floor(t / Cfg.DAY_MS),
    achievements: [],
    counters: {},
    petSlots: Cfg.STARTING_SLOTS,
    activePetId: '',
    pets: [],
    createdAt: t,
    lastUpdated: t
  }
}

/** Per-frame local simulation: decay the active pet + accrue currency/xp. */
export function simTick(dt: number): void {
  const p = clientState.player
  if (!p) return
  const pet = clientState.activePet
  if (!pet) return

  for (const k of STAT_KEYS) {
    if (k === 'happiness') continue
    pet[k] = clamp(pet[k] - Cfg.DECAY_PER_SEC[k] * dt)
  }
  let happinessLoss = Cfg.DECAY_PER_SEC.happiness * dt
  let neglected = 0
  if (pet.hunger < Cfg.NEGLECT_THRESHOLD) neglected++
  if (pet.hygiene < Cfg.NEGLECT_THRESHOLD) neglected++
  if (pet.energy < Cfg.NEGLECT_THRESHOLD) neglected++
  happinessLoss += neglected * Cfg.HAPPINESS_NEGLECT_PENALTY * dt
  pet.happiness = clamp(pet.happiness - happinessLoss)

  pet.petXp += Cfg.PET_XP_PASSIVE_PER_SEC * dt * (pet.happiness / 100)
  pet.petLevel = Cfg.levelForXp(pet.petXp)

  p.currency += (Cfg.CURRENCY_BASE_PER_SEC + Cfg.CURRENCY_HAPPINESS_BONUS_PER_SEC * (pet.happiness / 100)) * dt
}

// ---------------------------------------------------------------------------
// 7-day login streak
// ---------------------------------------------------------------------------
function todayIndex(): number {
  return Math.floor(Date.now() / Cfg.DAY_MS)
}

/** Advance / reset the streak based on the current day. Call once on login. */
export function evaluateStreak(): void {
  const s = clientState.streak
  const today = todayIndex()
  if (s.lastDay === today) return // already counted today
  if (s.lastDay === 0) {
    s.count = Math.max(1, s.count) // very first login
  } else if (s.lastDay === today - 1) {
    s.count += 1 // consecutive day
  } else {
    s.count = 1 // missed a day -> reset
  }
  s.lastDay = today
  if (clientState.player) clientState.player.streakCount = s.count
}

/** Which day of the 7-day cycle today is (1..7). */
export function streakWeekDay(): number {
  return ((clientState.streak.count - 1) % 7 + 7) % 7 + 1
}

export function streakClaimable(): boolean {
  return clientState.streak.claimedDay !== todayIndex()
}

/** Claim today's reward. Returns the reward, or null if already claimed. */
export function claimStreak(): { currency: number; spins: number; day: number } | null {
  if (!streakClaimable()) return null
  const day = streakWeekDay()
  const r = Cfg.STREAK_WEEK_REWARDS[day - 1]
  clientState.streak.claimedDay = todayIndex()
  const p = clientState.player
  if (p) {
    p.currency += r.currency
    p.spinTickets += r.spins
    p.streakCount = clientState.streak.count
  }
  return { currency: r.currency, spins: r.spins, day }
}

function grantXp(p: PlayerData): void {
  const pet = clientState.activePet
  if (!pet) return
  pet.petXp += Cfg.PET_XP_PER_ACTION * (0.5 + 0.5 * (pet.happiness / 100))
  pet.petLevel = Cfg.levelForXp(pet.petXp)
  p.caretakerXp += Cfg.CARETAKER_XP_PER_ACTION
  p.caretakerLevel = Cfg.levelForXp(p.caretakerXp)
}

function bumpCounter(p: PlayerData, key: string): void {
  p.counters[key] = (p.counters[key] ?? 0) + 1
}

// ---------------------------------------------------------------------------
// Local economy (applies immediately; the server snapshot corrects when alive)
// ---------------------------------------------------------------------------
export function buySlotLocal(): boolean {
  const p = clientState.player
  if (!p || p.petSlots >= Cfg.MAX_SLOTS || p.currency < Cfg.SLOT_PRICE) return false
  p.currency -= Cfg.SLOT_PRICE
  p.petSlots += 1
  return true
}

export function buyItemLocal(tier: number): boolean {
  const p = clientState.player
  const item = Cfg.SHOP_ITEMS.find((i) => i.tier === tier)
  if (!p || !item || p.currency < item.price) return false
  p.currency -= item.price
  if (tier === 1) p.inventory.tier1 += 1
  else p.inventory.tier2 += 1
  return true
}

export function useItemLocal(tier: number): boolean {
  const p = clientState.player
  const pet = clientState.activePet
  const item = Cfg.SHOP_ITEMS.find((i) => i.tier === tier)
  if (!p || !pet || !item) return false
  const have = tier === 1 ? p.inventory.tier1 : p.inventory.tier2
  if (have <= 0) return false
  if (tier === 1) p.inventory.tier1 -= 1
  else p.inventory.tier2 -= 1
  pet.hunger = clamp(pet.hunger + item.hunger)
  pet.happiness = clamp(pet.happiness + item.happiness)
  return true
}

export function spinLocal(): { reward: Cfg.SpinReward; index: number } | null {
  const p = clientState.player
  if (!p || p.spinTickets <= 0) return null
  p.spinTickets -= 1
  const total = Cfg.SPIN_REWARDS.reduce((s, r) => s + r.weight, 0)
  let roll = Math.random() * total
  let index = 0
  for (let i = 0; i < Cfg.SPIN_REWARDS.length; i++) {
    roll -= Cfg.SPIN_REWARDS[i].weight
    if (roll <= 0) {
      index = i
      break
    }
  }
  const reward = Cfg.SPIN_REWARDS[index]
  switch (reward.kind) {
    case 'currency':
    case 'cosmetic':
      p.currency += reward.amount
      break
    case 'spinTicket':
      p.spinTickets += reward.amount
      break
    case 'foodTier2':
      p.inventory.tier2 += reward.amount
      break
    case 'slotChance':
      if (p.petSlots < Cfg.MAX_SLOTS) p.petSlots += reward.amount
      else p.currency += 200
      break
  }
  return { reward, index }
}

/** Apply a care action's effect locally (optimistic; server snapshot corrects). */
export function applyCareLocal(action: CareAction, onBed: boolean): void {
  const p = clientState.player
  const pet = clientState.activePet
  if (!p || !pet) return
  const effects = Cfg.ACTION_EFFECT[action]
  for (const key of Object.keys(effects) as StatKey[]) {
    let delta = effects[key]!
    if (action === 'sleep' && key === 'energy' && !onBed) delta = Math.round(delta * Cfg.SLEEP_OFF_BED_FACTOR)
    pet[key] = clamp(pet[key] + delta)
  }
  pet.careCount += 1
  pet.size = Cfg.sizeForCareCount(pet.careCount)
  grantXp(p)
  bumpCounter(p, `${action}Count`)
  bumpCounter(p, 'careCount')
}
