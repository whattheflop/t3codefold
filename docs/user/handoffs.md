# Hand off work to another environment

An agent can create a new main thread on another connected environment or message
an existing thread there. Ask it to use the `t3-handoff` skill with the destination
host and project. The handoff should describe the outcome, progress, remaining
work, and repository branch or commit. It transfers task context; it does not copy
files or the full conversation. Make uncommitted changes available separately.

Keep a T3 web, desktop, or mobile client connected to both environments while
sending the handoff. Once the destination accepts it, work continues on that host
independently. Reconnect the client for later messages or return delivery. A send
receipt means the message was accepted; read the destination thread to confirm
what the agent has done.

Agents do this through T3's MCP tools: `t3_environment_list` finds connected
environments, `t3_project_list` and `orchestrator_capabilities` take the
destination `environmentId`, and `t3_thread_launch` starts the new thread with
`title`, `message`, `environmentId`, `projectId`, and an optional
`clientRequestId` that makes a retried launch return the original thread.
`t3_thread_start` remains as an alias for older agents.

From a terminal on a host running T3, the fleet commands provide the same actions:

```bash
t3 fleet environments
t3 fleet projects --environment <environment-id>
t3 fleet capabilities --environment <environment-id>
t3 fleet start --environment <environment-id> --project <project-id> --file handoff.txt --client-request-id <unique-request-id>
```

`start` takes an optional `--title` (default "New thread"), and `--provider` with
`--model` to pick a model; pass both or neither.

Use `t3 fleet list`, `read`, `send`, and `wait` to find threads, inspect progress,
send follow-ups, and wait for results. Keep `--environment` and `--project` on
commands for another host; `read`, `send`, and `wait` take `--thread`. Commands
return JSON. IDs are unambiguous; unique environment labels and project titles
or paths also work. A project is looked up on the selected environment; without
`--environment`, it always means a project on this host. Use `--base-dir` if the local server uses a different T3 home.
For start or send, reuse `--client-request-id` when retrying the same request after
a lost response. See `t3 fleet <command> --help` for message and pagination options.
