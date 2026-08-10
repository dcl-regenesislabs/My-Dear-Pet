// Centered NPC dialog modal (matches the "Choose Location!" style): light square
// card, blue title, red X, paged body text + a primary button. Mobile-first.
// Used for the Caretaker tutorial and tips.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { getPlayer } from '@dcl/sdk/players'
import { advanceDialog, clientState, closeDialog, openDialog } from '../state'
import { OutlineLabel, S, TactileButton } from './theme'

// Kept designer art: primary button textures (Next / Adopt) + the close button.
const DLG = {
  next: 'assets/images/tutorialUi/btn_next.png', // 639x378 (1.69:1)
  adopt: 'assets/images/tutorialUi/btn_adopt.png', // 897x378 (2.37:1)
  close: 'assets/images/tutorialUi/btn_close.png' // 256x256 (square)
}

// Bright modal palette — same look as the "Choose Location!" card.
const LGT = {
  card: { r: 1, g: 0.93, b: 0.95, a: 0.9 }, // very light pink, slightly translucent
  title: { r: 0.29, g: 0.56, b: 0.95, a: 1 },
  titleOutline: { r: 1, g: 1, b: 1, a: 1 },
  body: { r: 0.2, g: 0.22, b: 0.28, a: 1 },
  dotOn: { r: 0.29, g: 0.56, b: 0.95, a: 1 },
  dotOff: { r: 0.8, g: 0.82, b: 0.86, a: 1 }
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

  // Centered square card (same look/size as the "Choose Location!" modal).
  const MW = S(720)
  const MH = S(620)
  const contentW = MW - S(44) * 2
  const btnH = S(88)
  const nextW = Math.round((btnH * 639) / 378) // keep the Next art aspect
  const adoptW = Math.round((btnH * 897) / 378) // keep the Adopt art aspect
  // Explicit body height (NOT flex:1) — Unity collapses flex-grow + height:'100%'.
  const bodyH = S(320)

  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', pointerFilter: 'block' }}
      uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0.5 } }}
      onMouseDown={() => {}}
    >
      <UiEntity
        uiTransform={{ width: MW, height: MH, flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', padding: { top: S(30), bottom: S(40), left: S(44), right: S(44) }, borderRadius: S(28), pointerFilter: 'block' }}
        uiBackground={{ color: LGT.card }}
      >
        {/* Close button (designer art, top-right) */}
        <UiEntity
          uiTransform={{ positionType: 'absolute', position: { top: S(16), right: S(16) }, width: S(56), height: S(56), pointerFilter: 'block' }}
          uiBackground={{ texture: { src: DLG.close }, textureMode: 'stretch' }}
          onMouseDown={() => closeDialog()}
        />

        {/* Title */}
        <OutlineLabel value={d.npcName} fontSize={S(46)} color={LGT.title} outlineColor={LGT.titleOutline} width={'100%'} height={S(64)} textAlign="middle-center" />

        {/* Body (explicit height so it stacks correctly in every client) */}
        <UiEntity uiTransform={{ width: contentW, height: bodyH, alignItems: 'center', justifyContent: 'center', margin: { top: S(6) } }}>
          <Label value={body} fontSize={S(30)} color={LGT.body} textAlign="middle-center" uiTransform={{ width: contentW, height: bodyH }} />
        </UiEntity>

        {/* Page dots */}
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: S(22), margin: { bottom: S(24) } }}>
          {d.pages.map((_, i) => (
            <UiEntity
              key={`dot-${i}`}
              uiTransform={{ width: S(14), height: S(14), borderRadius: S(7), margin: { left: S(5), right: S(5) } }}
              uiBackground={{ color: i === d.page ? LGT.dotOn : LGT.dotOff }}
            />
          ))}
        </UiEntity>

        {/* Next / final button (designer art, bigger) */}
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
  )
}
