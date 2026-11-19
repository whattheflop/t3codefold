@file:Suppress("INVISIBLE_REFERENCE", "INVISIBLE_MEMBER", "DEPRECATION")

package expo.modules.t3nativecontrols

import android.app.Activity
import android.hardware.input.InputManager
import android.os.Looper
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ScrollView
import androidx.core.widget.NestedScrollView
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import com.facebook.react.uimanager.events.EventDispatcher
import com.facebook.react.uimanager.events.EventDispatcherProvider
import com.facebook.react.uimanager.events.Event
import com.facebook.react.uimanager.events.EventDispatcherListener
import com.facebook.react.uimanager.events.BatchEventDispatchedListener
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.views.view.ReactViewManager
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.ModulesProvider
import expo.modules.kotlin.modules.Module
import java.lang.ref.WeakReference
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.InputDeviceBuilder
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], manifest = Config.NONE, qualifiers = "w1000dp-h1000dp-mdpi")
class T3ControllerFocusTest {
  private class Sink(activity: Activity, appContext: AppContext) : T3KeyboardCommandsView(activity, appContext) {
    init { orientation = android.widget.LinearLayout.VERTICAL }
    val events = mutableListOf<Map<String, Any?>>()
    override fun emitController(action: String, target: String, amount: Int?, scene: Map<String, Any?>?) {
      events.add(mapOf("action" to action, "targetId" to target, "amount" to amount, "scene" to scene))
    }
  }
  private class TestReactContext(activity: Activity) : BridgeReactContext(activity), EventDispatcherProvider {
    val clicks = mutableListOf<Int>()
    private val dispatcher = object : EventDispatcher {
      override fun dispatchEvent(event: Event<*>) { if (event.eventName == "topClick") clicks.add(event.viewTag) }
      override fun dispatchAllEvents() = Unit
      override fun addListener(listener: EventDispatcherListener) = Unit
      override fun removeListener(listener: EventDispatcherListener) = Unit
      override fun addBatchEventDispatchedListener(listener: BatchEventDispatchedListener) = Unit
      override fun removeBatchEventDispatchedListener(listener: BatchEventDispatchedListener) = Unit
      override fun onCatalystInstanceDestroyed() = Unit
    }
    override fun getEventDispatcher(): EventDispatcher = dispatcher
  }
  private class Fixture : AutoCloseable {
    init { ReactNativeFeatureFlagsForTests.setUp() }
    val controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
    val activity = controller.get()
    val reactContext = TestReactContext(activity)
    val appContext = AppContext(object : ModulesProvider {
      override fun getModulesMap() = emptyMap<Class<out Module>, String?>()
    }, expo.modules.core.ModuleRegistry(emptyList(), emptyList()), WeakReference(reactContext))
    val root = FrameLayout(activity)
    val scope = Sink(activity, appContext).apply { controllerScope = "test"; controllerEvents = true }
    val device = InputDeviceBuilder.newBuilder().setId(7).setName("Controller")
      .setSources(InputDevice.SOURCE_GAMEPAD or InputDevice.SOURCE_JOYSTICK).build()
    init {
      shadowOf(activity.getSystemService(InputManager::class.java)).addInputDevice(device)
      root.addView(scope, FrameLayout.LayoutParams(1000, 1000))
      activity.setContentView(root)
      T3KeyboardRouter.install(activity)
      controller.windowFocusChanged(true)
      layout()
    }
    fun layout() {
      val decor = activity.window.decorView
      decor.measure(View.MeasureSpec.makeMeasureSpec(1000, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(1000, View.MeasureSpec.EXACTLY))
      decor.layout(0, 0, 1000, 1000)
      decor.viewTreeObserver.dispatchOnGlobalLayout()
    }
    fun key(code: Int, action: Int = KeyEvent.ACTION_DOWN, repeat: Int = 0, source: Int = InputDevice.SOURCE_GAMEPAD): Boolean {
      val event = KeyEvent(0, 0, action, code, repeat, 0, 7, 0, 0, source)
      shadowOf(event).setDevice(device)
      return activity.window.callback.dispatchKeyEvent(event)
    }
    fun enable() { assertTrue(key(KeyEvent.KEYCODE_BUTTON_START)); key(KeyEvent.KEYCODE_BUTTON_START, KeyEvent.ACTION_UP) }
    fun motion(vararg axes: Pair<Int, Float>): Boolean {
      val coords = MotionEvent.PointerCoords().apply { axes.forEach { setAxisValue(it.first, it.second) } }
      val pointer = MotionEvent.PointerProperties().apply { id = 0 }
      val event = MotionEvent.obtain(0, 0, MotionEvent.ACTION_MOVE, 1, arrayOf(pointer), arrayOf(coords), 0, 0, 1f, 1f, 7, 0, InputDevice.SOURCE_JOYSTICK, 0)
      return try { activity.window.callback.dispatchGenericMotionEvent(event) } finally { event.recycle() }
    }
    fun effect(kind: String, target: String = "", region: String = "", amount: Double = 0.0) =
      T3ControllerRouter.effect("test", kind, target, region, amount)
    override fun close() {
      T3ControllerRouter.reset()
      controller.close()
      appContext.javaClass.declaredMethods.first { it.name.startsWith("onDestroy") && it.parameterCount == 0 }.invoke(appContext)
      reactContext.destroy()
    }
  }
  private fun View.tagged(id: String): View { setTag(com.facebook.react.R.id.view_tag_native_id, id); return this }
  private fun FrameLayout.add(view: View, top: Int = 0, height: Int = 70) {
    addView(view, FrameLayout.LayoutParams(600, height).apply { topMargin = top })
  }

