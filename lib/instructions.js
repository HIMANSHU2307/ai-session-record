function instructionBody({ title, recordPath, id, tool, terminalId }) {
  return `# Session record

This terminal is attached to "${title}". Other AI sessions may update the same file.

- Record: ${recordPath}
- Id: ${id}
- Tool: ${tool}
- Terminal: ${terminalId}

Read the record before you act. The Snapshot is the current state. The Log is history from every terminal.

After each meaningful step, update the record with:

\`\`\`bash
session-record log --message "What changed and what is next"
session-record snapshot --text "Goal, decisions, and open work"
\`\`\`

Do not rewrite earlier log entries. Re-read the record before answering when another terminal may have written to it.
`;
}

const USER_INSTRUCTION = `When SESSION_RECORD_PATH is set, read that file before doing any work. It is a shared session record that other terminals may update. The Snapshot is the current state and the Log is history. After each meaningful step, append with \`session-record log\` and replace the snapshot with \`session-record snapshot\`. Do not rewrite earlier log entries.`;

module.exports = { instructionBody, USER_INSTRUCTION };
