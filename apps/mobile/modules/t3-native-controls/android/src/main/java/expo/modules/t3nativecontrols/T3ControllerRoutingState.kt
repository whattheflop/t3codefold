package expo.modules.t3nativecontrols

internal enum class ControllerKeyDisposition { PASS, CONSUME, DISPATCH }

internal class T3ControllerRoutingState {
  private val held = mutableSetOf<Pair<Int, Int>>()
  private val axes = mutableMapOf<Int, Boolean>()
  private var device: Int? = null
  private var awaitingNeutral = false
  private var quarantinedAxes = false
  var generation = 0
    private set

  fun selectDevice(id: Int) {
    if (device != id) { device = id; awaitingNeutral = !neutral() }
  }
  private fun neutral() = held.none { it.first == device } && axes[device] != true
  fun suspend() {
    generation += 1
    quarantinedAxes = quarantinedAxes || axes[device] == true
    held.clear()
    axes.clear()
    awaitingNeutral = false
  }
  fun reset() {
    suspend()
    quarantinedAxes = false
    device = null
  }
  fun scopeChanged() { generation += 1; awaitingNeutral = !neutral() }
  fun keyUp(deviceId: Int, key: Int): Boolean {
    val consumed = held.remove(deviceId to key)
    if (neutral()) awaitingNeutral = false
    return consumed
  }
  fun keyDown(deviceId: Int, key: Int, action: String, editor: Boolean, selection: Boolean, repeat: Int): ControllerKeyDisposition {
    if (editor && !selection && action in DIRECTIONS) return ControllerKeyDisposition.PASS
    val token = deviceId to key
    if (token in held || repeat > 0) return ControllerKeyDisposition.CONSUME
    held.add(token)
    if (awaitingNeutral) return ControllerKeyDisposition.CONSUME
    return ControllerKeyDisposition.DISPATCH
  }
  fun isHeld(deviceId: Int, key: Int) = deviceId to key in held
  fun motion(deviceId: Int, active: Boolean): Boolean {
    if (quarantinedAxes) {
      if (active) return false
      quarantinedAxes = false
    }
    axes[deviceId] = active
    if (neutral()) awaitingNeutral = false
    return !awaitingNeutral
  }
  fun canRepeat(capturedGeneration: Int, editor: Boolean = false, selection: Boolean = false) =
    capturedGeneration == generation && !awaitingNeutral && (!editor || selection)
  companion object { val DIRECTIONS = setOf("up", "down", "left", "right") }
}
