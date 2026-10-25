package expo.modules.t3nativecontrols

import android.content.Context
import android.view.KeyEvent
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class T3KeyboardCommandsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3KeyboardCommands")

    View(T3KeyboardCommandsView::class) {
      Prop("enabledCommands") { view: T3KeyboardCommandsView, commands: List<String> ->
        view.enabledCommands = commands.toSet()
      }
      Prop("vimKeysEnabled") { view: T3KeyboardCommandsView, enabled: Boolean ->
        view.vimKeysEnabled = enabled
      }
      Events("onCommand", "onVimKey")
    }
  }
}

class T3KeyboardCommandsView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext) {
  private val onCommand by EventDispatcher()
  private val onVimKey by EventDispatcher()
  var enabledCommands = emptySet<String>()
  var vimKeysEnabled = false

  internal fun emit(command: String) {
    onCommand(mapOf("command" to command))
  }

  internal fun emitVimKey(key: String, ctrl: Boolean) {
    onVimKey(mapOf("key" to key, "ctrl" to ctrl))
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    T3KeyboardRouter.register(this)
    val activity = appContext.currentActivity
    if (activity != null && activity.window?.decorView === rootView) {
      T3KeyboardRouter.install(activity)
    }
  }

  override fun onDetachedFromWindow() {
    T3KeyboardRouter.unregister(this)
    super.onDetachedFromWindow()
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val root = rootView
    if (!T3KeyboardRouter.intercepts(root) && T3KeyboardRouter.dispatch(event, root)) return true
    return super.dispatchKeyEvent(event)
  }
}
