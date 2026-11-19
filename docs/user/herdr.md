# Herdr factories

If you run your agents on Herdr Core, the desktop app can show that factory in T3 Code. Commanders and workers read like normal threads, and TUI tools such as a factory dashboard open as terminal panes. Herdr stays in charge: T3 Code doesn't install, start, stop or restart Core or its agents, and closing T3 Code leaves everything running.

## Connect a factory

Open **Factory** in the sidebar, or **Settings → Connections → Open Factory**, and add a connection:

```text
Factory name:   My factory
Socket path:    /run/user/1000/herdr-core/factory.sock
SSH alias:      factory-box        (leave blank for Core on this machine)
Read-only:      ticked
```

- **Socket path** is the absolute path of Core's socket on the machine it runs on. Run `ls /run/user/$(id -u)/herdr-core/` on that machine to find it; the number is your user id there.
- **SSH alias** is a host from your `~/.ssh/config`. It must connect without a password prompt (key or agent), and the remote machine needs `python3`.
- **Read-only** connections show everything but can't send messages, interrupt agents or press keys. A saved connection can't switch modes, so add a second connection with the box unticked when you want control.

Saved connections stay in the app across restarts. Each factory uses one long-lived connection that reconnects by itself after a drop and closes after a couple of idle minutes. The first time it connects, the app remembers that Core's identity and refuses to talk to a different Core at the same path. To point the connection at a new Core, remove it and add it again.

The **T3 sessions** tab in Factory is T3 Code's own [Factory](factory.md), which is separate from Herdr.

## Read your agents

The sidebar lists the factory's terminals grouped by Herdr tab, with each agent nested under the one that started it. A status shows when an agent is working, waiting for input or has exited. Finished terminals are hidden unless you turn on **Include finished terminals** in the details panel.

Selecting a Claude or Codex agent opens its conversation as a thread: messages, grouped tool calls you can expand, and **Load earlier turns** for older history. Prompts from factory automation or other agents fold into an **Agent** pill, so your own messages stay easy to find. The conversation comes from the provider's own session file on the factory machine, and the app finds it automatically for terminals launched with a provider session label. If one is missing, use **Conversation source** in the details panel (the panel icon in the header) to attach the session's `.jsonl` file by its absolute path.

New messages appear when the provider writes them, every few seconds rather than token by token.

## Use terminals and TUI tools

Any live terminal can open as a **pane**: a real terminal attached to it, the same as `hc attach`, with its colors, cursor and full-screen layout. Terminals without a conversation, such as a factory dashboard, open this way by default; for an agent, switch **Chat / Terminal** in the header.

On a connection that isn't read-only, the pane behaves like a terminal window: type, paste, scroll, and click or drag in programs that use the mouse. Like any Herdr viewer, the window you last typed in sets the terminal's size, so other screens watching it may redraw. Read-only connections watch at the size the terminal already has and never type or resize it.

## Send messages and interrupt

On a connection that isn't read-only, the composer types your message into the agent's terminal, the same as `herdr agent prompt`, and the stop button interrupts the agent's turn. A message isn't sent to an agent that is blocked on a permission or question prompt; answer that in its terminal pane instead.

Herdr doesn't confirm delivery. If the app can't tell whether a message arrived, it stops further sends until you check the conversation or pane and choose **I checked. Allow sending**. Nothing is ever resent automatically.

## Optional factory panels

A factory can show extra panels, such as a trigger list from a local factory service, by publishing a profile in Core's `t3-client` document. Plain Core needs none of this. The profile can also rename the labels the app reads for name, role, parent, session and tab; without it the app uses Herdr's `herd.*` labels.

```json
{
  "metadataMapping": {
    "name": "herd.name",
    "role": "herd.role",
    "parent": "herd.token.parent",
    "session": "herd.session",
    "tab": "herd.tab"
  },
  "modules": [
    {
      "id": "example.automations",
      "schemaVersion": 1,
      "label": "Automations",
      "baseUrl": "http://127.0.0.1:8796",
      "resources": [
        {
          "kind": "trigger",
          "label": "Triggers",
          "fields": ["id", "owner", "schedule", "state"],
          "path": "/v1/triggers",
          "resultKey": "triggers"
        }
      ],
      "actions": []
    }
  ]
}
```

Panels can only reach services on the factory machine's loopback address that answer with `{ "ok": true, "data": ... }`. A module's `tokenPath` is read on that machine and never leaves it. Actions need a connection that isn't read-only, and each one shows its exact request for you to confirm before it runs. Add only profiles you trust.

## Limits

- Herdr factories need the desktop app. The web app and mobile app can't open Core's socket or SSH, and mobile's Factory screen says so.
- You can't switch an agent's model or restart it from T3 Code. Answer its permission prompts in its terminal pane, and use Herdr for the rest.
- Conversations appear only for Claude and Codex, read from their session files in the default locations (`~/.claude/projects`, `~/.codex/sessions`, or `CLAUDE_CONFIG_DIR` and `CODEX_HOME` when set). Other terminals show as panes.
- Removing a connection never stops agents.
