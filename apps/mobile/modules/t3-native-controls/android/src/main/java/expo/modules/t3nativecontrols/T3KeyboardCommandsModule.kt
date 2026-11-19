package expo.modules.t3nativecontrols

import android.content.Context
import android.view.KeyEvent
import android.view.ViewTreeObserver
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class T3KeyboardCommandsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3KeyboardCommands")

    AsyncFunction("controllerEffect") { scopeId: String, kind: String, targetId: String, regionId: String, amount: Double ->
      T3ControllerRouter.effect(scopeId, kind, targetId, regionId, amount)
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersBackground { T3ControllerRouter.suspend() }

    View(T3KeyboardCommandsView::class) {
      Prop("enabledCommands") { view: T3KeyboardCommandsView, commands: List<String> ->
        view.enabledCommands = commands.toSet()
      }
      Prop("controllerScope") { view: T3KeyboardCommandsView, scope: String ->
        if (view.controllerScope != scope) { view.controllerScope = scope; T3ControllerRouter.scopeChanged() }
      }
      Prop("controllerActive") { view: T3KeyboardCommandsView, active: Boolean -> view.controllerActive = active }
      Prop("controllerModal") { view: T3KeyboardCommandsView, modal: Boolean -> view.controllerModal = modal }
      Prop("controllerSelection") { view: T3KeyboardCommandsView, enabled: Boolean -> view.controllerSelection = enabled }
      Prop("controllerEvents") { view: T3KeyboardCommandsView, enabled: Boolean -> view.controllerEvents = enabled }
      Prop("vimKeysEnabled") { view: T3KeyboardCommandsView, enabled: Boolean ->
        view.vimKeysEnabled = enabled
      }
      Events("onCommand", "onVimKey", "onController")
    }
  }
}

open class T3KeyboardCommandsView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext) {
  private val onController by EventDispatcher()
  internal open fun emitController(action: String, target: String = "", amount: Int? = null, scene: Map<String, Any?>? = null) {
    onController(buildMap {
      put("action", action); put("targetId", target); put("scopeId", controllerScope)
      if (amount != null) put("amount", amount)
      if (scene != null) put("scene", scene)
    })
  }
  internal var lastControllerScene: Map<String, Any?>? = null
  private val layoutListener = ViewTreeObserver.OnGlobalLayoutListener { T3ControllerRouter.sceneChanged(this) }
  private val scrollListener = ViewTreeObserver.OnScrollChangedListener { T3ControllerRouter.sceneChanged(this) }
  private val focusListener = ViewTreeObserver.OnGlobalFocusChangeListener { _, _ -> T3ControllerRouter.sceneChanged(this); T3ControllerRouter.editorFocused(this) }
  var controllerActive = true
    set(value) { if (field != value) {
      field = value
      if (!value) T3ControllerHost.clearHighlight(this)
      T3ControllerRouter.scopeChanged()
      if (value) { ensureControllerDelivery(); T3ControllerRouter.activated(this) }
    } }
  var controllerModal = false
    set(value) { if (field != value) { field = value; T3ControllerRouter.scopeChanged() } }
  private val onCommand by EventDispatcher()
  private val onVimKey by EventDispatcher()
  var controllerScope = ""
  var controllerSelection = false
  var controllerEvents = false
    set(value) { if (field != value) { field = value; T3ControllerRouter.scopeChanged() } }
  var enabledCommands = emptySet<String>()
  var vimKeysEnabled = false

  // Separate modal windows need a neutral key-delivery anchor, not a focused action.
  internal fun ensureControllerDelivery() {
    if (!controllerActive || !controllerEvents || !isAttachedToWindow || !isShown) return
    if (rootView === appContext.currentActivity?.window?.decorView) return
    if (T3ControllerHost.within(rootView.findFocus(), this)) return
    defaultFocusHighlightEnabled = false
    isFocusableInTouchMode = true
    requestFocus()
  }

  internal fun emit(command: String) {
    onCommand(mapOf("command" to command))
  }

  internal fun emitVimKey(key: String, ctrl: Boolean) {
    onVimKey(mapOf("key" to key, "ctrl" to ctrl))
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    viewTreeObserver.addOnGlobalLayoutListener(layoutListener)
    viewTreeObserver.addOnScrollChangedListener(scrollListener)
    viewTreeObserver.addOnGlobalFocusChangeListener(focusListener)
    T3KeyboardRouter.register(this)
    T3ControllerRouter.register(this)
    ensureControllerDelivery()
    val activity = appContext.currentActivity
    if (activity != null && activity.window?.decorView === rootView) {
      T3KeyboardRouter.install(activity)
    }
  }

  override fun onDetachedFromWindow() {
    if (viewTreeObserver.isAlive) {
      viewTreeObserver.removeOnGlobalLayoutListener(layoutListener)
      viewTreeObserver.removeOnScrollChangedListener(scrollListener)
      viewTreeObserver.removeOnGlobalFocusChangeListener(focusListener)
    }
    T3ControllerRouter.unregister(this)
    T3KeyboardRouter.unregister(this)
    super.onDetachedFromWindow()
  }

  override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
    super.onWindowFocusChanged(hasWindowFocus)
    if (hasWindowFocus) { ensureControllerDelivery(); T3ControllerRouter.resume(rootView) } else if (isAttachedToWindow && !rootView.hasWindowFocus()) T3ControllerRouter.suspend(rootView)
  }

  override fun dispatchTouchEvent(event: android.view.MotionEvent): Boolean {
    T3ControllerRouter.pointer(this, event)
    return super.dispatchTouchEvent(event)
  }

  override fun dispatchGenericMotionEvent(event: android.view.MotionEvent): Boolean =
    T3ControllerRouter.motion(event, rootView) || super.dispatchGenericMotionEvent(event)

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val root = rootView
    if (!T3KeyboardRouter.intercepts(root) && T3ControllerRouter.key(event, root)) return true
    if (!T3KeyboardRouter.intercepts(root) && T3KeyboardRouter.dispatch(event, root)) return true
    return super.dispatchKeyEvent(event)
  }
}
