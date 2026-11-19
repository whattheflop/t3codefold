# Threads from older T3 Code versions

On your first V2 launch, T3 Code copies the V1 database, `state.sqlite`, into `statev2.sqlite`
in the same data directory and migrates the copy. Your threads appear automatically, with full
transcripts imported as needed. You do not need to run an import command.

V1 continues using its original database while V2 uses the copy. The database import can run while
V1 is open. Opening V2 again resumes your V2 history. The copy happens only once: later conversations
and changes in either version do not sync to the other. Settings, attachments, and workspace files
remain shared.

The V2 desktop app uses a separate browser profile, so browser cookies and caches do not carry
over from V1. You may need to sign in again to websites opened inside the app. On its first launch,
the V2 desktop app copies stashed prompts, unsent drafts, layout, and theme from V1. Anything you
change in V2 afterwards stays in V2.

The migrated thread keeps its title, project, provider and model selection, permission and
interaction modes, branch or worktree, archive state, settlement state, snooze and pin state, and
linked pull request. T3 Code also brings over user and assistant messages, their timestamps, and
supported attachments. Large histories may appear in stages while the server imports transcripts.

The migration does not recreate the old provider's live session. It also does not convert old run
records, checkpoints and diffs, tool activity, approval history, or proposed plan history into the
new format. These items may be absent from a migrated timeline even though the conversation text is
present.

## Upgrading from an earlier Fold build

Fold builds before 0.4.0 stored their V2 database under migration numbers that upstream T3 Code
now uses for other changes. On the first start of 0.4.0 or later, the server upgrades `statev2.sqlite`
in place before it opens it: threads, projects, pairings, and settings carry over with
the same IDs. In-flight background work from the old build is cancelled rather than replayed; start
it again if you still need it.

The original database is kept beside the new one as `statev2.fold-backup-<timestamp>.sqlite`.
The upgrade needs free disk space of about three times the database size while it runs (the backup
keeps one copy afterwards), and it can take a minute or more for multi-GB histories.

Stop every other T3 Code or Fold server that uses the same data directory first. If one is still
running, the server refuses to start with "Stop other T3 Code / Fold servers using this data
directory" and leaves the database unchanged.

An older Fold build cannot open an upgraded database. To go back, stop the server, then replace
`statev2.sqlite` with the backup file (removing any `statev2.sqlite-wal` and `statev2.sqlite-shm`
next to it) before starting the older build. Changes made since the upgrade are lost. Once the
upgraded database works for you, you can delete the backup.

## Continuing a migrated thread

The first new message starts a fresh provider session. T3 Code selects intact user and assistant
messages using the same [handoff budget](./portable-handoffs.md) as a provider switch. Omitted text
remains in the thread and can be retrieved by the agent. The migration retains its separate
32,000-character recovery excerpt; neither that excerpt nor the handoff replaces the full imported
transcript.

Before continuing a long or important thread, read the recent transcript and include any older
requirements the agent still needs in your next message. Starting a new thread and pasting a short
handoff is also a good choice when the old conversation contains conflicting instructions.

## Keeping a recovery copy

T3 Code does not currently have a whole-thread export command. Before a major server update, stop
the server and copy its `userdata` directory to a safe location. The default is
`~/.t3/userdata`; a server started with `--base-dir <path>` uses `<path>/userdata`.

If a migrated transcript is missing from the app, keep that copy unchanged. You can inspect the
old transcript without starting a server against it:

```sh
sqlite3 -readonly /path/to/recovery-copy/state.sqlite
```

At the SQLite prompt, list recent legacy threads:

```sql
.headers on
.mode tabs
SELECT thread_id, title, updated_at
FROM projection_threads
ORDER BY updated_at DESC;
```

Then print one transcript, replacing `<thread-id>` with the value from the first query:

```sql
SELECT role, text, created_at
FROM projection_thread_messages
WHERE thread_id = '<thread-id>'
  AND role IN ('user', 'assistant')
ORDER BY created_at, message_id;
```

Open only the copied database. Do not edit it or point a newer or older server at your recovery
copy. If the affected environment is remote, make and inspect the copy on the machine that runs
that environment.
