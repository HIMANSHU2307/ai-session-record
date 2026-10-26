---
name: session-record
description: >-
  Reads and updates the shared session record for this terminal. Use when
  SESSION_RECORD_PATH is set, when the user starts or joins a session record,
  or when Claude, Copilot, or another terminal AI should continue work already
  stored in a record.
---

# Session record

This terminal may share a record with other AI sessions. The Snapshot is the current state. The Log is history from every terminal.

## Start

1. If `SESSION_RECORD_PATH` is set, read that file before doing any work.
2. If it is not set, run `session-record current`. When that prints a path, read it.
3. When no record is attached, ask whether to keep this session in a record. Create one with `session-record begin --tool <tool> --choice new --name "<title>"`. Join one with `session-record list`, then `session-record begin --tool <tool> --choice <id>`.

## While you work

After each meaningful step:

```bash
session-record log --message "What changed and what is next"
session-record snapshot --text "Goal, decisions, and open work"
```

Use `log` to append. Do not rewrite earlier log entries. Re-read the record before you answer when another terminal may have written to it.

## Commands

- `session-record current` prints this terminal's record path
- `session-record show` prints the record
- `session-record list` prints records for the current project
- `session-record delete <id>` deletes that record from any terminal and detaches every session using it
