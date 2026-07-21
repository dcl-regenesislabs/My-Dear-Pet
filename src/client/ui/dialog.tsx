// Bottom-anchored NPC dialog box (cozy-farm style): portrait + name + paged
// body text + a primary button. Used for the Caretaker tutorial and tips.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { getPlayer } from '@dcl/sdk/players'
import { advanceDialog, clientState, closeDialog, openDialog } from '../state'
import { C, mobile, OutlineLabel, S, TactileButton } from './theme'

// Tutorial dialog art (image aspect ratios noted for undistorted sizing).
const DLG = {
  modal: 'assets/images/tutorialUi/modal.png', // 960x680  (1.41:1)
  character: 'assets/images/tutorialUi/ui-character-1024.png', // square
  next: 'assets/images/tutorialUi/btn_next.png', // 639x378 (1.69:1)
  adopt: 'assets/images/tutorialUi/btn_adopt.png', // 897x378 (2.37:1)
  close: 'assets/images/tutorialUi/btn_close.png' // 256x256 (square)
}

/** The local player's display name, or a themed fallback. */
export function playerName(): string {
  const n = getPlayer()?.name
  return n && n.trim() ? n.trim() : 'Settler'
}

/** Built dynamically so the Caretaker can greet the player by name. */
export function caretakerIntro(): string[] {
  return [
    `Welcome to the Mars colony, ${playerName()}. I'm the Caretaker — out here, every colony is built on the creatures we raise.`,
    'Tap "Adopt a Pet" to take in your first Martian companion.',
    'Keep it thriving: Feed at the Bowl, Bath at the Pond, Sleep on the Bed, Play at the Ball. Tap it anytime for some love.',
    "A healthy, happy pet earns Coins — and soon you'll breed it with other settlers' pets to grow the colony. Let's begin!"
  ]
}

export const CARETAKER_TIPS: string[] = [
  'Happy, healthy pets earn more Coins and XP — and the healthier the pet, the stronger its future offspring.',
  'Breeding is coming soon: raise your pet\'s level and you\'ll be able to cross it with other colonists\' pets.',
  'Use the Whistle button to call your pet over or tell it to stay put.'
]

export function openCaretakerIntro(onDone?: () => void): void {
  openDialog('Caretaker', caretakerIntro(), 'Adopt now!', onDone)
}

export function openCaretakerTips(): void {
  openDialog('Caretaker', CARETAKER_TIPS, 'Got it!')
}

export function DialogBox() {
  const d = clientState.dialog
  if (!d.open) return <UiEntity />
  const isLast = d.page >= d.pages.length - 1
  const body = d.pages[d.page] ?? ''

  // Modal art (960x680) is nine-sliced so it can be wide with crisp corners.
  // Desktop keeps the approved layout; mobile-only overrides make it narrower
  // and shrink the character (S()'s 1.6x boost over-inflates a big panel there).
  const isM = mobile()
  const MW = isM ? S(860) : S(940) // bigger on mobile so buttons/text aren't cramped
  const MH = isM ? Math.round(MW * 0.346) : S(325)
  const padX = isM ? Math.round(MW * 0.1) : S(50) // more horizontal inset so the X and Next sit inside the frame
  const padY = isM ? Math.round(MH * 0.15) : S(34)
  const innerH = MH - padY * 2
  const gap = isM ? Math.round(MW * 0.045) : S(18) // more space between the character and the text
  const charH = isM ? Math.round(innerH * 0.6) : innerH // full-height on desktop, ~half on mobile
  const charW = charH // character art is square
  const textW = MW - padX * 2 - charW - gap
  const btnH = isM ? Math.round(MH * 0.17) : S(50)
  const nameH = isM ? Math.round(MH * 0.09) : S(28)
  const nameFont = isM ? Math.round(MH * 0.075) : S(22)
  const bodyFont = isM ? Math.round(MH * 0.056) : S(17)
  const bodyH = isM ? innerH - nameH - btnH - Math.round(MH * 0.07) : charH - S(28) - btnH - S(16)
  const nextW = Math.round((btnH * 639) / 378)
  const adoptW = Math.round((btnH * 897) / 378)
  const closeSize = isM ? Math.round(MW * 0.05) : S(42)
  const closeInsetX = Math.round(MW * (isM ? 0.10 : 0.06)) // more inset on mobile so the X sits inside, toward center
  const closeInsetY = Math.round(MH * (isM ? 0.12 : 0.08)) + (isM ? S(15) : 0) // nudge the X down on mobile
  const textNudge = isM ? S(20) : 0 // nudge the text block down on mobile so it sits inside the frame

  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', pointerFilter: 'none' }}
    >
      <UiEntity
        uiTransform={{ width: MW, height: MH, flexDirection: 'row', alignItems: 'center', padding: { left: padX, right: padX, top: padY, bottom: padY }, margin: { bottom: S(18) }, pointerFilter: 'block' }}
        uiBackground={{
          texture: { src: DLG.modal },
          textureMode: 'nine-slices',
          textureSlices: { top: 0.17, bottom: 0.17, left: 0.13, right: 0.13 }
        }}
      >
        {/* Close (X) — inset so it sits inside the visible frame */}
        <UiEntity
          uiTransform={{ positionType: 'absolute', position: { top: closeInsetY, right: closeInsetX }, width: closeSize, height: closeSize, pointerFilter: 'block' }}
          uiBackground={{ texture: { src: DLG.close }, textureMode: 'stretch' }}
          onMouseDown={() => closeDialog()}
        />

        {/* Character */}
        <UiEntity
          uiTransform={{ width: charW, height: charH, margin: { right: gap } }}
          uiBackground={{ texture: { src: DLG.character }, textureMode: 'stretch' }}
        />

        {/* Name + body + controls */}
        <UiEntity uiTransform={{ width: textW, height: '100%', flexDirection: 'column', justifyContent: 'center', margin: { top: textNudge } }}>
          <OutlineLabel value={d.npcName} fontSize={nameFont} color={C.gold} width={textW} height={nameH} textAlign="middle-left" />
          <Label
            value={body}
            fontSize={bodyFont}
            color={C.text}
            textAlign="top-left"
            uiTransform={{ width: textW, height: bodyH, margin: { top: S(4) } }}
          />
          {/* page dots + advance button (pulled up on mobile to offset textNudge) */}
          <UiEntity uiTransform={{ width: textW, height: btnH, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', margin: { top: isM ? -S(18) : S(6) } }}>
            <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: btnH }}>
              {d.pages.map((_, i) => (
                <UiEntity
                  key={`dot-${i}`}
                  uiTransform={{ width: S(10), height: S(10), borderRadius: S(5), margin: { right: S(6) } }}
                  uiBackground={{ color: i === d.page ? C.gold : C.cardAlt }}
                />
              ))}
            </UiEntity>
            <TactileButton
              id="dialog_next"
              label={isLast ? d.finalLabel : 'Next'}
              texture={isLast ? DLG.adopt : DLG.next}
              width={isLast ? adoptW : nextW}
              height={btnH}
              onClick={() => advanceDialog()}
            />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
