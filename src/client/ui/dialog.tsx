// Bottom-anchored NPC dialog box (cozy-farm style): avatar + name + paged
// body text + a primary button. Used for the Caretaker tutorial and tips.
// Desktop: compact card. Mobile: near-fullwidth sheet with huge fonts/buttons.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { getPlayer } from '@dcl/sdk/players'
import { advanceDialog, clientState, closeDialog, openDialog } from '../state'
import { C, CloseButton, mobile, OutlineLabel, RoundedBadge, S, TactileButton } from './theme'

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
  const isM = mobile()

  // Modal sizing — desktop keeps a compact card; mobile goes near-fullwidth
  // with much bigger fonts/avatar/button so it reads at arm's length.
  const MW = isM ? S(1040) : S(940)
  const MH = isM ? S(420) : S(325)
  const padX = isM ? S(36) : S(50)
  const padY = isM ? S(28) : S(34)
  const gap = isM ? S(28) : S(18)
  const charD = isM ? S(180) : S(257)
  const textW = MW - padX * 2 - charD - gap
  const btnH = isM ? S(76) : S(50)
  const nameH = isM ? S(40) : S(28)
  const nameFont = isM ? S(30) : S(22)
  const bodyFont = isM ? S(22) : S(17)
  const bodyH = MH - padY * 2 - nameH - btnH - S(16)
  const closeSize = isM ? S(52) : S(42)

  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', pointerFilter: 'none' }}
    >
      <UiEntity
        uiTransform={{ width: MW, height: MH, flexDirection: 'row', alignItems: 'center', padding: { left: padX, right: padX, top: padY, bottom: padY }, margin: { bottom: S(18) }, borderRadius: S(28), pointerFilter: 'block' }}
        uiBackground={{ color: C.panelBg }}
      >
        {/* Close */}
        <UiEntity uiTransform={{ positionType: 'absolute', position: { top: S(14), right: S(14) } }}>
          <CloseButton onClick={() => closeDialog()} size={closeSize} />
        </UiEntity>

        {/* Avatar — colored disc with the NPC's initial, replaces the character portrait PNG */}
        <UiEntity uiTransform={{ width: charD, height: charD, margin: { right: gap }, alignItems: 'center', justifyContent: 'center' }}>
          <RoundedBadge text={d.npcName.charAt(0).toUpperCase()} size={charD} bg={C.green} textColor={C.outline} fontSize={Math.round(charD * 0.5)} />
        </UiEntity>

        {/* Name + body + controls */}
        <UiEntity uiTransform={{ width: textW, height: '100%', flexDirection: 'column', justifyContent: 'center' }}>
          <OutlineLabel value={d.npcName} fontSize={nameFont} color={C.gold} width={textW} height={nameH} textAlign="middle-left" />
          <Label
            value={body}
            fontSize={bodyFont}
            color={C.text}
            textAlign="top-left"
            uiTransform={{ width: textW, height: bodyH, margin: { top: S(4) } }}
          />
          {/* page dots + advance button */}
          <UiEntity uiTransform={{ width: textW, height: btnH, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', margin: { top: S(6) } }}>
            <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: btnH }}>
              {d.pages.map((_, i) => (
                <UiEntity
                  key={`dot-${i}`}
                  uiTransform={{ width: isM ? S(14) : S(10), height: isM ? S(14) : S(10), borderRadius: S(7), margin: { right: S(6) } }}
                  uiBackground={{ color: i === d.page ? C.gold : C.cardAlt }}
                />
              ))}
            </UiEntity>
            <TactileButton
              id="dialog_next"
              label={isLast ? d.finalLabel : 'Next >'}
              width={isM ? S(300) : S(190)}
              height={btnH}
              bg={isLast ? C.green : C.cardAlt}
              textColor={isLast ? C.outline : C.text}
              fontSize={isM ? S(24) : S(18)}
              radius={S(18)}
              pulse={isLast}
              onClick={() => advanceDialog()}
            />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
