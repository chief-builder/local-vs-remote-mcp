import { execFile } from 'node:child_process';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { TOKEN_PATTERNS, lineNumber } from '../harness/src/secretPatterns.ts';

const execFileAsync = promisify(execFile);

const SKIP_DIRS = new Set(['.git', 'node_modules', 'harness/dist']);

function argValues(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === name && process.argv[i + 1]) values.push(process.argv[i + 1]);
  }
  return values;
}

async function walk(path, files = []) {
  const st = await lstat(path);
  if (st.isFile()) {
    files.push(path);
    return files;
  }
  if (!st.isDirectory()) return files;

  for (const entry of await readdir(path)) {
    const child = join(path, entry);
    const rel = relative(process.cwd(), child);
    if ([...SKIP_DIRS].some((skip) => rel === skip || rel.startsWith(`${skip}/`))) continue;
    const childStat = await lstat(child);
    if (childStat.isDirectory()) {
      await walk(child, files);
    } else if (childStat.isFile()) {
      files.push(child);
    }
  }
  return files;
}

async function candidateFiles() {
  const explicitPaths = argValues('--path');
  if (explicitPaths.length > 0) {
    const files = [];
    for (const explicitPath of explicitPaths) {
      await walk(join(process.cwd(), explicitPath), files);
    }
    return files;
  }

  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: process.cwd(),
      encoding: 'buffer',
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .map((path) => join(process.cwd(), path));
  } catch {
    return walk(process.cwd());
  }
}

let findings = 0;
for (const file of await candidateFiles()) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\u0000')) continue;
  for (const pattern of TOKEN_PATTERNS) {
    pattern.re.lastIndex = 0;
    for (const match of text.matchAll(pattern.re)) {
      findings++;
      const rel = relative(process.cwd(), file);
      const line = lineNumber(text, match.index ?? 0);
      console.error(`${rel}:${line}: ${pattern.name}`);
    }
  }
}

if (findings > 0) {
  console.error(`Secret scan failed: ${findings} token-shaped string(s) found.`);
  process.exit(1);
}

console.log('Secret scan passed.');
