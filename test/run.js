const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const bin = path.join(root, 'bin', 'session-record.js');
const tmpRoot = path.join(root, '.tmp');
fs.mkdirSync(tmpRoot, { recursive: true });
const work = fs.mkdtempSync(path.join(tmpRoot, 'run-'));
process.on('exit', () => fs.rmSync(work, { recursive: true, force: true }));
const home = path.join(work, 'store');
const projectA = path.join(work, 'alpha');
const projectB = path.join(work, 'beta');
fs.mkdirSync(path.join(projectA, 'nested'), { recursive: true });
fs.mkdirSync(projectB, { recursive: true });

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: options.cwd || projectA,
    encoding: 'utf8',
    env: {
      ...process.env,
      SESSION_RECORD_HOME: home,
      SESSION_RECORD_TERMINAL: options.terminal || '',
      SESSION_RECORD_CHOICE: '',
      SESSION_RECORD_NAME: '',
    },
  });
  const detail = [result.stdout, result.stderr].filter(Boolean).join('\n');
  if (options.expectError) {
    assert.notStrictEqual(result.status, 0, detail);
    return result;
  }
  assert.strictEqual(result.status, 0, detail);
  return result;
}

function readResult(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const firstResult = path.join(work, 'first.json');
run([
  'begin',
  '--tool', 'claude',
  '--terminal-id', '10',
  '--choice', 'new',
  '--name', 'Auth refactor',
  '--result-file', firstResult,
]);
const first = readResult(firstResult);
assert.strictEqual(first.action, 'attach');
assert.strictEqual(first.id, 'auth-refactor');
assert.strictEqual(first.tool, 'claude');
assert.ok(fs.existsSync(first.path));
assert.match(fs.readFileSync(first.instructionFile, 'utf8'), /auth-refactor/);
assert.match(fs.readFileSync(first.path, 'utf8'), /Session started/);

const listed = run(['list']);
assert.match(listed.stdout, /auth-refactor/);

const secondResult = path.join(work, 'second.json');
run([
  'begin',
  '--tool', 'copilot',
  '--terminal-id', '11',
  '--choice', '1',
  '--result-file', secondResult,
]);
const second = readResult(secondResult);
assert.strictEqual(second.action, 'attach');
assert.strictEqual(second.id, 'auth-refactor');
assert.strictEqual(second.path, first.path);
assert.notStrictEqual(second.instructionDir, first.instructionDir);

run(['log', '--terminal-id', '11', '--message', 'Copilot added the login form.']);
run(['snapshot', '--terminal-id', '11', '--text', 'Goal: finish login.\nOpen: wire the form.']);

const shown = run(['show', '--terminal-id', '10']);
assert.match(shown.stdout, /Copilot added the login form/);
assert.match(shown.stdout, /Goal: finish login/);
assert.match(shown.stdout, /terminal 10/);
assert.match(shown.stdout, /terminal 11/);

const current = run(['current'], { terminal: '11' });
assert.strictEqual(current.stdout.trim(), first.path);

const skipped = path.join(work, 'skip.json');
run([
  'begin',
  '--tool', 'claude',
  '--terminal-id', '12',
  '--choice', 'skip',
  '--result-file', skipped,
]);
assert.strictEqual(readResult(skipped).action, 'skip');
run(['current', '--terminal-id', '12'], { expectError: true });

run([
  'begin',
  '--tool', 'gemini',
  '--terminal-id', '20',
  '--project', projectB,
  '--choice', 'new',
  '--name', 'Other work',
  '--result-file', path.join(work, 'other.json'),
]);
const betaList = run(['list', '--project', projectB]);
assert.match(betaList.stdout, /other-work/);
assert.doesNotMatch(betaList.stdout, /auth-refactor/);
const alphaList = run(['list', '--project', projectA]);
assert.doesNotMatch(alphaList.stdout, /other-work/);

fs.mkdirSync(path.join(projectA, '.git', 'refs', 'heads'), { recursive: true });
fs.mkdirSync(path.join(projectA, '.git', 'objects'), { recursive: true });
fs.writeFileSync(path.join(projectA, '.git', 'HEAD'), 'ref: refs/heads/main\n');
const gitResult = path.join(work, 'git.json');
run([
  'begin',
  '--tool', 'claude',
  '--terminal-id', '30',
  '--choice', 'auth-refactor',
  '--result-file', gitResult,
], { cwd: path.join(projectA, 'nested') });
assert.strictEqual(readResult(gitResult).projectRoot, projectA);

const quoted = path.join(work, 'quoted.json');
fs.writeFileSync(quoted, JSON.stringify({
  action: 'attach',
  path: "/tmp/a b's",
  id: 'auth',
  instructionDir: '/tmp/dir',
  instructionFile: '/tmp/dir/AGENTS.md',
}));
const exported = run(['export-shell', '--result-file', quoted]);
const decoded = spawnSync('zsh', ['-c', 'eval "$1"; printf %s "$record_path"', 'zsh', exported.stdout], {
  encoding: 'utf8',
});
assert.strictEqual(decoded.status, 0, decoded.stderr);
assert.strictEqual(decoded.stdout, "/tmp/a b's");

const installHome = path.join(work, 'user-home');
run(['install', '--home', installHome], { cwd: projectA });
assert.ok(fs.existsSync(path.join(installHome, '.cursor', 'skills', 'session-record', 'SKILL.md')));
assert.match(fs.readFileSync(path.join(installHome, '.claude', 'CLAUDE.md'), 'utf8'), /SESSION_RECORD_PATH/);
assert.match(fs.readFileSync(path.join(installHome, '.copilot', 'copilot-instructions.md'), 'utf8'), /SESSION_RECORD_PATH/);
assert.match(fs.readFileSync(path.join(installHome, '.zshrc'), 'utf8'), /session-record\.zsh/);
assert.match(
  fs.readFileSync(path.join(installHome, '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1'), 'utf8'),
  /session-record\.ps1/
);
assert.ok(fs.existsSync(path.join(installHome, '.ai-session-record', 'shell', 'session-record.ps1')));
run(['install', '--home', installHome], { cwd: projectA });
const zshrc = fs.readFileSync(path.join(installHome, '.zshrc'), 'utf8');
const sourced = zshrc.split('\n').filter((line) => line.includes('source "$HOME/.ai-session-record/shell/session-record.zsh"'));
assert.strictEqual(sourced.length, 1);

run(['begin', '--tool', 'claude', '--choice', 'missing'], { expectError: true });

const syntax = spawnSync('zsh', ['-n', path.join(root, 'shell', 'session-record.zsh')], { encoding: 'utf8' });
assert.strictEqual(syntax.status, 0, syntax.stderr);

const fakeBin = path.join(work, 'bin');
fs.mkdirSync(fakeBin);
fs.writeFileSync(path.join(fakeBin, 'session-record'), `#!/bin/sh\nexec "${process.execPath}" "${bin}" "$@"\n`);
fs.writeFileSync(path.join(fakeBin, 'claude'), `#!/bin/sh
printf 'record=%s\\n' "$SESSION_RECORD_PATH" > "${path.join(work, 'claude-env.txt')}"
printf '%s\\n' "$2" > "${path.join(work, 'claude-prompt.txt')}"
`);
fs.chmodSync(path.join(fakeBin, 'session-record'), 0o755);
fs.chmodSync(path.join(fakeBin, 'claude'), 0o755);
fs.chmodSync(bin, 0o755);

const launched = spawnSync(
  'zsh',
  ['-c', 'source "$1"; claude --print hi', '_', path.join(root, 'shell', 'session-record.zsh')],
  {
    cwd: projectA,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      SESSION_RECORD_HOME: home,
      SESSION_RECORD_CHOICE: 'auth-refactor',
      SESSION_RECORD_TERMINAL: '',
      TERM: 'xterm',
    },
  }
);
assert.strictEqual(launched.status, 0, `${launched.stdout}\n${launched.stderr}`);
assert.strictEqual(fs.readFileSync(path.join(work, 'claude-env.txt'), 'utf8').trim(), `record=${first.path}`);
assert.match(fs.readFileSync(path.join(work, 'claude-prompt.txt'), 'utf8'), /Session record/);

