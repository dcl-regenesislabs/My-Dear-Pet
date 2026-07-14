// Client <-> Server message contract. Complex payloads are serialized as JSON
// strings inside a `json` field to keep schemas simple and robust.

import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
  // ---- Client -> Server ----
  // Ask the server for my full state (sent once the room is ready).
  requestState: Schemas.Map({ guestName: Schemas.String }),
  // Adopt a pet (first time or into a free slot).
  adopt: Schemas.Map({ species: Schemas.String, name: Schemas.String }),
  // Trigger a care action: feed | clean | sleep | play. onBed = slept on the Bed.
  careAction: Schemas.Map({ action: Schemas.String, onBed: Schemas.Boolean }),
  // Pet your own active pet (instant happiness).
  petSelf: Schemas.Map({}),
  // Pet/treat another player's pet.
  petOther: Schemas.Map({ targetAddress: Schemas.String }),
  // Shop: buy a food tier (1 | 2).
  buyItem: Schemas.Map({ tier: Schemas.Int }),
  // Use a food item from inventory on the active pet.
  useItem: Schemas.Map({ tier: Schemas.Int }),
  // Roster: switch which pet is active.
  switchPet: Schemas.Map({ petId: Schemas.String }),
  // Buy an extra pet slot with currency.
  buySlot: Schemas.Map({}),
  // Spend a spin ticket on the wheel.
  spin: Schemas.Map({}),
  // Report my pet's follow state (Whistle/Stay) so the server can broadcast it
  // in presence for everyone to mirror.
  setFollow: Schemas.Map({ following: Schemas.Boolean }),

  // ---- Server -> Client ----
  // Full owner snapshot (PlayerSnapshot JSON) for the requesting client.
  stateSnapshot: Schemas.Map({ json: Schemas.String }),
  // Broadcast of all pet presence entries (PresenceEntry[] JSON) for social rendering.
  presence: Schemas.Map({ json: Schemas.String }),
  // Toast / notification.
  notify: Schemas.Map({ kind: Schemas.String, message: Schemas.String }),
  // Spin wheel result (SpinReward JSON + landing index for animation).
  spinResult: Schemas.Map({ json: Schemas.String, index: Schemas.Int })
}

export const room = registerMessages(Messages)
