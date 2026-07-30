// Shared UI kit: warm "cute animal game" palette, fully color/shape based (no
// PNGs anywhere), responsive scaling, outlined labels, tactile (animated)
// buttons, pills, stat bars, and a panel shell. Desktop keeps a compact,
// centered layout; mobile (isMobile()) switches to a completely different,
// Roblox-style treatment: near-fullscreen panels, chunky rounded buttons and
// oversized fonts sized for thumbs instead of a mouse cursor.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { isMobile as sdkIsMobile } from '@dcl/sdk/platform'
import { getExplorerInformation } from '~system/Runtime'
import { getPress, triggerPress, attentionPulse } from './anim'

export type Color = { r: number; g: number; b: number; a: number }

// ---- Palette -------------------------------------------------------------
export const C = {
  panelBg: { r: 0.16, g: 0.12, b: 0.1, a: 0.98 } as Color,
  card: { r: 0.24, g: 0.19, b: 0.16, a: 1 } as Color,
  cardAlt: { r: 0.3, g: 0.24, b: 0.2, a: 1 } as Color,
  scrim: { r: 0, g: 0, b: 0, a: 0.55 } as Color,
  text: { r: 0.98, g: 0.95, b: 0.88, a: 1 } as Color,
  dim: { r: 0.74, g: 0.68, b: 0.6, a: 1 } as Color,
  outline: { r: 0.12, g: 0.08, b: 0.06, a: 1 } as Color,
  gold: { r: 1, g: 0.8, b: 0.3, a: 1 } as Color,
  green: { r: 0.4, g: 0.82, b: 0.45, a: 1 } as Color,
  greenDark: { r: 0.22, g: 0.5, b: 0.28, a: 1 } as Color,
  // stat colors
  hunger: { r: 0.98, g: 0.6, b: 0.25, a: 1 } as Color,
  hygiene: { r: 0.38, g: 0.68, b: 0.98, a: 1 } as Color,
  energy: { r: 0.98, g: 0.82, b: 0.3, a: 1 } as Color,
  happy: { r: 0.98, g: 0.5, b: 0.68, a: 1 } as Color,
  trackBg: { r: 0.12, g: 0.1, b: 0.09, a: 0.9 } as Color,
  pink: { r: 0.85, g: 0.45, b: 0.62, a: 1 } as Color,
  blue: { r: 0.4, g: 0.6, b: 0.9, a: 1 } as Color,
  red: { r: 0.9, g: 0.26, b: 0.2, a: 1 } as Color
}

export function dimColor(c?: Color): Color {
  const b = c ?? C.card
  return { r: b.r * 0.45, g: b.g * 0.45, b: b.b * 0.45, a: b.a }
}

// ---- Responsive scaling (virtual 1920x1080 desktop / 1600x720 compact) ----
// Mobile detection built on the SDK's isMobile() (@dcl/sdk/platform), which
// reads Runtime.getExplorerInformation() under the hood and resolves
// asynchronously with no fallback — on some mobile app builds it never flips
// to true, leaving the whole HUD stuck at desktop scale. We back it with our
// own direct getExplorerInformation() agent-string check so a slow/failed SDK
// resolution doesn't strand the HUD.
let isMobileRuntime = false
// The Bevy explorer reports platform:"web" agent:"bevy" and renders the HUD
// small at 1920x1080 — it needs the compact virtual canvas like mobile does.
let isBevyRuntime = false
let platformLookupStarted = false

const MOBILE_AGENT_RE = /mobile|android|iphone|ipad|ios/

/** True when the UI should use the smaller virtual canvas (mobile only). Bevy is
 * handled separately via a devicePixelRatio scale in S() — see below. */
export function useCompactCanvas(): boolean {
  return isMobileRuntime
}

/**
 * Live device pixel ratio, read from the renderer. Bevy (web) rasterizes the HUD
 * at the PHYSICAL resolution, so on a retina screen (dpr 2) everything comes out
 * half-size. We multiply S() by this on Bevy to compensate — resolution- and
 * density-independent, since it's read at render time.
 */
function devicePixelRatio(): number {
  const ci = UiCanvasInformation.getOrNull(engine.RootEntity)
  return ci?.devicePixelRatio || 1
}

