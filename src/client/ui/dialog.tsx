// Bottom-anchored NPC dialog box (cozy-farm style): portrait + name + paged
// body text + a primary button. Used for the Caretaker tutorial and tips.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { getPlayer } from '@dcl/sdk/players'
import { advanceDialog, clientState, openDialog } from '../state'
import { C, OutlineLabel, S, TactileButton } from './theme'

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
  const W = S(720)
  const H = S(220)

  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { bottom: S(28), left: 0 }, width: '100%', height: H, alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}
    >
      <UiEntity
        uiTransform={{ width: W, height: H, flexDirection: 'row', padding: S(16), borderRadius: S(22), pointerFilter: 'block' }}
        uiBackground={{ color: C.panelBg }}
      >
        {/* Portrait */}
        <UiEntity uiTransform={{ width: S(110), height: '100%', alignItems: 'center', justifyContent: 'flex-start' }}>
          <UiEntity
            uiTransform={{ width: S(96), height: S(96), borderRadius: S(20), alignItems: 'center', justifyContent: 'center' }}
            uiBackground={{ color: C.greenDark }}
          >
            <OutlineLabel value=":)" fontSize={S(40)} color={C.text} width={S(96)} height={S(96)} />
          </UiEntity>
        </UiEntity>

        {/* Text + button */}
        <UiEntity uiTransform={{ flex: 1, height: '100%', flexDirection: 'column', padding: { left: S(10) } }}>
          <OutlineLabel value={d.npcName} fontSize={S(24)} color={C.gold} width={'100%'} height={S(30)} textAlign="middle-left" />
          <Label
            value={body}
            fontSize={S(18)}
            color={C.text}
            textAlign="top-left"
            uiTransform={{ width: '100%', height: H - S(96), margin: { top: S(6) } }}
          />
          <UiEntity uiTransform={{ width: '100%', height: S(46), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* page dots */}
            <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: S(46) }}>
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
              width={S(160)}
              height={S(42)}
              bg={C.green}
              textColor={C.outline}
              fontSize={S(18)}
              onClick={() => advanceDialog()}
            />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
