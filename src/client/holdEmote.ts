// Shared "hold pose" emote helpers — used by pet.ts (egg carry, pet-to-bath
// carry) and fruitGame.ts (drawer carry) for the looping, upper-body-masked
// scene emote played while carrying something, and for stopping it again.

import { triggerSceneEmote, stopEmote } from '~system/RestrictedActions'
import { AvatarMask } from '@dcl/sdk/ecs'
import { mobile, bevy } from './ui/theme'

let lastSrc: string | null = null

export function triggerHoldEmote(src: string): void {
  lastSrc = src
  void triggerSceneEmote({ src, loop: true, mask: AvatarMask.AM_UPPER_BODY }).catch(() => {})
}

/**
 * Stop the current hold emote (issue #115).
 *
 * `stopEmote` isn't guaranteed to exist as a callable function on every
 * client build — confirmed live: calling it unguarded threw synchronously on
 * the tested mobile build, which aborted the caller mid-function (the egg
 * disappeared but startHatch() never ran). Always guard the call.
 *
 * On mobile/Bevy, also re-trigger the SAME clip with the SAME upper-body
 * mask, but loop:false. Per the client's own masked-emote lifecycle, a
 * masked one-shot that finishes playing naturally gets a real, PERMANENT
 * reset — unlike a full-body emote (tried earlier), which only suppresses
 * the masked layer while it plays and lets it resume once it ends. This only
 * works cleanly now that pet.ts/fruitGame.ts no longer re-trigger the pose
 * on movement pauses — that redundant re-trigger could race this stop and
 * resurrect the loop (see pet.ts's updateCarryEgg for that fix); this exact
 * loop:false retrigger looked like it didn't work in earlier testing, but
 * that was with the race still present.
 */
export function stopHoldEmote(): void {
  const src = lastSrc
  lastSrc = null

  if (typeof stopEmote === 'function') {
    void stopEmote({}).catch(() => {})
  }

  if (!src || !(mobile() || bevy())) return
  void triggerSceneEmote({ src, loop: false, mask: AvatarMask.AM_UPPER_BODY }).catch(() => {})
}
