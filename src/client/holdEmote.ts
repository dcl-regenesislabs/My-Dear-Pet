// Shared "hold pose" emote helpers — used by pet.ts (egg carry, pet-to-bath
// carry) and fruitGame.ts (drawer carry) for the looping, upper-body-masked
// scene emote played while carrying something, and for stopping it again.

import { triggerSceneEmote } from '~system/RestrictedActions'
import * as RestrictedActions from '~system/RestrictedActions'
import { AvatarMask } from '@dcl/sdk/ecs'
import { mobile, bevy } from './ui/theme'

let lastSrc: string | null = null

export function triggerHoldEmote(src: string): void {
  lastSrc = src
  void triggerSceneEmote({ src, loop: true, mask: AvatarMask.AM_UPPER_BODY }).catch(() => {})
}

/**
 * Stop the current hold emote. `RestrictedActions.stopEmote` is unreliable on
 * mobile/Bevy (issue #115) — it's either missing entirely or resolves without
 * actually cancelling anything, so the looping upper-body-masked emote just
 * plays forever there.
 *
 * Fix: re-trigger the SAME clip again, but with no mask (full body) and
 * loop:false. Full-body playback occupies every animation layer instead of
 * just the upper-body one, which evicts whatever was wedged in that masked
 * layer; a masked loop:false retrigger and a different full-body gesture
 * ('shrug') were both tried first and neither cleared the stuck pose.
 * Scoped to mobile/Bevy only so desktop (where stopEmote alone already
 * works) sees no change.
 */
export function stopHoldEmote(): void {
  const src = lastSrc
  lastSrc = null

  if (typeof RestrictedActions.stopEmote === 'function') {
    void RestrictedActions.stopEmote({}).catch(() => {})
  }

  if (!src || !(mobile() || bevy())) return
  void triggerSceneEmote({ src, loop: false }).catch(() => {})
}
