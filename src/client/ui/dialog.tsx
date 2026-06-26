// Bottom-anchored NPC dialog box (cozy-farm style): portrait + name + paged
// body text + a primary button. Used for the Caretaker tutorial and tips.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { advanceDialog, clientState, openDialog } from '../state'
import { C, OutlineLabel, S, TactileButton } from './theme'

export const CARETAKER_INTRO: string[] = [
  "Welcome to the Care Center! I'm the Caretaker. Let's get you a new best friend.",
  'Tap "Adopt a Pet" to choose your companion from our roster of cuties.',
  'Keep your pet happy: Feed it at the Bowl, give it a Bath at the Pond.',
  'Let it Sleep on the Bed and Play with the Ball to keep its energy and joy up.',
  'Tap your pet anytime to give it a little love — happiness earns you Coins!',
  'Spend Coins in the Shop on food and extra pet slots. Now go say hi!'
]

export const CARETAKER_TIPS: string[] = [
  'Happy pets earn more Coins and XP over time, so keep those bars topped up!',
  'Pet other players\' pets to grow your Giving score. Sharing is caring!',
  'Use the Whistle button to call your pet over or tell it to stay put.'
]

export function openCaretakerIntro(onDone?: () => void): void {
  openDialog('Caretaker', CARETAKER_INTRO, 'Adopt now!', onDone)
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
