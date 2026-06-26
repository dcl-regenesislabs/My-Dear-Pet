// Generic keyed button-press animation (press-dip -> bounce -> settle).
// Any button reads getPress(key) for its current scale and calls triggerPress(key)
// on mouse-down. One engine system drives all of them. Mirrors the tactile feel
// of the cozy-farm cardZoom system.

import { engine } from '@dcl/sdk/ecs'

const KF: [number, number][] = [
  [0, 1.0],
  [70, 0.9], // press-in
  [190, 1.08], // bounce
  [300, 1.0] // settle
]
const DURATION = 300

function evalKf(elapsed: number): number {
  for (let i = 1; i < KF.length; i++) {
    const [t0, s0] = KF[i - 1]
    const [t1, s1] = KF[i]
    if (elapsed <= t1) {
      const f = (elapsed - t0) / (t1 - t0)
      return s0 + (s1 - s0) * f
    }
  }
  return 1
}

const presses: Record<string, { startAt: number; scale: number }> = {}

export function triggerPress(key: string): void {
  if (!presses[key]) presses[key] = { startAt: 0, scale: 1 }
  presses[key].startAt = Date.now()
}

export function getPress(key: string): number {
  return presses[key]?.scale ?? 1
}

// Soft continuous attention pulse (used to highlight the next tutorial step).
let pulseT = 0
export function attentionPulse(): number {
  return 1 + 0.12 * Math.abs(Math.sin(pulseT * Math.PI * 1.4))
}

let started = false
export function startAnimSystem(): void {
  if (started) return
  started = true
  engine.addSystem((dt: number) => {
    pulseT += dt
    const now = Date.now()
    for (const k of Object.keys(presses)) {
      const a = presses[k]
      if (a.startAt === 0) continue
      const elapsed = now - a.startAt
      if (elapsed >= DURATION) {
        a.scale = 1
        a.startAt = 0
      } else {
        a.scale = evalKf(elapsed)
      }
    }
  })
}
