// Peer-to-peer pet presence over the native DCL MessageBus. This does NOT use
// the authoritative server — it's fire-and-forget comms between everyone in the
// scene — so other players' active pets show up reliably even when the auth
// server messaging isn't delivering. Each client broadcasts its active pet a
// few times a second; everyone else renders it near that player's avatar.

import { engine } from '@dcl/sdk/ecs'
import { MessageBus } from '@dcl/sdk/message-bus'
import { getPlayer, onEnterScene, onLeaveScene } from '@dcl/sdk/players'
import type { PresenceEntry } from '../shared/types'
import { clientState } from './state'
import { deriveMood } from './sim'

const MSG_PET = 'mdp_pet'
const MSG_LEAVE = 'mdp_leave'
const BROADCAST_INTERVAL = 1.5 // seconds
const STALE_MS = 6000 // drop a peer we haven't heard from in this long

const bus = new MessageBus()
const peers = new Map<string, PresenceEntry & { lastSeen: number }>()

function myAddress(): string {
  return (clientState.myAddress || getPlayer()?.userId || '').toLowerCase()
}

function myPresence(): (PresenceEntry & { ts: number }) | null {
  const pet = clientState.activePet
  if (!pet) return null
  const addr = clientState.myAddress || getPlayer()?.userId || 'local'
  return {
    address: addr,
    species: pet.species,
    name: pet.name,
    size: pet.size,
    mood: deriveMood(pet),
    level: pet.petLevel,
    following: clientState.followEnabled,
    ts: Date.now()
  }
}

function broadcast(): void {
  const p = myPresence()
  if (p) bus.emit(MSG_PET, p)
}

function rebuildPresenceList(): void {
  const me = myAddress()
  const list: PresenceEntry[] = []
  for (const [addr, e] of peers) {
    if (addr === me) continue
    list.push(e)
  }
  clientState.presence = list
}

export function setupPeers(): void {
  bus.on(MSG_PET, (data: any, sender: string) => {
    const addr = (data?.address || sender || '').toLowerCase()
    if (!addr) return
    peers.set(addr, {
      address: data.address || sender,
      species: data.species,
      name: data.name,
      size: data.size ?? 0.55,
      mood: data.mood ?? 80,
      level: data.level ?? 1,
      following: data.following !== false,
      lastSeen: Date.now()
    })
  })

  bus.on(MSG_LEAVE, (data: any, sender: string) => {
    peers.delete((data?.address || sender || '').toLowerCase())
  })

  // Greet newcomers with an immediate broadcast so they see us right away.
  onEnterScene(() => broadcast())
  onLeaveScene((userId: string) => {
    peers.delete((userId || '').toLowerCase())
    rebuildPresenceList()
  })

  let acc = 99
  engine.addSystem((dt: number) => {
    acc += dt
    const now = Date.now()
    let pruned = false
    for (const [addr, e] of peers) {
      if (now - e.lastSeen > STALE_MS) {
        peers.delete(addr)
        pruned = true
      }
    }
    if (acc >= BROADCAST_INTERVAL) {
      acc = 0
      broadcast()
    }
    rebuildPresenceList()
    void pruned
  })
}
