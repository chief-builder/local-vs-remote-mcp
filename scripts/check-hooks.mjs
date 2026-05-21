import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const sourcePath = join(root, '.githooks', 'pre-push');
const installedPath = join(root, '.git', 'hooks', 'pre-push');

const [source, installed, installedStat] = await Promise.all([
  readFile(sourcePath, 'utf8'),
  readFile(installedPath, 'utf8'),
  stat(installedPath),
]);

if (source !== installed) {
  console.error('.git/hooks/pre-push does not match .githooks/pre-push; run npm run hooks:install');
  process.exit(1);
}

if ((installedStat.mode & 0o111) === 0) {
  console.error('.git/hooks/pre-push is not executable; run npm run hooks:install');
  process.exit(1);
}

if (!installed.includes('npm run scan:secrets')) {
  console.error('.git/hooks/pre-push does not run npm run scan:secrets');
  process.exit(1);
}

console.log('Pre-push hook is installed and runs secret scan.');
