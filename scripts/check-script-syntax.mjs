import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function collectMjs(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectMjs(path));
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      out.push(path);
    }
  }
  return out.sort();
}

function check(path) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--check', path], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', (code, signal) => {
      resolve({ path, code: code ?? (signal ? 1 : 0) });
    });
    child.on('error', () => {
      resolve({ path, code: 1 });
    });
  });
}

const files = await collectMjs(join(process.cwd(), 'scripts'));
const failures = [];
for (const file of files) {
  const result = await check(file);
  if (result.code !== 0) failures.push(result);
}

if (failures.length > 0) {
  console.error('Script syntax check failed:');
  for (const failure of failures) {
    console.error(`- ${failure.path} exited ${failure.code}`);
  }
  process.exit(1);
}

console.log(`Script syntax check passed (${files.length} files).`);
