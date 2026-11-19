# Keybindings

Customize shortcuts in **Settings → Keybindings** on web and desktop. That page
also lists the command IDs and defaults available in your version.

## Composer controls

`mod+shift+d` starts dictation in the focused editor, or the composer, and finishes it on the next press;
`Esc` discards the recording. Change the chord under **Composer: Start or Finish
Dictation**, and the hold or toggle behavior in **Settings → Voice**. See
[Voice input](./voice-input.md).

In **Settings → Chat → Send shortcut**, choose whether Enter sends, requires
`mod+Enter` for multiline prompts, or always requires `mod+Enter`. `Shift+Enter`
inserts a new line. This applies to the web and desktop composer at desktop widths.

**Follow-up behavior** chooses Queue or Steer while the agent runs. Use
`mod+Enter` to do the opposite for one message, even when the send shortcut
requires a modifier. `mod+Alt+Enter` sends, keeps that thread running in the
background, and opens a fresh new-thread composer. In a new thread, `mod+Enter`
does the same. Change these shortcuts in **Settings → Keybindings** under
**Composer: Opposite Queue or Steer Action**, **Composer: Start in Background**,
or **Composer: Send and Start New Thread**. These bindings take priority over the
send shortcut. Click the send button to use the configured follow-up behavior.

When a thread has queued messages, `mod+Shift+Enter` sends the first one as a steer
while a turn is running, or as a new turn when the thread is stopped. Change it under
**Queue: Send First Queued Message** in Keybindings.

Use `mod+shift+m` to choose a model and `mod+shift+h` to choose a host.
To step a new thread to the next machine instead of opening the menu, bind
**Composer: Cycle Host** in Keybindings. It has no default shortcut.
Use `mod+shift+e` for effort, `mod+shift+a` for permissions, `mod+shift+x` for the
workspace, and `mod+shift+g` for the Git branch. The workspace menu includes the
current checkout, a new worktree, and the previous worktree when available.
Use `mod+shift+l` to reuse the previous worktree directly.

To change effort one step without opening the picker, bind
**Composer: Increase Effort** and **Composer: Decrease Effort** in Keybindings.
Both are unbound by default. Increase wraps from the highest level to the
lowest, and decrease wraps from the lowest level to the highest.

In the model picker, press Left in an empty search field or Shift+Tab to reach
the provider list. Use Up/Down to move and Enter to choose. Right returns to
model search. Right at the end of the search moves to the highlighted model's effort
levels, and Left comes back. Choosing a model keeps the picker open on its effort. `mod+shift+up` and `mod+shift+down` switch providers directly and clear the
search. These provider shortcuts can also be changed in Settings.

These shortcuts run inside the focused web or desktop client. `mod` uses Command
on macOS and Ctrl on Windows and Linux, including GNOME, KDE Plasma, Niri, and
Hyprland. If a custom desktop shortcut takes the same keys, choose another binding
in Settings.

## Copy pull request references

With a PR open in the right panel or on the Pull requests page, use `mod+shift+c`
to copy its URL and `mod+shift+k` to copy its number with a `#` prefix.
Both shortcuts can be changed in Settings. Search for “Copy Link or Thread”
or “Copy Number”. They copy the selected PR and leave terminal input alone.
Without a PR, `mod+shift+c` copies the thread itself, which pastes into a
composer as a thread chip.

## Find in a diff

Click into a diff in the Diff panel or a pull request's Code tab, then press
`mod+f` to search every file in it, including folded files and unchanged lines
hidden between changes. Enter and `Shift+Enter` move between matches, and a
match in a folded file opens it. Escape closes the search. This shortcut is not
configurable. A very large uncommitted diff loads its files as you scroll, and
find only searches the files loaded so far.

## iPad and Android

