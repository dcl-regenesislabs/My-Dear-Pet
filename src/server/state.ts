// Server-authoritative game state: load/save per-player data, apply decay
// (including offline), run care actions, currency, XP, achievements, streak,
// and the spin wheel. All money/stat mutations live here so they can be
// validated and persisted in one place.

import { Storage } from '@dcl/sdk/server'
import type { CareAction, PetData, PlayerData, PresenceEntry, StatKey } from '../shared/types'
import * as C from '../shared/config'

const STORAGE_KEY = 'petdata-v1'
const STAT_KEYS: StatKey[] = ['hunger', 'hygiene', 'energy', 'happiness']

// In-memory cache of loaded players (address -> data). Persisted to Storage.
const players = new Map<string, PlayerData>()
// Per-action cooldown tracking (address -> action -> last ts).
const actionCooldowns = new Map<string, Record<string, number>>()
// Treat farming guard: giver -> "targetAddr|day" -> count.
const treatCounts = new Map<string, Record<string, number>>()
// Addresses whose data was created fresh this server lifetime (no prior save).
const freshPlayers = new Set<string>()
// Per-player pet follow state (Whistle/Stay), reported by the client. Ephemeral
// (session-only) — used to broadcast `following` in presence. Defaults to true.
const followState = new Map<string, boolean>()

/** Record a player's pet follow state so presence can broadcast it. */
export function setFollowState(address: string, following: boolean): void {
  followState.set(address.toLowerCase(), following)
}

/** True if this wallet had no saved state when first loaded (a new user). */
export function isFreshPlayer(address: string): boolean {
  return freshPlayers.has(address)
}

export type Notify = { kind: string; message: string }

function now(): number {
  return Date.now()
}

function newPet(species: string, name: string): PetData {
  const t = now()
  return {
    id: `pet_${t}_${Math.floor(Math.random() * 100000)}`,
    species,
    name: name || species.replace('Pet', ''),
    hunger: 80,
    hygiene: 80,
    energy: 80,
    happiness: 80,
    petXp: 0,
    petLevel: 1,
    size: C.SIZE_BASE,
    careCount: 0,
    bornAt: t,
    lastUpdated: t
  }
}

function newPlayer(address: string): PlayerData {
  const t = now()
  return {
    address,
    currency: C.STARTING_CURRENCY,
    inventory: { tier1: 1, tier2: 0 },
    caretakerXp: 0,
    caretakerLevel: 1,
    givingScore: 0,
    spinTickets: 1,
    streakCount: 0,
    lastLoginDay: 0,
    achievements: [],
    counters: {},
    petSlots: C.STARTING_SLOTS,
    activePetId: '',
    pets: [],
    createdAt: t,
    lastUpdated: t
  }
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v))
}

function activePet(p: PlayerData): PetData | null {
  return p.pets.find((pet) => pet.id === p.activePetId) ?? null
}

// ---------------------------------------------------------------------------
// Decay — applied to every pet a player owns (active and stored both decay).
// ---------------------------------------------------------------------------
function decayPet(pet: PetData, atMs: number): void {
  const elapsedSec = Math.max(0, (atMs - pet.lastUpdated) / 1000)
  if (elapsedSec <= 0) return

  for (const k of STAT_KEYS) {
    if (k === 'happiness') continue
    pet[k] = clamp(pet[k] - C.DECAY_PER_SEC[k] * elapsedSec)
  }
  // Happiness decays slowly, with extra penalty if other stats are neglected.
  let happinessLoss = C.DECAY_PER_SEC.happiness * elapsedSec
  let neglected = 0
  if (pet.hunger < C.NEGLECT_THRESHOLD) neglected++
  if (pet.hygiene < C.NEGLECT_THRESHOLD) neglected++
  if (pet.energy < C.NEGLECT_THRESHOLD) neglected++
  happinessLoss += neglected * C.HAPPINESS_NEGLECT_PENALTY * elapsedSec
  pet.happiness = clamp(pet.happiness - happinessLoss)

  // Passive pet XP scaled by happiness (rewards sustained good care).
  pet.petXp += C.PET_XP_PASSIVE_PER_SEC * elapsedSec * (pet.happiness / 100)
  pet.petLevel = C.levelForXp(pet.petXp)

  pet.lastUpdated = atMs
}

