import { InputAction, TouchScreenControls } from '@dcl/sdk/ecs'

const UNUSED_SCENE_TOUCH_BUTTONS = [
  InputAction.IA_PRIMARY,
  InputAction.IA_SECONDARY,
  InputAction.IA_ACTION_3,
  InputAction.IA_ACTION_4,
  InputAction.IA_ACTION_5,
  InputAction.IA_ACTION_6
]

export function applyDefaultTouchControls(): void {
  TouchScreenControls.showAll()
  TouchScreenControls.hide(UNUSED_SCENE_TOUCH_BUTTONS)
  TouchScreenControls.showJoystick()
  TouchScreenControls.showCrosshair()
}

export function applyFruitGameTouchControls(): void {
  TouchScreenControls.hideAll()
  TouchScreenControls.hideJoystick()
  TouchScreenControls.hideCrosshair()
}
