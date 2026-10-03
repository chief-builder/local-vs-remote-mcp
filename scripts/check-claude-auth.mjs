import { spawn } from 'node:child_process';

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code, signal) => {
      resolve({ code: code ?? (signal ? 1 : 0), stdout, stderr });
    });
    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

const result = await run('claude', ['auth', 'status', '--json']);
let status = null;
try {
  status = JSON.parse(result.stdout || '{}');
} catch {
  status = null;
}

if (result.code === 0 && status?.loggedIn === true) {
  console.log(`Claude Code auth: logged in (${status.authMethod ?? 'unknown method'})`);
  process.exit(0);
}

console.error('Claude Code auth: not logged in');
console.error('Run `claude auth login` in a terminal, or `/login` in Claude Code, then retry.');
const detail = (result.stderr || result.stdout || '').trim();
if (detail) console.error(detail);
process.exit(1);