/**
 * Kick off the (async) platform lookup once. Safe to call from setup.
 * `onResolved` fires once the lookup settles (success OR failure) — used to
 * re-apply the UI renderer with the right virtual canvas for mobile, since
 * virtualWidth/Height are fixed at setUiRenderer time and can't update per frame.
 */
export function resolveRuntimePlatform(onResolved?: () => void): void {
  if (platformLookupStarted) return
  platformLookupStarted = true
  void getExplorerInformation({})
    .then((info) => {
      const platform = (info.platform ?? '').toLowerCase()
      const agent = (info.agent ?? '').toLowerCase()
      if (platform === 'mobile' || MOBILE_AGENT_RE.test(agent)) isMobileRuntime = true
      isBevyRuntime = agent.includes('bevy')
      console.log('[Platform]', `platform:${platform || '?'} agent:${agent || '?'}`)
    })
    .catch(() => {
      // Couldn't read it — fall back to the SDK's own isMobile() below.
    })
    .then(() => {
      if (onResolved) onResolved()
    })
}

export function mobile(): boolean {
  return isMobileRuntime || sdkIsMobile()
}

// Global UI scale — larger touch targets on mobile, slightly larger on desktop
// too (mobile-testing friendly). React-ECS re-renders every frame, so the HUD
// resizes automatically once the platform lookup resolves.
export function S(n: number): number {
  // Bevy renders at physical resolution, so compensate for the pixel ratio.
  if (isBevyRuntime) return Math.round(n * 1.18 * devicePixelRatio())
  return Math.round(n * (isMobileRuntime ? 1.6 : 1.18))
}

/** Extra bump for touch buttons on mobile only (on top of S). Tune freely. */
export const MOBILE_BTN_BOOST = 1.2
export function Sbtn(n: number): number {
  return Math.round(S(n) * (isMobileRuntime ? MOBILE_BTN_BOOST : 1))
}

// ---- Outlined label (readable over the 3D world) -------------------------
const OFFSETS = [
  { left: -2, top: 0 },
  { left: 2, top: 0 },
  { left: 0, top: -2 },
  { left: 0, top: 2 }
]
export function OutlineLabel(props: {
  value: string
  fontSize: number
  color: Color
  outlineColor?: Color
  width: number | string
  height: number
  textAlign?: 'middle-left' | 'middle-center' | 'middle-right'
}) {
  const align = props.textAlign ?? 'middle-center'
  return (
    <UiEntity uiTransform={{ width: props.width as any, height: props.height }}>
      {OFFSETS.map((off, i) => (
        <Label
          key={`ol-${i}`}
          value={props.value}
          fontSize={props.fontSize}
          color={props.outlineColor ?? C.outline}
          textAlign={align}
          uiTransform={{ width: '100%', height: props.height, positionType: 'absolute', position: off }}
        />
      ))}
      <Label
        value={props.value}
        fontSize={props.fontSize}
        color={props.color}
        textAlign={align}
        uiTransform={{ width: '100%', height: props.height, positionType: 'absolute', position: { left: 0, top: 0 } }}
      />
    </UiEntity>
  )
}

// ---- Rounded badge (colored circle/rounded-square with a short glyph) ----
// Replaces every icon PNG in the old UI: a solid color disc/rounded square
// with 1-2 letters. Basic, fully vector (color-only), always rounded.
export function RoundedBadge(props: { key?: string; text: string; size: number; bg: Color; textColor?: Color; fontSize?: number; square?: boolean }) {
  const d = props.size
  return (
    <UiEntity
      uiTransform={{ width: d, height: d, borderRadius: props.square ? Math.round(d * 0.28) : d / 2, alignItems: 'center', justifyContent: 'center' }}
      uiBackground={{ color: props.bg }}
    >
      <Label value={props.text} fontSize={props.fontSize ?? Math.round(d * 0.42)} color={props.textColor ?? C.outline} textAlign="middle-center" uiTransform={{ width: d, height: d }} />
    </UiEntity>
  )
}

