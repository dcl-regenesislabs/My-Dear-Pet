# Scene audio

## Jukebox tracks (issue #110) — NOT YET COMMITTED

The Marsh Colony jukebox (`src/client/music.ts`) expects two ambient tracks by
Daniel Garcia Aranda, which were shared as Slack attachments and are **not in
this repo yet**:

| File                              | Track label    | Notes            |
| --------------------------------- | -------------- | ---------------- |
| `assets/sounds/marshy_marsh.mp3`  | `Marshy Marsh` | default on load  |
| `assets/sounds/swampy_marsh.mp3`  | `Swampy Marsh` | alternate        |

Drop both files here with exactly those names and the jukebox works with no code
change — the paths and labels live in `SONGS` in `src/client/music.ts`. Until
then the panel, the mute toggle and the volume ladder all still operate, there
is just no audio to hear (a missing `audioClipUrl` fails to load quietly; it
does not throw).

Both tracks should be loopable — `music.ts` plays them with `loop: true`.
