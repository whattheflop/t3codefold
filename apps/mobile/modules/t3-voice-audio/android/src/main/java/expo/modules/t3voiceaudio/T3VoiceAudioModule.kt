package expo.modules.t3voiceaudio

import android.app.AlertDialog
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.app.Service
import ai.moonshine.voice.AssetDownloader
import ai.moonshine.voice.ModelSpec
import java.io.File
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.telecom.DisconnectCause
import androidx.core.telecom.CallAttributesCompat
import androidx.core.telecom.CallControlResult
import androidx.core.telecom.CallControlScope
import androidx.core.telecom.CallEndpointCompat
import androidx.core.telecom.CallsManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class T3VoiceAudioModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private var call: CallControlScope? = null
  private var callJob: Job? = null
  // Core-Telecom exposes channel-backed flows: collect each once, then retain
  // state so route selection and the UI cannot consume each other's updates.
  private val currentEndpointId = MutableStateFlow<String?>(null)
  private val endpoints = MutableStateFlow(emptyList<CallEndpointCompat>())
  private var previousVolumeStream: Int? = null
  private var dictationStartJob: Job? = null
  private var dictation: LocalDictationCapture? = null
  private val dictationMutex = Mutex()
  private val recordingDiagnostics get() = RecordingDiagnostics(context)
  private val dictationPreferences get() = context.getSharedPreferences("local-dictation", 0)
  private fun modelDirectory(arch: Int) = File(context.noBackupFilesDir, "speech/en-$arch")
  private val context get() = requireNotNull(appContext.reactContext)
  private val audio get() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  override fun definition() = ModuleDefinition {
    Name("T3VoiceAudio")
    Events("endCall", "audioRoute", "systemMute", "dictationPhrase", "dictationMeter", "dictationError", "dictationPreparation")
    OnCreate { VoiceCallService.endCall = { sendEvent("endCall") } }
    Function("getDictationSettings") {
      val arch = dictationPreferences.getInt("architecture", 4)
      mapOf("configured" to dictationPreferences.getBoolean("configured", false),
        "bluetooth" to dictationPreferences.getBoolean("bluetooth", true),
        "architecture" to arch, "ready" to File(modelDirectory(arch), "installed").isFile)
    }
    AsyncFunction("getLocalCrashDiagnostics") { recordingDiagnostics.records() }
    AsyncFunction("configureDictation") { promise: Promise -> configureDictation(promise) }
    AsyncFunction("startDictation") { allowDownload: Boolean, promise: Promise ->
      scope.launch {
        if (dictationStartJob != null || dictation != null || callJob != null) {
          promise.reject("LOCAL_DICTATION", "End other voice sessions before dictating.", null)
        } else {
          val starting = scope.launch(start = CoroutineStart.LAZY) {
            try {
              dictationMutex.withLock { startLocalDictation(allowDownload) }
              promise.resolve(null)
            } catch (error: Throwable) {
              try {
                withContext(NonCancellable) { dictationMutex.withLock { stopLocalDictation(false) } }
              } catch (_: Throwable) { /* Preserve the startup failure after releasing owned audio. */ }
              recordingDiagnostics.stage("startup-failed", failure = error)
              promise.reject("LOCAL_DICTATION", error.message, error)
            } finally { dictationStartJob = null }
          }
          dictationStartJob = starting
          starting.start()
        }
      }
    }
    AsyncFunction("stopDictation") { flush: Boolean, promise: Promise ->
      perform(promise) {
        dictationStartJob?.cancelAndJoin()
        dictationMutex.withLock { stopLocalDictation(flush) }
      }
    }
    AsyncFunction("cancelDictation") { promise: Promise ->
      perform(promise) {
        dictationStartJob?.cancelAndJoin()
        dictationMutex.withLock { stopLocalDictation(false) }
        null
      }
    }
    AsyncFunction("start") { promise: Promise ->
      perform(promise) {
        start()
        false
      }
    }
    AsyncFunction("connected") { promise: Promise ->
      perform(promise) {
        check(call?.setActive() is CallControlResult.Success) {
          "Android could not activate call audio."
        }
        // Telecom owns audio focus and Bluetooth HFP/LE routes. Never compete with
        // it using AudioManager.setCommunicationDevice or startBluetoothSco.
        val preferred = endpoints.value.firstOrNull { it.type == CallEndpointCompat.TYPE_BLUETOOTH }
          ?: endpoints.value.firstOrNull { it.type == CallEndpointCompat.TYPE_WIRED_HEADSET }
          ?: endpoints.value.firstOrNull { it.type == CallEndpointCompat.TYPE_SPEAKER }
        if (preferred !=
          null
        ) {
          check(call?.requestEndpointChange(preferred) is CallControlResult.Success) {
            "Could not select call audio output."
          }
        }
        null
      }
    }
    AsyncFunction("chooseEndpoint") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("VOICE_AUDIO", "Open T3 to choose call audio.", null)
      } else {
        activity.runOnUiThread {
          val choices = endpoints.value.toList()
          AlertDialog.Builder(activity)
            .setTitle("Call audio output")
            .setSingleChoiceItems(
              choices.map {
                it.name.toString()
              }.toTypedArray(),
              choices.indexOfFirst {
                it.identifier.toString() ==
                  currentEndpointId.value
              }
            ) { dialog, index ->
              dialog.dismiss()
              perform(promise) {
                check(call?.requestEndpointChange(choices[index]) is CallControlResult.Success) {
                  "Requested call audio output is unavailable."
                }
                null
              }
            }
            .setNegativeButton("Cancel") { _, _ -> promise.resolve(null) }
            .setOnCancelListener { promise.resolve(null) }
            .show()
        }
      }
    }
    Function("volumeUp") {
      increaseVolume()
    }
    AsyncFunction("stop") { promise: Promise ->
      perform(promise) {
        stop()
        null
      }
    }
    OnDestroy {
      scope.launch {
        try {
          dictationStartJob?.cancelAndJoin()
          dictationMutex.withLock { stopLocalDictation(false) }
        } catch (error: Throwable) {
          runCatching { recordingDiagnostics.stage("stop-failed", failure = error) }
        } finally {
          try { stop() }
          catch (error: Throwable) { runCatching { recordingDiagnostics.stage("stop-failed", failure = error) } }
          finally { scope.cancel() }
        }
      }
      VoiceCallService.endCall = null
    }
  }

  private fun configureDictation(promise: Promise) {
    val activity = appContext.currentActivity
    if (activity == null || callJob != null || dictationStartJob != null) {
      promise.reject("LOCAL_DICTATION", "Open T3 and end voice sessions before changing dictation settings.", null)
      return
    }
    activity.runOnUiThread {
      AlertDialog.Builder(activity).setTitle("On-device English dictation")
        .setItems(arrayOf("Tiny · 43 MB · fastest", "Small · 136 MB · recommended", "Medium · 257 MB", "Remove downloaded models", "Model and runtime licenses")) { _, index ->
          if (index == 3) {
            perform(promise) {
              dictationMutex.withLock {
                check(dictation == null) { "Stop dictation before removing models." }
                withContext(Dispatchers.IO) { File(context.noBackupFilesDir, "speech").deleteRecursively() }
              }
              null
            }
          } else if (index == 4) {
            AlertDialog.Builder(activity).setTitle("Speech licenses")
              .setMessage(context.assets.open("dictation-notices.txt").bufferedReader().use { it.readText() })
              .setPositiveButton("Close") { _, _ -> promise.resolve(null) }.setOnCancelListener { promise.resolve(null) }.show()
          } else {
            val arch = intArrayOf(2, 4, 5)[index]
            AlertDialog.Builder(activity).setTitle("Dictation microphone")
              .setMessage("Use a Bluetooth or wired headset when connected, or the phone microphone otherwise. Bluetooth uses call audio without placing a phone call. Enable Calls for your headset in Android Bluetooth settings.")
              .setPositiveButton("Headset when connected") { _, _ -> saveDictationSettings(arch, true); promise.resolve(null) }
              .setNeutralButton("Phone microphone") { _, _ -> saveDictationSettings(arch, false); promise.resolve(null) }
              .setNegativeButton("Cancel") { _, _ -> promise.reject("LOCAL_DICTATION", "Setup canceled.", null) }
              .setOnCancelListener { promise.reject("LOCAL_DICTATION", "Setup canceled.", null) }.show()
          }
        }.setNegativeButton("Cancel") { _, _ -> promise.reject("LOCAL_DICTATION", "Setup canceled.", null) }
        .setOnCancelListener { promise.reject("LOCAL_DICTATION", "Setup canceled.", null) }.show()
    }
  }

  private fun saveDictationSettings(arch: Int, bluetooth: Boolean) {
    dictationPreferences.edit().putInt("architecture", arch).putBoolean("bluetooth", bluetooth).putBoolean("configured", true).apply()
  }

  private suspend fun startLocalDictation(allowDownload: Boolean) {
    check(appContext.currentActivity != null) { "Start dictation with T3 in the foreground." }
    val arch = dictationPreferences.getInt("architecture", 4)
    val bluetooth = dictationPreferences.getBoolean("bluetooth", true)
    recordingDiagnostics.stage("preparing", arch)
    val directory = modelDirectory(arch)
    if (!File(directory, "installed").isFile) {
      check(allowDownload) { "The speech model was removed. Start dictation again to download it." }
      runInterruptible(Dispatchers.IO) {
        var lastFile = -1
        AssetDownloader().ensureModelPresent(directory, ModelSpec.stt("en", arch, false), AssetDownloader.ProgressListener { _, index, total, _, _ ->
          if (index != lastFile) {
            lastFile = index
            sendEvent("dictationPreparation", mapOf("message" to "Downloading speech model · file $index/$total"))
          }
        })
        File(directory, "installed").writeText("moonshine-voice:0.1.6\n")
      }
    }
    kotlinx.coroutines.currentCoroutineContext().ensureActive()
    check(appContext.currentActivity != null) { "Return to T3 before starting dictation." }
    check(audio.mode == AudioManager.MODE_NORMAL) { "End other voice calls before starting dictation." }
    sendEvent("dictationPreparation", mapOf("message" to "Connecting call microphone"))
    start("On-device dictation")
    val activeCall = checkNotNull(call)
    check(activeCall.setActive() is CallControlResult.Success) { "Android could not activate call audio." }
    val available = withTimeout(10000) { endpoints.first { it.isNotEmpty() } }
    val selected = (if (bluetooth) available.firstOrNull { it.type == CallEndpointCompat.TYPE_BLUETOOTH }
      ?: available.firstOrNull { it.type == CallEndpointCompat.TYPE_WIRED_HEADSET } else null)
      ?: available.firstOrNull { it.type == CallEndpointCompat.TYPE_SPEAKER }
      ?: available.firstOrNull { it.type == CallEndpointCompat.TYPE_EARPIECE }
    check(selected != null) { "No microphone is available. Reconnect your headset or try the phone microphone." }
    check(activeCall.requestEndpointChange(selected) is CallControlResult.Success) { "Android refused the selected call microphone." }
    withTimeout(10000) { currentEndpointId.first { it == selected.identifier.toString() } }
    var speech: LocalSpeechStream? = null
    try {
      sendEvent("dictationPreparation", mapOf("message" to "Loading on-device speech model"))
      recordingDiagnostics.stage("loading-model", arch)
      withContext(Dispatchers.IO) { speech = LocalSpeechStream(MoonshineEngine(directory.absolutePath, arch)) }
      kotlinx.coroutines.currentCoroutineContext().ensureActive()
      val capture = LocalDictationCapture(audio, selected.type, checkNotNull(speech),
        phrase = { sendEvent("dictationPhrase", mapOf("text" to it)) },
        meter = { decibels, duration -> sendEvent("dictationMeter", mapOf("decibels" to decibels, "durationMillis" to duration)) },
        failed = { error ->
          try {
            recordingDiagnostics.stage("recording-failed", failure = error)
            sendEvent("dictationError", mapOf("message" to (error.message ?: "Dictation failed.")))
          } finally {
            scope.launch {
              try { dictationMutex.withLock { stopLocalDictation(false) } }
              catch (cleanup: Throwable) { recordingDiagnostics.stage("stop-failed", failure = cleanup) }
            }
          }
        })
      dictation = capture
      capture.start()
      recordingDiagnostics.stage("recording", arch)
    } catch (error: Throwable) {
      if (dictation == null) {
        try { speech?.close() } catch (cleanup: Throwable) { if (cleanup !== error) error.addSuppressed(cleanup) }
      }
      throw error
    }
  }

  private suspend fun stopLocalDictation(flush: Boolean): List<String> {
    val capture = dictation
    dictation = null
    return try {
      if (capture != null) recordingDiagnostics.stage(if (flush) "finishing" else "canceling")
      val phrases = capture?.stop(flush) ?: emptyList()
      if (capture != null) recordingDiagnostics.stage(if (flush) "finished" else "canceled")
      phrases
    } catch (error: Throwable) {
      recordingDiagnostics.stage("stop-failed", failure = error)
      throw error
    }
    finally { if (capture != null || VoiceCallService.title == "On-device dictation") stop() }
  }

  // Telecom failures are reported to the JavaScript caller or the end-call event.
  @Suppress("TooGenericExceptionCaught")
  private suspend fun start(title: String = "Codex") {
    check(callJob == null) { "A voice call is already active." }
    val activity =
      requireNotNull(appContext.currentActivity) { "Start voice with T3 in the foreground." }
    previousVolumeStream = activity.volumeControlStream
    activity.volumeControlStream = AudioManager.STREAM_VOICE_CALL
    val manager = CallsManager(context)
    manager.registerAppWithTelecom(CallsManager.CAPABILITY_BASELINE)
    val ready = CompletableDeferred<Unit>()
    VoiceCallService.title = title
    context.startForegroundService(Intent(context, VoiceCallService::class.java))
    callJob = scope.launch {
      try {
        manager.addCall(
          CallAttributesCompat(
            title,
            Uri.parse(if (title == "Codex") "t3code:codex" else "t3code:dictation"),
            CallAttributesCompat.DIRECTION_OUTGOING,
            callCapabilities = 0
          ),
          onAnswer = { throw IllegalStateException("This is an outgoing call.") },
          onDisconnect = { sendEvent("endCall") },
          onSetActive = {},
          onSetInactive = { sendEvent("endCall") }
        ) {
          call = this
          launch {
            currentCallEndpoint.collect { endpoint ->
              currentEndpointId.value = endpoint.identifier.toString()
              sendEvent(
                "audioRoute",
                mapOf(
                  "name" to endpoint.name.toString(),
                  "speaker" to (endpoint.type == CallEndpointCompat.TYPE_SPEAKER)
                )
              )
            }
          }
          launch { availableEndpoints.collect { endpoints.value = it } }
          launch { isMuted.collect { sendEvent("systemMute", mapOf("muted" to it)) } }
          ready.complete(Unit)
        }
      } catch (error: CancellationException) {
        if (!ready.isCompleted) ready.completeExceptionally(error)
      } catch (error: Throwable) {
        if (!ready.isCompleted) {
          ready.completeExceptionally(error)
        } else {
          sendEvent("endCall")
        }
      }
    }
    withTimeout(15_000) { ready.await() }
  }

  // Promise rejection is the error boundary for every native voice operation.
  @Suppress("TooGenericExceptionCaught")
  private fun perform(promise: Promise, work: suspend () -> Any?) {
    scope.launch {
      try {
        promise.resolve(work())
      } catch (
        error: Throwable
      ) {
        promise.reject("VOICE_AUDIO", error.message, error)
      }
    }
  }

  private fun increaseVolume() {
    audio.adjustStreamVolume(
      AudioManager.STREAM_VOICE_CALL,
      AudioManager.ADJUST_RAISE,
      AudioManager.FLAG_SHOW_UI
    )
  }

  private suspend fun stop() {
    try {
      call?.disconnect(DisconnectCause(DisconnectCause.LOCAL))
    } finally {
      try { callJob?.cancelAndJoin() }
      finally {
        call = null
        callJob = null
        endpoints.value = emptyList()
        currentEndpointId.value = null
        previousVolumeStream?.let { appContext.currentActivity?.volumeControlStream = it }
        previousVolumeStream = null
        context.stopService(Intent(context, VoiceCallService::class.java))
        VoiceCallService.title = "Codex"
      }
    }
  }
}

