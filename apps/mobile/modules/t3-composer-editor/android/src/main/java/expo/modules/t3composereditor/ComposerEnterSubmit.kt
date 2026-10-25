package expo.modules.t3composereditor

/**
 * What a hardware Return press does, mirroring iOS: the plain key performs the configured
 * behavior and Ctrl/Meta performs the send (the alternate send when Return already sends).
 * Null leaves the key to EditText, which inserts a newline.
 */
internal fun composerEnterSubmit(sendOnEnter: Boolean, mod: Boolean, shift: Boolean): Boolean? =
  when {
    sendOnEnter && !mod && !shift -> false
    sendOnEnter && mod && !shift -> true
    !sendOnEnter && mod -> shift
    else -> null
  }
