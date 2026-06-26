# My Dear Pet

A Tamagotchi-style **pet care game** for Decentraland (SDK7) — adopt a pet, keep
it fed, clean, rested and happy, earn coins from its happiness, and raise it in a
shared social Care Center. Inspired by Pou + Roblox Adopt Me.

> Status: MVP in active development. See [`dev-docs/mvp.md`](dev-docs/mvp.md) for
> the full design doc and implementation status.

## Features

- **Adopt & raise pets** — pick from 11 species, name them, watch them grow with care.
- **Care loop** — Feed (Bowl), Bath (Pond), Sleep (Bed), Play (Ball). Actions are
  queued: the pet walks to each station, animates, then rests before the next.
- **Live stats & decay** — Hunger / Hygiene / Energy / Happiness decay over time.
- **Economy** — happiness generates passive coins; a tabbed Shop sells food and
  extra pet slots; an Inventory holds consumables.
- **Progression** — Caretaker level (player XP) + per-pet XP, achievements/goals,
  a **7-day login streak** calendar, and a weighted **spin wheel**.
- **Multiple pets** — your non-active pets roam the world; tap one to select it.
- **Social** — other players' active pets are visible following them in real time
  (native `MessageBus` peer presence); pet other players' pets for a Giving score.
- **Mobile-first UI** — rounded, animated, touch-sized HUD with a dialog-driven
  Caretaker tutorial. Nothing is placed in screen corners (reserved by DCL mobile).

## Architecture

Single codebase, server/client split via `isServer()` (`src/index.ts`):

```
src/
  shared/   types, tuning config (all balance lives in config.ts), message schemas
  server/   headless authoritative server: state, decay, persistence (Storage)
  client/   pet rendering/animation/navigation, peer presence, local simulation, UI
```

The client also **simulates the game locally** (seeds a default player, runs decay
/ economy / streak) so the HUD always renders and play stays responsive; the
authoritative server corrects and persists state via snapshots when reachable.

Scene objects (Bowl, Bed, Ball, Pond, Caretaker, Shop) are placed in the Creator
Hub editor (`assets/scene/main.composite`) and referenced by name.

## Develop

```bash
npm install
npm start      # preview (auto-starts the authoritative server)
npm run build  # type-check + bundle
```

Open two browser windows against the preview to test multiplayer (each is a
separate player).

## Notes

- Uses the `@dcl/sdk@auth-server` branch (required for `isServer`, `Storage`,
  `registerMessages`).
- To see `[Server]` logs, add your wallet address to `logsPermissions` in `scene.json`.
- A couple of clearly-commented `// TEST` hooks (free coins via the Caretaker /
  Shop) exist for fast economy testing — remove before launch.

🤖 Built with [Claude Code](https://claude.com/claude-code)