class VoiceCallService : Service() {
  companion object {
    var endCall: (() -> Unit)? = null
    var title = "Codex"
  }
  private var wakeLock: PowerManager.WakeLock? = null
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onCreate() {
    super.onCreate()
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel("codex-voice", "Codex voice calls", NotificationManager.IMPORTANCE_LOW)
    )
    val open = packageManager.getLaunchIntentForPackage(packageName)
    val end = PendingIntent.getService(
      this,
      1,
      Intent(this, VoiceCallService::class.java).setAction("end"),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    val notification = Notification.Builder(this, "codex-voice")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentTitle("$title is active")
      .setContentText("Microphone in use. Tap to return to T3.")
      .setOngoing(true)
      .setCategory(Notification.CATEGORY_CALL)
    if (Build.VERSION.SDK_INT >= 31) {
      notification.setStyle(
        Notification.CallStyle.forOngoingCall(Person.Builder().setName(title).build(), end)
      )
    } else {
      notification.addAction(Notification.Action.Builder(null, "End call", end).build())
    }
    if (open !=
      null
    ) {
      notification.setContentIntent(
        PendingIntent.getActivity(
          this,
          0,
          open,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
      )
    }
    startForeground(3774, notification.build())
    wakeLock =
      (
        getSystemService(
          Context.POWER_SERVICE
        ) as PowerManager
        ).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "t3:voice").also {
        it.acquire()
      }
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == "end") endCall?.invoke()
    return START_NOT_STICKY
  }
  override fun onDestroy() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }
}
