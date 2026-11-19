package expo.modules.t3nativecontrols

import android.content.Context
import android.hardware.input.InputManager
import android.os.Handler
import android.os.Looper
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import java.lang.ref.WeakReference
import java.util.WeakHashMap

internal object T3ControllerRouter {
  private val views = mutableListOf<WeakReference<T3KeyboardCommandsView>>()
  private val state = T3ControllerRoutingState()
  private val handler = Handler(Looper.getMainLooper())
  private var device: Int? = null
  private var enabled = false
  private var repeat: Runnable? = null
  private var direction: String? = null
  private var repeatOwner: T3KeyboardCommandsView? = null
  private var scrollRepeat: Runnable? = null
  private var scrollOwner: T3KeyboardCommandsView? = null
  private var scrollAmount = 0
  private val triggers = mutableSetOf<Int>()
  private val suspendedRoots = WeakHashMap<View, Boolean>()
  private var manager: InputManager? = null
  private val listener = object : InputManager.InputDeviceListener {
    override fun onInputDeviceAdded(id: Int) = Unit
    override fun onInputDeviceChanged(id: Int) { if (device == id) reset() }
    override fun onInputDeviceRemoved(id: Int) { if (device == id) reset() }
  }
  private fun stopRepeat() {
    repeat?.let(handler::removeCallbacks)
    repeat = null; direction = null; repeatOwner = null
    scrollRepeat?.let(handler::removeCallbacks)
    scrollRepeat = null; scrollOwner = null; scrollAmount = 0
    triggers.clear()
  }
  fun register(view: T3KeyboardCommandsView) {
    views.removeAll { it.get() == null || it.get() === view }
    views.add(WeakReference(view))
    if (manager == null) {
      manager = view.context.getSystemService(Context.INPUT_SERVICE) as InputManager
      manager?.registerInputDeviceListener(listener, handler)
    }
    if (view.rootView.hasWindowFocus()) resume(view.rootView)
    sceneChanged(view)
  }
  fun unregister(view: T3KeyboardCommandsView) {
    views.removeAll { it.get() == null || it.get() === view }
    T3ControllerHost.clearHighlight(view)
    scopeChanged()
    if (views.isEmpty()) {
      reset()
      manager?.unregisterInputDeviceListener(listener)
      manager = null
    }
  }
  fun scopeChanged() {
    stopRepeat()
    state.scopeChanged()
    views.mapNotNull { it.get() }.forEach { it.lastControllerScene = null; sceneChanged(it) }
  }
  fun suspend(root: View? = null) {
    val roots = if (root != null) listOf(root) else views.mapNotNull { it.get()?.rootView }.distinct()
    if (roots.all { suspendedRoots[it] == true }) return
    stopRepeat()
    views.mapNotNull { it.get() }.forEach(T3ControllerHost::clearHighlight)
    state.suspend()
    roots.forEach { root ->
      if (suspendedRoots.put(root, true) != true) owner(root, requireFocus = false)?.emitController("suspended")
    }
  }
  fun resume(root: View) {
    if (suspendedRoots.put(root, false) == false) return
    fun deliver() {
      if (root.hasWindowFocus() && suspendedRoots[root] == false) owner(root)?.let { emit(it, "resumed") }
    }
    if (root.hasWindowFocus()) deliver() else handler.post { deliver() }
  }
  fun reset() {
    stopRepeat()
    state.reset()
    enabled = false; device = null
    suspendedRoots.clear()
    views.mapNotNull { it.get() }.forEach(T3ControllerHost::clearHighlight)
    views.mapNotNull { it.get() }.filter { it.controllerEvents }.forEach { it.emitController("reset") }
  }
  private fun owner(root: View, requireFocus: Boolean = true): T3KeyboardCommandsView? {
    if (requireFocus && (!root.hasWindowFocus() || suspendedRoots[root] == true)) return null
    val candidates = views.mapNotNull { it.get() }.filter {
      it.controllerEvents && it.controllerActive && it.isEnabled && it.isAttachedToWindow && it.isShown && it.alpha > 0 && it.getGlobalVisibleRect(android.graphics.Rect()) && it.rootView === root
    }.toSet()
    if (candidates.size == 1) return candidates.first()
    val ordered = mutableListOf<T3KeyboardCommandsView>()
    fun visit(view: View) {
      if (!view.isShown || !view.isEnabled || view.alpha <= 0 || view.importantForAccessibility == View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS) return
      if (view in candidates) ordered.add(view as T3KeyboardCommandsView)
      if (view is ViewGroup) for (index in 0 until view.childCount) visit(view.getChildAt(index))
    }
    visit(root)
    return ordered.firstOrNull { it.controllerModal } ?: ordered.firstOrNull()
  }
  fun sceneChanged(view: T3KeyboardCommandsView) {
    if (!enabled) return
    if (owner(view.rootView) !== view) return
    val scene = T3ControllerHost.snapshot(view).payload()
    if (scene == view.lastControllerScene) return
    view.lastControllerScene = scene
    view.emitController("scene", scene = scene)
  }
  fun activated(view: T3KeyboardCommandsView) {
    if (enabled && owner(view.rootView) === view) emit(view, "resumed")
  }
  fun editorFocused(view: T3KeyboardCommandsView) {
    if (enabled && owner(view.rootView) === view) emit(view, if (view.findFocus()?.onCheckIsTextEditor() == true) "editorFocused" else "editorBlurred")
  }
  fun pointer(view: T3KeyboardCommandsView, event: MotionEvent) {
    if (!enabled || event.actionMasked != MotionEvent.ACTION_DOWN || owner(view.rootView) !== view) return
    val scene = T3ControllerHost.snapshot(view)
    val x = event.rawX.toInt(); val y = event.rawY.toInt()
    fun contains(target: View) = android.graphics.Rect().let { target.getGlobalVisibleRect(it) && it.contains(x, y) }
    val target = scene.targets.lastOrNull { contains(it.view) }
    val region = scene.regions.lastOrNull { contains(it.view) }
    T3ControllerHost.clearHighlight(view)
    view.emitController("pointer", target?.id ?: region?.id ?: "", scene = scene.payload())
  }
  fun probeView(): T3KeyboardCommandsView? = views.mapNotNull { it.get() }
    .firstOrNull { owner(it.rootView, requireFocus = false) === it }
  fun probeComplete(sequence: String) {
    val workspace = views.mapNotNull { it.get() }.filter { it.controllerEvents && !it.controllerModal && it.isAttachedToWindow }
    (workspace.ifEmpty { listOfNotNull(probeView()) }).forEach { it.emitController("testComplete", sequence) }
  }
  private fun emit(view: T3KeyboardCommandsView, action: String, amount: Int? = null) {
    val scene = T3ControllerHost.snapshot(view).payload()
    view.lastControllerScene = scene
    view.emitController(action, scene["focusedTargetId"] as? String ?: "", amount, scene)
  }
  fun effect(scopeId: String, kind: String, targetId: String, regionId: String, amount: Double): Map<String, Any?>? {
    val matches = views.mapNotNull { it.get() }.filter { it.controllerScope == scopeId && owner(it.rootView) === it }
    val view = matches.singleOrNull() ?: return null
    val scene = T3ControllerHost.effect(view, kind, targetId, regionId, amount) ?: return null
    if (kind == "blur") view.ensureControllerDelivery()
    sceneChanged(view)
    return scene
  }
  private fun navigate(view: T3KeyboardCommandsView, action: String?) {
    if (direction == action && repeatOwner === view) return
    repeat?.let(handler::removeCallbacks); repeat = null
    direction = action; repeatOwner = view
    if (action == null) return
    emit(view, action)
    val generation = state.generation
    val task = object : Runnable {
      override fun run() {
        if (!enabled || owner(view.rootView) !== view ||
          !state.canRepeat(generation, view.findFocus()?.onCheckIsTextEditor() == true, view.controllerSelection)) return
        emit(view, action)
        handler.postDelayed(this, 100)
      }
    }
    repeat = task
    handler.postDelayed(task, 350)
  }
  private fun scroll(view: T3KeyboardCommandsView, amount: Int) {
    scrollAmount = amount
    if (amount == 0) {
      scrollRepeat?.let(handler::removeCallbacks); scrollRepeat = null; scrollOwner = null
      return
    }
    if (scrollOwner === view && scrollRepeat != null) return
    scrollRepeat?.let(handler::removeCallbacks)
    scrollOwner = view
    val generation = state.generation
    val task = object : Runnable {
      override fun run() {
        if (!enabled || owner(view.rootView) !== view || !state.canRepeat(generation)) return
        emit(view, "scroll", scrollAmount)
        handler.postDelayed(this, 50)
      }
    }
    scrollRepeat = task
    task.run()
  }
  fun key(event: KeyEvent, root: View): Boolean {
    val input = event.device
    val virtual = T3ControllerProbe.acceptsVirtual(event)
    if (input == null && !virtual) return false
    if (input?.supportsSource(InputDevice.SOURCE_GAMEPAD) != true && input?.supportsSource(InputDevice.SOURCE_JOYSTICK) != true && !virtual) return false
    val recovered = root.hasWindowFocus() && suspendedRoots[root] == true
    if (recovered) resume(root)
    val view = owner(root) ?: return false
    if (event.action == KeyEvent.ACTION_UP) {
      val consumed = state.keyUp(event.deviceId, event.keyCode)
      if (event.deviceId == device && event.keyCode in KeyEvent.KEYCODE_DPAD_UP..KeyEvent.KEYCODE_DPAD_RIGHT) navigate(view, null)
      return consumed
    }
    if (event.action != KeyEvent.ACTION_DOWN) return false
    if (!enabled) {
      if (event.keyCode != KeyEvent.KEYCODE_BUTTON_START) return state.isHeld(event.deviceId, event.keyCode)
      if (event.repeatCount > 0) return true
      enabled = true; device = event.deviceId; state.selectDevice(event.deviceId)
      state.keyDown(event.deviceId, event.keyCode, "menu", false, false, 0)
      emit(view, "enabled")
      return true
    }
    if (device != event.deviceId) return false
    val action = when (event.keyCode) {
      KeyEvent.KEYCODE_DPAD_UP -> "up"
      KeyEvent.KEYCODE_DPAD_DOWN -> "down"
      KeyEvent.KEYCODE_DPAD_LEFT -> "left"
      KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
      KeyEvent.KEYCODE_BUTTON_A -> "activate"
      KeyEvent.KEYCODE_BUTTON_B -> "back"
      KeyEvent.KEYCODE_BUTTON_X -> "dictate"
      KeyEvent.KEYCODE_BUTTON_Y -> "footer"
      KeyEvent.KEYCODE_BUTTON_L1 -> "previous"
      KeyEvent.KEYCODE_BUTTON_R1 -> "next"
      KeyEvent.KEYCODE_BUTTON_L2 -> "conversation"
      KeyEvent.KEYCODE_BUTTON_R2 -> "reply"
      KeyEvent.KEYCODE_BUTTON_START -> "menu"
      KeyEvent.KEYCODE_BUTTON_SELECT -> "chooser"
      KeyEvent.KEYCODE_BUTTON_THUMBL -> "conversation"
      KeyEvent.KEYCODE_BUTTON_THUMBR -> "reply"
      else -> return false
    }
    when (state.keyDown(event.deviceId, event.keyCode, action, view.findFocus()?.onCheckIsTextEditor() == true, view.controllerSelection, event.repeatCount)) {
      ControllerKeyDisposition.PASS -> return false
      ControllerKeyDisposition.CONSUME -> return true
      ControllerKeyDisposition.DISPATCH -> Unit
    }
    if (recovered && action in setOf("activate", "dictate", "menu", "chooser")) return true
    if (action in T3ControllerRoutingState.DIRECTIONS) navigate(view, action) else emit(view, action)
    return true
  }
  fun motion(event: MotionEvent, root: View): Boolean {
    if (!event.isFromSource(InputDevice.SOURCE_JOYSTICK) || event.action != MotionEvent.ACTION_MOVE || !enabled || device != event.deviceId) return false
    if (root.hasWindowFocus() && suspendedRoots[root] == true) resume(root)
    val view = owner(root) ?: return false
    val axes = listOf(MotionEvent.AXIS_X, MotionEvent.AXIS_Y, MotionEvent.AXIS_HAT_X, MotionEvent.AXIS_HAT_Y,
      MotionEvent.AXIS_Z, MotionEvent.AXIS_RZ, MotionEvent.AXIS_LTRIGGER, MotionEvent.AXIS_RTRIGGER)
    fun axis(axis: Int, threshold: Float): Float {
      val value = event.getAxisValue(axis)
      val flat = event.device?.getMotionRange(axis, event.source)?.flat ?: 0f
      return value.takeIf { kotlin.math.abs(it) > maxOf(flat, threshold) } ?: 0f
    }
    if (!state.motion(event.deviceId, axes.any { axis(it, .35f) != 0f })) return true
    for ((trigger, action) in listOf(MotionEvent.AXIS_LTRIGGER to "conversation", MotionEvent.AXIS_RTRIGGER to "reply")) {
      if (event.getAxisValue(trigger) < .35f) triggers.remove(trigger)
      if (axis(trigger, .55f) != 0f && triggers.add(trigger)) emit(view, action)
    }
    if (view.findFocus()?.onCheckIsTextEditor() != true || view.controllerSelection) {
      val threshold = if (direction == null) .55f else .35f
      val x = axis(MotionEvent.AXIS_HAT_X, threshold).takeIf { it != 0f } ?: axis(MotionEvent.AXIS_X, threshold)
      val y = axis(MotionEvent.AXIS_HAT_Y, threshold).takeIf { it != 0f } ?: axis(MotionEvent.AXIS_Y, threshold)
      navigate(view, if (x == 0f && y == 0f) null else if (kotlin.math.abs(x) > kotlin.math.abs(y)) {
        if (x < 0) "left" else "right"
      } else if (y < 0) "up" else "down")
    } else navigate(view, null)
    scroll(view, (axis(MotionEvent.AXIS_RZ, .25f) * 50).toInt())
    return true
  }
}
