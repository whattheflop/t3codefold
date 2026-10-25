package expo.modules.t3terminal

import android.content.Context
import android.graphics.Color
import android.graphics.Rect
import android.graphics.Typeface
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.max

class T3TerminalView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val container = FrameLayout(context)
  private val terminalCanvas = TerminalCanvasView(context)
  private val inputView = EditText(context)
  private val onInput by EventDispatcher()
  private val onResize by EventDispatcher()
  private val onCapture by EventDispatcher()
  private val onOutputApplied by EventDispatcher()
  private val onCursorKeysChange by EventDispatcher()
  private val onFontScaleCommit by EventDispatcher()
  private var pinching = false
  private var pinchScale = 1f
  private val resetPinchPreview = Runnable {
    terminalCanvas.scaleX = 1f
    terminalCanvas.scaleY = 1f
  }
  private fun clearPinchPreview() {
    removeCallbacks(resetPinchPreview)
    resetPinchPreview.run()
  }

  private val scaleDetector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
    override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
      clearPinchPreview()
      parent?.requestDisallowInterceptTouchEvent(true)
      pinching = true
      pinchScale = 1f
      return true
    }
    override fun onScale(detector: ScaleGestureDetector): Boolean {
      pinchScale = (pinchScale * detector.scaleFactor).coerceIn(6f / fontSize, 14f / fontSize)
      terminalCanvas.pivotX = detector.focusX
      terminalCanvas.pivotY = detector.focusY
      terminalCanvas.scaleX = pinchScale
      terminalCanvas.scaleY = pinchScale
      return true
    }
  })
  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    val wasPinching = pinching
    scaleDetector.onTouchEvent(event)
    if (!wasPinching && pinching) {
      val cancel = MotionEvent.obtain(event)
      cancel.action = MotionEvent.ACTION_CANCEL
      super.dispatchTouchEvent(cancel)
      cancel.recycle()
    }
    if (pinching) {
      if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
        if (event.actionMasked == MotionEvent.ACTION_UP && !(kotlin.math.abs(pinchScale - 1f) < 0.001f)) {
          onFontScaleCommit(mapOf("scale" to pinchScale))
          // Hold the preview until React delivers the committed typography. A bounded
          // fallback also clears it if the receiving screen disappears or rejects it.
          postDelayed(resetPinchPreview, 250)
        } else {
          clearPinchPreview()
        }
        pinching = false
        parent?.requestDisallowInterceptTouchEvent(false)
      }
      return true
    }
    return super.dispatchTouchEvent(event)
  }

  var captureRequest: Double = 0.0
    set(value) {
      if (field == value || value <= 0) return
      field = value
      val frame = if (terminalHandle !=
        0L
      ) {
        TerminalFrame.decode(GhosttyBridge.nativeSnapshot(terminalHandle))
      } else {
        null
      }
      val text = frame?.let { snapshot ->
        (0 until snapshot.rows).joinToString("\n") { row ->
          (0 until snapshot.cols).joinToString("") { col ->
            snapshot.cellText[
              row * snapshot.cols +
                col
            ]
          }.trimEnd()
        }
      } ?: ""
      onCapture(mapOf("text" to text))
    }
  private var terminalHandle = 0L

  // The output stream the terminal holds: reset `appliedResetId` up to UTF-16
  // offset `appliedEnd`. 0 means the terminal holds no stream yet.
  private var appliedResetId = 0
  private var appliedEnd = 0
  private var applicationCursorKeys = false
  private var cols = 0
  private var rows = 0
  private var clearingInput = false
  private var isCleanedUp = false
  private var backgroundColorValue = Color.parseColor("#24292E")
  private var foregroundColorValue = Color.parseColor("#D1D5DA")
  private var mutedForegroundColorValue = Color.parseColor("#959DA5")
  private var cursorColorValue = Color.parseColor("#009FFF")
  private var paletteColors = IntArray(0)

  var terminalKey: String = ""
    set(value) {
      if (field == value) return
      field = value
      contentDescription = "t3-terminal-$value"
      recreateTerminal()
    }

  var output: TerminalOutputWrite? = null
    set(value) {
      field = value
      applyOutput()
    }

  var fontSize: Float = 10f
    set(value) {
      clearPinchPreview()
      field = value
      terminalCanvas.fontSizeSp = value
      inputView.textSize = max(value, 13f)
      emitResize()
    }

  var appearanceScheme: String = "dark"

  var themeConfig: String = ""
    set(value) {
      field = value
      parseThemeConfig(value)
      applyTheme()
    }

  var focusRequest: Double = 0.0
    set(value) {
      val previous = field
      field = value
      if (value != previous && value > 0) {
        requestKeyboardFocus()
      }
    }

  var readOnly: Boolean = false
    set(value) {
      field = value
      inputView.isEnabled = !value
      if (value) {
        inputView.clearFocus()
        hideKeyboard()
      }
    }

  var autoFocus: Boolean = true
    set(value) {
      field = value
      if (value) {
        requestKeyboardFocus()
      } else {
        inputView.clearFocus()
        hideKeyboard()
      }
    }

  var backgroundColorHex: String = "#24292E"
    set(value) {
      field = value
      backgroundColorValue = parseColor(value, backgroundColorValue)
      applyTheme()
    }

  var foregroundColorHex: String = "#D1D5DA"
    set(value) {
      field = value
      foregroundColorValue = parseColor(value, foregroundColorValue)
      applyTheme()
    }

  var mutedForegroundColorHex: String = "#959DA5"
    set(value) {
      field = value
      mutedForegroundColorValue = parseColor(value, mutedForegroundColorValue)
    }

  init {
    terminalCanvas.fontSizeSp = fontSize
    terminalCanvas.onRequestKeyboard = { requestKeyboardFocus() }
    terminalCanvas.onScrollRows = { delta ->
      if (terminalHandle != 0L) {
        GhosttyBridge.nativeScroll(terminalHandle, delta)
        renderSnapshot()
      }
    }
    terminalCanvas.onCellMetricsChanged = { emitResize() }
    terminalCanvas.selectionDelegate = object : TerminalSelectionDelegate {
      override fun selectWordAt(col: Int, row: Int): Boolean {
        if (terminalHandle == 0L) return false
        val selected = GhosttyBridge.nativeSelectWordAt(terminalHandle, col, row)
        if (selected) renderSnapshot()
        return selected
      }

      override fun extendSelection(anchorCol: Int, anchorRow: Int, col: Int, row: Int) {
        if (terminalHandle == 0L) return
        GhosttyBridge.nativeExtendSelection(terminalHandle, anchorCol, anchorRow, col, row)
        renderSnapshot()
      }

      override fun selectAll(): Boolean {
        if (terminalHandle == 0L) return false
        val selected = GhosttyBridge.nativeSelectAll(terminalHandle)
        if (selected) renderSnapshot()
        return selected
      }

      override fun clearSelection() {
        if (terminalHandle == 0L) return
        GhosttyBridge.nativeClearSelection(terminalHandle)
        renderSnapshot()
      }

      override fun selectionText(): String? =
        if (terminalHandle == 0L) {
          null
        } else {
          GhosttyBridge.nativeGetSelectionText(terminalHandle)?.let { String(it, Charsets.UTF_8) }
        }
    }

    configureInputView()
    container.addView(
      terminalCanvas,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )
    container.addView(inputView, FrameLayout.LayoutParams(1, 1))
    addView(
      container,
      LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
    )
    applyTheme()
  }

  override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
    super.onSizeChanged(width, height, oldWidth, oldHeight)
    if (width != oldWidth || height != oldHeight) emitResize()
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    val childWidthSpec = MeasureSpec.makeMeasureSpec(measuredWidth, MeasureSpec.EXACTLY)
    val childHeightSpec = MeasureSpec.makeMeasureSpec(measuredHeight, MeasureSpec.EXACTLY)
    container.measure(childWidthSpec, childHeightSpec)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    container.layout(0, 0, right - left, bottom - top)
    if (changed) emitResize()
  }

  fun cleanup() {
    clearPinchPreview()
    if (isCleanedUp) return
    isCleanedUp = true
    inputView.setOnEditorActionListener(null)
    terminalCanvas.onScrollRows = null
    terminalCanvas.onRequestKeyboard = null
    terminalCanvas.onCellMetricsChanged = null
    terminalCanvas.selectionDelegate = null
    destroyTerminal()
  }

  private fun configureInputView() {
    // The app's hardware-shortcut router (t3-native-controls) leaves plain Ctrl chords to a
    // focused view with this tag, so Ctrl+B/K/F/N/[ reach the shell instead of app shortcuts.
    inputView.tag = "t3-raw-keyboard"
    inputView.setSingleLine(true)
    inputView.setTextColor(Color.TRANSPARENT)
    inputView.setHintTextColor(Color.TRANSPARENT)
    inputView.setBackgroundColor(Color.TRANSPARENT)
    inputView.typeface = Typeface.MONOSPACE
    inputView.textSize = max(fontSize, 13f)
    inputView.alpha = 0.01f
    inputView.isFocusableInTouchMode = true
    inputView.imeOptions = EditorInfo.IME_ACTION_SEND or
      EditorInfo.IME_FLAG_NO_EXTRACT_UI or
      EditorInfo.IME_FLAG_NO_FULLSCREEN or
      EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
    inputView.inputType = InputType.TYPE_CLASS_TEXT or
      InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD or
      InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
    inputView.setPadding(0, 0, 0, 0)
    inputView.setOnEditorActionListener { _, actionId, event ->
      if (readOnly) return@setOnEditorActionListener true
      // A single-line EditText moves focus to the next view on an unconsumed hardware
      // Enter key-up, which would leave the terminal deaf to the next keys.
      if (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_UP) {
        return@setOnEditorActionListener true
      }
      val isKeyUp = event?.action == KeyEvent.ACTION_UP
      val isImeSend = actionId == EditorInfo.IME_ACTION_SEND && !isKeyUp
      val isHardwareEnter = event?.keyCode == KeyEvent.KEYCODE_ENTER &&
        event.action == KeyEvent.ACTION_DOWN
      val isEnter = isImeSend || isHardwareEnter
      if (isEnter) {
        // Enter must send CR: raw-mode TUIs treat LF as Ctrl+J (insert newline).
        onInput(mapOf("data" to "\r"))
        true
      } else {
        false
      }
    }
    inputView.setOnKeyListener { _, keyCode, event ->
      if (readOnly) return@setOnKeyListener true
      when {
        event.action != KeyEvent.ACTION_DOWN -> false
        TerminalHardwareKeys.shouldEncode(keyCode, event.metaState) && sendHardwareKey(event) -> true
        keyCode == KeyEvent.KEYCODE_DEL -> {
          onInput(mapOf("data" to "\u007F"))
          true
        }
        else -> false
      }
    }
    inputView.addTextChangedListener(
      object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit

        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
          if (readOnly) return
          if (clearingInput || s == null || count <= 0) return
          val end = (start + count).coerceAtMost(s.length)
          if (start < end) {
            val insertedText = s.subSequence(start, end).toString()
            onInput(mapOf("data" to insertedText))
          }
        }

        override fun afterTextChanged(editable: Editable?) {
          if (clearingInput || editable.isNullOrEmpty()) return
          clearingInput = true
          editable.clear()
          clearingInput = false
        }
      },
    )
  }

  /** Sends a hardware key encoded for the terminal's current modes; false if it has no encoding. */
  private fun sendHardwareKey(event: KeyEvent): Boolean {
    if (terminalHandle == 0L) return false
    val encoded = GhosttyBridge.nativeEncodeKey(
      terminalHandle,
      event.keyCode,
      event.metaState,
      TerminalHardwareKeys.text(event),
      TerminalHardwareKeys.unshiftedText(event),
      event.repeatCount > 0,
    )
    if (encoded.isEmpty()) return false
    onInput(mapOf("data" to String(encoded, Charsets.UTF_8)))
    return true
  }

  @Suppress("ComplexCondition")
  private fun emitResize() {
    if (
      width <= 0 ||
      height <= 0 ||
      terminalCanvas.width <= 0 ||
      terminalCanvas.height <= 0 ||
      isCleanedUp
    ) {
      return
    }
    val nextCols = (terminalCanvas.usableWidth() / terminalCanvas.cellWidthPx)
      .toInt()
      .coerceIn(2, 400)
    val nextRows = (terminalCanvas.usableHeight() / terminalCanvas.cellHeightPx)
      .toInt()
      .coerceIn(2, 200)
    if (nextCols == cols && nextRows == rows && terminalHandle != 0L) return
    cols = nextCols
    rows = nextRows
    val response = if (terminalHandle == 0L) {
      createTerminal()
      ByteArray(0)
    } else {
      GhosttyBridge.nativeResize(
        terminalHandle,
        cols,
        rows,
        terminalCanvas.cellWidthPx.toInt(),
        terminalCanvas.cellHeightPx.toInt(),
      )
    }
    emitResponse(response)
    onResize(mapOf("cols" to cols, "rows" to rows))
    applyOutput()
    renderSnapshot()
  }

  @Suppress("ComplexCondition")
  private fun createTerminal() {
    if (terminalHandle != 0L || cols <= 0 || rows <= 0 || isCleanedUp) return
    terminalHandle = GhosttyBridge.nativeCreate(
      cols,
      rows,
      terminalCanvas.cellWidthPx.toInt(),
      terminalCanvas.cellHeightPx.toInt(),
      foregroundColorValue,
      backgroundColorValue,
      cursorColorValue,
      paletteColors,
    )
    appliedResetId = 0
    appliedEnd = 0
  }

  private fun recreateTerminal() {
    if (terminalHandle == 0L) return
    destroyTerminal()
    createTerminal()
    applyOutput()
    renderSnapshot()
  }

  private fun destroyTerminal() {
    if (terminalHandle == 0L) return
    GhosttyBridge.nativeDestroy(terminalHandle)
    terminalHandle = 0L
    appliedResetId = 0
    appliedEnd = 0
    terminalCanvas.resetSelectionState()
  }

  /**
   * Applies the `output` prop (see terminalSurfaceOutput.ts): a new reset id replays
   * history into a fresh terminal, otherwise only the part past `appliedEnd` is fed.
   * Every change is acknowledged so JS can send the next write from there.
   */
  private fun applyOutput() {
    val write = output ?: return
    if (terminalHandle == 0L) return
    if (write.resetId != appliedResetId) {
      // A continuation of a stream this terminal does not hold; the ack asks JS for a reset.
      if (write.start != 0) {
        emitOutputApplied()
        return
      }
      if (appliedResetId != 0) {
        destroyTerminal()
        createTerminal()
        if (terminalHandle == 0L) return
      }
      // Replayed history must not answer old terminal queries, so drop its replies.
      GhosttyBridge.nativeFeed(terminalHandle, write.data.toByteArray(Charsets.UTF_8))
      appliedResetId = write.resetId
      appliedEnd = write.data.length
    } else {
      if (write.start > appliedEnd) {
        emitOutputApplied()
        return
      }
      val unapplied = appliedEnd - write.start
      if (unapplied >= write.data.length) return
      val suffix = write.data.substring(unapplied)
      emitResponse(GhosttyBridge.nativeFeed(terminalHandle, suffix.toByteArray(Charsets.UTF_8)))
      appliedEnd = write.start + write.data.length
      // New output invalidates an active selection (matches the web drawer);
      // otherwise the copy toolbar drifts out of sync with the grid.
      if (terminalCanvas.hasActiveSelection()) {
        GhosttyBridge.nativeClearSelection(terminalHandle)
        terminalCanvas.resetSelectionState()
      }
    }
    renderSnapshot()
    emitOutputApplied()
    syncCursorKeyMode()
  }

  // The on-screen arrow keys live in JS, so report DECCKM for them to follow.
  private fun syncCursorKeyMode() {
    val enabled = terminalHandle != 0L && GhosttyBridge.nativeApplicationCursorKeys(terminalHandle)
    if (enabled == applicationCursorKeys) return
    applicationCursorKeys = enabled
    onCursorKeysChange(mapOf("application" to enabled))
  }

  private fun emitOutputApplied() {
    onOutputApplied(mapOf("resetId" to appliedResetId, "end" to appliedEnd))
  }

  private fun renderSnapshot() {
    if (terminalHandle == 0L) return
    TerminalFrame.decode(
      GhosttyBridge.nativeSnapshot(terminalHandle)
    )?.let(terminalCanvas::setFrame)
  }

  private fun emitResponse(response: ByteArray) {
    if (!readOnly && response.isNotEmpty()) {
      onInput(mapOf("data" to String(response, Charsets.UTF_8)))
    }
  }

  // A hidden workspace pane keeps the terminal mounted (clipped to zero width) so the
  // PTY keeps its size; it must not keep keyboard focus or the soft keyboard there.
  private val releaseFocusWhenClipped = ViewTreeObserver.OnGlobalLayoutListener {
    if (inputView.hasFocus() && !getGlobalVisibleRect(Rect())) {
      inputView.clearFocus()
      hideKeyboard()
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    viewTreeObserver.addOnGlobalLayoutListener(releaseFocusWhenClipped)
  }

  override fun onDetachedFromWindow() {
    pinching = false
    clearPinchPreview()
    parent?.requestDisallowInterceptTouchEvent(false)
    viewTreeObserver.removeOnGlobalLayoutListener(releaseFocusWhenClipped)
    super.onDetachedFromWindow()
  }

  private fun requestKeyboardFocus() {
    if (readOnly) return
    inputView.requestFocus()
    val inputMethodManager = context.getSystemService(
      Context.INPUT_METHOD_SERVICE
    ) as? InputMethodManager
    inputMethodManager?.showSoftInput(inputView, InputMethodManager.SHOW_IMPLICIT)
  }

  private fun hideKeyboard() {
    val inputMethodManager = context.getSystemService(
      Context.INPUT_METHOD_SERVICE
    ) as? InputMethodManager
    inputMethodManager?.hideSoftInputFromWindow(windowToken, 0)
  }

  private fun applyTheme() {
    setBackgroundColor(backgroundColorValue)
    container.setBackgroundColor(backgroundColorValue)
    terminalCanvas.setBackgroundColor(backgroundColorValue)
    if (terminalHandle != 0L) {
      GhosttyBridge.nativeSetTheme(
        terminalHandle,
        foregroundColorValue,
        backgroundColorValue,
        cursorColorValue,
        paletteColors,
      )
      renderSnapshot()
    }
  }

  @Suppress("LoopWithTooManyJumpStatements")
  private fun parseThemeConfig(config: String) {
    val palette = sortedMapOf<Int, Int>()
    for (line in config.lineSequence()) {
      val parts = line.split('=', limit = 2)
      if (parts.size != 2) continue
      val key = parts[0].trim()
      val value = parts[1].trim()
      when (key) {
        "cursor-color" -> cursorColorValue = parseColor(value, cursorColorValue)
        "palette" -> {
          val paletteParts = value.split('=', limit = 2)
          val index = paletteParts.firstOrNull()?.trim()?.toIntOrNull() ?: continue
          val color = paletteParts.getOrNull(1)?.trim() ?: continue
          if (index in 0..255) palette[index] = parseColor(color, foregroundColorValue)
        }
      }
    }
    if (palette.isNotEmpty()) {
      val lastIndex = palette.lastKey()
      paletteColors = IntArray(lastIndex + 1) { index ->
        palette[index] ?: foregroundColorValue
      }
    }
  }

  private fun parseColor(value: String, fallback: Int): Int =
    try {
      Color.parseColor(value)
    } catch (_: IllegalArgumentException) {
      fallback
    }
}
