package expo.modules.t3voiceaudio

import java.io.InputStream
import com.google.protobuf.CodedInputStream

internal fun readNativeCrashTrace(open: () -> InputStream?): String = try {
  val stream = open()
  if (stream == null) "Native backtrace unavailable: no longer retained by Android."
  else stream.use {
    val input = CodedInputStream.newInstance(it)
    input.setSizeLimit(4 * 1024 * 1024)
    input.setRecursionLimit(16)
    parseTombstone(input)
  }
} catch (error: Exception) {
  "Native backtrace unavailable: ${error.message.orEmpty().take(200)}"
}

// Field numbers follow Android debuggerd/proto/tombstone.proto; memory dumps are skipped.
private fun parseTombstone(input: CodedInputStream): String {
  var tid = 0
  var signal = "unknown"
  var abort = ""
  val threads = mutableMapOf<Int, NativeThread>()
  fields(input) { tag -> when (tag) {
    48 -> { tid = input.readUInt32(); true }
    82 -> { signal = message(input) { parseSignal(it) }; true }
    114 -> { abort = input.readStringRequireUtf8().take(1000); true }
    130 -> {
      val entry = message(input) { parseThreadEntry(it) }
      if (threads.size < 128 || entry.first == tid) threads[entry.first] = entry.second
      true
    }
    else -> false
  } }
  return buildString {
    append("Native signal: $signal")
    if (abort.isNotBlank()) append("\nAbort: $abort")
    val thread = threads[tid]
    append("\nCrashing thread: $tid${thread?.let { " (${it.name})" }.orEmpty()}")
    if (thread == null || thread.frames.isEmpty()) append("\nBacktrace was not retained.")
    else thread.frames.forEachIndexed { index, frame -> append("\n#${index.toString().padStart(2, '0')} $frame") }
  }.take(16 * 1024)
}

private fun parseSignal(input: CodedInputStream): String {
  var number = 0
  var name = ""
  var code = ""
  var address = 0L
  var hasAddress = false
  fields(input) { tag -> when (tag) {
    8 -> { number = input.readInt32(); true }
    18 -> { name = input.readStringRequireUtf8().take(64); true }
    34 -> { code = input.readStringRequireUtf8().take(64); true }
    64 -> { hasAddress = input.readBool(); true }
    72 -> { address = input.readUInt64(); true }
    else -> false
  } }
  return "$name ($number), $code" + if (hasAddress) ", fault 0x${java.lang.Long.toUnsignedString(address, 16)}" else ""
}

private data class NativeThread(val name: String = "", val frames: List<String> = emptyList())

private fun parseThreadEntry(input: CodedInputStream): Pair<Int, NativeThread> {
  var id = 0
  var thread = NativeThread()
  fields(input) { tag -> when (tag) {
    8 -> { id = input.readUInt32(); true }
    18 -> { thread = message(input) { parseThread(it) }; true }
    else -> false
  } }
  return id to thread
}

private fun parseThread(input: CodedInputStream): NativeThread {
  var name = ""
  val frames = mutableListOf<String>()
  fields(input) { tag -> when (tag) {
    18 -> { name = input.readStringRequireUtf8().take(256); true }
    34 -> if (frames.size < 32) { frames.add(message(input) { parseFrame(it) }); true } else false
    else -> false
  } }
  return NativeThread(name, frames)
}

private fun parseFrame(input: CodedInputStream): String {
  var pc = 0L
  var function = ""
  var offset = 0L
  var file = ""
  var build = ""
  fields(input) { tag -> when (tag) {
    8 -> { pc = input.readUInt64(); true }
    34 -> { function = input.readStringRequireUtf8().take(512); true }
    40 -> { offset = input.readUInt64(); true }
    50 -> { file = input.readStringRequireUtf8().take(512); true }
    66 -> { build = input.readStringRequireUtf8().take(128); true }
    else -> false
  } }
  return "pc ${java.lang.Long.toUnsignedString(pc, 16).padStart(16, '0')} $file" +
    (if (function.isNotBlank()) " ($function+$offset)" else "") +
    (if (build.isNotBlank()) " (BuildId: $build)" else "")
}

private fun fields(input: CodedInputStream, read: (Int) -> Boolean) {
  while (!input.isAtEnd) {
    val tag = input.readTag()
    if (tag == 0) break
    if (!read(tag) && !input.skipField(tag)) break
  }
}

private fun <T> message(input: CodedInputStream, parse: (CodedInputStream) -> T): T {
  val limit = input.pushLimit(input.readRawVarint32())
  try {
    val result = parse(input)
    check(input.bytesUntilLimit == 0) { "Truncated native crash trace" }
    return result
  } finally { input.popLimit(limit) }
}