/** Recompute all pets + accrue currency for the active pet's happiness. */
export function tickPlayer(p: PlayerData, atMs = now()): void {
  for (const pet of p.pets) {
    const before = pet.lastUpdated
    decayPet(pet, atMs)
    void before
  }
  // Currency accrues from the active pet's happiness.
  const active = activePet(p)
  const elapsedSec = Math.max(0, (atMs - p.lastUpdated) / 1000)
  if (active && elapsedSec > 0) {
    const rate = C.CURRENCY_BASE_PER_SEC + C.CURRENCY_HAPPINESS_BONUS_PER_SEC * (active.happiness / 100)
    p.currency += rate * elapsedSec
  }
  p.lastUpdated = atMs
}

export function deriveMood(pet: PetData): number {
  const min = Math.min(pet.hunger, pet.hygiene, pet.energy)
  // Mood is dominated by happiness but tanks if any stat bottoms out.
  return clamp(pet.happiness * 0.6 + min * 0.4)
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------
export async function loadPlayer(address: string): Promise<PlayerData> {
  if (players.has(address)) {
    const cached = players.get(address)!
    tickPlayer(cached)
    return cached
  }
  let data: PlayerData | null = null
  try {
    data = await Storage.player.get<PlayerData>(address, STORAGE_KEY)
  } catch (e) {
    console.log('[Server] Storage load failed for', address, e)
  }
  if (!data || !data.address) {
    data = newPlayer(address)
    freshPlayers.add(address) // no prior saved state -> new user (for analytics)
  } else {
    // Migrate/sanitize loaded data, then apply offline decay.
    data = sanitize(address, data)
    tickPlayer(data)
  }
  applyDailyStreak(data)
  players.set(address, data)
  await savePlayer(address)
  return data
}

function sanitize(address: string, d: PlayerData): PlayerData {
  const base = newPlayer(address)
  return {
    ...base,
    ...d,
    address,
    inventory: { ...base.inventory, ...(d.inventory ?? {}) },
    counters: d.counters ?? {},
    achievements: d.achievements ?? [],
    pets: (d.pets ?? []).map((pet) => ({ ...newPet(pet.species, pet.name), ...pet }))
  }
}

export async function savePlayer(address: string): Promise<void> {
  const p = players.get(address)
  if (!p) return
  try {
    await Storage.player.set<PlayerData>(address, STORAGE_KEY, p)
  } catch (e) {
    console.log('[Server] Storage save failed for', address, e)
  }
}

export function getCached(address: string): PlayerData | undefined {
  return players.get(address)
}

export function allCached(): PlayerData[] {
  return [...players.values()]
}

// ---------------------------------------------------------------------------
// Daily streak
// ---------------------------------------------------------------------------
function applyDailyStreak(p: PlayerData): Notify[] {
  const today = Math.floor(now() / C.DAY_MS)
  const notes: Notify[] = []
  if (p.lastLoginDay === today) return notes
  if (p.lastLoginDay === today - 1) {
    p.streakCount += 1
  } else {
    p.streakCount = 1
  }
  p.lastLoginDay = today
  p.currency += C.STREAK_DAILY_BONUS
  notes.push({ kind: 'streak', message: `Day ${p.streakCount} streak! +${C.STREAK_DAILY_BONUS} coins` })
  const milestone = C.STREAK_MILESTONES.find((m) => m.day === p.streakCount)
  if (milestone) {
    p.currency += milestone.currency
    p.spinTickets += milestone.spins
    notes.push({ kind: 'streak', message: `Streak milestone day ${milestone.day}! +${milestone.currency} coins, +${milestone.spins} spins` })
  }
  return notes
}

// ---------------------------------------------------------------------------
// Progression helpers
// ---------------------------------------------------------------------------
function bump(p: PlayerData, counter: string, by = 1): void {
  p.counters[counter] = (p.counters[counter] ?? 0) + by
}

function grantCaretakerXp(p: PlayerData, xp: number, notes: Notify[]): void {
  p.caretakerXp += xp
  const newLevel = C.levelForXp(p.caretakerXp)
  while (p.caretakerLevel < newLevel) {
    p.caretakerLevel += 1
    p.counters['caretakerLevel'] = p.caretakerLevel
    const reward = C.CARETAKER_LEVEL_REWARDS.find((r) => r.level === p.caretakerLevel)
    if (reward) applyLevelReward(p, reward, notes)
    notes.push({ kind: 'level', message: `Caretaker Level ${p.caretakerLevel}!` })
  }
}

function applyLevelReward(p: PlayerData, r: C.LevelReward, notes: Notify[]): void {
  switch (r.kind) {
    case 'currency':
      p.currency += r.amount
      break
    case 'slot':
      p.petSlots = Math.min(C.MAX_SLOTS, p.petSlots + r.amount)
      break
    case 'spinTicket':
      p.spinTickets += r.amount
      break
    case 'foodTier1':
      p.inventory.tier1 += r.amount
      break
    case 'foodTier2':
      p.inventory.tier2 += r.amount
      break
  }
  notes.push({ kind: 'reward', message: `Level reward: ${r.label}` })
}

function checkAchievements(p: PlayerData, notes: Notify[]): void {
  for (const a of C.ACHIEVEMENTS) {
    if (p.achievements.indexOf(a.id) !== -1) continue
    const progress = p.counters[a.counter] ?? 0
    if (progress >= a.goal) {
      p.achievements.push(a.id)
      p.currency += a.rewardCurrency
      p.spinTickets += a.rewardSpins
      notes.push({ kind: 'achievement', message: `Achievement: ${a.label}! +${a.rewardCurrency} coins` })
    }
  }
}

function grantPetXp(pet: PetData, xp: number): void {
  pet.petXp += xp * (0.5 + 0.5 * (pet.happiness / 100)) // happiness multiplier
  pet.petLevel = C.levelForXp(pet.petXp)
}

// ---------------------------------------------------------------------------
// Actions (each returns notifications for the caller to forward)
// ---------------------------------------------------------------------------
function cooldownOk(address: string, action: string, ms: number): boolean {
  const map = actionCooldowns.get(address) ?? {}
  const last = map[action] ?? 0
  if (now() - last < ms) return false
  map[action] = now()
  actionCooldowns.set(address, map)
  return true
}

export function adopt(p: PlayerData, species: string, name: string): Notify[] {
  const notes: Notify[] = []
  if (C.SPECIES.indexOf(species) === -1) {
    return [{ kind: 'error', message: 'Unknown species' }]
  }
  if (p.pets.length >= p.petSlots) {
    return [{ kind: 'error', message: 'No free pet slots' }]
  }
  const pet = newPet(species, name)
  p.pets.push(pet)
  p.activePetId = pet.id
  bump(p, 'adoptCount')
  notes.push({ kind: 'adopt', message: `You adopted ${pet.name}!` })
  return notes
}

export function careAction(p: PlayerData, action: CareAction, onBed: boolean): Notify[] {
  const notes: Notify[] = []
  const pet = activePet(p)
  if (!pet) return [{ kind: 'error', message: 'No active pet' }]
  if (!cooldownOk(p.address, action, C.ACTION_COOLDOWN_MS[action])) {
    return [{ kind: 'cooldown', message: 'Pet is still busy...' }]
  }
  tickPlayer(p)
  const effects = C.ACTION_EFFECT[action]
  for (const key of Object.keys(effects) as StatKey[]) {
    let delta = effects[key]!
    if (action === 'sleep' && key === 'energy' && !onBed) {
      delta = Math.round(delta * C.SLEEP_OFF_BED_FACTOR)
    }
    pet[key] = clamp(pet[key] + delta)
  }
  pet.careCount += 1
  pet.size = C.sizeForCareCount(pet.careCount)
  grantPetXp(pet, C.PET_XP_PER_ACTION)
  grantCaretakerXp(p, C.CARETAKER_XP_PER_ACTION, notes)
  bump(p, `${action}Count`)
  bump(p, 'careCount')
  checkAchievements(p, notes)
  return notes
}

export function petSelf(p: PlayerData): Notify[] {
  const pet = activePet(p)
  if (!pet) return []
  if (!cooldownOk(p.address, 'petSelf', C.PET_SELF_COOLDOWN_MS)) return []
  pet.happiness = clamp(pet.happiness + C.PET_SELF_HAPPINESS)
  grantPetXp(pet, 1)
  return []
}

export function petOther(giver: PlayerData, target: PlayerData): Notify[] {
  const notes: Notify[] = []
  const targetPet = activePet(target)
  if (!targetPet) return [{ kind: 'error', message: 'That player has no pet' }]
  if (!cooldownOk(giver.address, `petOther_${target.address}`, C.PET_OTHER_COOLDOWN_MS)) return []
  // Daily cap per giver->target pair.
  const day = Math.floor(now() / C.DAY_MS)
  const key = `${target.address}|${day}`
  const counts = treatCounts.get(giver.address) ?? {}
  if ((counts[key] ?? 0) >= C.PET_OTHER_DAILY_CAP) {
    return [{ kind: 'cooldown', message: 'Daily treats for this pet reached' }]
  }
  counts[key] = (counts[key] ?? 0) + 1
  treatCounts.set(giver.address, counts)

  targetPet.happiness = clamp(targetPet.happiness + C.PET_OTHER_HAPPINESS)
  giver.givingScore += C.PET_OTHER_GIVING_POINTS
  bump(giver, 'givingCount')
  grantCaretakerXp(giver, C.CARETAKER_XP_PER_GIVING, notes)
  checkAchievements(giver, notes)
  notes.push({ kind: 'giving', message: `You petted ${target.address.slice(0, 6)}'s pet! +${C.PET_OTHER_GIVING_POINTS} Giving` })
  return notes
}

export function buyItem(p: PlayerData, tier: number): Notify[] {
  const item = C.SHOP_ITEMS.find((i) => i.tier === tier)
  if (!item) return [{ kind: 'error', message: 'No such item' }]
  if (p.currency < item.price) return [{ kind: 'error', message: 'Not enough coins' }]
  p.currency -= item.price
  if (tier === 1) p.inventory.tier1 += 1
  else p.inventory.tier2 += 1
  return [{ kind: 'shop', message: `Bought ${item.label}` }]
}

export function useItem(p: PlayerData, tier: number): Notify[] {
  const notes: Notify[] = []
  const pet = activePet(p)
  if (!pet) return [{ kind: 'error', message: 'No active pet' }]
  const have = tier === 1 ? p.inventory.tier1 : p.inventory.tier2
  if (have <= 0) return [{ kind: 'error', message: 'You have none of that food' }]
  const item = C.SHOP_ITEMS.find((i) => i.tier === tier)!
  if (tier === 1) p.inventory.tier1 -= 1
  else p.inventory.tier2 -= 1
  tickPlayer(p)
  pet.hunger = clamp(pet.hunger + item.hunger)
  pet.happiness = clamp(pet.happiness + item.happiness)
  pet.careCount += 1
  pet.size = C.sizeForCareCount(pet.careCount)
  grantPetXp(pet, C.PET_XP_PER_ACTION)
  grantCaretakerXp(p, C.CARETAKER_XP_PER_ACTION, notes)
  bump(p, 'feedCount')
  checkAchievements(p, notes)
  notes.push({ kind: 'feed', message: `Fed ${pet.name} ${item.label}` })
  return notes
}

export function switchPet(p: PlayerData, petId: string): Notify[] {
  if (!p.pets.find((pet) => pet.id === petId)) return [{ kind: 'error', message: 'No such pet' }]
  p.activePetId = petId
  return [{ kind: 'roster', message: 'Switched active pet' }]
}

export function buySlot(p: PlayerData): Notify[] {
  if (p.petSlots >= C.MAX_SLOTS) return [{ kind: 'error', message: 'Max slots reached' }]
  if (p.currency < C.SLOT_PRICE) return [{ kind: 'error', message: 'Not enough coins' }]
  p.currency -= C.SLOT_PRICE
  p.petSlots += 1
  return [{ kind: 'shop', message: `Unlocked pet slot ${p.petSlots}!` }]
}

export function spin(p: PlayerData): { notes: Notify[]; reward: C.SpinReward | null; index: number } {
  if (p.spinTickets <= 0) return { notes: [{ kind: 'error', message: 'No spin tickets' }], reward: null, index: -1 }
  p.spinTickets -= 1
  const total = C.SPIN_REWARDS.reduce((s, r) => s + r.weight, 0)
  let roll = Math.random() * total
  let index = 0
  for (let i = 0; i < C.SPIN_REWARDS.length; i++) {
    roll -= C.SPIN_REWARDS[i].weight
    if (roll <= 0) {
      index = i
      break
    }
  }
  const reward = C.SPIN_REWARDS[index]
  const notes: Notify[] = []
  switch (reward.kind) {
    case 'currency':
    case 'cosmetic': // cosmetics not built -> pay out as currency-equivalent
      p.currency += reward.amount
      break
    case 'spinTicket':
      p.spinTickets += reward.amount
      break
    case 'foodTier2':
      p.inventory.tier2 += reward.amount
      break
    case 'slotChance':
      if (p.petSlots < C.MAX_SLOTS) p.petSlots += reward.amount
      else p.currency += 200
      break
  }
  notes.push({ kind: 'spin', message: `Spin: ${reward.label}!` })
  return { notes, reward, index }
}

// ---------------------------------------------------------------------------
// Presence (broadcast)
// ---------------------------------------------------------------------------
export function presenceFor(p: PlayerData): PresenceEntry | null {
  const pet = activePet(p)
  if (!pet) return null
  return {
    address: p.address,
    species: pet.species,
    name: pet.name,
    size: pet.size,
    mood: deriveMood(pet),
    level: pet.petLevel,
    following: followState.get(p.address.toLowerCase()) ?? true
  }
}

export function snapshotFor(p: PlayerData): { player: PlayerData; activePet: PetData | null } {
  return { player: p, activePet: activePet(p) }
}
