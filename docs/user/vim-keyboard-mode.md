# Vim keyboard mode

Vim keyboard mode turns the web and desktop workspace into a modal,
keyboard-first interface. It combines Vim editing in the composer with Zed-style
focus movement between the thread sidebar, conversation, composer, right panel,
and the areas of every other page, such as Factory, Settings, and Usage.

Enable it in **Settings → General → Vim keyboard mode**. The composer's mode
badge appears beside the attachment control. Press `?` from the conversation for
the compact in-app reference.

## Learn the main loop first

Start with this sequence. It covers the interaction you will repeat most often:

1. From the conversation, press `Ctrl+w`, then `h` to focus the thread sidebar.
2. Move through projects and threads with `j` and `k`.
3. Press `Enter` or `o` to open the focused thread.
4. Press `Ctrl+w`, then `l` to return to the conversation.
5. Read with smooth `j`/`k` scrolling, jump between messages with `{`/`}`, or use
   `gg`/`G`.
6. Press `v` to place a caret in the conversation. Move it with motions or use
   `f` and a displayed label to jump to visible text. Press `v` again to begin a
   character selection, extend it with motions, then press `y` to copy or `c` to
   cite it.
7. Press `Ctrl+w`, then `j` to move down to the composer, or press `i` to focus
   it directly in Insert mode and write your response.
8. Press `Esc` for composer Normal mode. Press `Esc` again to return keyboard
   control to the conversation.

`Ctrl+w h` and similar commands are sequences: hold Control while pressing `w`,
release it, then press the direction. The layout is spatial: threads are left of
the conversation, the composer is below it, and the right panel is to its right.
`Ctrl+w w` cycles through every region on screen.

Enable **Settings → General → Preview threads while navigating** to open threads
as you pause on them with sidebar `j`/`k`, keeping keyboard focus in the sidebar.
Press `i` or `Enter` to open the selected thread immediately. Turn the setting off
to move the selection without opening threads.

## Understand the focus zones

T3 Code has five keyboard contexts:

- **Conversation Normal mode** controls scrolling, message jumps, assistant-text
  selection, marks, panels, and application actions.
- **Sidebar focus** makes `j`/`k` move between projects and threads instead of
  scrolling the conversation.
- **Composer focus** uses Vim modes to edit the prompt. Insert mode accepts text;
  Normal and Visual modes interpret keys as commands.
- **Right-panel focus** navigates files, linked pull requests, diffs, agents, and
  other panel controls with a consistent set of motions.
