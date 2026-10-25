package expo.modules.t3terminal

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** One write of remote output; see terminalSurfaceOutput.ts for the contract. */
class TerminalOutputWrite : Record {
  @Field val resetId: Int = 0

  @Field val start: Int = 0

  @Field val data: String = ""
}
