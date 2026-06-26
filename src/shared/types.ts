// Shared data model. These plain interfaces are the authoritative shape of game
// state owned by the server and mirrored (read-only) on the client for UI.

export type CareAction = 'feed' | 'clean' | 'sleep' | 'play'
export type StatKey = 'hunger' | 'hygiene' | 'energy' | 'happiness'

/** Per-pet state. Every pet (active or stored) carries its own stats & XP. */
export interface PetData {
  id: string
  species: string // e.g. 'PetPanda' (matches assets/scene/Models/<species>/<species>.glb)
  name: string
  // Core stats, 0-100
  hunger: number
  hygiene: number
  energy: number
  happiness: number
  // Progression
  petXp: number
  petLevel: number
  size: number // visual scale multiplier (1.0 = base), grows with care milestones
  careCount: number // cumulative care actions, drives size growth
  // Bookkeeping
  bornAt: number // ms timestamp
  lastUpdated: number // ms timestamp of last decay calculation
}

/** Per-player account. Persists across pets. Keyed by wallet address. */
export interface PlayerData {
  address: string
  // Economy
  currency: number
  inventory: { tier1: number; tier2: number } // food consumables
  // Progression
  caretakerXp: number
  caretakerLevel: number
  givingScore: number
  spinTickets: number
  // Daily streak
  streakCount: number
  lastLoginDay: number // day index (floor(ms / DAY_MS))
  // Achievements
  achievements: string[] // unlocked ids
  counters: Record<string, number> // generic counters that feed achievements (feedCount, etc.)
  // Roster
  petSlots: number
  activePetId: string
  pets: PetData[]
  // Bookkeeping
  createdAt: number
  lastUpdated: number
}

/** Lightweight broadcast entry so every client can render every player's pet. */
export interface PresenceEntry {
  address: string
  species: string
  name: string
  size: number
  mood: number // 0-100 derived overall mood, drives sad/happy idle
  level: number
  following?: boolean // is the owner's pet currently following them?
}

/** Snapshot sent to the owning client to drive the HUD. */
export interface PlayerSnapshot {
  player: PlayerData
  activePet: PetData | null
}
