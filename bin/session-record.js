#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const store = require('../lib/store');
const { instructionBody, USER_INSTRUCTION } = require('../lib/instructions');

const HELP = `Usage:
  session-record begin --tool <name> [--terminal-id <id>] [--choice <n|new|id|skip>] [--name <title>] [--result-file <path>]
  session-record list
  session-record show [id]
  session-record current [--terminal-id <id>]
  session-record log --message <text>
  session-record snapshot --text <text>
  session-record delete [id-or-number]
  session-record install [--home <dir>]
  session-record uninstall [--home <dir>] [--records]
  session-record export-shell --result-file <path>

begin asks you to create a record or join one already stored for this project.
The shell wrappers run begin before claude, copilot, or ai <tool>.
`;

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals };
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer).trim());
    });
  });
}

function terminalId(flags) {
  return String(flags['terminal-id'] || process.env.SESSION_RECORD_TERMINAL || process.ppid);
}

function writeResult(flags, result) {
  const json = JSON.stringify(result, null, 2) + '\n';
  if (flags['result-file']) {
    fs.mkdirSync(path.dirname(path.resolve(flags['result-file'])), { recursive: true });
    fs.writeFileSync(flags['result-file'], json);
    return;
  }
  process.stdout.write(json);
}

function resolveRecord(choice, records) {
  const answer = String(choice).trim().toLowerCase();
  if (/^\d+$/.test(answer)) {
    const record = records[Number(answer) - 1];
    if (!record) throw new Error(`There is no record numbered ${answer}.`);
    return record;
  }
  const match = records.find((record) => record.id === answer);
  if (!match) throw new Error(`No record with id "${choice}".`);
  return match;
}

function resolveChoice(choice, records) {
  const answer = String(choice).trim().toLowerCase();
  if (answer === 's' || answer === 'skip') return { type: 'skip' };
  if (answer === 'n' || answer === 'new') return { type: 'new' };
  if (/^\d+$/.test(answer)) {
    const record = records[Number(answer) - 1];
    if (!record) throw new Error(`There is no record numbered ${answer}.`);
    return { type: 'existing', record };
  }
  const match = records.find((record) => record.id === answer);
  if (!match) throw new Error(`No record with id "${choice}".`);
  return { type: 'existing', record: match };
}

async function promptChoice(project, records) {
  process.stderr.write(`\nSession records for ${project.name}\n${project.root}\n\n`);
  process.stderr.write('Keep this session in a record?\n');
  process.stderr.write('  [n] New record\n');
  records.forEach((record, index) => {
    process.stderr.write(`  [${index + 1}] ${record.title} (${record.id}, updated ${record.updatedAt})\n`);
  });
  process.stderr.write('  [s] Skip\n\n');
  while (true) {
    const answer = await ask('Choice: ');
    if (!answer) {
      process.stderr.write('Enter n, s, a number, or a record id.\n');
      continue;
    }
    try {
      return resolveChoice(answer, records);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
    }
  }
}

async function promptName() {
  while (true) {
    const name = await ask('Record name: ');
    if (name) return name;
    process.stderr.write('A record name is required.\n');
  }
}

function finishAttach(flags, project, record, tool, id) {
  const started = store.appendLog(project, record.id, {
    tool,
    terminalId: id,
    message: 'Session started.',
  });
  const instruction = instructionBody({
    title: started.title,
    recordPath: started.path,
    id: started.id,
    tool,
    terminalId: id,
  });
  const binding = store.attachTerminal({
    project,
    record: started,
    tool,
    terminalId: id,
    instruction,
  });
  const snapshot = store.snapshotText(started.markdown);
  process.stderr.write(`\nAttached to "${started.title}".\n`);
  process.stderr.write(`Fetched this record for the ${tool} session:\n${started.path}\n`);
  if (!snapshot || snapshot === '_No snapshot yet._') {
    process.stderr.write('Snapshot: empty. This is the first session on this record.\n');
  } else {
    process.stderr.write(`\nSnapshot:\n${snapshot}\n`);
  }
  writeResult(flags, {
    action: 'attach',
    id: binding.recordId,
    title: binding.recordTitle,
    path: binding.recordPath,
    projectRoot: binding.projectRoot,
    tool: binding.tool,
    terminalId: binding.terminalId,
    instructionDir: binding.instructionDir,
    instructionFile: binding.instructionFile,
  });
}

