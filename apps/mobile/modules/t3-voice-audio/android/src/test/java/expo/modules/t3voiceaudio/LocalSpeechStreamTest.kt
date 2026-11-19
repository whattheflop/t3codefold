package expo.modules.t3voiceaudio

import org.junit.Assert.*
import androidx.core.telecom.CallEndpointCompat
import org.junit.Test
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.channels.Channel

class LocalSpeechStreamTest {
  private open class Engine : SpeechEngine {
    var frames = 0
    var total = 0L
    var maximum = 0
    var resets = 0
    var incomplete = false
    var closed = false
    var closes = 0
    var ends = 0
    override fun begin() {}
    override fun add(samples: FloatArray) { frames += samples.size; total += samples.size; maximum = maxOf(maximum, frames) }
    override fun phrases(final: Boolean) = listOf(SpeechPhrase(1, "recognized phrase", !incomplete || final))
    override fun end() { ++ends }
    override fun reset() { frames = 0; ++resets }
    override fun close() { closed = true; ++closes }
  }
  @Test fun longSessionsRetireHistoryWithoutDroppingAudio() {
    val engine = Engine()
    LocalSpeechStream(engine).use { speech -> repeat(45 * 60 * 10) { speech.accept(FloatArray(1600)) } }
    assertEquals(45L * 60 * 16000, engine.total)
    assertTrue(engine.maximum <= 480000)
    assertTrue(engine.resets >= 90)
    assertTrue(engine.closed)
  }
  @Test fun continuousSpeechHasABoundedDecoderAndFlushesOnce() {
    val engine = Engine().also { it.incomplete = true }
    LocalSpeechStream(engine).use { speech ->
      val phrases = (0 until 600).flatMap { speech.accept(FloatArray(1600)) }
      assertEquals(listOf("recognized phrase"), phrases)
      assertEquals(1, engine.resets)
      assertTrue(engine.maximum <= 960000)
    }
  }
  @Test fun partialSpeechIsNotInsertedUntilFinishedAndFinalsAreDeduplicated() {
    val engine = Engine().also { it.incomplete = true }
    LocalSpeechStream(engine).use { speech ->
      assertTrue(speech.accept(FloatArray(8000)).isEmpty())
      engine.incomplete = false
      assertEquals(listOf("recognized phrase"), speech.accept(FloatArray(8000)))
      assertTrue(speech.accept(FloatArray(8000)).isEmpty())
      assertTrue(speech.finish().isEmpty())
    }
  }
  @Test fun closedStreamsNeverReachTheNativeEngineAgain() {
    val engine = Engine()
    val speech = LocalSpeechStream(engine)
    speech.close()
    speech.close()
    assertEquals(1, engine.closes)
    assertThrows(IllegalStateException::class.java) { speech.accept(FloatArray(1600)) }
    assertThrows(IllegalStateException::class.java) { speech.finish() }
    assertEquals(0L, engine.total)
    assertEquals(0, engine.ends)
  }
  @Test fun finishedStreamsDoNotStopTwiceOrAcceptMoreAudio() {
    val engine = Engine()
    LocalSpeechStream(engine).use { speech ->
      assertEquals(listOf("recognized phrase"), speech.finish())
      assertTrue(speech.finish().isEmpty())
      assertEquals(1, engine.ends)
      assertThrows(IllegalStateException::class.java) { speech.accept(FloatArray(1600)) }
      assertEquals(0L, engine.total)
    }
  }
  @Test fun invalidPcmIsRejectedBeforeNativeInference() {
    val engine = Engine()
    LocalSpeechStream(engine).use { speech ->
      for (audio in listOf(floatArrayOf(Float.NaN), floatArrayOf(Float.POSITIVE_INFINITY), floatArrayOf(1.01f), floatArrayOf(-1.01f), FloatArray(16001))) {
        assertThrows(IllegalArgumentException::class.java) { speech.accept(audio) }
      }
      assertTrue(speech.accept(FloatArray(0)).isEmpty())
      assertEquals(0L, engine.total)
      speech.accept(floatArrayOf(-1f, 0f, 1f))
      assertEquals(3L, engine.total)
    }
  }
  @Test fun failedNativeStartupPreservesTheFailureAndReleasesTheEngine() {
    val failure = UnsatisfiedLinkError("unavailable JNI symbol")
    val cleanupFailure = IllegalStateException("cleanup failed")
    val engine = object : Engine() {
      override fun begin() { throw failure }
      override fun close() { super.close(); throw cleanupFailure }
    }
    val caught = assertThrows(UnsatisfiedLinkError::class.java) { LocalSpeechStream(engine) }
    assertSame(failure, caught)
    assertEquals(listOf(cleanupFailure), caught.suppressed.toList())
    assertEquals(1, engine.closes)
  }
  @Test fun failedCloseStillRetiresNativeOwnership() {
    val engine = object : Engine() {
      override fun close() { super.close(); throw OutOfMemoryError("native allocation failed") }
    }
    val speech = LocalSpeechStream(engine)
    assertThrows(OutOfMemoryError::class.java) { speech.close() }
    speech.close()
    assertEquals(1, engine.closes)
    assertThrows(IllegalStateException::class.java) { speech.accept(FloatArray(1600)) }
  }
  @Test fun decoderContainsJvmNativeFailuresAndPublishesOnlyAfterCleanup() = runBlocking {
    for (failure in listOf(UnsatisfiedLinkError("missing native symbol"), OutOfMemoryError("model allocation"))) {
      val cleanup = IllegalStateException("native close failure")
      val engine = object : Engine() {
        override fun add(samples: FloatArray) { throw failure }
        override fun close() { super.close(); throw cleanup }
      }
      val chunks = Channel<FloatArray>(1)
      chunks.trySend(FloatArray(1600))
      chunks.close()
      val result = decodeSpeech(LocalSpeechStream(engine), chunks, { true }, { true }, {})
      assertSame(failure, result.exceptionOrNull())
      assertEquals(listOf(cleanup), failure.suppressed.toList())
      assertEquals(1, engine.closes)
    }
  }
  @Test fun decoderReportsCleanupFailureInsteadOfLettingItEscapeItsWorker() = runBlocking {
    val failure = UnsatisfiedLinkError("native free symbol")
    val engine = object : Engine() {
      override fun close() { super.close(); throw failure }
    }
    val chunks = Channel<FloatArray>(1)
    chunks.close()
    val result = decodeSpeech(LocalSpeechStream(engine), chunks, { true }, { false }, {})
    assertSame(failure, result.exceptionOrNull())
    assertEquals(1, engine.closes)
  }
  @Test fun decoderDiscardsQueuedAudioAndLatePhrasesOnCancel() = runBlocking {
    var recording = true
    val engine = object : Engine() {
      override fun add(samples: FloatArray) { super.add(samples); recording = false }
    }
    val chunks = Channel<FloatArray>(2)
    chunks.trySend(FloatArray(8000))
    chunks.trySend(FloatArray(8000))
    chunks.close()
    val phrases = mutableListOf<String>()
    val result = decodeSpeech(LocalSpeechStream(engine), chunks, { recording }, { false }, { phrases.add(it) })
    assertTrue(result.getOrThrow().isEmpty())
    assertTrue(phrases.isEmpty())
    assertEquals(8000L, engine.total)
    assertEquals(0, engine.ends)
    assertEquals(1, engine.closes)
  }
  @Test fun wiredHeadsetsAcceptTheirMicrophonesWithoutAcceptingPhoneFallback() {
    assertTrue(LocalDictationCapture.acceptsInput(CallEndpointCompat.TYPE_WIRED_HEADSET, 3, "", ""))
    assertTrue(LocalDictationCapture.acceptsInput(CallEndpointCompat.TYPE_WIRED_HEADSET, 22, "", ""))
    assertTrue(LocalDictationCapture.acceptsInput(CallEndpointCompat.TYPE_WIRED_HEADSET, 11, "", ""))
    assertFalse(LocalDictationCapture.acceptsInput(CallEndpointCompat.TYPE_WIRED_HEADSET, 15, "", ""))
  }
  @Test fun bluetoothCaptureRejectsPhoneOrDifferentHeadsetFallback() {
    assertFalse(LocalDictationCapture.acceptsInput(CallEndpointCompat.TYPE_BLUETOOTH, 15, "", "glasses"))
    assertFalse(LocalDictationCapture.acceptsInput(CallEndpointCompat.TYPE_BLUETOOTH, 7, "other", "glasses"))
    assertTrue(LocalDictationCapture.acceptsInput(CallEndpointCompat.TYPE_BLUETOOTH, 7, "glasses", "glasses"))
    assertTrue(LocalDictationCapture.acceptsInput(CallEndpointCompat.TYPE_BLUETOOTH, 26, "glasses", "glasses"))
    assertTrue(LocalDictationCapture.acceptsInput(CallEndpointCompat.TYPE_SPEAKER, 15, "", ""))
    assertFalse(LocalDictationCapture.acceptsInput(CallEndpointCompat.TYPE_SPEAKER, 7, "glasses", "glasses"))
  }
}
