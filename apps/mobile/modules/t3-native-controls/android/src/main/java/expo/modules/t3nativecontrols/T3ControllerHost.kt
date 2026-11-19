package expo.modules.t3nativecontrols

import android.graphics.Rect
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.inputmethod.InputMethodManager
import android.content.Context
import android.widget.ScrollView
import androidx.core.widget.NestedScrollView
import java.lang.ref.WeakReference
import java.util.WeakHashMap
import android.graphics.drawable.GradientDrawable

internal object T3ControllerHost {
  internal data class Region(val view: View, val id: String, val kind: String, val surface: String, val implicit: Boolean = false, val pane: String = "content")
  internal data class Target(val view: View, val id: String, val region: String, val kind: String, val registered: Boolean)
  internal data class Scene(val root: View, val regions: List<Region>, val targets: List<Target>) {
    fun payload(): Map<String, Any?> {
      val focused = root.findFocus()
      return mapOf(
        "width" to root.width,
        "regions" to regions.map { region ->
          val scroller = scroller(region.view)
          mapOf("id" to region.id, "kind" to region.kind, "surfaceId" to region.surface, "pane" to region.pane,
            "viewportHeight" to Rect().let { (scroller ?: region.view).getGlobalVisibleRect(it); it.height() },
            "canScrollUp" to (scroller?.canScrollVertically(-1) == true),
            "canScrollDown" to (scroller?.canScrollVertically(1) == true))
        },
        "targets" to regions.flatMap { region ->
          val local = targets.filter { it.region == region.id }
          if (scroller(region.view) == null) local else local.sortedWith(compareBy<Target>(
            { Rect().also { rect -> it.view.getGlobalVisibleRect(rect) }.top },
            { Rect().also { rect -> it.view.getGlobalVisibleRect(rect) }.left }
          ))
        }.map { mapOf("id" to it.id, "regionId" to it.region, "kind" to it.kind,
          "registered" to it.registered, "selected" to it.view.isSelected, "label" to (it.view.contentDescription?.toString() ?: "")) },
        "focusedTargetId" to targets.lastOrNull { within(focused, it.view) }?.id,
        "editorFocused" to (focused?.onCheckIsTextEditor() == true)
      )
    }
  }
  private data class Highlight(
    val target: WeakReference<View>,
    val drawable: GradientDrawable,
    val observer: ViewTreeObserver,
    val focusListener: ViewTreeObserver.OnGlobalFocusChangeListener
  )
  private val highlights = WeakHashMap<View, Highlight>()
  fun clearHighlight(root: View) {
    highlights.remove(root)?.let {
      it.target.get()?.overlay?.remove(it.drawable)
      if (it.observer.isAlive) it.observer.removeOnGlobalFocusChangeListener(it.focusListener)
    }
  }
  private fun highlight(root: View, target: View, control: Boolean) {
    clearHighlight(root)
    val visible = Rect()
    if (!target.getLocalVisibleRect(visible)) return
    val density = target.resources.displayMetrics.density
    val attributes = target.context.obtainStyledAttributes(intArrayOf(android.R.attr.colorAccent))
    val accent = try {
      attributes.getColor(0, Color.rgb(128, 144, 176))
    } finally {
      attributes.recycle()
    }
    fun tint(opacity: Float) = Color.argb(
      (Color.alpha(accent) * opacity).toInt(), Color.red(accent), Color.green(accent), Color.blue(accent)
    )
    val drawable = GradientDrawable().apply {
      if (control) {
        setColor(tint(0.07f))
        setStroke((density).toInt().coerceAtLeast(1), tint(0.55f))
        cornerRadius = 8 * density
        setBounds(0, 0, target.width, target.height)
      } else {
        val inset = (4 * density).toInt()
        val left = visible.left + inset.coerceAtMost((visible.width() - 1).coerceAtLeast(0))
        val top = visible.top + inset.coerceAtMost((visible.height() - 1).coerceAtLeast(0))
        setColor(tint(0.5f))
        cornerRadius = density
        setBounds(left, top, (left + (2 * density).toInt().coerceAtLeast(1)).coerceAtMost(visible.right),
          (top + (24 * density).toInt().coerceAtLeast(1)).coerceAtMost(visible.bottom))
      }
    }
    val rootReference = WeakReference(root)
    val focusListener = ViewTreeObserver.OnGlobalFocusChangeListener { _, focused ->
      if (focused?.onCheckIsTextEditor() == true) rootReference.get()?.let { clearHighlight(it) }
    }
    val observer = root.viewTreeObserver
    observer.addOnGlobalFocusChangeListener(focusListener)
    target.overlay.add(drawable)
    highlights[root] = Highlight(WeakReference(target), drawable, observer, focusListener)
  }
  private fun fallbackId(view: View): String? {
    if (view.id <= 0) return null
    val description = view.contentDescription?.toString()?.takeIf { it.isNotBlank() }
    return "native:${view.id}" + (description?.let { ":${it.hashCode()}" } ?: "")
  }
  private val regionKinds = setOf("content", "header", "threads", "conversation", "composer", "inspector", "navigation")
  fun nativeId(view: View) = view.getTag(com.facebook.react.R.id.view_tag_native_id) as? String
  private fun regionKind(view: View): String? {
    val id = nativeId(view) ?: return null
    if (id == "t3-controller-conversation" || id == "t3-controller-chat") return "conversation"
    if (!id.startsWith("t3-controller-region:")) return null
    return id.removePrefix("t3-controller-region:").substringBefore(':').takeIf { it in regionKinds }
  }
  private fun eligible(view: View) = view.isShown && view.isEnabled && view.alpha > 0 &&
    view.importantForAccessibility != View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS &&
    view.getGlobalVisibleRect(Rect())
  fun within(view: View?, root: View) = generateSequence(view) { it.parent as? View }.any { it === root }
  fun snapshot(root: View): Scene {
    val regions = mutableListOf(Region(root, "", "content", "", true))
    val targets = mutableListOf<Target>()
    fun visit(view: View, regionId: String, surface: String, registeredParent: Boolean, pane: String) {
      if (!eligible(view)) return
      if (view !== root && view is T3KeyboardCommandsView) return
      val id = nativeId(view)
      val kind = regionKind(view)
      val declaredPane = id?.takeIf { it.startsWith("t3-controller-pane:") }
        ?.removePrefix("t3-controller-pane:")?.takeIf { it in setOf("sidebar", "content", "inspector") }
      val currentPane = declaredPane ?: if (kind == "inspector") "inspector" else pane
      val currentSurface = id?.takeIf { it.startsWith("t3-controller-surface:") } ?: surface
      val surfaceRegion = kind == null && currentSurface != surface
      val currentRegion = if (kind != null) id!! else if (surfaceRegion) "$currentSurface:content" else if (declaredPane != null) "$id:content" else regionId
      if (kind != null) regions.add(Region(view, currentRegion, kind, currentSurface, pane = currentPane))
      else if (surfaceRegion) regions.add(Region(view, currentRegion, "content", currentSurface, true, currentPane))
      else if (declaredPane != null) regions.add(Region(view, currentRegion, "content", currentSurface, true, currentPane))
      val registered = id?.startsWith("t3-controller:") == true
      if (registered || (!registeredParent && ((view.isClickable && view.hasOnClickListeners()) || view.onCheckIsTextEditor()))) {
        val targetId = if (registered) id else fallbackId(view)
        if (targetId != null) {
          val targetKind = when {
            registered && id!!.removePrefix("t3-controller:").substringBefore(':') in setOf("reply", "thread", "footer", "adjustable") -> id.removePrefix("t3-controller:").substringBefore(':')
            editor(view) != null -> "editor"
            else -> "action"
          }
          targets.add(Target(view, targetId, currentRegion, targetKind, registered))
        }
      }
      if (view is ViewGroup) for (index in 0 until view.childCount) {
        visit(view.getChildAt(index), currentRegion, currentSurface, registeredParent || registered, currentPane)
      }
    }
    visit(root, "", "", false, "content")
    val meaningful = regions.filter { region -> !region.implicit || regions.size == 1 || targets.any { it.region == region.id } || scroller(region.view) != null }
    return Scene(root, meaningful, targets)
  }
  private fun editor(view: View): View? {
    if (!eligible(view)) return null
    if (view.onCheckIsTextEditor()) return view
    if (view is ViewGroup) for (index in 0 until view.childCount) editor(view.getChildAt(index))?.let { return it }
    return null
  }
  private fun scroller(root: View): View? {
    fun visit(view: View): View? {
      if (!eligible(view) || (view !== root && (regionKind(view) != null || nativeId(view)?.startsWith("t3-controller-pane:") == true || nativeId(view)?.startsWith("t3-controller-surface:") == true))) return null
      if (view is ScrollView || view is NestedScrollView) return view
      if (view is ViewGroup) for (index in 0 until view.childCount) visit(view.getChildAt(index))?.let { return it }
      return null
    }
    return visit(root)
  }
  fun effect(root: View, kind: String, targetId: String, regionId: String, amount: Double): Map<String, Any?>? {
    val scene = snapshot(root)
    val target = scene.targets.firstOrNull { it.id == targetId && it.region == regionId }
    val region = scene.regions.firstOrNull { it.id == regionId }
    if (kind != "snapshot" && (region == null || (targetId.isNotEmpty() && target == null))) return null
    when (kind) {
      "snapshot" -> Unit
      "focus" -> {
        if (targetId.isNotEmpty() && target == null) return null
        val destination = target?.view ?: region?.view ?: return null
        root.findFocus()?.takeIf { it.onCheckIsTextEditor() }?.let { field ->
          (root.context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(field.windowToken, 0)
          field.clearFocus()
        }
        highlight(root, destination, target != null)
      }
      "activate" -> (target ?: return null).view.performClick()
      "edit" -> {
        val field = editor((target ?: return null).view) ?: return null
        field.isFocusableInTouchMode = true
        if (field.requestFocus()) {
          clearHighlight(root)
          (root.context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
            .showSoftInput(field, InputMethodManager.SHOW_IMPLICIT)
        }
      }
      "blur" -> {
        val focused = root.findFocus()
        if (focused != null && within(focused, root)) {
          (root.context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(focused.windowToken, 0)
          focused.clearFocus()
          highlight(root, target?.view ?: region?.view ?: root, target != null)
        }
      }
      "scroll" -> {
        if (!amount.isFinite()) return null
        val host = scroller((region ?: return null).view)
        host?.scrollBy(0, amount.toInt())
      }
      else -> return null
    }
    return snapshot(root).payload()
  }
}
