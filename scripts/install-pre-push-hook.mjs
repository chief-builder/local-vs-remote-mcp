import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const hookPath = join(process.cwd(), '.git', 'hooks', 'pre-push');
const sourcePath = join(process.cwd(), '.githooks', 'pre-push');

await mkdir(dirname(hookPath), { recursive: true });
await copyFile(sourcePath, hookPath);
await chmod(hookPath, 0o755);
console.log(`Installed ${hookPath}`);
