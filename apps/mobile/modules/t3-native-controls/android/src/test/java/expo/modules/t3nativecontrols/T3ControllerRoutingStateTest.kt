package expo.modules.t3nativecontrols

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class T3ControllerRoutingStateTest {
  private fun state() = T3ControllerRoutingState().apply { selectDevice(7) }
  private fun T3ControllerRoutingState.down(key: Int, action: String, editor: Boolean = false, selection: Boolean = false) =
    keyDown(7, key, action, editor, selection, 0)

  @Test fun missedReleaseDuringSuspensionDoesNotTrapFreshKeysOrResumeHeldAxes() {
    val state = state()
    state.down(1, "down")
    state.motion(7, true)
    val generation = state.generation
    state.suspend()
    assertFalse(state.canRepeat(generation))
    assertEquals(ControllerKeyDisposition.CONSUME, state.keyDown(7, 1, "down", false, false, 2))
    assertEquals(ControllerKeyDisposition.DISPATCH, state.down(1, "down"))
    assertFalse(state.motion(7, true))
    state.keyUp(7, 1)
    assertTrue(state.motion(7, false))
    assertTrue(state.motion(7, true))
  }

  @Test fun replacementRequestStopsRepeatAndGatesEveryActionUntilAllInputsRelease() {
    val state = state()
    assertEquals(ControllerKeyDisposition.DISPATCH, state.down(1, "down"))
    val previousGeneration = state.generation
    state.scopeChanged()
    assertFalse(state.canRepeat(previousGeneration))
    for ((key, action) in listOf("activate", "dictate", "footer", "previous", "next", "menu", "back", "pageDown").withIndex()) {
      assertEquals(action, ControllerKeyDisposition.CONSUME, state.down(key + 10, action))
      state.keyUp(7, key + 10)
    }
    state.keyUp(7, 1)
    assertEquals(ControllerKeyDisposition.DISPATCH, state.down(2, "down"))
  }

  @Test fun neutralScopeChangeDoesNotSwallowTheFirstKeyOnlyDpadPress() {
    val state = state()
    state.scopeChanged()
    assertEquals(ControllerKeyDisposition.DISPATCH, state.down(1, "down"))
  }

  @Test fun releasingAKeyDoesNotArmWhileAnAxisIsStillHeld() {
    val state = state()
    state.motion(7, true)
    state.scopeChanged()
    state.down(1, "activate")
    state.keyUp(7, 1)
    assertEquals(ControllerKeyDisposition.CONSUME, state.down(2, "dictate"))
    state.keyUp(7, 2)
    assertTrue(state.motion(7, false))
    assertEquals(ControllerKeyDisposition.DISPATCH, state.down(3, "activate"))
  }

  @Test fun allEditorDirectionsPassThroughWithoutStartingRepeatOrHoldingTheirRelease() {
    for (action in T3ControllerRoutingState.DIRECTIONS) {
      val state = state()
      assertEquals(action, ControllerKeyDisposition.PASS, state.down(1, action, editor = true))
      assertEquals(ControllerKeyDisposition.PASS, state.keyDown(7, 1, action, true, false, 1))
      assertFalse(state.keyUp(7, 1))
      assertEquals(ControllerKeyDisposition.DISPATCH, state.down(1, action, editor = true, selection = true))
    }
  }

  @Test fun anExistingRepeatStopsWhenCrossEntersAnEditor() {
    val state = state()
    state.down(1, "down")
    val generation = state.generation
    assertTrue(state.canRepeat(generation))
    assertFalse(state.canRepeat(generation, editor = true))
    assertTrue(state.canRepeat(generation, editor = true, selection = true))
  }

  @Test fun decisionsStaySingleEdgeAndOtherDevicesCannotReleaseTheOwner() {
    val state = state()
    assertEquals(ControllerKeyDisposition.DISPATCH, state.down(1, "activate"))
    state.scopeChanged()
    assertFalse(state.keyUp(8, 1))
    assertEquals(ControllerKeyDisposition.CONSUME, state.down(1, "activate"))
    state.keyUp(7, 1)
    assertEquals(ControllerKeyDisposition.DISPATCH, state.down(1, "activate"))
  }
}