  @Test fun sceneUsesReadingOrderFullRegionAndSurfaceIdsAndSuppressesRegisteredChildren() {
    Fixture().use { f ->
      val surface = FrameLayout(f.activity).apply { tagged("t3-controller-surface:settings:modal") }
      val pane = FrameLayout(f.activity).apply { tagged("t3-controller-pane:sidebar") }
      val region = FrameLayout(f.activity).apply { tagged("t3-controller-region:composer:reply:current") }
      val registered = ReactViewGroup(f.activity).apply { tagged("t3-controller:reply:current"); isFocusable = true }
      registered.addView(EditText(f.activity), FrameLayout.LayoutParams(400, 60))
      val ordinary = ReactViewGroup(f.activity).apply { id = 42; tagged("product-id"); ReactViewManager().setFocusable(this, true) }
      val disabled = View(f.activity).apply { id = 43; isClickable = true; isEnabled = false }
      val hidden = FrameLayout(f.activity).apply { importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS }
      hidden.add(View(f.activity).apply { id = 44; isClickable = true })
      region.add(ordinary, 300)
      region.add(registered, 20)
      region.add(disabled, 400)
      region.add(hidden, 500)
      region.add(View(f.activity).apply { isClickable = true }, 600)
      pane.add(region, height = 900)
      val outside = ReactViewGroup(f.activity).apply { id = 45; ReactViewManager().setFocusable(this, true) }
      pane.add(outside, 820)
      surface.add(pane, height = 900)
      f.scope.addView(surface, FrameLayout.LayoutParams(900, 900))
      f.layout()
      val scene = T3ControllerHost.snapshot(f.scope)
      assertEquals(listOf("native:42", "t3-controller:reply:current", "native:45"), scene.targets.map { it.id })
      assertEquals(listOf(false, true, false), scene.targets.map { it.registered })
      assertEquals(listOf("action", "reply", "action"), scene.targets.map { it.kind })
      assertTrue(scene.targets.take(2).all { it.region == "t3-controller-region:composer:reply:current" })
      assertEquals("t3-controller-pane:sidebar:content", scene.targets.last().region)
      assertEquals("t3-controller-surface:settings:modal", scene.regions.last().surface)
      assertEquals("composer", scene.regions.last().kind)
      assertEquals("product-id", T3ControllerHost.nativeId(ordinary))
      assertEquals("composer", scene.regions.last().kind)
      assertTrue(scene.regions.all { it.pane == "sidebar" })
    }
  }

