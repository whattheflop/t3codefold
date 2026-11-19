package expo.modules.t3voiceaudio

import kotlinx.coroutines.channels.ReceiveChannel

internal suspend fun decodeSpeech(
  speech: LocalSpeechStream,
  chunks: ReceiveChannel<FloatArray>,
  shouldDecode: () -> Boolean,
  flush: () -> Boolean,
  phrase: (String) -> Unit
): Result<List<String>> {
  // JVM errors from JNI and close must become a result before the worker publishes completion.
  return runCatching {
    speech.use {
      for (chunk in chunks) {
        if (!shouldDecode()) break
        val phrases = speech.accept(chunk)
        if (shouldDecode()) phrases.forEach(phrase)
      }
      if (flush()) speech.finish() else emptyList()
    }
  }
}
