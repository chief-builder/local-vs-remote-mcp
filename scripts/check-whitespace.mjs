import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.env',
  '.example',
  '.html',
  '.js',
  '.json',
  '.jsonl',
  '.md',
  '.mjs',
  '.sh',
  '.ts',
  '.txt',
  '.yml',
]);

function extension(path) {
  const idx = path.lastIndexOf('.');
  return idx >= 0 ? path.slice(idx) : '';
}

async function candidateFiles() {
  const { stdout } = await execFileAsync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: process.cwd(),
    encoding: 'buffer',
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((path) => TEXT_EXTENSIONS.has(extension(path)) || path === '.gitignore' || path.startsWith('.githooks/'));
}

const findings = [];
for (const rel of await candidateFiles()) {
  let text;
  try {
    text = await readFile(join(process.cwd(), rel), 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\u0000')) continue;
  const lines = text.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (/[ \t]+$/.test(line)) findings.push(`${rel}:${i + 1}: trailing whitespace`);
    if (/^(<<<<<<<|=======|>>>>>>>)(?:\s|$)/.test(line)) findings.push(`${rel}:${i + 1}: conflict marker`);
  }
}

if (findings.length > 0) {
  for (const finding of findings) console.error(finding);
  console.error(`Whitespace check failed: ${findings.length} finding(s).`);
  process.exit(1);
}

console.log('Whitespace check passed.');