  @Test fun effectsUseSemanticClicksExplicitEditorsAndEmptyRegionFocusAndRejectStaleTargets() {
    Fixture().use { f ->
      val action = ReactViewGroup(f.reactContext).apply { id = 52; ReactViewManager().setFocusable(this, true) }
      val reply = FrameLayout(f.activity).apply { tagged("t3-controller:reply:current"); isFocusable = true }
      val editor = EditText(f.activity)
      reply.add(editor)
      val empty = FrameLayout(f.activity).apply { tagged("t3-controller-region:conversation:empty") }
      f.scope.addView(action, FrameLayout.LayoutParams(500, 80))
      f.scope.addView(reply, FrameLayout.LayoutParams(500, 80).apply { topMargin = 100 })
      f.scope.addView(empty, FrameLayout.LayoutParams(500, 500).apply { topMargin = 200 })
      f.layout()
      assertNotNull(f.effect("focus", "t3-controller:reply:current"))
      assertFalse("Logical selection does not take Android editor focus", editor.hasFocus())
      assertNotNull(f.effect("edit", "t3-controller:reply:current"))
      assertSame(editor, f.root.findFocus())
      assertEquals(true, f.effect("snapshot")!!["editorFocused"])
      assertNotNull(f.effect("blur"))
      assertFalse(editor.hasFocus())
      assertNotNull(f.effect("focus", region = "t3-controller-region:conversation:empty"))
      assertFalse(editor.hasFocus())
      assertNotNull(f.effect("activate", "native:52"))
      assertEquals(listOf(52), f.reactContext.clicks)
      action.contentDescription = "Changed meaning"
      assertNull("A recycled semantic control cannot activate under its old ID", f.effect("activate", "native:52"))
      action.contentDescription = null
      assertNull(f.effect("activate", "native:52", "t3-controller-region:conversation:empty"))
      action.isEnabled = false
      assertNull(f.effect("activate", "native:52"))
      action.isEnabled = true
      action.visibility = View.INVISIBLE
      assertNull(f.effect("activate", "native:52"))
      action.visibility = View.VISIBLE
      f.scope.removeView(action)
      assertNull(f.effect("activate", "native:52"))
      assertEquals(listOf(52), f.reactContext.clicks)
      f.scope.controllerActive = false
      assertNull(f.effect("snapshot"))
    }
  }

  @Test fun scrollingSupportsBothHostsAndExcludesNestedRegions() {
    Fixture().use { f ->
      for (nested in listOf(false, true)) {
        val region = FrameLayout(f.activity).apply { tagged("t3-controller-region:content:own") }
        val childRegion = FrameLayout(f.activity).apply { tagged("t3-controller-region:inspector:nested") }
        val foreign = ScrollView(f.activity).apply { addView(View(f.activity).apply { minimumHeight = 2000 }, FrameLayout.LayoutParams(400, 2000)) }
        childRegion.add(foreign, height = 150)
        region.add(childRegion, height = 150)
        val own = if (nested) NestedScrollView(f.activity) else ScrollView(f.activity)
        (own as android.view.ViewGroup).addView(View(f.activity).apply { minimumHeight = 2000 }, FrameLayout.LayoutParams(400, 2000))
        region.add(own, 200, 300)
        f.scope.addView(region, FrameLayout.LayoutParams(600, 600))
        f.layout()
        assertNotNull(f.effect("scroll", region = "t3-controller-region:content:own", amount = 175.0))
        assertEquals(175, own.scrollY)
        assertEquals(0, foreign.scrollY)
        val payload = T3ControllerHost.snapshot(f.scope).payload()
        val regions = payload["regions"] as List<*>
        val ownPayload = regions.map { it as Map<*, *> }.first { it["id"] == "t3-controller-region:content:own" }
        assertEquals(300, ownPayload["viewportHeight"])
        assertEquals(true, ownPayload["canScrollUp"])
        assertEquals(true, ownPayload["canScrollDown"])
        f.scope.removeView(region)
      }
    }
  }

