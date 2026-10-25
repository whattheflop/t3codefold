package expo.modules.t3nativecontrols

import android.app.Activity
import android.os.Build
import android.view.KeyEvent
import android.view.KeyboardShortcutGroup
import android.view.Menu
import android.view.View
import android.view.Window
import java.lang.ref.WeakReference
import java.util.WeakHashMap

// Fold's hardware keyboard routing (shortcuts and Vim keys) for T3KeyboardCommandsView.

/**
 * Hardware-keyboard chord for a key press, or null. Ctrl is the shortcut modifier; Meta is
 * accepted too because many Bluetooth keyboards send it for their Command key. Mirrors the
 * iOS UIKeyCommands and the web default keybindings.
 */
internal fun hardwareKeyboardCommandFor(
  keyCode: Int,
  mod: Boolean,
  shift: Boolean,
  alt: Boolean,
): String? {
  if (!mod) {
    if (shift || alt) return null
    return when (keyCode) {
      KeyEvent.KEYCODE_DPAD_DOWN -> "paletteNext"
      KeyEvent.KEYCODE_DPAD_UP -> "palettePrevious"
      KeyEvent.KEYCODE_ESCAPE -> "paletteDismiss"
      KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "paletteSelect"
      else -> null
    }
  }
  if (alt) {
    if (shift) return null
    return when (keyCode) {
      KeyEvent.KEYCODE_V -> "voiceToggle"
      KeyEvent.KEYCODE_M -> "voiceMute"
      KeyEvent.KEYCODE_S -> "voiceOutputMute"
      else -> null
    }
  }
  if (shift) {
    return when (keyCode) {
      KeyEvent.KEYCODE_LEFT_BRACKET -> "thread.previous"
      KeyEvent.KEYCODE_RIGHT_BRACKET -> "thread.next"
      KeyEvent.KEYCODE_F -> "files"
      KeyEvent.KEYCODE_T -> "terminal"
      KeyEvent.KEYCODE_R -> "review"
      KeyEvent.KEYCODE_C -> "copyThreadReference"
      KeyEvent.KEYCODE_H -> "cycleHost"
      else -> null
    }
  }
  return when (keyCode) {
    KeyEvent.KEYCODE_K -> "commandPalette"
    KeyEvent.KEYCODE_N -> "newTask"
    KeyEvent.KEYCODE_F -> "focusSearch"
    KeyEvent.KEYCODE_B, KeyEvent.KEYCODE_BACKSLASH -> "toggleSidebar"
    KeyEvent.KEYCODE_LEFT_BRACKET -> "back"
    KeyEvent.KEYCODE_GRAVE -> "terminal"
    in KeyEvent.KEYCODE_1..KeyEvent.KEYCODE_9 -> "thread.jump.${keyCode - KeyEvent.KEYCODE_0}"
    else -> null
  }
}

/**
 * Views that take raw keys (the terminal's input) set this tag. Plain Ctrl+key chords then
 * reach them as control characters (Ctrl+B, Ctrl+K, Ctrl+[ ...) instead of app shortcuts;
 * Meta chords still work as shortcuts.
 */
const val RAW_KEYBOARD_VIEW_TAG = "t3-raw-keyboard"

/**
 * The key Vim navigation sees for a press, or null to leave it alone. Only plain keys and a
 * few Ctrl chords (window and half-page moves) are taken, and only while no text field has
 * focus, so typing is never intercepted.
 */
internal fun vimKeyFor(
  keyCode: Int,
  unicodeChar: Int,
  ctrl: Boolean,
  alt: Boolean,
  meta: Boolean,
): Pair<String, Boolean>? {
  if (alt || meta) return null
  if (ctrl) {
    return when (keyCode) {
      KeyEvent.KEYCODE_W -> "w"
      KeyEvent.KEYCODE_D -> "d"
      KeyEvent.KEYCODE_U -> "u"
      KeyEvent.KEYCODE_H -> "h"
      KeyEvent.KEYCODE_L -> "l"
      else -> null
    }?.let { it to true }
  }
  val named = when (keyCode) {
    KeyEvent.KEYCODE_ESCAPE -> "Escape"
    KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "Enter"
    KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp"
    KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown"
    else -> null
  }
  if (named != null) return named to false
  if (unicodeChar <= 0 || Character.isISOControl(unicodeChar)) return null
  return String(Character.toChars(unicodeChar)) to false
}

/** Vim keys that keep firing while held, for continuous movement. */
private val REPEATING_VIM_KEYS = setOf("j", "k", "ArrowUp", "ArrowDown", "d", "u")

