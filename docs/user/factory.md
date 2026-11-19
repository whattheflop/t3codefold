# Factory preview

Factory coordinates a Commander, Subcommanders and Workers in each connected environment. Factory is **off by default on every server**. On web or desktop, open **Factory → T3 sessions** above the thread list; on mobile, open **Factory**. Select the environment, and use **Enable Factory**. This is a saved server setting shared by web, desktop, and mobile; changing it requires server settings permission. Enabling does not create a Commander automatically: choose its model and start it from web or desktop.

With multiple connected servers, choose a server in Factory’s desktop selector or Android server buttons. Each server has its own saved on/off setting, permissions, Commander, decisions and Fleet. Switching servers shows that server’s state; turning one off does not affect the others. A decision opened from a notification stays associated with its original server.

Use **Turn Factory off** from any client to disable that server. It blocks new Factory operations, checks, wakes and agent starts, cancels queued work, and requests stops for active Factory turns, delegated tasks and command jobs. Stops remain under supervision across restarts; **Stopping Factory…** means shutdown is still being confirmed. Re-enabling is unavailable until those stops complete. History is retained, but cancelled work is not replayed and unexecuted action approvals must be requested again. Outward actions already in progress may finish. Ordinary T3 threads continue normally.

A server operator can force Factory off at startup with `T3CODE_FACTORY_DISABLED=1`. Clients cannot override this. Remove the variable and restart before explicitly enabling Factory again.

Decision cards explain the work, why your input is needed and the cost of waiting. Choosing an option stages it locally. **Send** submits the answer. You can take the recommendation with **Defer to agent**, add a note, or write your own direction. If an agent changes the card before you answer, reload the current revision. Outward-action cards display their exact payload and hash; mobile requires enrolled biometrics before submitting an answer to these cards.

The Commander is guided to investigate available evidence before asking you to decide, handle authorized reversible work itself, and separate required fixes from optional cleanup. Its turn context includes summaries of open decisions, recent answers and child blockers so it can recover your direction after compaction. These summaries are bounded; it can read the full cards when needed. An answer gives direction, and the Commander still needs to verify and report the result.

Factory action tools require user approval bound to the action they execute. Agents are instructed to use those tools for opening or merging pull requests, force-pushes, branch deletion and external posts. Direct provider shells, other tools and script effects can bypass this workflow. This v1 approval boundary applies to Factory action tools and is not a sandbox around every provider command. An unknown action result needs verification on the external host before authorising a new action.

Use **Checks** to inspect checks and shadow results, and **Fleet** to inspect agents and command jobs. Cancelling a running job requests termination; the job stays under supervision until its termination is confirmed.

This preview is under development. Commander handover, notification delivery and several recovery paths are still being completed. Upgrading to it removes the retired GLaDOS records; reverting the code does not restore that data.

For a factory running independently on Herdr Core, use the optional [native Herdr connection](herdr.md) in the desktop client. Its connection and execution controls are separate from T3 Factory's enable/disable setting.
