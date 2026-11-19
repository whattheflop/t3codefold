package expo.modules.t3voiceaudio

import android.annotation.SuppressLint
import androidx.core.telecom.CallEndpointCompat
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.log10
import kotlin.math.sqrt

/** The bounded PCM channel separates capture from inference; audio never reaches JavaScript or disk. */
internal class LocalDictationCapture(
  private val audio: AudioManager,
  private val endpointType: Int,
  private val speech: LocalSpeechStream,
  private val phrase: (String) -> Unit,
  private val meter: (Double, Long) -> Unit,
  private val failed: (Throwable) -> Unit
) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val chunks = Channel<FloatArray>(50) // At most five seconds of audio.
  private val running = AtomicBoolean(true)
  private val final = CompletableDeferred<List<String>>()
  private val ready = CompletableDeferred<Unit>()
  private val flush = AtomicBoolean(false)
  private var captureJob: Job? = null
  private var decoderJob: Job? = null
  private var record: AudioRecord? = null
  private val stopMutex = Mutex()
  private var stopResult: Result<List<String>>? = null

  @SuppressLint("MissingPermission") // The bridge requests runtime access before native start.
  suspend fun start() {
    try {
      val minimumBuffer = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      check(minimumBuffer > 0) { "The microphone does not support 16 kHz mono recording." }
      val recorder = AudioRecord.Builder()
        .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
        .setAudioFormat(AudioFormat.Builder().setSampleRate(16000).setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
        .setBufferSizeInBytes(maxOf(32000, minimumBuffer))
        .build()
      record = recorder
      check(recorder.state == AudioRecord.STATE_INITIALIZED) { "The call microphone could not initialize." }
      recorder.startRecording()
      check(recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Android could not start the call microphone." }
      decoderJob = scope.launch {
        val result = decodeSpeech(speech, chunks, { running.get() || flush.get() }, { flush.get() }, phrase)
        result.fold({ final.complete(it) }, { error ->
          final.completeExceptionally(error)
          if (error !is CancellationException) reportFailure(error)
        })
      }
      captureJob = scope.launch {
        try {
          val buffer = ShortArray(1600)
          var count = 0L
          var connected = false
          var connectedAddress: String? = null
          var attempts = 0
          while (running.get()) {
            ensureActive()
            val size = recorder.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING)
            if (!running.get()) break
            check(size in 1..buffer.size) { "The call microphone stopped recording." }
            val routed = recorder.routedDevice
            val selected = if (Build.VERSION.SDK_INT >= 31) audio.communicationDevice else null
            val inputAddress = if (Build.VERSION.SDK_INT >= 28) routed?.address else null
            val selectedAddress = if (Build.VERSION.SDK_INT >= 31) selected?.address else null
            val valid = acceptsInput(endpointType, routed?.type, inputAddress, if (connected) connectedAddress else selectedAddress)
            if (!valid) {
              check(!connected && ++attempts < 100) { "The selected microphone disconnected or Android changed the audio route. Reconnect your headset and try dictation again." }
              continue
            }
            if (!connected) { connected = true; connectedAddress = inputAddress }
            if (Build.VERSION.SDK_INT >= 29) {
              check(recorder.activeRecordingConfiguration?.isClientSilenced != true) { "Android silenced the microphone for another app. End other voice sessions and try again." }
            }
            val samples = FloatArray(size) { buffer[it] / 32768f }
            check(chunks.trySend(samples).isSuccess) { "The speech model cannot keep up. Choose Tiny in dictation setup." }
            ready.complete(Unit)
            count += size
            var energy = 0.0
            samples.forEach { energy += it * it }
            meter(20 * log10(sqrt(energy / size).coerceAtLeast(1e-8)), count * 1000 / 16000)
          }
        } catch (error: CancellationException) {
          if (!ready.isCompleted) ready.completeExceptionally(error)
        } catch (error: Throwable) {
          reportFailure(error)
        } finally { chunks.close() }
      }
      withTimeout(10000) { ready.await() }
    } catch (error: Throwable) {
      try { stop(false) } catch (cleanup: Throwable) { if (cleanup !== error) error.addSuppressed(cleanup) }
      throw error
    }
  }

  private fun reportFailure(error: Throwable) {
    ready.completeExceptionally(error)
    if (running.getAndSet(false)) {
      // Cleanup also runs if the event bridge is already gone or throws.
      try { failed(error) } catch (callback: Throwable) { if (callback !== error) error.addSuppressed(callback) }
      scope.launch { runCatching { stop(false) } }
    }
  }

  suspend fun stop(complete: Boolean): List<String> = withContext(NonCancellable) {
    stopMutex.withLock {
      stopResult?.let { return@withLock it.getOrThrow() }
      flush.set(complete && running.get())
      running.set(false)
      var failure: Throwable? = null
      fun cleanup(work: () -> Unit) {
        try { work() } catch (error: Throwable) {
          val previous = failure
          if (previous == null) failure = error else if (previous !== error) previous.addSuppressed(error)
        }
      }
      cleanup {
        try { record?.stop() } catch (_: IllegalStateException) { /* A failed start may never enter recording. */ }
      }
      captureJob?.join()
      if (flush.get()) chunks.close() else chunks.cancel()
      var phrases = emptyList<String>()
      try {
        if (decoderJob != null) phrases = final.await()
      } catch (error: Throwable) {
        if (error !is CancellationException) failure = error
      }
      // A coroutine timeout cannot interrupt JNI; never free its handles while it is running.
      decoderJob?.join()
      cleanup { record?.release() }
      record = null
      cleanup { speech.close() }
      scope.cancel()
      val result = failure?.let { Result.failure<List<String>>(it) } ?: Result.success(phrases)
      stopResult = result
      result.getOrThrow()
    }
  }

  companion object {
    fun acceptsInput(endpointType: Int, type: Int?, inputAddress: String?, selectedAddress: String?): Boolean {
      if (endpointType == CallEndpointCompat.TYPE_WIRED_HEADSET) {
        return type == AudioDeviceInfo.TYPE_WIRED_HEADSET || type == AudioDeviceInfo.TYPE_USB_HEADSET || type == AudioDeviceInfo.TYPE_USB_DEVICE
      }
      if (endpointType != CallEndpointCompat.TYPE_BLUETOOTH) return type == AudioDeviceInfo.TYPE_BUILTIN_MIC
      if (type != AudioDeviceInfo.TYPE_BLUETOOTH_SCO && type != AudioDeviceInfo.TYPE_BLE_HEADSET) return false
      return selectedAddress.isNullOrEmpty() || inputAddress == selectedAddress
    }
  }
}
