import type { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

export interface McpProviderSessionConfig {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly endpoint: string;
  readonly authorizationHeader: string;
  /**
   * Adapters read it to keep developer instructions truthful: when the user
   * withholds agent browser access, the prompt must not advertise `preview_*`
   * tools that every call would reject.
   */
  readonly browserToolsAvailable: boolean;
  readonly capabilities?: ReadonlySet<string>;
  readonly agentDeviceEnvironment?: Readonly<Record<string, string>>;
}

export function withAgentDeviceEnvironment(
  base: NodeJS.ProcessEnv,
  config: Pick<McpProviderSessionConfig, "agentDeviceEnvironment"> | undefined,
): NodeJS.ProcessEnv {
  const extra = config?.agentDeviceEnvironment;
  if (!extra) return base;
  const separator = extra.PATH_SEPARATOR ?? ":";
  const basePath = base.PATH ?? base.Path;
  const { PATH: shimDir, PATH_SEPARATOR: _separator, ...rest } = extra;
  return {
    ...base,
    ...rest,
    ...(shimDir ? { PATH: basePath ? `${shimDir}${separator}${basePath}` : shimDir } : {}),
  };
}

/**
 * The `t3 work` CLI's credential: the thread's own revocable MCP authority,
 * never local admin auth. Empty when the thread has no MCP session.
 */
export function workCliEnvironment(
  session: Pick<McpProviderSessionConfig, "endpoint" | "authorizationHeader"> | undefined,
): Readonly<Record<string, string>> {
  return session
    ? { T3_WORK_ENDPOINT: session.endpoint, T3_WORK_AUTHORIZATION: session.authorizationHeader }
    : {};
}

/**
 * Provider env with the thread's `t3 work` credential applied over `base`, or
 * `base` untouched. Adapters call it where they spawn a per-thread process,
 * passing the session `McpProviderSessions.read` returns for that thread.
 * The device shim is separate (`withAgentDeviceEnvironment`) and not applied
 * here; devices reach agents through the MCP device tools.
 */
export function providerSessionEnvironment(
  base: NodeJS.ProcessEnv,
  session: Pick<McpProviderSessionConfig, "endpoint" | "authorizationHeader"> | undefined,
): NodeJS.ProcessEnv {
  const work = workCliEnvironment(session);
  return Object.keys(work).length === 0 ? base : { ...base, ...work };
}
