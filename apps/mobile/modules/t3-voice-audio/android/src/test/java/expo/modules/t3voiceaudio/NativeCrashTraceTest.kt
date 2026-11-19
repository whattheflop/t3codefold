package expo.modules.t3voiceaudio

import java.io.ByteArrayInputStream
import java.io.IOException
import java.util.Base64
import org.junit.Assert.*
import org.junit.Test

class NativeCrashTraceTest {
  // Encoded by protoc using Android debuggerd's tombstone.proto, including unknown field 22.
  private val fixture = Base64.getDecoder().decode(
    "CAEo+D8w+T9SHggEEgZTSUdJTEwYASIKSUxMX0lMTE9QQ0ABSMDEB3IWdGVzdCBuYXRpdmUgZGlhZ25vc3RpY4IBaQj5PxJkCPk/Eg5zcGVlY2gtZGVjb2RlciJPCOjS2QMiCk1sYXNLZXJuZWwoEDIoL2RhdGEvYXBwL3QzL2xpYi9hcm02NC9saWJvbm54cnVudGltZS5zb0IQZml4dHVyZS1idWlsZC1pZLABgIAB"
  )

  @Test fun nativeTombstonesExposeTheSignalAndCrashingLibrary() {
    var closed = false
    val result = readNativeCrashTrace {
      object : ByteArrayInputStream(fixture) {
        override fun close() { closed = true; super.close() }
      }
    }
    assertTrue(result, result.contains("SIGILL") && result.contains("ILL_ILLOPC"))
    assertTrue(result, result.contains("8185") && result.contains("speech-decoder"))
    assertTrue(result, result.contains("libonnxruntime.so") && result.contains("MlasKernel+16"))
    assertTrue(result, result.contains("fixture-build-id"))
    assertTrue(closed)
  }

  @Test fun missingAndUnreadableTracesExplainWhyWithoutLosingTheExitRecord() {
    assertTrue(readNativeCrashTrace { null }.contains("no longer retained"))
    assertTrue(readNativeCrashTrace { throw IOException("trace expired") }.contains("trace expired"))
    assertTrue(readNativeCrashTrace { ByteArrayInputStream(fixture.copyOf(15)) }.contains("unavailable"))
  }

  @Test fun oversizedNativeTracesAreBoundedAndClosed() {
    var closed = false
    val oversized = byteArrayOf(0x8a.toByte(), 0x06, 0xff.toByte(), 0xff.toByte(), 0xff.toByte(), 0x7f)
    val result = readNativeCrashTrace {
      object : ByteArrayInputStream(oversized) {
        override fun close() { closed = true; super.close() }
      }
    }
    assertTrue(result, result.contains("unavailable"))
    assertTrue(closed)
  }
}