// ---- Tactile button (press/bounce animation) -----------------------------
export function TactileButton(props: {
  key?: string | number
  id: string
  label: string
  onClick: () => void
  width: number
  height: number
  bg?: Color
  textColor?: Color
  fontSize?: number
  disabled?: boolean
  pulse?: boolean
  radius?: number
  margin?: Partial<{ top: number; right: number; bottom: number; left: number }>
}) {
  const scale = getPress(props.id) * (props.pulse && !props.disabled ? attentionPulse() : 1)
  const w = Math.round(props.width * scale)
  const h = Math.round(props.height * scale)
  return (
    <UiEntity
      uiTransform={{ width: props.width, height: props.height, alignItems: 'center', justifyContent: 'center', margin: props.margin }}
    >
      <UiEntity
        uiTransform={{ width: w, height: h, alignItems: 'center', justifyContent: 'center', borderRadius: props.radius ?? S(16) }}
        uiBackground={{ color: props.disabled ? dimColor(props.bg) : props.bg ?? C.card }}
        onMouseDown={() => {
          if (props.disabled) return
          triggerPress(props.id)
          props.onClick()
        }}
      >
        <Label
          value={props.label}
          fontSize={props.fontSize ?? S(18)}
          color={props.disabled ? C.dim : props.textColor ?? C.text}
          textAlign="middle-center"
          uiTransform={{ width: w, height: h }}
        />
      </UiEntity>
    </UiEntity>
  )
}

