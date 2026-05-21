export const TOKEN_PATTERNS = [
  { name: 'github_oauth_token', re: /\bgho_[A-Za-z0-9_]{20,255}\b/g },
  { name: 'github_pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g },
  { name: 'github_classic_pat', re: /\bghp_[A-Za-z0-9_]{20,255}\b/g },
  { name: 'github_server_token', re: /\bghs_[A-Za-z0-9_]{20,255}\b/g },
  { name: 'github_refresh_token', re: /\bghr_[A-Za-z0-9_]{20,255}\b/g },
];

export function lineNumber(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}