fs.writeFileSync(path.join(fakeBin, 'copilot'), `#!/bin/sh
printf '%s\\n' "$SESSION_RECORD_PATH" > "${path.join(work, 'copilot-record.txt')}"
printf '%s\\n' "$COPILOT_CUSTOM_INSTRUCTIONS_DIRS" > "${path.join(work, 'copilot-instructions.txt')}"
`);
fs.chmodSync(path.join(fakeBin, 'copilot'), 0o755);
const copilot = spawnSync(
  'zsh',
  ['-c', 'source "$1"; copilot', '_', path.join(root, 'shell', 'session-record.zsh')],
  {
    cwd: projectA,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      SESSION_RECORD_HOME: home,
      SESSION_RECORD_CHOICE: '1',
      SESSION_RECORD_TERMINAL: '',
      TERM: 'xterm',
    },
  }
);
assert.strictEqual(copilot.status, 0, `${copilot.stdout}\n${copilot.stderr}`);
assert.strictEqual(fs.readFileSync(path.join(work, 'copilot-record.txt'), 'utf8').trim(), first.path);
const instructionDir = fs.readFileSync(path.join(work, 'copilot-instructions.txt'), 'utf8').trim().split(',')[0];
assert.ok(fs.existsSync(path.join(instructionDir, 'AGENTS.md')));

const disposable = path.join(work, 'disposable.json');
run([
  'begin',
  '--tool', 'claude',
  '--terminal-id', '40',
  '--choice', 'new',
  '--name', 'Disposable',
  '--result-file', disposable,
]);
run([
  'begin',
  '--tool', 'copilot',
  '--terminal-id', '41',
  '--choice', 'disposable',
  '--result-file', path.join(work, 'disposable-2.json'),
]);
const disposableRecord = readResult(disposable);
const secondDisposable = readResult(path.join(work, 'disposable-2.json'));
run(['delete', 'disposable', '--terminal-id', '99']);
assert.ok(!fs.existsSync(disposableRecord.path));
assert.ok(!fs.existsSync(path.join(disposableRecord.instructionDir, 'AGENTS.md')));
assert.ok(!fs.existsSync(path.join(secondDisposable.instructionDir, 'AGENTS.md')));
run(['current', '--terminal-id', '40'], { expectError: true });
run(['current', '--terminal-id', '41'], { expectError: true });
assert.strictEqual(run(['current', '--terminal-id', '11']).stdout.trim(), first.path);
const afterDelete = run(['list']);
assert.doesNotMatch(afterDelete.stdout, /disposable/);
assert.match(afterDelete.stdout, /auth-refactor/);
run(['delete', 'other-work'], { expectError: true });
assert.match(run(['list', '--project', projectB]).stdout, /other-work/);
run(['delete', '1']);
assert.doesNotMatch(run(['list']).stdout, /auth-refactor/);

fs.rmSync(work, { recursive: true, force: true });
process.stdout.write('session-record tests passed\n');
