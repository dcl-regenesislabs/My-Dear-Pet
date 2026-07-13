// Single analytics choke point. NOTHING else in the codebase talks to PostHog
// directly — swap providers here and nowhere else. Fire-and-forget: tracking
// must never block, slow, or crash gameplay. Any failure is swallowed.
//
// Uses `signedFetch` (~system/SignedFetch) instead of the global `fetch`: the
// authoritative-server (hammurabi) runtime does NOT expose `fetch`, but it does
// expose signedFetch (it's what Storage/EnvVar use under the hood). signedFetch
// also exists client-side, so this one path works in both runtimes. PostHog
// ignores the extra DCL signature headers and just reads the JSON body.
//
// See dev-docs/posthog-analytics-integration.md.

import { signedFetch } from '~system/SignedFetch'
import * as C from './config'

/**
 * Emit one analytics event. `distinctId` is the player's wallet (identity that
 * ties sessions together for retention). Adding a future event is just another
 * trackEvent(...) call — no new plumbing.
 */
export function trackEvent(name: string, distinctId: string, properties: Record<string, any> = {}): void {
  if (!C.ANALYTICS_ENABLED) return
  if (!distinctId) return // no wallet -> no usable identity, skip

  try {
    const body = JSON.stringify({
      api_key: C.POSTHOG_PROJECT_API_KEY,
      event: name,
      distinct_id: distinctId,
      timestamp: new Date().toISOString(),
      properties: { game: C.GAME_ID, $lib: 'dcl-sdk7-custom', ...properties }
    })

    // Fire-and-forget: never await into gameplay. Silent on success; only logs
    // if the request is rejected or errors, so problems still leave a trace.
    void signedFetch({
      url: `https://${C.POSTHOG_HOST}/i/v0/e/`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      }
    })
      .then((res) => {
        // TEMP verification log — shows every send. Revert to `if (!res.ok)` once confirmed.
        console.log(`[analytics] ${name} -> ${res.status}${res.ok ? '' : ' (rejected)'}`)
      })
      .catch((e) => {
        console.log(`[analytics] ${name} failed:`, e)
      })
  } catch (e) {
    // analytics must never break the game
    console.log('[analytics] threw:', e)
  }
}
