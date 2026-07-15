// Client-side mirror of server state, for the UI and pet rendering to read.
// The server is authoritative; this is just the latest snapshot we received.

import { getPlayer } from '@dcl/sdk/players'
import { room } from '../shared/messages'
import type { CareAction, PetData, PlayerData, PlayerSnapshot, PresenceEntry } from '../shared/types'
import { SIZE_BASE, type SpinReward } from '../shared/config'

export type DialogState = {
  open: boolean
  npcName: string
  pages: string[]
  page: number
  finalLabel: string
  onDone: (() => void) | null
}

export const clientState: {
  myAddress: string
  player: PlayerData | null
  activePet: PetData | null
  presence: PresenceEntry[]
  // UI flags
  followEnabled: boolean
  toasts: { message: string; until: number }[]
  lastSpin: { reward: SpinReward; index: number; at: number } | null
  dialog: DialogState
  introShown: boolean
  // Optimistic adoption: render the new pet instantly while the server catches
  // up, so adoption never feels like "nothing happened" if a message is slow.
  pendingPet: PetData | null
  pendingUntil: number
  // 7-day login streak (client-owned so it works without the server).
  streak: { count: number; lastDay: number; claimedDay: number }
  // Day index the daily meteor was last opened (-1 = never; available today).
  meteorDay: number
} = {
  myAddress: '',
  player: null,
  activePet: null,
  presence: [],
  followEnabled: true,
  toasts: [],
  lastSpin: null,
  dialog: { open: false, npcName: '', pages: [], page: 0, finalLabel: 'Got it!', onDone: null },
  introShown: false,
  pendingPet: null,
  pendingUntil: 0,
  streak: { count: 1, lastDay: 0, claimedDay: 0 },
  meteorDay: -1
}

/** Open a multi-page NPC dialog. Advancing past the last page closes it. */
export function openDialog(npcName: string, pages: string[], finalLabel = 'Got it!', onDone?: () => void): void {
  clientState.dialog = { open: true, npcName, pages, page: 0, finalLabel, onDone: onDone ?? null }
}

export function advanceDialog(): void {
  const d = clientState.dialog
  if (!d.open) return
  if (d.page < d.pages.length - 1) {
    d.page += 1
    return
  }
  d.open = false
  const cb = d.onDone
  d.onDone = null
  if (cb) cb()
}

export function closeDialog(): void {
  clientState.dialog.open = false
  clientState.dialog.onDone = null
}

export function applySnapshot(snap: PlayerSnapshot): void {
  clientState.player = snap.player
  if (snap.activePet) {
    // Server confirmed a pet — authoritative wins, clear any optimistic state.
    clientState.activePet = snap.activePet
    clientState.pendingPet = null
  } else if (clientState.pendingPet && Date.now() < clientState.pendingUntil) {
    // Server hasn't caught up yet — keep showing the optimistic pet.
    clientState.activePet = clientState.pendingPet
    if (clientState.player) {
      clientState.player.activePetId = clientState.pendingPet.id
      if (!clientState.player.pets.find((p) => p.id === clientState.pendingPet!.id)) {
        clientState.player.pets = [...clientState.player.pets, clientState.pendingPet]
      }
    }
  } else {
    clientState.activePet = snap.activePet
    clientState.pendingPet = null
  }
}

/** Build a local placeholder pet for optimistic rendering. */
function makeLocalPet(species: string, name: string): PetData {
  const t = Date.now()
  return {
    id: `local_${t}`,
    species,
    name: name || species.replace('Pet', ''),
    hunger: 80,
    hygiene: 80,
    energy: 80,
    happiness: 80,
    petXp: 0,
    petLevel: 1,
    size: SIZE_BASE,
    careCount: 0,
    sleeping: false,
    sleepOnBed: false,
    bornAt: t,
    lastUpdated: t
  }
}

/** Make a stored pet the active one locally (and tell the server). */
export function switchActivePet(petId: string): void {
  const p = clientState.player
  if (!p) return
  const pet = p.pets.find((x) => x.id === petId)
  if (!pet) return
  p.activePetId = petId
  clientState.activePet = pet
  actions.switchPet(petId)
}

/** Adopt: render the pet immediately (optimistic) and tell the server. */
export function adoptPet(species: string, name: string): void {
  const pet = makeLocalPet(species, name)
  clientState.pendingPet = pet
  clientState.pendingUntil = Date.now() + 12000
  clientState.activePet = pet
  if (clientState.player) {
    clientState.player.activePetId = pet.id
    clientState.player.pets = [...clientState.player.pets.filter((p) => p.id !== pet.id), pet]
  }
  actions.adopt(species, name)
}

export function applyPresence(entries: PresenceEntry[]): void {
  clientState.presence = entries
}

export function presenceFor(address: string): PresenceEntry | undefined {
  return clientState.presence.find((e) => e.address.toLowerCase() === address.toLowerCase())
}

export function pushToast(message: string): void {
  clientState.toasts.push({ message, until: Date.now() + 4000 })
  if (clientState.toasts.length > 4) clientState.toasts.shift()
}

export function resolveMyAddress(): string {
  if (clientState.myAddress) return clientState.myAddress
  const p = getPlayer()
  clientState.myAddress = p?.userId ?? ''
  return clientState.myAddress
}

// ---- send helpers (thin wrappers over the room) ----
export const actions = {
  requestState(): void {
    const p = getPlayer()
    console.log('[Client] -> requestState')
    room.send('requestState', { guestName: p?.name ?? 'Guest' })
  },
  adopt(species: string, name: string): void {
    console.log('[Client] -> adopt', species, name)
    room.send('adopt', { species, name })
  },
  care(action: CareAction, onBed = false): void {
    room.send('careAction', { action, onBed })
  },
  petSelf(): void {
    room.send('petSelf', {})
  },
  petOther(targetAddress: string): void {
    room.send('petOther', { targetAddress })
  },
  buyItem(tier: number): void {
    room.send('buyItem', { tier })
  },
  useItem(tier: number): void {
    room.send('useItem', { tier })
  },
  switchPet(petId: string): void {
    room.send('switchPet', { petId })
  },
  buySlot(): void {
    room.send('buySlot', {})
  },
  spin(): void {
    room.send('spin', {})
  },
  setFollow(following: boolean): void {
    room.send('setFollow', { following })
  }
}