/** Commands that keep firing while their key auto-repeats. */
private val REPEATING_COMMANDS = setOf("paletteNext", "palettePrevious")

/**
 * Routes key events to mounted command views. A ViewGroup only sees keys while a descendant
 * has focus, which in touch mode is rarely true, so the activity window's callback offers every
 * key here before normal dispatch. Other windows (the command palette's Dialog) fall back to
 * the view's own dispatchKeyEvent, which works there because the palette focuses its input.
 */
internal object T3KeyboardRouter {
  private val views = mutableListOf<WeakReference<T3KeyboardCommandsView>>()
  private val interceptedRoots = WeakHashMap<View, Unit>()

  /** Key codes whose DOWN was consumed; their repeats and UP are consumed too. */
  private val heldKeyCodes = mutableSetOf<Int>()

  fun register(view: T3KeyboardCommandsView) {
    views.removeAll { it.get() == null || it.get() === view }
    views.add(WeakReference(view))
  }

  fun unregister(view: T3KeyboardCommandsView) {
    views.removeAll { it.get() == null || it.get() === view }
  }

  fun install(activity: Activity) {
    val window = activity.window ?: return
    if (interceptedRoots.containsKey(window.decorView)) return
    window.callback = T3KeyboardWindowCallback(window.callback, window.decorView)
    interceptedRoots[window.decorView] = Unit
  }

  fun intercepts(root: View) = interceptedRoots.containsKey(root)

  /** Offers the event to command views in [root], most recently mounted first. */
  fun dispatch(event: KeyEvent, root: View): Boolean {
    when (event.action) {
      KeyEvent.ACTION_UP -> return heldKeyCodes.remove(event.keyCode)
      KeyEvent.ACTION_DOWN -> Unit
      else -> return false
    }
    val focused = root.findFocus()
    val rawKeyboardFocused = focused?.tag == RAW_KEYBOARD_VIEW_TAG
    val command =
      hardwareKeyboardCommandFor(
        event.keyCode,
        mod = event.isCtrlPressed || event.isMetaPressed,
        shift = event.isShiftPressed,
        alt = event.isAltPressed,
      )?.takeUnless {
        rawKeyboardFocused && event.isCtrlPressed && !event.isMetaPressed && !event.isShiftPressed
      }
    val view = command?.let { command ->
      views.asReversed().firstNotNullOfOrNull { reference ->
        reference.get()?.takeIf {
          it.isAttachedToWindow && it.rootView === root && it.enabledCommands.contains(command)
        }
      }
    }
    if (command != null && view != null) {
      heldKeyCodes.add(event.keyCode)
      if (event.repeatCount == 0 || command in REPEATING_COMMANDS) view.emit(command)
      return true
    }
    if (focused?.onCheckIsTextEditor() != true) {
      val vimKey =
        vimKeyFor(
          event.keyCode,
          event.unicodeChar,
          ctrl = event.isCtrlPressed,
          alt = event.isAltPressed,
          meta = event.isMetaPressed,
        )
      val vimView =
        vimKey?.let {
          views.asReversed().firstNotNullOfOrNull { reference ->
            reference.get()?.takeIf {
              it.isAttachedToWindow && it.rootView === root && it.vimKeysEnabled
            }
          }
        }
      if (vimKey != null && vimView != null) {
        heldKeyCodes.add(event.keyCode)
        if (event.repeatCount == 0 || vimKey.first in REPEATING_VIM_KEYS) {
          vimView.emitVimKey(vimKey.first, vimKey.second)
        }
        return true
      }
    }
    return heldKeyCodes.contains(event.keyCode) && event.repeatCount > 0
  }
}

private class T3KeyboardWindowCallback(
  private val delegate: Window.Callback,
  private val root: View,
) : Window.Callback by delegate {
  override fun dispatchKeyEvent(event: KeyEvent): Boolean =
    T3KeyboardRouter.dispatch(event, root) || delegate.dispatchKeyEvent(event)

  // Java default methods are not covered by Kotlin delegation.
  override fun onProvideKeyboardShortcuts(
    data: MutableList<KeyboardShortcutGroup>?,
    menu: Menu?,
    deviceId: Int,
  ) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      delegate.onProvideKeyboardShortcuts(data, menu, deviceId)
    }
  }

  override fun onPointerCaptureChanged(hasCapture: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      delegate.onPointerCaptureChanged(hasCapture)
    }
  }
}
