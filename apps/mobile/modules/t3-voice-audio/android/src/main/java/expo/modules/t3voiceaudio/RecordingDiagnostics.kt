package expo.modules.t3voiceaudio

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Process
import android.system.Os
import android.system.OsConstants

internal class RecordingDiagnostics(private val context: Context) {
  private val preferences = context.getSharedPreferences("recording-diagnostics", 0)

  fun stage(value: String, architecture: Int? = null, failure: Throwable? = null) {
    val editor = preferences.edit()
      .putLong("timestamp", System.currentTimeMillis())
      .putInt("pid", Process.myPid())
      .putString("stage", value)
    val previousPid = preferences.getInt("pid", -1)
    if (previousPid != -1 && previousPid != Process.myPid()) {
      editor.putInt("previousPid", previousPid)
        .putString("previousStage", preferences.getString("stage", "unknown"))
        .putInt("previousArchitecture", preferences.getInt("architecture", -1))
    }
    if (architecture != null) editor.putInt("architecture", architecture)
    if (failure != null) {
      editor.putLong("failureTimestamp", System.currentTimeMillis())
        .putString("failure", "${failure.javaClass.simpleName}: ${failure.message.orEmpty().take(500)}")
        .putString("frames", failure.stackTrace.take(12).joinToString("\n"))
    }
    // Persist before JNI: a native signal cannot run a JavaScript or JVM error handler.
    editor.commit()
  }

  fun records(): List<Map<String, Any>> {
    val records = mutableListOf<Map<String, Any>>()
    val lastPid = preferences.getInt("pid", -1)
    val stage = preferences.getString("stage", "unknown").orEmpty()
    val architecture = preferences.getInt("architecture", -1)
    val soc = if (Build.VERSION.SDK_INT >= 31) "; ${Build.SOC_MANUFACTURER} ${Build.SOC_MODEL}" else ""
    val pageSize = runCatching { Os.sysconf(OsConstants._SC_PAGESIZE) }.getOrNull()
    val device = "${Build.MANUFACTURER} ${Build.MODEL}; Android ${Build.VERSION.RELEASE}; ${Build.SUPPORTED_ABIS.joinToString()}$soc\nCurrent speech runtime: Moonshine 0.1.6 / ONNX 1.25.1; page size: $pageSize"
    val lastStage = "Last recording stage: $stage; model architecture: $architecture"
    val failure = preferences.getString("failure", null)
    if (failure != null) records.add(mapOf(
      "timestamp" to preferences.getLong("failureTimestamp", 0),
      "description" to "On-device dictation failed: $failure",
      "detail" to "$device\n$lastStage\n$failure\n${preferences.getString("frames", "")}",
    ))
    if (Build.VERSION.SDK_INT >= 30) {
      val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val exits = manager.getHistoricalProcessExitReasons(context.packageName, 0, 20)
      var nativeTraces = 0
      for (exit in exits) {
        if (exit.reason !in setOf(ApplicationExitInfo.REASON_CRASH, ApplicationExitInfo.REASON_CRASH_NATIVE,
            ApplicationExitInfo.REASON_ANR, ApplicationExitInfo.REASON_LOW_MEMORY, ApplicationExitInfo.REASON_SIGNALED)) continue
        val reason = when (exit.reason) {
          ApplicationExitInfo.REASON_CRASH_NATIVE -> if (exit.status == 4) "Native crash (SIGILL: illegal instruction)" else "Native crash"
          ApplicationExitInfo.REASON_CRASH -> "JVM crash"
          ApplicationExitInfo.REASON_ANR -> "App not responding"
          ApplicationExitInfo.REASON_LOW_MEMORY -> "Android stopped the app for low memory"
          else -> "Android terminated the app (signal ${exit.status})"
        }
        val recording = when (exit.pid) {
          lastPid -> "\n$lastStage"
          preferences.getInt("previousPid", -1) -> "\nLast recording stage: ${preferences.getString("previousStage", "unknown")}; model architecture: ${preferences.getInt("previousArchitecture", -1)}"
          else -> ""
        }
        val trace = if (Build.VERSION.SDK_INT >= 31 && exit.reason == ApplicationExitInfo.REASON_CRASH_NATIVE && nativeTraces++ < 3) {
          "\n${readNativeCrashTrace { exit.traceInputStream }}"
        } else ""
        records.add(mapOf(
          "timestamp" to exit.timestamp,
          "description" to reason,
          "detail" to "$device\n$reason; status ${exit.status}; pid ${exit.pid}; PSS ${exit.pss} KiB; RSS ${exit.rss} KiB\n${exit.description.orEmpty()}$recording$trace",
        ))
      }
    }
    return records.sortedByDescending { it["timestamp"] as Long }.take(20)
  }
}
