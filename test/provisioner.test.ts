import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { provisionRepo, repoNameFor, waitForLabelsStable, type GhConfig } from '../experiments/github/provisioner.ts';
import { installFakeGithub, type Route } from './helpers/fakeGithub.ts';

const cfg: GhConfig = { controllerToken: 'test-controller-value', sandboxOwner: 'example-lab', host: 'api.github.com' };
const repo = 'example-lab/lvrmcp-test';
const fast = { intervalMs: 1, timeoutMs: 5_000 }; // returns as soon as labels settle; the budget only matters under load

function sequence(bodies: unknown[]): Route {
  let i = 0;
  return () => ({ status: 200, body: bodies[Math.min(i++, bodies.length - 1)] });
}

describe('waitForLabelsStable', () => {
  it('waits for asynchronously created default labels to settle', async () => {
    const gh = installFakeGithub({
      [`GET /repos/${repo}/labels?per_page=100`]: sequence([
        [],
        [{ name: 'bug' }],
        [{ name: 'bug' }, { name: 'question' }],
        [{ name: 'question' }, { name: 'bug' }],
      ]),
    });
    try {
      assert.deepEqual(await waitForLabelsStable(cfg, repo, fast), ['bug', 'question']);
    } finally {
      gh.restore();
    }
  });

  it('does not treat the initial empty label list as settled', async () => {
    const gh = installFakeGithub({
      [`GET /repos/${repo}/labels?per_page=100`]: sequence([[], [], [], [{ name: 'bug' }], [{ name: 'bug' }]]),
    });
    try {
      assert.deepEqual(await waitForLabelsStable(cfg, repo, fast), ['bug']);
    } finally {
      gh.restore();
    }
  });

  it('returns the last read when labels never settle before the timeout', async () => {
    let n = 0;
    const gh = installFakeGithub({ [`GET /repos/${repo}/labels?per_page=100`]: () => ({ status: 200, body: [{ name: `l${n++}` }] }) });
    try {
      const labels = await waitForLabelsStable(cfg, repo, { intervalMs: 1, timeoutMs: 20 });
      assert.equal(labels.length, 1);
    } finally {
      gh.restore();
    }
  });
});

describe('provisionRepo', () => {
  it('creates a private org repo, seeds files, and returns a cleanup handle that deletes it', async () => {
    const gh = installFakeGithub({
      'GET /users/example-lab': { status: 200, body: { type: 'Organization' } },
      'POST /orgs/example-lab/repos': { status: 201, body: {} },
      [`GET /repos/${repo}`]: { status: 200, body: {} },
      [`GET /repos/${repo}/labels?per_page=100`]: { status: 200, body: [{ name: 'bug' }] },
      [`PUT /repos/${repo}/contents/README.md`]: { status: 201, body: {} },
      [`DELETE /repos/${repo}`]: { status: 204 },
    });
    try {
      const out = await provisionRepo(cfg, 'lvrmcp-test', { files: [{ path: 'README.md', content: 'hi' }] });
      const create = gh.requests.find((r) => r.method === 'POST')!;
      assert.equal((create.body as { private: boolean }).private, true);
      const put = gh.requests.find((r) => r.method === 'PUT')!;
      assert.equal((put.body as { content: string }).content, Buffer.from('hi').toString('base64'));
      await out.cleanupHandle();
      assert.equal(gh.requests.at(-1)!.method, 'DELETE');
      assert.ok(gh.requests.every((r) => r.headers.Authorization === 'Bearer test-controller-value'));
    } finally {
      gh.restore();
    }
  });

  it('surfaces API errors with method, path, and status but not the token', async () => {
    const gh = installFakeGithub({
      'GET /users/example-lab': { status: 200, body: { type: 'Organization' } },
      'POST /orgs/example-lab/repos': { status: 403, body: { message: 'Resource not accessible' } },
    });
    try {
      await assert.rejects(provisionRepo(cfg, 'lvrmcp-test', { files: [] }), (err: Error) => {
        assert.match(err.message, /POST \/orgs\/example-lab\/repos -> 403/);
        assert.doesNotMatch(err.message, /test-controller-value/);
        return true;
      });
    } finally {
      gh.restore();
    }
  });

  it('deletes the repo when seeding fails after creation (no leaked sandbox repo)', async () => {
    const gh = installFakeGithub({
      'GET /users/example-lab': { status: 200, body: { type: 'Organization' } },
      'POST /orgs/example-lab/repos': { status: 201, body: {} },
      [`GET /repos/${repo}`]: { status: 200, body: {} },
      [`GET /repos/${repo}/labels?per_page=100`]: { status: 200, body: [{ name: 'bug' }] },
      [`PUT /repos/${repo}/contents/README.md`]: { status: 502, body: { message: 'Bad Gateway' } },
      [`DELETE /repos/${repo}`]: { status: 204 },
    });
    try {
      await assert.rejects(provisionRepo(cfg, 'lvrmcp-test', { files: [{ path: 'README.md', content: 'hi' }] }), /-> 502/);
      assert.equal(gh.requests.at(-1)!.method, 'DELETE');
      assert.equal(gh.requests.at(-1)!.path, `/repos/${repo}`);
    } finally {
      gh.restore();
    }
  });

  it('treats 422 already_exists on labels as a no-op', async () => {
    const gh = installFakeGithub({
      'GET /users/example-lab': { status: 200, body: { type: 'User' } },
      'POST /user/repos': { status: 201, body: {} },
      [`GET /repos/${repo}`]: { status: 200, body: {} },
      [`GET /repos/${repo}/labels?per_page=100`]: { status: 200, body: [{ name: 'bug' }] },
      [`POST /repos/${repo}/labels`]: { status: 422, body: { errors: [{ code: 'already_exists' }] } },
    });
    try {
      await provisionRepo(cfg, 'lvrmcp-test', { files: [], labels: [{ name: 'bug', color: 'ff0000' }] });
    } finally {
      gh.restore();
    }
  });
});

describe('repoNameFor', () => {
  it('derives a prefixed, URL-safe name from task id and seed', () => {
    assert.equal(repoNameFor('tier1_repo_inventory', 'abcdef0123456789'), 'lvrmcp-tier1-repo-inventory-abcdef01');
  });
});
