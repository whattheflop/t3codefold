# Controller navigation contract

Controller support is a reachability property of the client, not a count of mapped buttons.
A visible control is not necessarily reachable, and a correct focus model does not prove that
Android, Electron, a virtualized list, or a particular controller delivers the expected input.
This contract defines the required behavior; it is not a declaration that every client passes it.

## State and ownership

Treat navigation state as `(surface, scope stack, region, target, input mode)`:

- **Surface** identifies the active chat column or native screen. Main and side-chat drafts
  are different surfaces even when they share a route.
- **Scope stack** holds overlays above their invoking scope. Only the top scope owns input.
- **Region** is threads, conversation, reply, or a feature pane such as Settings or the inspector.
- **Target** is an enabled semantic action or text field within that region. The region itself
  remains a valid destination when its target list is empty.
- **Input mode** is navigation, editing, dictation, or suspended. Dictation retains its text
  destination independently of whichever visual control currently has focus.

An empty thread, loading thread, collapsed fold, expanded fold, scroll boundary, open keyboard,
missing reply, disabled action, and recycled row are conditions of these states. They must not
require an unrelated button mapping or an implicit jump to a different surface.

## Transition rules

| State                    | Directional input                                                                            | Activate                                                             | Back / Cancel                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Threads                  | Traverse threads; enter the selected conversation through the client's region command        | Select thread and enter its conversation                             | Unwind the owning screen                                                     |
| Conversation             | Read with Up/Down; Activate enters visible inline actions; Left/Right switches visible panes | Acquire a visible action first, then activate it on a separate press | Leave inline inspection, or unwind the inspector before returning to threads |
| Reply, navigation mode   | Return to conversation or traverse composer controls                                         | Enter text editing; submit requires an explicit submit action        | Return to conversation                                                       |
| Text editing             | Text movement or adjustment belongs to the editor                                            | Preserve editor semantics                                            | Leave editing and restore navigation                                         |
| Dictation                | Preserve the owning text destination                                                         | Never submit as a side effect of starting/stopping voice             | Cancel recording without discarding another draft                            |
| Inspector / Settings     | Traverse local controls and scroll local content                                             | Perform the focused semantic action                                  | Unmaximize, close, or leave one level, restoring the invoking region         |
| Menu / question / dialog | Stay inside the top scope; custom widgets own their local arrow behavior                     | Perform only the focused, enabled action                             | Close one scope and restore its invoking target or region                    |
| Suspended / disconnected | No navigation repeats or stale activations                                                   | No stale activation on resume                                        | Old holds are quarantined; a fresh press can recover after a missed release  |

Physical mappings may differ between clients; these semantic transitions must remain reachable.
Android uses RT/R2 to jump to reply and LT/L2 to return to conversation, including while editing.
X starts or finishes dictation; B cancels recording or leaves editing. LB/RB switch threads,
A activates the selected control, and Y selects reply actions. The right stick scrolls.
View/Select opens the controller guide above the current scope; View/Select or Back closes it.
Up/Down reads a conversation until Activate selects an inline action. RT remains a direct reply
jump at every scroll position. Left/Right switches declared sidebar, content and inspector panes
and restores the previous selection; it does not traverse a global ordering of region kinds.
At a compact conversation's left edge, Left returns to its thread list. Desktop exposes explicit conversation/reply commands
and pane traversal. Do not infer identical behavior from identical button labels.

## Invariants

1. **Scope isolation:** navigation, scrolling, dictation, submit, and discard affect only their
   owning surface and top scope. An underlying pane cannot absorb input from a modal.
2. **Progress:** a vertical step reads the conversation, moves between inline actions during
   inspection, or stays at a genuine content boundary. It never changes panes implicitly.
   A gap without buttons is scrollable content, not the end of the conversation.
3. **Escape:** every non-root state has a controller path back. Fullscreen, keyboard, terminal,
   dialogs, and recording cannot require touch to recover navigation.
4. **Acquisition is not activation:** repairing missing focus or entering a region cannot also
   approve, send, delete, discard, or activate the first available control.
5. **Stable lifecycle:** recycling a row cannot strand focus or reset held scrolling. If a
   target disappears, recover within its region. A real scope replacement stops old repeats
   and waits for neutral input. These are different events.
   A width transition can temporarily detach an editor: retain its editing destination until
   it returns, but let explicit Back, touch selection or navigation cancel restoration.
6. **Capability guards:** disabled, hidden, stale, and cross-scope targets cannot execute.
   If a reply is unavailable, stay in a usable region; never redirect text to another draft.
7. **Reversibility:** Back removes one owned layer and restores a valid destination, with a
   region fallback if the invoking target has disappeared.
8. **Bounded reachability:** when available in the active workspace, the reply and thread list
   are reachable without traversing the entire history. Conversely, reaching the reply by
   directional navigation must not skip unread conversation content to reach the reply.

## Executable evidence

Android selection belongs to the React Native controller session. Native focus is an effect of
entering an editor, not the source of navigation authority. Scopes declare ancestry and active
ownership; regions expose order, declared workspace pane and scroll bounds. Pane ownership is
carried by the layout containers, so folding does not change a region's identity. Target registration refreshes availability
without replacing a scope: virtualized rows and recording controls change during held navigation.

Session tests replay transitions through its production effect interface, including delayed
scenes, recycled targets, surface ownership and overlay restoration. Native tests dispatch
device-correct input through the installed window callback and exercise missed releases. The
development-only input probe crosses native dispatch, Expo events, the active console and
product actions in the running app. Desktop browser tests cover its separate DOM adapter.
None of these layers individually establishes hardware acceptance.

The [Lean specification](../../apps/mobile/formal/controller/README.md) proves ownership and bounded escape for an abstract state machine. Exported traces check finite conformance with the production session; there is no machine-checked refinement proof for TypeScript, Kotlin, or native callbacks.

A claim that a workflow is controller-complete requires one uninterrupted run through the real
client using controller input: enter the state, perform its action, reverse it, and recover after
its target disappears or becomes unavailable. Record client/version, controller, inputs, and
observed destinations. Include compact and split layouts, long virtualized history, empty/loading
content, editor/keyboard, recording/permission interruption, modal nesting, and disconnect/resume.
Launching the app or touching the reply field does not establish controller acceptance. Missing
hardware evidence remains unverified; passing source or model tests cannot promote it to pass.
