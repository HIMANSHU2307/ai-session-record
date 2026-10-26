# session-record

Keeps one record for a project and lets each terminal AI join it. When you start Claude, Copilot, or another tool, it asks you to create a record or pick one that already exists. That terminal reads the record, and its later work is written back to the same file.

Records live in `~/.ai-session-record`, outside the project, so this works in any repo.

## Install

From this folder:

```bash
npm link
session-record install
```

Open a new terminal after install. `npm link` puts `session-record` on your PATH. `install` does four things:

- Sources the zsh and PowerShell wrappers from your shell profile
- Installs the Cursor skill at `~/.cursor/skills/session-record`
- Adds a short instruction to `~/.claude/CLAUDE.md`
- Adds the same instruction to `~/.copilot/copilot-instructions.md`

## Use

In zsh or PowerShell:

```powershell
claude
copilot
ai gemini
```

Each launch asks:

```text
Keep this session in a record?
  [n] New record
  [1] Auth refactor
  [s] Skip
```

A new record starts empty. Choosing an existing record fetches it into that terminal and appends a "Session started" entry. Later steps append to the log and replace the snapshot:

```bash
session-record log --message "What changed and what is next"
session-record snapshot --text "Goal, decisions, and open work"
session-record show
```

The attached AI is instructed to run those commands. Claude receives them with `--append-system-prompt`. Copilot receives them through `COPILOT_CUSTOM_INSTRUCTIONS_DIRS`. Any other tool started with `ai <tool>` gets `SESSION_RECORD_PATH`.

## Commands

```text
session-record list
session-record show [id]
session-record current
session-record begin --tool claude --choice new --name "Auth refactor"
session-record begin --tool copilot --choice auth-refactor
session-record begin --tool claude --choice skip
session-record delete auth-refactor
session-record delete 1
```

`delete` removes that record for the current project from any terminal. Every terminal attached to it is detached. Pass the record id, or the number from `session-record list`. With no argument in a terminal, it shows the same list and lets you choose.
