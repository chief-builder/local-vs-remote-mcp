import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const scannedRoots = [
  join(root, 'artifacts', 'verify-arms'),
  join(root, 'artifacts', 'spike', 'auth'),
];
const forbiddenJsonKeys = new Set(['email', 'orgId', 'orgName', 'subscriptionType']);
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const failures = [];

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function scanObject(value, path, pointer = '$') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, idx) => scanObject(item, path, `${pointer}[${idx}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenJsonKeys.has(key)) {
      failures.push(`${path}: forbidden auth metadata key ${pointer}.${key}`);
    }
    scanObject(child, path, `${pointer}.${key}`);
  }
}

for (const dir of scannedRoots) {
  for (const path of await walk(dir)) {
    const text = await readFile(path, 'utf8');
    if (emailPattern.test(text)) {
      failures.push(`${path}: contains email-shaped text`);
    }
    if (!path.endsWith('.json')) continue;
    try {
      scanObject(JSON.parse(text), path);
    } catch {
      failures.push(`${path}: invalid JSON artifact`);
    }
  }
}

if (failures.length > 0) {
  console.error('Artifact sanitization check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Artifact sanitization check passed.');
