import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { TOKEN_PATTERNS, lineNumber } from './secret-patterns.mjs';

export function hasTokenShapedSecret(text) {
  return TOKEN_PATTERNS.some((pattern) => {
    pattern.re.lastIndex = 0;
    return pattern.re.test(text);
  });
}

export async function transcriptStatus(path) {
  let st;
  try {
    st = await stat(path);
  } catch {
    return {
      path,
      exists: false,
      nonEmpty: false,
      validJsonl: false,
      secretFree: false,
    };
  }

  let validJsonl = false;
  let secretFree = false;
  if (st.isFile() && st.size > 0) {
    try {
      const text = await readFile(path, 'utf8');
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      validJsonl = lines.length > 0 && lines.every((line) => {
        try {
          JSON.parse(line);
          return true;
        } catch {
          return false;
        }
      });
      secretFree = !hasTokenShapedSecret(text);
    } catch {
      validJsonl = false;
      secretFree = false;
    }
  }

  return {
    path,
    exists: st.isFile(),
    nonEmpty: st.isFile() && st.size > 0,
    validJsonl,
    secretFree,
  };
}

export async function validTranscriptFile(path) {
  const status = await transcriptStatus(path);
  return status.exists && status.nonEmpty && status.validJsonl && status.secretFree;
}

export async function artifactTreeSecretFree(path) {
  let st;
  try {
    st = await lstat(path);
  } catch {
    return true;
  }
  if (st.isFile()) {
    try {
      const text = await readFile(path, 'utf8');
      if (text.includes('\u0000')) return true;
      return !hasTokenShapedSecret(text);
    } catch {
      return true;
    }
  }
  if (!st.isDirectory()) return true;
  for (const entry of await readdir(path)) {
    if (!await artifactTreeSecretFree(join(path, entry))) return false;
  }
  return true;
}

async function walkFiles(path, files = []) {
  let st;
  try {
    st = await lstat(path);
  } catch {
    return files;
  }
  if (st.isFile()) {
    files.push(path);
    return files;
  }
  if (!st.isDirectory()) return files;
  for (const entry of await readdir(path)) {
    await walkFiles(join(path, entry), files);
  }
  return files;
}

export async function scanTreeForTokenFindings(path, { baseDir = process.cwd() } = {}) {
  const secretFindings = [];
  for (const file of await walkFiles(path)) {
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
        secretFindings.push(`${relative(baseDir, file)}:${lineNumber(text, match.index ?? 0)}: ${pattern.name}`);
      }
    }
  }
  return secretFindings;
}