- **Page areas** cover everything else, such as the Factory fleet and decisions,
  Settings, Usage, and Pull requests. See [Navigate other pages](#navigate-other-pages).

The composer mode badge shows how prompt keys will be interpreted. Outside the
composer, focus determines which region unmodified keys control. Existing
Command and Control shortcuts continue to work. While T3 is waiting for the rest
of a command, such as after `g` or `Ctrl+w`, or while it passes keys through, a
small badge in the bottom-right corner says so.
Terminals, browser previews, dialogs, and open menus keep their native keyboard
behavior.

If you need to type into a control that Vim mode would otherwise intercept, press
`z` in the conversation. T3 passes keys through until you press `Esc`.

## Navigate threads

| Keys                | Result                                                     |
| ------------------- | ---------------------------------------------------------- |
| `Ctrl+w h/j/k/l`    | Move focus left, down, up, or right relative to its region |
| `Ctrl+w h`          | From the conversation, focus or open the thread sidebar    |
| `Ctrl+w j`          | From the conversation, focus the composer below it         |
| `Ctrl+w k`          | From the composer, return to the conversation above it     |
| `Ctrl+w l`          | From the sidebar, focus the region directly to its right   |
| `Ctrl+w w`          | Cycle through sidebar, conversation, composer, and panel   |
| `j` / `k`           | Focus the next or previous project or thread               |
| `h` / `l`           | Collapse or expand a focused project                       |
| `Enter` / `o`       | Open the focused project or thread                         |
| `s` / `u`           | Settle or un-settle the focused thread                     |
| `/`                 | Focus the thread filter                                    |
| `Ctrl+n` / `Ctrl+p` | Move down or up through filtered results                   |

After typing a filter, press `Enter` to open the highlighted result. You can use
`Ctrl+w l` directly from the filter to return to the conversation.

The same `Ctrl+n` and `Ctrl+p` movement works in open dropdowns, command pickers,
and composer completion menus throughout the workspace.

## Navigate the right panel

Press `Ctrl+w l` from the conversation or composer to open the right panel when
needed and focus its active surface. T3 prefers the file tree or the main rows in
a list, so focus lands on useful content instead of a toolbar control.

| Keys              | Result                                                      |
| ----------------- | ----------------------------------------------------------- |
| `j` / `k`         | Focus the next or previous item or control                  |
| `Enter` / `o`     | Open or activate the focused item                           |
| `/`               | Focus the active panel's search field, when it has one      |
| `H` / `L`         | Activate the previous or next right-panel tab               |
| `gg` / `G`        | Move to the first or last file, or scroll to the panel edge |
| `Ctrl+d`/`Ctrl+u` | Scroll the active panel down or up by half a page           |
| `f` / `F`         | Label controls in the active panel for activation or focus  |

In the file tree, `h` collapses a folder or moves to its parent, `l` expands a
folder, and `j`/`k`, `gg`/`G`, and `Enter` use the tree's native keyboard model.
Linked pull requests are treated as the primary list items in the GitHub panel.

Terminal and browser-preview tabs keep their native keyboard input after you
enter them. Their web content and shells need unmodified keys, so T3 does not
intercept those keystrokes as panel motions. `Ctrl+w` pane movement remains
available when the host can observe the keystroke.

## Navigate other pages

Pages without a conversation, such as Factory, Settings, Usage, Pull requests,
and Home, are split into areas. In Factory, for example, the fleet list, the
open conversation, and the details panel are each an area. Use `Ctrl+w h/j/k/l`
to move between them, as in the main workspace.

| Keys              | Result                                                         |
| ----------------- | -------------------------------------------------------------- |
| `j` / `k`         | Focus the next or previous row, or scroll an area with no rows |
| `Enter` / `o`     | Open or activate the focused row                               |
| `gg` / `G`        | Move to the first or last row, or scroll to the area's edge    |
| `Ctrl+d`/`Ctrl+u` | Scroll the area down or up by half a page                      |
| `/`               | Focus the area's search field, or the page's own search        |
| `i`               | Focus the area's message field, such as the Factory composer   |
| `f` / `F`         | Label visible controls for activation or focus                 |

Other letters belong to the page, so its own shortcuts keep working. In Settings
and Usage, `Esc` closes the page when T3 has nothing of its own to cancel.

Factory terminal panes take every key, like other terminals. Use `Ctrl+w` to
move out of one.

## Read and move through a conversation

| Keys                   | Result                               |
| ---------------------- | ------------------------------------ |
| `j` / `k`              | Scroll down or up                    |
| `Ctrl+d` / `Ctrl+u`    | Scroll down or up by half a page     |
| `gg` / `G`             | Jump to the start or end             |
| `{` / `}`              | Jump to the previous or next message |
| Number before a motion | Repeat it, such as `5j` or `3}`      |

### Marks

Press `m` followed by a letter to remember the current location. Press backtick
followed by that letter to return to it. Two backticks return to the location you
jumped from. Marks belong to the current thread.

For example, `ma` records mark `a`, and `` `a `` returns to it.

## Select and reuse conversation text

Press `v` in the conversation to enter Caret mode near the middle of the visible
messages. Move the caret without selecting, or press `f` and type one of the
labels drawn over visible words to jump directly to that position.

When the caret is where you want it, press `v` again to begin a character
selection or `V` to select its current line. The selection can cross any rendered
turns and messages, including user and assistant messages.

Move the active end with `h`, `j`, `k`, `l`, `w`, `b`, `e`, `0`, `^`, `$`, `G`,
`{`, or `}`. Counts work here too. Press `o` to swap the active and fixed ends.

When the selection is ready:

| Keys          | Result                                           |
| ------------- | ------------------------------------------------ |
| `y` / `Enter` | Copy the selected response text                  |
| `c`           | Cite every assistant-message segment it crosses  |
| `Esc`         | Return to Caret mode without losing the position |

Cross-message copy includes the complete selected conversation text. Citations
remain source-aware: user text is not cited, and each assistant response becomes
its own citation. Press `Esc` again from Caret mode to return to conversation
Normal mode. After citing, press `i` to enter the composer and write the
instruction that uses the quoted context.

## Edit the composer

The composer begins in Normal mode when Vim keyboard mode is enabled.

### Change modes

| Keys             | Result                                                     |
| ---------------- | ---------------------------------------------------------- |
| `i`              | Insert before the cursor                                   |
| `a`              | Insert after the cursor                                    |
| `I` / `A`        | Insert at the first non-space character or end of the line |
| `o` / `O`        | Open a line below or above and enter Insert mode           |
| `v` / `V`        | Enter Visual or Visual Line mode                           |
| `Esc` / `Ctrl+[` | Return to Normal mode                                      |

In Normal mode, a second `Esc` blurs the composer and gives the conversation its
navigation keys again. From the conversation, `i` focuses the composer in Insert
mode while `gi` focuses it in Normal mode.

### Move

The composer supports `h`, `j`, `k`, `l`, `w`, `b`, `e`, `0`, `^`, `$`, `gg`,
`G`, `{`, and `}`. Prefix a motion with a number to repeat it.

Use `f` or `t` followed by a character to find forward on the line. `F` and `T`
find backward. Press `;` to repeat the find or `,` to repeat it in reverse.

### Change text

| Keys               | Result                                                   |
| ------------------ | -------------------------------------------------------- |
| `x`                | Delete characters under the cursor                       |
| `dd` / `cc` / `yy` | Delete, change, or copy the current line                 |
| `d{motion}`        | Delete through a motion, such as `dw` or `d$`            |
| `c{motion}`        | Change through a motion and enter Insert mode            |
| `y{motion}`        | Copy through a motion                                    |
| `diw` / `daw`      | Delete the inner word or the word with surrounding space |
| `ciw` / `caw`      | Change the inner word or the word with surrounding space |
| `yiw` / `yaw`      | Copy the inner word or the word with surrounding space   |
| `p` / `P`          | Paste after or before the cursor                         |
| `u` / `Ctrl+r`     | Undo or redo                                             |

`x` stops at the end of the line. Deleted, changed, and copied text keeps its
file and context chips, so `dd` then `p` moves a line along with its references.

In Visual modes, use motions to adjust the selection, `o` to swap ends, and
`y`, `d`, or `c` to copy, delete, or change it.

## Open T3 Code actions

T3 Code maps Vim-style entry points onto its native command surfaces:

| Keys      | Result                                     |
| --------- | ------------------------------------------ |
| `:`       | Open the command palette                   |
| `Space f` | Find a project file                        |
| `Space /` | Search conversation content                |
| `Space b` | Browse commands, projects, and threads     |
| `Space s` | Focus the thread sidebar                   |
| `f`       | Show labels that activate visible controls |
| `F`       | Show labels that focus visible controls    |

For a hint label, type the letters displayed over the target. Hints are useful for
occasional controls that do not need a dedicated motion.

## A short practice plan

Learn one layer at a time rather than memorizing every command.

1. **Threads:** spend five minutes using only `Ctrl+w h`, `j`/`k`, `Enter`, `/`,
   and `Ctrl+w l`.
2. **Reading:** add `gg`, `G`, `{`, `}`, `Ctrl+d`, and `Ctrl+u`.
3. **Responding:** use `v`, motions or `f` text hints, a second `v`, `c`, and `i`
   to cite part of one or more responses and answer without touching the pointer.
4. **Editing:** begin with `i`, `Esc`, `w`, `b`, `0`, `$`, `ciw`, `dd`, `p`, and
   `u`. Add character finds, counts, and the remaining operators later.

The goal is not to use every binding. It is to make the thread → response → prompt
loop automatic, then adopt extra commands when they replace a repeated pointer
action.

## Troubleshooting

- If letters type instead of moving, focus is in an input or the composer is in
  Insert mode. Press `Esc`: it leaves any text field and returns to its region.
- If conversation motions do nothing, press `Ctrl+w l` to restore conversation
  focus.
- If the sidebar is closed, `Ctrl+w h` opens and focuses it.
- If T3 is passing keys through, press `Esc` to leave PASS mode.
- If a terminal, preview, dialog, or menu is focused, use that surface's native
  keys or press `Esc` to close it before returning to Vim navigation. In a dialog,
  `f` and `F` still label its controls.
- If you forget a command, focus the conversation and press `?`.

## Android

On Android with a hardware keyboard, turn on **Settings → Keyboard → Vim
navigation**. It covers pane and thread navigation, not text editing: keys act
only while no text field has focus, so typing is never intercepted.

- `Ctrl+w h` / `Ctrl+w l` (or `Ctrl+h` / `Ctrl+l`) move between the sidebar,
  chat and side pane. `Ctrl+w o` maximizes the side pane, or hides the sidebar
  from the chat.
- In the sidebar, `j`/`k` move the thread cursor, `gg`/`G` jump to the ends,
  and `Enter` opens the thread. Counts such as `5j` work.
- In the chat, `j`/`k` scroll, `Ctrl+d`/`Ctrl+u` scroll half a screen, and
  `gg`/`G` jump to the start or end.
- `i` writes in the composer and `Esc` leaves it. `/` searches threads and
  `Space` or `:` opens the command palette.

A thin accent marks the focused pane once you start using these keys. iOS keeps
its touch-first navigation.