async function begin(flags) {
  const tool = flags.tool;
  if (!tool || tool === true) throw new Error('begin requires --tool <name>.');
  const project = store.resolveProject(flags.project || process.cwd());
  const records = store.listRecords(project);
  const choiceValue = flags.choice && flags.choice !== true ? flags.choice : process.env.SESSION_RECORD_CHOICE;
  const nameValue = flags.name && flags.name !== true ? flags.name : process.env.SESSION_RECORD_NAME;
  let choice;
  if (choiceValue) choice = resolveChoice(choiceValue, records);
  else if (process.stdin.isTTY) choice = await promptChoice(project, records);
  else throw new Error('No choice was given. Pass --choice new, --choice <id>, or --choice skip.');

  if (choice.type === 'skip') {
    process.stderr.write('Starting without a session record.\n');
    writeResult(flags, { action: 'skip' });
    return;
  }

  const id = terminalId(flags);
  const record = choice.type === 'new'
    ? store.createRecord(project, nameValue || await promptName())
    : store.getRecord(project, choice.record.id);
  finishAttach(flags, project, record, tool, id);
}

function list(flags) {
  const project = store.resolveProject(flags.project || process.cwd());
  const records = store.listRecords(project);
  if (records.length === 0) {
    process.stdout.write(`No session records for ${project.root}\n`);
    return;
  }
  records.forEach((record, index) => {
    process.stdout.write(`${index + 1}\t${record.id}\t${record.updatedAt}\t${record.title}\n`);
  });
}

function show(flags, positionals) {
  const project = store.resolveProject(flags.project || process.cwd());
  const id = positionals[0];
  const record = id
    ? store.getRecord(project, id)
    : store.requireTerminal(terminalId(flags)).record;
  process.stdout.write(record.markdown.endsWith('\n') ? record.markdown : `${record.markdown}\n`);
}

function current(flags) {
  const { record } = store.requireTerminal(terminalId(flags));
  process.stdout.write(`${record.path}\n`);
}

async function readBody(flags, primary) {
  if (flags[primary] && flags[primary] !== true) return flags[primary];
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  }
  return '';
}

async function promptDelete(project, records) {
  process.stderr.write(`\nDelete a session record for ${project.name}\n${project.root}\n\n`);
  records.forEach((record, index) => {
    process.stderr.write(`  [${index + 1}] ${record.title} (${record.id})\n`);
  });
  process.stderr.write('  [c] Cancel\n\n');
  while (true) {
    const answer = (await ask('Choice: ')).toLowerCase();
    if (answer === 'c' || answer === 'cancel') return null;
    try {
      return resolveRecord(answer, records);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
    }
  }
}

async function remove(flags, positionals) {
  const project = store.resolveProject(flags.project || process.cwd());
  const records = store.listRecords(project);
  if (records.length === 0) throw new Error(`No session records for ${project.root}`);
  const given = positionals[0] || (flags.id && flags.id !== true ? flags.id : '');
  let record;
  if (given) record = resolveRecord(given, records);
  else if (process.stdin.isTTY) record = await promptDelete(project, records);
  else throw new Error('Pass the record id or list number to delete.');
  if (!record) {
    process.stderr.write('Delete cancelled.\n');
    return;
  }
  const removed = store.deleteRecord(project, record.id);
  process.stderr.write(`Deleted "${removed.title}" (${removed.id}).\n`);
  if (removed.detached.length > 0) {
    process.stderr.write(`Detached terminals: ${removed.detached.join(', ')}.\n`);
  }
}

async function log(flags) {
  const { binding, project } = store.requireTerminal(terminalId(flags));
  const message = await readBody(flags, 'message');
  store.appendLog(project, binding.recordId, {
    tool: binding.tool,
    terminalId: binding.terminalId,
    message,
  });
  process.stderr.write(`Logged to ${binding.recordId}.\n`);
}

async function snapshot(flags) {
  const { binding, project } = store.requireTerminal(terminalId(flags));
  const text = await readBody(flags, 'text');
  store.writeSnapshot(project, binding.recordId, text);
  process.stderr.write(`Updated snapshot for ${binding.recordId}.\n`);
}

function markedBlock(body) {
  return `<!-- session-record -->\n${body.trim()}\n<!-- /session-record -->\n`;
}

function upsertMarked(file, body) {
  const wrapped = markedBlock(body);
  let current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const pattern = /<!-- session-record -->[\s\S]*?<!-- \/session-record -->\n?/;
  if (pattern.test(current)) current = current.replace(pattern, wrapped);
  else {
    if (current && !current.endsWith('\n')) current += '\n';
    if (current) current += '\n';
    current += wrapped;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, current);
}

function shellQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