  @Test fun actualWindowInputEmitsSemanticsAndSuspensionRecoversMissingKeyRelease() {
    Fixture().use { f ->
      assertTrue("Initial window focus also supplies a scene", f.scope.events.any { it["action"] == "resumed" && it["scene"] is Map<*, *> })
      val action = View(f.activity).apply { id = 71; isFocusableInTouchMode = true; isClickable = true }
      f.scope.addView(action, FrameLayout.LayoutParams(500, 80))
      f.layout()
      action.requestFocus()
      f.enable()
      assertTrue(f.key(KeyEvent.KEYCODE_DPAD_DOWN))
      assertEquals("down", f.scope.events.last()["action"])
      assertSame(action, f.root.findFocus())
      f.controller.windowFocusChanged(false)
      assertEquals("suspended", f.scope.events.last()["action"])
      assertNull(f.effect("activate", "native:71"))
      val count = f.scope.events.size
      shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))
      assertEquals(count, f.scope.events.size)
      f.key(KeyEvent.KEYCODE_BUTTON_A)
      assertEquals(count, f.scope.events.size)
      f.controller.windowFocusChanged(true)
      assertEquals("resumed", f.scope.events.last()["action"])
      assertTrue(f.scope.events.last()["scene"] is Map<*, *>)
      assertTrue(f.key(KeyEvent.KEYCODE_DPAD_DOWN, repeat = 2))
      assertEquals("resumed", f.scope.events.last()["action"])
      assertTrue(f.key(KeyEvent.KEYCODE_DPAD_DOWN))
      assertEquals("down", f.scope.events.last()["action"])
      f.key(KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.ACTION_UP)
      assertTrue(f.motion(MotionEvent.AXIS_Y to 1f))
      assertEquals("down", f.scope.events.last()["action"])
      f.controller.windowFocusChanged(false)
      f.controller.windowFocusChanged(true)
      val resumedCount = f.scope.events.size
      assertTrue(f.motion(MotionEvent.AXIS_Y to 1f))
      assertEquals(resumedCount, f.scope.events.size)
      assertTrue(f.motion(MotionEvent.AXIS_Y to 0f))
      assertTrue(f.motion(MotionEvent.AXIS_Y to -1f))
      assertEquals("up", f.scope.events.last()["action"])
      f.motion(MotionEvent.AXIS_Y to 0f)
      T3ControllerRouter.suspend(f.root.rootView)
      assertEquals("suspended", f.scope.events.last()["action"])
      assertTrue(f.key(KeyEvent.KEYCODE_BUTTON_A))
      assertEquals("resumed", f.scope.events.last()["action"])
      f.key(KeyEvent.KEYCODE_BUTTON_A, KeyEvent.ACTION_UP)
      assertTrue(f.key(KeyEvent.KEYCODE_DPAD_DOWN))
      assertEquals("down", f.scope.events.last()["action"])
    }
  }

  @Test fun editorDirectionsPassThroughWhilePaletteSelectionAndAnalogScrollingStillWork() {
    Fixture().use { f ->
      val editor = EditText(f.activity).apply { id = 80 }
      f.scope.addView(editor, FrameLayout.LayoutParams(500, 80))
      f.layout()
      assertNotNull(f.effect("focus", "native:80"))
      assertFalse(editor.hasFocus())
      assertNotNull(f.effect("edit", "native:80"))
      assertTrue(editor.hasFocus())
      f.enable()
      val count = f.scope.events.size
      f.key(KeyEvent.KEYCODE_DPAD_DOWN)
      assertEquals(count, f.scope.events.size)
      f.key(KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.ACTION_UP)
      f.scope.controllerSelection = true
      assertTrue(f.key(KeyEvent.KEYCODE_DPAD_DOWN))
      assertEquals("down", f.scope.events.last()["action"])
      f.key(KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.ACTION_UP)
      f.scope.controllerSelection = false
      for ((button, action) in listOf(KeyEvent.KEYCODE_BUTTON_L2 to "conversation", KeyEvent.KEYCODE_BUTTON_R2 to "reply")) {
        assertTrue(f.key(button))
        assertEquals(action, f.scope.events.last()["action"])
        f.key(button, KeyEvent.ACTION_UP)
      }
      for ((axis, action) in listOf(MotionEvent.AXIS_LTRIGGER to "conversation", MotionEvent.AXIS_RTRIGGER to "reply")) {
        assertTrue(f.motion(axis to .8f))
        assertEquals(action, f.scope.events.last()["action"])
        val count = f.scope.events.count { it["action"] == action }
        assertTrue(f.motion(axis to .9f))
        assertEquals(count, f.scope.events.count { it["action"] == action })
        f.motion(axis to 0f)
        assertTrue(f.motion(axis to .8f))
        assertEquals(count + 1, f.scope.events.count { it["action"] == action })
        f.motion(axis to 0f)
      }
      assertTrue(f.motion(MotionEvent.AXIS_RZ to .8f))
      assertEquals("scroll", f.scope.events.last()["action"])
      assertEquals(40, f.scope.events.last()["amount"])
      assertTrue(f.key(KeyEvent.KEYCODE_BUTTON_A))
      assertEquals("activate", f.scope.events.last()["action"])
      assertTrue(f.key(KeyEvent.KEYCODE_BUTTON_A, repeat = 1))
      assertEquals(1, f.scope.events.count { it["action"] == "activate" })
      f.key(KeyEvent.KEYCODE_BUTTON_A, KeyEvent.ACTION_UP)
      assertTrue("Gamepad devices may label button events as keyboard input", f.key(KeyEvent.KEYCODE_BUTTON_A, source = InputDevice.SOURCE_KEYBOARD))
      assertEquals(2, f.scope.events.count { it["action"] == "activate" })
      T3ControllerRouter.reset()
      assertEquals("reset", f.scope.events.last()["action"])
    }
  }

  @Test fun topologyNotificationsDeduplicateAndActiveModalOwnershipDoesNotDependOnMountOrder() {
    Fixture().use { f ->
      val modal = Sink(f.activity, f.appContext).apply { controllerScope = "modal"; controllerEvents = true; controllerModal = true; controllerActive = false }
      f.root.addView(modal, FrameLayout.LayoutParams(900, 900))
      f.layout()
      f.enable()
      f.scope.onWindowFocusChanged(false)
      assertNotNull("A stale child focus callback cannot suspend the focused window", f.effect("snapshot"))
      f.scope.events.clear()
      f.layout()
      assertTrue(f.scope.events.isEmpty())
      val button = View(f.activity).apply { id = 91; setOnClickListener { } }
      f.scope.addView(button, FrameLayout.LayoutParams(400, 60))
      f.layout()
      assertEquals(1, f.scope.events.count { it["action"] == "scene" })
      f.layout()
      assertEquals(1, f.scope.events.count { it["action"] == "scene" })
      modal.controllerModal = false
      modal.controllerActive = true
      assertNotNull("Later mounts do not acquire controller authority", f.effect("snapshot"))
      val backgroundEditor = EditText(f.activity)
      f.scope.addView(backgroundEditor, FrameLayout.LayoutParams(500, 80))
      backgroundEditor.requestFocus()
      modal.controllerModal = true
      T3ControllerRouter.reset()
      f.enable()
      assertEquals("enabled", modal.events.last()["action"])
      assertTrue(f.key(KeyEvent.KEYCODE_DPAD_DOWN))
      assertEquals("down", modal.events.last()["action"])
      assertTrue("An overlay does not blur the underlying editor just to navigate", backgroundEditor.hasFocus())
      f.key(KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.ACTION_UP)
      assertNull(f.effect("snapshot"))
      modal.controllerActive = false
      assertNotNull(f.effect("snapshot"))
    }
  }
  @Test fun guardedProbeUsesProductionWindowRoutingAndAcknowledgesCompletion() {
    Fixture().use { f ->
      val flags = f.activity.applicationInfo.flags
      f.activity.applicationInfo.flags = flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE.inv()
      assertThrows(IllegalStateException::class.java) { T3ControllerProbe.input(f.activity, "blocked", "start") }
      f.activity.applicationInfo.flags = flags or android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE
      assertTrue(T3ControllerProbe.input(f.activity, "enabled", "start"))
      assertEquals(listOf("enabled", "testComplete"), f.scope.events.takeLast(2).map { it["action"] })
      assertTrue(T3ControllerProbe.input(f.activity, "move", "down"))
      assertEquals(listOf("down", "testComplete"), f.scope.events.takeLast(2).map { it["action"] })
      assertTrue(T3ControllerProbe.input(f.activity, "lost", "suspend"))
      assertTrue(f.root.hasWindowFocus())
      assertTrue(T3ControllerProbe.input(f.activity, "recover", "a"))
      assertEquals(listOf("resumed", "testComplete"), f.scope.events.takeLast(2).map { it["action"] })
      assertTrue(T3ControllerProbe.input(f.activity, "returned", "resume"))
      assertTrue(T3ControllerProbe.input(f.activity, "fresh", "x"))
      assertEquals(listOf("dictate", "testComplete"), f.scope.events.takeLast(2).map { it["action"] })
      assertTrue(T3ControllerProbe.input(f.activity, "help", "select"))
      assertEquals(listOf("chooser", "testComplete"), f.scope.events.takeLast(2).map { it["action"] })
      assertFalse(T3ControllerProbe.acceptsVirtual(KeyEvent(0, 0, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BUTTON_A, 0, 0, -7343, 0, 0, InputDevice.SOURCE_GAMEPAD)))
      f.activity.applicationInfo.flags = flags
    }
  }

}
