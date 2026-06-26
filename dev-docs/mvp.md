# Decentraland Pet Care Game — MVP Design Doc

> Working title: TBD ("Care Center")
> Genre: Tamagotchi-style pet care sim with social hub, inspired by Pou + Roblox Adopt Me
> Platform: Decentraland (SDK7)

---

## 1. Core Concept

A shared, persistent "Care Center" parcel where each player adopts and raises
one pet. Players must feed, clean, exercise, and rest their pet to keep it
healthy and happy. Happiness generates passive currency, used to buy better
food/items from the in-scene Shop. The Care Center is a social hub — you see
other players and their pets in the same space, can pet/treat their pets for
a social score, and (later) breed pets together.

**Design pillars:**
- Solo-core loop (your pet, your responsibility) wrapped in a social space
  (DCL's natural multiplayer presence does the "showing off" for free).
- Neglect has real consequences (stat decay, even offline) — this is the
  addictive "guilt/return" hook from Tamagotchi.
- Visible progress (pet grows in size over sustained care) rewards
  continued attention.
- Currency loop ties pet happiness directly to player progress, so caring
  well *is* the economy, not a separate grind.

---

## 2. MVP Scope (Ring 0 + Ring 1)

In scope for MVP:
- 1 pet per player (species chosen at adoption from existing 10 models)
- 4 core stats with real-time decay (incl. offline)
- 4 care actions tied to scene items (Bowl, Bed, Ball, Pond)
- Growth: pet scales up in size at care milestones (no model swaps —
  see Section 3)
- Caretaker NPC for onboarding/tutorial
- Shop with 1–2 food tiers, bought with earned currency
- Happiness-based passive currency generation
- Pet follow/whistle (call & dismiss)
- Basic social interaction: pet/treat other players' pets, capped bonus,
  contributes to a separate "Giving" score
- Caretaker Level (player XP) + Pet XP (per-pet) — dual track, both
  stubbed at unlock-content level but built as real, data-driven systems
- Achievements (system + a handful of starter achievements)
- Daily login streak with milestone rewards
- Spin Wheel (weighted reward component, reusable across streak/
  achievement triggers)
- Persistence via Decentraland Auth Server (wallet-keyed pet state)

Explicitly OUT of scope for MVP (future rings):
- Breeding mechanic
- Cosmetic items / accessories
- Functional shop upgrades (bigger bowl, etc.)
- Leaderboards (Giving score + Caretaker score) — design is sketched below,
  build later
- Cross-scene pet following (pet exists only within Care Center parcel)
- Currency earned from breeding (depends on future rings)
- Pet evolution via model swap (see Section 3 — sizes only for MVP)

Note: multiple pets is now partially in-scope for MVP — see Section 6a
(Pet Storage). Player starts with 1 active pet slot, additional slots are
unlockable/purchasable.

Note: progression systems (Caretaker Level, Pet XP/Level, Achievements,
Daily Streak, Spin Wheel) are in-scope for MVP at a structural/stubbed
level — see Section 6b. Exact unlock tables and reward tuning are deferred,
but the data model (XP fields, level fields, streak counter, achievement
flags) should be built now so it's not retrofitted later.

---

## 3. Pet Roster (existing assets)

10 species already modeled and imported as `.glb` (in
`assets/scene/Models/Pet<Name>/`):

- PetTiger, PetPolar, PetPig, PetPenguin, PetParrot, PetPanda, PetMonkey,
  PetLion, PetKoala, PetHog, PetGiraffe (11 actually present)

**Decided: no model-swap evolution for MVP.** Growth is represented via
**scale only** (pet grows larger over time/care milestones using the same
model).

---

## 4. Scene Objects (already placed — positions confirmed in main.composite)

| Object | Position (x,z) | Care action |
|--------|---------------|-------------|
| Bowl   | 18.3, 25.0    | Feed → +Hunger |
| Bed    | 9.8, 21.3     | Sleep → +Energy (quality matters: Bed = full rate) |
| Ball   | 13.8, 17.3    | Play → +Happiness, −Energy (state machine) |
| Pond   | 22.5, 16.8    | Clean/Bath → +Hygiene |
| Caretaker | 11.5, 10.8 | NPC tutorial/tips |
| Shop   | 4.0, 12.0     | Buy food tiers |
| Large Stone Wall / _2 | 0.8 / 19.5, 31.7 | decor/boundary |

All care actions are **command-driven**: triggered via a UI button OR by
clicking the object. Both paths: pet **navigates to the object**, plays an
interaction animation, then the stat updates.

**Petting:** separate, no-navigation, instant. Click the pet anywhere →
small Happiness bump + reaction animation. Works on own and others' pets.

---

## 5. Core Stats

4 stats, 0–100, independent decay timers (rates TBD; starting points in code):

| Stat | Decays via | Refilled by | Decay rate |
|------|-----------|-------------|------------|
| Hunger | time | Bowl (Feed) | fastest |
| Hygiene | time | Pond (Clean) | medium |
| Energy | time + Play | Bed (Sleep) | medium |
| Happiness | time + low other stats | Ball + petting | slowest, penalized if others low |

**Derived:** Overall Mood — drops if any single stat hits 0. Sustained
neglect changes idle animation / sad face.

**Offline decay:** on load, fetch last-saved stats + timestamp, compute
elapsed real time, apply decay before render. Server-authoritative.

---

## 6. Currency & Shop

- **Earning:** passive income over time, scaled by Happiness. Higher
  happiness = higher earn rate.
- **Shop (MVP):** 2 food tiers. Tier 1 cheap/moderate Hunger; Tier 2
  pricier/full Hunger + small Happiness.

## 6a. Inventory & Pet Storage

- **Items inventory:** consumables (food tiers). Select → use on a pet →
  consumed.
- **Pet storage:** start 1 active slot; more via milestone AND/OR purchase.
  Only the active pet is rendered; switching is a UI action. Inactive pets
  still decay.

## 6b. Progression Systems

- **Caretaker Level (player XP):** persists across pets. Data-driven
  level→reward table (stubbed rewards).
- **Pet XP (per-pet):** earned via care actions, petting, and passively;
  higher Happiness = more XP. Per-pet unlocks (stubbed).
- **Achievements:** system built (tracking/triggering/rewarding); list is
  content. Likely the milestone mechanism for pet-slot unlocks.
- **Daily login streak:** login alone counts. Milestone rewards (spin
  tickets/currency).
- **Spin Wheel:** generic weighted-reward component. Pool: currency, slot
  unlock chances, stubbed cosmetic slot.

---

## 7. Social Layer

- All pets visible to everyone (native DCL presence).
- Pet follows owner within parcel; whistle toggles call/dismiss.
- Petting others' pets: small Happiness to pet, +Giving score to petter.
- Treating (feeding) others' pets: capped bonus, server cooldown per pair.
- Scoring (post-MVP): Caretaker leaderboard (by Caretaker Level), Giving
  score (weekly reset). Two separate boards.

---

## 8. Onboarding / Tutorial (Caretaker NPC)

Welcome → adoption → explain stats/objects → currency/shop → whistle →
social. Skippable for returning players.

---

## 9. Persistence (Decentraland Auth Server)

- Auth-server pattern: `@dcl/sdk@auth-server`, `authoritativeMultiplayer: true`.
- State keyed by wallet via `Storage.player`.
- Stored: species, stats, last-updated timestamp, size/growth, currency,
  XP/levels, streak, achievements, roster.
- On enter: fetch → apply offline decay → render.
- Action endpoints server-validated (anti-tamper).

---

## 10. Build Order (implementation rings)

1. Scene bootstrap + entity refs (by name) + server/client branch.
2. Pet data model (shared schemas) + adoption flow.
3. Stats system + decay (client display + server authority).
4. Pet spawn + follow/whistle.
5. Care actions w/ navigation (walk-to-object) + animations.
6. Petting (instant).
7. UI: stat bars, action buttons, currency.
8. Currency generation + Shop + inventory.
9. Persistence (Storage save/load + offline decay).
10. Progression (Caretaker/Pet XP, achievements, streak, spin wheel).
11. Caretaker NPC tutorial.
12. Social (treat/pet others) + Giving score.

---

## 11. Open Questions (tuning pass)

- Decay rates, currency earn rate, XP formulas — tune live.
- Streak grace-period rules, milestone reward sizing.
- Spin wheel odds/rarity tiers.
- Pet slot pricing/milestone thresholds.
- Size growth curve (trigger + number of stages).
- Achievement list content.
- Treat/pet cooldown specifics.

---

## Implementation Status (living — updated as we build)

- [x] Ring 1: bootstrap + branching (`src/index.ts` isServer())
- [x] Ring 2: pet model + adoption (adoption UI + server adopt)
- [x] Ring 3: stats + decay (server-authoritative, incl. offline + per-pet)
- [x] Ring 4: pet spawn + follow/whistle (client follow, Whistle/Dismiss toggle)
- [x] Ring 5: care actions + navigation (pet walks to object, then action fires)
- [x] Ring 6: petting (click own pet; click others' pets = treat)
- [x] Ring 7: UI (HUD, action bar, panels, toasts)
- [x] Ring 8: currency + shop + inventory (passive income, 2 food tiers, slots)
- [x] Ring 9: persistence + offline decay (Storage.player, wallet-keyed)
- [x] Ring 10: progression (Caretaker XP, Pet XP, achievements, streak, spin wheel)
- [x] Ring 11: Caretaker NPC tutorial (dialogue panel)
- [x] Ring 12: social layer (remote pets rendered near owners; Giving score)

MVP foundation is built, compiles clean, and the authoritative server boots
without errors in preview. Remaining work is tuning + polish, not new systems.

---

## Architecture (as built)

Single codebase, server/client split via `isServer()` (`src/index.ts`):

```
src/
  index.ts            # isServer() branch -> server or client
  shared/
    types.ts          # PetData / PlayerData / PresenceEntry / snapshot
    config.ts         # ALL tuning: decay, currency, XP, shop, achievements,
                      # streak, spin wheel, species, object positions
    messages.ts       # registerMessages() client<->server contract
  server/
    server.ts         # message handlers + decay/persist/presence loop
    state.ts          # authoritative logic: decay, care, currency, XP,
                      # achievements, streak, spin, Storage load/save
  client/
    setup.ts          # bootstrap: handlers + requestState once synced
    state.ts          # client mirror of server snapshot + send helpers
    pet.ts            # local pet render/follow/navigation + remote pets
    input.ts          # clickable Bowl/Bed/Ball/Pond/Caretaker/Shop
    ui.tsx            # HUD + all panels
```

**Authority model:** server owns all stats/currency/XP and persists to
`Storage.player` keyed by wallet. Clients send action messages; the server
validates (cooldowns, funds, slots, daily caps), mutates, persists, and pushes
a `stateSnapshot` back. Pets are rendered + animated locally for smooth feel;
care actions optimistically walk the pet to its object while the server
applies the authoritative stat change. Social visibility: server broadcasts a
lightweight `presence` list; each client renders every other player's pet near
that player's avatar.

**Offline decay:** on load the server applies elapsed-time decay to every pet
(active and stored) before the first snapshot, and re-ticks every 5s.

## How to run
- `npm start` — preview (auto-starts the authoritative server).
- `npm run build` — type-check + bundle.
- Server logs: add your wallet address to `scene.json` `logsPermissions`
  to see `[Server]` console output in the explorer.

## Mobile UI system (v2 — cozy-farm inspired)

Reference studied: https://github.com/dcl-regenesislabs/cozy-farm

New UI kit under `src/client/ui/`:
- `anim.ts` — generic keyed press/bounce button animation (one engine system
  drives all buttons via `triggerPress(id)` / `getPress(id)`), plus an
  attention pulse for highlighting CTAs.
- `theme.tsx` — warm palette, `isMobile()` responsive scaling (`S(n)` scales
  up ~1.3x on mobile), `OutlineLabel`, `TactileButton` (animated), `Pill`,
  `StatBar`, and `PanelShell` (rounded card + full-screen `pointerFilter:'block'`
  blocker so panel touches never move the avatar / trigger the mobile joystick).
- `dialog.tsx` — bottom-anchored multi-page NPC dialog box (portrait + name +
  paged body + Next/finalLabel button). Drives the Caretaker tutorial & tips.

`ui.tsx` rewritten mobile-first: top-left status card, top-right currency pills,
bottom care dock (Feed/Bath/Sleep/Play chips), right-side menu (Whistle, Shop,
My Pets, Spin, Goals), pulsing "Adopt a Pet" CTA, rounded animated panels, and
toasts. Every button has tactile press feedback.

Bug fixes in this pass:
- **Repeating welcome:** the intro now shows exactly once per session
  (`clientState.introShown` one-shot) instead of re-opening on every 3s
  server snapshot.
- **Pet too big:** `SIZE_BASE` 1.0 -> 0.55 (and `SIZE_MAX` 1.8 -> 1.1) so pets
  start small & cute and grow modestly with care.

## Known follow-ups / tuning (not blocking)
- Care buttons + menu use text labels (no icon atlas). Drop in PNG icon
  textures later for full cozy-farm polish (uiBackground texture + uvs).
- Caretaker portrait is a placeholder; add a real head image when available.
- `logsPermissions` is empty — add the deploying wallet to see server logs.
- Decay/currency/XP rates and reward sizes are first-pass guesses in
  `src/shared/config.ts` — tune live.
- Pet model base scale assumes 1.0 fits the scene; adjust `SIZE_BASE` if the
  GLB models render too large/small.
- Baked GLB animations (walk/eat/sleep) are not wired — motion is procedural
  (move + scale-bounce). Add `Animator` clips once clip names are confirmed.
- Leaderboards (Caretaker + Giving) are data-ready (givingScore, caretaker
  level persisted) but the boards themselves are post-MVP per scope.