function exportShell(flags) {
  const file = flags['result-file'];
  if (!file || file === true) throw new Error('export-shell requires --result-file.');
  const result = JSON.parse(fs.readFileSync(file, 'utf8'));
  const lines = [
    `action=${shellQuote(result.action)}`,
    `record_path=${shellQuote(result.path)}`,
    `record_id=${shellQuote(result.id)}`,
    `instruction_dir=${shellQuote(result.instructionDir)}`,
    `instruction_file=${shellQuote(result.instructionFile)}`,
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function appendOnce(file, line) {
  let current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current.includes(line)) return false;
  if (current && !current.endsWith('\n')) current += '\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${current}${line}\n`);
  return true;
}

function powershellProfiles(home) {
  if (process.platform === 'win32') {
    return [
      path.join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
      path.join(home, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
    ];
  }
  return [path.join(home, '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1')];
}

function install(flags) {
  const home = flags.home && flags.home !== true ? path.resolve(flags.home) : os.homedir();
  const packageRoot = path.join(__dirname, '..');
  const dataHome = path.join(home, '.ai-session-record');
  const shellDir = path.join(dataHome, 'shell');
  fs.mkdirSync(shellDir, { recursive: true });
  for (const name of ['session-record.ps1', 'session-record.zsh']) {
    fs.copyFileSync(path.join(packageRoot, 'shell', name), path.join(shellDir, name));
  }

  const skillDest = path.join(home, '.cursor', 'skills', 'session-record', 'SKILL.md');
  fs.mkdirSync(path.dirname(skillDest), { recursive: true });
  fs.copyFileSync(path.join(packageRoot, 'skill', 'SKILL.md'), skillDest);

  upsertMarked(path.join(home, '.claude', 'CLAUDE.md'), USER_INSTRUCTION);
  upsertMarked(path.join(home, '.copilot', 'copilot-instructions.md'), USER_INSTRUCTION);

  const zshLine = '[[ -f "$HOME/.ai-session-record/shell/session-record.zsh" ]] && source "$HOME/.ai-session-record/shell/session-record.zsh"';
  appendOnce(path.join(home, '.zshrc'), zshLine);

  const psLine = '. "$HOME/.ai-session-record/shell/session-record.ps1"';
  for (const profile of powershellProfiles(home)) appendOnce(profile, psLine);

  process.stdout.write(`Installed session-record for ${home}\n`);
  process.stdout.write('Open a new terminal, then run claude, copilot, or: ai <tool>\n');
  process.stdout.write('Link the command first if it is not on PATH: npm link\n');
}

function removeLinesContaining(file, snippet) {
  if (!fs.existsSync(file)) return;
  const original = fs.readFileSync(file, 'utf8');
  let next = original
    .split('\n')
    .filter((line) => !line.includes(snippet))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '');
  if (next && !next.endsWith('\n')) next += '\n';
  if (!next.trim()) fs.rmSync(file);
  else if (next !== original) fs.writeFileSync(file, next);
}

function removeMarked(file) {
  if (!fs.existsSync(file)) return;
  const original = fs.readFileSync(file, 'utf8');
  let next = original
    .replace(/\n?<!-- session-record -->[\s\S]*?<!-- \/session-record -->\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '');
  if (next && !next.endsWith('\n')) next += '\n';
  if (!next.trim()) fs.rmSync(file);
  else if (next !== original) fs.writeFileSync(file, next);
}

function uninstall(flags) {
  const home = flags.home && flags.home !== true ? path.resolve(flags.home) : os.homedir();
  const dataHome = path.join(home, '.ai-session-record');
  removeLinesContaining(path.join(home, '.zshrc'), 'session-record.zsh');
  for (const profile of powershellProfiles(home)) {
    removeLinesContaining(profile, 'session-record.ps1');
  }
  removeMarked(path.join(home, '.claude', 'CLAUDE.md'));
  removeMarked(path.join(home, '.copilot', 'copilot-instructions.md'));
  fs.rmSync(path.join(home, '.cursor', 'skills', 'session-record'), { recursive: true, force: true });
  if (flags.records) fs.rmSync(dataHome, { recursive: true, force: true });
  else fs.rmSync(path.join(dataHome, 'shell'), { recursive: true, force: true });

  process.stdout.write(`Uninstalled session-record from ${home}\n`);
  if (flags.records) process.stdout.write('Deleted saved records.\n');
  else process.stdout.write(`Saved records are still in ${dataHome}\n`);
  process.stdout.write('Open a new terminal, then run: npm unlink -g ai-session-record\n');
}

async function main(argv) {
  const { flags, positionals } = parseArgs(argv);
  const command = positionals[0];
  if (!command || command === 'help' || flags.help) {
    process.stdout.write(HELP);
    return;
  }
  if (command === 'begin') return begin(flags);
  if (command === 'list') return list(flags);
  if (command === 'show') return show(flags, positionals.slice(1));
  if (command === 'current') return current(flags);
  if (command === 'log') return log(flags);
  if (command === 'delete') return remove(flags, positionals.slice(1));
  if (command === 'snapshot') return snapshot(flags);
  if (command === 'install') return install(flags);
  if (command === 'uninstall') return uninstall(flags);
  if (command === 'export-shell') return exportShell(flags);
  throw new Error(`Unknown command "${command}".\n${HELP}`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
