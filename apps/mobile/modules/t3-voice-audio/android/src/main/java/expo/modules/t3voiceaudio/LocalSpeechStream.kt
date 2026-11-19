package expo.modules.t3voiceaudio

import ai.moonshine.voice.JNI
import ai.moonshine.voice.TranscriberOption
import java.io.Closeable

internal data class SpeechPhrase(val id: Long, val text: String, val complete: Boolean)

internal interface SpeechEngine : Closeable {
  fun begin()
  fun add(samples: FloatArray)
  fun phrases(final: Boolean): List<SpeechPhrase>
  fun end()
  fun reset()
}

/** Decoder state is retired without stopping microphone capture. Only final phrases leave JNI. */
internal class LocalSpeechStream(private val engine: SpeechEngine) : Closeable {
  private val emitted = mutableSetOf<Long>()
  private var samples = 0
  private var pendingSamples = 0
  private var cadence = 8000
  private var closed = false
  private var finished = false
  init {
    try { engine.begin() } catch (error: Throwable) {
      try { engine.close() } catch (cleanup: Throwable) { if (cleanup !== error) error.addSuppressed(cleanup) }
      throw error
    }
  }

  @Synchronized fun accept(audio: FloatArray): List<String> {
    check(!closed && !finished) { "The speech decoder is no longer recording." }
    require(audio.size <= 16000 && audio.all { it.isFinite() && it in -1f..1f }) { "Invalid microphone PCM." }
    if (audio.isEmpty()) return emptyList()
    engine.add(audio)
    samples += audio.size
    pendingSamples += audio.size
    if (pendingSamples < cadence) return emptyList()
    pendingSamples = 0
    val began = System.nanoTime()
    val phrases = engine.phrases(false)
    val result = collect(phrases, false)
    cadence = ((System.nanoTime() - began) / 1e9 * 16000).toInt().coerceIn(8000, 32000)
    val midPhrase = phrases.any { !it.complete && it.text.isNotBlank() }
    if (samples >= 480000 && (!midPhrase || samples >= 960000)) {
      val final = finish()
      engine.reset()
      emitted.clear()
      samples = 0
      pendingSamples = 0
      engine.begin()
      finished = false
      return result + final
    }
    return result
  }
  @Synchronized fun finish(): List<String> {
    check(!closed) { "The speech decoder is closed." }
    if (finished) return emptyList()
    finished = true
    engine.end()
    return collect(engine.phrases(true), true)
  }
  private fun collect(phrases: List<SpeechPhrase>, final: Boolean) = phrases.mapNotNull {
    val text = it.text.trim()
    if (text.isNotEmpty() && (final || it.complete) && emitted.add(it.id)) text else null
  }
  @Synchronized override fun close() {
    if (closed) return
    closed = true
    engine.close()
  }
}

internal class MoonshineEngine(directory: String, architecture: Int) : SpeechEngine {
  private var model = -1
  private var stream = -1
  init {
    JNI.ensureLibraryLoaded()
    model = JNI.moonshineLoadTranscriberFromFiles(directory, architecture, arrayOf(
      TranscriberOption("return_audio_data", "false"),
      TranscriberOption("identify_speakers", "false"),
      TranscriberOption("log_output_text", "false"),
      TranscriberOption("vad_max_segment_duration", "15")
    ))
    check(model >= 0) { "Could not load the speech model. Remove it in dictation setup and download again." }
    try { reset() } catch (error: Throwable) {
      try { close() } catch (cleanup: Throwable) { if (cleanup !== error) error.addSuppressed(cleanup) }
      throw error
    }
  }
  override fun begin() { checkOpen(); checkResult(JNI.moonshineStartStream(model, stream)) }
  override fun add(samples: FloatArray) { checkOpen(); checkResult(JNI.moonshineAddAudioToStream(model, stream, samples, 16000, 0)) }
  override fun end() { checkOpen(); checkResult(JNI.moonshineStopStream(model, stream)) }
  override fun reset() {
    check(model >= 0) { "The speech model is closed." }
    val previous = stream
    stream = -1
    if (previous >= 0) checkResult(JNI.moonshineFreeStream(model, previous))
    stream = JNI.moonshineCreateStream(model, 0)
    check(stream >= 0) { "Could not create a speech decoder." }
  }
  override fun phrases(final: Boolean): List<SpeechPhrase> {
    checkOpen()
    val transcript = checkNotNull(JNI.moonshineTranscribeStream(model, stream, if (final) JNI.MOONSHINE_FLAG_FORCE_UPDATE else 0)) { "Speech recognition failed." }
    return transcript.lines.orEmpty().map { SpeechPhrase(it.id, it.text.orEmpty(), it.isComplete) }
  }
  override fun close() {
    val ownedModel = model
    val ownedStream = stream
    model = -1
    stream = -1
    try {
      if (ownedStream >= 0 && ownedModel >= 0) checkResult(JNI.moonshineFreeStream(ownedModel, ownedStream))
    } finally {
      if (ownedModel >= 0) JNI.moonshineFreeTranscriber(ownedModel)
    }
  }
  private fun checkOpen() { check(model >= 0 && stream >= 0) { "The speech decoder is closed." } }
  private fun checkResult(code: Int) { check(code >= 0) { JNI.moonshineErrorToString(code) } }
}