// Big circular care button: colored disc with a glyph + caption beneath.
// This is the "Roblox-style" chunky action button used heavily on mobile.
export function CareButton(props: {
  key?: string | number
  id: string
  caption: string
  glyph: string
  onClick: () => void
  bg: Color
  size: number
  disabled?: boolean
  pulse?: boolean
  fontSize?: number
}) {
  const scale = getPress(props.id) * (props.pulse && !props.disabled ? attentionPulse() : 1)
  const d = Math.round(props.size * scale)
  return (
    <UiEntity uiTransform={{ width: props.size, height: props.size + S(26), flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', margin: { left: S(7), right: S(7) } }}>
      <UiEntity uiTransform={{ width: props.size, height: props.size, alignItems: 'center', justifyContent: 'center' }}>
        <UiEntity
          uiTransform={{ width: d, height: d, alignItems: 'center', justifyContent: 'center', borderRadius: Math.round(props.size) }}
          uiBackground={{ color: props.disabled ? dimColor(props.bg) : props.bg }}
          onMouseDown={() => {
            if (props.disabled) return
            triggerPress(props.id)
            props.onClick()
          }}
        >
          <OutlineLabel value={props.glyph} fontSize={props.fontSize ?? Math.round(props.size * 0.42)} color={C.text} width={d} height={d} />
        </UiEntity>
      </UiEntity>
      <Label value={props.caption} fontSize={S(14)} color={C.text} textAlign="middle-center" uiTransform={{ width: props.size + S(18), height: S(22) }} />
    </UiEntity>
  )
}

// ---- Info pill -----------------------------------------------------------
export function Pill(props: { label: string; value: string; bg?: Color; accent?: Color; width?: number }) {
  return (
    <UiEntity
      uiTransform={{ width: props.width ?? S(132), height: S(40), flexDirection: 'row', alignItems: 'center', borderRadius: S(20), margin: { bottom: S(6) } }}
      uiBackground={{ color: props.bg ?? C.card }}
    >
      <UiEntity
        uiTransform={{ width: S(30), height: S(30), borderRadius: S(15), margin: { left: S(5), right: S(8) }, alignItems: 'center', justifyContent: 'center' }}
        uiBackground={{ color: props.accent ?? C.gold }}
      >
        <Label value={props.label} fontSize={S(15)} color={C.outline} textAlign="middle-center" uiTransform={{ width: S(30), height: S(30) }} />
      </UiEntity>
      <Label value={props.value} fontSize={S(17)} color={C.text} textAlign="middle-left" uiTransform={{ width: (props.width ?? S(132)) - S(48), height: S(40) }} />
    </UiEntity>
  )
}

// ---- Stat bar (rounded, color-only) ---------------------------------------
export function StatBar(props: {
  label: string
  value: number
  color: Color
  width: number
  /** Optional 1-2 letter badge instead of the text label (used in compact rows). */
  badge?: string
  /** Bar thickness; mobile callers pass a chunkier value. */
  thickness?: number
}) {
  const v = Math.max(0, Math.min(100, props.value))
  const badgeD = props.thickness ? props.thickness + S(10) : S(26)
  const gap = S(8)
  const headW = props.badge ? badgeD : S(58)
  const trackW = props.width - headW - gap
  const trackH = props.thickness ?? S(15)
  const rowH = Math.max(S(26), badgeD)
  return (
    <UiEntity uiTransform={{ width: props.width, height: rowH, flexDirection: 'row', alignItems: 'center', margin: { bottom: S(4) } }}>
      {props.badge ? (
        <RoundedBadge text={props.badge} size={badgeD} bg={props.color} fontSize={Math.round(badgeD * 0.42)} />
      ) : (
        <Label
          value={props.label}
          fontSize={S(13)}
          color={C.text}
          textAlign="middle-left"
          uiTransform={{ width: headW, height: S(22), margin: { right: gap } }}
        />
      )}
      <UiEntity uiTransform={{ width: trackW, height: trackH, borderRadius: Math.round(trackH / 2) }} uiBackground={{ color: C.trackBg }}>
        <UiEntity uiTransform={{ width: `${v}%`, height: '100%', borderRadius: Math.round(trackH / 2) }} uiBackground={{ color: props.color }} />
      </UiEntity>
    </UiEntity>
  )
}

// ---- Round close ("X") button --------------------------------------------
export function CloseButton(props: { onClick: () => void; size: number; bg?: Color }) {
  return (
    <UiEntity
      uiTransform={{ width: props.size, height: props.size, borderRadius: props.size / 2, alignItems: 'center', justifyContent: 'center' }}
      uiBackground={{ color: props.bg ?? { r: 0.5, g: 0.2, b: 0.16, a: 1 } }}
      onMouseDown={props.onClick}
    >
      <Label value="X" fontSize={Math.round(props.size * 0.5)} color={C.text} textAlign="middle-center" uiTransform={{ width: props.size, height: props.size }} />
    </UiEntity>
  )
}

// ---- Panel shell -----------------------------------------------------------
// Desktop: compact centered card sized by the caller. Mobile: a completely
// different, near-fullscreen sheet with much bigger title/close so it works
// with thumbs instead of a cursor.
export function PanelShell(props: { title: string; onClose: () => void; width?: number; height?: number; children?: any }) {
  const isM = mobile()
  // 40% smaller than the original near-fullscreen sheet (94%/90% overflowed
  // the safe area) — titleFont/closeSize below are unaffected by this.
  const w = isM ? '56%' : props.width ?? S(620)
  const h = isM ? '54%' : props.height ?? S(640)
  const titleFont = isM ? S(34) : S(28)
  const closeSize = isM ? S(56) : S(44)
  const pad = isM ? S(22) : S(24)
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}
    >
      {/* Full-screen blocker so touches outside the card don't move the avatar. */}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', pointerFilter: 'block' }}
        uiBackground={{ color: C.scrim }}
        onMouseDown={() => {}}
      />
      <UiEntity
        uiTransform={{ width: w as any, height: h as any, flexDirection: 'column', padding: { top: S(18), bottom: S(22), left: pad, right: pad }, borderRadius: isM ? S(28) : S(24), pointerFilter: 'block' }}
        uiBackground={{ color: C.panelBg }}
      >
        {/* Header */}
        <UiEntity uiTransform={{ width: '100%', height: closeSize + S(6), alignItems: 'center', justifyContent: 'center', margin: { bottom: S(6) } }}>
          <OutlineLabel value={props.title} fontSize={titleFont} color={C.gold} width={'100%'} height={titleFont + S(12)} textAlign="middle-center" />
          <UiEntity uiTransform={{ positionType: 'absolute', position: { right: 0, top: 0 } }}>
            <CloseButton onClick={props.onClose} size={closeSize} />
          </UiEntity>
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', height: S(3), margin: { bottom: S(12) }, borderRadius: S(2) }} uiBackground={{ color: C.cardAlt }} />
        <UiEntity uiTransform={{ flex: 1, width: '100%', flexDirection: 'column', overflow: 'scroll' }}>{props.children}</UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