Mobile supports hardware keyboards. On iPad, use `Cmd`; on Android, use `Ctrl`
(or the keyboard's `Cmd`/`Meta` key).

With a hardware keyboard, use `Cmd+1` through `Cmd+9` to open the first nine
displayed threads. The shortcuts follow the current list filters and order.
`Cmd+K` opens the command palette to search commands, projects, and threads.
Use the arrow keys and Return to choose a result, or `Cmd+1` through `Cmd+9` to
choose directly. Escape or `Cmd+K` closes the palette. Start a search with `>`
to show only actions.

Android also matches the web defaults for `Ctrl+B` (toggle the sidebar) and
`Ctrl+Shift+[` / `Ctrl+Shift+]` (previous and next thread).

In a new thread, `Cmd+Shift+H` moves the draft to the next machine.

In the composer, Return sends and `Shift+Return` inserts a new line. While a
turn is running, `Cmd+Return` sends with the other follow-up action. To make
Return insert a new line instead, change the Return key behavior in Settings →
Keyboard; `Cmd+Return` then sends.

## Android

With a hardware keyboard, the composer handles Return as on iPad, with `Ctrl` in
place of `Cmd`, and Escape leaves the composer. The on-screen keyboard's Return
always inserts a new line.

## Edit the configuration file

Keybindings live on the environment's machine, in
`~/.t3/userdata/keybindings.json` by default. You can edit this file directly.
It is a JSON array of rules:

```json
[
  { "key": "mod+g", "command": "terminal.toggle" },
  { "key": "mod+shift+g", "command": "terminal.new", "when": "terminalFocus" }
]
```

T3 Code creates the file with its defaults and adds new defaults on later startups.
New defaults do not replace commands you customized. If a new default overlaps one
of your shortcuts, [rule order](#precedence) decides which runs.
Invalid rules are ignored; if the file cannot be parsed, T3 Code uses defaults.

## Rule shape

Each rule requires a `key` shortcut and a `command` ID. An optional `when`
expression restricts when it runs.

Project scripts use `script.{id}.run`, such as `script.test.run`.

## Key syntax

Join modifiers and a key with `+`, such as `mod+shift+d` or `ctrl+l`.
`mod` means Command on macOS and Control elsewhere. Other modifiers are
`cmd` / `meta`, `ctrl` / `control`, `alt` / `option`, and `shift`.

## When conditions

Available context keys are `terminalFocus`, `terminalOpen`, `previewFocus`,
`previewOpen`, `rightPanelOpen`, `modelPickerOpen`, `usagePageOpen`, `composerFocus`,
`draftThreadRoute`, `turnRunning`, `editableFocus`, `isWeb`, and `isDesktop`.
In a thread, `rightPanelOpen` is true while its right panel is open; the default
`mod+t` uses it to open the panel's new-tab menu.
`draftThreadRoute` is true on a draft thread, including a restored draft, until it is first sent.
`editableFocus` is true while a text field, the composer, or another editor has
the keyboard. `isWeb` is true in a browser tab. `isDesktop` is true in the
desktop app. Unknown keys evaluate to `false`.

`mod+1` through `mod+9` jump to the first nine threads, and to models while the
model picker is open. The thread jumps do not run while the model picker is open.
Those defaults use `isDesktop` so they do not steal the
browser's tab-switch shortcuts. Remove that condition in Settings if you want
the same jumps in a browser.

Combine keys with `!` for not, `&&` for and, `||` for or, and parentheses:

```json
{ "key": "mod+j", "command": "terminal.toggle", "when": "terminalOpen && !terminalFocus" }
```

## Find in the current thread

`chat.find` searches conversation messages and proposed plans in the active thread. Entering a
query searches the entire thread, including older messages. Thread search requires server support;
update an older server to enable it. Select **Retry** if a search fails. It defaults to
`mod+f` outside terminals and previews. Press **Enter** or **Shift+Enter** to move between matches,
and **Escape** to close find.

## Find on a browser page

`preview.find` (`mod+f` while a browser has focus) searches the open page in the desktop app. It
is also in the browser's **⋮** menu and the command palette. A page that handles `mod+f` itself,
such as a code editor, keeps its own find. Use the **⋮** menu to reach the browser's find there.
Streamed browser tabs and T3 Code in a web browser do not support it.

## Precedence

The last rule whose key and condition both match wins, even if it belongs to a
different command. Put a more specific rule after a general one when they share
a shortcut.

## Commands with special behavior

`thread.stop` interrupts the running turn in the focused thread. It has no default
shortcut; assign one in **Settings → Keybindings**.

`thread.regenerateTitle` generates a new title for the focused thread, like
**Regenerate title** in the thread menu. It has no default shortcut.

`thread.undo` (`mod+z` by default) reverses the actions shown in the notice at the
bottom of the sidebar, such as unpin, settle, snooze, archive, or discarding a
draft. Consecutive
actions of the same kind undo together. The notice remains available for five
seconds after the latest action. Right after an action, the shortcut works even
in a text field such as the composer. Once you type or press another key, the
field gets its own undo back. Terminals always keep their native shortcut.

`navigation.back` (`mod+[` by default) and `navigation.forward` (`mod+]`) move
through the pages you have visited, like a browser's back and forward buttons.

`chat.new` may ask you to choose a project when there is more than one.
`chat.newLocal` skips that chooser. Both use your
[new-thread defaults](./thread-sidebar.md#start-a-thread). `chat.newWithoutProject`
(`mod+alt+n`) starts a thread [without a project](./thread-sidebar.md#start-without-a-project).

## Reserved shortcuts

In the desktop app, `mod+w` closes the focused terminal or the active right-panel
tab. When nothing remains to close, it does nothing; it never closes the window. In a browser, `mod+w`
closes the browser tab; rebind `rightPanel.close` and `terminal.close` to an available
shortcut such as `alt+w`.

`mod+shift+t` reopens the last closed tab across the app, including files,
diffs, pull requests, browsers, and devices, in the order you closed them.
A browser opens in a fresh session without its old page history. Incognito tabs
can reopen until you reload or quit the app. This shortcut does not undo deleted work.
Browsers also use it to reopen browser tabs; choose another binding in Settings
if the browser takes it first.

Many defaults include `!terminalFocus` so they do not intercept terminal input.
Keep that condition when remapping them if you want the same behavior.

## Desktop quit shortcut

Use `Cmd+Q` on macOS or `Ctrl+Q` on Windows and Linux. In the default **Hold** mode,
hold for 1.2 seconds or press twice within 500 milliseconds. Holding requires
keyboard repeat; if repeat is disabled, use two presses or the application menu.

Change **Settings → General → Confirmations → Quit shortcut** to **Direct** for a
single press or **Double press** for two presses only. Choosing **Quit** from the
application menu always quits immediately.

## Controller console

On desktop (including macOS) and web, enable **Controller console** in
**Settings → Keybindings**, or search for it in the command palette. It works
with controllers exposed by Chromium's standard Gamepad mapping, including
supported DualSense and DualShock connections. Press a controller button if the
browser has not detected it, then release all controls to begin.

Use the D-pad or left stick to focus, **Cross (×)** to activate, and **Circle (○)**
to leave editing, close a popup, or go back. **Triangle (△)** focuses the enabled
send or decision action; **Cross** then confirms it. **L1/R1** switch threads,
**L2/R2** move between panes (page within a popup), and the right stick scrolls.
**Options** opens commands; **Share/Create** opens the thread chooser.
Click the left stick (**L3**) to enter the conversation without changing its reading
position, or the right stick (**R3**) to focus the reply. Opening a thread from the
sidebar enters its conversation; expanding a sidebar group keeps focus in the sidebar.

**Square (□)** starts or finishes dictation into a focused supported text field,
using your Voice settings and selected microphone. Review the transcript before
sending. From a non-text action in a chat, Square goes straight to that chat's reply
and starts dictation. Circle cancels recording. Fields without voice support show a hint;
use a keyboard for those fields, terminals, and embedded editors. Controller
input stays in the focused app window and pauses when the app loses focus.
Keyboard, touch, and Vim navigation remain available.

### Android controller console

Press **Start / Options** to enable controller mode. To leave it, open commands
and choose **Disable controller**.
Controller input pauses while the app is in the background. Disconnecting the
controller disables it. Press Options again to enable it, and release held controls after changing
threads or requests before choosing another action.

Use the D-pad or left stick to focus actions, **A / Cross** to select, and **B / Circle**
to leave reply editing, then go back. Leaving reply editing hides the keyboard
and returns focus to the conversation so directions navigate again.
**X / Square** starts or finishes dictation in a focused composer, custom question
answer, or palette search; Circle cancels recording. **Triangle** focuses
Submit or Send for review, and Cross activates it. **L1/R1** switch threads,
**L2/R2** page the focused content, and the right stick scrolls. While enabled,
Options opens commands and **Share/Create** opens the searchable thread chooser.
Selecting a thread enters its conversation. **Right** from a thread enters the chat;
from the conversation, **Left** returns to the selected thread and **Right** focuses
the reply. **L3** enters the conversation and **R3** focuses the reply. X / Square can start reply
dictation directly from a non-text action in the current screen. The right stick
continues to scroll the conversation while its reply is focused.

On both clients, search commands for **Next thread needing attention** to jump to a
thread with a pending request, failure, or unread completion. **Discard composed reply**
asks before clearing the current reply. On Android, each thread's **Thread actions**
control opens its management menu without a long press.
