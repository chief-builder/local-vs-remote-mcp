import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { startFixtureServer, type FixtureServer } from '../harness/src/fixtureServer.ts';

/** Raw request so paths like `/../x` are sent unnormalized. */
function rawRequest(port: number, path: string, method = 'GET', body?: Buffer): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        text += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('startFixtureServer', () => {
  let root: string;
  let server: FixtureServer;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'lvrmcp-fixtures-'));
    await writeFile(join(root, 'index.html'), '<h1>fixture</h1>');
    await writeFile(join(root, '..', 'lvrmcp-outside-secret.txt'), 'outside').catch(() => undefined);
    server = await startFixtureServer(root, (req, res) => {
      if (req.url === '/dynamic') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('rendered');
        return true;
      }
      if (req.url === '/boom') throw new Error('renderer failed');
      return false;
    });
  });

  after(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
    await rm(join(root, '..', 'lvrmcp-outside-secret.txt'), { force: true });
  });

  it('serves static files with index fallback', async () => {
    const res = await rawRequest(server.port, '/');
    assert.equal(res.status, 200);
    assert.equal(res.text, '<h1>fixture</h1>');
  });

  it('lets the renderer handle a request first', async () => {
    assert.deepEqual(await rawRequest(server.port, '/dynamic'), { status: 200, text: 'rendered' });
  });

  it('returns 500 when the renderer throws', async () => {
    assert.equal((await rawRequest(server.port, '/boom')).status, 500);
  });

  it('returns 404 for missing files', async () => {
    assert.equal((await rawRequest(server.port, '/missing.html')).status, 404);
  });

  it('blocks path traversal outside the fixture root', async () => {
    for (const path of ['/../lvrmcp-outside-secret.txt', '/%2e%2e/lvrmcp-outside-secret.txt', '/..%2flvrmcp-outside-secret.txt']) {
      const res = await rawRequest(server.port, path);
      assert.notEqual(res.status, 200, path);
      assert.notEqual(res.text, 'outside', path);
    }
  });

  it('rejects non-GET methods on static paths', async () => {
    assert.equal((await rawRequest(server.port, '/index.html', 'POST', Buffer.from('x'))).status, 405);
  });

  it('rejects request bodies over 1 MB', async () => {
    const res = await rawRequest(server.port, '/dynamic', 'POST', Buffer.alloc(1_000_001));
    assert.equal(res.status, 413);
  });

  it('advertises a localhost URL', () => {
    assert.match(server.url, /^http:\/\/localhost:\d+$/);
  });
});
