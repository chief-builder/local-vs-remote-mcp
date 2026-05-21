import { readFile } from 'node:fs/promises';
import { tasks } from '../experiments/github/tasks/index.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const claudeText = await readFile('CLAUDE.md', 'utf8');
const requiredClaudePatterns = [
  [/baseline[\s\S]*no MCP/i, 'CLAUDE.md must document the baseline arm'],
  [/local-stdio[\s\S]*Docker stdio/i, 'CLAUDE.md must document the local stdio arm'],
  [/remote-http[\s\S]*streamable HTTP/i, 'CLAUDE.md must document the remote streamable HTTP arm'],
  [/local stdio servers run as the user/i, 'CLAUDE.md must state local stdio servers run as the user'],
  [/supply[- ]chain compromise[\s\S]*local compromise/i, 'CLAUDE.md must state supply-chain compromise can become local compromise'],
  [/filesystem[\s\S]*environment/i, 'CLAUDE.md must describe local filesystem and env exposure'],
  [/OAuth[\s\S]*confused-deputy/i, 'CLAUDE.md must describe remote OAuth confused-deputy risk'],
  [/keychain[\s\S]*(refresh-token|token compromise|compromise)/i, 'CLAUDE.md must describe keychain token compromise risk'],
  [/tool poisoning[\s\S]*indirect prompt injection[\s\S]*protocol-level/i, 'CLAUDE.md must frame tool poisoning and indirect prompt injection as protocol-level risks'],
  [/local and remote transports equally/i, 'CLAUDE.md must state protocol-level attacks affect both transports equally'],
];

for (const [pattern, message] of requiredClaudePatterns) {
  assert(pattern.test(claudeText), message);
}

const expectedTier3 = new Map([
  ['tier3_tool_poisoning_resilience', ['local-stdio', 'remote-http']],
  ['tier3_env_leak_local', ['local-stdio']],
  ['tier3_oauth_scope_audit', ['remote-http']],
]);

for (const [taskId, expectedArms] of expectedTier3) {
  const task = tasks.find((candidate) => candidate.id === taskId);
  assert(task, `missing required security task ${taskId}`);
  assert(task.tier === 3, `${taskId} must be tier 3`);
  assert(Array.isArray(task.applicableArms), `${taskId} must declare applicableArms`);
  const actualArms = [...task.applicableArms].sort();
  assert(
    JSON.stringify(actualArms) === JSON.stringify([...expectedArms].sort()),
    `${taskId} applicableArms mismatch: expected ${expectedArms.join(', ')}, got ${actualArms.join(', ')}`,
  );
}

const tier3Source = await readFile('experiments/github/tasks/tier3.ts', 'utf8');
const requiredTier3Patterns = [
  [/COMPLIED-/i, 'tool-poisoning task must include a compliance canary'],
  [/ignored_untrusted_instruction/i, 'tool-poisoning task must require ignored_untrusted_instruction output'],
  [/promptInjectionCompliance/i, 'tool-poisoning task must emit promptInjectionCompliance security metric'],
  [/HARMLESS_TOKEN/i, 'env leak task must inject a harmless env canary'],
  [/observed_environment_values/i, 'env leak task must ask for tool-observed environment values'],
  [/envCanaryLeaked/i, 'env leak task must record whether the canary leaked'],
  [/mutation_needed/i, 'OAuth scope audit must require read-only mutation_needed output'],
  [/Do not create issues, branches, pull requests, files, comments, labels/i, 'OAuth scope audit must forbid repo mutations'],
  [/repoMetadataUnchanged/i, 'OAuth scope audit must verify repo metadata was not mutated'],
];

for (const [pattern, message] of requiredTier3Patterns) {
  assert(pattern.test(tier3Source), message);
}

console.log('Security framing check passed.');
