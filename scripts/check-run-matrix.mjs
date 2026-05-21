import { tasks } from '../experiments/github/tasks/index.ts';
import { tier1CoverageGapTasks } from '../experiments/github/tasks/tier1.ts';
import { readFile } from 'node:fs/promises';

const arms = ['baseline', 'local-stdio', 'remote-http'];
const expectedByArm = {
  baseline: [
    'tier1_repo_inventory',
    'tier1_issue_triage',
    'tier1_pr_diff_answer',
    'tier2_issue_workflow',
    'tier2_file_patch_pr',
    'tier2_file_patch_pr_directed',
    'tier2_issue_create',
  ],
  'local-stdio': [
    'tier1_repo_inventory',
    'tier1_issue_triage',
    'tier1_pr_diff_answer',
    'tier2_issue_workflow',
    'tier2_file_patch_pr',
    'tier2_file_patch_pr_directed',
    'tier2_issue_create',
    'tier3_tool_poisoning_resilience',
    'tier3_env_leak_local',
  ],
  'remote-http': [
    'tier1_repo_inventory',
    'tier1_issue_triage',
    'tier1_pr_diff_answer',
    'tier2_issue_workflow',
    'tier2_file_patch_pr',
    'tier2_file_patch_pr_directed',
    'tier2_issue_create',
    'tier3_tool_poisoning_resilience',
    'tier3_oauth_scope_audit',
  ],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function tasksForArm(arm) {
  return tasks
    .filter((task) => !task.applicableArms || task.applicableArms.includes(arm))
    .map((task) => task.id);
}

function assertSameList(actual, expected, label) {
  assert(
    actual.join('\n') === expected.join('\n'),
    `${label} mismatch\nexpected:\n${expected.join('\n')}\nactual:\n${actual.join('\n')}`,
  );
}

const defaultTaskIds = tasks.map((task) => task.id);
assert(defaultTaskIds.length === new Set(defaultTaskIds).size, 'default task IDs must be unique');
assert(!defaultTaskIds.includes('tier1_workflow_status'), 'tier1_workflow_status must stay out of the default apples-to-apples task export');

const coverageGapIds = tier1CoverageGapTasks.map((task) => task.id);
assertSameList(coverageGapIds, ['tier1_workflow_status'], 'coverage-gap task export');

for (const arm of arms) {
  assertSameList(tasksForArm(arm), expectedByArm[arm], `${arm} default task matrix`);
}

const expectedTaskArmCells = Object.values(expectedByArm).reduce((sum, items) => sum + items.length, 0);
const expectedTrialFilesAtN5 = expectedTaskArmCells * 5;
assert(expectedTaskArmCells === 25, `expected 25 task/arm cells, got ${expectedTaskArmCells}`);
assert(expectedTrialFilesAtN5 === 125, `expected 125 N=5 result/transcript files, got ${expectedTrialFilesAtN5}`);

const taskMap = new Map(tasks.map((task) => [task.id, task]));
assert(taskMap.get('tier3_tool_poisoning_resilience')?.applicableArms?.join(',') === 'local-stdio,remote-http', 'tool-poisoning task must run on both MCP transports');
assert(taskMap.get('tier3_env_leak_local')?.applicableArms?.join(',') === 'local-stdio', 'env-leak task must run only on local stdio');
assert(taskMap.get('tier3_oauth_scope_audit')?.applicableArms?.join(',') === 'remote-http', 'OAuth-scope audit task must run only on remote HTTP');

for (const task of tasks) {
  assert([1, 2, 3].includes(task.tier), `${task.id} has invalid tier ${task.tier}`);
  if (task.applicableArms) {
    for (const arm of task.applicableArms) {
      assert(arms.includes(arm), `${task.id} has unknown applicable arm ${arm}`);
    }
  }
}

const planSource = await readFile('scripts/print-run-matrix.mjs', 'utf8');
for (const requiredCommand of [
  'npm run check:static',
  'npm run check:claude-auth',
  'npm run harness -- verify-arms --experiment github --output artifacts/verify-arms/github.json',
  'npm run harness -- run --experiment github --run latency-smoke --arm local-stdio --task tier1_pr_diff_answer --trials 1',
  'npm run harness -- run --experiment github --run latency-smoke --arm remote-http --task tier1_pr_diff_answer --trials 1',
]) {
  assert(planSource.includes(requiredCommand), `plan:run output must include ${requiredCommand}`);
}

console.log('Run matrix audit passed.');
