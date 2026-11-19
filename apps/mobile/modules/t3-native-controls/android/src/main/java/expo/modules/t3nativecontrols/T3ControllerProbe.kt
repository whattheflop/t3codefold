package expo.modules.t3nativecontrols

import android.app.Activity
import android.content.pm.ApplicationInfo
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyEvent

internal object T3ControllerProbe {
  private const val DEVICE_ID = -7343
  private var dispatching = false

  fun acceptsVirtual(event: KeyEvent): Boolean =
    dispatching && event.deviceId == DEVICE_ID && event.isFromSource(InputDevice.SOURCE_GAMEPAD)

  fun input(activity: Activity, sequence: String, action: String): Boolean {
    check(activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
      "Controller test input is only available in debuggable apps."
    }
    check(!dispatching) { "Controller test input is already dispatching." }
    try {
      if (action == "reset") {
        T3ControllerRouter.reset()
        return true
      }
      val keyCode = when (action) {
        "start" -> KeyEvent.KEYCODE_BUTTON_START
        "select" -> KeyEvent.KEYCODE_BUTTON_SELECT
        "a" -> KeyEvent.KEYCODE_BUTTON_A
        "b" -> KeyEvent.KEYCODE_BUTTON_B
        "x" -> KeyEvent.KEYCODE_BUTTON_X
        "y" -> KeyEvent.KEYCODE_BUTTON_Y
        "up" -> KeyEvent.KEYCODE_DPAD_UP
        "down" -> KeyEvent.KEYCODE_DPAD_DOWN
        "left" -> KeyEvent.KEYCODE_DPAD_LEFT
        "right" -> KeyEvent.KEYCODE_DPAD_RIGHT
        "l1" -> KeyEvent.KEYCODE_BUTTON_L1
        "r1" -> KeyEvent.KEYCODE_BUTTON_R1
        "l3" -> KeyEvent.KEYCODE_BUTTON_THUMBL
        "r3" -> KeyEvent.KEYCODE_BUTTON_THUMBR
        "l2" -> KeyEvent.KEYCODE_BUTTON_L2
        "r2" -> KeyEvent.KEYCODE_BUTTON_R2
        "suspend", "resume" -> null
        else -> error("Unsupported controller test action: $action")
      }
      val view = T3ControllerRouter.probeView() ?: return false
      val window = activity.window
      val callback = window?.takeIf {
        it.decorView === view.rootView && T3KeyboardRouter.intercepts(view.rootView)
      }?.callback
      if (keyCode == null) {
        val focused = action == "resume"
        if (callback != null) callback.onWindowFocusChanged(focused)
        else {
          view.onWindowFocusChanged(focused)
          if (!focused) T3ControllerRouter.suspend(view.rootView)
        }
        return true
      }
      val downTime = SystemClock.uptimeMillis()
      fun dispatch(eventAction: Int): Boolean {
        val event = KeyEvent(downTime, SystemClock.uptimeMillis(), eventAction, keyCode,
          0, 0, DEVICE_ID, 0, 0, InputDevice.SOURCE_GAMEPAD)
        dispatching = true
        try {
          return if (callback != null) callback.dispatchKeyEvent(event)
          else view.dispatchKeyEvent(event)
        } finally {
          dispatching = false
        }
      }
      val down = dispatch(KeyEvent.ACTION_DOWN)
      val up = dispatch(KeyEvent.ACTION_UP)
      return down && up
    } finally {
      T3ControllerRouter.probeComplete(sequence)
    }
  }
}
