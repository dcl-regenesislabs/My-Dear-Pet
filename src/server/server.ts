// Headless authoritative server. Owns all game state, validates actions,
// runs decay, persists to Storage, and broadcasts presence for social render.

import { engine, PlayerIdentityData } from '@dcl/sdk/ecs'
import { room } from '../shared/messages'
import type { CareAction, PlayerData, PresenceEntry } from '../shared/types'
import * as S from './state'
import { trackEvent } from '../shared/analytics'

const TICK_INTERVAL = 5 // seconds between decay/persist passes
const SNAPSHOT_INTERVAL = 3 // seconds between owner snapshot pushes

// Track which addresses are currently connected (seen via PlayerIdentityData).
const connected = new Set<string>()

function forwardNotes(address: string, notes: S.Notify[]): void {
  for (const n of notes) {
    room.send('notify', { kind: n.kind, message: n.message }, { to: [address] })
  }
}

function pushSnapshot(p: PlayerData): void {
  room.send('stateSnapshot', { json: JSON.stringify(S.snapshotFor(p)) }, { to: [p.address] })
}

function broadcastPresence(): void {
  const entries: PresenceEntry[] = []
  for (const p of S.allCached()) {
    const e = S.presenceFor(p)
    if (e) entries.push(e)
  }
  room.send('presence', { json: JSON.stringify(entries) })
}

export function server(): void {
  console.log('[Server] MyDearPet authoritative server starting')

  // -- Message handlers -----------------------------------------------------
  room.onMessage('requestState', async (_data, ctx) => {
    if (!ctx) return
    console.log('[Server] requestState from', ctx.from)
    // requestState repeats every ~2s; the first one this lifetime marks a fresh
    // scene entry -> emit exactly one `session started`. Mark `connected` BEFORE
    // the await so two near-simultaneous first requests don't both fire.
    const firstThisSession = !connected.has(ctx.from)
    connected.add(ctx.from)
    const p = await S.loadPlayer(ctx.from)
    if (firstThisSession) {
      trackEvent('session started', ctx.from, { is_new_user: S.isFreshPlayer(ctx.from) })
    }
    pushSnapshot(p)
    broadcastPresence()
  })

  room.onMessage('adopt', async (data, ctx) => {
    if (!ctx) return
    console.log('[Server] adopt from', ctx.from, data.species)
    const p = await S.loadPlayer(ctx.from)
    const notes = S.adopt(p, data.species, data.name)
    await S.savePlayer(ctx.from)
    forwardNotes(ctx.from, notes)
    pushSnapshot(p)
    broadcastPresence()
  })

  room.onMessage('careAction', async (data, ctx) => {
    if (!ctx) return
    const p = await S.loadPlayer(ctx.from)
    const notes = S.careAction(p, data.action as CareAction, data.onBed)
    await S.savePlayer(ctx.from)
    forwardNotes(ctx.from, notes)
    pushSnapshot(p)
  })

  room.onMessage('petSelf', async (_data, ctx) => {
    if (!ctx) return
    const p = await S.loadPlayer(ctx.from)
    S.petSelf(p)
    pushSnapshot(p)
  })

  room.onMessage('petOther', async (data, ctx) => {
    if (!ctx) return
    const giver = await S.loadPlayer(ctx.from)
    const target = S.getCached(data.targetAddress) ?? (await S.loadPlayer(data.targetAddress))
    const notes = S.petOther(giver, target)
    await S.savePlayer(giver.address)
    await S.savePlayer(target.address)
    forwardNotes(giver.address, notes)
    pushSnapshot(giver)
    pushSnapshot(target)
  })

  room.onMessage('buyItem', async (data, ctx) => {
    if (!ctx) return
    const p = await S.loadPlayer(ctx.from)
    const notes = S.buyItem(p, data.tier)
    await S.savePlayer(ctx.from)
    forwardNotes(ctx.from, notes)
    pushSnapshot(p)
  })

  room.onMessage('useItem', async (data, ctx) => {
    if (!ctx) return
    const p = await S.loadPlayer(ctx.from)
    const notes = S.useItem(p, data.tier)
    await S.savePlayer(ctx.from)
    forwardNotes(ctx.from, notes)
    pushSnapshot(p)
  })

  room.onMessage('switchPet', async (data, ctx) => {
    if (!ctx) return
    const p = await S.loadPlayer(ctx.from)
    const notes = S.switchPet(p, data.petId)
    await S.savePlayer(ctx.from)
    forwardNotes(ctx.from, notes)
    pushSnapshot(p)
    broadcastPresence()
  })

  room.onMessage('buySlot', async (_data, ctx) => {
    if (!ctx) return
    const p = await S.loadPlayer(ctx.from)
    const notes = S.buySlot(p)
    await S.savePlayer(ctx.from)
    forwardNotes(ctx.from, notes)
    pushSnapshot(p)
  })

  room.onMessage('spin', async (_data, ctx) => {
    if (!ctx) return
    const p = await S.loadPlayer(ctx.from)
    const { notes, reward, index } = S.spin(p)
    await S.savePlayer(ctx.from)
    forwardNotes(ctx.from, notes)
    if (reward) room.send('spinResult', { json: JSON.stringify(reward), index }, { to: [ctx.from] })
    pushSnapshot(p)
  })

  // -- Periodic decay / persist / presence loop -----------------------------
  let tickAcc = 0
  let snapAcc = 0
  engine.addSystem((dt: number) => {
    tickAcc += dt
    snapAcc += dt

    if (tickAcc >= TICK_INTERVAL) {
      tickAcc = 0
      for (const p of S.allCached()) {
        S.tickPlayer(p)
        void S.savePlayer(p.address)
      }
      broadcastPresence()
    }

    if (snapAcc >= SNAPSHOT_INTERVAL) {
      snapAcc = 0
      // Refresh the HUD of connected owners with current decayed values.
      for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
        void entity
        const p = S.getCached(identity.address)
        if (p) pushSnapshot(p)
      }
    }
  })

  console.log('[Server] handlers + decay loop registered')
}
