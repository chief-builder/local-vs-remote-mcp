/**
 * Token-shaped GitHub credentials (classic PAT, OAuth, user-to-server,
 * server-to-server, refresh, fine-grained PAT). Shared by the transcript
 * `secretInOutput` metric, the repo/run-artifact secret scan, and the
 * git-filter-repo redaction file (kept in sync by `check:secret-patterns`).
 */
export const TOKEN_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'github_oauth_token', re: /\bgho_[A-Za-z0-9_]{20,255}\b/g },
  { name: 'github_pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g },
  { name: 'github_classic_pat', re: /\bghp_[A-Za-z0-9_]{20,255}\b/g },
  { name: 'github_user_to_server_token', re: /\bghu_[A-Za-z0-9_]{20,255}\b/g },
  { name: 'github_server_token', re: /\bghs_[A-Za-z0-9_]{20,255}\b/g },
  { name: 'github_refresh_token', re: /\bghr_[A-Za-z0-9_]{20,255}\b/g },
];

export function hasTokenShapedSecret(text: string): boolean {
  return TOKEN_PATTERNS.some(({ re }) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

export function lineNumber(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}
