# T3 Code Fold

**T3 Code for the phone that unfolds into a laptop.**

T3 Code Fold is a fork of [T3 Code](https://github.com/pingdotgg/t3code) built for Android foldables. Unfold your phone and you get chat, files, terminal and git side by side. Pair a Bluetooth keyboard and you get laptop shortcuts and optional Vim navigation. Codex can talk back to you, and the whole app gets splatter-paint styling. Everything still works on web, desktop and regular phones, and Fold clients connect to the same servers as upstream T3 Code.

[Download the Android preview](https://github.com/whattheflop/T3codefold/releases) · [Install a server](#installation) · [Update guide](docs/user/updating.md)

![T3 Code Fold on an unfolded phone: thread sidebar beside a conversation](docs/images/fold-hero.webp)

## Built for the unfolded phone

Fold's Android app treats an unfolded screen as a workspace, not a stretched phone.

| Chat beside the terminal                                                                           | Chat beside your files                                                           |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ![A conversation beside a live terminal on an unfolded phone](docs/images/fold-chat-terminal.webp) | ![A conversation beside the project file tree](docs/images/fold-chat-files.webp) |
| **Resize with the handle**                                                                         | **Maximize a pane**                                                              |
| ![The divider handle dragged to give the side pane more room](docs/images/fold-resized.webp)       | ![The file tree maximized to the whole screen](docs/images/fold-maximized.webp)  |

- **Side-by-side panes.** Open Files, Terminal or Git next to the conversation. When the chat would get too narrow, the thread sidebar steps aside.
- **A real divider.** Drag the handle to resize: the panes lay out once when you let go. A separating physical hinge fixes the split; use the pane’s maximize button to expand or restore it.
- **Fold and unfold freely.** The sidebar keeps its place when you fold and unfold. Pane sizes are remembered per posture, sidebar visibility is remembered, and Android Back steps out one layer at a time.
- **Terminal that keeps up.** Agent CLIs and full-screen programs redraw cleanly when you resize. Hardware arrows, Esc, Tab and function keys work.
- **Folded, it's a great phone app.** Close the phone and you're back to the compact single-column layout.
- **Tabletop and thumb navigation.** Tabletop posture puts chat above the fold and the composer below. Enable optional thumb navigation in **Settings → Organization** to switch recent threads and panes.
- **Native source tools.** Wrap code, select and copy lines, or attach them to chat. Pinch to resize code, diffs, terminal text, and images.

<img src="docs/images/fold-folded.webp" alt="The same workspace folded, as a single-column phone layout" width="300">

## A keyboard-first workspace

Pair a Bluetooth keyboard and the unfolded phone works like a small laptop.

- **Shortcuts work anywhere**, with Ctrl or the keyboard's Cmd key: K opens the command palette, N starts a new task, B toggles the sidebar, F searches and 1–9 jump to threads. Shift+[ / ] step between threads, and Shift+F / T / R open files, terminal or review. The terminal keeps plain Ctrl chords for the shell.
- **The composer behaves like a desktop editor.** Return sends (or inserts a newline; you choose in **Settings → Keyboard**), Ctrl+Return sends, and Esc leaves the composer.
- **Vim navigation (optional).** Turn on **Settings → Keyboard → Vim navigation**:
  - `Ctrl-w h/l` moves between the sidebar, chat and side pane, and `Ctrl-w o` maximizes.
  - `j`/`k` and `gg`/`G` move through threads or scroll the conversation.
  - `Enter` opens a thread, `i` writes, `/` searches, and `Space` opens commands.

![Vim navigation: the sidebar focused with a keyboard cursor on a thread](docs/images/fold-vim.webp)

On web and desktop, [Vim keyboard mode](docs/user/vim-keyboard-mode.md) adds Zed-style modal navigation through threads, responses, controls and the composer.

## Selectable responses

Android's native selection handles work across a whole response: headings, paragraphs, lists, links, inline code and tables. Links stay tappable.

<img src="docs/images/t3codefold-text-selection.webp" alt="Native Android text selection spanning Markdown headings, paragraphs, lists, links, inline code, and a table" width="360">

## Talk to Codex

Open a Codex thread and choose **Talk to Codex** for a live, two-way voice conversation.

- Pick the speaking voice and microphone, and mute the speaker and mic separately.
- Read the transcript and agent status while you talk.
- Keep the call going while you browse other threads, files and diffs.
- On Android, calls continue with the screen locked, can be ended from the ongoing notification, and use system speaker or Bluetooth call routing.

[Voice setup and requirements](docs/user/codex-voice.md).

## Splatter backdrop

Paint splatter across the chat canvas in every theme's colours, on the unfolded phone or up to 4K on desktop.

- Choose how much paint and which pattern under **Settings → Appearance**, and add an optional neon glow.
- Turn on **Dynamic splatter** and every merged pull request adds a splat in its project's colour. The canvas wipes clean at 6am.

| On an unfolded phone                                                                   | On desktop, with neon glow                                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| ![Splatter behind a conversation on an unfolded phone](docs/images/fold-splatter.webp) | ![Cyberpunk theme with neon glow splatter](docs/images/t3codefold-splatter-glow.webp) |

## More than upstream

Compared with upstream `main` at [82afb28794](https://github.com/pingdotgg/t3code/commit/82afb28794b1edca1b67f1f16c0074ff426001be), synced **17 November 2026**, Fold adds the features below. They describe the code on Fold's `main`; an older published installer may not include every change.

| Feature                              | What you get                                                                                                                                                                                                                                  | Available in                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Foldable workspace**               | Side-by-side chat, files, terminal and git, with a resizable, fold-aware divider and remembered layout.                                                                                                                                       | Android                                  |
| **Hardware keyboard and Vim**        | Laptop-style shortcuts, a keyboard-friendly composer and optional Vim navigation.                                                                                                                                                             | Android · Web · Desktop                  |
| **Live Codex voice**                 | Two-way voice with transcripts, separate mutes, background calls and Bluetooth routing.                                                                                                                                                       | Web · Desktop · Mobile                   |
| **Handoffs between machines**        | An agent can discover connected environments, start or message a thread elsewhere, and read or wait for its response.                                                                                                                         | Server · Connected clients               |
| **Fleet CLI**                        | `t3 fleet` discovers environments and projects, creates threads, sends messages, reads results and waits. Retried requests keep their original receipt.                                                                                       | CLI                                      |
| **Task handoff skill**               | Give another thread ownership of work with its objective, progress, code location, constraints and a return contact. [Handoff instructions](.agents/skills/t3-handoff/SKILL.md).                                                              | Agents with T3 tools or CLI              |
| **Herdr factories**                  | Connect the desktop app to a Herdr Core factory, locally or over SSH. Commanders and workers read as threads, TUI tools open as terminal panes, and you can message or interrupt agents. [Guide](docs/user/herdr.md).                         | Desktop                                  |
| **Older-server compatibility**       | Connect releases using the same orchestration protocol, with capability-based fallbacks for older hosts. Protocol mismatches require an update. [Compatibility guide](docs/user/updating.md#when-versions-dont-match).                        | Web · Desktop, including macOS · Android |
| **Agent activity notifications**     | Local alerts for completed or failed work, approvals and questions; tap to return to the thread. Requires the app to stay connected.                                                                                                          | Android                                  |
| **Gaming HUD**                       | Optional, off by default: a small status strip above your game shows running agents and attention needed across local and remote environments. Enable it in **Settings → General → Gaming HUD**. [Guide](docs/user/appearance.md#gaming-hud). | Desktop                                  |
| **Shared project colours and icons** | Automatic colours, custom icons and emoji configured on desktop show up for projects on the same server.                                                                                                                                      | Android                                  |
| **Optional Cite bubble**             | Hide the selection bubble through **Settings → General → Show Cite on text selection**, without disabling text selection.                                                                                                                     | Web · Desktop                            |
| **Splatter backdrop**                | Theme-coloured paint across the chat canvas, with patterns, amount, glow and dynamic splats.                                                                                                                                                  | Web · Desktop · Mobile                   |
| **GLaDOS**                           | An elected, pinned coordinator thread per environment that keeps your priorities, hands bounded tasks to worker threads, and reviews their evidence. Workers use the `t3 work` CLI and MCP tools. Set it up in **Settings → GLaDOS**.         | Web · Desktop · Mobile                   |
| **Thread wrapping**                  | On very wide screens, a long conversation flows into 2–4 side-by-side columns. Set the maximum in **Settings → Appearance**.                                                                                                                  | Web · Desktop                            |
| **On-device dictation**              | Dictate into the composer with a downloaded Moonshine model that runs offline on the phone. [Voice input on Android](docs/user/composer.md#voice-input-on-android).                                                                           | Android                                  |
| **Controller console mode**          | PlayStation-style focus navigation, thread switching, scrolling, explicit decisions, and dictation into supported text fields. [Controller controls](docs/user/keybindings.md#controller-console).                                            | Android · Web · Desktop                  |

### Fold installs and updates

- **Separate Android preview.** Install Fold alongside the upstream Play Store app. Compatible JavaScript updates come from Fold's GitHub OTA feed and must match the native runtime.
- **Fork-owned server updates.** Server updates, remote SSH installs and copied commands use Fold release packages. Older updaters get a manual Fold command instead of installing upstream T3.
- **Dedicated desktop feeds.** Windows, macOS and Linux builds use Fold's own feeds, separate from APK releases. The release workflow publishes the matching server first and includes Windows WSL terminal support.

<details>
<summary><strong>Connection and release limits</strong></summary>

- Cross-environment delivery requires a running client connected to both servers. Accepted work continues on the destination if that client disconnects; follow-up delivery needs the connection restored.
- A handoff passes context and code references. It does not copy your checkout or uncommitted changes to another machine.
- Clients and servers must use the same orchestration protocol. Capability fallbacks cover some differences within a protocol; pre-orchestration hosts need an update before normal use.
- Updated clients preserve basic voice on older Fold hosts and enable advanced controls per host as servers are updated. Older clients retain basic voice on updated hosts. Task switching reconnects audio; view sharing is optional and bounded, without screen capture. Recheck upstream voice controls, context sharing, and call ownership across clients before retiring these differences.
- Android activity notifications are local, connected-app notifications, not disconnected push delivery. Bluetooth behavior, including Meta Ray-Ban glasses, still needs physical-device verification.
- Installers and source availability differ. macOS automatic updates require signed builds; unsigned Mac builds are manual downloads. See [releases](https://github.com/whattheflop/T3codefold/releases) for available artifacts.

</details>

Upgrading an older server also migrates its conversation transcripts into the new runtime. Read [older-thread migration](docs/user/thread-migration.md) for what carries over and how sessions resume.

Upstream already supplies the core clients, remote connections, orchestration (agent thread tools, subagents, forks, message queues), provider support, voice dictation, source-control tools, and much of the project styling. The tables above describe Fold's additions or extensions to that foundation; recheck them after upstream merges overlapping functionality.

## About upstream T3 Code

T3 Code is an open-source control plane for coding agents. It runs the agents on your machine and gives them one interface across desktop, web and mobile. Fold builds on that work with the features above.

## Installation

Download Fold desktop builds and the Android APK from [GitHub Releases](https://github.com/whattheflop/T3codefold/releases). Upstream's App Store, Google Play and package-manager entries install regular T3 Code.

To run the Fold server with Node.js 24:

```bash
npx --yes --prefer-online --package=https://github.com/whattheflop/T3codefold/releases/download/fold-server-latest/t3.tgz t3
```

See [Install and first run](./docs/user/install.md) for installation options and [remote access](./docs/user/remote-access.md) to connect from another device.

## Documentation

- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Vim keyboard mode](./docs/user/vim-keyboard-mode.md)
- [Project settings](./docs/user/project-settings.md)
- [Appearance preferences](./docs/user/appearance.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Source control](./docs/user/source-control.md)
- [Connect outside agents over MCP](./docs/user/outside-agents.md)
- [FAQ](./docs/user/faq.md)

[All docs](./docs/README.md) has the full list.

## Contributing

We have limited review capacity. Small, focused fixes are the most likely to be merged. Features need an approved discussion first.

- Read [CONTRIBUTING.md](./CONTRIBUTING.md) before you report a bug or open a pull request.
- Put feature requests in [Ideas](https://github.com/pingdotgg/t3code/discussions/categories/ideas).
- Build from source with the [development runbook](./docs/operations/development.md#first-checkout). The [architecture overview](./docs/internals/overview.md) explains how it works.
- Get help in [Discord](https://discord.gg/jn4EGJjrvv).

## License

[MIT](./LICENSE)
