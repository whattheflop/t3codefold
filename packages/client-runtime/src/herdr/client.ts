import * as Schema from "effect/Schema";
import { Hello, type CoreHello } from "./protocol.ts";

export type CoreMethod =
  | "hello"
  | "terminal.list"
  | "terminal.get"
  | "terminal.send"
  | "terminal.interrupt"
  | "file.read"
  | "doc.get"
  | "machine.exec";
export type CoreTransport = (
  method: CoreMethod,
  params: Record<string, unknown>,
) => Promise<unknown>;
const decodeHello = Schema.decodeUnknownSync(Hello);
export class CoreDeliveryUnknown extends Schema.TaggedError<CoreDeliveryUnknown>()(
  "CoreDeliveryUnknown",
  { message: Schema.String },
) {}
export class HerdrClient {
  private hello: CoreHello | null = null;
  private closed = false;
  private readonly transport: CoreTransport;
  constructor(transport: CoreTransport) {
    this.transport = transport;
  }
  async negotiate(expectedId?: string) {
    const hello = decodeHello(await this.transport("hello", { generation: 1, framed: false }));
    if (expectedId && hello.core.id !== expectedId)
      throw new Error("Core identity changed. Re-enroll this destination explicitly.");
    this.hello = hello;
    return hello;
  }
  supports(method: string) {
    return this.hello?.methods.includes(method) ?? false;
  }
  close() {
    this.closed = true;
  }
  async request(method: CoreMethod, params: Record<string, unknown>, mutation = false) {
    if (this.closed) throw new Error("Herdr connection is closed");
    if (!this.supports(method)) throw new Error(`Core does not advertise ${method}`);
    try {
      return await this.transport(method, params);
    } catch (error) {
      if (mutation)
        throw new CoreDeliveryUnknown({
          message:
            "The operation may have been delivered. Verify its effect before issuing it again.",
        });
      throw error;
    }
  }
}
