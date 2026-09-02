// Jukebox: the colony's ambient soundtrack, ported from the cozy-farm jukebox
// (src/game/musicState.ts + src/systems/musicSystem.ts over there, merged into
// one module here to match this repo's one-file-per-feature client layout).
//
// Two tracks by Daniel Garcia Aranda ship with the scene; "Marshy Marsh" is the
// default. Everything is client-side and per-session: the track, the mute flag
// and the volume are NOT sent to the authoritative server and NOT persisted, so
// a reload starts back on the default track. That's deliberate — the server
// state is gameplay, and a music preference isn't worth a schema change.
//
// The audio entity is parented to the player so the music follows them at zero
// distance. That sidesteps DCL's spatial attenuation entirely and plays at a
// flat volume anywhere in the parcel, which is what a background track wants.

import { engine, AudioSource, Entity, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

export type SongId = 'marshy_marsh' | 'swampy_marsh'

export type SongDef = {
  id: SongId
  label: string
  src: string
}

// Order matters — this is the order the jukebox lists them in, and SONGS[0] is
// the track that starts playing on load.
export const SONGS: SongDef[] = [
  {
    id: 'marshy_marsh',
    label: 'Marshy Marsh',
    src: 'assets/sounds/marshy_marsh.mp3'
  },
  {
    id: 'swampy_marsh',
    label: 'Swampy Marsh',
    src: 'assets/sounds/swampy_marsh.mp3'
  }
]

/** Ambient bed, not a foreground track — quiet enough to talk over. */
export const DEFAULT_VOLUME = 0.42

export const musicState = {
  currentSongId: SONGS[0].id,
  muted: false,
  volume: DEFAULT_VOLUME,
  /** Set by setupMusic() once the audio entity exists. */
  audioEntity: null as Entity | null
}

export function currentSong(): SongDef {
  return SONGS.find((s) => s.id === musicState.currentSongId) ?? SONGS[0]
}

/** Create the background-music entity and start the default track. */
export function setupMusic(): void {
  if (musicState.audioEntity !== null) return

  const audioEntity = engine.addEntity()
  Transform.create(audioEntity, { parent: engine.PlayerEntity, position: Vector3.Zero() })

  AudioSource.create(audioEntity, {
    audioClipUrl: currentSong().src,
    playing: !musicState.muted,
    loop: true,
    volume: musicState.volume
  })

  musicState.audioEntity = audioEntity
}

/**
 * Switch tracks immediately. createOrReplace, not getMutable — swapping
 * audioClipUrl on the live component is silently ignored by the renderer, the
 * whole AudioSource has to be re-sent for the new clip to be picked up.
 */
export function playSong(songId: SongId): void {
  const song = SONGS.find((s) => s.id === songId)
  if (!song) return

  musicState.currentSongId = song.id

  const entity = musicState.audioEntity
  if (entity === null) return

  AudioSource.createOrReplace(entity, {
    audioClipUrl: song.src,
    playing: !musicState.muted,
    loop: true,
    volume: musicState.volume
  })
}

/** Set mute to a specific value. */
export function setMuted(muted: boolean): void {
  if (musicState.muted === muted) return
  musicState.muted = muted

  const entity = musicState.audioEntity
  if (entity !== null) AudioSource.getMutable(entity).playing = !muted
}

export function toggleMute(): void {
  setMuted(!musicState.muted)
}

/** Set the background music volume (0.0 - 1.0). */
export function setMusicVolume(volume: number): void {
  musicState.volume = Math.max(0, Math.min(1, volume))

  const entity = musicState.audioEntity
  if (entity !== null) AudioSource.getMutable(entity).volume = musicState.volume
}
