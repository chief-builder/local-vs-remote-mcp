import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasTokenShapedSecret, lineNumber } from '../harness/src/secretPatterns.ts';

// Synthetic token-shaped strings built at runtime so this file never
// contains a literal token (and the repo secret scan stays clean).
const fake = (prefix: string, length = 36) => `${prefix}${'x'.repeat(length)}`;

describe('hasTokenShapedSecret', () => {
  for (const prefix of ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_']) {
    it(`detects ${prefix} tokens`, () => {
      assert.equal(hasTokenShapedSecret(`leaked ${fake(prefix)} here`), true);
    });
  }

  it('ignores short or unprefixed strings', () => {
    assert.equal(hasTokenShapedSecret(fake('ghp_', 10)), false);
    assert.equal(hasTokenShapedSecret('ghx_' + 'x'.repeat(40)), false);
    assert.equal(hasTokenShapedSecret('canary-deadbeef GITHUB_TOKEN=***REDACTED***'), false);
  });

  it('is stable across repeated calls (global regex lastIndex reset)', () => {
    const text = fake('ghp_');
    assert.equal(hasTokenShapedSecret(text), true);
    assert.equal(hasTokenShapedSecret(text), true);
  });
});

describe('lineNumber', () => {
  it('counts newlines before the index', () => {
    assert.equal(lineNumber('a\nb\nc', 0), 1);
    assert.equal(lineNumber('a\nb\nc', 4), 3);
  });
});
