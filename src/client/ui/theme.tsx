// Shared mobile-first UI kit: warm "cute animal game" palette, responsive
// scaling, outlined labels, tactile (animated) buttons, pills, stat bars, and a
// panel shell that blocks the mobile joystick. Inspired by the cozy-farm UI.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { isMobile } from '@dcl/sdk/platform'
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
  blue: { r: 0.4, g: 0.6, b: 0.9, a: 1 } as Color
}

export function dimColor(c?: Color): Color {
  const b = c ?? C.card
  return { r: b.r * 0.45, g: b.g * 0.45, b: b.b * 0.45, a: b.a }
}

// ---- Responsive scaling (virtual 1920x1080) ------------------------------
// Mobile gets larger touch targets / fonts.
export function mobile(): boolean {
  return isMobile()
}
// Global UI scale — larger touch targets on mobile, slightly larger on desktop
// too (mobile-testing friendly).
export function S(n: number): number {
  return Math.round(n * (isMobile() ? 1.6 : 1.18))
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

// Big circular care button: colored disc with caption beneath.
export function CareButton(props: {
  id: string
  caption: string
  glyph: string
  onClick: () => void
  bg: Color
  size: number
  disabled?: boolean
  pulse?: boolean
}) {
  const scale = getPress(props.id) * (props.pulse && !props.disabled ? attentionPulse() : 1)
  const d = Math.round(props.size * scale)
  return (
    <UiEntity uiTransform={{ width: props.size, height: props.size + S(22), flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', margin: { left: S(7), right: S(7) } }}>
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
          <OutlineLabel value={props.glyph} fontSize={Math.round(props.size * 0.42)} color={C.text} width={d} height={d} />
        </UiEntity>
      </UiEntity>
      <Label value={props.caption} fontSize={S(14)} color={C.text} textAlign="middle-center" uiTransform={{ width: props.size + S(14), height: S(20) }} />
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

// ---- Stat bar (rounded) --------------------------------------------------
export function StatBar(props: { label: string; value: number; color: Color; width: number }) {
  const v = Math.max(0, Math.min(100, props.value))
  const trackW = props.width - S(64)
  return (
    <UiEntity uiTransform={{ width: props.width, height: S(26), flexDirection: 'row', alignItems: 'center', margin: { bottom: S(5) } }}>
      <Label value={props.label} fontSize={S(13)} color={C.text} textAlign="middle-left" uiTransform={{ width: S(58), height: S(22) }} />
      <UiEntity uiTransform={{ width: trackW, height: S(15), borderRadius: S(8) }} uiBackground={{ color: C.trackBg }}>
        <UiEntity uiTransform={{ width: `${v}%`, height: '100%', borderRadius: S(8) }} uiBackground={{ color: props.color }} />
      </UiEntity>
    </UiEntity>
  )
}

// ---- Panel shell ---------------------------------------------------------
export function PanelShell(props: { title: string; onClose: () => void; width?: number; height?: number; children?: any }) {
  const w = props.width ?? S(620)
  const h = props.height ?? S(640)
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
        uiTransform={{ width: w, height: h, flexDirection: 'column', padding: { top: S(18), bottom: S(22), left: S(24), right: S(24) }, borderRadius: S(24), pointerFilter: 'block' }}
        uiBackground={{ color: C.panelBg }}
      >
        {/* Header */}
        <UiEntity uiTransform={{ width: '100%', height: S(50), alignItems: 'center', justifyContent: 'center', margin: { bottom: S(6) } }}>
          <OutlineLabel value={props.title} fontSize={S(28)} color={C.gold} width={'100%'} height={S(40)} textAlign="middle-center" />
          <UiEntity
            uiTransform={{ positionType: 'absolute', position: { right: 0, top: 0 }, width: S(44), height: S(44), borderRadius: S(22), alignItems: 'center', justifyContent: 'center' }}
            uiBackground={{ color: { r: 0.5, g: 0.2, b: 0.16, a: 1 } }}
            onMouseDown={props.onClose}
          >
            <Label value="X" fontSize={S(22)} color={C.text} textAlign="middle-center" uiTransform={{ width: S(44), height: S(44) }} />
          </UiEntity>
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', height: S(3), margin: { bottom: S(12) }, borderRadius: S(2) }} uiBackground={{ color: C.cardAlt }} />
        <UiEntity uiTransform={{ flex: 1, width: '100%', flexDirection: 'column', overflow: 'hidden' }}>{props.children}</UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
