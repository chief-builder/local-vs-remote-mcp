import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((path) => path && !path.endsWith('package-lock.json'));

describe('repository hygiene', () => {
  it('committed files contain no absolute local home or temp paths', () => {
    const pattern = /(?:\/Users\/[A-Za-z]|\/home\/[a-z][\w-]*\/|\/private\/var\/|\/var\/folders\/|[A-Z]:\\Users\\)/;
    const offenders = tracked.filter((path) => {
      try {
        return pattern.test(readFileSync(path, 'utf8'));
      } catch {
        return false; // deleted in the working tree
      }
    });
    assert.deepEqual(offenders, []);
  });

  it('never tracks env files or raw transcripts', () => {
    assert.deepEqual(
      tracked.filter((path) => /(^|\/)\.env($|\.)/.test(path) && !path.endsWith('.env.example')),
      [],
    );
    assert.deepEqual(
      tracked.filter((path) => /\/runs\/[^/]+\/transcripts\//.test(path) || path.endsWith('.stderr.log')),
      [],
    );
  });
});
