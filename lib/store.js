const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function homeDir() {
  return process.env.SESSION_RECORD_HOME || path.join(os.homedir(), '.ai-session-record');
}

function slugify(value) {
  const slug = String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'record';
}

function findProjectRoot(start) {
  const resolved = path.resolve(start);
  try {
    const top = execFileSync('git', ['-C', resolved, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (top) return path.resolve(top);
  } catch {
    // A folder that is not a git checkout uses its own path as the project.
  }
  return resolved;
}

function projectSlug(root) {
  const hash = crypto.createHash('sha256').update(root).digest('hex').slice(0, 6);
  return `${slugify(path.basename(root))}-${hash}`;
}

function projectPaths(root) {
  const slug = projectSlug(root);
  const dir = path.join(homeDir(), 'projects', slug);
  return {
    root,
    name: path.basename(root),
    slug,
    dir,
    recordsDir: path.join(dir, 'records'),
    instructionsDir: path.join(dir, 'instructions'),
    projectFile: path.join(dir, 'project.json'),
  };
}

function ensureProject(root) {
  const project = projectPaths(root);
  fs.mkdirSync(project.recordsDir, { recursive: true });
  fs.mkdirSync(project.instructionsDir, { recursive: true });
  fs.writeFileSync(
    project.projectFile,
    JSON.stringify({ root: project.root, name: project.name, slug: project.slug }, null, 2) + '\n'
  );
  return project;
}

function resolveProject(start) {
  return ensureProject(findProjectRoot(start || process.cwd()));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function listRecords(project) {
  if (!fs.existsSync(project.recordsDir)) return [];
  return fs
    .readdirSync(project.recordsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(path.join(project.recordsDir, name)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function recordFiles(project, id) {
  return {
    markdown: path.join(project.recordsDir, `${id}.md`),
    meta: path.join(project.recordsDir, `${id}.json`),
  };
}

function getRecord(project, id) {
  const files = recordFiles(project, id);
  if (!fs.existsSync(files.meta)) {
    throw new Error(`No record with id "${id}".`);
  }
  return {
    ...readJson(files.meta),
    markdown: fs.readFileSync(files.markdown, 'utf8'),
  };
}

function uniqueId(project, title) {
  const base = slugify(title);
  let id = base;
  let n = 2;
  while (fs.existsSync(recordFiles(project, id).meta)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

function renderRecord({ id, title, projectRoot, createdAt, updatedAt }) {
  return `# ${title}

- Id: ${id}
- Project: ${projectRoot}
- Created: ${createdAt}
- Updated: ${updatedAt}

## Snapshot

_No snapshot yet._

## Log
`;
}

function createRecord(project, title) {
  const trimmed = String(title || '').trim();
  if (!trimmed) throw new Error('A record name is required.');
  const now = new Date().toISOString();
  const id = uniqueId(project, trimmed);
  const files = recordFiles(project, id);
  const meta = {
    id,
    title: trimmed,
    projectRoot: project.root,
    createdAt: now,
    updatedAt: now,
    path: files.markdown,
  };
  fs.writeFileSync(files.markdown, renderRecord({ ...meta, projectRoot: project.root }));
  writeJson(files.meta, meta);
  return getRecord(project, id);
}

function terminalIndexPath(terminalId) {
  const safe = String(terminalId).replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(homeDir(), 'terminals', `${safe}.json`);
}

function readTerminal(terminalId) {
  const file = terminalIndexPath(terminalId);
  if (!fs.existsSync(file)) return null;
  return readJson(file);
}

function writeTerminal(binding) {
  writeJson(terminalIndexPath(binding.terminalId), binding);
}

function instructionPaths(project, terminalId) {
  const safe = String(terminalId).replace(/[^a-zA-Z0-9._-]/g, '_');
  const dir = path.join(project.instructionsDir, safe);
  return { dir, file: path.join(dir, 'AGENTS.md') };
}

function attachTerminal({ project, record, tool, terminalId, instruction }) {
  const paths = instructionPaths(project, terminalId);
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.writeFileSync(paths.file, instruction);
  const binding = {
    terminalId: String(terminalId),
    tool,
    recordId: record.id,
    recordTitle: record.title,
    recordPath: record.path,
    projectRoot: project.root,
    projectSlug: project.slug,
    instructionDir: paths.dir,
    instructionFile: paths.file,
    attachedAt: new Date().toISOString(),
  };
  writeTerminal(binding);
  return binding;
}

function withRecordLock(metaPath, fn) {
  const lockPath = `${metaPath}.lock`;
  const started = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - started > 5000) {
        throw new Error('Timed out waiting to update the session record.');
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

function updateRecord(project, id, mutator) {
  const files = recordFiles(project, id);
  return withRecordLock(files.meta, () => {
    const meta = readJson(files.meta);
    let markdown = fs.readFileSync(files.markdown, 'utf8');
    markdown = mutator(markdown, meta);
    meta.updatedAt = new Date().toISOString();
    markdown = markdown.replace(/^- Updated: .+$/m, `- Updated: ${meta.updatedAt}`);
    fs.writeFileSync(files.markdown, markdown);
    writeJson(files.meta, meta);
    return { ...meta, markdown };
  });
}

function appendLog(project, id, { tool, terminalId, message }) {
  const text = String(message || '').trim();
  if (!text) throw new Error('A log message is required.');
  const stamp = new Date().toISOString();
  return updateRecord(project, id, (markdown) => {
    const entry = `\n### ${stamp} · ${tool} · terminal ${terminalId}\n\n${text}\n`;
    return markdown.endsWith('\n') ? markdown + entry : `${markdown}\n${entry}`;
  });
}

function writeSnapshot(project, id, text) {
  const body = String(text || '').trim();
  if (!body) throw new Error('Snapshot text is required.');
  if (body.includes('\n## Log')) {
    throw new Error('Snapshot text cannot contain a Log heading.');
  }
  return updateRecord(project, id, (markdown) => {
    const start = markdown.indexOf('## Snapshot\n');
    const end = markdown.indexOf('\n## Log');
    if (start < 0 || end < 0 || end < start) {
      throw new Error('Record is missing Snapshot or Log sections.');
    }
    return `${markdown.slice(0, start + '## Snapshot\n'.length)}\n${body}\n${markdown.slice(end)}`;
  });
}

function snapshotText(markdown) {
  const match = markdown.match(/## Snapshot\n([\s\S]*?)\n## Log/);
  return match ? match[1].trim() : '';
}

function listTerminals() {
  const dir = path.join(homeDir(), 'terminals');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(path.join(dir, name)));
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function deleteRecord(project, id) {
  const record = getRecord(project, id);
  const files = recordFiles(project, id);
  fs.rmSync(files.markdown, { force: true });
  fs.rmSync(files.meta, { force: true });
  fs.rmSync(`${files.meta}.lock`, { recursive: true, force: true });

  const detached = [];
  for (const binding of listTerminals()) {
    if (binding.recordId !== id || binding.projectRoot !== project.root) continue;
    fs.rmSync(terminalIndexPath(binding.terminalId), { force: true });
    if (binding.instructionDir && isInside(project.instructionsDir, binding.instructionDir)) {
      fs.rmSync(binding.instructionDir, { recursive: true, force: true });
    }
    detached.push(String(binding.terminalId));
  }
  return { id: record.id, title: record.title, detached };
}

function requireTerminal(terminalId) {
  const binding = readTerminal(terminalId);
  if (!binding) {
    throw new Error('This terminal is not attached to a session record.');
  }
  const project = ensureProject(binding.projectRoot);
  return { binding, project, record: getRecord(project, binding.recordId) };
}

module.exports = {
  homeDir,
  findProjectRoot,
  resolveProject,
  listRecords,
  getRecord,
  createRecord,
  attachTerminal,
  appendLog,
  writeSnapshot,
  snapshotText,
  readTerminal,
  requireTerminal,
  deleteRecord,
};
